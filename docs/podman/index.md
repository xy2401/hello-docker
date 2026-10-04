# Podman 架构与操作路径

Podman 管理 OCI 镜像与容器，支持普通用户运行，也提供 pods 和系统服务集成。其操作界面与 Docker 有大量相似之处，兼容程度仍需按实际命令和环境确认。

## 哪些关系值得区分

| 能力 | Podman 路径 | 对比时关注什么 |
| --- | --- | --- |
| 容器与镜像操作 | Podman CLI | 参数、退出码、实际运行时 |
| 普通用户运行 | rootless | UID/GID、端口、网络与存储 |
| Windows/macOS 环境 | Podman Machine | Linux 后端与路径共享 |
| 系统服务 | Quadlet + systemd | 启动、依赖与日志 |
| Compose | 外部 provider | provider 版本与支持的 Compose 功能 |

`podman compose` 是对外部 Compose provider 的包装，不应据此声称所有 Docker Compose 场景已经验证。

## 最小操作路径

使用本项目 Bash 锁，可在后续 Podman 实验环境中依次记录版本、拉取镜像、检查平台并运行：

```bash
podman version
podman pull --platform linux/amd64 "$BASH_IMAGE"
podman run --rm --pull=never "$BASH_IMAGE" bash --version
```

`BASH_IMAGE` 需先从 `.env.versions` 加载。这是复现说明，不是本项目已完成的 Podman 结果。

## 下一步与资料

阅读 [rootless 与 Machine](./rootless)、[Quadlet](./quadlet)。参考 [Podman 总览](https://docs.podman.io/en/latest/)与 [podman compose](https://docs.podman.io/en/latest/markdown/podman-compose.1.html)。首批自动执行矩阵只使用 Docker。
