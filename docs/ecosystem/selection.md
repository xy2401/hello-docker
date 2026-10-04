# 按需求选工具

先描述要复现什么，再选择工具。开发体验、部署规模、状态管理和验证成本，比工具名称更能决定方案。

## 从场景开始

| 需求 | 可评估的路径 | 首先确认 |
| --- | --- | --- |
| 单个程序的固定环境 | Docker / Podman | 镜像、架构、挂载与退出条件 |
| 多服务本机实验 | Compose | 服务就绪、网络和状态生命周期 |
| Linux 单机长期服务 | Podman Quadlet / systemd | 用户服务、依赖和日志 |
| Kubernetes 对象与控制器实验 | kind | 节点镜像、集群资源和 provider |
| 轻量集群应用实验 | k3s / k3d | Kubernetes 发行配置与目标环境差异 |
| 管理 containerd 环境 | nerdctl | namespace、运行时与网络配置 |
| 组织 Kubernetes 应用配置 | Helm / Kustomize | 包管理需求或配置叠加需求 |

这张表提供评估路径，不是通用排名。确定方案后，用自己的最小场景检验参数、状态和输出，保留不兼容项。

## Hello 项目的选择

Shell、Lang 首批使用单容器试点，公共接口较小。SQL 的服务器/客户端与就绪判断、MQ 的 Compose 拓扑与业务断言，需要更多领域配置。WASM 的多架构构建与转换继续保留专业流程。

因此公共支持先沉淀锁定、执行、证据和回写机制，避免用一个通用命令抹掉各领域的验证语义。

## 资料

[kind](https://kind.sigs.k8s.io/docs/user/quick-start/)、[k3d](https://k3d.io/)、[k3s](https://docs.k3s.io/)、[nerdctl](https://github.com/containerd/nerdctl)、[Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)。
