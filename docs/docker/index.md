# Docker 架构与生命周期

Docker CLI 把操作交给 Engine。镜像构建、分发、容器创建和启动属于不同步骤；Compose 再描述多个服务之间的关系。

## 先建立对象关系

```text
Dockerfile + 构建上下文 → 镜像
镜像 + 命令 + 网络 + 挂载 → 容器
多个服务 + 依赖 + 项目网络 → Compose 项目
```

`create` 建立容器对象，`start` 启动已有容器，`run` 创建并启动新容器。停止后的容器仍可保留；移除容器不会自动移除它使用的命名卷。

## 一次实验需要记录什么

本项目先读取引擎版本，拉取固定 digest 的镜像，检查实际平台，再执行场景。单容器场景保留容器直到采集 inspect，最后移除本次创建的资源。日志里能区分镜像准备失败、程序失败和清理失败。

本机只查看计划：

```powershell
node bin/hello-docker.mjs plan --manifest scenarios/container-basics.json --shell powershell
```

实际执行入口在 [Actions 工作流](https://github.com/xy2401/hello-docker/actions/workflows/verify-docker.yml)。首次远程运行前，该场景保持[待验证状态](/evidence/container-basics)。

## 边界与下一步

Docker CLI 可以连接不同引擎上下文，bind mount 的路径由引擎所在主机解释。Windows/macOS 上的 Linux 容器需要相应后端；不能把主机系统版本当作容器用户态版本。

继续阅读[镜像构建](./build)、[Compose](./compose)和[诊断清理](./operations)。参考 [Docker 架构](https://docs.docker.com/get-started/docker-overview/)与 [docker run](https://docs.docker.com/reference/cli/docker/container/run/)。
