# 场景协议与证据

场景清单采用 JSON，`schemaVersion: 1`。它声明可复现输入和业务期望，执行结果由独立产物记录。

## 必要字段

| 字段 | 含义 |
| --- | --- |
| `id` / `title` | 稳定场景标识和中文标题 |
| `kind` | `container`、`build` 或 `compose` |
| `platform` / `timeoutMs` | 首批为 Linux amd64；总执行时限 |
| `images` | 直接 digest 引用，或 `.env.versions` 文件与键名 |
| `command` / `build` / `compose` | 对应类型的执行配置 |
| `mounts` | 首批只读源码挂载 |
| `assertions` | stdout/stderr 的 `includes` 或 `equals` 断言 |
| `output` | 指定证据目录与生成页面 |

查看真实示例可进入[复现助手](/playground/)。命令使用 argv 数组，不通过主机 Shell 拼接执行。版本 1 有意限制挂载和 Compose 资源声明；扩展服务能力需要新增明确协议与测试。

## 成功条件

引擎连接、镜像平台与 digest 检查、构建或运行、业务断言和资源清理均成功，才能产生通过结果。执行后再次检查输入哈希，避免采集过程中源码变化。

退出码零不自动代表业务成功。替身进程结果带 `execution: fixture`，不能通过发布校验。

## 证据结构

`result.json` 保存 source SHA、tool SHA、工作流 URL、时间、镜像、引擎、断言及源码/文件哈希。stdout、stderr 和步骤日志独立保存；兼容快照只有一组 frontmatter。

每次成功回写同时保留 `runs/<runId>-<resourceId>/` 的独立快照；目录根部保存最近一次结果。下载 Artifact 后可在相同源码字节上校验，runner 的绝对路径会转换为项目相对路径比较。

`check-evidence` 校验当前清单、源码、原始输出和断言。后续改动源码会使旧证据失去对当前输入的适用性，但不会重写其采集时间或来源。

## 旧证据如何处理

既有 `.out.txt` 保留在原目录，作为历史结果展示，不伪造缺失的运行 ID 或 SHA。新试点写入 `docker-pilot/`；已有目录与断言不被覆盖。
