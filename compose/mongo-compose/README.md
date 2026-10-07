# Mongo Compose、官方样例与 MFlix 业务验证

先用 Compose 启动 MongoDB，再在容器内运行挂载的 Bash 脚本，一次完成下载、导入和查询验证。下载文件写入共享的 `data/` 目录。只启动服务不会自动下载样例。

## 启动与导入

以下命令从 hello-docker 仓库根目录执行，PowerShell 与 Bash 都可使用。

```bash
cd compose/mongo-compose

# 启动 MongoDB，共享当前服务目录
docker compose up -d

# 容器内执行 Bash：下载、导入全部样例库、查询验证
docker exec -u root hello-docker-mongo bash /workspace/scripts/import-samples.sh

# 执行 MFlix 业务语句，生成 input 对应的实际 output
docker exec hello-docker-mongo bash /workspace/scripts/run.sh

# 停止服务，保留数据库和下载文件
docker compose down
```

首次启动会拉取固定版本的 MongoDB 8.0 镜像。脚本最多等待 60 秒完成认证连接；镜像没有 curl 时，在容器内安装 curl 和 CA 证书。下载和导入可能需要数分钟，脚本出错时返回非零退出码。

MongoDB 连接地址为 `127.0.0.1:27017`，演示用户名 `root`、密码 `example`、认证库 `admin`。脚本读取 Compose 设置的账号环境变量。这些初始化变量只在空数据卷上创建账号，修改变量不会修改已有数据库中的账号。

## 共享目录与下载文件

Compose 只保留两个挂载：

```yaml
volumes:
  - mongo-data:/data/db
  - .:/workspace
```

`mongo-data` 保存 MongoDB 运行时的数据文件；`.:/workspace` 把当前服务目录整体共享到容器。`scripts/` 中的导入与验证入口、`input/`、`output/` 和来源清单都通过这一处共享目录访问，无需逐个挂载。脚本从脚本目录切换到服务目录，下载归档写入 `data/sampledata.archive`，执行结果写入 `output/`，都能在宿主机看到。宿主路径相对于 `compose.yaml` 所在目录解析。

脚本使用固定的官方地址：

```bash
S3_URL="https://atlas-education.s3.amazonaws.com/sampledata.archive"
```

归档约 380 MiB，下载到宿主机的 `data/sampledata.archive`，容器内对应 `/workspace/data/sampledata.archive`。下载先写入 `.part` 文件，成功后才改名；失败时清理临时文件并停止，不会继续导入。下次运行复用已下载的非空归档。项目的 `.gitignore` 已忽略 `/compose/*/data/`，下载文件和导出文件不会加入 Git。

仓库不附带归档文件。首次运行 `scripts/import-samples.sh` 时才会创建 `data/` 并下载；只启动 Compose 或执行 `scripts/run.sh` 不会下载。复用其他环境中已经导入的数据库，也不会自动把原始归档复制到当前服务目录。

## 导入与数据保留

脚本在容器内通过 `mongorestore --archive` 读取归档，并用 `--nsInclude='sample_*.*'` 导入全部样例库；此归档不需要 `--gzip`。完成后列出 `sample_` 开头的数据库，并查询 `sample_restaurants.restaurants` 的一条记录。

导入不添加 `--drop`，不会删除现有集合。**重复导入可能出现重复键**，脚本通过 `--stopOnError` 停止；导入失败前已写入的文档会保留，恢复过程不是事务。已有样例数据时，直接启动服务即可，不必再次运行导入脚本。

MongoDB 数据使用命名卷保存在 `/data/db`，与共享目录中的下载缓存分开。`docker compose down` 保留命名卷，再次 `up -d` 可以继续使用数据；`down -v` 会删除数据库卷，不用于日常停止。宿主机的归档文件不受普通停止影响。

排查启动或认证错误可以执行：

```bash
docker compose logs mongo
```

## Podman

安装并配置好 Podman 及其 Compose provider 后，使用同一份文件：

```bash
podman compose up -d
podman exec -u root hello-docker-mongo bash /workspace/scripts/import-samples.sh
podman exec hello-docker-mongo bash /workspace/scripts/run.sh
podman compose down
```

在启用 SELinux 的 Linux 主机上，如果共享目录访问被拒绝，将绑定挂载改为 `.:/workspace:Z`，再重新创建容器。

## MFlix 业务输入与生成结果

[input/](input/README.md) 包含从官方 `sample-app-nodejs-mflix` 整理的 22 个纯 MongoDB 表达式，覆盖查询、分页、单条/批量增删改、评论联结、年份与导演统计、文本索引及可选搜索。每个 `.js` 只有一个数据库操作，没有连接、加载或验证代码。来源提交、15 个业务入口和 21 处集合语句的逐条映射保存在 `source.json`。

