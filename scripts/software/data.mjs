import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const stableJson = value => JSON.stringify(value, null, 2) + '\n';
export const products = ['java', 'mongodb', 'rabbitmq'];
export const stages = ['base', 'dependencies', 'software'];
export function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || /[\0\r\n:]/.test(name)) throw new Error(`Unsafe artifact path: ${name}`);
  return name;
}
export function inside(root, relative) {
  const result = path.resolve(root, safeRelative(relative));
  const base = path.resolve(root);
  if (!result.startsWith(base + path.sep)) throw new Error('Artifact escapes root');
  let ancestor = result;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(base);
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + path.sep)) throw new Error('Artifact symlink escapes root');
  return result;
}
export function readRecipe(root, product) {
  if (!products.includes(product)) throw new Error('Unknown software product');
  const file = path.join(root, 'software', product, 'recipe.json');
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (recipe.schemaVersion !== 1 || recipe.product.id !== product || recipe.platform !== 'linux/amd64' || !/^ubuntu:26\.04@sha256:[a-f0-9]{64}$/.test(recipe.base.image)) throw new Error('Invalid or unpinned software recipe');
  for (const asset of [...recipe.artifacts, ...(recipe.dependencies.artifacts || []), recipe.collector]) {
    if (!/^[a-z][a-z0-9-]+$/.test(asset.id) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !/^https:\/\/(?:github\.com|fastdl\.mongodb\.org)\//.test(asset.url)) throw new Error('Unpinned software artifact');
    if (asset.destination && (!asset.destination.startsWith('/opt/') || asset.destination.includes('..'))) throw new Error('Payload destination must be inside /opt');
  }
  if (recipe.examples.length !== 5 || new Set(recipe.examples.map(item => item.id)).size !== 5) throw new Error('Expected five unique example groups');
  for (const example of recipe.examples) {
    if (!example.steps?.length || example.steps.some(step => !Array.isArray(step.argv) || !step.argv.length || step.argv.some(value => typeof value !== 'string' || value.includes('\0')) || !step.assertions?.length || (step.stdin !== undefined && step.stdin !== null))) throw new Error('Missing example argv/assertions or unsupported interactive stdin');
  }
  return { ...recipe, recipeSha256: sha256(fs.readFileSync(file)) };
}

export function readSnapshot(file) {
  const entries = new Map();
  let header, summary;
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const item = JSON.parse(line);
    if (item.recordType === 'header') { if (header) throw new Error('Duplicate inventory header'); header = item; }
    else if (item.recordType === 'summary') { if (summary) throw new Error('Duplicate inventory summary'); summary = item; }
    else {
      if (typeof item.path !== 'string' || !item.path.startsWith('/')) throw new Error('Invalid rootfs path');
      // A traversal error is an additional diagnostic, not a replacement entry.
      if (item.type === 'traversal-error') continue;
      if (entries.has(item.path)) throw new Error(`Duplicate inventory path: ${item.path}`);
      entries.set(item.path, item);
    }
  }
  if (!header || !summary || summary.entries !== entries.size) throw new Error('Incomplete inventory stream');
  return { header, summary, entries };
}

// Record volatile inode/access/ctime fields, but never confuse them with installed payload changes.
const comparable = ['type', 'sha256', 'hashStatus', 'mode', 'uid', 'gid', 'sizeBytes', 'linkTarget', 'xattrs', 'acl', 'capabilities', 'attributes'];
export function diffSnapshots(before, after, transition) {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.flatMap(name => {
    const old = before.get(name), current = after.get(name);
    if (!old || !current) return [{ path: name, transition, change: old ? 'removed' : 'added', fields: [], before: old ?? null, after: current ?? null }];
    const fields = comparable.filter(key => JSON.stringify(old[key] ?? null) !== JSON.stringify(current[key] ?? null));
    const modifiedTime = JSON.stringify(old.times?.modified) !== JSON.stringify(current.times?.modified);
    if (!fields.length && !modifiedTime) return [];
    return [{ path: name, transition, change: fields.length ? 'modified' : 'timestamp-only', fields: [...fields, ...(modifiedTime ? ['times.modified'] : [])], before: old, after: current }];
  });
}

