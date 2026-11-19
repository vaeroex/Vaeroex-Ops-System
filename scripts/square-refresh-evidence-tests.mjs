// Controlled provider HTTP only. The scheduler, encrypted credential reader,
// provider parser, atomic PostgreSQL commits and protected typed reader are real
// application implementations. This is not hosted provider or model evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createSquareRecurringTestDb, connectSquare, squareManual, ids, squareIds, asService } from './square-recurring-test-db.mjs';
const require = createRequire(import.meta.url);
require('./qbo-customer-test-support.cjs').installLoader();
const { runSquareRecurring, runDueSquareRefreshes } = require('../lib/integrations/square-direct/recurring.ts');
const { sealCredential } = require('../lib/integrations/square-direct/crypto.ts');
const { SQUARE_OAUTH_SCOPES } = require('../lib/integrations/providers/square/account-connection-oauth.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const readDraft = name => readFileSync(new URL(`../docs/security-drafts/${name}`, import.meta.url), 'utf8');

async function installSquareReader(db) {
  // Only composite declarations for unused document branches are needed. The
  // Square tables, owner/session checks, row access and hash logic are unchanged.
  await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    alter table business_entities add column timezone text default 'UTC';
    create table business_memory_chunks(id uuid); create table business_notes(id uuid);
    create table file_uploads(id uuid); create table ai_agent_runs(id uuid);`);
  const legacy = readDraft('01-legacy-evidence.sql');
  await db.exec(legacy.slice(legacy.indexOf('create function private.evidence_digest_v1'), legacy.indexOf('-- Fixed dispatch, safe identity fields only.')));
  const artifact = readDraft('02-owner-artifact-boundary.sql');
  await db.exec(artifact.slice(artifact.indexOf('create function private.safe_evidence_uuid_v1'), artifact.indexOf('insert into private.derived_evidence_audiences')));
  const typed = readDraft('06-typed-source-admission.sql');
  await db.exec(typed.slice(typed.indexOf('create function private.shared_evidence_typed_v1'), typed.indexOf('alter function private.shared_evidence_original_v1')));
  await db.exec(`revoke all on function private.evidence_digest_v1(jsonb),private.safe_evidence_uuid_v1(text),
    private.require_evidence_owner_v1(uuid),private.shared_evidence_typed_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
    revoke all on function read_shared_typed_evidence_v1(uuid,jsonb) from public,anon,service_role;
    grant execute on function read_shared_typed_evidence_v1(uuid,jsonb) to authenticated;`);
}

async function actor(db, user = ids.actor, session = squareIds.session) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ role: 'authenticated', sub: user, session_id: session })]);
  await db.exec('set role authenticated');
}

function sqlClient(db, events) {
  return { rpc(name, args) {
    assert(['square_customer_recurring_v1', 'square_customer_due_recurring_v1', 'square_customer_recover_recurring_v1'].includes(name));
    const run = async () => {
      await asService(db); await db.exec('set role service_role');
      const entries = Object.entries(args); entries.forEach(([key]) => assert(/^p_[a-z_]+$/.test(key)));
      const values = entries.map(([key, value]) => key === 'p_payload' ? JSON.stringify(value) : value);
      try {
        const call = `public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')})`;
        const due = name === 'square_customer_due_recurring_v1';
        const result = await db.query(due ? `select * from ${call}` : `select ${call} v`, values);
        events.push({ name, operation: args.p_operation, accepted: true });
        return { data: due ? result.rows : result.rows[0].v, error: null };
      } catch (error) {
        events.push({ name, operation: args.p_operation, accepted: false, code: error.code });
        return { data: null, error: { code: error.code } };
      }
    };
    const result = { then: (yes, no) => Promise.resolve().then(run).then(yes, no), abortSignal: signal => {
      assert(signal instanceof AbortSignal); return result;
    } }; return result;
  } };
}

