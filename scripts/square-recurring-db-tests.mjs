import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSquareRecurringTestDb, connectSquare, squareIds, ids, squareRecurring, squareManual, asService } from './square-recurring-test-db.mjs';
import { connectReporting, claimReporting } from './reporting-recurring-test-db.mjs';
import { connectImport, claimImport } from './import-recurring-test-db.mjs';

const migration = readFileSync(new URL('../supabase/production-migrations/20261117014116_square_customer_recurring_refresh.sql', import.meta.url), 'utf8');
const oldHistory = readFileSync(new URL('../supabase/production-migrations/20260929041048_square_customer_payment_history.sql', import.meta.url), 'utf8');
const scope = { connectionId: squareIds.connection, leaseId: ids.lease };
const queryState = async (db, connection = squareIds.connection) =>
  (await db.query('select * from square_customer_private.connections where connection_id=$1', [connection])).rows[0];
const payments = async db => (await db.query('select * from square_customer_private.payments order by payment_id')).rows;
const due = async (db, workspaces = [ids.workspace], limit = 20) =>
  (await db.query('select * from square_customer_due_recurring_v1($1,$2,$3)', [limit, workspaces, squareIds.application])).rows;
const dueNow = async db => db.exec("update square_customer_private.connections set recurring_next_refresh_at=clock_timestamp()-interval '1 second',refresh_not_before=clock_timestamp()-interval '1 second'");
const recurringStatus = async db => (await db.query('select square_customer_recurring_status_v1($1,$2,$3,$4,$5) value', [ids.actor, squareIds.session, ids.workspace, squareIds.application, squareIds.connection])).rows[0].value;
const setEnabled = async (db, enabled, { actor = ids.actor, session = squareIds.session } = {}) =>
  (await db.query('select square_customer_set_recurring_v1($1,$2,$3,$4,$5,$6) value', [actor, session, ids.workspace, squareIds.application, squareIds.connection, enabled])).rows[0].value;
const page = (context, { id = 'payment-1', value = '1200', cursor = null, overrides = {} } = {}) => ({ ...scope,
  leaseId: context.leaseId,
  payments: [{ id, locationId: 'location-1', status: 'COMPLETED', createdAt: context.windowStart,
    updatedAt: context.windowStart, amountMinor: value, currency: 'USD', ...overrides }], cursor,
  cursorBindingFingerprint: cursor ? `sha256:${'a'.repeat(64)}` : null,
  cursorFingerprint: cursor ? `sha256:${'b'.repeat(64)}` : null
});
const begin = async (db, lease = ids.lease) => {
  const context = await squareRecurring(db, 'claim', { ...scope, leaseId: lease });
  await squareRecurring(db, 'authorize', { ...scope, leaseId: lease });
  return context;
};
const fail = async (db, { lease = ids.lease, reason = 'retry_required', retry = 0 } = {}) =>
  squareRecurring(db, 'fail', { ...scope, leaseId: lease, reason, retryAfterSeconds: retry });

test('provider retry hints require the incremental overlay; original manual failure payload remains accepted before migration', async () => {
  const db = await createSquareRecurringTestDb({ applyRecurring: false });
  try {
    await connectSquare(db, { recurring: false });
    await squareManual(db, 'claim', scope);
    await assert.rejects(squareManual(db, 'fail', { ...scope, reason: 'retry_required', retryAfterSeconds: 7200 }), /payload|keys/);
    await squareManual(db, 'fail', { ...scope, reason: 'retry_required' });
    assert.equal((await queryState(db)).state, 'retry_required');
  } finally { await db.close(); }
});