export function attributeFiles(base, dependencies, software, ownership, recipe) {
  const proofs = new Map(ownership.map(item => [item.path, item]));
  return [...software.values()].map(original => {
    const file = { ...original };
    const proof = proofs.get(file.path);
    let origin = 'unconfirmed';
    let evidence = null;
    if (proof && ((file.type === 'file' && proof.sha256 === file.sha256 && file.hashStatus === 'complete')
      || (file.type === 'symlink' && file.linkTarget === proof.linkTarget) || (file.type === 'directory' && proof.type === 'directory'))) {
      origin = 'product';
      const artifact = recipe.artifacts.find(item => item.id === proof.artifact);
      evidence = { artifact: proof.artifact, artifactVersion: artifact?.version, artifactUrl: artifact?.url, artifactSha256: artifact?.sha256, payloadSha256: proof.sha256, method: 'official-archive-file-proof' };
    } else {
      const same = previous => previous && comparable.every(key => JSON.stringify(previous[key] ?? null) === JSON.stringify(file[key] ?? null));
      if (same(base.get(file.path))) origin = 'system';
      else if (same(dependencies.get(file.path))) origin = 'dependency';
    }
    file.origin = origin;
    file.introducedAt = base.has(file.path) ? 'base' : dependencies.has(file.path) ? 'dependencies' : 'software';
    file.ownership = evidence;
    if (file.type === 'symlink' && !file.linkState) {
      const seen = new Set();
      let cursor = file.path;
      while (software.get(cursor)?.type === 'symlink' && !seen.has(cursor)) {
        seen.add(cursor);
        const target = software.get(cursor).linkTarget;
        cursor = path.posix.resolve(path.posix.dirname(cursor), target);
      }
      file.resolvedPath = seen.has(cursor) ? null : software.has(cursor) ? cursor : null;
      file.linkState = seen.has(cursor) ? 'cycle' : software.has(cursor) ? 'resolved' : 'dangling';
    }
    return file;
  });
}

export function commandsFromFiles(files, recipe) {
  const byPath = new Map(files.map(file => [file.path, file]));
  return files.filter(file => {
    const target = file.type === 'symlink' ? byPath.get(file.resolvedPath) : file;
    return file.origin === 'product' && target?.origin === 'product' && target.type === 'file'
      && (target.mode & 0o111) && recipe.commandRoots.some(root => file.path.startsWith(root + '/') && !file.path.slice(root.length + 1).includes('/'));
  }).map(file => {
    const name = path.posix.basename(file.path);
    return { id: file.path, name, path: file.path, realPath: file.resolvedPath ?? file.path,
      sha256: (byPath.get(file.resolvedPath) ?? file).sha256, ownership: file.ownership,
      purpose: recipe.commandNotes[name]?.purpose ?? '发行包内辅助命令；用途说明待补充。',
      category: recipe.commandNotes[name]?.category ?? '辅助工具', verified: true };
  });
}

export function pendingExamples(recipe, captureId) {
  return { schemaVersion: 1, captureId, product: recipe.product, examples: recipe.examples.map(item => ({ ...item, status: 'not-run', steps: item.steps.map(step => ({ ...step, cwd: '/work', stdin: null, status: 'not-run', stdout: null, stderr: null, exitCode: null })) })) };
}

