<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import catalog from '../data/catalog.json'
import { formatCommand } from '../../../../scripts/lib/shell.mjs'
import { evidenceFor, hasActionsEvidence } from '../data/evidence'

const selectedId = ref(catalog[0].id)
const shell = ref('powershell')
const projectRoot = ref('D:/path/to/hello-docker')
const activePanel = ref('plan')
const feedback = ref('')
const scene = computed(() => catalog.find(item => item.id === selectedId.value)!)
const evidence = computed(() => evidenceFor(scene.value.id))
const evidenceStatus = computed(() => !evidence.value ? '待首次 Actions 验证' : hasActionsEvidence(evidence.value) ? '已有 Actions 历史证据' : '证据未通过')
watch([selectedId, shell, projectRoot, activePanel], () => { feedback.value = '' })
const commandText = computed(() => {
  const replace = (step: any) => ({ ...step, args: step.args.map((arg: string) => arg.replaceAll('<project-root>', projectRoot.value)) })
  return [...scene.value.prepare, scene.value.execute, ...scene.value.cleanup].map(step => `# ${step.phase}\n${formatCommand(replace(step), shell.value)}`).join('\n\n')
})
const configText = computed(() => scene.value.configs.map(item => `# ${item.file}\n${item.text}`).join('\n\n'))
const panelText = computed(() => activePanel.value === 'plan' ? commandText.value : activePanel.value === 'config' ? configText.value : JSON.stringify(evidence.value || { status: 'documented', capturedAt: null, workflowUrl: null, note: '尚未执行；下面的业务断言是预期条件。', assertions: scene.value.manifest.assertions }, null, 2))
async function copyPanel() {
  const content = panelText.value
  try { await navigator.clipboard.writeText(content); if (content === panelText.value) feedback.value = '已复制' }
  catch { feedback.value = '复制失败，请选择下方文本手动复制' }
}
async function navigateTab(event: KeyboardEvent) {
  const ids = ['plan', 'config', 'evidence']
  const index = ids.indexOf(activePanel.value)
  const next = event.key === 'ArrowRight' ? (index + 1) % ids.length : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  activePanel.value = ids[next]
  await nextTick()
  document.getElementById('tab-' + activePanel.value)?.focus()
}
const workflowUrl = 'https://github.com/xy2401/hello-docker/actions/workflows/verify-docker.yml'
</script>

<template>
  <div class="assistant">
    <header class="assistant-heading">
      <div><span class="eyebrow">HELLO DOCKER / 场景计划</span><h2>把配置变成可追溯的实验</h2><p>查看配置与复现命令，容器实验由 GitHub Actions 执行。</p></div>
      <span class="status" :class="{ verified: hasActionsEvidence(evidence) }">{{ evidenceStatus }}</span>
    </header>
    <div class="controls">
      <label>实验场景<select v-model="selectedId" @change="feedback = ''"><option v-for="item in catalog" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
      <label>命令格式<select v-model="shell"><option value="powershell">PowerShell</option><option value="bash">Bash</option></select></label>
      <label class="root-control">项目绝对路径<input v-model="projectRoot" spellcheck="false" aria-describedby="path-help" /></label>
    </div>
    <p id="path-help" class="path-help">路径仅用于生成文本。实际执行前可通过本机 CLI 重新生成计划；Actions 使用 runner 上的检出路径。</p>
    <div class="summary"><span>平台 <code>{{ scene.platform }}</code></span><span>类型 <code>{{ scene.kind }}</code></span><span>{{ scene.manifest.assertions.length }} 项业务断言</span></div>
    <div class="image-locks"><span v-for="(image, role) in scene.images" :key="role"><b>{{ role }}</b><code>{{ image }}</code></span></div>
    <div class="panel-heading">
      <div class="tabs" role="tablist" aria-label="实验详情">
        <button v-for="tab in [{ id: 'plan', name: '复现计划' }, { id: 'config', name: '原始配置' }, { id: 'evidence', name: '验证证据' }]" :id="`tab-${tab.id}`" :key="tab.id" role="tab" :aria-selected="activePanel === tab.id" :aria-controls="`panel-${tab.id}`" :tabindex="activePanel === tab.id ? 0 : -1" :class="{ active: activePanel === tab.id }" @keydown="navigateTab" @click="activePanel = tab.id; feedback = ''">{{ tab.name }}</button>
      </div>
      <button class="copy-button" @click="copyPanel">复制当前内容</button>
    </div>
    <div :id="`panel-${activePanel}`" class="code-panel" role="tabpanel" :aria-labelledby="`tab-${activePanel}`" tabindex="0"><pre><code>{{ panelText }}</code></pre></div>
    <p class="feedback" role="status" aria-live="polite">{{ feedback }}</p>
    <footer class="assistant-footer"><a class="primary-link" :href="workflowUrl" target="_blank" rel="noopener">打开 Actions 工作流 ↗</a><a :href="withBase('/evidence/' + scene.id)">查看场景证据页面 →</a><a :href="withBase('/support/actions')">执行与回写规则 →</a></footer>
  </div>
