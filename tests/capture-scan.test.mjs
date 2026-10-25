import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { normalizeSnapshot } from '../scripts/capture/normalize.mjs';

const scanner = fileURLToPath(new URL('../scripts/capture/scan.sh', import.meta.url));
function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-capture-test-'));
  const root = path.join(temporary, 'root'), output = path.join(temporary, 'output');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'etc'));
  fs.writeFileSync(path.join(root, 'etc/passwd'), `fixture-user:x:${process.getuid()}:${process.getgid()}::/:/bin/sh\n`);
  fs.writeFileSync(path.join(root, 'etc/group'), `fixture-group:x:${process.getgid()}:\n`);
  return { root, output, temporary, clean() {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('hello-capture-test-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  } };
}
function scan(item) {
  const run = spawnSync('bash', [scanner, item.output, item.root], { encoding: 'utf8', timeout: 30_000 });
  assert.ok([0, 2].includes(run.status), `${run.status}: ${run.stderr}`);
  assert.equal(run.error, undefined);
  const result = normalizeSnapshot(item.output, { stage: 'installed', imageId: 'sha256:fixture' });
  assert.notEqual(result.entries.get('/')?.type, 'unavailable', JSON.stringify(result.summary));
  return result;
}
const linux = { skip: process.platform !== 'linux' };

test('Linux CLI scanner preserves all path kinds, byte names, modes, hashes and hardlinks', linux, async () => {
  const item = fixture();
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path.join(item.root, 'socket'), resolve); });
    fs.writeFileSync(path.join(item.root, '.hidden'), 'hidden');
    fs.writeFileSync(path.join(item.root, 'empty'), '');
    fs.writeFileSync(path.join(item.root, 'ordinary'), 'payload');
    fs.chmodSync(path.join(item.root, 'ordinary'), 0o4751);
    fs.linkSync(path.join(item.root, 'ordinary'), path.join(item.root, 'hardlink'));
    fs.symlinkSync('ordinary', path.join(item.root, 'link'));
    fs.symlinkSync('missing', path.join(item.root, 'dangling'));
    fs.symlinkSync('cycle', path.join(item.root, 'cycle'));
    fs.mkdirSync(path.join(item.root, 'directory'));
    fs.writeFileSync(path.join(item.root, 'directory/child'), 'child');
    fs.mkdirSync(path.join(item.root, '中文'));
    const unicodeTarget = Buffer.concat([Buffer.from('中文/leaf-'), Buffer.from([0xff])]);
    fs.writeFileSync(Buffer.concat([Buffer.from(item.root + '/'), unicodeTarget]), 'unicode parent');
    fs.symlinkSync(unicodeTarget, path.join(item.root, 'unicode-link'));
    fs.symlinkSync('directory', path.join(item.root, 'directory-link'));
    fs.symlinkSync('directory-link/child', path.join(item.root, 'indirect-link'));
    const odd = Buffer.concat([Buffer.from(`${item.root}/line\n\t-`), Buffer.from([0xff, 0xfe])]);
    fs.writeFileSync(odd, 'odd');
    fs.symlinkSync('line\n', path.join(item.root, 'link-newline'));
    execFileSync('mkfifo', [path.join(item.root, 'pipe')]);
    const sparse = fs.openSync(path.join(item.root, 'sparse'), 'w');
    fs.writeSync(sparse, Buffer.from('end'), 0, 3, 4 * 1024 * 1024); fs.closeSync(sparse);
    const result = scan(item);
    assert.equal(result.header.imageId, 'sha256:fixture');
    assert.equal(result.entries.get('/ordinary').permissionsOctal, '4751');
    assert.equal(result.entries.get('/ordinary').specialBits.setuid, true);
    assert.equal(result.entries.get('/ordinary').user, 'fixture-user');
    assert.equal(result.entries.get('/ordinary').sha256, createHash('sha256').update('payload').digest('hex'));
    assert.deepEqual(result.entries.get('/ordinary').hardlinkPaths.sort(), ['/hardlink', '/ordinary']);
    assert.equal(result.entries.get('/link').linkState, 'resolved');
    assert.equal(result.entries.get('/link').resolvedPath, '/ordinary');
    assert.equal(result.entries.get('/dangling').linkState, 'dangling');
    assert.equal(result.entries.get('/cycle').linkState, 'cycle');
    assert.equal(result.entries.get('/indirect-link').resolvedPath, '/directory/child');
    assert.equal(result.entries.get('/pipe').type, 'fifo');
    assert.equal(result.entries.get('/pipe').hashStatus, 'not-applicable');
    assert.equal(result.entries.get('/socket').type, 'socket');
    assert.equal(result.entries.get('/socket').hashStatus, 'not-applicable');
    assert.equal(result.entries.get('/link-newline').linkTarget, 'line\n');
    assert.equal(result.entries.get('/empty').sizeBytes, '0');
    assert.ok(result.entries.has('/.hidden'));
    assert.ok(BigInt(result.entries.get('/sparse').allocatedBytes) < BigInt(result.entries.get('/sparse').sizeBytes));
    const oddEntry = [...result.entries.values()].find(entry => entry.pathBytesBase64 === Buffer.concat([Buffer.from('/line\n\t-'), Buffer.from([0xff, 0xfe])]).toString('base64'));
    assert.ok(oddEntry);
    assert.equal(oddEntry.sha256, createHash('sha256').update('odd').digest('hex'));
    assert.equal(result.entries.get('/unicode-link').resolvedPath, '/中文/leaf-\udcff');
    assert.equal(result.entries.get('/unicode-link').linkState, 'resolved');
    assert.equal(result.entries.get('/中文/leaf-\udcff').sha256, createHash('sha256').update('unicode parent').digest('hex'));
    assert.equal(result.entries.get('/ordinary').times.modified.nanoseconds % 1, 0);
    // Host-only tests may lack optional metadata CLIs. They must be reported,
    // never silently claimed complete; baseline images provide all these tools.
    assert.ok(result.summary.collectionErrors.every(error => ['acl', 'xattrs', 'capabilities', 'attributes'].includes(error.operation)), JSON.stringify(result.summary));
    assert.ok([...result.entries.values()].every(entry => entry.errors.length === 0), JSON.stringify([...result.entries.values()].filter(entry => entry.errors.length)));
    assert.equal(result.summary.complete, result.summary.errors === 0);
  } finally { await new Promise(resolve => server.close(resolve)); item.clean(); }
});

