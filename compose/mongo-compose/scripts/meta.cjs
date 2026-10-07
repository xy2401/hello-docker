// MongoDB adapter: meta.json is the only runnable case list.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readMeta(root) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'meta.json'), 'utf8'));
  if (meta.schemaVersion !== 1 || meta.runtime !== 'mongosh' || meta.outputFormat !== 'mongodb-extended-json') {
    throw new Error('Unsupported MongoDB case metadata');
  }
  if (typeof meta.id !== 'string' || !meta.id || typeof meta.title !== 'string' || !meta.title) throw new Error('Missing case identity or title');
  if (meta.runScript !== 'scripts/run.sh' || meta.summary !== 'output/summary.json') throw new Error('Unexpected MongoDB entry or summary path');
  if (!/^scripts\/[a-z0-9-]+\.js$/.test(meta.rulesScript)) throw new Error('Invalid rulesScript');
  const requiredRuntimeFiles = ['scripts/meta.cjs', 'scripts/run-query.js', 'scripts/summarize.js', meta.rulesScript];
  if (!Array.isArray(meta.runtimeFiles) || !requiredRuntimeFiles.every(file => meta.runtimeFiles.includes(file))) {
    throw new Error('Missing runtime dependencies');
  }
  for (const file of meta.runtimeFiles) {
    if (!/^scripts\/[a-z0-9-]+\.c?js$/.test(file) || !fs.statSync(path.join(root, file)).isFile()) throw new Error(`Invalid runtime file: ${file}`);
  }
  if (!Array.isArray(meta.files) || !meta.files.length) throw new Error('meta.json has no inputs');
  const ids = new Set();
  const inputs = new Set();
  for (const item of meta.files) {
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate case id: ${item.id}`);
    if (typeof item.title !== 'string' || !item.title) throw new Error(`Missing input title: ${item.id}`);
    if (!/^input\/[a-z0-9][a-z0-9.-]*\.js$/.test(item.input) || inputs.has(item.input)) throw new Error(`Invalid or duplicate input: ${item.input}`);
    if (item.output !== `output/${path.basename(item.input)}.json`) throw new Error(`Output must match input: ${item.id}`);
    if (typeof item.database !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.database)) throw new Error(`Invalid database: ${item.id}`);
    if (!fs.statSync(path.join(root, item.input)).isFile()) throw new Error(`Missing input: ${item.input}`);
    ids.add(item.id);
    inputs.add(item.input);
  }
  // sourceManifest is optional trace information; execution does not read it.
  if (meta.sourceManifest && !/^[a-z0-9-]+\.json$/.test(meta.sourceManifest)) throw new Error('Invalid sourceManifest path');
  return meta;
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function executionHashes(root, meta) {
  return {
    metaSha256: hash(path.join(root, 'meta.json')),
    runtimeSha256: Object.fromEntries(meta.runtimeFiles.map(file => [file, hash(path.join(root, file))])),
    runnerSha256: hash(path.join(root, meta.runScript)),
  };
}

module.exports = { readMeta, hash, executionHashes };
