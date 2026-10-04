---
layout: home
title: Hello Docker
hero:
  name: Hello Docker
  text: 容器与生态手册
  tagline: 从进程隔离到集群编排 · 从配置文件到可追溯验证
  image:
    src: /favicon.svg
    alt: Hello Docker
  actions:
    - theme: brand
      text: 理解容器基础
      link: /concepts/
    - theme: alt
      text: 配置与复现助手
      link: /playground/
    - theme: alt
      text: 公共工具与接入
      link: /support/
features:
  - icon: 🧱
    title: 基础机制
    details: 进程、namespaces、cgroups、镜像分层、网络与权限，解释容器边界如何建立。
  - icon: 📦
    title: 构建与运行
    details: Docker 与 Podman 的操作路径、构建缓存、Compose、rootless 和系统服务。
  - icon: ☸️
    title: 集群与生态
    details: Kubernetes 的声明式协调，以及运行时、镜像仓库和部署工具之间的关系。
  - icon: 🔬
    title: 可追溯验证
    details: 共用场景脚本在 GitHub Actions 执行，源码、镜像与日志一同形成验证证据。
---

## 三条学习路径

| 目标 | 从哪里开始 | 下一步 |
| --- | --- | --- |
| 理解容器到底隔离了什么 | [容器基础](/concepts/) | [权限与资源](/concepts/isolation)、[存储](/concepts/images-storage)、[网络](/concepts/network) |
| 把程序放进可复现环境 | [Docker](/docker/) | [镜像构建](/docker/build)、[Compose](/docker/compose)、[Podman](/podman/) |
| 理解多机器上的应用管理 | [Kubernetes](/kubernetes/) | [工作负载](/kubernetes/workloads)、[网络与存储](/kubernetes/network-storage)、[最小实验](/kubernetes/lab) |

## Hello 项目的公共支持

Hello Docker 把通用容器操作、镜像锁定和证据格式沉淀为公共工具。语言、数据库、消息队列的业务断言继续由各项目负责；Hello WASM 继续维护转换工具链与浏览器运行时资产。

首批有三个 Docker 实验，以及 Shell Bash、Lang Python 两个公共工具试点。[项目接入路线](/support/projects)说明 SQL、MQ 和 WASM 的后续接入边界。

## 当前验证状态

配置与复现助手可以生成命令、展示源文件和读取已有证据。实际容器实验通过手动 Actions 工作流执行；未采集的场景显示待验证。只有真实运行与断言通过，结果才会自动回写到文档。

[查看 Actions 验证证据](/evidence/) · [了解执行与回写规则](/support/actions)