test('incremental Square migration pins existing contracts and reuses the original page/CAS body without weakening manual owner/session helpers', async () => {
  const db = await createSquareRecurringTestDb({ applyRecurring: false });
  try {
    const start = oldHistory.indexOf("  elsif p_operation='commit_refresh' then");
    const original = oldHistory.slice(start, oldHistory.indexOf("  raise exception 'square_customer_backend_denied'", start))
      .replace("  elsif p_operation='commit_refresh' then", "  if p_operation='commit_refresh' then");
    assert.ok(migration.includes(original), 'shared core contains the exact existing validation/upsert/checkpoint body');
    const definitions = async () => (await db.query("select oid::regprocedure::text name,pg_get_functiondef(oid) body from pg_proc where oid in ('private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid)'::regprocedure,'private.square_production_customer_require_eligible_v1(uuid)'::regprocedure) order by 1")).rows;
    const before = await definitions();
    await db.exec(migration);
    assert.deepEqual(await definitions(), before, 'live-session and paid-workspace rules are unchanged');
    assert.equal((await db.query('select enabled from square_customer_private.configuration')).rows[0].enabled, false);
    assert.equal((await db.query('select count(*)::int n from square_customer_private.connections')).rows[0].n, 0);
  } finally { await db.close(); }
  const changed = await createSquareRecurringTestDb({ applyRecurring: false });
  try {
    await changed.exec("alter function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb) set statement_timeout='2s'");
    await assert.rejects(changed.exec(migration), /contract_drift/);
    await changed.exec('rollback');
    assert.equal((await changed.query("select count(*)::int n from information_schema.columns where table_schema='square_customer_private' and table_name='connections' and column_name='recurring_enabled'")).rows[0].n, 0);
  } finally { await changed.close(); }
});

test('consent defaults off and requires a real current workspace-owner session; scheduled reads never fabricate one', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db, { recurring: false });
    assert.deepEqual(await due(db), []);
    await assert.rejects(squareRecurring(db, 'claim', scope), /consent_required/);
    for (const session of [null, randomUUID()]) await assert.rejects(setEnabled(db, true, { session }), /owner_denied/);
    await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [squareIds.session]);
    await assert.rejects(setEnabled(db, true), /owner_denied/);
    await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 day' where id=$1", [squareIds.session]);
    await setEnabled(db, true); const consent = await queryState(db);
    await setEnabled(db, true); assert.equal((await queryState(db)).recurring_authorized_at.getTime(), consent.recurring_authorized_at.getTime());
    await db.query('delete from auth.sessions where id=$1', [squareIds.session]);
    const context = await squareRecurring(db, 'claim', scope);
    assert.equal(context.leaseId, ids.lease);
    const claimed = await queryState(db);
    assert.equal(claimed.lease_actor_id, ids.actor); assert.equal(claimed.lease_session_id, null); assert.equal(claimed.lease_kind, 'scheduled');
    assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n, 0);
    await assert.rejects(squareManual(db, 'authorize', scope), /owner_denied/);
    assert.equal((await squareRecurring(db, 'authorize', scope)).authorized, true);
  } finally { await db.close(); }
});

test('settings and dispatcher functions stay service-only and no private table, old backend or shared core becomes callable', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    for (const signature of ['square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)',
      'square_customer_recurring_status_v1(uuid,uuid,uuid,text,uuid)', 'square_customer_set_recurring_v1(uuid,uuid,uuid,text,uuid,boolean)',
      'square_customer_recurring_v1(text,uuid,text,jsonb)', 'square_customer_due_recurring_v1(integer,uuid[],text)',
      'square_customer_recover_recurring_v1(integer,uuid[],text)']) {
      assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service", [`public.${signature}`])).rows[0], { anon: false, authenticated: false, service: true });
    }
    for (const signature of ['backend_before_recurring_v1(text,uuid,uuid,uuid,text,jsonb)', 'commit_read_v1(text,uuid,jsonb,square_customer_private.connections)']) {
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') ok", [`square_customer_private.${signature}`])).rows[0].ok, false);
    }
    await db.exec("set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';");
    await assert.rejects(db.query('select * from square_customer_private.connections'), /permission denied/);
    await db.exec('reset role'); await connectSquare(db);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ids.actor}';set request.jwt.claims='{"role":"authenticated"}';`);
    await assert.rejects(due(db), /permission denied/);
    await assert.rejects(setEnabled(db, false), /permission denied/);
  } finally { await db.close(); }
});