export function makeSiteBundle(destination, recipe, capture, files = [], differences = [], commands = [], examples = pendingExamples(recipe, capture.id)) {
  fs.mkdirSync(destination, { recursive: true });
  const artifacts = {};
  const prefix = `runs/${capture.id}`;
  if (!/^[a-z0-9-]{1,100}$/.test(capture.id)) throw new Error('Invalid capture id');
  const write = (name, value) => {
    const relative = `${prefix}/${name}`, bytes = Buffer.from(stableJson(value));
    const file = inside(destination, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
    artifacts[relative] = { sha256: sha256(bytes), sizeBytes: bytes.length };
    return relative;
  };
  const plannedCommands = capture.status === 'pending' ? Object.entries(recipe.commandNotes).map(([name, note]) => ({ id: `planned:${name}`, name, path: null, ...note, verified: false })) : [];
  const catalog = write('catalog.json', { schemaVersion: 1, captureId: capture.id, product: recipe.product, commands, plannedCommands });
  const exampleFile = write('examples.json', examples);
  const directories = new Map();
  for (const file of files) {
    const directory = file.path === '/' ? '/' : path.posix.dirname(file.path);
    if (!directories.has(directory)) directories.set(directory, []);
    directories.get(directory).push(file);
  }
  const index = [];
  for (const [directory, items] of [...directories].sort(([a], [b]) => a.localeCompare(b))) {
    const chunks = [];
    items.sort((a, b) => a.path.localeCompare(b.path));
    for (let start = 0; start < items.length; start += 500) chunks.push(write(`files/${sha256(directory).slice(0, 16)}-${start / 500}.json`, { schemaVersion: 1, captureId: capture.id, directory, files: items.slice(start, start + 500) }));
    index.push({ path: directory, count: items.length, chunks });
  }
  const fileIndex = write('file-index.json', { schemaVersion: 1, captureId: capture.id, total: files.length, directories: index });
  const diffIndex = [];
  for (let start = 0; start < differences.length; start += 250) diffIndex.push(write(`diff/${start / 250}.json`, { schemaVersion: 1, captureId: capture.id, changes: differences.slice(start, start + 250) }));
  const diff = write('diff-index.json', { schemaVersion: 1, captureId: capture.id, total: differences.length, chunks: diffIndex });
  const manifest = { schemaVersion: 1, product: recipe.product, capture, catalog, examples: exampleFile, fileIndex, diffIndex: diff, artifacts };
  fs.writeFileSync(path.join(destination, 'manifest.json'), stableJson(manifest));
  return manifest;
}

export function verifyBundle(root, { allowFixture = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.capture?.execution === 'fixture' && !allowFixture) throw new Error('Fixture packages cannot be imported or published as evidence');
  if (manifest.schemaVersion !== 1 || !products.includes(manifest.product?.id) || !/^[a-z0-9-]{1,100}$/.test(manifest.capture?.id) || !['pending', 'passed', 'partial', 'failed'].includes(manifest.capture.status)) throw new Error('Invalid display manifest');
  for (const key of ['catalog', 'examples', 'fileIndex', 'diffIndex']) if (!manifest.artifacts[manifest[key]]) throw new Error('Missing bundle entrypoint');
  const contents = new Map();
  for (const [name, expected] of Object.entries(manifest.artifacts)) {
    if (!name.startsWith(`runs/${manifest.capture.id}/`)) throw new Error('Mixed capture artifact path');
    const bytes = fs.readFileSync(inside(root, name));
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.sizeBytes) throw new Error(`Artifact hash/size mismatch: ${name}`);
    const value = JSON.parse(bytes);
    if (value.schemaVersion !== 1 || value.captureId !== manifest.capture.id || (value.product && JSON.stringify(value.product) !== JSON.stringify(manifest.product))) throw new Error('Mixed capture/product payload');
    contents.set(name, value);
  }
  const index = contents.get(manifest.fileIndex), diff = contents.get(manifest.diffIndex);
  let fileCount = 0, diffCount = 0;
  const seenPaths = new Set();
  for (const directory of index.directories) {
    let directoryCount = 0;
    for (const chunk of directory.chunks) {
      if (!contents.has(chunk) || contents.get(chunk).directory !== directory.path || !Array.isArray(contents.get(chunk).files)) throw new Error('Missing or mismatched file chunk');
      for (const file of contents.get(chunk).files) {
        if (seenPaths.has(file.path) || !file.path.startsWith('/') || (file.path === '/' ? '/' : path.posix.dirname(file.path)) !== directory.path) throw new Error('Duplicate or misplaced filesystem entry');
        seenPaths.add(file.path); directoryCount++;
      }
    }
    if (directoryCount !== directory.count) throw new Error('Directory count mismatch');
    fileCount += directoryCount;
  }
  for (const chunk of diff.chunks) {
    if (!contents.has(chunk) || !Array.isArray(contents.get(chunk).changes)) throw new Error('Missing diff chunk');
    diffCount += contents.get(chunk).changes.length;
  }
  if (fileCount !== index.total || diffCount !== diff.total) throw new Error('Inventory/difference count mismatch');
  const examples = contents.get(manifest.examples).examples;
  const commands = contents.get(manifest.catalog).commands;
  if (manifest.capture.status === 'pending' && (index.total || commands.length || examples.some(item => item.status !== 'not-run' || item.steps.some(step => step.stdout !== null || step.exitCode !== null)))) throw new Error('Pending bundle contains fabricated evidence');
  if (manifest.capture.status !== 'pending' && !(allowFixture && manifest.capture.execution === 'fixture') && (manifest.capture.execution !== 'github-actions' || !/^[a-f0-9]{40}$/.test(manifest.capture.sourceSha) || !/^https:\/\/github\.com\/xy2401\/hello-docker\/actions\/runs\/\d+$/.test(manifest.capture.workflowUrl) || !Number.isFinite(Date.parse(manifest.capture.capturedAt)))) throw new Error('Missing real Actions provenance');
  if (manifest.capture.status === 'passed' && (!commands.length || !index.total || examples.some(item => item.status !== 'passed' || item.steps.some(step => step.status !== 'passed' || !Number.isInteger(step.exitCode) || typeof step.stdout !== 'string' || typeof step.stderr !== 'string' || !step.assertions?.length || step.assertions.some(assertion => !assertion.passed))) || stages.some(stage => !manifest.capture.snapshots?.[stage]?.complete))) throw new Error('Passed bundle lacks complete verified evidence');
  return manifest;
}
