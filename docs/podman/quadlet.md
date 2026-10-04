# Quadlet 与系统服务

Quadlet 把容器描述转成 systemd 单元，把服务生命周期、依赖和日志接入系统管理。它适合单机服务管理，应用的集群调度仍需要其他编排机制。

## 配置文件

`labs/podman/hello-http.container` 使用锁定的 Python 3.12 镜像，运行 HTTP 服务，将端口发布到主机回环地址 `127.0.0.1:18080`。

```ini
[Container]
Image=python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a
Exec=python -m http.server 8080
PublishPort=127.0.0.1:18080:8080
```

## 用户服务的操作路径

在具备相应 Podman、systemd 和 cgroup 条件的 Linux 实验环境中，将文件放入用户 Quadlet 配置目录，再操作生成的服务：

```bash
mkdir -p ~/.config/containers/systemd
cp labs/podman/hello-http.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start hello-http.service
systemctl --user status hello-http.service
journalctl --user -u hello-http.service
```

预期本机访问 `http://127.0.0.1:18080/` 返回目录页面。检查服务日志、监听地址和实际镜像版本；当前模板尚未进入本项目 Actions 验证。

## 生命周期与清理

用户登出后是否持续运行，取决于用户服务和 lingering 设置；该行为应由部署需求决定。实验结束后停止服务、删除本次复制的 `.container` 文件并 daemon-reload，不清除其他用户服务。

## 资料

[Quadlet 官方手册](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)列出搜索路径、生成规则、支持条件与启动超时配置。
