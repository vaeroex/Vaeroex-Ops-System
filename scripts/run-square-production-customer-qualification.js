#!/usr/bin/env node
// Disposable-only qualification. Stage exactly the canonical 104 Production
// migrations through 25, then apply only this new customer migration.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { resetLocalFixture } = require('./prepare-production-shaped-local-database.js');

const root = path.resolve(__dirname,'..');
const cli = process.env.SUPABASE_CLI_PATH || 'supabase';
const baseline = '20260902191325';
const customer = '20260925032300';
const customerFile = `${customer}_square_production_customer_connection.sql`;

function manifest() {
  const names = fs.readdirSync(path.join(root,'supabase/migrations'))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const prior = names.filter(name => name.split('_',1)[0] <= baseline);
  assert.equal(prior.length,104,'canonical Production baseline contains 104 files');
  assert.equal(prior.at(-1),`${baseline}_square_production_internal_pilot_runtime.sql`);
  assert.equal(names.filter(name => name === customerFile).length,1);
  const staged = [...prior,customerFile];
  assert.equal(staged.length,105);
  assert.equal(new Set(staged.map(name => name.split('_',1)[0])).size,105);
  const ledger = prior.map(name => name.split('_',1)[0]);
  const fingerprint = `sha256:${crypto.createHash('sha256').update(
    ledger.map(version => `${version.length}:${version}`).join('')
  ).digest('hex')}`;
  assert.equal(fingerprint,'sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f');
  return staged;
}

function localDatabaseUrl() {
  const result = spawnSync(cli,['status','-o','env'],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000
  });
  if (result.status !== 0) throw new Error('customer_local_database_unavailable');
  const raw = result.stdout.split(/\r?\n/).find(line => line.startsWith('DB_URL='))?.slice(7)?.trim();
  const value = raw?.startsWith('"') && raw.endsWith('"') ? raw.slice(1,-1) : raw;
  if (!value) throw new Error('customer_local_database_unavailable');
  const parsed = new URL(value);
  if (!['postgres:','postgresql:'].includes(parsed.protocol)
    || !['127.0.0.1','localhost'].includes(parsed.hostname)
    || parsed.pathname !== '/postgres' || parsed.search || parsed.hash) {
    throw new Error('customer_nonlocal_database_forbidden');
  }
  return value;
}

async function assertFingerprintVectors(client) {
  const stateId='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
  const connectionId='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
  const actorId='11111111-1111-4111-8111-111111111111';
  const sessionId='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
  const credentialId='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';
  const stateHash=`sha256:${'a'.repeat(64)}`;
  const aadDigest=`sha256:${'b'.repeat(64)}`;
  const vectors=[
    ['square-production-customer-state-v1',connectionId,stateId,stateHash,actorId,sessionId,'1','1'],
    ['square-production-customer-consume-v1',stateId,stateHash,'1'],
    ['square-production-customer-acquire-v1',stateId,connectionId,'1'],
    ['square-production-customer-commit-v1',stateId,credentialId,'1',aadDigest,'merchant_1'],
    ['square-production-customer-aad-v1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId,'1',credentialId,'1']
  ];
  for (const parts of vectors) {
    const expected=`sha256:${crypto.createHash('sha256').update(
      parts.map(part=>`${part.length}:${part}`).join(''),'utf8').digest('hex')}`;
    const result=await client.query(
      'select private.square_production_customer_fingerprint_v1($1::text[]) as fingerprint',[parts]);
    assert.equal(result.rows[0].fingerprint,expected,`${parts[0]} SQL/JS bytes`);
  }
}

async function main() {
  manifest();
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('customer_ci_fixture_only');
  }
  if (process.argv[2] === '--prepare-legacy-fixture' && process.argv.length === 3) {
    // The general fixture includes Sandbox history. Keep the Production-only
    // customer migration out of that chain; it is qualified separately below.
    await resetLocalFixture('20260915040500');
    console.log('square_customer_legacy_fixture_ready');
    return;
  }
  if (process.argv.length !== 2) throw new Error('customer_ci_fixture_only');
  await resetLocalFixture(baseline);
  const client = new Client({connectionString:localDatabaseUrl(),application_name:'square_customer_disposable_qualification'});
  await client.connect();
  try {
    const before = await client.query('select version from supabase_migrations.schema_migrations order by version');
    assert.equal(before.rows.length,104);
    assert.equal(before.rows.at(-1).version,baseline);
    await client.query(fs.readFileSync(path.join(root,'supabase/migrations',customerFile),'utf8'));
    await assertFingerprintVectors(client);
    await client.query(fs.readFileSync(path.join(root,'supabase/tests/square_production_customer_connection.test.sql'),'utf8'));
    const after = await client.query('select version from supabase_migrations.schema_migrations order by version');
    assert.deepEqual(after.rows,before.rows,'qualification never edits migration history');
    console.log('square_production_customer_disposable_qualification_ok');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  const fixed = new Set(['customer_local_database_unavailable','customer_nonlocal_database_forbidden',
    'customer_ci_fixture_only']);
  console.error(fixed.has(error?.message) ? error.message : `customer_qualification_failed:${error?.code || 'unknown'}`);
  process.exitCode = 1;
});
