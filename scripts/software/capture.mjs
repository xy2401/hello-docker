import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { actionsContext, inspectImage } from '../lib/runner.mjs';
import { executeProcess } from '../lib/process.mjs';
import { sha256, stableJson, readSnapshot, diffSnapshots, attributeFiles, commandsFromFiles, pendingExamples, makeSiteBundle, stages, safeRelative } from './data.mjs';

export function offlinePlan(recipe) {
  return {
    schemaVersion: 1, product: recipe.product, platform: recipe.platform, base: recipe.base,
    recipeSha256: recipe.recipeSha256,
    phases: ['download and SHA-256 verify fixed official archives', 'resolve/download Ubuntu dependency packages; write exact version/hash lock', 'offline build dependencies and software separately', 'read-only full rootfs snapshots: base/dependencies/software', 'file proof attribution, full differences and command catalog', 'isolated command examples with separate stdout/stderr/exit codes', 'verify and export site bundle; upload artifacts only'],
    network: { preparation: 'official artifact and apt downloads only', build: 'none', inventory: 'none', examples: 'none (loopback services only)' },
    dependencyPackages: recipe.dependencies.packages,
    artifacts: [...recipe.dependencies.artifacts, ...recipe.artifacts, recipe.collector],
    snapshot: { allPaths: true, content: 'regular-file SHA-256 only; no filesystem content archive', permissions: 'mode, owner/group/other rwx, special bits, ACL, xattrs, capabilities', mounts: 'runtime mounts recorded and excluded explicitly' },
    examples: recipe.examples.map(item => ({ id: item.id, title: item.title, steps: item.steps })),
    estimates: { minutes: recipe.product.id === 'rabbitmq' ? '15–30 (includes fixed Erlang source compilation)' : '5–15', downloads: 'base image + listed archives + resolved apt dependencies; exact package bytes are written into lock.json during preparation' },
    publication: 'No commit, push, Actions dispatch or publication is performed by this plan.',
  };
}

export function packageUris(output) {
  const result = new Map();
  for (const match of output.matchAll(/^'([^']+)' (\S+) (\d+) SHA256:([a-f0-9]{64})\s*$/gm)) {
    const filename = safeRelative(match[2]);
    const value = { url: match[1], sizeBytes: Number(match[3]), sha256: match[4] };
    if (!/^https?:\/\//.test(value.url) || !Number.isSafeInteger(value.sizeBytes)) throw new Error('Invalid apt package URI');
    if (result.has(filename) && JSON.stringify(result.get(filename)) !== JSON.stringify(value)) throw new Error('Conflicting apt package URI');
    result.set(filename, value);
  }
  return result;
}

