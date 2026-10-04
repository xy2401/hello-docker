# Actions 验证证据

以下场景已配套配置、公共脚本和手动工作流。状态来自仓库保存的 Actions 结果；未采集的场景显示待验证。本地替身进程测试不计入通过状态。

<EvidenceSummary />

## 首轮执行后

成功结果由工作流生成到 `evidence/<scenario>/`，并替换对应页面。原始日志、源码哈希和工作流 URL 可用于追溯；失败结果保留在 Artifact 中。

通过记录对应各场景页面的采集时间与 source SHA；修改源码后需重新验证。

[查看复现助手](/playground/) · [执行与回写规则](/support/actions)
