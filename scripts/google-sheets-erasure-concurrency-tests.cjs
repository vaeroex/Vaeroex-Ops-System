/* eslint-disable @typescript-eslint/no-require-imports -- Local-only, disposable PostgreSQL concurrency qualification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { qualifyApproval } = require('./google-sheets-erasure-data-tests.cjs');

async function main() {
  if (process.argv.length !== 2) throw new Error('arguments_denied');
  const bin = process.env.GOOGLE_SHEETS_TEST_PG_BIN;
  if (!bin || !path.isAbsolute(bin)) throw new Error('local_postgres_binary_directory_required');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-erasure-synthetic-'));
  const data = path.join(root, 'data'), socket = path.join(root, 'socket');
  fs.mkdirSync(socket, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: root };
  const command = (name, args) => {
    const result = spawnSync(path.join(bin, name), args, { env, encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`synthetic_${name}_failed: ${(result.stderr || '').slice(0, 600)}`);
  };
  let started = false;
  const clients = [];
  const connect = async () => {
    const client = new Client({ host: socket, port: 5432, database: 'postgres', user: 'erasure_fixture_admin', connectionTimeoutMillis: 5000 });
    await client.connect(); clients.push(client); return client;
  };
  try {
    command('initdb', ['-D', data, '-U', 'erasure_fixture_admin', '--auth-local=trust', '--auth-host=reject', '--no-locale']);
    // No TCP listener or remote connection options exist in this runner.
    command('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-k ${socket} -c listen_addresses=''`, '-w', 'start']);
    started = true;
    const admin = await connect();
    // PGlite accepts JSON arrays directly; node-postgres otherwise encodes them
    // as PostgreSQL arrays. The shared fixture's structured parameters are JSONB.
    const baseline = await qualifyApproval({ query: (sql, params) => admin.query(sql, params?.map(value =>
      value !== null && typeof value === 'object' ? JSON.stringify(value) : value)), exec: sql => admin.query(sql) });
    const request = (await admin.query('select * from private.google_sheets_erasure_requests')).rows[0];
    await admin.query('insert into auth.sessions(id,user_id) values($1,$2)', [request.approved_session_id, request.approved_by]);
    await admin.query("update private.google_sheets_erasure_requests set state='prepared',approved_at=null,approved_by=null,approved_session_id=null where id=$1", [request.id]);
    await admin.query(`create table private.fixture_approval_mutations(n integer not null); insert into private.fixture_approval_mutations values(0);
      create function private.fixture_count_approval() returns trigger language plpgsql as $$begin update private.fixture_approval_mutations set n=n+1; return new; end$$;
      create trigger fixture_count_approval after update on private.google_sheets_erasure_requests for each row execute function private.fixture_count_approval();`);
    const a = await connect(), b = await connect();
    for (const client of [a, b]) {
      await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [request.approved_by, JSON.stringify({ sub: request.approved_by, session_id: request.approved_session_id })]);
      await client.query('set role authenticated');
    }
    const selected = request.decisions.filter(item => item.action === 'delete').map(({ table, id }) => ({ table, id }));
    await admin.query('begin');
    await admin.query('select id from private.google_sheets_erasure_requests where id=$1 for update', [request.id]);
    const calls = [a, b].map(client => client.query('select public.confirm_google_sheets_erasure_request_v1($1,$2,$3) result', [request.id, request.scope_hash, JSON.stringify(selected)]));
    await admin.query('commit');
    const results = await Promise.all(calls);
    assert(results.every(result => result.rows[0].result.state === 'approved'));
    assert.equal((await admin.query('select n from private.fixture_approval_mutations')).rows[0].n, 1);
    assert.equal((await admin.query('select count(*)::int n from private.google_sheets_erasure_requests')).rows[0].n, 1);
    console.log(JSON.stringify({ suite: 'google_sheets_erasure_native_concurrency', baseline, checks: 3,
      authoritativeApprovalMutations: 1, idempotentConcurrentLosers: 1, destructiveErasureTested: false, remoteConnections: 0 }));
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error({ stage: 'synthetic_concurrency', code: error.code, message: error.message }); process.exitCode = 1; });
