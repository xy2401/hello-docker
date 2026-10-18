# ⚖️ 对比矩阵

按容器管理、应用配置与集群协调的职责比较工具，再确定需要验证的场景。先看工作层次，可以明确哪些工具可用于相似任务，哪些工具需要配合使用。

## 容器管理与应用协调

| 路径 | 主要职责 | 操作对象 | 适合观察的问题 | 本站入口 |
| --- | --- | --- | --- | --- |
| Docker Engine | 通过客户端与引擎管理镜像、容器、网络和卷 | 单个容器及其资源 | 创建与启动、挂载、日志和清理 | [Docker](/docker/) |
| Podman | 管理 OCI 镜像、容器与 pods，支持 rootless 使用方式 | 容器、pod 与相关资源 | 用户权限、网络、存储和系统服务集成 | [Podman](/podman/) |
| Docker Compose | 用应用配置组织服务、网络与卷 | 多服务项目 | 服务依赖、健康检查与项目生命周期 | [Compose](/docker/compose) |
| Kubernetes | 持续协调对象的期望状态与实际状态 | Pod、Deployment、Service 等对象 | 调度、控制器、滚动更新与故障恢复 | [Kubernetes](/kubernetes/) |

职责依据 [Docker 架构](https://docs.docker.com/get-started/docker-overview/)、[Podman 文档](https://docs.podman.io/en/latest/)、[Docker Compose](https://docs.docker.com/compose/)和 [Kubernetes 总览](https://kubernetes.io/docs/concepts/overview/)。比较 Compose 与 Kubernetes 时，应分别记录应用配置和持续协调的语义；相似字段或命令名称不能替代实际场景验证。

## 输入与状态管理

| 维度 | Docker / Podman 容器操作 | Compose 项目 | Kubernetes 应用 |
| --- | --- | --- | --- |
| 主要输入 | 镜像、启动命令、环境变量、网络和挂载参数 | 服务、网络、卷及依赖配置 | 工作负载、网络、配置与存储对象 |
| 启动条件 | 镜像与参数有效，进程可以启动 | 除启动外，还需确认服务依赖和就绪条件 | 依次观察对象校验、调度、镜像、进程与探针状态 |
| 状态数据 | 区分容器可写层、绑定挂载与命名卷 | 区分项目资源和持久数据的清理范围 | 区分工作负载生命周期与持久存储生命周期 |
| 排错线索 | 退出码、日志、inspect、资源与网络状态 | 各服务日志、健康检查和项目配置 | 对象状态、事件、控制器与节点状态 |
| 复现时记录 | 引擎位置、镜像 digest、架构、参数与输出 | 额外记录 Compose 实现、版本和完整服务配置 | 额外记录集群、节点运行时和使用的 API 配置 |

Windows/macOS 上运行 Linux 容器时，还需核对 Linux 后端及路径共享方式，见 [Docker 运行边界](/docker/)和 [Podman Machine](/podman/rootless)。Podman 的 Compose 路径使用外部 provider，兼容范围按具体实现与场景确认。

## 构建、格式与分发的分工

| 层次 | 工具或规范 | 比较时关注什么 | 详细说明 |
| --- | --- | --- | --- |
| 镜像内容与运行约定 | OCI Image / Runtime 规范 | 镜像格式、配置与进程启动边界 | [容器基础](/concepts/) |
| 镜像构建 | BuildKit、buildx、Buildah | 构建输入、缓存、阶段与目标平台 | [镜像构建](/docker/build) |
| 镜像与应用生态 | Registry、Harbor、Helm、Kustomize 等 | 分发、管理、打包与配置组织各自的职责 | [生态地图](/ecosystem/) |

这张表按职责组织阅读路径。相关工具的完整兼容范围，需要结合其官方文档和实际版本核对，资料入口集中在 [📚 参考资料](/reference/)。

## 从比较进入验证

1. 用[选型问题](/ecosystem/selection)确定是单容器、多服务、系统服务还是集群对象实验。
2. 在 [🧪 实验台](/playground/)查看场景清单、锁定镜像和离线复现计划。
3. 按 [Actions 执行与回写](/support/actions)采集实际结果，再从[验证证据](/evidence/)核对日志、断言和源码信息。

生成计划、提供配置与完成实际运行是不同阶段。各场景当前的验证状态以证据页记录为准；跨工具比较应使用相同输入和断言，并保留不兼容项。
