# Compose 与健康检查

Compose 用一个项目描述服务、网络、配置与生命周期。它适合可复现的多服务实验，集群调度与控制器协调属于 Kubernetes 等编排系统的职责。

## HTTP 场景

`labs/compose/compose.yaml` 有两个服务：`server` 提供 HTTP 响应，`client` 通过 `server:8080` 请求它。两者使用同一个 Python 镜像锁，均固定 Linux amd64。

```yaml
depends_on:
  server:
    condition: service_healthy
```

启动顺序与应用就绪是不同条件。健康检查访问服务器自身端点，客户端依赖健康状态后再发实际请求。

## 成功与失败怎样定义

公共脚本使用 `--abort-on-container-exit --exit-code-from client`，由客户端退出码决定实验结果，再断言 stdout 包含 `http=200` 与 `payload=hello-docker`。退出码为零但业务输出错误，同样不会发布。

```powershell
node bin/hello-docker.mjs plan --manifest scenarios/compose-http.json --shell powershell
```

计划里的 `up` 和 `down` 使用同一个唯一项目名。失败后也执行清理，移除该项目创建的资源。首批模板不使用外部网络、外部卷、主机挂载或固定容器名称。

## 排错与边界

先检查插值后的 `docker compose config`，再看健康状态、服务日志和客户端断言。公共脚本会校验插值后的镜像是否仍在清单允许的 digest 集合中。

预计响应是预期条件，[证据页](/evidence/compose-http)只有首轮真实工作流成功后才会显示结果。

## 资料

[启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)、[compose up](https://docs.docker.com/reference/cli/docker/compose/up/)、[compose down](https://docs.docker.com/reference/cli/docker/compose/down/)。