test('two-page scheduled scan preserves partial progress, resumes its bound cursor and marks success only on the final page', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db);
    const first = await begin(db);
    assert.ok(Math.abs(Date.parse(first.windowEnd) - Date.parse(first.windowStart) - 30 * 86400_000) < 100);
    assert.deepEqual(await squareRecurring(db, 'commit_page', page(first, { cursor: 'cursor-1' })), { stored: true, hasMore: true });
    const partial = await queryState(db);
    assert.equal(partial.last_synced_at, null); assert.equal(partial.last_read_completed_at, null); assert.equal(partial.checkpoint_at, null);
    assert.equal((await payments(db)).length, 1); assert.equal(partial.cursor, 'cursor-1');
    assert.equal((await due(db)).length, 1);
    const second = await begin(db, randomUUID());
    assert.equal(second.cursor, 'cursor-1'); assert.equal(second.windowStart, first.windowStart); assert.equal(second.windowEnd, first.windowEnd);
    assert.deepEqual(await squareRecurring(db, 'commit_page', page(second, { id: 'payment-2', value: '3500' })), { stored: true, hasMore: false });
    const complete = await queryState(db);
    assert.equal(complete.checkpoint_at.toISOString(), new Date(first.windowEnd).toISOString());
    assert.equal(complete.last_read_kind, 'updated'); assert.ok(complete.last_synced_at); assert.ok(complete.last_read_completed_at);
    assert.equal(complete.cursor, null); assert.equal(complete.window_start, null);
    assert.ok(Math.abs(complete.recurring_next_refresh_at.getTime() - complete.last_synced_at.getTime() - 3600_000) < 1000);
    await assert.rejects(squareRecurring(db, 'commit_page', page(second)), /stale_lease/);
    assert.equal((await payments(db)).length, 2);
    await dueNow(db); const next = await begin(db, randomUUID());
    assert.equal(Date.parse(next.windowStart), complete.checkpoint_at.getTime() - 300_000);
  } finally { await db.close(); }
});

test('failed, duplicate, stale and malformed pages preserve prior committed facts and never advance a completed-window timestamp', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db); const first = await begin(db);
    await squareRecurring(db, 'commit_page', page(first, { cursor: 'cursor-1' }));
    const baseline = await payments(db);
    const next = await begin(db, randomUUID());
    await assert.rejects(squareRecurring(db, 'commit_page', page(next, { cursor: 'cursor-1' })), /cursor_denied/);
    await assert.rejects(squareRecurring(db, 'commit_page', page(next, { overrides: { locationId: 'another-location' } })), /payload_denied/);
    await assert.rejects(squareRecurring(db, 'commit_page', page(next, { overrides: { currency: 'not-a-currency' } })), /payload_denied/);
    assert.deepEqual(await payments(db), baseline);
    await fail(db, { lease: next.leaseId, retry: 7200 });
    const failed = await queryState(db);
    assert.equal(failed.cursor, 'cursor-1'); assert.equal(failed.last_synced_at, null); assert.equal(failed.last_read_completed_at, null);
    assert.ok(Math.abs(failed.recurring_next_refresh_at.getTime() - failed.recurring_last_failure_at.getTime() - 7200_000) < 1000);
    assert.deepEqual(await fail(db, { lease: next.leaseId }), { recorded: false });
    await assert.rejects(squareManual(db, 'claim', { ...scope, leaseId: randomUUID() }), /lease_busy/);
    await dueNow(db); const resumed = await begin(db, randomUUID());
    // Re-reading the same provider identity replaces its value once; it never
    // contributes another payment to totals.
    await squareRecurring(db, 'commit_page', page(resumed, { value: '1300' }));
    assert.equal((await payments(db)).length, 1); assert.equal(Number((await payments(db))[0].amount_minor), 1300);
    await assert.rejects(squareRecurring(db, 'commit_page', page(next)), /stale_lease/);
  } finally { await db.close(); }
});

test('token refresh uses the same credential-version CAS and can reconcile a lost acknowledgement without another write', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db); const context = await begin(db);
    const refresh = { ...scope, credentialVersion: 2, ciphertext: 'B'.repeat(64), accessExpiresAt: new Date(Date.now() + 86400_000).toISOString() };
    const updated = await squareRecurring(db, 'commit_refresh', refresh);
    assert.equal(updated.credentialVersion, 2);
    await assert.rejects(squareRecurring(db, 'commit_refresh', refresh), /stale_lease/);
    const reconciled = await squareRecurring(db, 'reconcile', scope);
    assert.equal(reconciled.credentialVersion, 2); assert.equal(reconciled.ciphertext, refresh.ciphertext);
    await squareRecurring(db, 'commit_page', page(context));
    assert.equal((await queryState(db)).credential_version, 2);
  } finally { await db.close(); }
});

