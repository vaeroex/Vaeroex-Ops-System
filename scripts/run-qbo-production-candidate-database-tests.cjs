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
  '20260930193412_qbo_production_accounting_intake.sql',
  '20261002012700_qbo_customer_pending_attempt_control.sql',
  '20261002025212_qbo_customer_pending_cancellation_eligibility.sql',
];
const pendingSuite = { file: 'scripts/qbo-pending-connection-database-tests.cjs', pending: true, expectedScenarios: 14 };
const eligibilitySuite = { file: 'scripts/qbo-pending-cancellation-eligibility-database-tests.cjs', eligibility: true, expectedScenarios: 19 };
const suiteNames = [
  'qbo_customer_oauth_completion.test.sql',
  'external_integrations_qbo_ongoing_sync.test.sql',
  'qbo_customer_source_browse.test.sql',
  'qbo_production_source_validation.test.sql',
  'qbo_production_accounting_intake.test.sql',
  'external_integrations_phase_3_deterministic_dependencies.test.sql',
];
const dashboardMigrations = {
  preferences: '20261002182049_integration_summary_preferences.sql',
  square: '20261002182147_square_customer_browse_identity.sql',
  qbo: '20261002182746_qbo_customer_dashboard_metadata.sql',
};
const dashboardSuites = [
  { file: 'supabase/tests/qbo_customer_dashboard_metadata.test.sql', dashboard: 'qbo', expectedAssertions: 55 },
  { file: 'supabase/tests/integration_summary_preferences.test.sql', dashboard: 'preferences', expectedAssertions: 45 },
  { file: 'supabase/tests/workspace_reporting_timezone.test.sql', dashboard: 'reporting-timezone', expectedAssertions: 27 },
  { file: 'supabase/tests/square_customer_browse_identity.test.sql', dashboard: 'square', expectedAssertions: 33 },
];
const squareDependencySuite = {
  file: 'canonical_square_identity_dependency_denial', dashboard: 'square-dependency', expectedAssertions: 3,
};
const preferenceAssertionNames = [
  'new workspace timezone defaults null', 'IANA-form timezone accepted', 'UTC accepted',
  'explicit null restores unconfigured state', 'empty timezone rejected', 'malformed timezone path rejected',
  'timezone whitespace rejected', 'oversized timezone rejected', 'invalid timezone updates leave stored value unchanged',
  'existing service workspace update works with null timezone', 'existing service workspace update works with configured timezone',
  'RLS enabled', 'anonymous read not granted', 'restore does not require delete privilege',
  'missing preference leaves entry visible',
  'viewer can save own preferences; workspace and logical entries are independent',
  'repeated hide is idempotent', 'restore saved', 'restoring company A does not restore company B',
  'other workspace untouched', 'cannot insert for another account', 'cannot insert in an inaccessible workspace',
  'WITH CHECK prevents account reassignment', 'WITH CHECK prevents unauthorized workspace reassignment',
  'existing owner safe-column update remains usable', 'owner can update reporting timezone',
  'workspace owner cannot read peer preferences', 'workspace owner cannot change peer preferences',
  'upsert cannot overwrite a peer preference', 'same entry has separate account preferences', 'new row defaults visible',
  'raw provider IDs cannot be stored', 'uppercase hashes cannot be stored', 'trailing newline cannot bypass key constraint',
  'oversized key cannot be stored', 'authenticated deletion is not granted',
  'disabled membership cannot read existing preferences', 'disabled membership cannot update existing preferences',
  'disabled membership cannot insert preferences', 'invited membership cannot read preferences',
  'anonymous read denied', 'anonymous insert denied', 'anonymous update denied',
  'account deletion removes preferences', 'workspace deletion removes preferences',
];
const reportingTimezoneAssertionNames = [
  'active owner saves reporting timezone through authenticated update',
  'active owner can save UTC directly',
  'active owner can save a recognized IANA alias directly',
  'direct owner update rejects syntactically valid unknown timezone',
  'owner combined invalid timezone and safe-column update is denied',
  'invalid owner update atomically preserves timezone and workspace name',
  'active owner can restore unconfigured timezone',
  'owner cannot update an unrelated workspace timezone',
  'timezone grant does not grant auth-bearing column updates',
  'admin cannot bypass owner-only timezone setter through direct update',
  'admin no-op timezone update is also denied',
  'admin combined timezone and safe-column update is atomic and denied',
  'denied timezone update leaves all workspace fields unchanged',
  'existing admin safe-column update remains allowed',
  'viewer cannot update reporting timezone',
  'staff cannot update reporting timezone',
  'disabled owner cannot update reporting timezone',
  'missing authenticated subject cannot update reporting timezone',
  'anonymous RLS cannot update reporting timezone',
  'timezone constraint does not widen private helper access',
  'workspace insert accepts UTC',
  'workspace insert accepts a recognized IANA timezone',
  'workspace insert accepts a recognized IANA alias',
  'workspace insert accepts unconfigured null timezone',
  'workspace insert rejects syntactically valid unknown timezone',
  'multi-row workspace insert rejects an unknown timezone',
  'invalid workspace inserts atomically leave no rows',
];
const squareIdentityAssertionNames = [
  'identity_sha256_shape', 'identity_reconnect_and_renames_keep_lineage', 'identity_ignores_attempt_age_and_generation',
  ...[2, 3, 4, 5].map(n => `identity_distinct_authority_${n}`),
  ...[6, 7, 8, 9].map(n => `identity_incomplete_discovery_${n}`),
  'identity_never_combines_saved_results', 'identity_history_own_success_without_update_checkpoint',
  'identity_completed_empty_distinct_from_never_checked', 'identity_historical_recovery_projected',
  'identity_no_raw_authority_credentials_or_invented_changes', 'identity_raw_merchant_and_application_not_disclosed',
  'identity_other_workspace_has_distinct_key', 'identity_browse_does_not_mutate',
  ...['lastsyncedat', 'checkpointat', 'lastcompletedread', 'activeread', 'hasmore', 'lasterror', 'revocationpending', 'recoveryrequired']
    .map(field => `identity_current_parity_${field}`),
  'identity_partial_failed_read_not_success', 'identity_pending_revocation_remains_actionable',
  'identity_fully_disconnected_keeps_per_attempt_success', 'identity_other_workspace_connection_denied',
  'identity_wrong_session_denied', 'identity_nonowner_denied',
];

