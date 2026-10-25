#!/usr/bin/env node
// Parse saved command output only; this module never inspects the target rootfs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const decoder = new TextDecoder('utf-8', { fatal: true });
export function byteText(bytes) {
  try { return decoder.decode(bytes); }
  catch {
    // Decode valid UTF-8 spans even when another filename component contains
    // invalid bytes. This keeps parent path keys identical to child prefixes.
    let output = '';
    for (let index = 0; index < bytes.length;) {
      const first = bytes[index];
      if (first < 128) { output += String.fromCharCode(first); index++; continue; }
      const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
      const span = bytes.subarray(index, index + width);
      try {
        if (!width || span.length !== width) throw new Error('Invalid UTF-8 sequence');
        output += decoder.decode(span); index += width;
      } catch { output += String.fromCharCode(0xdc00 + first); index++; }
    }
    return output;
  }
}
function nulRecords(bytes, width, name) {
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 0) throw new Error(`Truncated NUL stream: ${name}`);
  const fields = []; let start = 0;
  for (let index = 0; index < bytes.length; index++) if (bytes[index] === 0) { fields.push(bytes.subarray(start, index)); start = index + 1; }
  if (fields.length % width) throw new Error(`Incomplete ${width}-field record: ${name}`);
  const rows = [];
  for (let index = 0; index < fields.length; index += width) rows.push(fields.slice(index, index + width));
  return rows;
}
function unquote(text) {
  return Buffer.from(text.replace(/\\([0-7]{3})/g, (_, digits) => String.fromCharCode(parseInt(digits, 8))), 'latin1');
}
function timestamp(text) {
  const match = /^(-?)(\d+)\.(\d{9})$/.exec(text);
  if (!match) throw new Error(`stat lacks nanosecond format: ${text}`);
  const value = (BigInt(match[2]) * 1_000_000_000n + BigInt(match[3])) * (match[1] ? -1n : 1n);
  let seconds = value / 1_000_000_000n, nanos = value % 1_000_000_000n;
  if (nanos < 0) { seconds--; nanos += 1_000_000_000n; }
  return { seconds: String(seconds), nanoseconds: Number(nanos) };
}
function accountMap(bytes) {
  const result = new Map();
  for (const line of bytes.toString('latin1').split('\n')) {
    const fields = line.split(':');
    if (/^\d+$/.test(fields[2] ?? '')) result.set(Number(fields[2]), byteText(Buffer.from(fields[0], 'latin1')));
  }
  return result;
}
function numeric(value, field) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${field}: ${value}`);
  return value;
}
const unavailable = reason => ({ status: 'unsupported', reason });
const supported = () => ({ status: 'available' });

export function normalizeSnapshot(directory, { stage = 'snapshot', imageId = null } = {}) {
  const errors = [];
  const read = (name, optional = false) => {
    try { return fs.readFileSync(path.join(directory, name)); }
    catch (error) { if (!optional) errors.push({ operation: 'read-evidence', file: name, error: error.message }); return Buffer.alloc(0); }
  };
  const rows = (name, width) => {
    try { return nulRecords(read(name), width, name); }
    catch (error) { errors.push({ operation: 'parse', file: name, error: error.message }); return []; }
  };
  let scanInfo = {};
  try { scanInfo = JSON.parse(read('scan-info.json')); } catch { errors.push({ operation: 'completion', error: 'Missing or invalid scan completion marker' }); }
  if (scanInfo.format !== 'linux-cli-nul-v1' || !scanInfo.finished) errors.push({ operation: 'completion', error: 'Unsupported or unfinished scan' });
  const root = read('root.raw');
  const relative = absolute => {
    if (root.equals(Buffer.from('/'))) return absolute;
    if (absolute.equals(root)) return Buffer.from('/');
    if (!absolute.subarray(0, root.length).equals(root) || absolute[root.length] !== 47) throw new Error('Raw path outside declared scan root');
    return absolute.subarray(root.length);
  };
  const key = absolute => byteText(relative(absolute));
  const excluded = rows('excluded.nul', 1).map(([item]) => key(item));
  const steps = new Map();
  for (const line of read('steps.tsv').toString().trim().split('\n').filter(Boolean)) {
    const [name, code] = line.split('\t');
    if (!/^\d+$/.test(code ?? '')) errors.push({ operation: 'parse-status', error: line });
    else steps.set(name, Number(code));
  }
  const requiredSteps = ['find', 'stat-before', 'regular', 'nonlinks', 'attributes-list', 'links', 'hash', 'acl', 'xattrs', 'capabilities', 'attributes', 'stat-after'];
  for (const name of requiredSteps) if (!steps.has(name)) errors.push({ operation: name, error: 'Missing command status' });
  for (const [name, code] of steps) {
    const stderr = read(`${name}.stderr`, true).toString('utf8');
    // Some filesystems do not implement FS_IOC_GETFLAGS. Preserve the evidence,
    // but do not confuse that explicit unsupported field with a lost file.
    const unsupportedFlags = name === 'attributes' && stderr.trim().split('\n').every(line => /^lsattr: (?:Operation not supported|Inappropriate ioctl for device) /.test(line));
    if (code !== 0 && !unsupportedFlags) errors.push({ operation: name, exitCode: code, error: stderr || 'Command failed without stderr', rawEvidence: `${name}.stderr` });
  }
  const users = accountMap(read('passwd.raw')), groups = accountMap(read('group.raw'));
  const before = rows('stat.before.nul', 21), after = rows('stat.after.nul', 21);
  const afterByPath = new Map(after.map(row => [row[0].toString('base64'), row]));
  const entries = new Map();
  for (const values of before) {
    try {
      const pathname = key(values[0]);
      if (entries.has(pathname)) throw new Error('Duplicate stat path');
      const [, modeHex, octal, permissions, uidText, gidText, size, blocks, blockUnit, blockSize, inode, device, links, rmajor, rminor, atime, mtime, ctime, birth, birthText] = values.map(value => value.toString('latin1'));
      if (!/^[0-9a-f]+$/i.test(modeHex) || !/^[0-7]+$/.test(octal)) throw new Error('Invalid raw mode');
      const mode = parseInt(modeHex, 16), uid = Number(numeric(uidText, 'uid')), gid = Number(numeric(gidText, 'gid'));
      const kind = ({ [0o100000]: 'file', [0o040000]: 'directory', [0o120000]: 'symlink', [0o020000]: 'character-device', [0o060000]: 'block-device', [0o010000]: 'fifo', [0o140000]: 'socket' })[mode & 0o170000] ?? 'unknown';
      const dev = BigInt(numeric(device, 'device'));
      const record = {
        path: pathname, pathBytesBase64: relative(values[0]).toString('base64'), type: kind, stage, mode,
        permissionsOctal: octal.padStart(4, '0'), permissions,
        accessBits: Object.fromEntries([['owner', 6], ['group', 3], ['other', 0]].map(([name, shift]) => [name, { read: !!(mode & (4 << shift)), write: !!(mode & (2 << shift)), execute: !!(mode & (1 << shift)) }])),
        specialBits: { setuid: !!(mode & 0o4000), setgid: !!(mode & 0o2000), sticky: !!(mode & 0o1000) },
        uid, gid, user: users.get(uid) ?? null, group: groups.get(gid) ?? null,
        sizeBytes: numeric(size, 'size'), blocks: numeric(blocks, 'blocks'), blockUnitBytes: Number(numeric(blockUnit, 'block unit')),
        allocatedBytes: String(BigInt(blocks) * BigInt(blockUnit)), blockSize: Number(numeric(blockSize, 'block size')),
        inode: numeric(inode, 'inode'), device, deviceMajor: Number(((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn)), deviceMinor: Number((dev & 0xffn) | ((dev >> 12n) & ~0xffn)),
        rdevMajor: parseInt(rmajor, 16), rdevMinor: parseInt(rminor, 16), hardlinkCount: Number(numeric(links, 'link count')),
        hardlinkKey: kind === 'file' && Number(links) > 1 ? `${device}:${inode}` : null,
        times: { accessed: timestamp(atime), modified: timestamp(mtime), changed: timestamp(ctime), created: birthText === '-' ? null : timestamp(birth) },
        attributes: null, attributesMask: null, statxMask: null, linuxFileFlags: null,
        fieldAvailability: { statx: unavailable('Linux CLI does not expose statx result/support masks'), birthTime: birthText === '-' ? unavailable('Filesystem or stat did not return birth time') : supported(),
          user: users.has(uid) ? supported() : { status: 'unavailable', reason: 'UID absent from target /etc/passwd' },
          group: groups.has(gid) ? supported() : { status: 'unavailable', reason: 'GID absent from target /etc/group' },
          xattrs: steps.get('xattrs') === 0 ? supported() : { status: 'partial', reason: 'See xattrs.stderr' },
          acl: kind === 'symlink' ? unavailable('Linux POSIX ACL does not apply to symlink itself') : steps.get('acl') === 0 ? supported() : { status: 'partial', reason: 'See acl.stderr' },
          linuxFileFlags: unavailable('No FS_IOC_GETFLAGS result; see attributes stderr/raw records') },
        linkTarget: null, linkTargetBytesBase64: null, xattrs: {}, acl: {}, capabilities: null,
        sha256: null, hashStatus: kind === 'file' ? 'failed' : 'not-applicable', errors: [], packages: [], packageVersions: [],
      };
      const deviceMajor = BigInt(record.rdevMajor), deviceMinor = BigInt(record.rdevMinor);
      record.rdev = String((deviceMinor & 0xffn) | ((deviceMajor & 0xfffn) << 8n) | ((deviceMinor & ~0xffn) << 12n) | ((deviceMajor & ~0xfffn) << 32n));
      const final = afterByPath.get(values[0].toString('base64'));
      // Exclude atime: hashing itself may advance it on a writable rootfs.
      if (!final || [1, 4, 5, 6, 10, 11, 12, 16, 17].some(index => !values[index].equals(final[index]))) record.errors.push({ operation: 'stability', error: 'Path changed or disappeared during scan' });
      entries.set(pathname, record);
    } catch (error) { errors.push({ operation: 'stat-record', pathBytesBase64: values[0].toString('base64'), error: error.message }); }
  }
  const enumerated = new Set();
  for (const [absolute] of rows('paths.nul', 1)) {
    const name = key(absolute);
    if (enumerated.has(name)) errors.push({ operation: 'enumeration', error: 'Duplicate enumerated path', path: name });
    enumerated.add(name);
    if (!entries.has(name)) entries.set(name, { path: name, pathBytesBase64: relative(absolute).toString('base64'), type: 'unavailable', stage, errors: [{ operation: 'stat', error: 'Enumerated path has no valid stat record' }] });
  }
  if (!enumerated.has('/')) errors.push({ operation: 'enumeration', error: 'Scan root is missing from the inventory' });
  for (const record of entries.values()) if (!enumerated.has(record.path)) record.errors.push({ operation: 'enumeration', error: 'Stat record was not in the enumerated inventory' });
  for (const [absolute, target] of rows('links.nul', 2)) {
    const record = entries.get(key(absolute));
    if (record?.type === 'symlink') { record.linkTarget = byteText(target); record.linkTargetBytesBase64 = target.toString('base64'); }
  }
  for (const [raw] of rows('hashes.nul', 1)) {
    if (raw.length < 67 || !/^[0-9a-f]{64} [ *]$/.test(raw.subarray(0, 66).toString())) { errors.push({ operation: 'hash-record', error: 'Invalid checksum framing' }); continue; }
    const record = entries.get(key(raw.subarray(66)));
    if (!record || record.type !== 'file') { errors.push({ operation: 'hash-record', error: 'Hash refers to an unenumerated/nonregular path' }); continue; }
    if (record.sha256) { record.errors.push({ operation: 'hash', error: 'Duplicate checksum record' }); continue; }
    record.sha256 = raw.subarray(0, 64).toString(); record.hashStatus = 'complete';
  }
  for (const record of entries.values()) if (record.type === 'file' && record.hashStatus !== 'complete') record.errors.push({ operation: 'hash', error: 'Regular file has no successful SHA-256', rawEvidence: 'hash.stderr' });

  function dumpBlocks(name, apply) {
    let current = null, body = [];
    const flush = () => { if (current) { try { apply(entries.get(key(current)), body); } catch (error) { errors.push({ operation: name, error: error.message }); } } };
    for (const line of read(name).toString('latin1').split('\n')) {
      if (line.startsWith('# file: ')) { flush(); current = unquote(line.slice(8)); body = []; }
      else body.push(line);
    }
    flush();
  }
  dumpBlocks('acl.raw', (record, body) => {
    if (!record) throw new Error('ACL references unknown path');
    record.acl = { format: 'getfacl-numeric', entries: body.filter(line => line && !line.startsWith('#')).map(line => byteText(Buffer.from(line, 'latin1'))), support: 'mode entries alone do not prove extended ACL support' };
  });
  dumpBlocks('xattrs.raw', (record, body) => {
    if (!record) throw new Error('xattr references unknown path');
    for (const line of body.filter(line => line && !line.startsWith('#'))) {
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error('Malformed xattr record');
      const name = byteText(unquote(line.slice(0, separator))), value = line.slice(separator + 1);
      if (!/^0s(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Expected base64 getfattr encoding');
      record.xattrs[name] = value.slice(2);
      if (name === 'security.capability') record.capabilities = value.slice(2);
    }
  });
  for (const line of read('attributes.raw').toString('latin1').split('\n').filter(Boolean)) {
    const match = /^([-A-Za-z]+) (.*)$/.exec(line);
    if (!match) { errors.push({ operation: 'attributes', error: 'Malformed lsattr output' }); continue; }
    const record = entries.get(key(Buffer.from(match[2], 'latin1')));
    if (!record?.fieldAvailability) { errors.push({ operation: 'attributes', error: 'lsattr references path without stat metadata' }); continue; }
    record.linuxFileFlags = match[1]; record.fieldAvailability.linuxFileFlags = supported();
  }
  for (const [absolute, stdout, status, stderr] of rows('attributes-special.nul', 4)) {
    const record = entries.get(key(absolute));
    const flags = /^([-A-Za-z]+) /.exec(stdout.toString('latin1'))?.[1];
    if (record?.fieldAvailability && status.toString() === '0' && flags) { record.linuxFileFlags = flags; record.fieldAvailability.linuxFileFlags = supported(); }
    else if (!/^lsattr: (?:Operation not supported|Inappropriate ioctl for device) /.test(stderr.toString())) record?.errors.push({ operation: 'attributes', error: stderr.toString(), exitCode: Number(status.toString()) });
  }
  const packageVersions = new Map();
  for (const line of read('package-versions.tsv', true).toString('utf8').split('\n')) {
    const [name, version, architecture, status] = line.split('\t');
    if (status === 'installed') packageVersions.set(name, { name, version, architecture });
  }
  const packageBytes = read('package-files.nul', true);
  try {
    for (const [packageName, list] of nulRecords(packageBytes, 2, 'package-files.nul')) {
      const name = byteText(packageName);
      for (const line of list.toString('latin1').split('\n').filter(Boolean)) {
        const record = entries.get(byteText(Buffer.from(line === '/.' ? '/' : line, 'latin1')));
        if (!record?.packages) continue;
        record.packages.push(name);
        record.packageVersions.push(packageVersions.get(name) ?? packageVersions.get(name.split(':')[0]) ?? { name, version: null, reason: 'Not found in installed package database' });
      }
    }
  } catch (error) { errors.push({ operation: 'package-files', error: error.message }); }
  function resolveLink(start) {
    let pending = start.split('/'), resolved = [], hops = 0;
    const visited = new Set();
    while (pending.length) {
      const part = pending.shift();
      if (!part || part === '.') continue;
      if (part === '..') { resolved.pop(); continue; }
      const name = '/' + [...resolved, part].join('/');
      if (excluded.some(item => name === item || name.startsWith(`${item}/`))) return { linkState: 'excluded', resolvedPath: null };
      const current = entries.get(name);
      if (!current) return { linkState: 'dangling', resolvedPath: null };
      if (current.type === 'symlink') {
        const state = name + '\0' + pending.join('/');
        if (visited.has(state)) return { linkState: 'cycle', resolvedPath: null };
        visited.add(state);
        if (++hops > 40 || current.linkTarget === null) return { linkState: 'unavailable', resolvedPath: null, linkResolutionReason: 'Missing target or more than 40 link resolutions' };
        if (current.linkTarget.startsWith('/')) resolved = [];
        pending = [...current.linkTarget.split('/'), ...pending];
      } else {
        if (pending.length && current.type !== 'directory') return { linkState: 'dangling', resolvedPath: null };
        resolved.push(part);
      }
    }
    return { linkState: 'resolved', resolvedPath: '/' + resolved.join('/') };
  }
  const hardlinks = new Map();
  for (const record of entries.values()) {
    if (record.hardlinkKey) { const names = hardlinks.get(record.hardlinkKey) ?? []; names.push(record.path); hardlinks.set(record.hardlinkKey, names); }
    if (record.fieldAvailability) record.fieldAvailability.capabilities = record.capabilities === null ? { status: steps.get('xattrs') === 0 ? 'absent' : 'unavailable', reason: 'security.capability xattr; supplementary getcap output saved separately' } : supported();
    if (record.type !== 'symlink') continue;
    if (record.linkTarget === null) { record.errors.push({ operation: 'readlink', error: 'Missing link target' }); continue; }
    Object.assign(record, resolveLink(record.path));
  }
  for (const record of entries.values()) if (record.hardlinkKey) record.hardlinkPaths = hardlinks.get(record.hardlinkKey);
  const header = { recordType: 'header', schemaVersion: 1, format: 'linux-cli-nul-v1', stage, imageId, platform: 'linux', excludedMounts: excluded,
    capturedAt: read('started-at.txt').toString().trim(), finishedAt: read('finished-at.txt').toString().trim(),
    tools: read('tool-versions.txt').toString(), metadataPolicy: 'Physical enumeration; hash regular files only; pre-hash metadata; ignore atime for stability; CLI-visible xattr namespaces; no statx support masks',
    rawEvidence: ['paths.nul', 'stat.before.nul', 'stat.after.nul', 'hashes.nul', 'links.nul', 'acl.raw', 'xattrs.raw', 'capabilities.raw', 'attributes.raw', 'attributes-special.nul', 'package-files.nul', 'package-versions.tsv', 'install-metadata.nul', 'steps.tsv'] };
  const count = errors.length + [...entries.values()].reduce((sum, item) => sum + item.errors.length, 0);
  const summary = { recordType: 'summary', entries: entries.size, files: [...entries.values()].filter(item => item.type === 'file').length, errors: count, complete: count === 0, collectionErrors: errors };
  return { header, summary, entries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, stage = 'snapshot', imageId = null] = process.argv.slice(2);
  if (!directory || !/^[a-z][a-z0-9-]*$/.test(stage)) { console.error('Usage: node normalize.mjs DIRECTORY [STAGE] [IMAGE_ID]'); process.exitCode = 64; }
  else {
    const snapshot = normalizeSnapshot(directory, { stage, imageId });
    const destination = path.join(directory, `files.${stage}.jsonl`);
    fs.writeFileSync(destination, [snapshot.header, ...snapshot.entries.values(), snapshot.summary].map(value => JSON.stringify(value)).join('\n') + '\n');
    console.log(JSON.stringify({ output: destination, ...snapshot.summary }));
    if (!snapshot.summary.complete) process.exitCode = 2;
  }
}
