import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { evaluateAssertions } from './manifest.mjs'
import { inspectImage, checkComposeConfig } from './runner.mjs'
import { makePlan } from './plan.mjs'
import { sha256, sourceHashes, within, portableArgs } from './paths.mjs'

export function checkEvidence(root, manifest, directory, { allowFixture = false } = {}) {
  const read = name => fs.readFileSync(within(directory, name, { exists: true }), 'utf8')
  const result = JSON.parse(read('result.json'))
  assert.equal(result.schemaVersion, 1, 'Evidence schema')
  assert.equal(result.scenarioId, manifest.id, 'Scenario mismatch')
  assert.equal(result.kind, manifest.kind)
  assert.equal(result.platform, manifest.platform)
  assert.equal(result.status, 'passed', 'Failed evidence cannot be published')
  assert.equal(result.exitCode, 0, 'Nonzero scenario exit')
  assert(result.execution === 'github-actions' || (allowFixture && result.execution === 'fixture'), 'Fixture evidence cannot be published')
  assert(/^[a-f0-9]{40}$/.test(result.source?.sha), 'Missing source SHA')
  assert(/^[a-f0-9]{40}$/.test(result.toolSha), 'Missing tool SHA')
  assert(/^\d+$/.test(result.runId), 'Missing run id')
  assert(new URL(result.workflowUrl).pathname === `/${result.source.repository}/actions/runs/${result.runId}`, 'Invalid workflow provenance')
  assert(new URL(result.workflowUrl).origin === 'https://github.com', 'Unsupported workflow host')
  assert(Number.isFinite(Date.parse(result.capturedAt)) && /^\d{4}-\d{2}-\d{2}T/.test(result.capturedAt), 'Missing capture time')
  assert(result.engine?.Server?.Version, 'Missing Docker server metadata')
  assert(/^v\d+\.\d+\.\d+/.test(result.environment?.node || ''), 'Missing Node environment version')
  assert.deepEqual(result.errors, [], 'Evidence contains execution errors')
  assert.deepEqual(result.sourceHashes, sourceHashes(root, manifest), 'Evidence is stale for current sources')
  assert.deepEqual(Object.keys(result.artifacts).sort(), ['stderr.txt', 'stdout.txt', 'steps.json'], 'Unexpected artifact files')
  for (const [name, hash] of Object.entries(result.artifacts)) assert.equal(sha256(read(name)), hash, `Artifact changed: ${name}`)
  const steps = JSON.parse(read('steps.json'))
  assert(typeof result.workspace === 'string' && (path.posix.isAbsolute(result.workspace) || path.win32.isAbsolute(result.workspace)), 'Missing runner workspace')
  // Only workspace paths change between the runner and a downloaded artifact.
  // Preserve literal container argv and image references during comparison.
  const matches = (actual, expected) => JSON.stringify(portableArgs(actual, result.workspace)) === JSON.stringify(portableArgs(expected, fs.realpathSync(root)))
  const plan = makePlan(root, manifest, result.resourceId)
  const inspected = { phase: 'container-inspect', program: 'docker', args: ['inspect', plan.name], env: {} }
  const expectedSteps = [...plan.prepare, plan.execute, ...(manifest.kind === 'compose' ? [] : [inspected])]
  assert.equal(steps.length, expectedSteps.length + plan.cleanup.length, 'Unexpected execution steps')
  for (const expected of expectedSteps) {
    const records = steps.filter(step => step.phase === expected.phase && matches(step.args, expected.args))
    assert.equal(records.length, 1, `Missing or changed command: ${expected.phase}`)
    assert.deepEqual(records[0].env, expected.env, 'Command environment differs from plan')
    assert.equal(records[0].program, expected.program)
    assert.equal(records[0].exitCode, 0, 'Preparation/execute did not succeed')
    assert(!records[0].error && !records[0].timedOut && !records[0].truncated)
  }
  for (const expected of plan.cleanup) assert(steps.some(step => step.phase === 'cleanup' && matches(step.args, expected.args)), 'Missing expected resource cleanup')
  const executed = steps.filter(step => step.phase === 'execute')
  assert.equal(executed.length, 1, 'Missing or duplicate execution')
  assert.equal(executed[0].exitCode, 0)
  assert(!executed[0].error && !executed[0].timedOut && !executed[0].truncated, 'Execution did not complete')
  assert.equal(executed[0].stdout, read('stdout.txt'))
  assert.equal(executed[0].stderr, read('stderr.txt'))
  for (const [role, ref] of Object.entries(manifest.resolvedImages)) {
    const record = steps.find(step => step.phase === 'image' && step.args.at(-1) === ref)
    assert(record && record.exitCode === 0, `Missing inspect evidence: ${role}`)
    assert.deepEqual(result.images[role], inspectImage(record.stdout, ref, manifest.platform))
  }
  if (manifest.kind === 'build') {
    const built = steps.find(step => step.phase === 'built-image')
    assert(built && built.exitCode === 0, 'Missing built image')
    assert.deepEqual(result.builtImage, inspectImage(built.stdout, built.args.at(-1), manifest.platform))
  }
  if (manifest.kind === 'compose') {
    const configured = steps.find(step => step.phase === 'compose-config')
    assert(configured && configured.exitCode === 0)
    checkComposeConfig(configured.stdout, manifest)
    assert.equal(result.composeVersion, steps.find(step => step.phase === 'compose-version')?.stdout.trim())
    assert(result.composeVersion, 'Missing Compose version')
  } else {
    const container = JSON.parse(steps.find(step => step.phase === 'container-inspect').stdout)[0]
    assert(container?.State?.Running === false && container.State.ExitCode === 0, 'Container completion evidence is missing')
  }
  assert.deepEqual(result.assertions, evaluateAssertions(manifest, read('stdout.txt'), read('stderr.txt')))
  assert(result.assertions.length > 0 && result.assertions.every(item => item.passed), 'Business assertions did not pass')
  assert(result.cleanup.length > 0 && result.cleanup.every(step => step.exitCode === 0 || /No such (?:container|image)|not found|No resource found/i.test(step.stderr || '')), 'Cleanup failed')
  assert.deepEqual(result.cleanup, steps.filter(step => step.phase === 'cleanup'), 'Cleanup evidence mismatch')
  return result
}