async function hashFile(file, algorithm = 'sha256') {
  const digest = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function download(asset, destination) {
  if (fs.existsSync(destination) && await hashFile(destination) === asset.sha256) return;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}: ${asset.id}`);
  let size = 0;
  const temporary = destination + '.part';
  await pipeline(Readable.fromWeb(response.body), async function* (source) {
    for await (const chunk of source) { size += chunk.length; if (size > 750 * 1024 * 1024) throw new Error('Artifact exceeds 750 MiB limit'); yield chunk; }
  }, fs.createWriteStream(temporary, { flags: 'w' }));
  if (await hashFile(temporary) !== asset.sha256) throw new Error(`Artifact checksum mismatch: ${asset.id}`);
  fs.renameSync(temporary, destination);
}

// Rootfs JSONL is streamed to disk: never truncate it to a console output buffer.
export async function streamProcess(program, args, output, { cwd, timeoutMs = 600_000 } = {}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const fd = fs.openSync(output, 'w');
  const errorFile = output + '.stderr.txt', errorFd = fs.openSync(errorFile, 'w');
  const start = Date.now();
  try {
    return await new Promise(resolve => {
      let error = null, timedOut = false, escalation;
      const child = spawn(program, args, { cwd, stdio: ['ignore', fd, errorFd], shell: false, windowsHide: true });
      const stop = () => { child.kill('SIGTERM'); escalation = setTimeout(() => child.kill('SIGKILL'), 1000); };
      const timer = setTimeout(() => { error = 'Process deadline exceeded'; timedOut = true; stop(); }, timeoutMs);
      child.on('error', cause => { error = cause.message; });
      child.on('close', (exitCode, signal) => { clearTimeout(timer); clearTimeout(escalation); resolve({ exitCode: exitCode ?? -1, signal, error, timedOut, timeMs: Date.now() - start, stdoutFile: path.relative(cwd ?? path.dirname(output), output).split(path.sep).join('/'), stderrFile: path.relative(cwd ?? path.dirname(output), errorFile).split(path.sep).join('/') }); });
    });
  } finally { fs.closeSync(fd); fs.closeSync(errorFd); }
}

function assertStep(definition, result) {
  const assertions = definition.assertions.map(assertion => {
    const actual = result[assertion.stream];
    return { ...assertion, passed: assertion.op === 'equals' ? actual === assertion.value : typeof actual === 'string' && actual.includes(assertion.value) };
  });
  return { assertions, passed: !result.error && !result.timedOut && !result.truncated && assertions.every(item => item.passed) };
}

export async function capture(root, recipe, work) {
  const context = actionsContext(root, root);
  fs.mkdirSync(work, { recursive: true });
  if (fs.existsSync(path.join(work, 'run.json'))) throw new Error('Capture directory already contains a run; use a fresh path');
  const id = `${recipe.product.id}-${context.runId}-${context.attempt}-${Date.now()}`;
  const label = `io.hello-software.capture=${id}`;
  const names = new Set(), images = new Set(), trace = [];
  const sourceHashes = Object.fromEntries(['scan.py', 'archive.py', 'capture.mjs', 'data.mjs'].map(name => [name, sha256(fs.readFileSync(path.join(root, 'scripts/software', name)))]));
  const state = { id, status: 'failed', execution: 'github-actions', sourceSha: context.sourceSha, toolSha: context.toolSha, recipeSha256: recipe.recipeSha256, sourceHashes,
    workflowUrl: context.workflowUrl, capturedAt: new Date().toISOString(), base: recipe.base, platform: recipe.platform, errors: [], cleanupErrors: [] };
  const run = async (phase, program, args, { allowFailure = false, timeoutMs = 120_000, cwd = work } = {}) => {
    const result = await executeProcess(program, args, { cwd, timeoutMs, maxBytes: 32 * 1024 * 1024 });
    const record = { phase, program, args, cwd, stdin: null, ...result }; trace.push(record);
    if (!allowFailure && (result.exitCode || result.error || result.truncated || result.timedOut)) throw new Error(`${phase}: ${result.error || result.stderr || `exit ${result.exitCode}`}`);
    return result;
  };
  let records = [], differences = [], commands = [], exampleData = pendingExamples(recipe, id), exampleContainer;
  try {
    const assets = [...recipe.artifacts, ...recipe.dependencies.artifacts, recipe.collector];
    for (const directory of ['downloads', 'debs', 'collector/runtime', 'logs']) fs.mkdirSync(path.join(work, directory), { recursive: true });
    for (const asset of assets) await download(asset, path.join(work, 'downloads', `${asset.id}.tar`));
    const archiveTool = path.join(root, 'scripts/software/archive.py');
    await run('prepare-collector', 'python3', [archiveTool, 'install', path.join(work, 'downloads/collector-python.tar'), path.join(work, 'collector/runtime'), '--strip', '0'], { timeoutMs: 180_000 });
    fs.copyFileSync(path.join(root, 'scripts/software/scan.py'), path.join(work, 'collector/scan.py'));
    fs.copyFileSync(archiveTool, path.join(work, 'collector/archive.py'));
    await run('pull-base', 'docker', ['pull', '--platform', recipe.platform, recipe.base.image], { timeoutMs: 600_000 });
    const inspected = await run('inspect-base', 'docker', ['image', 'inspect', recipe.base.image]);
    state.image = inspectImage(inspected.stdout, recipe.base.image, recipe.platform);
    const resolver = `${id}-resolve`; names.add(resolver);
    if (recipe.dependencies.packages.some(name => !/^[a-z0-9][a-z0-9+.-]*$/.test(name))) throw new Error('Invalid dependency package');
    // apt-get otherwise forces MD5 for --print-uris, even when signed SHA-256 exists.
    const resolverScript = `set -eu\napt-get update\napt-get -y --print-uris --download-only -o Acquire::ForceHash=SHA256 -o Dir::Cache::archives=/debs install --no-install-recommends ${recipe.dependencies.packages.join(' ')}\napt-get -y --download-only -o Acquire::ForceHash=SHA256 -o Dir::Cache::archives=/debs install --no-install-recommends ${recipe.dependencies.packages.join(' ')}\n`;
    const resolution = await run('resolve-dependencies', 'docker', ['run', '--name', resolver, '--label', label, '--platform', recipe.platform, '--mount', `type=bind,source=${path.join(work, 'debs')},target=/debs`, '-e', 'DEBIAN_FRONTEND=noninteractive', recipe.base.image, 'sh', '-c', resolverScript], { timeoutMs: 600_000 });
    const uris = packageUris(resolution.stdout);
    const packages = [];
    for (const filename of fs.readdirSync(path.join(work, 'debs')).filter(name => name.endsWith('.deb')).sort()) {
      safeRelative(filename);
      const file = path.join(work, 'debs', filename);
      const metadata = await run('package-metadata', 'dpkg-deb', ['--field', file, 'Package', 'Version', 'Architecture']);
      const fields = Object.fromEntries(metadata.stdout.trim().split('\n').map(line => { const separator = line.indexOf(':'); return [line.slice(0, separator), line.slice(separator + 1).trim()]; }));
      if (!fields.Package || !fields.Version || !['amd64', 'all'].includes(fields.Architecture)) throw new Error('Invalid dependency metadata');
      const expected = uris.get(filename), checksum = await hashFile(file), size = fs.statSync(file).size;
      if (!expected || checksum !== expected.sha256 || size !== expected.sizeBytes) throw new Error(`Dependency does not match signed apt metadata: ${filename}`);
      packages.push({ filename, name: fields.Package, version: fields.Version, architecture: fields.Architecture, sha256: checksum, sizeBytes: size, url: expected.url, signedDigest: { algorithm: 'sha256', value: expected.sha256 } });
    }
    const lock = { schemaVersion: 1, captureId: id, product: recipe.product, recipeSha256: recipe.recipeSha256, base: recipe.base, artifacts: assets, packages, resolvedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(work, 'lock.json'), stableJson(lock));
    for (const item of packages) if (await hashFile(path.join(work, 'debs', item.filename)) !== item.sha256) throw new Error('Dependency changed after locking');
    const python = '/__assets/collector/runtime/python/bin/python3';
    let dependencyScript = 'set -eu\nexport DEBIAN_FRONTEND=noninteractive\nset -- /__assets/debs/*.deb\nif [ -f "$1" ]; then apt-get -y --no-download --no-install-recommends install "$@"; fi\n';
    if (recipe.product.id === 'rabbitmq') dependencyScript += `mkdir -p /tmp/otp-source\n${python} -B /__assets/collector/archive.py install /__assets/downloads/erlang.tar /tmp/otp-source >/dev/null\ncd /tmp/otp-source\n./configure --prefix=/opt/erlang --without-javac --without-wx --without-odbc --without-termcap --disable-debug --disable-sctp\nmake -j2\nmake install\nrm -rf /tmp/otp-source\n`;
    fs.writeFileSync(path.join(work, 'install-dependencies.sh'), dependencyScript);
    const installation = recipe.artifacts.map(asset => `${python} -B /__assets/collector/archive.py install /__assets/downloads/${asset.id}.tar ${asset.destination} --strip ${asset.strip} >/dev/null`).join(' && ');
    const dockerfile = `ARG BASE\nFROM \${BASE} AS dependencies\nRUN --mount=type=bind,source=.,target=/__assets,ro sh /__assets/install-dependencies.sh\nFROM dependencies AS software\nRUN --mount=type=bind,source=.,target=/__assets,ro ${installation}\n${Object.entries(recipe.environment).map(([key, value]) => `ENV ${key}=${JSON.stringify(value)}`).join('\n')}\n`;
    fs.writeFileSync(path.join(work, 'Dockerfile'), dockerfile);
    for (const asset of assets) if (await hashFile(path.join(work, 'downloads', `${asset.id}.tar`)) !== asset.sha256) throw new Error(`Archive changed after preparation: ${asset.id}`);
    const built = {};
    for (const target of ['dependencies', 'software']) {
      const image = `hello-software-${recipe.product.id}:${id}-${target}`; images.add(image); built[target] = image;
      const args = ['build', '--platform', recipe.platform, '--network=none', '--pull=false', '--label', label, '--build-arg', `BASE=${recipe.base.image}`, '--target', target, '--tag', image, work];
      const file = path.join(work, 'logs', `build-${target}.stdout.txt`);
      const result = await streamProcess('docker', args, file, { cwd: work, timeoutMs: recipe.product.id === 'rabbitmq' ? 1_800_000 : 600_000 });
      trace.push({ phase: `build-${target}`, program: 'docker', args, ...result });
      if (result.exitCode || result.error) throw new Error(`Build failed: ${target}; see streamed build logs`);
    }
    const dependencyInspect = JSON.parse((await run('inspect-dependencies', 'docker', ['image', 'inspect', built.dependencies])).stdout)[0];
    const softwareInspect = JSON.parse((await run('inspect-software', 'docker', ['image', 'inspect', built.software])).stdout)[0];
    if (JSON.stringify(softwareInspect.RootFS.Layers.slice(0, dependencyInspect.RootFS.Layers.length)) !== JSON.stringify(dependencyInspect.RootFS.Layers)) throw new Error('Software image does not extend the captured dependency stage');
    state.builtImages = { dependencies: dependencyInspect.Id, software: softwareInspect.Id };
    const snapshots = {};
    for (const stage of stages) {
      const name = `${id}-${stage}`; names.add(name);
      const args = ['run', '--name', name, '--label', label, '--platform', recipe.platform, '--network', 'none', '--read-only', '--mount', `type=bind,source=${path.join(work, 'collector')},target=/__collector,readonly`, '--entrypoint', '/__collector/runtime/python/bin/python3', stage === 'base' ? recipe.base.image : built[stage], '-B', '/__collector/scan.py', '--stage', stage];
      const file = path.join(work, `files.${stage}.jsonl`);
      const result = await streamProcess('docker', args, file, { cwd: work, timeoutMs: 600_000 });
      trace.push({ phase: `snapshot-${stage}`, program: 'docker', args, ...result });
      snapshots[stage] = readSnapshot(file);
      if (![0, 2].includes(result.exitCode) || result.error) throw new Error(`Snapshot crashed: ${stage}`);
    }
    const ownership = [];
    for (const asset of recipe.artifacts) {
      if (await hashFile(path.join(work, 'downloads', `${asset.id}.tar`)) !== asset.sha256) throw new Error(`Archive changed before proof: ${asset.id}`);
      const proofFile = path.join(work, `ownership-${asset.id}.json`);
      const proof = await streamProcess('python3', [archiveTool, 'proof', path.join(work, 'downloads', `${asset.id}.tar`), asset.destination, '--strip', String(asset.strip), '--artifact', asset.id], proofFile, { cwd: work });
      if (proof.exitCode || proof.error) throw new Error('Failed payload ownership proof');
      ownership.push(...JSON.parse(fs.readFileSync(proofFile, 'utf8')));
    }
    fs.writeFileSync(path.join(work, 'ownership.json'), stableJson(ownership));
    records = attributeFiles(snapshots.base.entries, snapshots.dependencies.entries, snapshots.software.entries, ownership, recipe);
    commands = commandsFromFiles(records, recipe);
    differences = [...diffSnapshots(snapshots.base.entries, snapshots.dependencies.entries, 'base-to-dependencies'), ...diffSnapshots(snapshots.dependencies.entries, snapshots.software.entries, 'dependencies-to-software')];
    fs.writeFileSync(path.join(work, 'differences.jsonl'), differences.map(value => JSON.stringify(value)).join('\n') + (differences.length ? '\n' : ''));
    const container = `${id}-examples`; names.add(container);
    const args = ['run', '-d', '--name', container, '--label', label, '--hostname', 'capture-rabbitmq', '--platform', recipe.platform, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--tmpfs', '/work:rw,nosuid,size=768m', '--workdir', '/work', '--entrypoint', 'sh', built.software, '-c', 'while :; do sleep 3600; done'];
    await run('start-examples', 'docker', args);
    exampleContainer = container;
    const preparation = await run('prepare-examples', 'docker', ['exec', container, 'sh', '-eu', '-c', recipe.prepare], { allowFailure: true, timeoutMs: 240_000 });
    exampleData.preparation = { command: recipe.prepare, cwd: '/work', stdin: null, ...preparation };
    if (preparation.exitCode || preparation.error || preparation.truncated || preparation.timedOut) throw new Error('Example preparation failed; see preparation and service logs');
    for (const example of exampleData.examples) {
      for (const step of example.steps) {
        const result = await run(`example-${example.id}-${step.id}`, 'docker', ['exec', '--workdir', '/work', container, ...step.argv], { allowFailure: true, timeoutMs: 120_000 });
        const checked = assertStep(step, result);
        Object.assign(step, result, { assertions: checked.assertions, status: checked.passed ? 'passed' : 'failed' });
        if (step.format === 'json') {
          try { step.result = JSON.parse(result.stdout); }
          catch { step.status = 'failed'; step.parseError = 'Declared JSON output is not valid JSON'; }
        }
      }
      example.status = example.steps.every(step => step.status === 'passed') ? 'passed' : 'failed';
    }
    state.snapshots = Object.fromEntries(stages.map(stage => [stage, { ...snapshots[stage].summary, excludedMounts: snapshots[stage].header.excludedMounts }]));
    state.status = Object.values(state.snapshots).every(item => item.complete) && exampleData.examples.every(item => item.status === 'passed') ? 'passed' : 'partial';
  } catch (error) { state.errors.push(error.message); }
  finally {
    if (exampleContainer && recipe.product.id !== 'java') {
      const logScript = recipe.product.id === 'mongodb'
        ? 'if [ -f /work/mongod.log ]; then tail -c 1048576 /work/mongod.log; fi'
        : 'for file in /work/rabbitmq/log/*.log; do if [ -f "$file" ]; then printf "\\n%s\\n" "$file"; tail -c 1048576 "$file"; fi; done';
      const log = await run('service-logs', 'docker', ['exec', exampleContainer, 'sh', '-c', logScript], { allowFailure: true, timeoutMs: 30_000 });
      fs.writeFileSync(path.join(work, 'logs/service.stdout.txt'), log.stdout);
      fs.writeFileSync(path.join(work, 'logs/service.stderr.txt'), log.stderr);
    }
    for (const name of names) {
      const result = await run('cleanup-container', 'docker', ['rm', '--force', name], { allowFailure: true, timeoutMs: 30_000 });
      if (result.exitCode && !/No such container/.test(result.stderr)) state.cleanupErrors.push({ name, error: result.stderr });
    }
    for (const image of [...images].reverse()) {
      const result = await run('cleanup-image', 'docker', ['image', 'rm', image], { allowFailure: true, timeoutMs: 30_000 });
      if (result.exitCode && !/No such image/.test(result.stderr)) state.cleanupErrors.push({ image, error: result.stderr });
    }
    if (state.cleanupErrors.length) state.status = 'failed';
    fs.writeFileSync(path.join(work, 'examples.json'), stableJson(exampleData));
    fs.writeFileSync(path.join(work, 'steps.json'), stableJson(trace));
    fs.writeFileSync(path.join(work, 'recipe.json'), stableJson(Object.fromEntries(Object.entries(recipe).filter(([key]) => key !== 'recipeSha256'))));
    state.artifacts = {};
    for (const name of fs.readdirSync(work).filter(name => /^(?:files\..*\.jsonl(?:\.stderr\.txt)?|(?:examples|steps|recipe|lock|ownership)\.json|differences\.jsonl)$/.test(name))) state.artifacts[name] = { sha256: await hashFile(path.join(work, name)), sizeBytes: fs.statSync(path.join(work, name)).size };
    if (fs.existsSync(path.join(work, 'logs'))) for (const name of fs.readdirSync(path.join(work, 'logs')).filter(name => name.endsWith('.txt'))) state.artifacts[`logs/${name}`] = { sha256: await hashFile(path.join(work, 'logs', name)), sizeBytes: fs.statSync(path.join(work, 'logs', name)).size };
    fs.writeFileSync(path.join(work, 'run.json'), stableJson(state));
    makeSiteBundle(path.join(work, 'site'), recipe, state, records, differences, commands, exampleData);
  }
  return state;
}
