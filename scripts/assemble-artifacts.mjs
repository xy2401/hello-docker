import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadManifest } from './lib/manifest.mjs'
import { renderEvidence } from './lib/evidence.mjs'
import { within } from './lib/paths.mjs'
const root = process.cwd()
const batch = JSON.parse(execFileSync(process.execPath, ['scripts/select-scenarios.mjs', process.argv[2]], { encoding: 'utf8' }))
for (const item of batch) {
  const source = within(root, `.artifacts/downloads/hello-docker-${item.id}-${process.env.GITHUB_RUN_ID}`, { exists: true })
  const target = within(root, item.evidence)
  fs.mkdirSync(target, { recursive: true })
  for (const name of ['result.json', 'stdout.txt', 'stderr.txt', 'steps.json']) fs.copyFileSync(within(source, name, { exists: true }), path.join(target, name))
  const manifest = loadManifest(root, item.manifest)
  renderEvidence(root, manifest, target)
  // Build the newly generated pages from artifacts without changing tracked
  // placeholders in this checkout. The publish script writes the approved paths.
  fs.writeFileSync(within(root, `docs/evidence/preview-${item.id}.md`), fs.readFileSync(path.join(target, 'page.md')))
}
fs.writeFileSync(within(root, '.artifacts/batch.json'), JSON.stringify(batch, null, 2) + '\n')
