import fs from 'node:fs'
import { within } from './paths.mjs'

export const digestRef = /^(?:[a-z0-9][a-z0-9._:/-]*)(?:@[sS][hH][aA]256:[a-f0-9]{64})$/
const idPattern = /^[a-z][a-z0-9-]{0,47}$/
const stringList = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && !/[\0\r\n]/.test(item))
const requireValue = (pass, message) => { if (!pass) throw new Error(message) }

export function parseEnv(source) {
  const entries = source.split(/\r?\n/).filter(line => /^[A-Z][A-Z0-9_]*=/.test(line))
  const keys = entries.map(line => line.slice(0, line.indexOf('=')))
  requireValue(new Set(keys).size === keys.length, 'Duplicate image lock key')
  return Object.fromEntries(entries.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]))
}

export function loadManifest(root, manifestPath) {
  const spec = JSON.parse(fs.readFileSync(within(root, manifestPath, { exists: true }), 'utf8'))
  requireValue(spec.schemaVersion === 1, 'Unsupported manifest schemaVersion')
  requireValue(idPattern.test(spec.id), 'Invalid scenario id')
  requireValue(typeof spec.title === 'string' && spec.title.length > 0 && !/[\r\n]/.test(spec.title), 'Missing scenario title')
  requireValue(['container', 'build', 'compose'].includes(spec.kind), 'Unsupported scenario kind')
  requireValue(spec.platform === 'linux/amd64', 'v1 requires linux/amd64')
  requireValue(Number.isInteger(spec.timeoutMs) && spec.timeoutMs >= 1000 && spec.timeoutMs <= 600_000, 'timeoutMs must be 1000..600000')
  requireValue(spec.images && Object.keys(spec.images).length > 0, 'Missing locked images')
  const sourceFiles = []
  const images = Object.fromEntries(Object.entries(spec.images).map(([role, lock]) => {
    requireValue(/^[A-Za-z][A-Za-z0-9_]*$/.test(role), 'Invalid image role')
    let ref = lock.ref
    if (lock.envFile || lock.envKey) {
      requireValue(typeof lock.envFile === 'string' && typeof lock.envKey === 'string', 'Image requires envFile and envKey')
      ref = parseEnv(fs.readFileSync(within(root, lock.envFile, { exists: true }), 'utf8'))[lock.envKey]
      sourceFiles.push(lock.envFile)
    }
    requireValue(typeof ref === 'string' && digestRef.test(ref) && !/:(latest|edge|nightly)@/.test(ref), `Unpinned image: ${role}`)
    return [role, ref]
  }))
  const mounts = spec.mounts || []
  requireValue(Array.isArray(mounts), 'mounts must be an array')
  for (const mount of mounts) {
    within(root, mount.source, { exists: true })
    requireValue(mount.readOnly === true, 'v1 source mounts must be readOnly')
    requireValue(typeof mount.target === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(mount.target) && !mount.target.split('/').includes('..'), 'Invalid mount target')
    requireValue(!mount.source.includes(','), 'Mount paths cannot contain commas')
    sourceFiles.push(mount.source)
  }
  if (spec.kind !== 'compose') {
    requireValue(stringList(spec.command), 'command must be a nonempty argv array')
    if (spec.kind === 'container') requireValue(Object.hasOwn(images, spec.imageRole), 'Unknown runtime image role')
  }
  if (spec.kind === 'build') {
    requireValue(spec.build && spec.build.args && Object.keys(spec.build.args).length > 0, 'Missing build specification')
    within(root, spec.build.context, { exists: true })
    const dockerfile = within(root, spec.build.dockerfile, { exists: true })
    const dockerSource = fs.readFileSync(dockerfile, 'utf8')
    const instructions = dockerSource.replace(/\\\r?\n/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    requireValue(!/^\s*#\s*(?:syntax|escape)\s*=/im.test(dockerSource) && !instructions.some(line => /^ADD\s/i.test(line) || /^RUN\s+.*--mount=/i.test(line)), 'Custom Dockerfile frontends, ADD and RUN mounts are excluded in v1')
    const stages = new Set()
    for (const line of instructions.filter(line => /^FROM\s/i.test(line))) {
      const match = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i)
      requireValue(match, 'FROM must be a simple locked image ARG or previous stage')
      const variable = match[1].match(/^\$\{([A-Z][A-Z0-9_]*)\}$/)?.[1]
      requireValue((variable && Object.hasOwn(spec.build.args, variable)) || stages.has(match[1]), `Unpinned FROM: ${line}`)
      if (match[2]) stages.add(match[2])
    }
    requireValue(instructions.some(line => /^FROM\s/i.test(line)), 'Dockerfile has no FROM')
    for (const line of instructions.filter(line => /^COPY\s/i.test(line))) {
      const match = line.match(/\s--from=(\S+)/)
      if (match) requireValue(stages.has(match[1]), 'External COPY images are excluded in v1')
    }
    for (const [arg, role] of Object.entries(spec.build.args)) {
      requireValue(/^[A-Z][A-Z0-9_]*$/.test(arg) && Object.hasOwn(images, role), 'Unknown build image role')
    }
    sourceFiles.push(spec.build.context, spec.build.dockerfile)
  }
  if (spec.kind === 'compose') {
    requireValue(spec.compose && idPattern.test(spec.compose.exitService), 'Missing Compose exitService')
    const composeFile = within(root, spec.compose.file, { exists: true })
    const text = fs.readFileSync(composeFile, 'utf8')
    // Keep v1 templates explicit: every service image comes from a declared lock;
    // external volumes, static container names and host bind mounts are excluded.
    requireValue(!/^\s*(?:build|container_name|external|volumes|include|extends):/m.test(text), 'Unsupported Compose resource declaration')
    const imageLines = [...text.matchAll(/^\s*image:\s*\$\{([A-Za-z][A-Za-z0-9_]*)(?:\:[^}]*)?\}\s*$/gm)]
    requireValue(imageLines.length > 0 && imageLines.length === [...text.matchAll(/^\s*image:/gm)].length, 'Compose images must use declared image locks')
    requireValue(imageLines.every(match => Object.hasOwn(images, match[1])), 'Compose uses unknown image role')
    sourceFiles.push(spec.compose.file)
  }
  requireValue(Array.isArray(spec.assertions) && spec.assertions.length > 0, 'Missing business assertions')
  const assertionIds = new Set()
  for (const item of spec.assertions) {
    requireValue(idPattern.test(item.id) && !assertionIds.has(item.id), 'Invalid or duplicate assertion id')
    assertionIds.add(item.id)
    requireValue(['stdout', 'stderr'].includes(item.stream) && ['includes', 'equals'].includes(item.op) && typeof item.value === 'string' && item.value.length > 0, 'Invalid assertion')
  }
  const output = spec.output
  requireValue(output && /^(?:evidence\/[a-z0-9-]+|demos\/[a-z0-9-]+\/docker-pilot)$/.test(output.evidenceDir), 'Invalid evidence output allowlist')
  requireValue(/^docs\/(?:evidence\/[a-z0-9-]+|products\/[a-z0-9-]+\/docker-pilot)\.md$/.test(output.page), 'Invalid page output allowlist')
  within(root, output.evidenceDir)
  within(root, output.page)
  // Writing evidence into mounted/build inputs would invalidate its own hashes.
  for (const source of sourceFiles) {
    requireValue(output.evidenceDir !== source && !output.evidenceDir.startsWith(source + '/'), 'Evidence directory overlaps scenario sources')
  }
  return { ...spec, mounts, resolvedImages: images, manifestPath, sourceFiles: [...new Set(sourceFiles)] }
}

export function evaluateAssertions(manifest, stdout, stderr) {
  return manifest.assertions.map(item => {
    const actual = (item.stream === 'stdout' ? stdout : stderr).replace(/\r\n/g, '\n')
    return { ...item, passed: item.op === 'equals' ? actual.trimEnd() === item.value.trimEnd() : actual.includes(item.value) }
  })
}
