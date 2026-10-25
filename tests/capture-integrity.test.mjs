import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepare, verify } from '../scripts/capture/bundle.mjs';
import { sha256 } from '../scripts/software/data.mjs';

const processor = fileURLToPath(new URL('../scripts/capture/bundle.mjs', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
const writeJson = (file, value) => write(file, JSON.stringify(value) + '\n');
const requiredSteps = ['find', 'stat-before', 'regular', 'nonlinks', 'attributes-list', 'links', 'hash', 'acl', 'xattrs', 'capabilities', 'attributes', 'stat-after'];

// Intentionally synthetic protocol records, kept only in a disposable test
// directory. They neither run a container nor claim a real software capture.
function snapshot(directory, installed) {
  const directories = ['/', '/opt', '/opt/fixture', '/opt/fixture/bin'];
  const names = [...directories, ...(installed ? ['/opt/fixture/bin/fixture-tool'] : [])];
  const payload = 'synthetic executable bytes for integrity tests\n';
  const records = names.map((name, index) => {
    const file = !directories.includes(name);
    return [name, file ? '81ed' : '41ed', '755', file ? '-rwxr-xr-x' : 'drwxr-xr-x', '0', '0', file ? String(Buffer.byteLength(payload)) : '4096', '8', '512', '4096', String(index + 1), '1', '1', '0', '0', '1.000000000', '1.000000000', '1.000000000', '0.000000000', '-', file ? 'regular file' : 'directory'];
  });
  writeJson(path.join(directory, 'scan-info.json'), { schemaVersion: 1, format: 'linux-cli-nul-v1', finished: true, fixtureOnly: true });
  write(path.join(directory, 'root.raw'), '/');
  write(path.join(directory, 'paths.nul'), names.join('\0') + '\0');
  for (const name of ['stat.before.nul', 'stat.after.nul']) write(path.join(directory, name), records.flat().join('\0') + '\0');
  write(path.join(directory, 'hashes.nul'), installed ? `${sha256(payload)}  /opt/fixture/bin/fixture-tool\0` : '');
  write(path.join(directory, 'acl.raw'), names.map(name => `# file: ${name}\nuser::rwx\ngroup::r-x\nother::r-x\n\n`).join(''));
  for (const name of ['excluded.nul', 'links.nul', 'xattrs.raw', 'capabilities.raw', 'attributes.raw', 'attributes-special.nul']) write(path.join(directory, name), '');
  write(path.join(directory, 'passwd.raw'), 'root:x:0:0::/:/bin/bash\n');
  write(path.join(directory, 'group.raw'), 'root:x:0:\n');
  write(path.join(directory, 'tool-versions.txt'), 'Synthetic unit-test protocol fixture; no real collection\n');
  for (const name of ['started-at.txt', 'finished-at.txt']) write(path.join(directory, name), '2000-01-01T00:00:00Z\n');
  write(path.join(directory, 'steps.tsv'), requiredSteps.map(name => `${name}\t0\n`).join(''));
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-integrity-test-'));
  const workspace = path.join(temporary, 'workspace');
  const script = path.join(workspace, 'scripts/common/record.sh');
  write(script, '# Synthetic test source; never executed.\n');
  const recipe = {
    schemaVersion: 1, fixtureOnly: true,
    product: { id: 'fixture-only', name: 'Unit test fixture', version: 'synthetic' },
    productRoots: ['/opt/fixture'], commandRoots: ['/opt/fixture/bin'], commandNotes: {},
    examples: Array.from({ length: 5 }, (_, index) => ({
      id: `case-${index}`, title: `Synthetic case ${index}`, steps: [{
        id: 'version', argv: ['fixture-tool', '--version'],
        assertions: [{ stream: 'exitCode', op: 'equals', value: 0 }, { stream: 'stdout', op: 'equals', value: 'fixture version\n' }],
      }],
    })),
  };
  const recipeFile = path.join(workspace, 'recipe.json');
  writeJson(recipeFile, recipe);
  prepare(workspace, recipeFile, path.dirname(script));
  const state = read(path.join(workspace, 'run.json'));
  state.fixtureOnly = true;
  writeJson(path.join(workspace, 'run.json'), state);
  write(path.join(workspace, 'results/stages.txt'), 'base\ninstalled\n');
  const image = { Architecture: 'amd64', Os: 'linux' };
  writeJson(path.join(workspace, 'results/image-base.json'), [{ ...image, Id: 'a'.repeat(64), RootFS: { Layers: ['fixture-base'] } }]);
  writeJson(path.join(workspace, 'results/image-installed.json'), [{ ...image, Id: 'b'.repeat(64), RootFS: { Layers: ['fixture-base', 'fixture-installed'] } }]);
  writeJson(path.join(workspace, 'results/engine.json'), { fixtureOnly: true, engine: 'synthetic; no containers executed' });
  snapshot(path.join(workspace, 'results/base'), false);
  snapshot(path.join(workspace, 'results/installed'), true);
  for (const name of ['base', 'installed', 'cases', 'prepare']) write(path.join(workspace, `results/${name}.exit`), '0\n');
  for (const name of ['prepare.stdout', 'prepare.stderr']) write(path.join(workspace, 'results', name), '');
  for (const group of recipe.examples) {
    const directory = path.join(workspace, 'results/examples', group.id, 'version');
    for (const [name, bytes] of Object.entries({ exit: '0\n', stdout: 'fixture version\n', stderr: '', cwd: '/capture/work\n', 'argv.nul': 'fixture-tool\0--version\0' })) write(path.join(directory, name), bytes);
  }
  return {
    temporary, workspace, script, step: path.join(workspace, 'results/examples/case-0/version'),
    clean() {
      assert.equal(path.dirname(temporary), os.tmpdir());
      assert.ok(path.basename(temporary).startsWith('capture-integrity-test-'));
      fs.rmSync(temporary, { recursive: true, force: true });
    },
  };
}
function cli(command, ...args) {
  const result = spawnSync(process.execPath, [processor, command, ...args], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined);
  return result;
}
function finishFixture(item, expected = 0) {
  const result = cli('finish', item.workspace);
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return read(path.join(item.workspace, 'run.json'));
}

test('complete synthetic evidence verifies and generated execution scripts are source-locked', () => {
  const item = fixture();
  try {
    const prepared = read(path.join(item.workspace, 'run.json'));
    for (const name of ['scripts/common/record.sh', 'scripts/cases.sh', 'scripts/prepare.sh']) assert.equal(prepared.sourceHashes[name], sha256(fs.readFileSync(path.join(item.workspace, name))));
    const state = finishFixture(item);
    assert.equal(state.status, 'passed');
    assert.equal(state.fixtureOnly, true);
    assert.equal(verify(item.workspace).state.id, state.id);
  } finally { item.clean(); }
});

test('editing or removing locked source preserves a partial batch and returns exit 2', () => {
  for (const target of ['scripts/common/record.sh', 'scripts/cases.sh', 'scripts/prepare.sh']) {
    const item = fixture();
    try {
      const file = path.join(item.workspace, target);
      if (target.endsWith('prepare.sh')) fs.unlinkSync(file);
      else fs.appendFileSync(file, '# Changed after prepare\n');
      const state = finishFixture(item, 2);
      assert.equal(state.status, 'partial');
      assert.ok(state.errors.includes(`Source changed during capture: ${target}`));
      assert.equal(verify(item.workspace).state.status, 'partial');
      assert.ok(fs.existsSync(path.join(item.workspace, 'site/manifest.json')));
    } finally { item.clean(); }
  }
});

test('missing streams, missing exit and empty exit never pass example completion', () => {
  for (const mutation of ['stdout', 'stderr', 'exit', 'empty-exit', 'failed-exit']) {
    const item = fixture();
    try {
      if (mutation === 'empty-exit') write(path.join(item.step, 'exit'), '');
      else if (mutation === 'failed-exit') write(path.join(item.step, 'exit'), '1\n');
      else fs.unlinkSync(path.join(item.step, mutation));
      assert.equal(finishFixture(item, 2).status, 'partial', mutation);
      const group = read(path.join(item.workspace, 'examples.json')).examples[0];
      assert.equal(group.status, 'failed', mutation);
      assert.notEqual(group.steps[0].status, 'passed', mutation);
    } finally { item.clean(); }
  }
});

test('empty collector exit evidence cannot pass an otherwise complete snapshot', () => {
  const item = fixture();
  try {
    write(path.join(item.workspace, 'results/installed.exit'), '');
    const state = finishFixture(item, 2);
    assert.equal(state.status, 'partial');
    assert.equal(state.snapshots.installed.complete, false);
    assert.ok(state.errors.some(error => error.includes('Collector exited unsuccessfully')));
  } finally { item.clean(); }
});

test('corrupted raw evidence is rejected before import writes any destination', () => {
  const item = fixture();
  try {
    finishFixture(item);
    fs.appendFileSync(path.join(item.step, 'stdout'), 'changed after finalize\n');
    assert.throws(() => verify(item.workspace), /Artifact mismatch/);
    const destination = path.join(item.temporary, 'site');
    const result = cli('import', item.workspace, destination);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Artifact mismatch/);
    assert.equal(fs.existsSync(destination), false);
  } finally { item.clean(); }
});

test('a foreign capture artifact is rejected even when its content hash is valid', () => {
  const item = fixture();
  try {
    finishFixture(item);
    const manifestFile = path.join(item.workspace, 'site/manifest.json');
    const manifest = read(manifestFile);
    const file = path.join(item.workspace, 'site', manifest.catalog);
    const catalog = read(file);
    catalog.captureId = 'capture-foreign-fixture';
    writeJson(file, catalog);
    const bytes = fs.readFileSync(file);
    manifest.artifacts[manifest.catalog] = { sha256: sha256(bytes), sizeBytes: bytes.length };
    writeJson(manifestFile, manifest);
    assert.throws(() => verify(item.workspace), /Mixed batch/);
    const result = cli('import', item.workspace, path.join(item.temporary, 'site'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Mixed batch/);
  } finally { item.clean(); }
});

test('modified site bytes fail hash verification and an existing immutable batch cannot be replaced', () => {
  const item = fixture();
  try {
    finishFixture(item);
    const manifest = read(path.join(item.workspace, 'site/manifest.json'));
    const destination = path.join(item.temporary, 'site');
    // Model an already imported batch directly. The test is about refusing an
    // overwrite, so it does not depend on platform-specific atomic rename.
    fs.cpSync(path.join(item.workspace, 'site'), destination, { recursive: true });
    writeJson(path.join(destination, 'import-lock.json'), { fixtureOnly: true, captureId: manifest.capture.id });
    const lock = fs.readFileSync(path.join(destination, 'import-lock.json'));
    fs.appendFileSync(path.join(destination, manifest.catalog), '\n');
    const collision = cli('import', item.workspace, destination);
    assert.equal(collision.status, 1);
    assert.match(collision.stderr, /Immutable batch/);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'import-lock.json')), lock);
    fs.appendFileSync(path.join(item.workspace, 'site', manifest.catalog), '\n');
    assert.throws(() => verify(item.workspace), /Artifact mismatch/);
    assert.equal(cli('import', item.workspace, path.join(item.temporary, 'other-site')).status, 1);
  } finally { item.clean(); }
});
