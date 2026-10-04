# 从进程到容器

容器把进程放进一组受控的系统视图和资源边界中。镜像提供用户态文件，运行时设置隔离与挂载，然后启动进程。理解这条路径，比先背命令更容易解释“为什么镜像能启动、数据为什么消失”。

## 容器与虚拟机

| 机制 | 隔离对象 | 内核来自哪里 | 常见用途 |
| --- | --- | --- | --- |
| Linux 容器 | 进程、资源与系统视图 | 所在 Linux 主机 | 应用打包与运行 |
| 虚拟机 | 虚拟硬件和客体系统 | 客体系统 | 运行不同系统内核 |
| Docker Desktop / Podman Machine | 为 Linux 容器提供运行主机 | 后端 Linux 环境 | Windows/macOS 开发 |

镜像里的 `/etc/os-release` 描述用户态发行版；`uname` 描述运行中的内核。它们可以来自不同版本。普通 Linux 容器不是完整引导一套内核。

## 三层协议

OCI Image 规范描述镜像内容；OCI Runtime 规范描述启动容器所需的配置和文件系统；分发协议负责镜像在仓库与客户端之间传输。Docker、Podman、Kubernetes 分别提供开发操作或编排能力，不能简单当作同一层的替代品。

```text
Docker CLI → Docker Engine → 容器运行时
Podman → OCI 运行时
Kubelet → CRI → containerd / CRI-O → OCI 运行时
```

## 最小实验

[单容器场景](/evidence/container-basics)检查进程环境与 `/proc`，输出 Bash 的真实版本。它只验证该场景的执行条件，不足以证明所有隔离机制或安全配置。

建议依次阅读[隔离与资源](./isolation)、[镜像与存储](./images-storage)、[网络](./network)，再进入[Docker 生命周期](/docker/)。

## 资料与边界

参考 [Docker 架构](https://docs.docker.com/get-started/docker-overview/)、[OCI 规范项目](https://opencontainers.org/)与 [Kubernetes CRI](https://kubernetes.io/docs/concepts/containers/cri/)。本项目首批自动实验面向 Linux amd64；Windows 原生容器和跨架构仿真另行讨论。
