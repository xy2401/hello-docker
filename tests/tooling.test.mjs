import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadManifest, parseEnv } from '../scripts/lib/manifest.mjs'
import { makePlan, formatCommand } from '../scripts/lib/plan.mjs'
import { within, sha256, sourceHashes, portableArgs } from '../scripts/lib/paths.mjs'
import { runScenario, inspectImage, checkComposeConfig } from '../scripts/lib/runner.mjs'
import { checkEvidence, renderEvidence } from '../scripts/lib/evidence.mjs'
import { publishEvidence, allowedPublicationPath } from '../scripts/lib/publish.mjs'
import { executeProcess } from '../scripts/lib/process.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))
const context = { repository: 'xy2401/hello-docker', sourceSha: 'a'.repeat(40), toolSha: 'b'.repeat(40), branch: 'main', runId: '123', attempt: '1', workflowUrl: 'https://github.com/xy2401/hello-docker/actions/runs/123' }
function fixture(t, id = 'container-basics') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-docker-test-'))
  t.after(() => {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'hello-docker-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(root, 'scenarios'))
  fs.copyFileSync(path.join(project, '.env.versions'), path.join(root, '.env.versions'))
  fs.copyFileSync(path.join(project, 'scenarios', id + '.json'), path.join(root, 'scenarios', id + '.json'))
  if (id === 'image-build' || id === 'compose-http') fs.cpSync(path.join(project, 'labs'), path.join(root, 'labs'), { recursive: true })
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true })
  const manifest = loadManifest(root, `scenarios/${id}.json`)
  return { root, manifest, output: path.join(root, '.artifacts', id) }
}
const outputFor = id => id === 'image-build' ? 'artifact=hello-docker\nbuild-only=absent\n' : id === 'compose-http' ? 'http=200\npayload=hello-docker\n' : 'container=hello-docker\nproc=readable\nGNU bash, version 5.2.37\n'
function executor(manifest, modify = () => {}) {
  const calls = []
  const fn = async (program, args, options) => {
    calls.push({ program, args, options })
    let stdout = ''
    if (args[0] === 'version') stdout = JSON.stringify({ Client: { Version: 'test' }, Server: { Version: 'test-fixture' } })
    if (args[0] === 'image' && args[1] === 'inspect') stdout = JSON.stringify([{ Id: 'sha256:' + 'c'.repeat(64), Os: 'linux', Architecture: 'amd64', RepoDigests: args.at(-1).includes('@') ? [args.at(-1)] : [] }])
    if (args[0] === 'inspect') stdout = JSON.stringify([{ State: { Running: false, ExitCode: 0 } }])
    if (args[0] === 'compose' && args.includes('version')) stdout = 'test-compose-fixture\n'
    if (args.includes('config')) stdout = JSON.stringify({ services: { server: { image: manifest.resolvedImages.PYTHON_IMAGE }, client: { image: manifest.resolvedImages.PYTHON_IMAGE } } })
    if (args[0] === 'run' || args.includes('up')) stdout = outputFor(manifest.id)
    const result = { stdout, stderr: '', exitCode: 0, error: null, timedOut: false, truncated: false, timeMs: 1, signal: null }
    modify(args, result)
    return result
  }
  return { fn, calls }
}
async function runFixture(t, id, modify) {
  const state = fixture(t, id)
  const execute = executor(state.manifest, modify)
  const result = await runScenario(state.root, state.manifest, state.output, { context, execute: execute.fn })
  return { ...state, result, ...execute }
}
function replaceResult(state, mutate) {
  mutate(state.result)
  fs.writeFileSync(path.join(state.output, 'result.json'), JSON.stringify(state.result))
}

