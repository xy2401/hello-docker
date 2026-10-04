# 网络与服务发现

容器网络先回答两个问题：进程在哪个网络视图中运行，数据包通过什么路径到达对端。服务名称、容器地址与发布到主机的端口属于不同层次。

## 三个地址不要混用

在 Compose 的 HTTP 实验中：

- 服务内访问自身：`127.0.0.1:8080`。
- 客户端服务访问服务器：`server:8080`，依靠项目网络中的服务发现。
- 主机访问容器：需要显式端口发布；本实验不发布主机端口。

容器中的 `localhost` 指向当前网络视图，不自动代表另一个服务，也不自动代表主机。

## 常见模式

用户定义的 bridge 网络适合单主机服务协作；host 网络共享主机网络；none 关闭常规网络连接。多主机网络和 Kubernetes CNI 需要额外机制，不能用单主机端口映射解释全部路径。

## 检查顺序

先确认应用监听地址和端口，再检查服务健康、DNS、网络成员关系与端口发布。HTTP 成功说明该请求路径可用；并不能证明 TLS、访问控制或故障恢复也已验证。

[Compose 实验](/docker/compose)把健康检查与服务访问分开：服务器的检查确认本地端点就绪，客户端实际通过服务名发请求。断言分别记录状态码与响应内容。

## 资料

[Docker 网络](https://docs.docker.com/engine/network/)、[Compose 网络](https://docs.docker.com/compose/how-tos/networking/)与 [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/)说明不同环境中的寻址路径。