test('current owner, account, billing and entity authority is rechecked before each provider authorization and commit', async () => {
  for (const change of ['membership', 'ban', 'deleted', 'billing', 'entity', 'configuration']) {
    const db = await createSquareRecurringTestDb();
    try {
      await connectSquare(db); const context = await begin(db);
      if (change === 'membership') await db.query("update workspace_members set status='disabled' where workspace_id=$1 and user_id=$2", [ids.workspace, ids.actor]);
      if (change === 'ban') await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [ids.actor]);
      if (change === 'deleted') await db.query('update auth.users set deleted_at=clock_timestamp() where id=$1', [ids.actor]);
      if (change === 'billing') await db.query("update customer_subscriptions set status='canceled' where workspace_id=$1", [ids.workspace]);
      if (change === 'entity') await db.query("update business_entities set status='inactive' where id=$1", [squareIds.entity]);
      if (change === 'configuration') await db.exec('update square_customer_private.configuration set enabled=false');
      await assert.rejects(squareRecurring(db, 'authorize', scope), /denied|closed/);
      await assert.rejects(squareRecurring(db, 'commit_page', page(context)), /denied|closed/);
      await assert.rejects(squareRecurring(db, 'commit_refresh', { ...scope, credentialVersion: 2, ciphertext: 'B'.repeat(64), accessExpiresAt: new Date(Date.now() + 3600_000).toISOString() }), /denied|closed/);
      assert.equal((await payments(db)).length, 0); assert.equal((await queryState(db)).credential_version, 1);
      assert.deepEqual(await fail(db), { recorded: true }, 'terminal cleanup still works after authority expires');
    } finally { await db.close(); }
  }
});

test('turning off recurring access, disconnecting or changing the mapped identity fences in-flight work', async () => {
  for (const change of ['disable', 'disconnect', 'location']) {
    const db = await createSquareRecurringTestDb();
    try {
      await connectSquare(db); const context = await begin(db);
      if (change === 'disable') await setEnabled(db, false);
      if (change === 'disconnect') await squareManual(db, 'disconnect', { ...scope, leaseId: randomUUID() });
      if (change === 'location') await db.exec("update square_customer_private.connections set location_id='other-location'");
      assert.equal((await queryState(db)).recurring_enabled, false);
      await assert.rejects(squareRecurring(db, 'commit_page', page(context)), /consent_required/);
      assert.equal((await payments(db)).length, 0);
      if (change === 'disconnect') {
        const row = await queryState(db);
        assert.equal(row.state, 'disconnected'); assert.equal(row.lease_kind, 'manual');
        assert.equal(row.lease_session_id, squareIds.session); assert.equal(row.revocation_pending, true);
      }
    } finally { await db.close(); }
  }
});

test('manual historical reads remain explicit and pause scheduled updates until their cursor is exhausted', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db);
    const context = await squareManual(db, 'claim_history', { ...scope, windowStart: '2020-01-01T00:00:00Z', windowEnd: '2020-02-01T00:00:00Z' });
    await squareManual(db, 'authorize', scope);
    await squareManual(db, 'commit_page', page(context, { cursor: 'manual-history-cursor' }));
    assert.deepEqual(await due(db), []);
    assert.equal((await recurringStatus(db)).reason, 'manual_read_in_progress');
    await assert.rejects(squareRecurring(db, 'claim', scope), /read_denied/);
    const continued = await squareManual(db, 'claim', { ...scope, leaseId: randomUUID() });
    assert.equal(continued.readKind, 'created'); assert.equal(continued.cursor, 'manual-history-cursor');
    await squareManual(db, 'authorize', { ...scope, leaseId: continued.leaseId });
    await squareManual(db, 'commit_page', page(continued, { id: 'historical-payment-2' }));
    assert.equal((await queryState(db)).last_read_kind, 'created'); assert.equal((await queryState(db)).last_synced_at, null);
    assert.equal((await due(db)).length, 1);
  } finally { await db.close(); }
});