function dashboardPlan(shape) {
  assert.ok(['canonical', 'production'].includes(shape), 'only the two reviewed migration shapes are supported');
  // Canonical has preferences but no direct Square backend. Its exact-ledger
  // production prerequisites cannot be replayed or substituted on that shape.
  return shape === 'canonical'
    ? { migrations: [dashboardMigrations.qbo], suites: [...dashboardSuites.slice(0, 3), squareDependencySuite] }
    : { migrations: Object.values(dashboardMigrations), suites: dashboardSuites };
}

function checkDashboardAssertionNames(kind, names) {
  assert.ok(['preferences', 'reporting-timezone', 'square'].includes(kind), 'only the registered named SQL assertion formats are accepted');
  const expected = kind === 'preferences' ? preferenceAssertionNames
    : kind === 'reporting-timezone' ? reportingTimezoneAssertionNames : squareIdentityAssertionNames;
  assert.deepEqual(names, expected, 'every named SQL assertion must execute exactly once, in order');
  return expected.length;
}

function composeSquareIdentitySuite(sql, browseFixture) {
  const boundary = '\ncreate temp table browse_before as select\n';
  assert.equal(browseFixture.split(boundary).length, 2, 'review the fixed Square seed boundary if it changes');
  assert.ok(!/^\s*\\/m.test(browseFixture + sql), 'Square fixture composition accepts plain SQL only');
  // The embedded fixture omits authors because its platform tables are minimal.
  // Supply the exact synthetic owner required by real NOT NULL/FK constraints.
  const entitySeed = "insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone) values\n  ('aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','another-entity','Another entity','USD','UTC');";
  assert.equal(sql.split(entitySeed).length, 2, 'review the exact identity entity seed if it changes');
  const nativeSeed = "insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by) values\n  ('aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','another-entity','Another entity','USD','UTC','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');";
  return browseFixture.slice(0, browseFixture.indexOf(boundary)) + '\n' + sql.replace(entitySeed, nativeSeed);
}

