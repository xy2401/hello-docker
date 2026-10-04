# 容器生态地图

生态工具分布在不同层次：规范约定格式，构建工具产生镜像，运行时启动进程，编排系统协调服务，仓库负责分发。比较工具时，先确认它们是否解决同一问题。

## 工具所在的层次

| 层次 | 常见工具或协议 | 职责 |
| --- | --- | --- |
| 内容与执行规范 | OCI Image / Runtime / Distribution | 格式与互操作约定 |
| 镜像构建 | BuildKit、buildx、Buildah | 从输入生成镜像 |
| 镜像复制与检查 | Skopeo、仓库 API | 搬运和读取镜像内容 |
| 容器管理 | Docker Engine、Podman、nerdctl | 用户操作与管理接口 |
| 运行时服务 | containerd、CRI-O | 镜像、容器与运行时协调 |
| 低层运行时 | runc、crun | 按 OCI 配置启动进程 |
| 分发与管理 | Registry、Harbor | 存储与分发镜像、管理策略 |
| 编排与配置 | Kubernetes、Helm、Kustomize | 协调应用、打包或组织配置 |
| 本地集群 | kind、k3d、k3s | 不同的开发与轻量集群路径 |

Helm chart 和 Kustomize overlay 不直接启动容器；OCI 运行时也不承担 Kubernetes 的控制器职责。理解这些分工，可以避免把“换工具”当作解决所有运行问题的方法。

## 与 WASM 的连接

Dockerfile 生成容器镜像，container2wasm 再把特定架构环境转换为浏览器可启动资产。两者的产物、平台和验证方式不同。Hello Docker 管理通用构建/运行协议，Hello WASM 维护 RISC-V 转换、分片、校验和浏览器执行。

## 下一步与资料

使用[选型问题](./selection)把具体需求映射到工具层次。本表是关系地图，首批没有逐个运行所有工具。

参考 [OCI](https://opencontainers.org/)、[containerd](https://containerd.io/)、[CRI-O](https://cri-o.io/)、[Buildah](https://buildah.io/)、[Skopeo](https://github.com/podman-container-tools/skopeo)、[Helm](https://helm.sh/docs/)与 [Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/)。