test('raw getfacl/getfattr evidence decodes escaped byte paths, binary values and empty values', linux, () => {
  const item = fixture();
  try {
    const name = path.join(item.root, 'new\nline'); fs.writeFileSync(name, 'test');
    scan(item);
    const escaped = name.replaceAll('\n', '\\012');
    fs.writeFileSync(path.join(item.output, 'acl.raw'), `# file: ${escaped}\n# owner: 1000\nuser::rw-\nuser:123:r--\ngroup::r--\nmask::r--\nother::---\n\n`);
    fs.writeFileSync(path.join(item.output, 'xattrs.raw'), `# file: ${escaped}\nuser.binary=0sAP8K\nuser.empty=0s\nsecurity.capability=0sAQIDBA==\n\n`);
    const result = normalizeSnapshot(item.output, { stage: 'test' }).entries.get('/new\nline');
    assert.deepEqual(result.xattrs, { 'user.binary': 'AP8K', 'user.empty': '', 'security.capability': 'AQIDBA==' });
    assert.equal(result.capabilities, 'AQIDBA==');
    assert.ok(result.acl.entries.includes('user:123:r--'));
  } finally { item.clean(); }
});

test('missing checksum, traversal failure and truncated framing never produce a complete snapshot', linux, () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.root, 'file'), 'data'); scan(item);
    fs.writeFileSync(path.join(item.output, 'hashes.nul'), Buffer.alloc(0));
    fs.appendFileSync(path.join(item.output, 'steps.tsv'), 'find\t1\n');
    fs.writeFileSync(path.join(item.output, 'find.stderr'), 'Permission denied: fixture directory');
    const result = normalizeSnapshot(item.output);
    assert.equal(result.summary.complete, false);
    assert.equal(result.entries.get('/file').hashStatus, 'failed');
    assert.ok(result.summary.collectionErrors.some(error => error.operation === 'find'));
    fs.writeFileSync(path.join(item.output, 'stat.after.nul'), 'truncated');
    const truncated = normalizeSnapshot(item.output);
    assert.equal(truncated.summary.complete, false);
    assert.ok(truncated.summary.collectionErrors.some(error => error.operation === 'parse'));
  } finally { item.clean(); }
});

