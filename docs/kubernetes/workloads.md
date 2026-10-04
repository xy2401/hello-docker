# 工作负载与发布

工作负载对象表达应用的运行方式。选择对象时，先明确实例能否替换、是否需要稳定身份，以及任务是长期运行还是执行后结束。

## 选择控制器

| 对象 | 典型用途 | 需要额外设计什么 |
| --- | --- | --- |
| Deployment | 可替换的应用副本 | 就绪、更新与回滚 |
| StatefulSet | 稳定身份的实例 | 数据一致性、卷与恢复 |
| DaemonSet | 每节点上的辅助服务 | 节点差异与资源占用 |
| Job / CronJob | 有完成条件的任务 | 重试、幂等与并发 |

StatefulSet 提供身份和管理顺序，不自动替数据库或 Broker 实现复制、备份与高可用。

## 更新与可用性

Deployment 的滚动更新参数控制新旧副本替换节奏。readiness 决定实例是否适合接收流量，liveness 用于发现需要重启的进程；启动慢的应用还可以使用 startup probe。

在已准备好的实验集群中观察：

```bash
kubectl -n hello-docker-lab get deployment,pod
kubectl -n hello-docker-lab rollout status deployment/hello-http
kubectl -n hello-docker-lab describe pod <pod-name>
```

完整上下文选择与清理见[最小实验](./lab)。这里的运行状态需要实际观察，不能由 YAML 字段推断通过。

## 资源与边界

本项目示例声明 CPU/内存 requests 和 limits；数值只是小型 HTTP 实验的配置，不是生产容量建议。数据库或消息队列需要按真实负载设计资源与恢复流程。

## 资料

[Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[StatefulSet](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/)、[探针](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)与[资源管理](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)。
