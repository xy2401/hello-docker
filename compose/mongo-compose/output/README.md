# 数据库语句的直接结果

每个成功执行的输入对应一个同名 JSON 文件，例如：

```text
input/01-list-movies.js → output/01-list-movies.js.json
input/04-insert-one.js  → output/04-insert-one.js.json
```

JSON 只保存表达式直接返回的值。`find(...).toArray()` 和 `aggregate(...).toArray()` 返回数组；`findOne` 返回文档；计数返回数字；增删改返回数据库确认与数量；创建索引返回名称。ObjectId、日期采用 MongoDB Extended JSON，数字使用普通 JSON 数值。

状态、来源提交、输入/输出哈希、断言和清理信息单独保存在 [summary.json](summary.json)，单项记录及日志位于 `.verification/`。失败、跳过或未执行的输入没有对应的成功结果文件；再次运行会更新本批次同名文件。

当前汇总与单项记录使用 `schemaVersion: 3`，绑定 `meta.json` 和全部运行依赖的哈希。`meta.json` 是唯一执行清单；`source.json` 的来源信息记录在 `provenance` 中，缺失或损坏时单独标记，不改变查询执行状态。

## 真实验证

2026-10-07 在 WSL Ubuntu-26.04 中复用已有 Podman 容器 `mongo-demo`，MongoDB 7.0.43、mongosh 2.12.0，实际执行本组纯语句：

| 项目 | 结果 |
| --- | --- |
| 输入表达式 | 22 个，来源覆盖上游 15 个业务入口和 21 处集合调用 |
| 通过 / 失败 / 跳过 / 未执行 | 20 / 0 / 2 / 0 |
| 成功生成结果文件 | 20 个同名 `.js.json` |
| 跳过项 | `15-search-movies.js`、`16-vector-search.js`，额外搜索条件未启用 |
| 样例库数量 | 执行前后均为 21,349 部电影、41,079 条评论 |
| 本批次临时数据库 | 验证后全部清理 |

可以查看 [查询列表](01-list-movies.js.json)、[插入结果](04-insert-one.js.json)、[最新评论](12-comments-report.js.json)、[年份统计](13-year-report.js.json) 和 [索引列表](18-list-indexes.js.json)。每项都是直接结果，没有验证信息外层包装。年份统计得到 108 个年份分组、21,314 条数值年份电影，数量与包含非数值年份的样例库总数不同。

Compose 镜像仍固定为 MongoDB 8.0；本轮使用现有 7.0.43 容器，没有拉取镜像或重新下载样例归档。本次把脚本复制进现有容器，再将结果复制回宿主机；按 Compose 文件启动时，`output/` 通过绑定挂载直接共享。这轮结果不表示完成了 MongoDB 8.0 或额外搜索环境的运行验收。

补充回归确认：按元数据调整执行顺序，未列入清单的输入不会运行；来源文件缺失或 JSON 损坏仍可生成查询结果；增删改失败时停止后续案例、清理本项临时库且不生成成功结果。回归数据和日志保存在 Git 忽略的 `.artifacts/mflix-meta-fixtures/`，未混入这里的成功查询结果。

## 状态含义

- `passed`：表达式实际执行，并通过独立的结果验证和临时库清理。
- `failed`：执行、断言、超时、来源核对或清理失败；保留单独日志。
- `skipped`：额外服务、索引或真实查询向量未启用，未执行对应表达式。
- `not-run`：前项失败，或进程未执行。

原来的包装式结果及时间子目录已移到 Git 忽略的 `.artifacts/mflix-wrapped-v1/` 留存。当前结果只代表汇总中记录的输入和调度版本；修改输入后应重新执行生成。