test('all three own scenarios are offline-loadable and produce bounded plans', t => {
  for (const id of ['container-basics', 'image-build', 'compose-http']) {
    const { root, manifest } = fixture(t, id)
    const plan = makePlan(root, manifest)
    assert(plan.prepare.some(step => step.phase === 'pull'))
    assert(plan.cleanup.every(step => !step.args.includes('prune')))
    assert(!plan.execute.args.includes('--privileged'))
  }
})
test('rejects floating locks, duplicate env keys and unknown image roles', t => {
  assert.throws(() => parseEnv('A_IMAGE=x\nA_IMAGE=y'), /Duplicate/)
  const { root } = fixture(t)
  fs.writeFileSync(path.join(root, '.env.versions'), 'BASH_IMAGE=bash:latest\n')
  assert.throws(() => loadManifest(root, 'scenarios/container-basics.json'), /Unpinned/)
})
test('rejects traversal and protected/output paths', t => {
  const { root } = fixture(t)
  for (const name of ['../outside', '.git/config', 'node_modules/test', 'C:\\outside', '/outside', 'bad\nfile']) assert.throws(() => within(root, name))
  assert.throws(() => makePlan(root, loadManifest(root, 'scenarios/container-basics.json'), 'bad;rm'), /Invalid run id/)
})
test('rejects unpinned Dockerfile stages', t => {
  const { root } = fixture(t, 'image-build')
  fs.writeFileSync(path.join(root, 'labs/build/Dockerfile'), 'FROM bash:latest\n')
  assert.throws(() => loadManifest(root, 'scenarios/image-build.json'), /Unpinned FROM/)
})
test('rejects unsafe Compose resources after interpolation', t => {
  const { manifest } = fixture(t, 'compose-http')
  assert.throws(() => checkComposeConfig(JSON.stringify({ services: { client: { image: manifest.resolvedImages.PYTHON_IMAGE, volumes: ['/:/host'] } } }), manifest), /Unsupported/)
})
test('PowerShell and Bash preserve quotes, dollars and backticks as literal argv', () => {
  const step = { program: 'docker', args: ["a'b $HOME `whoami`", 'path with spaces'] }
  assert.match(formatCommand(step, 'bash'), /a'"'"'b \$HOME `whoami`/)
  assert.match(formatCommand(step, 'powershell'), /^& 'docker' 'a''b \$HOME `whoami`'/)
  for (const shell of ['bash', 'powershell']) assert(formatCommand(step, shell).includes("'path with spaces'"))
})
test('image inspect requires the locked digest and declared platform', () => {
  const inspect = JSON.stringify([{ Id: 'sha256:' + 'c'.repeat(64), Os: 'linux', Architecture: 'arm64', RepoDigests: [] }])
  assert.throws(() => inspectImage(inspect, 'bash@sha256:' + 'd'.repeat(64), 'linux/amd64'), /platform/)
})
for (const id of ['container-basics', 'image-build', 'compose-http']) test(`${id}: fixture pipeline records and validates results without Docker`, async t => {
  const state = await runFixture(t, id)
  assert.equal(state.result.status, 'passed')
  assert.equal(state.result.execution, 'fixture')
  assert.equal(checkEvidence(state.root, state.manifest, state.output, { allowFixture: true }).scenarioId, id)
  assert.throws(() => checkEvidence(state.root, state.manifest, state.output), /Fixture/)
  assert(state.calls.some(call => call.args.includes('rm') || call.args.includes('down')))
})
test('nonzero exit is failed and resources are cleaned', async t => {
  const state = await runFixture(t, 'container-basics', (args, result) => { if (args[0] === 'run') { result.exitCode = 7; result.stderr = 'intentional fixture failure' } })
  assert.equal(state.result.status, 'failed')
  assert.equal(state.result.exitCode, 7)
  assert(state.calls.some(call => call.args[0] === 'rm'))
})
test('zero exit with incorrect business output is still failed', async t => {
  const state = await runFixture(t, 'container-basics', (args, result) => { if (args[0] === 'run') result.stdout = 'wrong result' })
  assert.equal(state.result.status, 'failed')
  assert(state.result.errors.includes('Business assertions failed'))
})
test('timeout cleans resources with a separate cleanup deadline', async t => {
  const state = await runFixture(t, 'container-basics', (args, result) => { if (args[0] === 'run') { result.timedOut = true; result.error = 'Execution timed out'; result.exitCode = -1 } })
  assert.equal(state.result.status, 'failed')
  const cleanup = state.calls.find(call => call.args[0] === 'rm')
  assert.equal(cleanup.options.timeoutMs, 30_000)
  assert.equal(cleanup.options.signal, undefined)
})
test('cleanup failure prevents successful evidence', async t => {
  const state = await runFixture(t, 'container-basics', (args, result) => { if (args[0] === 'rm') { result.exitCode = 1; result.stderr = 'permission denied' } })
  assert.equal(state.result.status, 'failed')
})
test('changed output and changed sources invalidate evidence', async t => {
  const state = await runFixture(t, 'container-basics')
  fs.appendFileSync(path.join(state.output, 'stdout.txt'), 'tampered')
  assert.throws(() => checkEvidence(state.root, state.manifest, state.output, { allowFixture: true }), /Artifact changed/)
  fs.writeFileSync(path.join(state.output, 'stdout.txt'), outputFor(state.manifest.id))
  fs.appendFileSync(path.join(state.root, '.env.versions'), '# changed\n')
  assert.throws(() => checkEvidence(state.root, state.manifest, state.output, { allowFixture: true }), /stale/)
})
test('renders one metadata block and keeps stderr separate', async t => {
  const state = await runFixture(t, 'container-basics')
  const rendered = renderEvidence(state.root, state.manifest, state.output, { allowFixture: true })
  assert.equal((rendered.snapshots['session.out.txt'].match(/^---$/gm) || []).length, 2)
  assert.match(rendered.page, /### stdout[\s\S]*### stderr/)
  assert.throws(() => renderEvidence(state.root, state.manifest, state.output), /Fixture/)
})
test('publication rejects a moved remote before writing tracked destinations', async t => {
  const state = await runFixture(t, 'container-basics')
  // A transient unit fixture exercises the publisher; it is never saved as a
  // repository snapshot or presented as an actual Actions run.
  replaceResult(state, result => { result.execution = 'github-actions' })
  const calls = []
  const git = args => { calls.push(args); return args[0] === 'rev-parse' ? context.sourceSha : args[0] === 'ls-remote' ? 'f'.repeat(40) + '\trefs/heads/main' : '' }
  assert.throws(() => publishEvidence(state.root, [{ manifest: state.manifest.manifestPath, evidence: '.artifacts/container-basics' }], { context, git }), /Remote branch advanced/)
  assert(!fs.existsSync(path.join(state.root, 'evidence/container-basics')))
  assert(!calls.some(args => args[0] === 'push'))
})
test('publication rejects staged changes outside its allowlist', async t => {
  const state = await runFixture(t, 'container-basics')
  replaceResult(state, result => { result.execution = 'github-actions' })
  const git = args => args[0] === 'rev-parse' ? context.sourceSha : args[0] === 'ls-remote' ? context.sourceSha + '\trefs/heads/main' : args[0] === 'diff' ? 'README.md\0' : ''
  assert.throws(() => publishEvidence(state.root, [{ manifest: state.manifest.manifestPath, evidence: '.artifacts/container-basics' }], { context, git }), /allowlist/)
  assert(allowedPublicationPath('evidence/container-basics/result.json', [state.manifest]))
  assert(!allowedPublicationPath('evidence/container-basics-else/result.json', [state.manifest]))
})
test('local run command rejects execution before invoking Docker', t => {
  const { root } = fixture(t)
  const env = { ...process.env, GITHUB_ACTIONS: '' }
  const result = spawnSync(process.execPath, [path.join(project, 'bin/hello-docker.mjs'), 'run', '--root', root, '--manifest', 'scenarios/container-basics.json'], { env, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /GitHub Actions runner/)
})
test('process runner passes literal argv without a host shell', async () => {
  const result = await executeProcess(process.execPath, ['-e', 'console.log(process.argv[1])', 'literal $HOME `cmd`'], { timeoutMs: 3000 })
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.trim(), 'literal $HOME `cmd`')
})
test('process runner terminates a hanging fixture', async () => {
  const result = await executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 })
  assert.equal(result.timedOut, true)
  assert(result.error)
})
test('process runner marks overflowing output as failed', async () => {
  const result = await executeProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000))"], { timeoutMs: 3000, maxBytes: 1000 })
  assert.equal(result.truncated, true)
})

