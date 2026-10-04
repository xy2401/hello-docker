# 单容器基础：待验证

状态：**待首次 Actions 验证**。尚无采集时间、工作流运行 URL 或实际执行结果。

## 场景

清单为 `scenarios/container-basics.json`，使用固定 Bash 镜像，检查 stdout 中的容器标识、可读 `/proc` 和 Bash 5.2 版本。

这些是预期条件；真实版本字符串与引擎信息由 Actions 记录。容器执行、inspect 和清理均成功后，才会生成通过证据。

## 操作入口

[配置与复现助手](/playground/)提供清单与命令文本。[手动工作流](https://github.com/xy2401/hello-docker/actions/workflows/verify-docker.yml)选择 `container-basics` 后执行并自动回写本页。