async function executeDashboardSuite(client, suite, inputs, lines) {
  if (suite.dashboard === 'square-dependency') {
    assert.equal(suite.file, squareDependencySuite.file);
    const catalog = `select to_regnamespace('square_customer_private')::text as schema,
      to_regprocedure('public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)')::text as browse,
      (select array_agg(version order by version) from supabase_migrations.schema_migrations) as ledger`;
    const before = (await client.query(catalog)).rows;
    assert.equal(before[0].schema, null);
    assert.equal(before[0].browse, null);
    lines.push('ok 1 - canonical Square direct browse dependency is absent');
    try {
      await assert.rejects(client.query(inputs.squareMigration), {
        code: '55000', message: 'square_customer_identity_requires_browse',
      });
    } finally { await client.query('rollback'); }
    lines.push('ok 2 - Square identity rejects canonical with its exact prerequisite error');
    assert.deepEqual((await client.query(catalog)).rows, before, 'failed projection changes neither catalog nor ledger');
    lines.push('ok 3 - canonical Square prerequisite denial preserves catalog and ledger');
    return { assertions: 3, executedSqlSha256: digest(inputs.squareMigration), protocolRequests: 1 };
  }
  const registered = dashboardSuites.find(item => item.file === suite.file);
  assert.ok(registered && registered.dashboard === suite.dashboard, 'dashboard SQL suite must be explicitly registered');
  const sql = suite.dashboard === 'square' ? composeSquareIdentitySuite(suite.sql, inputs.squareFixture)
    : expandFixture(suite.sql, inputs.qboFixture);
  const metadata = { executedSqlSha256: digest(sql), protocolRequests: 1 };
  if (suite.dashboard === 'qbo') {
    await executeSuite(client, sql, lines);
    const assertions = checkTap(lines);
    assert.equal(assertions, registered.expectedAssertions, 'all 55 QBO metadata assertions must complete');
    return { ...metadata, assertions };
  }
  const names = [];
  const add = name => { names.push(name); lines.push(`ok ${names.length} - ${name}`); };
  const notice = event => {
    if (suite.dashboard === 'square' && event.message.startsWith('square_backend_test_passed:')) {
      add(event.message.slice('square_backend_test_passed:'.length));
    }
  };
  client.on('notice', notice);
  try {
    const results = await client.query(sql);
    if (suite.dashboard === 'preferences' || suite.dashboard === 'reporting-timezone') {
      for (const result of results) for (const row of result.rows) {
        if (Object.hasOwn(row, 'preference_assert')) add(row.preference_assert);
      }
    }
    const assertions = checkDashboardAssertionNames(suite.dashboard, names);
    assert.equal(assertions, registered.expectedAssertions);
    return { ...metadata, assertions };
  } finally { client.removeListener('notice', notice); }
}
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
  assert.equal(canonical.length, 123, 'review the canonical migration manifest if it changes');
  assert.deepEqual(canonical.filter(item => item.version > '20260915040500').map(item => path.basename(item.file)), [
    '20261002040024_google_sheets_complete.sql',
    '20261002040031_google_sheets_lifecycle.sql',
    '20261002182049_integration_summary_preferences.sql',
  ], 'the canonical extension contains exactly two Google Sheets migrations and dashboard preferences');
  assert.equal(prefix.length, 104, 'exact reviewed Production prefix');
  const square = productionSquare.map(name => snapshot(`supabase/production-migrations/${name}`));
  const qbo = candidates.map(name => snapshot(`supabase/production-migrations/${name}`));
  const dashboard = Object.values(dashboardMigrations).map(name => snapshot(`supabase/production-migrations/${name}`));
  assert.equal(dashboard[0].sha256, canonical.find(item => path.basename(item.file) === dashboardMigrations.preferences)?.sha256,
    'canonical and Production preference SQL must match exactly');
  const squareFixture = snapshot('supabase/tests/square_customer_payment_browse.test.sql');
  const fixturePath = 'supabase/tests/fixtures/qbo-production-native.sql';
  const fixture = fs.existsSync(path.join(root, fixturePath)) ? snapshot(fixturePath) : undefined;
  // Read once before starting PostgreSQL: concurrent edits cannot change a run's inputs.
  const suites = suiteNames.map(name => {
    try { return snapshot(`supabase/tests/${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { file: `supabase/tests/${name}`, missing: true }; }
  });
  const dashboardSnapshots = dashboardSuites.map(suite => ({ ...snapshot(suite.file), ...suite }));
  const evidence = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'qbo-candidate-evidence-'));
  const report = { startedAt: new Date().toISOString(), productionAccess: false,
    retiredMigrationExcluded: '20260926232356_square_production_customer_first_read.sql',
    harnessHashes: ['scripts/run-qbo-production-candidate-database-tests.cjs', 'scripts/qbo-candidate-local-container.cjs',
      'scripts/run-square-durable-page-qualification.js', 'supabase/tests/fixtures/square-durable-platform.sql']
      .map(file => { const value = snapshot(file); return { file, sha256: value.sha256 }; }),
    candidateHashes: qbo.map(({ file, sha256 }) => ({ file, sha256 })),
    dashboardCandidateHashes: dashboard.map(({ file, sha256 }) => ({ file, sha256 })),
    squareDashboardFixture: { file: squareFixture.file, sha256: squareFixture.sha256 },
    sharedFixture: fixture && { file: fixture.file, sha256: fixture.sha256 }, runs: [] };
  const save = () => fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2));
  for (const shape of [{ name: 'canonical', migrations: canonical }, { name: 'production', migrations: [...prefix, ...square] }]) {
    const plan = dashboardPlan(shape.name);
    const shapeSuites = [...suites, ...plan.suites.map(suite => {
      if (suite.file === squareDependencySuite.file) return {
        ...squareDependencySuite, sha256: dashboard.find(item => path.basename(item.file) === dashboardMigrations.square).sha256,
      };
      const saved = dashboardSnapshots.find(item => item.file === suite.file);
      assert.ok(saved, 'every planned dashboard suite must have a captured SQL snapshot');
      return saved;
    })];
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
        // Square's new read projection is intentionally outside the QBO-only
        // catalog comparison; all original lifecycle/ledger guards remain on.
        for (const name of plan.migrations) await apply(dashboard.find(item => path.basename(item.file) === name));
        result.finalLedger = [...ledger].sort();
        console.log(`${shape.name}: ${shape.migrations.length}+${qbo.length}+${plan.migrations.length} migrations applied; exact ledger and QBO-only Square catalog guard verified.`);
        // pgTAP's test metadata ACLs are not part of the pristine migration catalog.
        await client.query('create extension if not exists pgtap with schema extensions');
        // OAuth spans commits. A clean template clone per suite prevents fixture
        // leakage without replaying or bypassing any cluster-wide migration guard.
        await client.end();
        const manager = new Client({ ...db.connection, database: 'postgres' });
        await manager.connect();
        result.databaseIsolation = 'fresh-template-clone-per-suite';
        try {
        for (const suite of [...shapeSuites, { file: 'native_scheduler_concurrency', concurrency: true },
          { file: 'native_accounting_qualification', accounting: true }, pendingSuite, eligibilitySuite]) {
          stage = suite.file;
          const outcome = { file: suite.file, sha256: suite.accounting
            ? digest(fs.readFileSync(path.join(root, 'scripts/qbo-accounting-native-qualification.cjs')))
            : suite.pending || suite.eligibility ? digest(fs.readFileSync(path.join(root, suite.file))) : suite.sha256,
            passed: false, assertions: 0 };
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
            if (suite.dashboard) {
              runner = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 60000 });
              await runner.connect();
              Object.assign(outcome, await executeDashboardSuite(runner, suite, {
                qboFixture: fixture?.sql, squareFixture: squareFixture.sql,
                squareMigration: dashboard.find(item => path.basename(item.file) === dashboardMigrations.square).sql,
              }, lines));
              assert.equal(outcome.assertions, suite.expectedAssertions, 'all registered dashboard assertions must complete');
              outcome.passed = true;
            } else if (suite.eligibility) {
              runner = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 60000 });
              await runner.connect();
              outcome.assertions = await require('./qbo-pending-cancellation-eligibility-database-tests.cjs').qualify({ client: runner, connection: config });
              assert.equal(outcome.assertions, suite.expectedScenarios, 'all pending-cancellation eligibility scenarios must complete');
              outcome.passed = true;
              lines.push('Native read-only cancellation eligibility, owner/session boundaries and unchanged protected rows passed.');
            } else if (suite.pending) {
              runner = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 60000 });
              await runner.connect();
              outcome.assertions = await require('./qbo-pending-connection-database-tests.cjs').qualify({ client: runner, connection: config });
              assert.equal(outcome.assertions, suite.expectedScenarios, 'all pending-attempt native scenarios must complete');
              outcome.passed = true;
              lines.push('Native atomic start, duplicate intent, cancellation, concurrency and security qualification passed.');
            } else if (suite.accounting) {
              outcome.assertions = await require('./qbo-accounting-native-qualification.cjs').accountingNativeQualification(config, fixture?.sql);
              outcome.passed = true;
              lines.push('Native provider validation, owner policy and canonical accounting qualification passed.');
            } else if (suite.concurrency) {
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
      result.failures.push({ stage, code: error.code, message: error.message, detail: error.detail, where: error.where,
        position: error.position, internalPosition: error.internalPosition });
      console.error(JSON.stringify({ shape: shape.name, stage, code: error.code, message: error.message, detail: error.detail, where: error.where,
        position: error.position, internalPosition: error.internalPosition }));
    }
    if (result.nativeDirectory) result.stopped = !fs.existsSync(path.join(result.nativeDirectory, 'data/postmaster.pid'));
    result.passed = result.stopped && result.failures.length === 0 && result.suites.length === shapeSuites.length + 4 && result.suites.every(suite => suite.passed);
    save();
  }
  report.passed = report.runs.every(run => run.passed);
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`Candidate database evidence: ${path.join(evidence, 'results.json')}`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { checkTap, expandFixture, suiteRequests, candidateDblinkSetting, candidates, pendingSuite, eligibilitySuite,
  dashboardMigrations, dashboardSuites, dashboardPlan, checkDashboardAssertionNames, composeSquareIdentitySuite, executeDashboardSuite,
  preferenceAssertionNames, reportingTimezoneAssertionNames, squareIdentityAssertionNames, squareCatalog };
