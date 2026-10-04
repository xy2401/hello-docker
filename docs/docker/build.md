# 构建、缓存与多平台

Dockerfile 描述构建步骤，构建上下文决定可复制的输入。BuildKit 执行构建图，buildx 提供管理构建器与多平台构建的操作入口。

## 输入顺序影响缓存

把变化较少的依赖描述放在频繁变化的源码之前，通常可以减少重复安装。`.dockerignore` 控制上下文内容，既减少传输，也避免把无关产物带入构建。

缓存命中说明某一步复用了已有结果，不单独证明依赖来源未变化。复现还需要固定基础镜像、工具链、下载校验和构建输入。

## 多阶段实验

`labs/build/Dockerfile` 使用相同的锁定 Bash 基础镜像建立两个阶段：

```dockerfile
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS builder
RUN printf 'artifact=hello-docker\n' > /message.txt

FROM ${BASE_IMAGE}
COPY --from=builder /message.txt /message.txt
```

实际实验还创建一个只属于构建阶段的文件；最终运行断言该文件不存在。这里验证的是阶段边界，不是比较镜像体积。完整配置在[复现助手](/playground/)中，结果在[构建证据](/evidence/image-build)中。

## 平台与发布

首批构建固定 `linux/amd64`。添加 ARM64 或 RISC-V 64 时，需要确认基础镜像、依赖和执行验证方式；生成某个平台的镜像不等于已在该平台原生运行。

本项目不自动推送镜像仓库。Hello WASM 的 RISC-V 构建、QEMU、container2wasm 和资产发布仍归其自己的流程维护。

## 资料

[BuildKit](https://docs.docker.com/build/buildkit/)、[构建缓存](https://docs.docker.com/build/cache/)、[多阶段构建](https://docs.docker.com/build/building/multi-stage/)和[多平台构建](https://docs.docker.com/build/building/multi-platform/)。
