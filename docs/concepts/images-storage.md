# 镜像、文件系统与存储

镜像由内容、配置和可寻址的元数据组成。容器启动后增加可写层；删除容器与删除镜像、删除持久卷是不同操作。

## Tag、digest 与平台

Tag 是可移动的名称，digest 标识内容。多平台索引的 digest 与某个平台的镜像 manifest digest 也可能不同。复现时同时记录引用、实际镜像 ID 和 OS/Architecture。

本项目 `.env.versions` 使用 `tag@sha256:…`，试点也接受既有 `repository@sha256:…` 锁。展示名称中的版本只是说明，实际内容以 digest 为准。相同镜像在不同内核、架构或挂载条件下，行为仍可能不同。

## 数据放在哪里

| 存储方式 | 生命周期 | 适合什么 |
| --- | --- | --- |
| 容器可写层 | 跟随容器 | 临时文件 |
| Volume | 独立于容器 | 需要保留的应用数据 |
| Bind mount | 主机路径决定 | 源码、配置或需要明确位置的文件 |
| tmpfs | 内存与挂载生命周期 | 临时敏感数据或短期工作目录 |

镜像层存储后端与应用数据持久化是两件事。不要依赖某个引擎内部目录布局管理业务数据。

## 实验边界

首批公共执行器只允许只读源码挂载；Compose 入门场景不使用持久卷。SQL、MQ 后续接入时，需要明确“每次重新开始”还是“保留状态”，并单独设计恢复与清理策略。

多阶段构建实验检查构建阶段文件不会自动进入最终镜像，见[构建场景](/evidence/image-build)。

## 资料

[Docker 存储](https://docs.docker.com/engine/storage/)、[OCI Image Specification](https://github.com/opencontainers/image-spec)与[多平台镜像](https://docs.docker.com/build/building/multi-platform/)解释不同层次的存储和引用。
