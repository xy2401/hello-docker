import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadManifest } from './manifest.mjs'
import { renderEvidence } from './evidence.mjs'
import { within, slash } from './paths.mjs'

export function allowedPublicationPath(file, manifests) {
  return manifests.some(manifest => file === manifest.output.page || file.startsWith(manifest.output.evidenceDir + '/'))
}

export function preparePublication(root, entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Empty publication batch')
  const prepared = entries.map(entry => {
    const manifest = loadManifest(root, entry.manifest)
    const directory = within(root, entry.evidence, { exists: true })
    return { manifest, directory, ...renderEvidence(root, manifest, directory) }
  })
  if (new Set(prepared.map(item => item.manifest.id)).size !== prepared.length) throw new Error('Duplicate publication scenario')
  if (new Set(prepared.map(item => item.result.source.sha)).size !== 1) throw new Error('Publication spans different source commits')
  const destinations = prepared.flatMap(item => [item.manifest.output.evidenceDir, item.manifest.output.page])
  if (new Set(destinations).size !== destinations.length) throw new Error('Publication destination collision')
  return prepared
}

export function publishEvidence(root, entries, { context, git } = {}) {
  if (!context) throw new Error('Missing Actions publication context')
  const prepared = preparePublication(root, entries)
  const sourceSha = prepared[0].result.source.sha
  if (context.sourceSha !== sourceSha || prepared.some(item => item.result.toolSha !== context.toolSha || item.result.source.repository !== context.repository || item.result.runId !== context.runId || item.result.source.branch !== context.branch)) throw new Error('Publication provenance does not match this workflow')
  const runGit = git || (args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim())
  if (runGit(['rev-parse', 'HEAD']) !== sourceSha) throw new Error('Source branch changed before publication')
  if (runGit(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Publication checkout contains tracked changes')
  const branch = context.branch
  if (typeof branch !== 'string' || !branch || /[\r\n\0]/.test(branch) || branch.startsWith('-')) throw new Error('Invalid publication branch')
  const remote = runGit(['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`]).split(/\s/)[0]
  if (remote !== sourceSha) throw new Error('Remote branch advanced; artifacts retained, rerun against the new source')
  const files = ['result.json', 'stdout.txt', 'stderr.txt', 'steps.json', 'inventory.out.txt', 'session.out.txt', 'assert.out.txt']
  for (const item of prepared) {
    const destination = within(root, item.manifest.output.evidenceDir)
    fs.mkdirSync(destination, { recursive: true })
    const history = `${item.manifest.output.evidenceDir}/runs/${item.result.runId}-${item.result.resourceId}`
    const historyPath = within(root, history)
    if (fs.existsSync(historyPath)) throw new Error('Historical snapshot already exists; do not overwrite it')
    fs.mkdirSync(historyPath, { recursive: true })
    for (const name of files) {
      const source = within(item.directory, name, { exists: true })
      fs.copyFileSync(source, within(root, `${item.manifest.output.evidenceDir}/${name}`))
      fs.copyFileSync(source, within(root, `${history}/${name}`))
    }
    const page = within(root, item.manifest.output.page)
    fs.mkdirSync(path.dirname(page), { recursive: true })
    fs.writeFileSync(page, item.page)
  }
  const manifests = prepared.map(item => item.manifest)
  const destinations = manifests.flatMap(manifest => [manifest.output.evidenceDir, manifest.output.page])
  runGit(['add', '--', ...destinations])
  const staged = runGit(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean).map(slash)
  if (staged.some(file => !allowedPublicationPath(file, manifests))) throw new Error('Staged changes exceed evidence allowlist')
  if (!staged.length) return { committed: false, files: [] }
  runGit(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `chore: update Docker pilot evidence (run ${context.runId})`])
  // A normal push rejects a later race. No rebase or force push of stale evidence.
  runGit(['push', 'origin', `HEAD:refs/heads/${branch}`])
  return { committed: true, files: staged }
}
