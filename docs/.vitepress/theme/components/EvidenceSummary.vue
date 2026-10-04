<script setup lang="ts">
import { withBase } from 'vitepress'
import catalog from '../data/catalog.json'
import { evidenceFor, hasActionsEvidence } from '../data/evidence'
</script>
<template>
  <table>
    <thead><tr><th>场景</th><th>证据状态</th><th>采集时间 / 源码</th></tr></thead>
    <tbody><tr v-for="scene in catalog" :key="scene.id"><td><a :href="withBase('/evidence/' + scene.id)">{{ scene.title }}</a></td><td>{{ hasActionsEvidence(evidenceFor(scene.id)) ? '已有 Actions 通过记录' : '待首次 Actions 验证' }}</td><td><template v-if="hasActionsEvidence(evidenceFor(scene.id))">{{ evidenceFor(scene.id).capturedAt }}<br /><code :title="evidenceFor(scene.id).source.sha">{{ evidenceFor(scene.id).source.sha.slice(0, 12) }}</code></template><template v-else>尚未采集</template></td></tr></tbody>
  </table>
</template>
