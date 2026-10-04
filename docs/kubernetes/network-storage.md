# 网络、配置与存储

Pod 可以被替换，应用应通过稳定的服务入口访问对端。配置与数据也需要明确生命周期，避免跟随某个临时实例消失。

## 网络路径

Service 使用选择器关联后端实例，集群 DNS 提供名称。CNI 负责 Pod 网络实现；入口流量可以再经过 Ingress 或 Gateway 等机制。Service 并不自动让应用监听正确地址，也不证明后端已经就绪。

HTTP 示例的 Service 将服务端口 80 对应到容器 8080。排错时检查 selector、Pod 标签、readiness 与端口，再检查更外层的路由。

## 配置与权限

ConfigMap 表达普通配置，Secret 表达敏感配置对象。Secret 的 base64 表示不是加密保障；访问权限、静态加密及应用读取方式需要共同设计。不要把凭据写进教程或验证日志。

RBAC 管理主体可对 API 对象做什么。实验 Namespace 用于分组对象，不单独形成完整的安全隔离。

## 存储路径

PVC 表达存储请求，PV 表示可供绑定的存储资源，StorageClass 描述供应策略。卷的访问模式、回收策略和存储后端会影响数据生命周期。

首批 HTTP 示例不使用持久卷；SQL、MQ 的后续实验需分别定义新建数据、持久化、备份和故障恢复，不能共享一套“删掉重来”的默认规则。

## 资料

[Service](https://kubernetes.io/docs/concepts/services-networking/service/)、[DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)、[Secret](https://kubernetes.io/docs/concepts/configuration/secret/)与[持久卷](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)。
