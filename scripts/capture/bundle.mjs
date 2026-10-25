import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { makeSiteBundle, commandsFromFiles, sha256, stableJson, inside, safeRelative } from '../software/data.mjs';
import { normalizeSnapshot } from './normalize.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, stableJson(data)); };
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const text = (file, fallback = '') => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback;
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
function filesIn(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesIn(path.join(root, item.name)) : item.isFile() ? [path.join(root, item.name)] : []);
}
// Most artifacts share a handful of directories. Resolve each directory once,
// while rejecting file symlinks, rather than repeatedly resolving a Windows/WSL
// mount for every small JSON chunk.
function artifactResolver(root) {
  const base = fs.realpathSync(root), directories = new Map();
  return name => {
    const file = path.join(base, safeRelative(name)), parent = path.dirname(file);
    if (!directories.has(parent)) {
      const real = fs.realpathSync(parent);
      if (real !== base && !real.startsWith(base + path.sep)) throw new Error('Artifact directory escapes root');
      directories.set(parent, real);
    }
    if (!fs.lstatSync(file).isFile()) throw new Error('Artifact must be a regular file');
    return file;
  };
}
function sourceAt(directory) {
  try {
    const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const remote = git('remote', 'get-url', 'origin');
    return { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain', '--untracked-files=normal'), repository: remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '') };
  } catch { return { commit: null, dirty: true }; }
}
export function validateRecipe(recipe) {
  if (!safeId(recipe.product?.id) || !recipe.product.version || !Array.isArray(recipe.examples) || recipe.examples.length !== 5) throw new Error('Recipe needs a product/version and five example groups');
  if (!recipe.productRoots?.length || !recipe.commandRoots?.length || [...recipe.productRoots, ...recipe.commandRoots].some(root => !root.startsWith('/') || root === '/' || root.split('/').includes('..'))) throw new Error('Declare specific installed product roots and command roots');
  const groups = new Set();
  for (const group of recipe.examples) {
    if (!safeId(group.id) || groups.has(group.id) || !group.steps?.length) throw new Error('Invalid/duplicate example group');
    groups.add(group.id); const steps = new Set();
    for (const step of group.steps) {
      if (!safeId(step.id) || steps.has(step.id) || !step.argv?.length || step.argv.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !step.assertions?.length || (step.stdin != null && typeof step.stdin !== 'string')) throw new Error('Invalid example step');
      steps.add(step.id);
      for (const assertion of step.assertions) if (!['stdout', 'stderr', 'exitCode'].includes(assertion.stream) || !['equals', 'includes', 'matches'].includes(assertion.op)) throw new Error('Unsupported assertion');
      if (!step.assertions.some(assertion => assertion.stream === 'exitCode' && assertion.op === 'equals' && Number.isInteger(assertion.value) && assertion.value >= 0 && assertion.value <= 255)) throw new Error('Every step must assert an expected exit code');
    }
  }
  return recipe;
}
export function prepare(workspace, recipeFile, toolDirectory) {
  const recipe = validateRecipe(read(recipeFile));
  const source = sourceAt(path.dirname(recipeFile)), toolSource = sourceAt(toolDirectory);
  const sourceHashes = Object.fromEntries(filesIn(path.join(workspace, 'scripts')).map(file => [path.relative(workspace, file).split(path.sep).join('/'), sha256(fs.readFileSync(file))]));
  for (const file of filesIn(toolDirectory).filter(file => /\.(mjs|sh|yaml)$/.test(file))) sourceHashes[`tool/${path.relative(toolDirectory, file).split(path.sep).join('/')}`] = sha256(fs.readFileSync(file));
  const id = `capture-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomBytes(4).toString('hex')}`;
  const state = { id, protocolVersion: 2, status: 'failed', execution: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : process.env.WSL_DISTRO_NAME ? 'local-wsl' : 'local-linux', sourceSha: source.commit, sourceDirty: source.dirty, toolSha: toolSource.commit, toolDirty: toolSource.dirty, sourceHashes, recipeSha256: sha256(fs.readFileSync(recipeFile)), capturedAt: new Date().toISOString(), platform: 'linux/amd64', base: recipe.base, workflowUrl: process.env.GITHUB_ACTIONS === 'true' ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null, sourceRepository: recipe.sourceRepository ?? source.repository ?? null, errors: [] };
  write(path.join(workspace, 'run.json'), state);
  const script = ['#!/usr/bin/env bash', 'set -euo pipefail', 'source /capture/scripts/common/record.sh', 'mkdir -p /capture/work /capture/results/examples', 'cd /capture/work'];
  for (const [name, value] of Object.entries(recipe.environment ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid environment key');
    script.push(`export ${name}=${quote(value)}`);
  }
  fs.writeFileSync(path.join(workspace, 'scripts/prepare.sh'), recipe.prepare || ':\n');
  script.push('source /capture/scripts/prepare.sh > /capture/results/prepare.stdout 2> /capture/results/prepare.stderr', "printf '0\\n' > /capture/results/prepare.exit");
  for (const group of recipe.examples) {
    if (group.prepare) script.push(group.prepare);
    for (const step of group.steps) {
      const out = path.join(workspace, 'results/examples', group.id, step.id);
      fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'stdin'), step.stdin ?? '');
      script.push(`capture_step ${quote(group.id)} ${quote(step.id)} ${step.argv.map(quote).join(' ')}`);
    }
  }
  fs.writeFileSync(path.join(workspace, 'scripts/cases.sh'), script.join('\n') + '\n');
  for (const file of filesIn(path.join(workspace, 'scripts'))) state.sourceHashes[path.relative(workspace, file).split(path.sep).join('/')] = sha256(fs.readFileSync(file));
  write(path.join(workspace, 'run.json'), state);
  return state;
}
export function parseExit(value) {
  if (!/^(0|[1-9][0-9]{0,2})\n?$/.test(value)) return null;
  const result = Number(value); return result <= 255 ? result : null;
}
export function validateImages(workspace) {
  const names = text(path.join(workspace, 'results/stages.txt')).trim().split('\n');
  const stages = names.map(id => ({ id, image: read(path.join(workspace, `results/image-${id}.json`))[0] }));
  if (stages.length < 2 || new Set(names).size !== names.length) throw new Error('Expected distinct image stages');
  for (let index = 0; index < stages.length; index++) {
    const current = stages[index].image, parent = stages[index - 1]?.image;
    if (current.Architecture !== 'amd64' || current.Os !== 'linux' || !/^(sha256:)?[a-f0-9]{64}$/.test(current.Id)) throw new Error('Expected linux/amd64 image identity');
    if (parent && (current.RootFS?.Layers?.length <= parent.RootFS?.Layers?.length || JSON.stringify(current.RootFS.Layers.slice(0, parent.RootFS.Layers.length)) !== JSON.stringify(parent.RootFS.Layers))) throw new Error(`${stages[index].id} does not extend the captured parent image`);
  }
  return stages;
}
export function differences(before, after, transition) {
  const output = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(name), current = after.get(name);
    if (!old || !current) { output.push({ path: name, transition, change: old ? 'removed' : 'added', fields: [], before: old ?? null, after: current ?? null }); continue; }
    const keys = ['type', 'sha256', 'hashStatus', 'mode', 'uid', 'gid', 'linkTarget', 'acl', 'xattrs', 'capabilities', 'attributes', 'linuxFileFlags'];
    if (old.type === 'file' || current.type === 'file') keys.push('sizeBytes');
    const fields = keys.filter(key => JSON.stringify(old[key] ?? null) !== JSON.stringify(current[key] ?? null));
    if (JSON.stringify([...(old.hardlinkPaths ?? [])].sort()) !== JSON.stringify([...(current.hardlinkPaths ?? [])].sort())) fields.push('hardlinkPaths');
    if (fields.length) output.push({ path: name, transition, change: 'modified', fields, before: old, after: current });
  }
  return output;
}
function collectExamples(workspace, recipe, captureId) {
  return { schemaVersion: 1, captureId, product: recipe.product, preparation: { command: recipe.prepare, stdout: text(path.join(workspace, 'results/prepare.stdout')), stderr: text(path.join(workspace, 'results/prepare.stderr')), exitCode: parseExit(text(path.join(workspace, 'results/prepare.exit'))) }, examples: recipe.examples.map(group => {
    const steps = group.steps.map(step => {
      const directory = path.join(workspace, 'results/examples', group.id, step.id);
      const exitCode = parseExit(text(path.join(directory, 'exit')));
      const required = ['stdout', 'stderr', 'argv.nul', 'stdin', 'cwd'];
      const expectedArgv = Buffer.from(step.argv.join('\0') + '\0');
      const ran = exitCode !== null && required.every(name => fs.existsSync(path.join(directory, name)))
        && fs.readFileSync(path.join(directory, 'argv.nul')).equals(expectedArgv)
        && fs.readFileSync(path.join(directory, 'stdin')).equals(Buffer.from(step.stdin ?? ''))
        && text(path.join(directory, 'cwd')).trim() === (step.cwd ?? '/capture/work');
      const value = { ...step, cwd: text(path.join(directory, 'cwd'), '/capture/work').trim(), stdin: step.stdin ?? null, stdout: ran ? text(path.join(directory, 'stdout')) : null, stderr: ran ? text(path.join(directory, 'stderr')) : null, exitCode, status: ran ? 'passed' : 'not-run' };
      value.assertions = step.assertions.map(assertion => ({ ...assertion, passed: ran && (assertion.op === 'equals' ? value[assertion.stream] === assertion.value : assertion.op === 'includes' ? String(value[assertion.stream]).includes(String(assertion.value)) : new RegExp(assertion.value).test(String(value[assertion.stream]))) }));
      if (ran && value.assertions.some(assertion => !assertion.passed)) value.status = 'failed';
      if (ran && step.format === 'json') { try { value.result = JSON.parse(value.stdout); } catch { value.status = 'failed'; value.parseError = 'Declared JSON output is invalid'; } }
      return value;
    });
    return { ...group, steps, status: steps.every(step => step.status === 'passed') ? 'passed' : 'failed' };
  }) };
}
export function finish(workspace) {
  const recipe = validateRecipe(read(path.join(workspace, 'recipe.json'))), state = read(path.join(workspace, 'run.json'));
  if (state.recipeSha256 !== sha256(fs.readFileSync(path.join(workspace, 'recipe.json')))) throw new Error('Recipe changed during capture');
  for (const [name, expected] of Object.entries(state.sourceHashes).filter(([name]) => name.startsWith('scripts/'))) {
    if (!fs.existsSync(inside(workspace, name)) || sha256(fs.readFileSync(inside(workspace, name))) !== expected) state.errors.push(`Source changed during capture: ${name}`);
  }
  const stages = validateImages(workspace);
  const snapshots = stages.map(stage => {
    try {
      const result = normalizeSnapshot(path.join(workspace, 'results', stage.id), { stage: stage.id, imageId: stage.image.Id });
      // Exit 2 preserves per-command diagnostics; unsupported optional fields are
      // distinguished from failed traversal/hashing by the normalizer.
      if (![0, 2].includes(parseExit(text(path.join(workspace, `results/${stage.id}.exit`))))) { result.summary.complete = false; state.errors.push(`Collector exited unsuccessfully: ${stage.id}`); }
      fs.writeFileSync(path.join(workspace, `files.${stage.id}.jsonl`), [result.header, ...result.entries.values(), result.summary].map(item => JSON.stringify(item)).join('\n') + '\n');
      return result;
    } catch (error) { state.errors.push(`${stage.id}: ${error.message}`); return { entries: new Map(), header: {}, summary: { complete: false, entries: 0 } }; }
  });
  const final = snapshots.at(-1), base = snapshots[0], previous = snapshots.at(-2);
  const changes = [];
  for (let index = 1; index < stages.length; index++) changes.push(...differences(snapshots[index - 1].entries, snapshots[index].entries, `${stages[index - 1].id}-to-${stages[index].id}`));
  if (stages.length > 2) changes.push(...differences(base.entries, final.entries, `${stages[0].id}-to-${stages.at(-1).id}`));
  const finalChanges = new Set(differences(previous.entries, final.entries, 'product').map(item => item.path));
  const baseChanges = new Set(differences(base.entries, final.entries, 'total').map(item => item.path));
  const records = [...final.entries.values()].map(file => {
    const productRoot = recipe.productRoots.find(root => file.path === root || file.path.startsWith(root + '/'));
    const first = snapshots.findIndex(snapshot => snapshot.entries.has(file.path));
    const owned = !!productRoot && finalChanges.has(file.path);
    return { ...file, origin: owned ? 'product' : base.entries.has(file.path) && !baseChanges.has(file.path) ? 'system' : previous.entries.has(file.path) && !finalChanges.has(file.path) ? 'dependency' : 'unconfirmed', introducedAt: stages[first]?.id ?? stages.at(-1).id, ownership: owned ? { method: 'declared-install-root', root: productRoot, imageId: stages.at(-1).image.Id, recipeSha256: state.recipeSha256, note: '安装目录归属；缓存、系统工具及包装脚本不计为产品命令。' } : null };
  });
  const commands = commandsFromFiles(records, recipe), examples = collectExamples(workspace, recipe, state.id);
  state.stages = stages.map((stage, index) => ({ id: stage.id, label: recipe.stages?.find(item => item.id === stage.id)?.label ?? stage.id, imageId: stage.image.Id, parentImageId: stages[index - 1]?.image.Id ?? null }));
  state.snapshots = Object.fromEntries(stages.map((stage, index) => [stage.id, snapshots[index].summary]));
  state.engine = read(path.join(workspace, 'results/engine.json'));
  state.base = { ...(recipe.base ?? {}), image: stages[0].image.Id };
  if (!commands.length) state.errors.push('No product commands could be attributed');
  if (examples.preparation.exitCode !== 0 || parseExit(text(path.join(workspace, 'results/cases.exit'))) !== 0) state.errors.push('Example preparation or container execution failed');
  state.status = !state.errors.length && snapshots.every(snapshot => snapshot.summary.complete) && examples.examples.every(group => group.status === 'passed') ? 'passed' : 'partial';
  write(path.join(workspace, 'examples.json'), examples);
  fs.writeFileSync(path.join(workspace, 'differences.jsonl'), changes.map(item => JSON.stringify(item)).join('\n') + '\n');
  state.artifacts = {};
  for (const file of [...filesIn(path.join(workspace, 'results')), ...filesIn(path.join(workspace, 'scripts')), ...fs.readdirSync(workspace).filter(name => /^(recipe\.json|examples\.json|differences\.jsonl|files\..+\.jsonl)$/.test(name)).map(name => path.join(workspace, name))]) {
    const bytes = fs.readFileSync(file); state.artifacts[path.relative(workspace, file).split(path.sep).join('/')] = { sha256: sha256(bytes), sizeBytes: bytes.length };
  }
  write(path.join(workspace, 'run.json'), state);
  const site = path.join(workspace, 'site');
  const manifest = makeSiteBundle(site, recipe, state, records, changes, commands, examples);
  const diffIndex = read(path.join(site, manifest.diffIndex));
  diffIndex.transitions = [...new Set(changes.map(item => item.transition))].map(id => {
    const [before, after] = id.split('-to-');
    return { id, label: `${state.stages.find(item => item.id === before)?.label ?? before} → ${state.stages.find(item => item.id === after)?.label ?? after}`, count: changes.filter(item => item.transition === id).length, chunks: diffIndex.chunks.filter(name => read(path.join(site, name)).changes.some(item => item.transition === id)) };
  });
  write(path.join(site, manifest.diffIndex), diffIndex);
  const diffBytes = fs.readFileSync(path.join(site, manifest.diffIndex));
  manifest.artifacts[manifest.diffIndex] = { sha256: sha256(diffBytes), sizeBytes: diffBytes.length };
  write(path.join(site, 'manifest.json'), manifest);
  console.log(JSON.stringify({ captureId: state.id, status: state.status, files: records.length, commands: commands.length, changes: changes.length, snapshots: state.snapshots, errors: state.errors }));
  return state;
}
export function verify(workspace) {
  const state = read(path.join(workspace, 'run.json')), site = path.join(workspace, 'site'), manifest = read(path.join(site, 'manifest.json'));
  if (state.protocolVersion !== 2 || !['local-wsl', 'local-linux', 'github-actions'].includes(state.execution) || JSON.stringify(state) !== JSON.stringify(manifest.capture)) throw new Error('Mixed or unsupported capture provenance');
  for (const [root, artifacts] of [[workspace, state.artifacts], [site, manifest.artifacts]]) {
    const resolve = artifactResolver(root);
    if (!artifacts || !Object.keys(artifacts).length) throw new Error('Missing artifact hashes');
    for (const [name, expected] of Object.entries(artifacts)) {
      const bytes = fs.readFileSync(resolve(name));
      if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.sizeBytes) throw new Error(`Artifact mismatch: ${name}`);
      if (root === site) { const value = JSON.parse(bytes); if (value.schemaVersion !== 1 || value.captureId !== state.id || (value.product && JSON.stringify(value.product) !== JSON.stringify(manifest.product))) throw new Error('Mixed batch or product'); }
    }
  }
  if (sha256(fs.readFileSync(path.join(workspace, 'recipe.json'))) !== state.recipeSha256) throw new Error('Recipe hash mismatch');
  for (const name of [manifest.catalog, manifest.examples, manifest.fileIndex, manifest.diffIndex]) if (!manifest.artifacts[name]) throw new Error('Missing bundle entrypoint');
  const load = name => { if (!manifest.artifacts[name]) throw new Error('Unhashed chunk reference'); return read(inside(site, name)); };
  const fileIndex = load(manifest.fileIndex), diffIndex = load(manifest.diffIndex), paths = new Set();
  let count = 0, changes = 0;
  for (const directory of fileIndex.directories) {
    let directoryCount = 0;
    for (const name of directory.chunks) {
      const chunk = load(name);
      if (chunk.directory !== directory.path) throw new Error('Directory chunk mismatch');
      for (const file of chunk.files) {
        if (paths.has(file.path) || !file.path.startsWith('/') || (file.path === '/' ? '/' : path.posix.dirname(file.path)) !== directory.path) throw new Error('Duplicate or misplaced file');
        paths.add(file.path); directoryCount++;
      }
    }
    if (directoryCount !== directory.count) throw new Error('Directory count mismatch');
    count += directoryCount;
  }
  for (const name of diffIndex.chunks) changes += load(name).changes.length;
  if (count !== fileIndex.total || changes !== diffIndex.total) throw new Error('Index count mismatch');
  if (state.status === 'passed' && (state.errors.length || Object.values(state.snapshots).some(snapshot => !snapshot.complete) || read(path.join(workspace, 'examples.json')).examples.some(group => group.status !== 'passed'))) throw new Error('Invalid passed status');
  return { state, manifest };
}
export function importBundle(workspace, destination) {
  const { state, manifest } = verify(workspace), source = path.join(workspace, 'site');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(manifest.artifacts)) {
    const bytes = fs.readFileSync(inside(source, name)), target = inside(destination, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) throw new Error('Immutable batch already exists with different content');
    fs.writeFileSync(target, bytes);
  }
  const manifestFile = `runs/${state.id}/manifest.json`, bytes = fs.readFileSync(path.join(source, 'manifest.json'));
  if (fs.existsSync(inside(destination, manifestFile)) && sha256(fs.readFileSync(inside(destination, manifestFile))) !== sha256(bytes)) throw new Error('Immutable manifest changed');
  fs.writeFileSync(inside(destination, manifestFile), bytes);
  // A version index points at immutable manifests; changing the latest lock is atomic.
  const versionsFile = path.join(destination, 'versions.json');
  const versions = fs.existsSync(versionsFile) ? read(versionsFile) : { schemaVersion: 1, versions: [] };
  const entry = { version: manifest.product.version, captureId: state.id, manifestFile, manifestSha256: sha256(bytes), product: manifest.product.id, status: state.status };
  versions.versions = [entry, ...versions.versions.filter(item => item.version !== entry.version)];
  write(versionsFile, versions);
  write(path.join(destination, 'import-lock.json.next'), { schemaVersion: 1, ...entry, sourceRepository: state.sourceRepository, sourceSha: state.sourceSha, toolSha: state.toolSha, protocolVersion: 2, dataRevision: null });
  fs.renameSync(path.join(destination, 'import-lock.json.next'), path.join(destination, 'import-lock.json'));
  fs.writeFileSync(path.join(destination, 'manifest.json'), bytes);
  console.log(JSON.stringify({ imported: state.id, status: state.status, destination }));
}
export function archive(workspace, destination) {
  const { state, manifest } = verify(workspace);
  if (fs.existsSync(destination)) throw new Error('Archive directory already exists');
  fs.mkdirSync(destination, { recursive: true });
  const directories = new Set([path.resolve(destination)]);
  for (const name of ['run.json', ...Object.keys(state.artifacts), 'site/manifest.json', ...Object.keys(manifest.artifacts).map(name => `site/${name}`)]) {
    const target = path.resolve(destination, safeRelative(name)), directory = path.dirname(target);
    if (!directories.has(directory)) { fs.mkdirSync(directory, { recursive: true }); directories.add(directory); }
    fs.copyFileSync(inside(workspace, name), target);
  }
  verify(destination);
  console.log(JSON.stringify({ archived: state.id, destination }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'prepare') prepare(...args);
    else if (command === 'validate-images') validateImages(...args);
    else if (command === 'finish') { if (finish(...args).status !== 'passed') process.exitCode = 2; }
    else if (command === 'verify') console.log(JSON.stringify({ valid: true, status: verify(...args).state.status }));
    else if (command === 'import') importBundle(...args);
    else if (command === 'archive') archive(...args);
    else throw new Error('bundle.mjs prepare|validate-images|finish|verify|import');
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
