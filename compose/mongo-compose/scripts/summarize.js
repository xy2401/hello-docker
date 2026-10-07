// Execution status is checked against meta.json; source.json only adds trace data.
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = process.env.CASE_SERVICE_DIR;
  const { readMeta, hash, executionHashes } = require(path.join(root, 'scripts/meta.cjs'));
  const meta = readMeta(root);
  const outputDir = path.join(root, 'output');
  const recordsDir = path.join(outputDir, '.verification');
  const expected = executionHashes(root, meta);
  await load(path.join(root, meta.rulesScript));
  const rules = globalThis.CaseRules;
  const cases = [];
  for (const definition of meta.files) {
    const filename = path.basename(definition.input);
    const exitFile = path.join(recordsDir, `${filename}.exit-code.txt`);
    const recordFile = path.join(recordsDir, `${filename}.json`);
    const outputFile = path.join(root, definition.output);
    let record = { id: definition.id, input: filename, status: 'not-run' };
    if (fs.existsSync(exitFile)) {
      try {
        record = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : { id: definition.id, input: filename, status: 'failed', error: { message: 'Execution did not produce a verification record' } };
        record.exitCode = Number(fs.readFileSync(exitFile, 'utf8').trim());
        if (!Number.isInteger(record.exitCode)) throw new Error('Invalid process exit code');
        if (record.exitCode !== 0 || record.status === 'running') {
          record.status = 'failed';
          record.error ||= { message: `Process exited with code ${record.exitCode}` };
        }
        if (record.status !== 'failed') {
          if (record.runId !== process.env.CASE_RUN_ID || record.id !== definition.id || record.input !== filename) throw new Error('Execution identity mismatch');
          if (record.inputSha256 !== hash(path.join(root, definition.input))) throw new Error('Input hash mismatch');
          for (const [key, value] of Object.entries(expected)) {
            if (JSON.stringify(record[key]) !== JSON.stringify(value)) throw new Error(`Execution source mismatch: ${key}`);
          }
          for (const item of record.preparationInputs) {
            const preparation = meta.files.find(candidate => path.basename(candidate.input) === item.input);
            if (!preparation || item.sha256 !== hash(path.join(root, preparation.input))) throw new Error('Preparation input hash mismatch');
          }
          if (record.status === 'passed') {
            JSON.parse(fs.readFileSync(outputFile, 'utf8'));
            if (record.output !== path.basename(definition.output) || record.outputSha256 !== hash(outputFile) || !(record.assertions > 0)) throw new Error('Result hash or assertions mismatch');
          } else if (record.status !== 'skipped') {
            throw new Error('Unknown verification status');
          }
        }
      } catch (error) {
        record.status = 'failed';
        record.error = { name: error.name, message: error.message };
      }
      // A timeout can interrupt finally. Only clean a database created by this run.
      if (record.runId === process.env.CASE_RUN_ID && record.temporaryDatabaseCreated && record.cleanup !== 'temporary validation database removed') {
        try {
          if (!/^hello_case_validation_[0-9a-f]{24}$/.test(record.writeDatabase)) throw new Error('Cleanup namespace rejected');
          const cleanup = await db.getSiblingDB(record.writeDatabase).dropDatabase();
          if (cleanup.ok !== 1) throw new Error('Interrupted database cleanup failed');
          record.cleanup = 'temporary validation database removed by summary after interruption';
        } catch (error) {
          record.status = 'failed';
          record.cleanupError = { name: error.name, message: error.message };
        }
      }
      const log = path.join(recordsDir, `${filename}.stdout.txt`);
      const stderr = path.join(recordsDir, `${filename}.stderr.txt`);
      record.logs = {
        stdout: `.verification/${filename}.stdout.txt`, stdoutSha256: fs.existsSync(log) ? hash(log) : null,
        stderr: `.verification/${filename}.stderr.txt`, stderrSha256: fs.existsSync(stderr) ? hash(stderr) : null,
        exitCodeSha256: hash(exitFile),
      };
    }
    if (record.status !== 'passed') {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      if (fs.existsSync(`${outputFile}.part`)) fs.unlinkSync(`${outputFile}.part`);
      delete record.output;
      delete record.outputSha256;
    }
    if (fs.existsSync(exitFile)) fs.writeFileSync(recordFile, JSON.stringify(record, null, 2) + '\n');
    cases.push(record);
  }
  let database;
  try {
    const source = db.getSiblingDB(rules.sourceDatabase);
    const before = cases.find(item => item.sourceSnapshot)?.sourceSnapshot || null;
    const after = await rules.snapshot(source);
    const remainingBatchDatabases = (await source.getMongo().getDBNames()).filter(name => cases.some(item => item.writeDatabase === name));
    database = { version: await source.version(), before, after, sampleCountsUnchanged: before ? JSON.stringify(before) === JSON.stringify(after) : null, remainingBatchDatabases };
  } catch (error) {
    database = { error: { name: error.name, message: error.message } };
  }
  let provenance = { status: 'not-declared' };
  let sourceInfo = null;
  if (meta.sourceManifest) {
    const sourceFile = path.join(root, meta.sourceManifest);
    provenance = { file: meta.sourceManifest, status: 'missing' };
    if (fs.existsSync(sourceFile)) {
      try {
        sourceInfo = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
        provenance = { file: meta.sourceManifest, status: 'recorded', sha256: hash(sourceFile), repository: sourceInfo.repository, commit: sourceInfo.commit, license: sourceInfo.license };
      } catch (error) {
        provenance.status = 'invalid';
        provenance.error = error.message;
      }
    }
  }
  const status = cases.some(item => ['failed', 'not-run'].includes(item.status)) || database.error || database.sampleCountsUnchanged === false || database.remainingBatchDatabases?.length ? 'failed' : 'completed';
  const summary = {
    schemaVersion: 3, runId: process.env.CASE_RUN_ID, generatedAt: new Date().toISOString(), status,
    ...expected, provenance,
    coverage: { inputExpressions: meta.files.length, businessFunctions: sourceInfo?.businessFunctions?.length ?? null, extractedCollectionStatements: sourceInfo?.databaseStatementCount ?? null },
    counts: Object.fromEntries(['passed', 'failed', 'skipped', 'not-run'].map(state => [state, cases.filter(item => item.status === state).length])),
    database, cases,
  };
  fs.writeFileSync(path.join(root, meta.summary), JSON.stringify(summary, null, 2) + '\n');
  print(JSON.stringify({ status: summary.status, counts: summary.counts, provenance: provenance.status }));
  if (summary.status === 'failed') quit(1);
})();
