# 软件命令与完整文件采集

本模块先覆盖 Java、MongoDB、RabbitMQ。通过 Ubuntu 26.04 的受控安装，分别记录基础系统、依赖、软件三个阶段的完整文件系统，再生成产品命令目录和逐步骤执行案例。命令目录是完整采集结果的派生视图，不是扫描整个 PATH 后给所有命令贴上产品名称。

## 固定环境与来源

平台为 `linux/amd64`；镜像使用 `ubuntu:26.04@sha256:42527649dbc4f9197a6073f426f488cbff0e9cc9f2afce32d91c383e4875634a`，不用 `latest`。配方保存在仓库根目录的 `software/<product>/recipe.json`。

| 产品 | 固定版本 | 发行来源 |
| --- | --- | --- |
| Java | Temurin 25.0.3+9 | [Adoptium 官方发行](https://github.com/adoptium/temurin25-binaries/releases/tag/jdk-25.0.3%2B9) |
| MongoDB | Server 9.0.4、mongosh 2.12.0、Database Tools 100.19.1 | [MongoDB 平台支持](https://www.mongodb.com/docs/community-platform-support/)、[mongosh 官方发行](https://github.com/mongodb-js/mongosh/releases/tag/v2.12.0) |
| RabbitMQ | 4.1.4、Erlang 27.3.4.3 / ERTS 15.2.7.2 | [RabbitMQ 官方发行](https://github.com/rabbitmq/rabbitmq-server/releases/tag/v4.1.4)、[Erlang 官方发行](https://github.com/erlang/otp/releases/tag/OTP-27.3.4.3) |

Ubuntu 26.04 的 MongoDB 支持从 9.0.4 起列入官方矩阵。原有 MongoDB 7/8 证据保留原版本，不能用来证明 9.0.4 的运行结果。

发行包和独立采集运行时的 URL、版本、SHA-256 已写入配方。准备阶段从 Ubuntu 镜像的签名 apt 源解析依赖，显式要求 apt 使用 SHA-256，记录每个 deb 的精确版本、架构、下载 URL、字节数和校验和，写入本批次 `lock.json`；与 apt 返回的校验和不符时停止。构建阶段只使用这些已校验的本地文件并禁网安装。依赖锁属于该批次，新批次可能解析到不同版本，因此跨批次不能直接拼接数据。RabbitMQ 的 Erlang 和编译依赖全部归依赖阶段。

## 三阶段与文件字段

1. **base**：原始 Ubuntu 固定镜像。
2. **dependencies**：安装锁定依赖；RabbitMQ 在这一阶段编译固定 Erlang。
3. **software**：只解包校验过的目标软件发行包；不再通过包管理器隐式引入其他依赖。

采集器由固定 SHA-256 的 [Python Build Standalone](https://github.com/astral-sh/python-build-standalone/releases/tag/20251014) 运行时启动，以只读挂载方式接入；不往目标镜像里安装采集工具。采集时根文件系统只读、禁网，输出流直接写到外部文件，不使用有限的控制台缓冲截断 JSONL。

全部路径均纳入，包括隐藏文件、文档、库、配置、目录、链接和特殊文件。每个路径记录：

- 路径、原始路径字节的 Base64、文件类型、dpkg 文件归属、引入阶段和发行包证明。
- 原始 mode、八进制权限、`rwx`、属主/组/其他用户权限、setuid/setgid/sticky。
- UID/GID、可解析的用户与组名、逻辑大小、分配块数、分配字节数及 I/O 块大小。
- 修改、访问、状态变更和支持时的创建时间，保留秒与纳秒；大整数用十进制字符串。
- inode、设备号、特殊设备主次编号、硬链接关联、软链接目标、解析结果与断链/循环状态。
- statx 属性与支持掩码、扩展属性原始 Base64、POSIX ACL 解码及 capabilities 原始值。
- 普通文件流式 SHA-256、字段支持情况及逐项采集错误。

先读元数据再哈希；不沿软链接递归，不读取设备、FIFO 或 socket 内容。读取前后校验 inode、大小和时间，发现文件变化时保留失败记录。遍历或哈希错误使该阶段 `complete=false`。文件系统不提供的字段记录不可用原因，不伪造为 0。

容器的实际挂载点从 `/proc/self/mountinfo` 读取，逐批记录到 `excludedMounts`：包括 `/proc`、`/sys`、`/dev`、Docker 注入的 hosts/resolver 文件及采集器挂载。案例产生的数据库、cookie 和临时文件只放运行阶段的 `/work`、`/tmp`，与安装快照分开。服务启动失败仍保留准备步骤的输出与退出码；MongoDB/RabbitMQ 原生日志末尾另存于 `logs/service.*.txt`，每个日志最多 1 MiB，不归档数据库文件或 cookie。

## 归属、差分与展示包

`files.base.jsonl`、`files.dependencies.jsonl`、`files.software.jsonl` 保存三个阶段的完整清单。`differences.jsonl` 保存两次阶段差分及完整前后记录，区分新增、删除、内容、权限、属主、链接和仅修改时间的变化；inode、访问时间和状态变更时间不用于软件归属判断。

目标软件中的每个普通文件须与发行包中的文件 SHA-256 对上，链接须与发行包声明一致。命令还必须位于配方声明的 bin/sbin 根目录、实际具有执行权限，且链接最终指向已证明的产品文件。系统、依赖、无法确认的文件保留分类；命令有文件证明不等于该命令的全部功能已经实测。

主数据由 Hello Docker 保存：

```text
software/<product>/recipe.json           固定配方
software/<product>/preview/              明确待采集的页面展示包
evidence/software/<product>/runs/<id>/   不可覆盖的真实采集历史
  run.json / recipe.json / lock.json
  files.<stage>.jsonl / differences.jsonl
  ownership.json / examples.json / steps.json / logs/
  site/manifest.json / site/runs/<id>/...
```

站点展示包含命令目录、五组案例、最终阶段文件元数据分块、目录索引和差异分块。每个文件带协议版本、采集 ID 和 SHA-256；导入前校验全部分块、数量、路径和批次，浏览器再次校验导入锁和已加载分块。目录按需读取，每页 50 项；原始文件内容、deb 和下载归档不进入站点包或采集历史。

`pending` 仅展示配方里的计划命令、参数及备注，不包含文件元数据、标准输出或退出码。其他批次必须带真实 Actions 来源；完整通过状态还要求三阶段完整、案例和断言全部通过、资源清理成功。

## 离线审阅与执行

从 Hello Docker 仓库根目录运行，以下命令不启动 Docker、不下载软件包：

```powershell
node bin/software-capture.mjs plan --product java
node bin/software-capture.mjs plan --product mongodb
node bin/software-capture.mjs plan --product rabbitmq
node --test tests/software.test.mjs
python3 tests/software-inventory.test.py
```

真正执行使用手动工作流 **Collect software files and command examples**，选择 `java`、`mongodb`、`rabbitmq` 或 `all`。宿主 runner 为 Ubuntu 24.04，目标容器为固定 Ubuntu 26.04；两者不混淆。工作流串行采集产品，只上传元数据、原始输出和展示包，没有提交、推送或自动发布步骤。

Java/MongoDB 预计每项 5–15 分钟；RabbitMQ 包含 Erlang 源码编译，预计 15–30 分钟。实际下载量为固定基础镜像、配方所列发行包、采集运行时与锁定依赖。远程触发前先审阅离线计划并确认资源范围。本地 `run` 明确拒绝执行。

## 归档与各站导入

下载对应 Actions 产物并定位包含 `run.json` 的目录后，先验证和归档；历史目录存在时拒绝覆盖。归档仅写本地文件，不执行 Git 提交或推送。

```powershell
node bin/software-capture.mjs verify --product java --source D:/captures/java
node bin/software-capture.mjs archive --product java --source D:/captures/java
node bin/software-capture.mjs import --product java --source D:/captures/java/site --target D:/projects/hello-lang
```

MongoDB 和 RabbitMQ 分别导入 `hello-sql`、`hello-mq`。目标站点只读取自身 `docs/public/docker-data/<product>/`，构建不要求本机存在 Hello Docker。导入后保留采集 ID、源提交和清单哈希，旧批次不删除。

原始历史经授权提交到 Docker 仓库后，可再次导入并加 `--data-revision <完整提交SHA>`。导入器核对该提交确实含有同一批次的原始 `run.json`，页面才生成固定提交下三个完整 JSONL 的下载链接；未提交前链接到对应 Actions 采集产物，不假装原始数据已经发布。

## 聚合工作区维护

公共视图源在聚合仓库的 `design/shared/docker-commands/`。在聚合仓库根目录运行 `node scripts/sync-docker-commands.mjs` 同步到 Lang/SQL/MQ；`--check` 只检查漂移。该同步是维护操作，三个项目的构建使用各自副本。
