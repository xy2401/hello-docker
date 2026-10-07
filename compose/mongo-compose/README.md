# Mongo Compose 与官方样例导入

先用 Compose 启动 MongoDB，再在容器内运行挂载的 Bash 脚本，一次完成下载、导入和查询验证。下载文件写入共享的 `data/` 目录。只启动服务不会自动下载样例。

## 启动与导入

以下命令从 group-hello 根目录执行，PowerShell 与 Bash 都可使用；单独检出 hello-docker 时，第一条改为 `cd compose/mongo-compose`。

```bash
cd hello-docker/compose/mongo-compose

# 启动 MongoDB，挂载脚本并共享 data 目录
docker compose up -d

# 容器内执行 Bash：下载、导入全部样例库、查询验证
docker exec -u root hello-docker-mongo bash /workspace/import-samples.sh

# 停止服务，保留数据库和下载文件
docker compose down
```

首次启动会拉取固定版本的 MongoDB 8.0 镜像。脚本最多等待 60 秒完成认证连接；镜像没有 curl 时，在容器内安装 curl 和 CA 证书。下载和导入可能需要数分钟，脚本出错时返回非零退出码。

MongoDB 连接地址为 `127.0.0.1:27017`，演示用户名 `root`、密码 `example`、认证库 `admin`。脚本读取 Compose 设置的账号环境变量。这些初始化变量只在空数据卷上创建账号，修改变量不会修改已有数据库中的账号。

## 共享目录与下载文件

Compose 使用 `./data:/workspace/data`，把宿主机的 `data/` 目录挂载进容器；容器内写入 `/workspace/data` 的文件会保留在宿主机。首次启动会自动创建该目录，下载归档和后续导出文件都可以放在这里。

脚本通过 `./import-samples.sh:/workspace/import-samples.sh:ro` 只读挂载，无需复制或构建进镜像。两条挂载的宿主路径都相对于 `compose.yaml` 所在目录解析。

脚本使用固定的官方地址：

```bash
S3_URL="https://atlas-education.s3.amazonaws.com/sampledata.archive"
```

归档约 380 MiB，下载到宿主机的 `data/sampledata.archive`，容器内对应 `/workspace/data/sampledata.archive`。下载先写入 `.part` 文件，成功后才改名；失败时清理临时文件并停止，不会继续导入。下次运行复用已下载的非空归档。项目的 `.gitignore` 已忽略 `/compose/*/data/`，下载文件和导出文件不会加入 Git。

## 导入与数据保留

脚本在容器内通过 `mongorestore --archive` 读取归档，并用 `--nsInclude='sample_*.*'` 导入全部样例库；此归档不需要 `--gzip`。完成后列出 `sample_` 开头的数据库，并查询 `sample_restaurants.restaurants` 的一条记录。

导入不添加 `--drop`，不会删除现有集合。**重复导入可能出现重复键**，脚本通过 `--stopOnError` 停止；导入失败前已写入的文档会保留，恢复过程不是事务。已有样例数据时，直接启动服务即可，不必再次运行导入脚本。

MongoDB 数据使用命名卷保存在 `/data/db`，与共享目录中的下载缓存分开。`docker compose down` 保留命名卷，再次 `up -d` 可以继续使用数据；`down -v` 会删除数据库卷，不用于日常停止。宿主机的归档文件不受普通停止影响。

排查启动或认证错误可以执行：

```bash
docker compose logs mongo
```

## Podman

安装并配置好 Podman 及其 Compose provider 后，使用同一份文件：

```bash
podman compose up -d
podman exec -u root hello-docker-mongo bash /workspace/import-samples.sh
podman compose down
```

在启用 SELinux 的 Linux 主机上，如果挂载文件访问被拒绝，将数据目录挂载改为 `./data:/workspace/data:Z`，脚本挂载改为 `./import-samples.sh:/workspace/import-samples.sh:ro,Z`，再重新创建容器。
