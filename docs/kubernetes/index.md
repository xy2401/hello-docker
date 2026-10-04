# Kubernetes 架构与协调循环

Kubernetes 保存期望状态，通过控制器和节点组件逐步让实际状态接近期望。理解这套协调过程，才能解释“提交配置成功”与“应用可用”之间的距离。

## 组件分别负责什么

| 组件 | 职责 |
| --- | --- |
| API Server | 提供对象访问与校验入口 |
| etcd | 保存集群状态 |
| Scheduler | 为未调度 Pod 选择节点 |
| Controllers | 根据期望状态持续协调对象 |
| kubelet | 在节点上管理 Pod 执行 |
| CRI 运行时 | 管理容器与 Pod 沙箱 |

节点运行时常见选择包括 containerd 与 CRI-O。Kubernetes 通过 CRI 与其交互，OCI 规范再约束更底层的镜像与运行机制；Kubernetes 不要求节点使用 Docker Engine。

## 一次 Deployment 更新

```text
提交期望对象 → API 校验并保存
Deployment / ReplicaSet 协调 → 创建 Pod
Scheduler 选择节点 → kubelet 调用运行时
镜像拉取与进程启动 → 探针确认状态
```

每个阶段都有独立失败条件：对象字段无效、资源不足、镜像不可用、进程崩溃、探针失败。排错应沿这条路径读取状态和事件。

## 学习路径与边界

先看[工作负载](./workloads)，再看[网络、配置与存储](./network-storage)，最后使用[最小实验](./lab)观察实际对象。首批提供实验文件与命令路径；尚未执行 Kubernetes 集群验证。

## 资料

[集群组件](https://kubernetes.io/docs/concepts/overview/components/)、[CRI](https://kubernetes.io/docs/concepts/containers/cri/)与 [Kubernetes 架构](https://kubernetes.io/docs/concepts/architecture/)。
