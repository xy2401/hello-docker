import type { DefaultTheme } from 'vitepress';

// Keep this standalone template identical in all five independently built sites.
export const sharedThemeLabels = {
  darkModeSwitchLabel: '外观',
  lightModeSwitchTitle: '切换到浅色模式',
  darkModeSwitchTitle: '切换到深色模式',
  sidebarMenuLabel: '菜单',
  returnToTopLabel: '返回顶部',
  skipToContentLabel: '跳转到正文',
  search: {
    provider: 'local',
    options: {
      translations: {
        button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
        modal: {
          displayDetails: '显示详细结果',
          resetButtonTitle: '清除搜索',
          backButtonTitle: '返回搜索',
          noResultsText: '没有找到相关结果',
          footer: {
            selectText: '选择',
            selectKeyAriaLabel: '回车键',
            navigateText: '切换',
            navigateUpKeyAriaLabel: '向上方向键',
            navigateDownKeyAriaLabel: '向下方向键',
            closeText: '关闭',
            closeKeyAriaLabel: '退出键',
          },
        },
      },
    },
  },
} satisfies DefaultTheme.Config;
