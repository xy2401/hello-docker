import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readRecipe, sha256, stableJson, readSnapshot, diffSnapshots, attributeFiles, commandsFromFiles, makeSiteBundle, verifyBundle, pendingExamples, inside } from '../scripts/software/data.mjs';
import { offlinePlan, packageUris } from '../scripts/software/capture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const recipe = readRecipe(root, 'java');
function temporary(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'software-capture-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true })); return folder; }
const file = (name, checksum, mode = 0o100644) => ({ path: name, type: 'file', sha256: checksum, hashStatus: 'complete', mode, sizeBytes: '4', uid: 0, gid: 0, xattrs: {}, acl: {}, attributes: '0', times: { modified: { seconds: '1', nanoseconds: 0 } }, errors: [] });
const state = () => ({ id: 'pending-test', status: 'pending', sourceSha: null, workflowUrl: null, capturedAt: null, base: recipe.base, recipeSha256: recipe.recipeSha256 });

test('all three recipes pin Ubuntu 26.04, archives and five example groups', () => {
  for (const product of ['java', 'mongodb', 'rabbitmq']) {
    const value = readRecipe(root, product), plan = offlinePlan(value);
    assert.match(value.base.image, /^ubuntu:26\.04@sha256:[a-f0-9]{64}$/);
    assert.equal(value.examples.length, 5);
    assert.equal(plan.snapshot.allPaths, true);
    assert.match(plan.network.build, /none/);
    assert(plan.artifacts.every(item => item.sha256.length === 64));
  }
  assert.equal(readRecipe(root, 'mongodb').product.version, '9.0.4');
});

test('apt URI proof accepts exact signed SHA-256 and refuses weak or conflicting download metadata', () => {
  const digest = 'a'.repeat(64);
  const line = `'http://archive.ubuntu.com/ubuntu/pool/example.deb' example_1.0_amd64.deb 123 SHA256:${digest}`;
  assert.deepEqual(packageUris('Reading package lists...\n' + line + '\n').get('example_1.0_amd64.deb'), { url: 'http://archive.ubuntu.com/ubuntu/pool/example.deb', sizeBytes: 123, sha256: digest });
  assert.equal(packageUris(line.replace('SHA256:' + digest, 'MD5Sum:' + 'a'.repeat(32))).size, 0);
  assert.throws(() => packageUris(line + '\n' + line.replace(' 123 ', ' 124 ')), /Conflicting/);
  assert.throws(() => packageUris(line.replace('example_1.0_amd64.deb', '../outside.deb')), /Unsafe/);
});

test('diff retains nonexecutables, deleted files and permission-only changes; ignores volatile identity', () => {
  const before = new Map([['/config', file('/config', 'a')], ['/removed', file('/removed', 'b')], ['/stable', file('/stable', 'c')]]);
  const after = new Map([['/config', file('/config', 'a', 0o100600)], ['/new.txt', file('/new.txt', 'd')], ['/stable', { ...file('/stable', 'c'), inode: '999', times: { ...file('/stable', 'c').times, accessed: { seconds: '42' } } }]]);
  const changes = diffSnapshots(before, after, 'base-to-dependencies');
  assert.deepEqual(changes.map(item => [item.path, item.change]), [['/config', 'modified'], ['/new.txt', 'added'], ['/removed', 'removed']]);
  assert.deepEqual(changes[0].fields, ['mode']);
  assert.equal(changes[0].before.mode, 0o100644);
});

test('archive ownership excludes new dependency tools and altered product payloads', () => {
  const system = file('/usr/bin/sh', 'system', 0o100755), dependency = file('/usr/bin/curl', 'dependency', 0o100755);
  const java = file('/opt/java/bin/java', 'payload', 0o100755), doc = file('/opt/java/legal/license', 'license');
  const altered = file('/opt/java/bin/altered', 'tampered', 0o100755);
  const base = new Map([[system.path, system]]), deps = new Map([...base, [dependency.path, dependency]]);
  const software = new Map([...deps, [java.path, java], [doc.path, doc], [altered.path, altered]]);
  const proof = [{ path: java.path, artifact: 'jdk', sha256: 'payload' }, { path: doc.path, artifact: 'jdk', sha256: 'license' }, { path: altered.path, artifact: 'jdk', sha256: 'original' }];
  const attributed = attributeFiles(base, deps, software, proof, recipe);
  assert.deepEqual(attributed.map(item => item.origin), ['system', 'dependency', 'product', 'product', 'unconfirmed']);
  assert.deepEqual(commandsFromFiles(attributed, recipe).map(item => item.name), ['java']);
  assert.equal(attributed.find(item => item.path === doc.path).origin, 'product');
});

test('command symlinks must resolve to a proven executable, cycles remain noncommands', () => {
  const binary = file('/opt/java/bin/real', 'payload', 0o100755);
  const alias = { path: '/opt/java/bin/alias', type: 'symlink', linkTarget: 'real', mode: 0o120777 };
  const loop = { path: '/opt/java/bin/loop', type: 'symlink', linkTarget: 'loop', mode: 0o120777 };
  const entries = new Map([binary, alias, loop].map(item => [item.path, item]));
  const records = attributeFiles(new Map(), new Map(), entries, [{ path: binary.path, artifact: 'jdk', sha256: 'payload' }, { ...alias, artifact: 'jdk' }, { ...loop, artifact: 'jdk' }], recipe);
  assert.deepEqual(commandsFromFiles(records, recipe).map(item => item.name), ['real', 'alias']);
  assert.equal(records[2].linkState, 'cycle');
});

test('snapshot parser rejects missing summary and preserves explicit traversal failures', t => {
  const folder = temporary(t), target = path.join(folder, 'files.jsonl');
  fs.writeFileSync(target, JSON.stringify({ recordType: 'header', stage: 'base' }) + '\n');
  assert.throws(() => readSnapshot(target), /Incomplete/);
  fs.appendFileSync(target, [file('/private', null), { path: '/private', type: 'traversal-error', errors: ['denied'] }, { recordType: 'summary', entries: 1, errors: 1, complete: false }].map(JSON.stringify).join('\n') + '\n');
  assert.equal(readSnapshot(target).summary.complete, false);
});

test('pending bundle contains planned commands and argv, never invented outputs or file metadata', t => {
  const folder = temporary(t);
  const manifest = makeSiteBundle(folder, recipe, state());
  assert.equal(verifyBundle(folder).capture.status, 'pending');
  const catalog = JSON.parse(fs.readFileSync(path.join(folder, manifest.catalog)));
  assert.equal(catalog.commands.length, 0);
  assert(catalog.plannedCommands.length > 0);
  assert.equal(pendingExamples(recipe, state().id).examples[0].steps[0].stdout, null);
});

test('bundle verifier rejects tampering, mixed capture IDs, missing shards and false passed status', t => {
  for (const mutate of ['tamper', 'mix', 'missing', 'false-pass']) {
    const folder = path.join(temporary(t), mutate);
    const manifest = makeSiteBundle(folder, recipe, state());
    if (mutate === 'tamper') fs.appendFileSync(path.join(folder, manifest.catalog), ' ');
    if (mutate === 'missing') fs.unlinkSync(path.join(folder, manifest.fileIndex));
    if (mutate === 'mix') {
      const value = JSON.parse(fs.readFileSync(path.join(folder, manifest.catalog))); value.captureId = 'another-run';
      const bytes = Buffer.from(stableJson(value)); fs.writeFileSync(path.join(folder, manifest.catalog), bytes); manifest.artifacts[manifest.catalog] = { sha256: sha256(bytes), sizeBytes: bytes.length };
    }
    if (mutate === 'false-pass') manifest.capture.status = 'passed';
    fs.writeFileSync(path.join(folder, 'manifest.json'), stableJson(manifest));
    assert.throws(() => verifyBundle(folder));
  }
});

test('file bundles split large directories without preloading other directories and preserve total counts', t => {
  const folder = temporary(t), capture = { ...state(), id: 'fixture-run', execution: 'fixture', status: 'partial' };
  const files = Array.from({ length: 1201 }, (_, index) => ({ ...file(`/opt/java/data/${index}`, 'checksum'), origin: 'product' }));
  files.push({ ...file('/etc/config', 'system'), origin: 'system' });
  const manifest = makeSiteBundle(folder, recipe, capture, files);
  assert.throws(() => verifyBundle(folder), /Fixture/);
  assert.equal(verifyBundle(folder, { allowFixture: true }).capture.id, 'fixture-run');
  const index = JSON.parse(fs.readFileSync(path.join(folder, manifest.fileIndex)));
  assert.equal(index.total, 1202);
  assert.equal(index.directories.find(item => item.path === '/opt/java/data').chunks.length, 3);
});

test('artifact traversal and symlink escape are refused', t => {
  const folder = temporary(t);
  assert.throws(() => inside(folder, '../outside'));
  assert.throws(() => inside(folder, 'runs/../../outside'));
  assert.throws(() => inside(folder, '/absolute'));
});

test('local CLI plan does not invoke Docker and local execution is rejected before mutation', t => {
  const folder = temporary(t);
  const planned = spawnSync(process.execPath, [path.join(root, 'bin/software-capture.mjs'), 'plan', '--product', 'mongodb'], { encoding: 'utf8', cwd: folder, windowsHide: true });
  assert.equal(planned.status, 0); assert.equal(JSON.parse(planned.stdout).product.version, '9.0.4');
  const run = spawnSync(process.execPath, [path.join(root, 'bin/software-capture.mjs'), 'run', '--product', 'java', '--output', '.artifacts/should-not-run-local'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' }, windowsHide: true });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /Linux GitHub Actions/);
  assert(!fs.existsSync(path.join(root, '.artifacts/should-not-run-local')));
});

test('import switches one lock to an immutable verified manifest and refuses fixture packages', t => {
  const folder = temporary(t), source = path.join(folder, 'site'), target = path.join(folder, 'project');
  fs.mkdirSync(path.join(target, 'docs/.vitepress'), { recursive: true });
  makeSiteBundle(source, recipe, state());
  const args = [path.join(root, 'bin/software-capture.mjs'), 'import', '--product', 'java', '--source', source, '--target', target];
  const imported = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(imported.status, 0, imported.stderr);
  const destination = path.join(target, 'docs/public/docker-data/java');
  const lock = JSON.parse(fs.readFileSync(path.join(destination, 'import-lock.json')));
  assert.equal(lock.manifestFile, `runs/${state().id}/manifest.json`);
  assert.equal(sha256(fs.readFileSync(path.join(destination, lock.manifestFile))), lock.manifestSha256);
  assert.equal(verifyBundle(destination).capture.id, state().id);
  makeSiteBundle(source, recipe, { ...state(), id: 'fixture-import', execution: 'fixture' });
  const refused = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /Fixture/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'import-lock.json'))).captureId, state().id);
});