`scripts/run.sh` 统一连接数据库、准备数据、执行表达式并验证结果。成功执行 `input/a.js` 后，直接生成 `output/a.js.json`，内容就是表达式返回的数组、文档、数量或写入结果，使用 Extended JSON 表示 ObjectId 和日期。状态、实际数据库版本、断言、来源 SHA-256 和清理记录另存到 `output/summary.json`；单项执行记录、日志和退出码放在 `output/.verification/`。

再次执行会更新同名结果；运行前清理本批次旧结果，失败或跳过的输入不生成成功结果文件。发生失败时停止后续项目、返回非零退出码，未执行项目列为 `not-run`。单项默认限时 120 秒，可通过 `MFLIX_CASE_TIMEOUT` 调整；同一个 `output/` 目录同时只允许一轮运行。

普通写入只操作本项新建的临时练习库，使用表达式中的创建数据或复制的真实电影记录，核对实际保存或删除的结果后清理。官方 `sample_mflix` 只读。单项进程超时后，汇总器依据本轮记录尝试清理本项创建的临时库；整个进程被强制终止或连接中断时仍可能需要检查汇总中的 `writeDatabase`，不按前缀批量删除数据库。

MongoDB Search 和 Vector Search 需要额外服务、索引与真实查询向量，默认记录为 `skipped`；普通 `$text` 查询仍可在当前 Compose 服务验证。启用条件和单独执行命令见 [源码分析](input/README.md)，已生成结果及验收范围见 [output/](output/README.md)。归档和查询向量放在 Git 忽略的 `data/`；`input/` 与可审阅的验证结果保存在仓库中。

## 提供给其他程序的元数据

[meta.json](meta.json) 提供本组示例的元数据，包含标题、运行方式、来源清单、许可及输入/输出路径。`schemaVersion` 为 `1`，`files` 按编号列出全部 22 个数据库表达式。清单中的所有路径相对于 `meta.json` 所在目录，单独检出 hello-docker 或通过 HTTP 提供这些文件时，都使用同一份清单。

每条记录包含 `id`、中文 `title`、`input`、对应的 `output`、实际 `operation` 和 `database`；需要准备数据、额外搜索能力或查询参数时，分别提供 `prepare`、`requires` 和 `parameters`。例如：

```json
{
  "id": "01-list-movies",
  "title": "电影筛选、排序与分页",
  "input": "input/01-list-movies.js",
  "output": "output/01-list-movies.js.json",
  "operation": "find",
  "database": "sample_mflix"
}
```

`meta.json` 是执行器读取的唯一案例清单，按 `files` 的顺序执行；未列入清单的文件不会自动运行。`database: "temporary"` 表示由调度器分配临时练习库，不是名为 `temporary` 的实际数据库。`prepare` 的准备步骤由 `rulesScript` 指向的 [mflix-rules.js](scripts/mflix-rules.js) 实现；`requires` 的 `search` / `vector-search` 对应上文的启用条件，向量查询额外声明 `parameters: ["queryVector"]`。调用者使用 `runScript` 指向的 Bash 入口执行完整练习。

清单顶层还列出 Compose 文件、导入入口、执行入口、来源清单、汇总路径、`rulesScript` 业务规则、`runtimeFiles` 调度依赖及 `licenseFile` 许可文件。调用者可以据此展示标题、加载纯查询文本和读取同名 JSON；结果是否存在及其执行状态，以 `summary` 指向的 `output/summary.json` 为准。失败、跳过或尚未执行时，对应输出可能不存在，清单本身不保存会过期的运行状态。

`source.json` 只记录来源与源码映射，不包含执行配置；运行单项查询不读取它。汇总器按 `sourceManifest` 补充追溯信息，缺失或解析失败时记录 `provenance.status`，不影响查询执行状态。执行结果核对 `meta.json`、输入和所有运行依赖的哈希，汇总及单项验证记录使用 `schemaVersion: 3`，原始结果 JSON 的格式保持一致。

目录职责及其他技术如何声明输出格式，见 [案例目录约定](../README.md)。

本地 Node.js 程序可这样读取：

```js
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('compose/mongo-compose/meta.json');
const baseDir = path.dirname(manifestPath);
const catalog = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const item = catalog.files.find(file => file.id === '01-list-movies');
const query = fs.readFileSync(path.join(baseDir, item.input), 'utf8');
const result = JSON.parse(fs.readFileSync(path.join(baseDir, item.output), 'utf8'));
```

通过 HTTP 读取时，用 `new URL(item.input, manifestUrl)` 和 `new URL(item.output, manifestUrl)` 解析路径；`manifestUrl` 是 `meta.json` 的实际完整 URL。新增、删除或重命名输入时，应同步更新元数据及对应的来源映射。
