# 软件命令与完整文件采集

当前方案使用 **Bash + Podman / Docker + Compose**：先构建可复用的独立镜像，再采集各层完整文件清单，最后用 Node.js 整理差分、命令目录和案例结果。本地在 WSL2 或原生 Linux 执行，手动 Actions 调用同一套脚本。每批是否完整、案例是否通过，以真实记录为准。

旧 Python 采集器、Actions 专用入口和既有证据保留在[历史方案](./software-capture-legacy)，不用于解释当前分层采集流程。

## 独立镜像与项目归属

公共镜像以锁定 digest 的 Ubuntu 26.04 为起点，目标平台为 `linux/amd64`。更新系统并安装公共扫描工具后形成基线；下游复用实际镜像 ID，直到明确需要更新基线。WSL 发行版与目标容器版本互相独立。

```text
Ubuntu 26.04 更新后基线                   Hello Docker
├─ SDKMAN                                Hello Lang
│  └─ 各版本 JDK                         Hello Lang
├─ MongoDB + mongosh + Database Tools     Hello SQL
└─ Erlang                                Hello MQ
   └─ RabbitMQ                           Hello MQ
```

每层使用独立 Dockerfile 和镜像。Compose 保存构建参数，入口明确先父层、再子层；`depends_on` 不表示镜像构建顺序。子层 `FROM` 使用已解析的实际父镜像 ID，采集前核对平台及父层链，避免标签变化造成批次混用。

| 项目 | 维护内容 |
| --- | --- |
| Hello Docker | Ubuntu 基线、通用 Bash 扫描器、命令记录、Node.js 差分与展示包核验 |
| Hello Lang | SDKMAN / JDK 镜像、Java 版本与案例、原始批次和本站展示包 |
| Hello SQL | MongoDB 安装与版本、案例、原始批次和本站展示包 |
| Hello MQ | Erlang / RabbitMQ 镜像与版本、案例、原始批次和本站展示包 |

公共工具不接收 `--product java` 一类产品开关，也不维护产品版本表。产品通过明确工具路径或固定提交 checkout 调用公共脚本，不依赖相邻目录或 Docker 开发服务器。安装包版本、来源及 SHA-256 由产品配方维护；apt 依赖记录本次来源、版本和实际下载哈希，更新后重新构建属于新批次。

## 本地执行与单一挂载

在 WSL2 / Linux 中准备 Node.js 22、Podman 和 Compose provider。默认使用 rootless Podman，provider 明确设置为 `podman-compose`；设 `ENGINE=docker` 使用 Docker Compose。从 Hello Docker 仓库根目录构建公共基线：

```bash
export ENGINE=podman PODMAN_COMPOSE_PROVIDER=podman-compose
export BASE_IMAGE=localhost/hello-capture/ubuntu:26.04
bash support/capture/ubuntu/build.sh
```

随后在产品项目构建子层。版本及入口见 [Java](https://github.com/xy2401/hello-lang/tree/main/support/capture/java)、[MongoDB](https://github.com/xy2401/hello-sql/tree/main/support/capture/mongodb)、[RabbitMQ](https://github.com/xy2401/hello-mq/tree/main/support/capture/rabbitmq) 源码目录。公共入口接收 recipe、新批次目录和已有镜像；两层产品省略中间阶段即可：

```bash
bash scripts/capture/run.sh \
  --recipe "$RECIPE_PATH" \
  --workspace "$NEW_CAPTURE_DIRECTORY" \
  --stage "ubuntu=$BASE_IMAGE_ID" \
  --stage "manager=$MANAGER_IMAGE_ID" \
  --stage "software=$SOFTWARE_IMAGE_ID"
```

每次要求全新目录，旧批次不覆盖。仅挂载一个读写目录 `workspace:/capture`：`scripts/` 保存本批脚本副本，`results/` 保存原始输出，`work/` 保存案例临时数据。建议采集目录放在 WSL 的 Linux 文件系统，源代码可继续保存在 Windows 工作区。扫描与案例使用不同的新容器；采集容器禁用外网，服务案例通过回环地址通信。

完整参数及验证命令见[公共采集脚本说明](https://github.com/xy2401/hello-docker/blob/codex/hello-docker/scripts/capture/README.md)。

## 完整清单、差分和案例

Bash 调用 `find -P`、GNU `stat` / `sha256sum`、`getfacl`、`getfattr`、`getcap` 和 `lsattr`。清单覆盖隐藏文件、非可执行文件、空文件、目录、链接和特殊文件；NUL 分隔处理路径并保留原始字节。

每个路径记录类型、原始 mode、八进制与 `rwx` 权限、特殊权限位、UID/GID 与可解析名称、逻辑大小及块信息、时间、链接与设备、ACL、扩展属性、capabilities、包归属和普通文件 SHA-256。CLI 无法读取的 statx 支持掩码等字段标记不可用原因。

不沿软链接递归，不读取设备、FIFO 或 socket 内容。虚拟挂载、`/capture` 和运行时生成的身份与网络文件列明排除范围。遍历、读取、哈希失败或扫描期间文件变化时保留错误，该阶段不能标为完整。工具只保留清单、元数据、哈希、安装来源证据和执行记录，不归档整个文件系统的原始内容。

每个阶段生成完整 JSONL，保存相邻阶段差分；存在中间层时另存基线到最终镜像的总差分。新增、删除、内容、权限、属主和链接变化保留前后记录。inode、atime、ctime 和目录分配大小等环境变化不用于产品归属。命令目录限定在声明的安装根目录和命令目录，系统命令、依赖、SDKMAN 缓存与包装脚本不自动算作产品命令。

案例在最终产品的新容器执行，每步保留参数、工作目录、输入、stdout、stderr、退出码和断言。Java 覆盖版本、编译运行、JAR、`javap` 与 `jdeps`；MongoDB 覆盖版本、连接、临时集合、导出导入与备份恢复；RabbitMQ 覆盖版本、节点、虚拟主机、用户权限和插件。缺失或失败的结果保持实际状态，不用示例文本代替成功证据。

## 各站归档与展示

原始批次归产品项目。公共脚本提供核验、归档和本站展示包导入：

```bash
node scripts/capture/bundle.mjs verify "$CAPTURE_DIRECTORY"
node scripts/capture/bundle.mjs archive "$CAPTURE_DIRECTORY" "$NEW_PRODUCT_ARCHIVE"
node scripts/capture/bundle.mjs import "$CAPTURE_DIRECTORY" "$LOCAL_SITE_BUNDLE_DIRECTORY"
```

归档保留清单、脚本和执行证据，不复制 `work/` 内的数据库、cookie 或其他案例文件。展示包保存协议版本、采集 ID、工具和产品来源、工作区修改状态及内容哈希，导入前核验批次一致性。各站独立构建部署，页面只读本站数据；原始清单在对应批次实际发布后生成链接，未发布本地数据不伪造下载地址。

`/docker-commands` 展示命令、最终文件清单和阶段差异，按目录分块加载，每页 50 项。`/docker-command-ops` 使用上下布局，上方命令和备注，下方实际输出，默认原始文本，结构化结果可切换表格或 JSON。历史 `docker-tooling` / `DockerTooling` 入口和原版本证据继续保留。

手动 Actions 只采集、上传证据，不自动提交、推送或发布镜像。上传内容限定为归档和构建日志；失败时保留诊断，排除案例工作目录。升级、基线更新和失败重试均建立新批次；文件数和命令数以所选批次清单为准。
