import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { makePlan } from './plan.mjs'
import { evaluateAssertions } from './manifest.mjs'
import { executeProcess } from './process.mjs'
import { sha256, sourceHashes } from './paths.mjs'

export function actionsContext(root, toolRoot) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') throw new Error('Container execution and publication require a Linux GitHub Actions runner; use plan locally.')
  const gitSha = directory => execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 }).trim()
  const sourceSha = gitSha(root)
  const toolSha = process.env.HELLO_DOCKER_TOOL_SHA || gitSha(toolRoot)
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^[a-f0-9]{40}$/.test(toolSha)) throw new Error('Source and tool must reference full commit SHAs')
  if (fs.existsSync(path.join(toolRoot, '.git')) && gitSha(toolRoot) !== toolSha) throw new Error('Tool checkout does not match the declared tool SHA')
  if (process.env.GITHUB_SHA !== sourceSha) throw new Error('Checkout does not match the workflow source SHA')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(process.env.GITHUB_REPOSITORY || '') || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw new Error('Missing Actions provenance')
  return {
    repository: process.env.GITHUB_REPOSITORY,
    sourceSha, toolSha,
    branch: process.env.GITHUB_REF_NAME,
    workflowUrl: `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
  }
}

export function inspectImage(output, reference, platform) {
  const image = JSON.parse(output)[0]
  const [os, arch] = platform.split('/')
  if (!image || image.Os !== os || image.Architecture !== arch || !/^sha256:[a-f0-9]{64}$/.test(image.Id)) throw new Error(`Image platform/id mismatch: ${reference}`)
  const digest = reference.split('@')[1]
  if (digest && !image.RepoDigests?.some(ref => ref.endsWith('@' + digest))) throw new Error(`Pulled image digest mismatch: ${reference}`)
  return { ref: reference, id: image.Id, os: image.Os, arch: image.Architecture, repoDigests: image.RepoDigests || [] }
}

export function checkComposeConfig(output, manifest) {
  const config = JSON.parse(output)
  if (!config.services?.[manifest.compose.exitService]) throw new Error('Compose exit service is absent')
  const allowed = new Set(Object.values(manifest.resolvedImages))
  for (const [name, service] of Object.entries(config.services)) {
    if (!allowed.has(service.image) || service.build || service.container_name || service.volumes?.length || service.privileged || service.network_mode === 'host') throw new Error(`Unsupported Compose service: ${name}`)
  }
  if (Object.values(config.volumes || {}).some(volume => volume.external) || Object.values(config.networks || {}).some(network => network.external)) throw new Error('External Compose resources are excluded')
}

export async function runScenario(root, manifest, outputDir, { context, execute = executeProcess, signal } = {}) {
  if (!context) throw new Error('Missing execution context')
  fs.mkdirSync(outputDir, { recursive: true })
  const hashes = sourceHashes(root, manifest)
  const runId = `${context.runId}-${context.attempt}-${randomUUID().slice(0, 8)}`.toLowerCase()
  const plan = makePlan(root, manifest, runId)
  const started = Date.now()
  const steps = []
  const images = {}
  const errors = []
  let engine = null
  let execution = null
  let cleanupNeeded = false
  let builtImage = null
  let composeVersion = null
  const call = async (step, cleanup = false) => {
    const remaining = manifest.timeoutMs - (Date.now() - started)
    if (!cleanup && (remaining <= 0 || signal?.aborted)) throw new Error(signal?.aborted ? 'Execution cancelled' : 'Scenario deadline exceeded')
    const result = await execute(step.program, step.args, { cwd: root, env: step.env, timeoutMs: cleanup ? 30_000 : Math.max(1, remaining), signal: cleanup ? undefined : signal })
    const record = { ...step, ...result }
    steps.push(record)
    if (result.exitCode !== 0 || result.error || result.timedOut || result.truncated) {
      if (cleanup && /No such (?:container|image)|not found|No resource found/i.test(result.stderr || '')) return record
      throw new Error(`${step.phase}: ${result.error || result.stderr?.trim() || `exit ${result.exitCode}`}`)
    }
    return record
  }
  try {
    for (const step of plan.prepare) {
      if (step.phase === 'build' || step.phase === 'compose-config') cleanupNeeded = true
      const record = await call(step)
      if (step.phase === 'engine') {
        engine = JSON.parse(record.stdout)
        if (!engine.Server?.Version) throw new Error('Docker server is unavailable')
      }
      if (step.phase === 'image') {
        const ref = step.args.at(-1)
        const image = inspectImage(record.stdout, ref, manifest.platform)
        for (const [role, value] of Object.entries(manifest.resolvedImages)) if (value === ref) images[role] = image
      }
      if (step.phase === 'built-image') builtImage = inspectImage(record.stdout, step.args.at(-1), manifest.platform)
      if (step.phase === 'compose-version') composeVersion = record.stdout.trim()
      if (step.phase === 'compose-config') checkComposeConfig(record.stdout, manifest)
    }
    cleanupNeeded = true
    execution = await call(plan.execute)
    if (manifest.kind !== 'compose') {
      const inspected = await call({ phase: 'container-inspect', program: 'docker', args: ['inspect', plan.name], env: {} })
      const container = JSON.parse(inspected.stdout)[0]
      if (!container || container.State?.Running !== false || container.State.ExitCode !== 0) throw new Error('Container did not complete successfully')
    }
  } catch (error) {
    errors.push(error.message)
    execution ||= steps.findLast(step => step.phase === 'execute') || null
  } finally {
    if (cleanupNeeded) for (const step of plan.cleanup) {
      try { await call(step, true) } catch (error) { errors.push(error.message) }
    }
  }
  const stdout = execution?.stdout || ''
  const stderr = execution?.stderr || ''
  const assertions = evaluateAssertions(manifest, stdout, stderr)
  if (assertions.some(item => !item.passed)) errors.push('Business assertions failed')
  try {
    if (JSON.stringify(sourceHashes(root, manifest)) !== JSON.stringify(hashes)) errors.push('Scenario sources changed during execution')
  } catch (error) { errors.push(`Scenario sources unavailable after execution: ${error.message}`) }
  const status = errors.length === 0 && execution?.exitCode === 0 ? 'passed' : 'failed'
  const files = {
    'stdout.txt': stdout,
    'stderr.txt': stderr,
    'steps.json': JSON.stringify(steps, null, 2) + '\n',
  }
  const result = {
    schemaVersion: 1, scenarioId: manifest.id, kind: manifest.kind, platform: manifest.platform,
    execution: execute === executeProcess ? 'github-actions' : 'fixture',
    status, resourceId: runId, workspace: fs.realpathSync(root), capturedAt: new Date().toISOString(), timeMs: Date.now() - started,
    source: { repository: context.repository, sha: context.sourceSha, branch: context.branch },
    toolSha: context.toolSha, workflowUrl: context.workflowUrl, runId: context.runId,
    engine, images, builtImage, composeVersion,
    environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(), runnerImage: process.env.ImageOS || null, runnerImageVersion: process.env.ImageVersion || null },
    exitCode: execution?.exitCode ?? -1,
    assertions, cleanup: steps.filter(step => step.phase === 'cleanup'), errors,
    sourceHashes: hashes, artifacts: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, sha256(value)])),
  }
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(outputDir, name), value)
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