test('the original live-session manual behavior and payloads remain compatible, including ordinary retry and explicit provider backoff', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db, { recurring: false });
    const context = await squareManual(db, 'claim', scope);
    await squareManual(db, 'authorize', scope);
    await squareManual(db, 'fail', { ...scope, reason: 'retry_required' });
    const retried = await squareManual(db, 'claim', scope);
    assert.equal(retried.windowStart, context.windowStart);
    await squareManual(db, 'authorize', scope);
    await squareManual(db, 'commit_page', page(retried));
    const status = await squareManual(db, 'status', {});
    assert.equal(status.connections[0].payments.length, 1); assert.equal(status.connections[0].lastCompletedRead.kind, 'updated');
    assert.equal('recurring_enabled' in status.connections[0], false, 'old strict status contract is unchanged');
    assert.equal('ciphertext' in status.connections[0], false);
    const next = await squareManual(db, 'claim', { ...scope, leaseId: randomUUID() });
    await squareManual(db, 'fail', { ...scope, leaseId: next.leaseId, reason: 'retry_required', retryAfterSeconds: 7200 });
    await assert.rejects(squareManual(db, 'claim', scope), /lease_busy/);
  } finally { await db.close(); }
});

test('expired leases recover in the exact scope and cannot overwrite later progress or invent completed coverage', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db); const first = await begin(db);
    await squareRecurring(db, 'commit_page', page(first, { cursor: 'cursor-1' }));
    const context = await begin(db, randomUUID());
    await db.exec("update square_customer_private.connections set lease_expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await db.query('select square_customer_recover_recurring_v1(20,$1,$2) n', [[ids.other], squareIds.application])).rows[0].n, 0);
    assert.equal((await db.query('select square_customer_recover_recurring_v1(20,$1,$2) n', [[ids.workspace], squareIds.application])).rows[0].n, 1);
    const recovered = await queryState(db); assert.equal(recovered.cursor, 'cursor-1'); assert.equal(recovered.last_synced_at, null);
    assert.equal(recovered.recurring_failure_count, 1); assert.equal((await payments(db)).length, 1);
    await assert.rejects(squareRecurring(db, 'commit_page', page(context)), /stale_lease/);
    await dueNow(db); const resumed = await begin(db, randomUUID());
    await squareRecurring(db, 'commit_page', page(resumed, { id: 'payment-2' }));
    assert.deepEqual(await fail(db, { lease: context.leaseId }), { recorded: false });
    assert.equal((await payments(db)).length, 2);
  } finally { await db.close(); }
});

test('a paused old owner or inactive entity remains inspectable and an authorized current owner can turn recurring access off', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db);
    await db.query("update business_entities set status='inactive' where id=$1", [squareIds.entity]);
    assert.equal((await recurringStatus(db)).reason, 'connection_unavailable');
    assert.equal((await setEnabled(db, false)).recurring_enabled, false);
    await assert.rejects(setEnabled(db, true), /owner_denied/);
    await db.query("update business_entities set status='active' where id=$1", [squareIds.entity]);
    await setEnabled(db, true);
    await db.query("update customer_subscriptions set status='canceled' where workspace_id=$1", [ids.workspace]);
    assert.equal((await recurringStatus(db)).reason, 'entitlement_unavailable');
    assert.equal((await setEnabled(db, false)).recurring_enabled, false);
  } finally { await db.close(); }
});

test('ineligible older consents cannot hide the twenty-first eligible workspace behind the due limit', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    const workspaces = [];
    for (let i = 0; i < 21; i++) {
      const workspace = randomUUID(), entity = randomUUID(), connection = randomUUID();workspaces.push(workspace);
      await db.query('insert into workspaces(id,manually_unlocked) values($1,true)', [workspace]);
      await db.query("insert into workspace_members values($1,$2,'active','owner')", [workspace, ids.actor]);
      await db.query("insert into business_entities(id,workspace_id,display_name) values($1,$2,'Fictional seller')", [entity, workspace]);
      await db.query("insert into customer_subscriptions(workspace_id,billing_provider,manually_activated,status) values($1,'manual',true,'active')", [workspace]);
      await connectSquare(db, { workspace, entity, connection, merchant: `fictional-seller-${i}` });
      if (i < 20) await db.query("update workspace_members set status='disabled' where workspace_id=$1", [workspace]);
    }
    const rows = await due(db, workspaces, 20);
    assert.equal(rows.length, 1); assert.equal(rows[0].workspace_id, workspaces[20]);
  } finally { await db.close(); }
});

