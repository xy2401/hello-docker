# Actions 执行与自动回写

容器实验使用手动 `workflow_dispatch`。普通代码推送不启动新容器采集；首批托管 runner 为 `ubuntu-24.04`，Node.js 为 22。

## 工作流路径

1. 检出本次工作流源码，校验场景清单。
2. 拉取 digest 锁定的镜像，记录实际平台与引擎版本。
3. 执行场景，检查退出码、业务输出和清理结果。
4. 无论成功或失败，尽量保存 14 天 Artifact。
5. 成功后重新检出源码，校验 Artifact，生成页面并构建相关文档。
6. 检查目标分支仍指向采集时的 SHA，提交指定证据和页面。

`all` 最多同时执行两个本项目场景，任何场景失败都会停止整批发布。失败日志不会被当作成功结果回写。

## 跨项目复用

Shell 和 Lang 的调用工作流要求输入已发布 hello-docker 的完整 **40 位 SHA**，先检出该版本，再调用公共 composite action。执行任务使用读取权限，发布任务通过所属仓库的 `GITHUB_TOKEN` 写回自身；不向其他仓库推送。

```yaml
with:
  manifest: support/docker/bash-env.json
  output: .artifacts/bash-env
  tool-sha: 已发布的完整提交SHA
```

这里只展示输入关系，完整可用工作流在各项目的 `collect-docker-pilot.yml`。

## 回写与竞争

发布脚本只暂存清单允许的证据目录和页面。若远程分支已前移，保留 Artifact 并要求重新采集；不会强制推送或把过期证据 rebase 到新源码上。

仓库回写不等于线上部署完成。站点继续使用自身托管方式；使用 `GITHUB_TOKEN` 的普通推送通常不会触发另一个 Actions 工作流，因此不能假定 bot 提交会自动运行文档部署任务。

## 当前状态与资料

脚本和工作流先完成本地轻量验证。远程发布、首次运行与镜像下载范围需在实际执行前确认。当前证据页均保留待验证标记。

参考 [composite action](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action)、[Artifact](https://docs.github.com/en/actions/tutorials/store-and-share-data)与[工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
