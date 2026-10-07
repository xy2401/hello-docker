# Compose 服务与案例目录约定

每个服务目录独立使用自己的 Compose、说明和脚本，例如 [mongo-compose](mongo-compose/README.md)。在 hello-docker 仓库中运行命令，从 `compose/<服务目录>/` 启动；其他仓库采用这套约定时，命令从各自仓库说明的位置执行。

```text
<案例目录>/
├── README.md
├── meta.json
├── compose.yaml       # 需要容器服务时提供
├── source.json        # 来源追溯，可选
├── input/
├── output/
├── scripts/
└── data/              # 下载缓存，Git 忽略，按需创建
```

## 元数据与调用

`meta.json` 是唯一的案例清单。顶层使用 `schemaVersion`、`id`、`title`、`runtime`、`outputFormat`、`runScript` 和 `files`；有对应资源时声明 `compose`、`importScript`、`sourceManifest`、`summary`、`runtimeFiles` 和 `licenseFile`。路径均相对于 `meta.json` 所在目录，通过 HTTP 提供时也按该目录解析。

`files` 中每项至少声明 `id`、`title`、`input` 和 `output`。执行器只运行清单列出的输入，按清单顺序执行，输出写到声明的路径；目录中的其他文件不会自动加入执行。增加或调整案例时修改这一份清单。

`runtime` 决定采用的执行方式，`outputFormat` 声明结果格式。MongoDB 使用 `mongosh` 和 `mongodb-extended-json`，输入 `input/a.js` 对应 `output/a.js.json`。其他案例可声明文本、图片、Word 或 Excel 输出，使用各自的执行器，不要求统一为 JSON。

## 脚本与来源

连接、下载、数据准备、执行、验证和清理放在 `scripts/`。MongoDB 案例的 `rulesScript` 指向业务规则，`database`、`prepare`、`requires` 和 `parameters` 是该执行器使用的扩展字段；这些字段不要求其他技术的案例照搬。

输入只保留可以阅读和执行的业务语句，不混入路径、连接和输出处理。结果文件保存直接返回值，状态、日志、来源和校验记录单独放在汇总中。失败或跳过时不生成对应的成功结果文件。

`source.json` 记录上游仓库、固定提交、许可、源码哈希及输入与源码的映射，不包含数据库选择或数据准备规则。它可供文档和执行汇总追溯来源，缺失或无法解析时单独记录原因，不决定查询是否执行。

## 数据与启动

下载归档等大文件存放在 Git 忽略的 `data/`，首次需要时创建。数据库运行数据使用独立卷。Compose 可以用 `.:/workspace` 共享当前案例目录，具体服务按需选择挂载。复制案例时为容器名和端口选择各自的值，避免同时启动时冲突。
