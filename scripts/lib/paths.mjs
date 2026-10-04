import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const slash = value => value.split(path.sep).join('/')

export function portableArgs(args, workspace) {
  return args.map(arg => {
    const normalize = value => '<project-root>/' + value.replaceAll('\\', '/')
    if (arg === workspace) return '<project-root>'
    for (const separator of ['/', '\\']) {
      if (arg.startsWith(workspace + separator)) return normalize(arg.slice(workspace.length + 1))
      const marker = `source=${workspace}${separator}`
      if (arg.includes(marker)) return arg.replace(marker, 'source=<project-root>/').replace(/source=<project-root>\/[^,]*/g, part => part.replaceAll('\\', '/'))
    }
    return arg
  })
}

export function within(root, relative, { exists = false } = {}) {
  if (typeof relative !== 'string' || !relative || /[\0\r\n]/.test(relative) || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => ['..', '.git', 'node_modules'].includes(part))) {
    throw new Error(`Unsafe project path: ${relative}`)
  }
  const base = fs.realpathSync(root)
  const target = path.resolve(base, relative)
  const isInside = candidate => candidate.startsWith(base + path.sep)
  if (!isInside(target)) throw new Error(`Path escapes project: ${relative}`)
  let ancestor = target
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const real = fs.realpathSync(ancestor)
  if (real !== base && !isInside(real)) throw new Error(`Symlink escapes project: ${relative}`)
  if (exists && !fs.existsSync(target)) throw new Error(`Missing project path: ${relative}`)
  return target
}

export function filesBelow(root, relative) {
  const full = within(root, relative, { exists: true })
  if (fs.statSync(full).isFile()) return [relative]
  return fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.name === '.git' || entry.name === 'node_modules') throw new Error(`Protected source directory: ${relative}/${entry.name}`)
    const name = `${relative}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${name}`)
    return filesBelow(root, name)
  })
}

export function sourceHashes(root, manifest) {
  const roots = new Set([manifest.manifestPath, ...manifest.sourceFiles])
  const names = [...roots].flatMap(name => filesBelow(root, name))
  return Object.fromEntries([...new Set(names)].sort().map(name => [name, sha256(fs.readFileSync(within(root, name, { exists: true })))]))
}
