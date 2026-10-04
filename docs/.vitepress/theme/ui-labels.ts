import type { App } from 'vue';

// VitePress 1.6.4 exposes no config options for these navigation ARIA labels.
// Localize only its public chrome, including menus mounted after the first render.
export function installUiLabels(app: App) {
  if (typeof document === 'undefined') return;
  const attributes = new Map([
    ['mobile navigation', '移动导航'],
    ['extra navigation', '更多导航'],
    ['Sidebar Navigation', '侧栏导航'],
    ['toggle section', '展开或收起分组'],
  ]);
  const textLabels = new Map([
    ['main-nav-aria-label', '主导航'],
    ['sidebar-aria-label', '侧栏导航'],
    ['doc-footer-aria-label', '页面导航'],
  ]);
  const update = () => {
    document.querySelectorAll('.VPNav [aria-label], .VPSidebar [aria-label]').forEach(element => {
      const label = attributes.get(element.getAttribute('aria-label') || '');
      if (label) element.setAttribute('aria-label', label);
    });
    for (const [id, label] of textLabels) {
      const element = document.getElementById(id);
      if (element && element.textContent !== label) element.textContent = label;
    }
    document.querySelectorAll<HTMLButtonElement>('.vp-doc button.copy').forEach(button => {
      if (button.title === 'Copy Code') button.title = '复制代码';
      if (button.getAttribute('aria-label') !== '复制代码') button.setAttribute('aria-label', '复制代码');
    });
    document.querySelectorAll<HTMLAnchorElement>('.vp-doc a.header-anchor').forEach(anchor => {
      const label = anchor.getAttribute('aria-label') || '';
      if (label.startsWith('Permalink to ')) anchor.setAttribute('aria-label', label.replace('Permalink to ', '章节永久链接：'));
    });
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  update();
  app.onUnmount(() => observer.disconnect());
}
