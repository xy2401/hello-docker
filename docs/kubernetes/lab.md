# 最小 Kubernetes 实验与排错

`labs/kubernetes/basic.yaml` 包含独立 Namespace、一个 Deployment 和一个 Service。使用已锁定的 Python 镜像，节点选择 Linux amd64 架构条件，提供 HTTP 探针与资源声明。

## 实验准备

kind 用容器运行 Kubernetes 节点。创建集群需要引擎、kind、kubectl 和匹配的节点镜像，下载及资源负担与普通单容器实验不同。首批只交付实验文件；后续在单独批准的 Actions 任务中验证。

集群应使用独立名称和 kubeconfig，例如 `hello-docker-lab`。不要依赖当前默认上下文：

```bash
kubectl --context kind-hello-docker-lab apply -f labs/kubernetes/basic.yaml
kubectl --context kind-hello-docker-lab -n hello-docker-lab rollout status deployment/hello-http --timeout=120s
kubectl --context kind-hello-docker-lab -n hello-docker-lab get pod,service
kubectl --context kind-hello-docker-lab -n hello-docker-lab port-forward service/hello-http 18080:80
```

预期本机访问 `http://127.0.0.1:18080/` 成功；当前未采集该结果。`port-forward` 只是调试访问路径，不等同于生产入口配置。

## 沿状态排错

Pending 时看调度事件与资源；ImagePullBackOff 时看镜像与仓库访问；CrashLoopBackOff 时看当前及前一次容器日志；服务不通时看标签、探针和 Service 后端。

```bash
kubectl --context kind-hello-docker-lab -n hello-docker-lab get events --sort-by=.lastTimestamp
kubectl --context kind-hello-docker-lab -n hello-docker-lab describe deployment hello-http
kubectl --context kind-hello-docker-lab -n hello-docker-lab logs deployment/hello-http
```

## 清理与资料

结束端口转发后，只删除本次实验 Namespace；若集群也是专为此实验创建，再按名称删除该 kind 集群。不要操作其他上下文。

参考 [kind 快速入门](https://kind.sigs.k8s.io/docs/user/quick-start/)与[应用调试](https://kubernetes.io/docs/tasks/debug/debug-application/)。
