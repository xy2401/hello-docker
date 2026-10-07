# MFlix 纯数据库语句

每个 `.js` 文件只包含**一个 MongoDB 操作表达式**，例如：

```js
db.movies.find({ year: 2000 }).limit(5).toArray();
```

输入没有 `load`、环境变量、路径拼接、异步包装、辅助函数、断言或输出代码。连接、准备数据、捕获返回值、验证、清理和 JSON 序列化统一由 [run.sh](../scripts/run.sh) 与 `scripts/` 中的调度代码处理。文件中的注释保留上游来源与许可。

## 输入与结果一一对应

成功执行 `input/01-list-movies.js` 后，直接生成 `output/01-list-movies.js.json`。结果文件保存该表达式的实际返回值：数组、文档、数量、写入结果或索引名称，不附加 `result`、`status` 等外层对象。MongoDB 的 ObjectId、日期使用 Extended JSON 表示。

执行失败或必要条件未启用时，不生成该文件的成功结果；原因记录在 `output/summary.json`，详细执行记录和日志放在 `output/.verification/`。再次运行会更新同名结果，并清除本批次上一次的结果，避免把旧结果当作本次执行结果。

## 官方源码与语句映射

来源为 MongoDB 官方 [sample-app-nodejs-mflix](https://github.com/mongodb/sample-app-nodejs-mflix)，固定提交 [`1f7dcdba04f6212a5fd4842135973e28a0a2d741`](https://github.com/mongodb/sample-app-nodejs-mflix/tree/1f7dcdba04f6212a5fd4842135973e28a0a2d741)。完整检出用于分析，保存在本仓库被 Git 忽略的 `.artifacts/sample-app-nodejs-mflix/`；运行这些表达式不依赖上游应用或其 npm 依赖。

上游后端共 15 个业务入口、21 处集合调用，逐条表达式、文件、行号及来源 SHA-256 记录在 [source.json](../source.json)。拆开插入/更新后的读取和索引操作，再为列表查询补充一个 `$text` 示例，共得到 22 个纯表达式。

| 输入文件 | 原业务函数 | 表达式含义 |
| --- | --- | --- |
| `00-movie-count.js` | `verifyMoviesCollection` | `estimatedDocumentCount` 读取电影数量 |
| `01-list-movies.js` | `getAllMovies` | 按类别、年份、评分查询，排序分页 |
| `02-distinct-genres.js` | `getDistinctGenres` | `distinct('genres')` 返回类别值 |
| `03-find-movie.js` | `getMovieById` | 按真实样例电影 ObjectId 读取详情 |
| `04-insert-one.js` | `createMovie` | `insertOne` 创建一部电影 |
| `05-insert-many.js` | `createMoviesBatch` | `insertMany` 批量创建电影 |
| `06-update-one.js` | `updateMovie` | `updateOne` 与 `$set` 修改标题和年份 |
| `07-update-many.js` | `updateMoviesBatch` | `_id.$in` 筛选，`updateMany` 批量修改 |
| `08-delete-one.js` | `deleteMovie` | `deleteOne` 删除指定电影 |
| `09-delete-many.js` | `deleteMoviesBatch` | `deleteMany` 删除指定 ID 列表 |
| `10-find-one-and-delete.js` | `findAndDeleteMovie` | 原子返回并删除指定电影 |
| `11-text-search.js` | `getAllMovies` | 普通文本索引配合 `$text` 查询 |
| `12-comments-report.js` | `getMoviesWithMostRecentComments` | 联结评论、获取最新评论并统计数量 |
| `13-year-report.js` | `getMoviesByYearWithStats` | 按年份统计电影数、评分与票数 |
| `14-director-report.js` | `getDirectorsWithMostMovies` | 展开导演数组，按作品数排名 |
| `15-search-movies.js` | `searchMovies` | `$search` 组合查询和 `$facet` 计数分页 |
| `16-vector-search.js` | `vectorSearchMovies` | 检索 `embedded_movies`，返回 ID 和相似度 |
| `17-vector-hydration.js` | `vectorSearchMovies` | 通过 ID 到 `movies` 补全电影字段 |
| `18-list-indexes.js` | `createTextSearchIndex` | `getIndexes` 列出索引 |
| `19-text-index.js` | `createTextSearchIndex` | 创建普通文本索引 |
| `20-find-created-movie.js` | `createMovie` | 单独读取已创建的电影 |
| `21-find-updated-movie.js` | `updateMovie` | 单独读取已更新的电影 |

Node.js 驱动的 `listIndexes().toArray()` 转为 mongosh 的 `getIndexes()`；`existingIndexes.find(...)` 是 JavaScript 数组方法，不计作数据库调用。原始 HTTP 参数转换与字段约束放在调度代码及源码分析中，输入直接给出可读的筛选条件和数据。

## 查询与聚合分析

列表查询使用不区分大小写的类别正则、数值年份、评分 `$gte` / `$lte`，按标题升序取五条；`11` 独立演示 `$text`。原 HTTP 程序还会转义用户输入的正则字符、限制分页大小等，这些参数处理不混入纯语句文件。

评论报表保留数值年份过滤、`$lookup` 联结 `comments.movie_id`、排除空评论、`$sortArray` 倒序日期与 `$slice`、排序、限制和字段投影。输入指定真实样例中的《A Corner in Wheat》，最多三条最新评论。

年份报表只统计数值年份，保留上游对 BSON `double` 评分的类型判断及非空判断，再计算平均/最高/最低评分、票数并排序。导演报表排除空导演和无效年份，依次 `$unwind`、`$group`、排序并取前五名。

向量业务原本包含两次集合查询。这里将检索与电影补全分别放进 `16`、`17`；补全语句使用三个具体的真实样例 ID，并保留年份只能是 BSON `int`、否则返回 `null` 的投影规则。它可以独立验证电影补全，不代表向量检索已执行。

## 执行方式与练习库

从 hello-docker 仓库根目录执行；已导入样例数据时省略导入命令：

```bash
cd compose/mongo-compose
docker compose up -d
docker exec -u root hello-docker-mongo bash /workspace/scripts/import-samples.sh
docker exec hello-docker-mongo bash /workspace/scripts/run.sh
```

Podman 使用相同文件，将命令里的 `docker` 换成 `podman`。调度器按 [meta.json](../meta.json) 选择并排序输入；只读语句使用 `sample_mflix`，增删改、文本查询练习及索引创建使用本项新建的 `hello_case_validation_<ObjectId>` 临时数据库。数据准备与结果断言由 [mflix-rules.js](../scripts/mflix-rules.js) 实现，执行后清理该临时库。来源文件只用于追溯。

修改和删除练习的准备数据来自真实样例电影的复制件；创建练习的数据直接写在 `insertOne` / `insertMany` 表达式中。`20` 的准备步骤执行 `04`，`21` 的准备步骤复制记录后执行 `06`，每个输入仍保持一个操作表达式。

只读文件也能直接粘贴到已经选择 `sample_mflix` 的 mongosh 会话。自行执行增删改文件时，需要先选择练习数据库并准备对应数据；统一 Bash 入口会处理这些步骤。mongosh 提供 `db`、`ObjectId` 等对象，普通 `node 文件.js` 不能执行这些数据库表达式。

## 搜索与查询约束

`15` 需要 MongoDB Search 和 `sample_mflix.movies` 的 `movieSearchIndex`；通过容器执行时传入 `MFLIX_ENABLE_SEARCH=1` 才会执行。普通 `text_search_index` 支持 `$text`，不会替代 `$search` 所需的索引。

`16` 需要 Vector Search、`embedded_movies` 数据及 `vector_index`，向量字段为 `plot_embedding_voyage_3_large`。输入本身只保留带 `queryVector` 参数的数据库表达式。调度器从 `MFLIX_QUERY_VECTOR_FILE` 指定的 JSON 中提供这个参数；文件须包含 `model: "voyage-3-large"`、查询文本 `query` 和 2048 个真实有限数值组成的 `embedding` 数组，且设置 `MFLIX_ENABLE_VECTOR_SEARCH=1`。建议真实向量文件放在 Git 忽略的 `data/` 中。脚本不会调用 Voyage API，也不会生成随机向量用于验收。

未启用额外搜索条件时，`15`、`16` 记录为 `skipped`，没有对应的结果文件。`MFLIX_MONGODB_URI` 可指定已有连接环境；默认连接容器内 localhost 并读取初始化账号环境变量，所有连接逻辑都在调度器中。

上游 `mongoQuery.ts` 的正则转义、字段/操作符白名单和 ObjectId 转换保存在 `scripts/query-utils.js`；统一调度器单独核对有效输入与代表性的拒绝分支，将验证记录放进汇总。这些 JavaScript 校验不作为数据库语句输入或数据库返回数据。

Express 路由、响应封装、中间件、Next.js 界面以及 Voyage HTTP 请求属于完整应用的行为，未包含在这些纯数据库语句的运行验证中。来源为 Apache-2.0，许可见 [LICENSE](LICENSE)。
