import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './lib/manifest.mjs'
import { makePlan } from './lib/plan.mjs'
import { within, portableArgs } from './lib/paths.mjs'
const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const entries = fs.readdirSync(path.join(root, 'scenarios')).filter(name => name.endsWith('.json')).sort().map(name => {
  const manifest = loadManifest(root, `scenarios/${name}`)
  const plan = makePlan(root, manifest)
  // A tracked catalog must be byte-identical on Windows and Linux; runtime paths
  // are supplied by the reader, not persisted from the build machine.
  const portable = step => ({ ...step, args: portableArgs(step.args, root) })
  const configFiles = [manifest.manifestPath, manifest.build?.dockerfile, manifest.compose?.file].filter(Boolean)
  return {
    id: manifest.id, title: manifest.title, kind: manifest.kind, platform: manifest.platform,
    manifest: JSON.parse(fs.readFileSync(within(root, manifest.manifestPath), 'utf8')),
    images: manifest.resolvedImages, output: manifest.output,
    prepare: plan.prepare.map(portable), execute: portable(plan.execute), cleanup: plan.cleanup.map(portable),
    configs: configFiles.map(file => ({ file, text: fs.readFileSync(within(root, file), 'utf8').replace(/\r\n/g, '\n') })),
  }
})
const destination = path.join(root, 'docs/.vitepress/theme/data/catalog.json')
fs.mkdirSync(path.dirname(destination), { recursive: true })
const content = JSON.stringify(entries, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== content) throw new Error('Scenario catalog drift; run node scripts/build-catalog.mjs')
} else fs.writeFileSync(destination, content)
console.log(`Scenario catalog: ${entries.length} entries`)
