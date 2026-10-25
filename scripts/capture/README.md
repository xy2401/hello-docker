# 分层镜像文件采集

公共工具只接收已有镜像与配方，不维护软件名称或版本分支。产品项目负责安装、版本锁和案例；Docker 项目负责 Ubuntu 基线、Bash 全量扫描、JSON 整理与展示包核验。旧 `bin/software-capture.mjs` 和历史 Actions 证据保留，不用旧入口执行本地新方案。

## 本地环境

在 WSL2 或原生 Linux 中运行，需要 Node.js 22、Podman 和 `podman-compose`。默认使用 rootless Podman，设置 `ENGINE=docker` 可改用 Docker Compose。无需 Windows Docker Desktop，也不修改宿主机的 Java、数据库或 MQ 安装。

```bash
export ENGINE=podman PODMAN_COMPOSE_PROVIDER=podman-compose
export BASE_IMAGE=localhost/hello-capture/ubuntu:26.04
bash support/capture/ubuntu/build.sh
```

Ubuntu 26.04 的来源 digest 写在 Compose 中；构建时更新系统，预装公共扫描工具，并把 apt 来源、包版本、归档 SHA-256 写进镜像的 `/usr/local/share/capture/`。更新后的镜像是可复用基线。后续构建读取实际镜像 ID；需要保持同一基线时直接复用该 ID，不重新执行系统更新。`gnu-coreutils` 提供 `gnustat` 等命令，避免 Ubuntu 默认 uutils 对非 UTF-8 路径和时间格式的差异。

SDKMAN/JDK 的 Dockerfile 位于 Lang；MongoDB 位于 SQL；Erlang/RabbitMQ 位于 MQ。各站明确传入本工具目录或固定提交 checkout，不假定兄弟目录存在。产品 Compose 按父镜像、子镜像顺序显式构建，不能用 `depends_on` 表示构建依赖。

## 采集入口

产品完成镜像构建后，传入安装链中的实际镜像 ID。以下环境变量均由调用方设置：

```bash
bash scripts/capture/run.sh \
  --recipe "$RECIPE_PATH" \
  --workspace "$NEW_CAPTURE_DIRECTORY" \
  --stage "ubuntu=$BASE_IMAGE_ID" \
  --stage "manager=$MANAGER_IMAGE_ID" \
  --stage "software=$SOFTWARE_IMAGE_ID" \
  --site "$LOCAL_SITE_BUNDLE_DIRECTORY"
```

两层软件可以省略 manager。调用前验证 linux/amd64 及父层链，解析 tag 后全程使用 image ID。每次使用全新的 workspace；旧批次不可覆盖。

只有一个读写绑定挂载：`workspace:/capture`。其中 `scripts/` 是本批脚本副本，`results/` 保存原始记录，`work/` 存案例临时文件。建议 workspace 放在 WSL 的 Linux 文件系统，源代码仍可位于 Windows 工作区。采集容器禁用外网；服务案例在单独的新容器里运行并使用回环连接。

扫描使用 `find -P`、GNU `stat`/`sha256sum`、`getfacl`、`getfattr`、`getcap` 和 `lsattr`。NUL 分隔保留含换行或非 UTF-8 的路径；普通文件计算哈希，设备/FIFO/socket 只记录元数据。原始 mode、权限、属主、大小、块数、时间、链接、设备、ACL/xattr/capabilities、包归属均保留。CLI 无法提供的 statx mask 等字段明确标记 unsupported。采集不归档目标文件内容；只复制指定目录中安装来源、哈希与版本等小型证据文件。

虚拟挂载、`/capture` 和容器运行时生成的身份/网络文件明确列入排除项。遍历、读取、哈希失败或扫描期间发生变化，批次不能通过。inode、atime、ctime 和目录分配大小不参与产品归属；相邻镜像差异及基线到最终镜像的总差异分别保存。产品命令只从配方声明的安装根目录和命令目录生成，SDKMAN 缓存、系统命令和包装脚本不自动算成产品。

## 记录与导入

每一步案例保留 argv、cwd、输入、stdout、stderr、退出码和断言；失败或缺失的执行结果不会替换成示例文本。配方仅支持明确的 `equals/includes/matches` 断言。

```bash
node scripts/capture/bundle.mjs verify "$CAPTURE_DIRECTORY"
node scripts/capture/bundle.mjs archive "$CAPTURE_DIRECTORY" "$NEW_PRODUCT_ARCHIVE"
node scripts/capture/bundle.mjs import "$CAPTURE_DIRECTORY" "$LOCAL_SITE_BUNDLE_DIRECTORY"
```

archive 只复制清单、元数据、脚本与执行证据，不复制 `work/` 内的数据库或其他案例文件。展示包保留协议版本、采集 ID、工具提交、产品提交、工作区修改标记、实际源文件哈希和每个分块哈希。导入先核验所有文件，再切换导入锁；`versions.json` 指向各批不可变 manifest。页面读取本站数据，每目录按 500 项分块、每页 50 项；原始 JSONL 属于产品项目的归档。未发布的本地批次不伪造远程下载链接。

手动 Actions 可调用相同脚本，只上传产物。工具不自动提交、推送或发布镜像。新基线更新会产生新 image ID 与新批次；旧证据不会被改写。

## 聚焦验证

```bash
node --test tests/capture-bundle.test.mjs tests/capture-scan.test.mjs
```

Linux 扫描器测试覆盖隐藏/非可执行/空文件、非 UTF-8 名称、链接、特殊权限、稀疏文件、ACL/xattr 解析、元数据变化和实际权限拒绝。完整网站构建不是采集入口的前置步骤。
