/* eslint-disable @typescript-eslint/no-require-imports -- Disposable native PostgreSQL qualification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client, Query } = require('pg');
const { runAdditionalQualification, assertNoRemoteConfiguration, assertNoLinkedProject } =
  require('./run-square-durable-page-qualification.js');
const { runContainerQualification } = require('./qbo-candidate-local-container.cjs');

const root = path.resolve(__dirname, '..');
const productionSquare = [
  '20260925032300_square_production_customer_connection.sql',
  '20260929004917_square_customer_service_backend.sql',
  '20260929041048_square_customer_payment_history.sql',
  '20260929052211_square_customer_payment_browse.sql',
];
const candidates = [
  '20260930001000_qbo_customer_oauth_completion.sql',
  '20260930002000_qbo_production_ongoing_sync.sql',
  '20260930003000_qbo_customer_source_browse.sql',
  '20260930004000_qbo_production_source_validation.sql',
];
const suiteNames = [
  'qbo_customer_oauth_completion.test.sql',
  'external_integrations_qbo_ongoing_sync.test.sql',
  'qbo_customer_source_browse.test.sql',
  'qbo_production_source_validation.test.sql',
];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fixtureInclude = '\\ir fixtures/qbo-production-native.sql';

function expandFixture(sql, fixture) {
  let includes = 0;
  const expanded = sql.split('\n').map(line => {
    if (!/^\s*\\/.test(line)) return line;
    assert.equal(line.trim(), fixtureInclude, 'only the fixed candidate fixture include is allowed');
    assert.equal(++includes, 1, 'the shared fixture may be included only once');
    assert.ok(fixture, 'the required shared candidate fixture is missing');
    assert.ok(!/^\s*\\/m.test(fixture), 'the shared fixture must contain plain SQL, not nested directives');
    return fixture;
  }).join('\n');
  return expanded;
}

function suiteRequests(sql, file) {
  if (file !== 'supabase/tests/qbo_customer_oauth_completion.test.sql') return [sql];
  // This fixture explicitly models separate request/revocation/completion RPCs.
  // One libpq simple-query message freezes transaction_timestamp even across
  // COMMIT/BEGIN. Register its exact boundary, without parsing or rewriting SQL.
  const boundary = '\ncommit;\nbegin;\nset local search_path=public,extensions;\n';
  assert.equal(sql.split(boundary).length, 2, 'review the explicit OAuth RPC transaction boundary if it changes');
  const split = sql.indexOf(boundary) + '\ncommit;'.length;
  return [sql.slice(0, split), sql.slice(split)];
}

function candidateDblinkSetting(targetKind, connection, database) {
  assert.match(database, /^qbo_candidate_case_[a-f0-9]{20}$/, 'dblink requires the exact disposable suite clone');
  assert.equal(connection.user, 'postgres');
  assert.equal(connection.ssl, false);
  let socket;
  if (targetKind === 'owned-supabase-image') {
    assert.equal(connection.host, '127.0.0.1', 'owned container outer connection is loopback only');
    assert.ok(Number.isInteger(connection.port) && connection.port > 0 && connection.port <= 65535);
    socket = '/tmp';
  } else {
    assert.equal(targetKind, 'native-postgres', 'only owned candidate runtimes may supply a dblink socket');
    assert.match(connection.host, /^\/(?:private\/)?tmp\/square-qualification-[A-Za-z0-9]+\/socket$/,
      'native dblink requires the initdb-owned private socket');
    assert.equal(connection.port, 5432);
    socket = connection.host;
  }
  return Buffer.from(`host=${socket} port=5432 dbname=${database} user=postgres`).toString('base64');
}

function snapshot(file) {
  const sql = fs.readFileSync(path.join(root, file), 'utf8');
  return { file, sql, sha256: digest(sql), version: path.basename(file).split('_')[0] };
}

function checkTap(lines) {
  const assertions = lines.filter(line => /^(?:not )?ok\s+\d+\b/.test(line));
  const plans = lines.filter(line => /^1\.\.\d+(?:\s|$)/.test(line));
  assert.ok(assertions.length > 0, 'suite must execute assertions');
  assert.equal(plans.length, 1, 'suite must emit exactly one pgTAP plan');
  assert.equal(Number(/^1\.\.(\d+)/.exec(plans[0])[1]), assertions.length, 'pgTAP plan must match completed assertions');
  assert.deepEqual(assertions.map(line => Number(/^(?:not )?ok\s+(\d+)/.exec(line)[1])),
    assertions.map((_, index) => index + 1), 'pgTAP assertion numbering must be complete');
  assert.deepEqual(lines.filter(line => /^not ok\b|^Bail out!|^# Looks like|#\s*(?:SKIP|TODO)\b/i.test(line)), [],
    'no failed, skipped, TODO, bailed-out or incomplete tests');
  return assertions.length;
}

async function executeSuite(client, sql, lines) {
  // Keep authoritative partial TAP output even if a later statement raises.
  const query = new Query(sql);
  query.on('row', row => {
    for (const value of Object.values(row)) {
      if (typeof value === 'string') lines.push(...value.split('\n')
        .filter(line => /^(?:(?:not )?ok\b|1\.\.|#|Bail out!)/.test(line)));
    }
  });
  await new Promise((resolve, reject) => {
    query.once('end', resolve);
    query.once('error', reject);
    client.query(query);
  });
}

async function schedulerConcurrency(connection, fixture) {
  assert.ok(fixture, 'the shared scheduler fixture is required');
  const owner = new Client({ ...connection, statement_timeout: 10000 });
  const worker = new Client({ ...connection, statement_timeout: 5000 });
  try {
    await owner.connect();
    await worker.connect();
    await owner.query(`begin; set local search_path=public,extensions;\n${fixture}\ncommit;`);
    await worker.query('set session authorization integration_task_scheduler_authority');
    await owner.query('begin');
    await owner.query("select id from private.integration_connections where id='e9f00000-0000-4000-8000-000000000101' for update");
    const schedule = async id => (await worker.query('select public.schedule_qbo_initialization_v2(25,$1) as result', [id])).rows[0].result;
    const first = await schedule('candidate_concurrent_first');
    assert.equal(first.scheduledConnectionCount, 1);
    assert.equal(first.runs[0].connectionGeneration, 2, 'the locked tenant is skipped while another tenant progresses');
    assert.equal((await schedule('candidate_concurrent_repeat')).scheduledTaskCount, 0, 'no duplicate work while the lock remains held');
    await owner.query('commit');
    assert.equal((await schedule('candidate_concurrent_released')).scheduledTaskCount, 24, 'the released tenant is scheduled on the next tick');
    assert.deepEqual((await owner.query(`select count(*)::int as tasks,
      count(distinct (connection_id,connection_generation,stream_key))::int as streams from private.integration_sync_tasks`)).rows[0],
      { tasks: 48, streams: 48 }, 'concurrent scheduling creates exactly one task per scoped stream');
    return 5;
  } finally {
    await owner.query('rollback').catch(() => {});
    await owner.end();
    await worker.end();
  }
}

async function squareCatalog(client) {
  const functions = await client.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as body,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like '%square%' order by 1,2,3`);
  const relations = await client.query(`select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relname like '%square%' order by 1,2`);
  const columns = await client.query(`select table_schema,table_name,column_name,ordinal_position,data_type,
    is_nullable,column_default from information_schema.columns
    where table_schema in ('public','private') and table_name like '%square%' order by 1,2,4`);
  const constraints = await client.query(`select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid,true) as definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relname like '%square%' order by 1,2,3`);
  const triggers = await client.query(`select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relname like '%square%' and not t.tgisinternal order by 1,2,3`);
  const policies = await client.query(`select * from pg_policies where schemaname in ('public','private')
    and tablename like '%square%' order by schemaname,tablename,policyname`);
  return digest(JSON.stringify([functions.rows, relations.rows, columns.rows, constraints.rows, triggers.rows, policies.rows]));
}

async function main() {
  const containerMode = process.argv.length === 3 && process.argv[2] === '--supabase-local';
  assert.ok(process.argv.length === 2 || containerMode, 'only --supabase-local is accepted; no target URLs or suite skipping');
  assertNoRemoteConfiguration();
  assertNoLinkedProject();
  if (!containerMode) {
    const bin = process.env.QBO_TEST_POSTGRES_BIN;
    assert.ok(bin && path.isAbsolute(bin), 'QBO_TEST_POSTGRES_BIN must name local PostgreSQL 17 binaries with pgTAP and pgvector installed');
    process.env.SQUARE_QUALIFICATION_PG_BIN = bin;
  }
  const canonical = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort().map(name => snapshot(`supabase/migrations/${name}`));
  const prefix = canonical.filter(item => item.version <= '20260902191325');
  assert.equal(canonical.length, 120, 'review the canonical migration manifest if it changes');
  assert.equal(prefix.length, 104, 'exact reviewed Production prefix');
  const square = productionSquare.map(name => snapshot(`supabase/production-migrations/${name}`));
  const qbo = candidates.map(name => snapshot(`supabase/production-migrations/${name}`));
  const fixturePath = 'supabase/tests/fixtures/qbo-production-native.sql';
  const fixture = fs.existsSync(path.join(root, fixturePath)) ? snapshot(fixturePath) : undefined;
  // Read once before starting PostgreSQL: concurrent edits cannot change a run's inputs.
  const suites = suiteNames.map(name => {
    try { return snapshot(`supabase/tests/${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { file: `supabase/tests/${name}`, missing: true }; }
  });
  const evidence = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'qbo-candidate-evidence-'));
  const report = { startedAt: new Date().toISOString(), productionAccess: false,
    retiredMigrationExcluded: '20260926232356_square_production_customer_first_read.sql',
    harnessHashes: ['scripts/run-qbo-production-candidate-database-tests.cjs', 'scripts/qbo-candidate-local-container.cjs',
      'scripts/run-square-durable-page-qualification.js', 'supabase/tests/fixtures/square-durable-platform.sql']
      .map(file => { const value = snapshot(file); return { file, sha256: value.sha256 }; }),
    candidateHashes: qbo.map(({ file, sha256 }) => ({ file, sha256 })),
    sharedFixture: fixture && { file: fixture.file, sha256: fixture.sha256 }, runs: [] };
  const save = () => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
  for (const shape of [{ name: 'canonical', migrations: canonical }, { name: 'production', migrations: [...prefix, ...square] }]) {
    const result = { shape: shape.name, migrations: [], suites: [], failures: [], stopped: false };
    report.runs.push(result);
    let stage = 'owned_cluster';
    try {
      const qualify = containerMode ? runContainerQualification : runAdditionalQualification;
      await qualify(async runtime => {
        assert.ok(['native-postgres', 'owned-supabase-image'].includes(runtime.targetKind), 'only a newly owned cluster is accepted');
        result.targetKind = runtime.targetKind;
        const db = await runtime.createDatabase('qbo_candidate');
        if (db.connection.host.startsWith('/')) result.nativeDirectory = path.dirname(db.connection.host);
        const client = db.client;
        const version = (await client.query("select current_setting('server_version_num')::integer as version")).rows[0].version;
        assert.ok(version >= 170000 && version < 180000, 'PostgreSQL 17 is required');
        await client.query(`create extension if not exists pg_stat_statements with schema extensions;
          alter database ${quote(db.name)} set search_path=public,extensions;
          create schema supabase_migrations;
          create table supabase_migrations.schema_migrations(version text primary key)`);
        const ledger = [];
        async function apply(item) {
          stage = item.file;
          try {
            await client.query(item.sql);
            await client.query('insert into supabase_migrations.schema_migrations(version) values ($1)', [item.version]);
          } catch (error) { await client.query('rollback'); throw error; }
          ledger.push(item.version);
          result.migrations.push({ file: item.file, sha256: item.sha256 });
          assert.deepEqual((await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(row => row.version),
            [...ledger].sort(), 'ledger records exactly successfully applied migrations');
        }
        for (const item of shape.migrations) await apply(item);
        result.baselineCount = ledger.length;
        const before = await squareCatalog(client);
        for (const item of qbo) await apply(item);
        assert.equal(await squareCatalog(client), before, 'QBO candidates preserve the Square catalog');
        result.squareCatalogSha256 = before;
        result.finalLedger = [...ledger].sort();
        console.log(`${shape.name}: ${shape.migrations.length}+${qbo.length} unchanged migrations applied; exact ledger and Square catalog verified.`);
        // pgTAP's test metadata ACLs are not part of the pristine migration catalog.
        await client.query('create extension if not exists pgtap with schema extensions');
        // OAuth spans commits. A clean template clone per suite prevents fixture
        // leakage without replaying or bypassing any cluster-wide migration guard.
        await client.end();
        const manager = new Client({ ...db.connection, database: 'postgres' });
        await manager.connect();
        result.databaseIsolation = 'fresh-template-clone-per-suite';
        try {
        for (const suite of [...suites, { file: 'native_scheduler_concurrency', concurrency: true }]) {
          stage = suite.file;
          const outcome = { file: suite.file, sha256: suite.sha256, passed: false, assertions: 0 };
          result.suites.push(outcome);
          let runner, clone;
          const lines = [];
          try {
            assert.ok(!suite.missing, 'required SQL suite is missing');
            const name = `qbo_candidate_case_${crypto.randomBytes(10).toString('hex')}`;
            await manager.query(`create database ${quote(name)} template ${quote(db.name)}`);
            clone = name;
            await manager.query(`alter database ${quote(clone)} set search_path=public,extensions`);
            const config = { ...db.connection, database: clone };
            const connectionSetting = candidateDblinkSetting(runtime.targetKind, db.connection, clone);
            if (suite.concurrency) {
              outcome.assertions = await schedulerConcurrency(config, fixture?.sql);
              outcome.passed = true;
              lines.push('Five native scheduler assertions passed using two real database connections.');
            } else {
            runner = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 60000,
              options: `-c vaeroex.test_database_url_b64=${connectionSetting}` });
            await runner.connect();
            await runner.query("select set_config('vaeroex.disposable_database_test','qbo_customer_oauth_completion',false)");
            const composed = expandFixture(suite.sql, fixture?.sql);
            outcome.executedSqlSha256 = digest(composed);
            const requests = suiteRequests(composed, suite.file);
            outcome.protocolRequests = requests.length;
            for (const request of requests) await executeSuite(runner, request, lines);
            outcome.assertions = checkTap(lines);
            outcome.passed = true;
            }
          } catch (error) {
            outcome.assertions = lines.filter(line => /^(?:not )?ok\s+\d+\b/.test(line)).length;
            outcome.error = { code: error.code, message: error.message, detail: error.detail, where: error.where };
            result.failures.push({ stage, ...outcome.error });
          } finally {
            if (runner) await runner.end();
            if (clone) await manager.query(`drop database ${quote(clone)} with (force)`);
          }
          fs.writeFileSync(path.join(evidence, `${shape.name}-${path.basename(suite.file)}.log`),
            `${lines.join('\n')}\n${JSON.stringify(outcome)}\n`);
          console.log(JSON.stringify({ shape: shape.name, ...outcome }));
          save();
        }
        } finally { await manager.end(); }
      });
      result.stopped = true;
    } catch (error) {
      result.failures.push({ stage, code: error.code, message: error.message, detail: error.detail, where: error.where });
      console.error(JSON.stringify({ shape: shape.name, stage, code: error.code, message: error.message, detail: error.detail, where: error.where }));
    }
    if (result.nativeDirectory) result.stopped = !fs.existsSync(path.join(result.nativeDirectory, 'data/postmaster.pid'));
    result.passed = result.stopped && result.failures.length === 0 && result.suites.length === suites.length + 1 && result.suites.every(suite => suite.passed);
    save();
  }
  report.passed = report.runs.every(run => run.passed);
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`Candidate database evidence: ${path.join(evidence, 'results.json')}`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { checkTap, expandFixture, suiteRequests, candidateDblinkSetting };