test('Square and both refresh families enforce one worker per workspace and a four-worker aggregate across all ten', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db); await connectReporting(db); await connectImport(db, { connection: randomUUID() });
    const importConnection = (await db.query('select id from loyverse_connections')).rows[0].id;
    await begin(db);
    assert.equal(await claimReporting(db), false); assert.equal(await claimImport(db, { connection: importConnection }), false);
    await fail(db); await dueNow(db);
    assert.equal(await claimReporting(db), true);
    await assert.rejects(squareRecurring(db, 'claim', scope), /lease_busy/);
    await assert.rejects(squareManual(db, 'claim', scope), /lease_busy/);
    await db.query('select fail_reporting_recurring($1,$2,$3,$4,$5,0)', [ids.workspace, 'harvest', ids.connection, ids.lease, 'sync_failed']);
    assert.equal(await claimImport(db, { connection: importConnection }), true);
    await assert.rejects(squareRecurring(db, 'claim', scope), /lease_busy/);
    await db.query('select fail_import_refresh($1,$2,$3,$4,$5,0)', [ids.workspace, 'loyverse', importConnection, ids.lease, 'sync_failed']);
    for (let i = 0; i < 4; i++) {
      const workspace = randomUUID(), connection = randomUUID();
      await db.query('insert into workspaces(id) values($1)', [workspace]);
      await db.query("insert into workspace_members values($1,$2,'active','owner')", [workspace, ids.actor]);
      if (i % 2) { await connectImport(db, { workspace, connection }); assert.equal(await claimImport(db, { workspace, connection }), true); }
      else { await connectReporting(db, { workspace, connection }); assert.equal(await claimReporting(db, { workspace, connection }), true); }
    }
    await assert.rejects(squareRecurring(db, 'claim', scope), /lease_busy/);
    await assert.rejects(squareManual(db, 'claim', scope), /lease_busy/);
    assert.equal((await db.query('select count(*)::int n from private.integration_refresh_active_leases where lease_expires_at>clock_timestamp()')).rows[0].n, 4);
  } finally { await db.close(); }
});

test('another workspace and unapproved scheduling scopes cannot access contexts, credentials or provider records', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    await connectSquare(db); const context = await begin(db); await squareRecurring(db, 'commit_page', page(context));
    await assert.rejects(squareRecurring(db, 'claim', scope, { workspace: ids.other }), /denied/);
    await assert.rejects(squareManual(db, 'status', {}, { workspace: ids.other }), /owner_denied/);
    assert.deepEqual(await due(db, [ids.other]), []);
    for (const workspaces of [null, [], [null]]) await assert.rejects(due(db, workspaces), /scope_denied/);
    await assert.rejects(db.query('select square_customer_due_recurring_v1(20,$1,$2)', [[ids.workspace], 'not-an-app']), /scope_denied/);
    assert.deepEqual(await squareRecurring(db, 'fail', { ...scope, leaseId: randomUUID(), reason: 'retry_required', retryAfterSeconds: 0 }), { recorded: false });
    assert.equal((await payments(db)).length, 1);
  } finally { await db.close(); }
});

test('native PostgreSQL CI assertion script also executes locally and rolls back all fictional records', async () => {
  const db = await createSquareRecurringTestDb();
  try {
    // The local fixture omits unrelated presentation fields. Add only those
    // columns so the EXACT native PostgreSQL SQL test runs unchanged here.
    await db.exec(`alter table auth.users add column email text,add column raw_user_meta_data jsonb,
        add column raw_app_meta_data jsonb,add column created_at timestamptz,add column updated_at timestamptz;
      alter table profiles add column email text,add column full_name text;
      alter table workspaces add column name text,add column created_by uuid;
      alter table business_entities add column entity_key text,add column base_currency text,add column timezone text,
        add column created_by uuid,add column updated_by uuid;
      alter table customer_subscriptions add column user_id uuid,add column customer_email text;`);
    await asService(db);
    await db.exec(readFileSync(new URL('../supabase/tests/square_customer_recurring.test.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('select count(*)::int n from square_customer_private.connections')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from square_customer_private.payments')).rows[0].n, 0);
    assert.equal((await db.query('select enabled from square_customer_private.configuration')).rows[0].enabled, false);
  } finally { await db.close(); }
});
