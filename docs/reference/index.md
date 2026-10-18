# 📚 参考资料

容器标准、产品文档和本项目验证协议的统一入口。按要解决的问题选择资料，并将文档版本与实际引擎、镜像和集群环境对应起来。

## 官方文档与规范

| 资料 | 优先查阅的问题 | 本站对应章节 |
| --- | --- | --- |
| [Docker 架构](https://docs.docker.com/get-started/docker-overview/) | 客户端、引擎、镜像与容器的关系 | [Docker](/docker/) |
| [Docker Build](https://docs.docker.com/build/) | Dockerfile、构建上下文、缓存与多阶段构建 | [镜像构建](/docker/build) |
| [Docker Compose](https://docs.docker.com/compose/) | 多服务、网络、卷与项目生命周期 | [Compose](/docker/compose) |
| [Podman 文档](https://docs.podman.io/en/latest/) | 容器操作、rootless、Machine 与系统集成 | [Podman](/podman/) |
| [Kubernetes 总览](https://kubernetes.io/docs/concepts/overview/) | 期望状态、对象与持续协调 | [Kubernetes](/kubernetes/) |
| [OCI Image Specification](https://github.com/opencontainers/image-spec) | 镜像内容、配置、清单与层的格式 | [镜像与存储](/concepts/images-storage) |
| [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec) | 容器配置、执行环境与生命周期约定 | [容器基础](/concepts/) |

需要比较这些工具的工作层次时，先看 [⚖️ 对比矩阵](/matrix/)；需要扩大到构建、分发和配置工具时，继续阅读[生态地图](/ecosystem/)与[按需求选工具](/ecosystem/selection)。

## 本站实践入口

| 目标 | 阅读入口 |
| --- | --- |
| 理解进程隔离、资源与权限 | [隔离与资源](/concepts/isolation) |
| 排查容器间与宿主机的访问路径 | [网络与服务发现](/concepts/network) |
| 学习容器日志、诊断与清理 | [Docker 操作](/docker/operations) |
| 配置普通用户环境与虚拟机后端 | [Rootless 与 Machine](/podman/rootless) |
| 配置 Linux 系统服务 | [Quadlet](/podman/quadlet) |
| 观察集群对象与排错路径 | [Kubernetes 最小实验](/kubernetes/lab) |
| 查看场景配置与命令文本 | [🧪 实验台](/playground/) |

## 复现与证据协议

清单字段、来源路径、镜像锁和业务断言见[场景协议](/support/protocol)。执行、清理、日志采集与自动回写规则见 [Actions 流程](/support/actions)；各项目与公共工具的分工见[项目接入路线](/support/projects)。

从 hello-docker 仓库根目录可以先做离线清单检查与计划生成：

```powershell
node bin/hello-docker.mjs check-manifest --manifest scenarios/container-basics.json
node bin/hello-docker.mjs plan --manifest scenarios/container-basics.json --shell powershell
```

这些命令用于检查配置和生成计划。实际运行的引擎版本、镜像 digest、平台、退出码、断言和清理记录，应从[验证证据](/evidence/)对应场景读取；尚未采集的项目以页面标注为准。

资料入口核对日期：2026-10-18。复现旧场景时，请优先匹配所记录的工具版本与镜像锁，再查阅对应版本的官方说明。
