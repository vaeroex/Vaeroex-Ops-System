#!/usr/bin/env node
// CI-only canonical Production105 qualification. Never uses a linked project,
// hosted database, existing credential, or native provisioner.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { resetLocalFixture, sanitizedFailure } = require('./prepare-production-shaped-local-database.js');

const root = path.resolve(__dirname, '..');
const migrationDirectory = path.join(root, 'supabase/production-migrations');
const customerFile = '20260925032300_square_production_customer_connection.sql';
const testFile = path.join(root, 'supabase/tests/square_customer_backend.test.sql');
const backendFiles = fs.readdirSync(migrationDirectory).filter(name => /^\d{14}_square_customer_service_backend\.sql$/.test(name));
assert.equal(backendFiles.length, 1, 'one exact backend candidate');
const backendFile = path.join(migrationDirectory, backendFiles[0]);
const historyFiles = fs.readdirSync(migrationDirectory).filter(name => /^\d{14}_square_customer_payment_history\.sql$/.test(name));
assert.equal(historyFiles.length, 1, 'one additive payment history candidate');
const historyFile = path.join(migrationDirectory, historyFiles[0]);
const historyTestFile = path.join(root, 'supabase/tests/square_customer_payment_history.test.sql');
const cli = process.env.SUPABASE_CLI_PATH || 'supabase';

function baselineManifest() {
  const names = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(name => /^\d+_.+\.sql$/.test(name) && name.split('_', 1)[0] <= '20260902191325').sort();
  assert.equal(names.length, 104);
  const versions = [...names.map(name => name.split('_', 1)[0]), '20260925032300'];
  assert.equal(new Set(versions).size, 105);
  const fingerprint = crypto.createHash('sha256').update(versions.map(version => `${version.length}:${version}`).join('')).digest('hex');
  assert.equal(fingerprint, '33bb3e49ae22026172264da954a02a869afcc878b33a57a78f0258e20d9a5d16');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDirectory, customerFile))).digest('hex'),
    '59261c8a3cc8c09cd83ea3817f5ad3adba89ef89aa735a1a611b3f3858ad3c92', 'applied migration105 remains unchanged');
  return versions;
}

function localDatabaseUrl() {
  const result = spawnSync(cli, ['status', '-o', 'env'], { cwd: root, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  if (result.status !== 0) throw new Error('square_backend_local_database_unavailable');
  const value = /^DB_URL="([^"\r\n]+)"$/m.exec(result.stdout)?.[1];
  if (!value) throw new Error('square_backend_local_database_unavailable');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.pathname !== '/postgres' || url.search || url.hash || url.username !== 'postgres')
    throw new Error('square_backend_nonlocal_database_forbidden');
  return value;
}

async function main() {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || process.argv.length !== 2)
    throw new Error('square_backend_ci_fixture_only');
  const versions = baselineManifest();
  await resetLocalFixture('20260902191325');
  const connectionString = localDatabaseUrl();
  const client = new Client({ connectionString, application_name: 'square_customer_backend_disposable_qualification' });
  const labels = new Set();
  client.on('notice', notice => {
    const match = /^square_backend_test_passed:([a-z0-9_]+)$/.exec(notice.message || '');
    if (match) labels.add(match[1]);
  });
  try {
    await client.connect();
    await client.query(fs.readFileSync(path.join(migrationDirectory, customerFile), 'utf8'));
    // Disposable migrator bookkeeping only; resetLocalFixture already verified
    // the exact local Docker identity before any reset/schema mutation.
    await client.query("insert into supabase_migrations.schema_migrations(version) values ('20260925032300')");
    const before = await client.query('select version from supabase_migrations.schema_migrations order by version');
    assert.deepEqual(before.rows.map(row => row.version), versions);
    await client.query(fs.readFileSync(backendFile, 'utf8'));
    await client.query(fs.readFileSync(testFile, 'utf8'));
    // The additive migration requires the already-applied Production106 ledger.
    // This bookkeeping is confined to the disposable canonical fixture.
    await client.query("insert into supabase_migrations.schema_migrations(version) values ('20260929004917')");
    await client.query(fs.readFileSync(historyFile, 'utf8'));
    await client.query(fs.readFileSync(testFile, 'utf8'));
    await client.query(fs.readFileSync(historyTestFile, 'utf8'));
    const after = await client.query('select version from supabase_migrations.schema_migrations order by version');
    assert.deepEqual(after.rows.map(row => row.version), [...versions, '20260929004917'], 'only explicit disposable baseline bookkeeping');
    assert(labels.size >= 70, 'every original and historical SQL assertion executed');
    const closed = await client.query(`select
      (select not enabled and application_id is null from square_customer_private.configuration) as closed,
      (select count(*) from square_customer_private.connections) as connections,
      (select count(*) from square_customer_private.payments) as payments`);
    assert.equal(closed.rows[0].closed, true);
    assert.equal(Number(closed.rows[0].connections), 0);
    assert.equal(Number(closed.rows[0].payments), 0);
    console.log(JSON.stringify({ label: 'square_customer_backend_postgres_qualification_passed',
      baselineMigrations: 106, assertions: labels.size, closed: true, providerCalls: false }));
  } finally { await client.end(); }
}

main().catch(error => {
  const known = new Set(['square_backend_ci_fixture_only', 'square_backend_local_database_unavailable', 'square_backend_nonlocal_database_forbidden']);
  const test = /^square_backend_test_failed:([a-z0-9_]+)$/.exec(error?.message || '');
  const sql = /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : 'unknown';
  const label = known.has(error?.message) ? error.message : test ? `square_backend_test_failed:${test[1]}` : sanitizedFailure(error);
  console.error(JSON.stringify({ label, sqlstate: sql, productionAccess: false }));
  process.exitCode = 1;
});
