# 隔离、资源与权限

namespaces 决定进程看到哪些系统对象，cgroups 管理进程组的资源使用。权限边界还涉及用户映射、capabilities、seccomp、文件权限和安全模块；每种机制解决不同问题。

## 从问题找机制

| 问题 | 相关机制 | 容易混淆的地方 |
| --- | --- | --- |
| 为什么 PID 看起来从 1 开始 | PID namespace | 主机仍有自己的 PID 视图 |
| 为什么主机名、挂载、网络不同 | UTS、mount、network namespaces | 挂载主机目录会显式共享内容 |
| 为什么达到资源上限 | cgroups 与资源限制 | CPU 限制和内存耗尽的表现不同 |
| 容器里的 root 有多大权限 | user namespace、capabilities | 容器用户名不能单独说明主机权限 |

## 观察而不是猜测

在已获准的实验环境中，可以记录 `id`、`/proc/self/status`、`/proc/self/cgroup`，再结合引擎的 inspect 结果分析。只看一条命令，无法确定运行时是否使用了 user namespace 或额外权限。

本项目单容器执行默认关闭网络，源码只读挂载；这些是实验条件，不代表其他项目也适用。例如数据库服务的网络与存储需求不同，必须由场景明确声明。

## 资源限制如何理解

CPU 限制通常影响可使用的计算时间；内存限制可能导致 OOM 终止。观察退出码、引擎事件和应用日志，区分“程序异常”与“运行环境终止”。Kubernetes 的 requests 用于调度，limits 约束运行时资源，二者不能互换。

Rootless 减少引擎以主机 root 身份运行的需要，同时带来用户映射、端口和存储方面的差异，详见 [Podman rootless](/podman/rootless)。

## 资料

[Docker 运行参数](https://docs.docker.com/reference/cli/docker/container/run/)、[Docker Engine 安全机制](https://docs.docker.com/engine/security/)与 [Kubernetes 资源管理](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)提供各机制的配置入口。
