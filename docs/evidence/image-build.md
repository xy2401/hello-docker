# 多阶段构建：待验证

状态：**待首次 Actions 验证**。尚无采集时间、工作流运行 URL 或实际执行结果。

## 场景

清单为 `scenarios/image-build.json`。构建阶段生成文件，最终阶段只复制指定产物。业务断言要求复制的内容正确，构建阶段专属文件不出现在最终容器中。

基础镜像 digest、最终镜像 ID 和运行输出分别记录。成功构建不单独代表业务断言通过。

## 操作入口

[配置与复现助手](/playground/)可查看 Dockerfile。[手动工作流](https://github.com/xy2401/hello-docker/actions/workflows/verify-docker.yml)选择 `image-build`。机制说明见[构建手册](/docker/build)。
