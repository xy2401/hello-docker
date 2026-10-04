import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './lib/manifest.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const manifests = fs.readdirSync(path.join(root, 'scenarios')).filter(name => name.endsWith('.json')).map(name => loadManifest(root, `scenarios/${name}`))
if (new Set(manifests.map(item => item.id)).size !== manifests.length) throw new Error('Duplicate scenario id')
const docs = path.join(root, 'docs')
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === '.vitepress' || entry.name === 'public') return []
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : entry.name.endsWith('.md') ? [file] : []
})
let links = 0
const pages = walk(docs)
for (const file of pages) {
  const content = fs.readFileSync(file, 'utf8')
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  if (path.basename(file) !== 'index.md' || path.dirname(file) !== docs) {
    if ((body.match(/^# /gm) || []).length !== 1) throw new Error(`Expected one title: ${file}`)
  } else if (/^# /m.test(body)) throw new Error('Home body duplicates Hero heading')
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const url = match[1]
    if (/^(https?:|#)/.test(url)) continue
    const route = url.split(/[?#]/)[0]
    const target = route.startsWith('/') ? path.resolve(docs, '.' + route) : path.resolve(path.dirname(file), route)
    if (![target, target + '.md', path.join(target, 'index.md')].some(fs.existsSync)) throw new Error(`Missing link ${url} in ${file}`)
    links++
  }
}
for (const item of manifests) if (!fs.existsSync(path.join(root, item.output.page))) throw new Error(`Missing evidence placeholder: ${item.id}`)
console.log(JSON.stringify({ manifests: manifests.length, pages: pages.length, localLinks: links, containerExecution: false }))