</template>

<style scoped>
.assistant { margin-top: 28px; border: 1px solid var(--vp-c-divider); border-radius: 16px; overflow: hidden; background: var(--vp-c-bg); }
.assistant-heading { display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; padding: 28px; background: var(--vp-c-bg-soft); }
.eyebrow { color: var(--vp-c-brand-1); font-size: 12px; font-weight: 700; letter-spacing: .08em; }
.assistant h2 { border: 0; margin: 10px 0; padding: 0; font-size: 26px; }
.assistant-heading p { margin: 0; color: var(--vp-c-text-2); }
.status { flex-shrink: 0; border-radius: 20px; padding: 6px 12px; color: var(--vp-c-text-2); background: var(--vp-c-default-soft); font-size: 12px; }
.status.verified { color: var(--vp-c-green-1); background: var(--vp-c-green-soft); }
.controls { display: flex; gap: 16px; padding: 24px 28px 0; flex-wrap: wrap; }
.controls label { display: flex; flex-direction: column; gap: 7px; font-size: 13px; font-weight: 600; flex: 1; min-width: 160px; }
.root-control { flex: 1.5 !important; }
.controls select, .controls input { width: 100%; border: 1px solid var(--vp-c-divider); border-radius: 8px; padding: 9px 10px; color: var(--vp-c-text-1); background: var(--vp-c-bg); font: inherit; }
.controls select:focus-visible, .controls input:focus-visible, button:focus-visible, .code-panel:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 3px; }
.path-help { margin: 10px 28px 0; color: var(--vp-c-text-2); font-size: 12px; }
.summary { display: flex; gap: 20px; flex-wrap: wrap; margin: 20px 28px 14px; color: var(--vp-c-text-2); font-size: 13px; }
.image-locks { margin: 0 28px 22px; font-size: 12px; }
.image-locks span { display: flex; gap: 10px; padding: 8px 0; }
.image-locks code { word-break: break-all; }
.panel-heading { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--vp-c-divider); padding: 0 20px; }
.tabs { display: flex; gap: 2px; }
.tabs button { padding: 13px 10px; border-bottom: 2px solid transparent; color: var(--vp-c-text-2); font-size: 13px; white-space: nowrap; }
.tabs button.active { border-bottom-color: var(--vp-c-brand-1); color: var(--vp-c-brand-1); font-weight: 600; }
.copy-button { font-size: 12px; border: 1px solid var(--vp-c-divider); border-radius: 6px; padding: 5px 9px; }
.code-panel { max-height: 480px; overflow: auto; background: var(--vp-code-block-bg); padding: 22px 28px; }
.code-panel pre { margin: 0; font-size: 12px; line-height: 1.7; background: transparent; }
.code-panel pre code { color: var(--vp-c-text-1); background: transparent; padding: 0; }
.feedback { min-height: 18px; margin: 8px 28px; color: var(--vp-c-brand-1); font-size: 12px; }
.assistant-footer { display: flex; flex-wrap: wrap; gap: 20px; padding: 8px 28px 24px; font-size: 13px; }
.primary-link { background: var(--doc-action-bg); color: white !important; text-decoration: none; padding: 6px 12px; border-radius: 7px; }
@media (max-width: 640px) {
  .assistant-heading { flex-direction: column; padding: 20px; }
  .assistant h2 { font-size: 22px; }
  .controls { padding: 20px 20px 0; }
  .controls label { flex-basis: 100%; }
  .path-help, .summary, .image-locks { margin-left: 20px; margin-right: 20px; }
  .panel-heading { flex-wrap: wrap; gap: 8px; padding: 0 10px 10px; }
  .code-panel { padding: 18px; }
  .assistant-footer { padding: 8px 20px 20px; gap: 12px; }
}
</style>
