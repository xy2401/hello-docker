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

`input/` 包含从官方 `sample-app-nodejs-mflix` 整理的 22 个纯 MongoDB 表达式，覆盖查询、分页、单条/批量增删改、评论联结、年份与导演统计、文本索引及可选搜索。每个文件只包含一个数据库操作表达式，例如：

```js
db.movies.find({ year: 2000 }).limit(5).toArray();
```

输入没有 `load`、环境变量、路径拼接、异步包装、辅助函数、断言或输出代码。连接、准备数据、捕获返回值、验证、清理和 JSON 序列化统一由 [run.sh](scripts/run.sh) 与 `scripts/` 中的调度代码处理。文件中的注释保留上游来源与许可。

### 官方源码与语句映射

来源为 MongoDB 官方 [sample-app-nodejs-mflix](https://github.com/mongodb/sample-app-nodejs-mflix)，固定提交 [`1f7dcdba04f6212a5fd4842135973e28a0a2d741`](https://github.com/mongodb/sample-app-nodejs-mflix/tree/1f7dcdba04f6212a5fd4842135973e28a0a2d741)。完整检出用于分析，保存在本仓库被 Git 忽略的 `.artifacts/sample-app-nodejs-mflix/`；运行这些表达式不依赖上游应用或其 npm 依赖。

上游后端共 15 个业务入口、21 处集合调用，逐条表达式、文件、行号及来源 SHA-256 记录在 [source.json](source.json)。拆开插入/更新后的读取和索引操作，再为列表查询补充一个 `$text` 示例，共得到 22 个纯表达式。

| 输入文件 | 原业务函数 | 表达式含义 |
| --- | --- | --- |
| [00-movie-count.js](input/00-movie-count.js) | `verifyMoviesCollection` | `estimatedDocumentCount` 读取电影数量 |
| [01-list-movies.js](input/01-list-movies.js) | `getAllMovies` | 按类别、年份、评分查询，排序分页 |
| [02-distinct-genres.js](input/02-distinct-genres.js) | `getDistinctGenres` | `distinct('genres')` 返回类别值 |
| [03-find-movie.js](input/03-find-movie.js) | `getMovieById` | 按真实样例电影 ObjectId 读取详情 |
| [04-insert-one.js](input/04-insert-one.js) | `createMovie` | `insertOne` 创建一部电影 |
| [05-insert-many.js](input/05-insert-many.js) | `createMoviesBatch` | `insertMany` 批量创建电影 |
| [06-update-one.js](input/06-update-one.js) | `updateMovie` | `updateOne` 与 `$set` 修改标题和年份 |
| [07-update-many.js](input/07-update-many.js) | `updateMoviesBatch` | `_id.$in` 筛选，`updateMany` 批量修改 |
| [08-delete-one.js](input/08-delete-one.js) | `deleteMovie` | `deleteOne` 删除指定电影 |
| [09-delete-many.js](input/09-delete-many.js) | `deleteMoviesBatch` | `deleteMany` 删除指定 ID 列表 |
| [10-find-one-and-delete.js](input/10-find-one-and-delete.js) | `findAndDeleteMovie` | 原子返回并删除指定电影 |
| [11-text-search.js](input/11-text-search.js) | `getAllMovies` | 普通文本索引配合 `$text` 查询 |
| [12-comments-report.js](input/12-comments-report.js) | `getMoviesWithMostRecentComments` | 联结评论、获取最新评论并统计数量 |
| [13-year-report.js](input/13-year-report.js) | `getMoviesByYearWithStats` | 按年份统计电影数、评分与票数 |
| [14-director-report.js](input/14-director-report.js) | `getDirectorsWithMostMovies` | 展开导演数组，按作品数排名 |
| [15-search-movies.js](input/15-search-movies.js) | `searchMovies` | `$search` 组合查询和 `$facet` 计数分页 |
| [16-vector-search.js](input/16-vector-search.js) | `vectorSearchMovies` | 检索 `embedded_movies`，返回 ID 和相似度 |
| [17-vector-hydration.js](input/17-vector-hydration.js) | `vectorSearchMovies` | 通过 ID 到 `movies` 补全电影字段 |
| [18-list-indexes.js](input/18-list-indexes.js) | `createTextSearchIndex` | `getIndexes` 列出索引 |
| [19-text-index.js](input/19-text-index.js) | `createTextSearchIndex` | 创建普通文本索引 |
| [20-find-created-movie.js](input/20-find-created-movie.js) | `createMovie` | 单独读取已创建的电影 |
| [21-find-updated-movie.js](input/21-find-updated-movie.js) | `updateMovie` | 单独读取已更新的电影 |

Node.js 驱动的 `listIndexes().toArray()` 转为 mongosh 的 `getIndexes()`；`existingIndexes.find(...)` 是 JavaScript 数组方法，不计作数据库调用。原始 HTTP 参数转换与字段约束放在调度代码及源码分析中，输入直接给出可读的筛选条件和数据。

### 查询与聚合分析

列表查询使用不区分大小写的类别正则、数值年份、评分 `$gte` / `$lte`，按标题升序取五条；`11` 独立演示 `$text`。原 HTTP 程序还会转义用户输入的正则字符、限制分页大小等，这些参数处理不混入纯语句文件。

评论报表保留数值年份过滤、`$lookup` 联结 `comments.movie_id`、排除空评论、`$sortArray` 倒序日期与 `$slice`、排序、限制和字段投影。输入指定真实样例中的《A Corner in Wheat》，最多三条最新评论。

年份报表只统计数值年份，保留上游对 BSON `double` 评分的类型判断及非空判断，再计算平均/最高/最低评分、票数并排序。导演报表排除空导演和无效年份，依次 `$unwind`、`$group`、排序并取前五名。

向量业务原本包含两次集合查询。这里将检索与电影补全分别放进 `16`、`17`；补全语句使用三个具体的真实样例 ID，并保留年份只能是 BSON `int`、否则返回 `null` 的投影规则。它可以独立验证电影补全，不代表向量检索已执行。

### 执行方式与练习库

按开头的启动与导入命令运行；已有样例数据时省略导入步骤。执行器按 [meta.json](meta.json) 选择并排序输入，只读语句使用 `sample_mflix`；增删改、文本查询练习及索引创建使用本项新建的 `hello_case_validation_<ObjectId>` 临时数据库。数据准备与结果断言由 [mflix-rules.js](scripts/mflix-rules.js) 实现，核对结果后清理该临时库。来源文件只用于追溯。

修改和删除练习的准备数据来自真实样例电影的复制件；创建练习的数据直接写在 `insertOne` / `insertMany` 表达式中。`20` 的准备步骤执行 `04`，`21` 的准备步骤复制记录后执行 `06`，每个输入仍保持一个操作表达式。

只读文件也能直接粘贴到已经选择 `sample_mflix` 的 mongosh 会话。自行执行增删改文件时，需要先选择练习数据库并准备对应数据；统一 Bash 入口会处理这些步骤。mongosh 提供 `db`、`ObjectId` 等对象，普通 `node 文件.js` 不能执行这些数据库表达式。

官方 `sample_mflix` 只读。单项进程超时后，汇总器依据本轮记录尝试清理本项创建的临时库；整个进程被强制终止或连接中断时仍可能需要检查汇总中的 `writeDatabase`，不按前缀批量删除数据库。

再次执行会更新同名结果；运行前清理本批次旧结果，失败或跳过的输入不生成成功结果文件。发生失败时停止后续项目、返回非零退出码，未执行项目列为 `not-run`。单项默认限时 120 秒，可通过 `MFLIX_CASE_TIMEOUT` 调整；同一个 `output/` 目录同时只允许一轮运行。

### 搜索与查询约束

`15` 需要 MongoDB Search 和 `sample_mflix.movies` 的 `movieSearchIndex`；通过容器执行时传入 `MFLIX_ENABLE_SEARCH=1` 才会执行。普通 `text_search_index` 支持 `$text`，不会替代 `$search` 所需的索引。

`16` 需要 Vector Search、`embedded_movies` 数据及 `vector_index`，向量字段为 `plot_embedding_voyage_3_large`。输入本身只保留带 `queryVector` 参数的数据库表达式。调度器从 `MFLIX_QUERY_VECTOR_FILE` 指定的 JSON 中提供这个参数；文件须包含 `model: "voyage-3-large"`、查询文本 `query` 和 2048 个真实有限数值组成的 `embedding` 数组，且设置 `MFLIX_ENABLE_VECTOR_SEARCH=1`。建议真实向量文件放在 Git 忽略的 `data/` 中。脚本不会调用 Voyage API，也不会生成随机向量用于验收。

未启用额外搜索条件时，`15`、`16` 记录为 `skipped`，没有对应的结果文件。`MFLIX_MONGODB_URI` 可指定已有连接环境；默认连接容器内 localhost 并读取初始化账号环境变量，所有连接逻辑都在调度器中。

上游 `mongoQuery.ts` 的正则转义、字段/操作符白名单和 ObjectId 转换保存在 `scripts/query-utils.js`；统一调度器单独核对有效输入与代表性的拒绝分支，将验证记录放进汇总。这些 JavaScript 校验不作为数据库语句输入或数据库返回数据。

Express 路由、响应封装、中间件、Next.js 界面以及 Voyage HTTP 请求属于完整应用的行为，未包含在这些纯数据库语句的运行验证中。来源为 Apache-2.0，许可见 [LICENSE](input/LICENSE)。

归档和查询向量放在 Git 忽略的 `data/`；`input/` 与可审阅的验证结果保存在仓库中。

### 直接结果与状态

成功执行 `input/a.js` 后，直接生成 `output/a.js.json`，例如：

```text
input/01-list-movies.js → output/01-list-movies.js.json
input/04-insert-one.js  → output/04-insert-one.js.json
```

JSON 只保存表达式直接返回的值。`find(...).toArray()` 和 `aggregate(...).toArray()` 返回数组；`findOne` 返回文档；计数返回数字；增删改返回数据库确认与数量；创建索引返回名称。结果不附加 `result`、`status` 等外层对象，ObjectId、日期采用 MongoDB Extended JSON，数字使用普通 JSON 数值。

状态、实际数据库版本、来源、输入/输出哈希、断言和清理信息单独保存在 [output/summary.json](output/summary.json)，单项记录、日志和退出码位于 `output/.verification/`。

- `passed`：表达式实际执行，并通过独立的结果验证和临时库清理。
- `failed`：执行、断言、超时、执行配置校验或清理失败；保留单独日志。
- `skipped`：额外服务、索引或真实查询向量未启用，未执行对应表达式。
- `not-run`：前项失败，或进程未执行。

原来的包装式结果及时间子目录已移到 Git 忽略的 `.artifacts/mflix-wrapped-v1/` 留存。当前结果只代表汇总中记录的输入和调度版本；修改输入后应重新执行生成。

### 真实验证

2026-10-07 在 WSL Ubuntu-26.04 中复用已有 Podman 容器 `mongo-demo`，MongoDB 7.0.43、mongosh 2.12.0，实际执行本组纯语句：

| 项目 | 结果 |
| --- | --- |
| 输入表达式 | 22 个，来源覆盖上游 15 个业务入口和 21 处集合调用 |
| 通过 / 失败 / 跳过 / 未执行 | 20 / 0 / 2 / 0 |
| 成功生成结果文件 | 20 个同名 `.js.json` |
| 跳过项 | `15-search-movies.js`、`16-vector-search.js`，额外搜索条件未启用 |
| 样例库数量 | 执行前后均为 21,349 部电影、41,079 条评论 |
| 本批次临时数据库 | 验证后全部清理 |

可以查看 [查询列表](output/01-list-movies.js.json)、[插入结果](output/04-insert-one.js.json)、[最新评论](output/12-comments-report.js.json)、[年份统计](output/13-year-report.js.json) 和 [索引列表](output/18-list-indexes.js.json)。每项都是直接结果，没有验证信息外层包装。年份统计得到 108 个年份分组、21,314 条数值年份电影，数量与包含非数值年份的样例库总数不同。

Compose 镜像仍固定为 MongoDB 8.0；本轮使用现有 7.0.43 容器，没有拉取镜像或重新下载样例归档。本次把脚本复制进现有容器，再将结果复制回宿主机；按 Compose 文件启动时，`output/` 通过绑定挂载直接共享。这轮结果不表示完成了 MongoDB 8.0 或额外搜索环境的运行验收。

补充回归确认：按元数据调整执行顺序，未列入清单的输入不会运行；来源文件缺失或 JSON 损坏仍可生成查询结果；增删改失败时停止后续案例、清理本项临时库且不生成成功结果。回归数据和日志保存在 Git 忽略的 `.artifacts/mflix-meta-fixtures/`，未混入这里的成功查询结果。

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
