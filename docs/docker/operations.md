# 日志、诊断与清理

先定位失败阶段，再决定看哪份证据。下载失败、容器退出、业务断言失败和清理失败不能合并成一个“运行失败”。

## 从证据开始

| 文件 | 用途 |
| --- | --- |
| `result.json` | 源码、工具、镜像、状态和断言 |
| `steps.json` | 每一步 argv、输出、退出码与超时 |
| `stdout.txt` / `stderr.txt` | 实际业务执行输出 |
| `inventory.out.txt` | 引擎与镜像检查快照 |
| `assert.out.txt` | 通过的业务断言 |

stdout 和 stderr 分别记录。stderr 有内容不一定代表失败，退出码为零也不一定满足业务预期。

## 检查路径

在已获准的运行环境中，使用 `docker logs` 查看应用输出，`docker inspect` 查看退出状态、挂载和实际镜像，`docker events` 辅助定位引擎事件。Compose 场景还应检查服务健康与依赖条件。

公共脚本有场景总时限、单次清理时限和输出大小限制。仅终止 Docker CLI 不能证明容器已结束，所以超时后还会按本次资源名称移除容器或关闭 Compose 项目。

## 清理的范围

所有实验资源包含唯一运行标识。脚本不调用全局 prune；构建实验只移除自己的结果镜像，拉取的基础镜像由临时 runner 生命周期处理。

GitHub 任务被平台强制终止时，不能假定应用中的 finally 已完整执行。首批使用临时托管 runner；接入持久自托管 runner 之前，必须补充独立的失联资源回收机制。

## 资料

[容器日志](https://docs.docker.com/reference/cli/docker/container/logs/)、[inspect](https://docs.docker.com/reference/cli/docker/inspect/)、[Docker 事件](https://docs.docker.com/reference/cli/docker/system/events/)。
