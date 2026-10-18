#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readRecipe, products, stages, inside, sha256, stableJson, verifyBundle, makeSiteBundle, readSnapshot } from '../scripts/software/data.mjs';
import { offlinePlan, capture } from '../scripts/software/capture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...argv] = process.argv.slice(2);
const options = {};
for (let index = 0; index < argv.length; index++) {
  const key = argv[index].replace(/^--/, '');
  if (!['product', 'output', 'source', 'target', 'data-revision'].includes(key) || options[key] || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Usage: software-capture <plan|run|pending|verify|archive|import> --product java|mongodb|rabbitmq [--output relative-dir] [--source capture-or-site-dir] [--target project-dir] [--data-revision committed-data-sha]');
  options[key] = argv[++index];
}

export function verifyRun(directory, recipe) {
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'run.json'), 'utf8'));
  if (state.execution !== 'github-actions' || state.recipeSha256 !== recipe.recipeSha256 || !/^[a-f0-9]{40}$/.test(state.sourceSha) || !state.workflowUrl?.startsWith('https://github.com/xy2401/hello-docker/actions/runs/')) throw new Error('Invalid or stale capture provenance');
  for (const name of ['scan.py', 'archive.py', 'capture.mjs', 'data.mjs']) if (state.sourceHashes?.[name] !== sha256(fs.readFileSync(path.join(root, 'scripts/software', name)))) throw new Error('Capture tool source changed; verify against the recorded source commit');
  for (const [name, expected] of Object.entries(state.artifacts)) {
    const bytes = fs.readFileSync(inside(directory, name));
    if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.sizeBytes) throw new Error(`Raw evidence changed: ${name}`);
  }
  const bundle = verifyBundle(path.join(directory, 'site'));
  if (bundle.capture.id !== state.id || bundle.capture.status !== state.status || bundle.product.id !== recipe.product.id) throw new Error('Site and raw evidence do not describe the same run');
  if (state.status === 'passed') {
    if (state.errors.length || state.cleanupErrors.length) throw new Error('Passed run has errors');
    for (const stage of stages) {
      if (!state.artifacts[`files.${stage}.jsonl`] || !readSnapshot(path.join(directory, `files.${stage}.jsonl`)).summary.complete) throw new Error('Passed run has incomplete inventory');
    }
    const examples = JSON.parse(fs.readFileSync(path.join(directory, 'examples.json'), 'utf8'));
    if (examples.examples.some(item => item.status !== 'passed' || item.steps.some(step => step.status !== 'passed' || step.assertions.some(assertion => !assertion.passed)))) throw new Error('Passed run has failed examples');
  }
  return state;
}

function importSite(source, target, product, revision) {
  const manifest = verifyBundle(source);
  if (manifest.product.id !== product) throw new Error('Display package belongs to another product');
  const targetRoot = fs.realpathSync(path.resolve(target));
  if (!fs.existsSync(path.join(targetRoot, 'docs/.vitepress'))) throw new Error('Target is not a documentation project');
  const folder = inside(targetRoot, `docs/public/docker-data/${product}`);
  fs.mkdirSync(folder, { recursive: true });
  if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('data-revision must be a full committed data SHA');
  if (revision) {
    const committed = JSON.parse(execFileSync('git', ['-C', root, 'show', `${revision}:evidence/software/${product}/runs/${manifest.capture.id}/run.json`], { encoding: 'utf8', timeout: 10_000, windowsHide: true }));
    if (committed.id !== manifest.capture.id || committed.recipeSha256 !== manifest.capture.recipeSha256 || committed.sourceSha !== manifest.capture.sourceSha) throw new Error('Committed raw data does not match the imported capture');
  }
  const copy = (name, bytes) => {
    const destination = inside(folder, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && sha256(fs.readFileSync(destination)) !== sha256(bytes)) throw new Error('An immutable imported capture already exists with different bytes');
    fs.writeFileSync(destination, bytes);
  };
  // Validate every file before copying, and write the manifest last. Old runs remain intact.
  const contents = Object.keys(manifest.artifacts).map(name => [name, fs.readFileSync(inside(source, name))]);
  for (const [name, bytes] of contents) copy(name, bytes);
  const bytes = Buffer.from(stableJson(manifest));
  const manifestFile = `runs/${manifest.capture.id}/manifest.json`;
  copy(manifestFile, bytes);
  const lock = { schemaVersion: 1, product, captureId: manifest.capture.id, manifestFile, sourceRepository: 'https://github.com/xy2401/hello-docker', sourceSha: manifest.capture.sourceSha ?? null, dataRevision: revision ?? null, manifestSha256: sha256(bytes) };
  fs.writeFileSync(path.join(folder, 'manifest.json.next'), bytes);
  fs.renameSync(path.join(folder, 'manifest.json.next'), path.join(folder, 'manifest.json'));
  // Readers follow this immutable manifest. A single final rename switches the complete package.
  fs.writeFileSync(path.join(folder, 'import-lock.json.next'), stableJson(lock));
  fs.renameSync(path.join(folder, 'import-lock.json.next'), path.join(folder, 'import-lock.json'));
  return { product, captureId: manifest.capture.id, status: manifest.capture.status, files: contents.length, destination: folder };
}