test('downloaded evidence accepts a relocated source workspace', async t => {
  const state = await runFixture(t, 'image-build')
  const relocated = fixture(t, 'image-build')
  assert.equal(checkEvidence(relocated.root, relocated.manifest, state.output, { allowFixture: true }).status, 'passed')
})

test('altered command argv cannot pass by updating only the artifact hash', async t => {
  const state = await runFixture(t, 'container-basics')
  const file = path.join(state.output, 'steps.json')
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'))
  steps.find(step => step.phase === 'execute').args.push('unexpected')
  fs.writeFileSync(file, JSON.stringify(steps))
  replaceResult(state, result => { result.artifacts['steps.json'] = sha256(fs.readFileSync(file)) })
  assert.throws(() => checkEvidence(state.root, state.manifest, state.output, { allowFixture: true }), /changed command/)
})

test('build contexts cannot silently omit protected directories from hashes', t => {
  const { root, manifest } = fixture(t, 'image-build')
  fs.mkdirSync(path.join(root, 'labs/build/node_modules'))
  assert.throws(() => sourceHashes(root, manifest), /Protected source directory/)
})

test('external build stages and custom frontends are rejected', t => {
  const { root } = fixture(t, 'image-build')
  for (const extra of ['# syntax=docker/dockerfile:1\n', 'COPY --from=alpine:latest /foo /foo\n', 'ADD https://example.com/file /file\n']) {
    const locked = 'ARG BASE_IMAGE\nFROM ${BASE_IMAGE} AS final\n'
    fs.writeFileSync(path.join(root, 'labs/build/Dockerfile'), extra.startsWith('#') ? extra + locked : locked + extra)
    assert.throws(() => loadManifest(root, 'scenarios/image-build.json'), /excluded/)
  }
})