const escape = value => String(value).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])
const codeBlock = value => {
  const fences = [...String(value).matchAll(/`+/g)].map(match => match[0].length)
  const fence = '`'.repeat(Math.max(3, ...fences.map(size => size + 1)))
  return `${fence}text\n${value.trimEnd()}\n${fence}`
}

export function renderEvidence(root, manifest, directory, options) {
  const result = checkEvidence(root, manifest, directory, options)
  const metadata = `---\nstatus: verified\ncapturedAt: ${JSON.stringify(result.capturedAt)}\ndockerImage: ${JSON.stringify(Object.values(manifest.resolvedImages).join(', '))}\nexitCode: 0\nsourceSha: ${JSON.stringify(result.source.sha)}\ntoolSha: ${JSON.stringify(result.toolSha)}\nworkflowUrl: ${JSON.stringify(result.workflowUrl)}\n---\n`
  const stdout = fs.readFileSync(path.join(directory, 'stdout.txt'), 'utf8')
  const stderr = fs.readFileSync(path.join(directory, 'stderr.txt'), 'utf8')
  const snapshots = {
    'session.out.txt': metadata + `## stdout\n${stdout}\n## stderr\n${stderr}\n`,
    'inventory.out.txt': metadata + JSON.stringify({ engine: result.engine, images: result.images, builtImage: result.builtImage }, null, 2) + '\n',
    'assert.out.txt': metadata + result.assertions.map(item => `PASS ${item.id}`).join('\n') + '\nRESULT: all assertions passed\n',
  }
  const page = `# ${escape(manifest.title)}：Actions 验证证据\n\n` +
    `此页面由通过校验的 GitHub Actions 结果生成。原有 Docker 采集结果保留在原目录，本页只表示本试点场景。\n\n` +
    `- 采集时间：${result.capturedAt}\n- 源码提交：\`${result.source.sha}\`\n- 公共工具提交：\`${result.toolSha}\`\n- 平台：\`${result.platform}\`\n- [工作流与完整日志](${result.workflowUrl})\n\n` +
    `## 镜像与环境\n\n${codeBlock(JSON.stringify({ images: result.images, docker: result.engine.Server.Version, compose: result.composeVersion, environment: result.environment }, null, 2))}\n\n` +
    `## 执行结果\n\n退出码：0；场景耗时：${result.timeMs} ms。\n\n### stdout\n\n${codeBlock(stdout)}\n\n### stderr\n\n${codeBlock(stderr || '（空）')}\n\n` +
    `## 业务断言\n\n${result.assertions.map(item => `- 通过：\`${item.id}\``).join('\n')}\n\n` +
    `## 证据边界\n\n结果对应上述源码、镜像和工具版本。后续源码变化不会自动赋予旧结果新的有效性；需重新运行工作流。\n`
  for (const [name, content] of Object.entries(snapshots)) fs.writeFileSync(path.join(directory, name), content)
  fs.writeFileSync(path.join(directory, 'page.md'), page)
  return { result, page, snapshots }
}