test('output within scanned fixture and reuse of existing evidence are refused', linux, () => {
  const item = fixture();
  try {
    assert.equal(spawnSync('bash', [scanner, path.join(item.root, 'output'), item.root]).status, 64);
    scan(item);
    assert.equal(spawnSync('bash', [scanner, item.output, item.root]).status, 64);
  } finally { item.clean(); }
});

test('mode-only or hash-time metadata changes are preserved as instability', linux, () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.root, 'file'), 'data'); scan(item);
    const afterFile = path.join(item.output, 'stat.after.nul');
    const fields = fs.readFileSync(afterFile).toString('latin1').split('\0');
    const index = fields.indexOf(path.join(item.root, 'file'));
    assert.ok(index >= 0);
    fields[index + 1] = '8180';
    fs.writeFileSync(afterFile, Buffer.from(fields.join('\0'), 'latin1'));
    const result = normalizeSnapshot(item.output);
    assert.equal(result.summary.complete, false);
    assert.ok(result.entries.get('/file').errors.some(error => error.operation === 'stability'));
  } finally { item.clean(); }
});

test('installer evidence stays bounded and package ownership comes from saved target records', linux, () => {
  const item = fixture();
  try {
    const folder = path.join(item.root, 'usr/local/share/hello-capture/java');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'lock.json'), '{"jdk":"fixture"}');
    fs.symlinkSync('/etc/passwd', path.join(folder, 'not-metadata'));
    fs.writeFileSync(path.join(item.root, 'payload'), 'product');
    scan(item);
    assert.equal(fs.readFileSync(path.join(item.output, 'install-metadata/hello-capture/java/lock.json'), 'utf8'), '{"jdk":"fixture"}');
    assert.equal(fs.existsSync(path.join(item.output, 'install-metadata/hello-capture/java/not-metadata')), false);
    fs.writeFileSync(path.join(item.output, 'package-files.nul'), 'fixture:amd64\0/payload\n\0');
    fs.writeFileSync(path.join(item.output, 'package-versions.tsv'), 'fixture:amd64\t1.2.3\tamd64\tinstalled\n');
    const result = normalizeSnapshot(item.output);
    assert.deepEqual(result.entries.get('/payload').packages, ['fixture:amd64']);
    assert.deepEqual(result.entries.get('/payload').packageVersions, [{ name: 'fixture:amd64', version: '1.2.3', architecture: 'amd64' }]);
  } finally { item.clean(); }
});

test('actual unreadable files and untraversable directories cannot be reported complete', { skip: process.platform !== 'linux' || process.getuid?.() === 0 }, () => {
  const item = fixture();
  const unreadable = path.join(item.root, 'unreadable');
  const lockedDirectory = path.join(item.root, 'locked-directory');
  try {
    fs.writeFileSync(unreadable, 'cannot read'); fs.chmodSync(unreadable, 0);
    fs.mkdirSync(lockedDirectory);
    fs.writeFileSync(path.join(lockedDirectory, 'unreachable'), 'cannot traverse');
    fs.chmodSync(lockedDirectory, 0);
    const result = scan(item);
    assert.equal(result.summary.complete, false);
    assert.equal(result.entries.get('/unreadable').hashStatus, 'failed');
    assert.ok(result.entries.get('/unreadable').errors.some(error => error.operation === 'hash'));
    assert.ok(result.summary.collectionErrors.some(error => error.operation === 'find'));
    assert.equal(result.entries.has('/locked-directory/unreachable'), false);
    assert.match(fs.readFileSync(path.join(item.output, 'find.stderr'), 'utf8'), /Permission denied/);
    assert.match(fs.readFileSync(path.join(item.output, 'hash.stderr'), 'utf8'), /Permission denied/);
  } finally {
    if (fs.existsSync(unreadable)) fs.chmodSync(unreadable, 0o600);
    if (fs.existsSync(lockedDirectory)) fs.chmodSync(lockedDirectory, 0o700);
    item.clean();
  }
});