test('publication retains legacy snapshots and writes one immutable run directory', async t => {
  const state = await runFixture(t, 'container-basics')
  replaceResult(state, result => { result.execution = 'github-actions' })
  const legacy = path.join(state.root, 'evidence/container-basics/runs/older')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'stdout.txt'), 'existing historical evidence')
  const calls = []
  const git = args => {
    calls.push(args)
    if (args[0] === 'rev-parse') return context.sourceSha
    if (args[0] === 'ls-remote') return context.sourceSha + '\trefs/heads/main'
    if (args[0] === 'diff') return 'evidence/container-basics/result.json\0docs/evidence/container-basics.md\0'
    return ''
  }
  const result = publishEvidence(state.root, [{ manifest: state.manifest.manifestPath, evidence: '.artifacts/container-basics' }], { context, git })
  assert.equal(result.committed, true)
  assert.equal(fs.readFileSync(path.join(legacy, 'stdout.txt'), 'utf8'), 'existing historical evidence')
  assert(fs.existsSync(path.join(state.root, `evidence/container-basics/runs/${context.runId}-${state.result.resourceId}/result.json`)))
  assert.deepEqual(calls.find(args => args[0] === 'push'), ['push', 'origin', 'HEAD:refs/heads/main'])
  assert.throws(() => publishEvidence(state.root, [{ manifest: state.manifest.manifestPath, evidence: '.artifacts/container-basics' }], { context, git }), /already exists/)
})

test('portable paths retain command backslashes and match Windows/Linux mount sources', () => {
  const command = "printf 'container=hello-docker\\n'"
  assert.deepEqual(portableArgs(['C:\\repo\\labs\\Dockerfile', 'type=bind,source=C:\\repo\\labs\\file,target=/demo,readonly', command], 'C:\\repo'), ['<project-root>/labs/Dockerfile', 'type=bind,source=<project-root>/labs/file,target=/demo,readonly', command])
  assert.deepEqual(portableArgs(['/repo/labs/Dockerfile', 'type=bind,source=/repo/labs/file,target=/demo,readonly', command], '/repo'), ['<project-root>/labs/Dockerfile', 'type=bind,source=<project-root>/labs/file,target=/demo,readonly', command])
})

test('unexpected cleanup commands cannot be inserted into successful evidence', async t => {
  const state = await runFixture(t, 'container-basics')
  const file = path.join(state.output, 'steps.json')
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'))
  const extra = { ...steps.find(step => step.phase === 'cleanup'), args: ['system', 'prune'] }
  steps.push(extra)
  fs.writeFileSync(file, JSON.stringify(steps))
  replaceResult(state, result => { result.cleanup.push(extra); result.artifacts['steps.json'] = sha256(fs.readFileSync(file)) })
  assert.throws(() => checkEvidence(state.root, state.manifest, state.output, { allowFixture: true }), /Unexpected execution steps/)
})
