import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { differences, validateRecipe, validateImages, parseExit } from '../scripts/capture/bundle.mjs';

test('empty or malformed exit evidence is never a successful exit', () => {
  for (const value of ['', '\n', ' ', '-1', '256', '0\ntruncated', '00']) assert.equal(parseExit(value), null);
  assert.equal(parseExit('0\n'), 0);
  assert.equal(parseExit('42'), 42);
});

test('stable filesystem diff distinguishes permissions, content, deletion and links from runtime metadata', () => {
  const entry = { path: '/file', type: 'file', mode: 0o100644, uid: 0, gid: 0, sha256: 'a', hashStatus: 'complete', sizeBytes: '1', inode: '1', times: { accessed: 1 } };
  const before = new Map([['/file', entry], ['/removed', { ...entry, path: '/removed' }], ['/link', { path: '/link', type: 'symlink', linkTarget: 'file' }]]);
  const after = new Map([['/file', { ...entry, inode: '100', times: { accessed: 100 } }], ['/link', { path: '/link', type: 'symlink', linkTarget: 'elsewhere' }]]);
  assert.deepEqual(differences(before, after, 'a-to-b').map(item => [item.path, item.change, item.fields]), [['/link', 'modified', ['linkTarget']], ['/removed', 'removed', []]]);
  after.set('/file', { ...entry, mode: 0o100600, sha256: 'b' });
  assert.deepEqual(differences(before, after, 'a-to-b')[0].fields, ['sha256', 'mode']);
});

test('generic recipe accepts unrelated software and rejects ambiguous ownership and duplicate step ids', () => {
  const recipe = { product: { id: 'other-tool', version: '1.0' }, productRoots: ['/opt/other'], commandRoots: ['/opt/other/bin'], examples: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, steps: [{ id: 'version', argv: ['other', '--version'], assertions: [{ stream: 'exitCode', op: 'equals', value: 0 }] }] })) };
  assert.equal(validateRecipe(recipe), recipe);
  assert.throws(() => validateRecipe({ ...recipe, productRoots: ['/'] }), /specific/);
  const invalid = structuredClone(recipe); invalid.examples[0].steps.push(invalid.examples[0].steps[0]);
  assert.throws(() => validateRecipe(invalid), /step/);
});

test('captured image chain must use compatible architecture and actual parent layers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-chain-'));
  try {
    fs.mkdirSync(path.join(root, 'results'));
    fs.writeFileSync(path.join(root, 'results/stages.txt'), 'ubuntu\nsdkman\n');
    const image = { Id: 'a'.repeat(64), Architecture: 'amd64', Os: 'linux', RootFS: { Layers: ['base'] } };
    const write = (name, value) => fs.writeFileSync(path.join(root, `results/image-${name}.json`), JSON.stringify([value]));
    write('ubuntu', image); write('sdkman', { ...image, Id: 'b'.repeat(64), RootFS: { Layers: ['base', 'manager'] } });
    assert.equal(validateImages(root).length, 2);
    write('sdkman', { ...image, Id: 'b'.repeat(64), RootFS: { Layers: ['different', 'manager'] } });
    assert.throws(() => validateImages(root), /parent/);
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('capture-chain-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
