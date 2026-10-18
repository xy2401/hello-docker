// MongoDB execution lifecycle. Business rules are supplied by meta.rulesScript.
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = process.env.CASE_SERVICE_DIR;
  const { readMeta, hash, executionHashes } = require(path.join(root, 'scripts/meta.cjs'));
  const meta = readMeta(root);
  const filename = process.env.CASE_QUERY_FILE;
  const definition = meta.files.find(item => path.basename(item.input) === filename);
  if (!definition) throw new Error('Input is not declared in meta.json');
  const outputPath = path.join(root, definition.output);
  const recordPath = path.join(root, 'output/.verification', `${filename}.json`);
  await load(path.join(root, meta.rulesScript));
  const rules = globalThis.CaseRules;
  if (!rules?.sourceDatabase || !rules.prepare || !rules.verify || !rules.snapshot) throw new Error('Invalid MongoDB rules script');
  const source = db.getSiblingDB(rules.sourceDatabase);
  let target = definition.database === 'temporary' ? source : source.getSiblingDB(definition.database);
  let temporaryDatabase = null;
  let temporaryDatabaseCreated = false;
  let result;
  let assertions = 0;
  const record = {
    schemaVersion: 3, runId: process.env.CASE_RUN_ID, id: definition.id, input: filename,
    status: 'running', startedAt: new Date().toISOString(),
    inputSha256: hash(path.join(root, definition.input)), ...executionHashes(root, meta),
    sourceDatabase: rules.sourceDatabase, preparationInputs: [],
  };
  if (record.runnerSha256 !== process.env.CASE_RUNNER_SHA256) throw new Error('Execution entry changed after startup');
  const saveRecord = () => fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    assertions++;
  };
  // Capture the mongosh-transformed expression without changing input files.
  async function execute(id, preparation = false) {
    const item = meta.files.find(candidate => candidate.id === id);
    if (!item) throw new Error(`Preparation input is not declared in meta.json: ${id}`);
    const input = path.join(root, item.input);
    const expression = fs.readFileSync(input, 'utf8').trim().replace(/;\s*$/, '');
    if (!/^(?:\s*\/\/[^\n]*\n)*\s*db\./.test(expression)) throw new Error('Input must be a database expression');
    if (preparation) record.preparationInputs.push({ input: path.basename(item.input), sha256: hash(input) });
    const captureDir = fs.mkdtempSync('/tmp/mongo-case-query-');
    const captureFile = path.join(captureDir, 'expression.js');
    try {
      fs.writeFileSync(captureFile, `globalThis.__caseQueryResult = (\n${expression}\n);\n`);
      db = target;
      await load(captureFile);
      const value = globalThis.__caseQueryResult;
      delete globalThis.__caseQueryResult;
      return value;
    } finally {
      if (fs.existsSync(captureFile)) fs.unlinkSync(captureFile);
      fs.rmdirSync(captureDir);
    }
  }
  try {
    record.mongoDBVersion = await source.version();
    record.mongoshVersion = version();
    record.sourceSnapshot = await rules.snapshot(source);
    saveRecord();
    const reason = rules.skipReason?.(definition);
    if (reason) {
      record.status = 'skipped';
      record.reason = reason;
    } else {
      if (definition.database === 'temporary') {
        temporaryDatabase = `hello_case_validation_${new ObjectId().toHexString()}`;
        check(!(await source.getMongo().getDBNames()).includes(temporaryDatabase), 'Temporary database already exists');
        target = source.getSiblingDB(temporaryDatabase);
        temporaryDatabaseCreated = true;
        record.writeDatabase = temporaryDatabase;
        record.temporaryDatabaseCreated = true;
        saveRecord();
        await rules.createTemporaryDatabase(target);
      }
      const context = { definition, source, target, check, record, execute, root, hash };
      rules.bindParameters?.(context);
      await rules.prepare(context);
      result = await execute(definition.id);
      await rules.verify(context, result);
      check(result !== undefined, 'Database expression returned undefined');
      record.status = 'passed';
    }
  } catch (error) {
    record.status = 'failed';
    record.error = { name: error.name, message: error.message };
  } finally {
    if (temporaryDatabaseCreated) {
      try {
        check(/^hello_case_validation_[0-9a-f]{24}$/.test(temporaryDatabase), 'Cleanup namespace rejected');
        check((await target.dropDatabase()).ok === 1, 'Temporary database cleanup failed');
        record.cleanup = 'temporary validation database removed';
      } catch (error) {
        record.status = 'failed';
        record.cleanupError = { name: error.name, message: error.message };
      }
    }
    record.assertions = assertions;
    record.finishedAt = new Date().toISOString();
    if (record.status === 'passed') {
      const serialized = EJSON.stringify(result, null, 2, { relaxed: true }) + '\n';
      JSON.parse(serialized);
      fs.writeFileSync(`${outputPath}.part`, serialized);
      fs.renameSync(`${outputPath}.part`, outputPath);
      record.output = path.basename(definition.output);
      record.outputSha256 = hash(outputPath);
    }
    saveRecord();
    print(JSON.stringify({ input: filename, status: record.status, output: record.output || null, error: record.error?.message || record.cleanupError?.message || null }));
  }
  if (record.status === 'failed') quit(1);
})();
