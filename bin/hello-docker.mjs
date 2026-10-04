#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from '../scripts/lib/manifest.mjs'
import { makePlan, formatCommand } from '../scripts/lib/plan.mjs'
import { within } from '../scripts/lib/paths.mjs'
import { runScenario, actionsContext } from '../scripts/lib/runner.mjs'
import { checkEvidence, renderEvidence } from '../scripts/lib/evidence.mjs'
import { publishEvidence } from '../scripts/lib/publish.mjs'

const toolRoot = fileURLToPath(new URL('../', import.meta.url))
const [command, ...args] = process.argv.slice(2)
const options = {}
try {
  for (let i = 0; i < args.length; i++) {
    if (!/^--(?:manifest|root|output|evidence|shell|batch|json)$/.test(args[i]) || Object.hasOwn(options, args[i].slice(2))) throw new Error(`Unknown or duplicate option: ${args[i]}`)
    const name = args[i].slice(2)
    if (name === 'json') options[name] = true
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`); options[name] = args[++i] }
  }
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()))
  if (command === 'publish-evidence') {
    const context = actionsContext(root, toolRoot)
    const entries = options.batch ? JSON.parse(fs.readFileSync(within(root, options.batch, { exists: true }), 'utf8')) : [{ manifest: options.manifest, evidence: options.evidence }]
    console.log(JSON.stringify(publishEvidence(root, entries, { context }), null, 2))
  } else {
    if (!['check-manifest', 'plan', 'run', 'check-evidence', 'render-evidence'].includes(command) || !options.manifest) throw new Error('Usage: hello-docker <check-manifest|plan|run|check-evidence|render-evidence|publish-evidence> --manifest <relative.json> [--root <project>] [--output|--evidence <relative directory>] [--shell bash|powershell] [--json]')
    const manifest = loadManifest(root, options.manifest)
    if (command === 'check-manifest') console.log(JSON.stringify({ valid: true, id: manifest.id, images: manifest.resolvedImages }, null, 2))
    if (command === 'plan') {
      const shell = options.shell || 'bash'
      if (!['bash', 'powershell'].includes(shell)) throw new Error('shell must be bash or powershell')
      const plan = makePlan(root, manifest)
      console.log(options.json ? JSON.stringify(plan, null, 2) : ['# Actions reproduction plan; preview resource names', ...plan.prepare, plan.execute, ...plan.cleanup].map(step => typeof step === 'string' ? step : `# ${step.phase}\n${formatCommand(step, shell)}`).join('\n\n'))
    }
    if (command === 'run') {
      const context = actionsContext(root, toolRoot)
      const output = within(root, options.output || `.artifacts/${manifest.id}`)
      const controller = new AbortController()
      const abort = () => controller.abort()
      process.once('SIGINT', abort)
      process.once('SIGTERM', abort)
      const result = await runScenario(root, manifest, output, { context, signal: controller.signal })
      process.removeListener('SIGINT', abort)
      process.removeListener('SIGTERM', abort)
      console.log(JSON.stringify({ scenario: result.scenarioId, status: result.status, errors: result.errors, output }, null, 2))
      if (result.status !== 'passed') process.exitCode = 1
    }
    if (command === 'check-evidence' || command === 'render-evidence') {
      const directory = within(root, options.evidence, { exists: true })
      const result = command === 'check-evidence' ? checkEvidence(root, manifest, directory) : renderEvidence(root, manifest, directory).result
      console.log(JSON.stringify({ valid: true, scenario: result.scenarioId, sourceSha: result.source.sha }, null, 2))
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