try {
  if (!products.includes(options.product)) throw new Error('Select --product java, mongodb or rabbitmq');
  const recipe = readRecipe(root, options.product);
  if (command === 'plan') console.log(stableJson(offlinePlan(recipe)));
  else if (command === 'pending') {
    const output = inside(root, options.output || `software/${options.product}/preview`);
    const previewVersion = sha256(recipe.recipeSha256 + sha256(fs.readFileSync(path.join(root, 'scripts/software/data.mjs')))).slice(0, 16);
    const state = { id: `pending-${previewVersion}`, status: 'pending', execution: 'pending', sourceSha: null, capturedAt: null, recipeSha256: recipe.recipeSha256, base: recipe.base, platform: recipe.platform, workflowUrl: null, errors: [], note: '采集配方已就绪；未运行 Actions，不存在新环境的真实结果。' };
    makeSiteBundle(output, recipe, state);
    console.log(JSON.stringify({ output, status: 'pending' }));
  } else if (command === 'run') {
    const output = inside(root, options.output || `.artifacts/software-${options.product}`);
    const state = await capture(root, recipe, output);
    console.log(JSON.stringify({ id: state.id, status: state.status, output, errors: state.errors }));
    if (state.status !== 'passed') process.exitCode = 1;
  } else if (command === 'verify') {
    if (!options.source) throw new Error('Missing --source run directory');
    const state = verifyRun(path.resolve(options.source), recipe);
    console.log(JSON.stringify({ id: state.id, status: state.status, valid: true }));
  } else if (command === 'archive') {
    const source = fs.realpathSync(path.resolve(options.source || ''));
    const state = verifyRun(source, recipe);
    if (!/^[a-z0-9-]{1,100}$/.test(state.id)) throw new Error('Invalid capture id');
    const destination = inside(root, `evidence/software/${options.product}/runs/${state.id}`);
    if (fs.existsSync(destination)) throw new Error('Historical capture already exists; it cannot be overwritten');
    fs.mkdirSync(destination, { recursive: true });
    for (const name of ['run.json', ...Object.keys(state.artifacts)]) {
      const target = inside(destination, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(inside(source, name), target);
    }
    const manifest = verifyBundle(path.join(source, 'site'));
    for (const name of ['manifest.json', ...Object.keys(manifest.artifacts)]) {
      const target = inside(destination, `site/${name}`); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(inside(path.join(source, 'site'), name), target);
    }
    console.log(JSON.stringify({ destination, status: state.status, publication: 'local archive only; no commit or push' }));
  } else if (command === 'import') {
    if (!options.source || !options.target) throw new Error('Import requires --source site-directory and --target project-directory');
    console.log(JSON.stringify(importSite(fs.realpathSync(path.resolve(options.source)), options.target, options.product, options['data-revision'])));
  } else throw new Error('Unknown software-capture command');
} catch (error) { console.error(error.message); process.exitCode = 1; }
