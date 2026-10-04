# 公共工具与项目接入

Hello Docker 提供公共执行机制和证据协议，各项目继续拥有业务源码、配置与断言。一个采集结果必须同时回答“运行了什么”“在哪运行”“依据什么判定成功”。

## 本地与 Actions 的分工

| 本地 | GitHub Actions |
| --- | --- |
| 编辑手册、清单和实验配置 | 准备固定镜像和引擎环境 |
| 校验协议与路径 | 构建、运行、断言与清理 |
| 生成命令计划 | 保存原始日志和结构化结果 |
| 使用替身进程测试工具 | 校验证据、构建文档并自动回写 |

本地 CLI 不要求 Docker。`run` 与 `publish-evidence` 只允许在 Linux Actions 环境中调用。

## 公共接口

```powershell
node bin/hello-docker.mjs check-manifest --manifest scenarios/image-build.json
node bin/hello-docker.mjs plan --manifest scenarios/image-build.json --shell powershell
```

Actions 还会调用 `run`、`check-evidence`、`render-evidence` 和 `publish-evidence`。`action.yml` 封装检查、执行与渲染步骤，调用方负责提供 Node.js 22、上传 Artifact 和所属仓库的发布任务。

## 接入顺序

先定义一个小场景和明确断言，再做离线检查。发布公共工具后固定完整提交 SHA，在所属项目手动工作流中检出并调用。首轮验证成功，再评估是否扩大覆盖范围。

详见[场景协议](./protocol)、[Actions 流程](./actions)和[五个项目的接入路线](./projects)。
