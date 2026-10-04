import { defineConfig } from 'vitepress'
import { sharedThemeLabels } from './shared-ui'

const base = process.env.DOCS_BASE || '/'
export default defineConfig({
  lang: 'zh-CN',
  base,
  title: 'Hello Docker',
  titleTemplate: ':title | 容器与生态手册',
  description: '容器基础、Docker、Podman、Kubernetes 与 Hello 项目公共 Docker 支持',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],
  themeConfig: {
    ...sharedThemeLabels,
    logo: '/favicon.svg',
    nav: [
      { text: '容器基础', link: '/concepts/' },
      { text: 'Docker', link: '/docker/' },
      { text: 'Podman', link: '/podman/' },
      { text: 'Kubernetes', link: '/kubernetes/' },
      { text: '生态地图', link: '/ecosystem/' },
      { text: '项目支持', items: [
        { text: '公共工具与接入', link: '/support/' },
        { text: '配置与复现助手', link: '/playground/' },
        { text: 'Actions 验证证据', link: '/evidence/' },
      ] },
    ],
    sidebar: {
      '/': [
        { text: '容器基础', items: [
          { text: '从进程到容器', link: '/concepts/' },
          { text: '隔离、资源与权限', link: '/concepts/isolation' },
          { text: '镜像、文件系统与存储', link: '/concepts/images-storage' },
          { text: '网络与服务发现', link: '/concepts/network' },
        ] },
        { text: 'Docker', items: [
          { text: '架构与生命周期', link: '/docker/' },
          { text: '构建、缓存与多平台', link: '/docker/build' },
          { text: 'Compose 与健康检查', link: '/docker/compose' },
          { text: '日志、诊断与清理', link: '/docker/operations' },
        ] },
        { text: 'Podman', items: [
          { text: '架构与操作路径', link: '/podman/' },
          { text: 'Rootless 与 Machine', link: '/podman/rootless' },
          { text: 'Quadlet 与系统服务', link: '/podman/quadlet' },
        ] },
        { text: 'Kubernetes', items: [
          { text: '架构与协调循环', link: '/kubernetes/' },
          { text: '工作负载与发布', link: '/kubernetes/workloads' },
          { text: '网络、配置与存储', link: '/kubernetes/network-storage' },
          { text: '最小实验与排错', link: '/kubernetes/lab' },
        ] },
        { text: '生态与项目支持', items: [
          { text: '容器生态地图', link: '/ecosystem/' },
          { text: '按需求选工具', link: '/ecosystem/selection' },
          { text: '公共支持总览', link: '/support/' },
          { text: '场景协议与证据', link: '/support/protocol' },
          { text: 'Actions 执行与回写', link: '/support/actions' },
          { text: '五个项目的接入路线', link: '/support/projects' },
          { text: '配置与复现助手', link: '/playground/' },
          { text: 'Actions 验证证据', link: '/evidence/' },
        ] },
      ],
    },
    outline: { level: [2, 3], label: '本页目录' },
    lastUpdated: { text: '最后更新' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    footer: { message: '容器基础 · 生态手册 · 可追溯验证', copyright: 'Copyright © 2026 Hello Docker' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/xy2401/hello-docker' }],
  },
})
