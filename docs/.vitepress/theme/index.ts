import DefaultTheme from 'vitepress/theme'
import { installUiLabels } from './ui-labels'
import ReproductionAssistant from './components/ReproductionAssistant.vue'
import EvidenceSummary from './components/EvidenceSummary.vue'
import './doc-baseline.css'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    installUiLabels(app)
    app.component('ReproductionAssistant', ReproductionAssistant)
    app.component('EvidenceSummary', EvidenceSummary)
  },
}