test('scheduled Square pages update protected typed payment evidence with real SQL and retain incomplete-window truth', async () => {
  const oldEnv = { ...process.env }, db = await createSquareRecurringTestDb();
  const events = [], requests = [], client = sqlClient(db, events);
  let scale = 1, mode = 'good', totalPages = 2, networkCalls = 0;
  const key = Buffer.alloc(32, 7).toString('base64');
  const created = new Date(Date.now() - 86400_000).toISOString();
  let updated = new Date(Date.now() - 60_000).toISOString();
  const credential = { schemaVersion: 'oauth_credential_envelope_v1', providerKey: 'square', environment: 'production',
    externalAuthorizedEntityReference: 'fictional-seller', accessToken: 'synthetic-never-sent-access', refreshToken: 'synthetic-never-sent-refresh',
    refreshExpiresAt: null, issuedAt: created, updatedAt: created, accessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    grantedScopes: [...SQUARE_OAUTH_SCOPES] };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', VERCEL_ENV: 'production', SQUARE_CUSTOMER_BACKEND_ENABLED: 'true',
      SQUARE_CUSTOMER_APPLICATION_ID: squareIds.application, SQUARE_CUSTOMER_APPLICATION_SECRET: 'synthetic-never-sent-secret',
      SQUARE_CUSTOMER_ENCRYPTION_KEY: key, SQUARE_AUTOMATIC_REFRESH_ENABLED: 'true', SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS: ids.workspace });
    await installSquareReader(db);
    await connectSquare(db, { ciphertext: sealCredential(credential, key, { workspaceId: ids.workspace,
      connectionId: squareIds.connection, generation: 1, credentialVersion: 1 }), accessExpiresAt: credential.accessExpiresAt });
    const connection = { workspace_id: ids.workspace, connection_id: squareIds.connection };
    const scope = { p_limit: 20, p_allowed_workspaces: [ids.workspace], p_application_id: squareIds.application };
    const network = async (url, init) => {
      networkCalls++; const u = new URL(url); requests.push(u);
      assert.equal(u.origin, 'https://connect.squareup.com'); assert.equal(u.pathname, '/v2/payments');
      assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert(init.signal instanceof AbortSignal);
      assert.equal(u.searchParams.get('sort_field'), 'UPDATED_AT'); assert.equal(u.searchParams.get('location_id'), 'location-1');
      const page = u.searchParams.has('cursor') ? Number(u.searchParams.get('cursor').slice(1)) : 0;
      if (mode === 'partial429' && page === 1) return new Response(null, { status: 429, headers: { 'retry-after': '7200' } });
      const payment = { id: `PAYMENT_${page}`, location_id: 'location-1', status: 'COMPLETED', created_at: created,
        updated_at: updated, total_money: { amount: 1000 * scale + page, currency: 'USD' }, customer_id: 'must-not-store', note: 'must-not-store' };
      return Response.json({ payments: mode === 'duplicate' ? [payment, payment] : [payment], ...(page + 1 < totalPages ? { cursor: `c${page + 1}` } : {}) });
    };
    const tick = () => runDueSquareRefreshes({ due: async () => {
      const recovered = await client.rpc('square_customer_recover_recurring_v1', scope); assert.equal(recovered.error, null);
      const result = await client.rpc('square_customer_due_recurring_v1', scope); assert.equal(result.error, null); return result.data;
    }, eligible: c => c.workspace_id === ids.workspace, sync: (c, execution) => runSquareRecurring(c, execution, { db: client, network }) });
    const due = async () => { // Advance the isolated fixture, never a hosted schedule.
      await asService(db); await db.query(`update square_customer_private.connections set recurring_next_refresh_at=clock_timestamp()-interval '1 second',
        refresh_not_before=clock_timestamp()-interval '1 second' where workspace_id=$1 and connection_id=$2`, [ids.workspace, squareIds.connection]);
    };
    const state = async () => {
      await asService(db); return (await db.query(`select state,cursor,checkpoint_at,last_read_completed_at,recurring_failure_count,
        refresh_not_before,recurring_next_refresh_at from square_customer_private.connections where workspace_id=$1 and connection_id=$2`, [ids.workspace, squareIds.connection])).rows[0];
    };
    const read = async (identity = { kind: 'square_payment', connection_id: squareIds.connection, payment_id: 'PAYMENT_0' }, workspace = ids.workspace) => {
      await actor(db); return (await db.query('select read_shared_typed_evidence_v1($1,$2) v', [workspace, JSON.stringify(identity)])).rows[0].v;
    };
    const first = await tick();
    assert.equal(first.succeeded, 1, JSON.stringify(events)); assert.equal(first.pages, 2); assert.equal(first.failed, 0);
    assert.equal(networkCalls, 2); assert.equal(events.filter(e => e.operation === 'commit_page' && e.accepted).length, 2);
    const initialState = await state(); assert.equal(initialState.cursor, null); assert(initialState.last_read_completed_at); assert(initialState.checkpoint_at);
    const firstRead = await read(); assert.equal(firstRead.stage, 'unadmitted');
    const row = sharedRow(firstRead.resolved, ids.workspace);
    assert.equal(row.provider, 'square'); assert.match(row.facts[0], /1000 USD minor units/); assert.match(row.facts[0], /not posted accounting revenue/);
    assert.equal(row.data.coverage, 'unknown'); assert.equal(row.data.entity_id, squareIds.entity); assert.equal(row.data.connection_id, squareIds.connection);
    assert.equal(new Date(row.data.last_read_completed_at).getTime(), initialState.last_read_completed_at.getTime());
    assert.doesNotMatch(JSON.stringify(row), /must-not-store|customer_id/);
    // A later automatic window updates the same source rather than adding a
    // second revenue measure, and invalidates the exact old citation version.
    scale = 2; updated = new Date(Date.now() - 1000).toISOString(); await due();
    const second = await tick(); assert.equal(second.succeeded, 1); assert.equal(second.pages, 2);
    const changed = await read(); assert.notEqual(changed.resolved.hash, firstRead.resolved.hash);
    assert.match(sharedRow(changed.resolved, ids.workspace).facts[0], /2000 USD minor units/);
    await assert.rejects(read(firstRead.resolved.identity), e => e.code === '40001');
    await asService(db);
    assert.equal((await db.query('select count(*)::int n from square_customer_private.payments')).rows[0].n, 2);
    const completeBeforePartial = await state();
    // Four pages are the tick ceiling; partial progress is not a fresh complete
    // scan. The existing completed timestamp remains inspectable in the source.
    totalPages = 6; await due(); const partial = await tick();
    assert.equal(partial.progressed, 1); assert.equal(partial.succeeded, 0); assert.equal(partial.pages, 4);
    const partialState = await state(); assert.equal(partialState.cursor, 'c4');
    assert.equal(partialState.last_read_completed_at.getTime(), completeBeforePartial.last_read_completed_at.getTime());
    const partialRead = await read(); assert.equal(partialRead.resolved.data.coverage, 'unknown');
    assert.equal(new Date(partialRead.resolved.data.last_read_completed_at).getTime(), completeBeforePartial.last_read_completed_at.getTime());
    assert.equal((await tick()).pages, 2); assert.equal((await state()).cursor, null);
    // A successful first page remains stored if the next page fails. The
    // connection becomes retry-required, so protected retrieval fails closed.
    totalPages = 2; scale = 3; mode = 'partial429'; await due(); const beforeFailure = await state();
    const failed = await tick(); assert.equal(failed.failed, 1); assert.equal(failed.pages, 1);
    const failedState = await state(); assert.equal(failedState.state, 'retry_required'); assert.equal(failedState.cursor, 'c1');
    assert.equal(failedState.last_read_completed_at.getTime(), beforeFailure.last_read_completed_at.getTime());
    assert(failedState.refresh_not_before.getTime() >= Date.now() + 7190_000);
    await assert.rejects(read(), e => e.code === '42501');
    const callsBeforeBackoff = networkCalls; assert.equal((await tick()).attempted, 0); assert.equal(networkCalls, callsBeforeBackoff);
    mode = 'good'; await due(); assert.equal((await tick()).pages, 1); assert.match(sharedRow((await read()).resolved, ids.workspace).facts[0], /3000 USD minor units/);
    // Duplicate/malformed pages cannot overwrite a previously valid payment.
    mode = 'duplicate'; scale = 4; await due(); assert.equal((await tick()).failed, 1);
    await asService(db); assert.equal((await db.query("select amount_minor::text n from square_customer_private.payments where payment_id='PAYMENT_0'")).rows[0].n, '3000');
    mode = 'good'; scale = 3; await due(); assert.equal((await tick()).succeeded, 1);
    await assert.rejects(read(undefined, ids.other), e => e.code === '42501');
    await actor(db, ids.viewer); await assert.rejects(db.query('select read_shared_typed_evidence_v1($1,$2)', [ids.workspace,
      JSON.stringify({ kind: 'square_payment', connection_id: squareIds.connection, payment_id: 'PAYMENT_0' })]), e => e.code === '42501');
    // Revocation between scheduler selection and worker admission has no reads
    // or commits, and also removes the formerly readable source from retrieval.
    await asService(db); await squareManual(db, 'disconnect', { connectionId: squareIds.connection, leaseId: ids.lease });
    const beforeRevocation = networkCalls;
    assert.equal((await tick()).attempted, 0);
    const denied = await runSquareRecurring(connection, { deadlineAt: Date.now() + 240000, cleanupDeadlineAt: Date.now() + 285000 }, { db: client, network });
    assert(['failed', 'deferred'].includes(denied.outcome)); assert.equal(networkCalls, beforeRevocation);
    await assert.rejects(read(), e => e.code === '42501');
    assert(requests.every(u => u.searchParams.has('updated_at_begin_time') && u.searchParams.has('updated_at_end_time')));
  } finally { process.env = oldEnv; await db.close(); }
});
