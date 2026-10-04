# Compose HTTP：待验证

状态：**待首次 Actions 验证**。尚无采集时间、工作流运行 URL 或实际执行结果。

## 场景

清单为 `scenarios/compose-http.json`，配置为 `labs/compose/compose.yaml`。客户端等待服务器健康，通过服务名发起 HTTP 请求，断言状态码与响应内容。

使用唯一 Compose 项目名，失败后也清理项目资源。预期 `http=200`、`payload=hello-docker` 尚未在本项目实际采集。

## 操作入口

[配置与复现助手](/playground/)提供完整配置。[手动工作流](https://github.com/xy2401/hello-docker/actions/workflows/verify-docker.yml)选择 `compose-http`。解释见[Compose 手册](/docker/compose)。
