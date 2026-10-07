# Hello Docker

容器基础、Docker / Podman / Kubernetes 生态手册、快速启动 Docker / Podman Compose 服务合集，以及 Hello 项目共用的 Docker 场景脚本与 GitHub Actions 验证支持。

## 本地开发

使用 Node.js 22.16+：

```powershell
npm ci
npm run docs:dev
npm run check
npm run docs:build
```

文档地址为 `http://127.0.0.1:5178/`。`DOCS_BASE` 支持子路径部署。

## Compose 服务合集

首个服务是 [Mongo Compose 与官方样例导入](compose/mongo-compose/README.md)。从 hello-docker 根目录执行：

```bash
cd compose/mongo-compose
docker compose up -d
docker exec -u root hello-docker-mongo bash /workspace/import-samples.sh
docker compose down
```

Compose 将服务的 `data/` 目录共享到容器的 `/workspace/data`；Bash 脚本按需下载 MongoDB 官方 Atlas Sample Datasets 归档、导入全部样例库并查询验证。下载文件保留在宿主机的 `data/`，该目录已被 Git 忽略；数据库使用命名卷。Podman 使用相同文件，将命令中的 `docker` 替换为 `podman`。

## 离线工具

```powershell
node bin/hello-docker.mjs check-manifest --manifest scenarios/container-basics.json
node bin/hello-docker.mjs plan --manifest scenarios/container-basics.json --shell powershell
node bin/hello-docker.mjs plan --manifest scenarios/compose-http.json --json
```

这些命令只读取配置与源码。本地 `run`、`publish-evidence` 被明确拒绝；这些场景的执行和自动回写由 Linux Actions runner 完成。

## 手动 Actions 验证

`verify-docker.yml` 可选择 `container-basics`、`image-build`、`compose-http` 或 `all`，使用 Linux amd64、锁定的镜像 digest，并保存 14 天 Artifact。成功后单独的发布任务验证结果、检查目标分支是否前移，提交指定证据目录和页面到本仓库。任何场景失败都保留日志并停止该批发布。

镜像锁沿用已有 Shell/Lang 快照来源，不表示本项目已经执行验证。`docs/evidence/` 的待验证页面在首轮 Actions 成功后被真实结果替换。

## 为其他项目提供支持

- `action.yml`：公共 composite action；输入 `manifest`、`project-root`、`output`、`tool-sha`。
- `templates/`：调用工作流与离线 CLI 入口模板。
- Shell Bash、Lang Python 已接入独立试点场景；各项目保留自己的业务断言和原采集入口。
- 调用工作流要求输入已发布的 **40 位 hello-docker 提交 SHA**，检出该版本后调用 action；不使用浮动 `main`。
- 公开工具仓库可通过调用仓库的 `GITHUB_TOKEN` 读取。此模板显式检出工具源码；私有工具仓库需要具备该仓库读取权限的检出凭据，单独配置 action 共享访问不能代替 checkout 权限。不要把令牌写进源码。

SQL、MQ、WASM 的后续接入路线在文档中说明。Podman 与 Kubernetes 有实验文件，首批不加入执行矩阵。

## 目录

`docs/` 文档与复现助手；`compose/` 本地服务与配套脚本；`scenarios/` JSON 协议；`labs/` 实验源码；`scripts/lib/` 公共逻辑；`tests/` 替身进程测试；`evidence/` Actions 产物；`.github/workflows/` 手动工作流。

公共视觉模板的维护源在 hello-world 的 `design/shared/`，本项目保留副本以支持独立构建。运行时转换与 WASM 资产仍由 hello-wasm 维护。
