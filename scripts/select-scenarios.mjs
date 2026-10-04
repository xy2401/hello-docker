import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const ids = fs.readdirSync(root + 'scenarios').filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort()
const selected = process.argv[2]
if (selected !== 'all' && !ids.includes(selected)) throw new Error('Unknown scenario selection')
const chosen = selected === 'all' ? ids : [selected]
console.log(JSON.stringify(chosen.map(id => ({ id, manifest: `scenarios/${id}.json`, evidence: `.artifacts/${id}` }))))
