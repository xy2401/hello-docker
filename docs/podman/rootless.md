# Rootless 与 Podman Machine

Rootless 让普通用户运行容器。用户命名空间映射和容器内的用户身份需要一起分析，不能只看容器中的 `root` 字样。

## Linux 检查路径

先记录用户身份、Podman 信息、subuid/subgid 分配、cgroup 和存储状态：

```bash
id
podman info
cat /etc/subuid
cat /etc/subgid
```

不同用户通常有各自的镜像、容器与存储。使用 sudo 后查不到普通用户的容器，并不说明数据丢失。

Bind mount 的文件权限还受宿主 UID/GID 与安全模块影响。遇到拒绝访问时，检查映射和标签，避免把扩大权限作为默认修复。

## Machine 的边界

Podman Machine 在 Windows/macOS 等环境提供 Linux 虚拟机。CLI、虚拟机资源、共享目录和连接配置分别需要检查。

```bash
podman machine list
podman system connection list
```

创建或启动 Machine 会引入虚拟机和镜像资源，属于独立的运行准备步骤。本项目首批不在本地建立这些环境。

## 常见问题

检查端口监听范围、低端口权限、用户级服务生命周期，以及容器/主机路径对应关系。对 kind 等工具，rootless provider 还可能需要额外配置，不能直接把 Docker 命令替换成 Podman 后宣布兼容。

## 资料

[Podman rootless 教程](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)、[Podman Machine](https://docs.podman.io/en/latest/markdown/podman-machine.1.html)和 [kind rootless](https://kind.sigs.k8s.io/docs/user/rootless/)。
