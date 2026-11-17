import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReportingRecurringTestDb, ids, connectReporting, dueNow, claimReporting, reportingPeriod } from './reporting-recurring-test-db.mjs';

const providers = ['xero', 'harvest', 'clockify', 'zoho-inventory', 'toggl', 'katana'];
const historical = provider => ['xero', 'harvest', 'clockify'].includes(provider);
const snapshot = (provider, value = 2) => ({ start: new Date().toISOString(), end: new Date().toISOString(), metrics:
  (provider === 'toggl' ? ['projects', 'hours'] : provider === 'katana' ? ['stock_rows', 'unavailable'] : ['items', 'low_stock'])
    .map(key => ({ key, value })) });
const fact = (provider, day, value = 2) => ({ recordId: 'fictional-record', day, metrics:
  (provider === 'xero' ? ['invoices', 'billed', 'outstanding', 'bills', 'purchases'] : ['entries', 'hours', 'billable_hours', 'running'])
    .map(key => ({ key, value, ...(provider === 'xero' ? { currency: 'USD' } : {}) })) });
const state = async (db, connection = ids.connection) => (await db.query('select * from reporting_connections where id=$1', [connection])).rows[0];
const due = async (db, workspaces = [ids.workspace], selected = providers, limit = 20) =>
  (await db.query('select * from list_due_reporting_refreshes($1,$2,$3)', [limit, workspaces, selected])).rows;
const fail = async (db, provider = 'harvest', error = 'sync_failed', retry = 0, lease = ids.lease) =>
  (await db.query('select fail_reporting_recurring($1,$2,$3,$4,$5,$6) as ok', [ids.workspace, provider, ids.connection, lease, error, retry])).rows[0].ok;
async function apply(db, provider, value = 2, { workspace = ids.workspace, connection = ids.connection, lease = ids.lease, rows, period } = {}) {
  if (!historical(provider)) return (await db.query('select apply_reporting_snapshot($1,$2,$3,$4,$5) as ok',
    [workspace, provider, connection, lease, JSON.stringify(snapshot(provider, value))])).rows[0].ok;
  const range = period ?? await reportingPeriod(db, connection);
  return (await db.query('select apply_reporting_history($1,$2,$3,$4,$5,$6,$7,$8,$9) as ok',
    [workspace, provider, connection, lease, range.start, range.end, JSON.stringify(rows ?? [fact(provider, range.start, value)]), provider === 'xero' ? ['USD'] : [], range.cutoff])).rows[0].ok;
}

test('recurring refresh is off until an active owner explicitly consents; scope and grants fail closed', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db, { recurring: false });
    assert.equal((await state(db)).recurring_enabled, false);
    assert.deepEqual(await due(db), []);
    assert.equal(await claimReporting(db), false);
    await assert.rejects(db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [ids.workspace, 'harvest', ids.connection, ids.viewer]), /owner_required/);
    assert.equal((await db.query('select set_reporting_recurring($1,$2,$3,$4,true) as ok', [ids.other, 'harvest', ids.connection, ids.actor])).rows[0].ok, false);
    await db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [ids.workspace, 'harvest', ids.connection, ids.actor]);
    const consent = await state(db);
    await db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [ids.workspace, 'harvest', ids.connection, ids.actor]);
    assert.equal((await state(db)).recurring_authorized_at.getTime(), consent.recurring_authorized_at.getTime());
    assert.equal((await state(db)).recurring_next_refresh_at.getTime(), consent.recurring_next_refresh_at.getTime());
    for (const scopes of [null, [], [null]]) await assert.rejects(due(db, scopes), /invalid_reporting_dispatch_scope/);
    await assert.rejects(due(db, [ids.workspace], ['not-a-provider']), /invalid_reporting_dispatch_scope/);
    assert.deepEqual(await due(db, [ids.other]), []);
    const publicSignatures = ['set_reporting_recurring(uuid,text,uuid,uuid,boolean)', 'reporting_recurring_status(uuid,text,uuid)', 'list_due_reporting_refreshes(integer,uuid[],text[])',
      'claim_reporting_recurring(uuid,text,uuid,uuid)', 'fail_reporting_recurring(uuid,text,uuid,uuid,text,integer)',
      'recover_reporting_recurring(integer,uuid[],text[])', 'apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz)',
      'apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb)', 'save_reporting_refresh(uuid,text,uuid,uuid,text)'];
    for (const signature of publicSignatures) {
      const grants = (await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service", [`public.${signature}`])).rows[0];
      assert.deepEqual(grants, { anon: false, authenticated: false, service: true });
    }
    for (const signature of ['apply_reporting_history_before_recurring(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz)',
      'apply_reporting_snapshot_before_recurring(uuid,text,uuid,uuid,jsonb)', 'save_reporting_refresh_before_recurring(uuid,text,uuid,uuid,text)']) {
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') ok", [`private.${signature}`])).rows[0].ok, false);
    }
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ids.viewer}';set request.jwt.claims='{"role":"authenticated"}';`);
    assert.equal((await db.query('select count(*)::int n from reporting_connections')).rows[0].n, 1);
    await assert.rejects(db.query('update reporting_connections set recurring_enabled=true'), /permission denied/);
    await assert.rejects(due(db), /permission denied/);
    await assert.rejects(db.query('select * from reporting_credentials'), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${randomUUID()}';`);
    assert.equal((await db.query('select count(*)::int n from reporting_connections')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('all six providers atomically update supported evidence with daily history or six-hour snapshot schedules', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(), lease = randomUUID();
      await connectReporting(db, { provider, connection });
      await dueNow(db, connection);
      assert.equal(await claimReporting(db, { provider, connection, lease }), true);
      assert.equal(await apply(db, provider, 2, { connection, lease }), true);
      const first = await state(db, connection);
      assert.ok(first.last_sync_at);
      assert.equal(first.lease_id, null);
      assert.equal(first.lease_kind, null);
      const delay = first.recurring_next_refresh_at.getTime() - first.last_sync_at.getTime();
      assert.ok(Math.abs(delay - (historical(provider) ? 86400 : 21600) * 1000) < 1000);
      assert.equal(await apply(db, provider, 7, { connection, lease }), false, 'consumed response cannot replay');
      await dueNow(db, connection);
      assert.equal(await claimReporting(db, { provider, connection, lease: ids.lease }), true);
      assert.equal(await apply(db, provider, 3, { connection }), true);
      if (historical(provider)) {
        const stored = (await db.query('select metrics from reporting_history_facts where connection_id=$1', [connection])).rows;
        assert.equal(stored.length, 1, 'upsert replaces the record rather than duplicating its contribution');
        assert.equal(stored[0].metrics[0].value, 3);
        assert.equal((await db.query('select count(*)::int n from reporting_history_days where connection_id=$1', [connection])).rows[0].n, 7);
      } else assert.equal((await state(db, connection)).snapshot.metrics[0].value, 3);
      assert.equal((await state(db, connection)).recurring_failure_count, 0);
    }
  } finally { await db.close(); }
});

test('invalid, partial, duplicate and wrong-period history cannot replace valid evidence or advance freshness', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db);
    await claimReporting(db); await apply(db, 'harvest');
    const saved = await state(db);
    const savedFacts = (await db.query('select * from reporting_history_facts')).rows;
    await dueNow(db); await claimReporting(db);
    const period = await reportingPeriod(db);
    const badPeriod = { ...period, start: period.end };
    await assert.rejects(apply(db, 'harvest', 9, { period: badPeriod }), /invalid_scheduled_reporting_period/);
    await assert.rejects(apply(db, 'harvest', 9, { rows: [fact('harvest', period.start), fact('harvest', period.start)] }), /duplicate_record/);
    await assert.rejects(apply(db, 'harvest', 9, { rows: [{ recordId: 'partial', day: period.start, metrics: [{ key: 'hours', value: 9 }] }] }), /invalid_history_record/);
    assert.equal(await apply(db, 'harvest', 9, { workspace: ids.other }), false);
    assert.equal((await state(db)).last_sync_at.getTime(), saved.last_sync_at.getTime());
    assert.deepEqual((await db.query('select * from reporting_history_facts')).rows, savedFacts);
    assert.equal(await fail(db, 'harvest', 'snapshot_too_large'), true);
    assert.equal((await state(db)).last_error_code, 'snapshot_too_large');
    assert.equal((await state(db)).last_sync_at.getTime(), saved.last_sync_at.getTime());
  } finally { await db.close(); }
});

test('provider failures retain last success and obey Retry-After plus bounded exponential backoff', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db, { provider: 'toggl' });
    await claimReporting(db, { provider: 'toggl' }); await apply(db, 'toggl');
    const saved = await state(db);
    for (let attempt = 1; attempt <= 7; attempt++) {
      await dueNow(db); await claimReporting(db, { provider: 'toggl' });
      assert.equal(await fail(db, 'toggl', 'quota_exceeded', attempt === 1 ? 7200 : 0), true);
      const failed = await state(db);
      const expectedSeconds = Math.max(attempt === 1 ? 7200 : 0, Math.min(86400, 3600 * (2 ** (attempt - 1))));
      const delay = failed.recurring_next_refresh_at.getTime() - failed.recurring_last_failure_at.getTime();
      assert.ok(Math.abs(delay - expectedSeconds * 1000) < 1000);
      assert.equal(failed.recurring_failure_count, attempt);
      assert.equal(failed.last_sync_at.getTime(), saved.last_sync_at.getTime());
      assert.deepEqual(failed.snapshot, saved.snapshot);
      assert.deepEqual(await due(db), []);
      assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) ok', [ids.workspace, 'toggl', ids.connection, randomUUID()])).rows[0].ok, false);
      assert.equal(await fail(db, 'toggl'), false, 'repeated cleanup cannot increase backoff');
    }
  } finally { await db.close(); }
});

test('expired leases require scoped recovery; late workers cannot overwrite a later success', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db, { provider: 'katana' });
    await claimReporting(db, { provider: 'katana' }); await apply(db, 'katana');
    const saved = await state(db);
    await dueNow(db); await claimReporting(db, { provider: 'katana' });
    await db.query("update reporting_connections set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [ids.connection]);
    assert.equal(await apply(db, 'katana', 99), false);
    assert.deepEqual(await due(db), []);
    assert.equal((await db.query('select recover_reporting_recurring(20,$1,$2) n', [[ids.other], providers])).rows[0].n, 0);
    assert.equal((await db.query('select recover_reporting_recurring(20,$1,$2) n', [[ids.workspace], providers])).rows[0].n, 1);
    const recovered = await state(db);
    assert.equal(recovered.last_error_code, 'sync_failed');
    assert.equal(recovered.last_sync_at.getTime(), saved.last_sync_at.getTime());
    assert.deepEqual(recovered.snapshot, saved.snapshot);
    assert.equal((await db.query('select recover_reporting_recurring(20,$1,$2) n', [[ids.workspace], providers])).rows[0].n, 0);
    await dueNow(db); const replacement = randomUUID();
    assert.equal(await claimReporting(db, { provider: 'katana', lease: replacement }), true);
    assert.equal(await apply(db, 'katana', 4, { lease: replacement }), true);
    assert.equal(await fail(db, 'katana', 'sync_failed', 0, ids.lease), false);
    assert.equal(await apply(db, 'katana', 99), false);
    assert.equal((await state(db)).snapshot.metrics[0].value, 4);
  } finally { await db.close(); }
});

test('disable, disconnect and provider-account replacement fence in-flight reports and credentials', async () => {
  for (const change of ['disable', 'disconnect', 'replace']) {
    const db = await createReportingRecurringTestDb();
    try {
      await connectReporting(db, { provider: 'zoho-inventory' });
      await claimReporting(db, { provider: 'zoho-inventory' }); await apply(db, 'zoho-inventory');
      await dueNow(db); await claimReporting(db, { provider: 'zoho-inventory' });
      if (change === 'disable') await db.query('select set_reporting_recurring($1,$2,$3,$4,false)', [ids.workspace, 'zoho-inventory', ids.connection, ids.actor]);
      if (change === 'disconnect') await db.query('select disconnect_reporting_connection($1,$2,$3)', [ids.workspace, 'zoho-inventory', ids.connection]);
      if (change === 'replace') await db.query('update reporting_connections set account=$1 where id=$2', [JSON.stringify({ id: '456', name: 'Different account' }), ids.connection]);
      assert.equal((await state(db)).recurring_enabled, false);
      assert.equal((await state(db)).lease_id, null);
      assert.equal(await apply(db, 'zoho-inventory', 99), false);
      assert.equal((await db.query('select save_reporting_refresh($1,$2,$3,$4,$5) ok', [ids.workspace, 'zoho-inventory', ids.connection, ids.lease, 'B'.repeat(64)])).rows[0].ok, false);
      if (change === 'disconnect') assert.equal((await db.query('select count(*)::int n from reporting_credentials')).rows[0].n, 0);
      else assert.equal((await state(db)).snapshot.metrics[0].value, 2);
    } finally { await db.close(); }
  }
});

test('owner membership, account bans and billing revocation are rechecked before credential and evidence commit', async () => {
  for (const change of ['membership', 'ban', 'deleted-user', 'billing']) {
    const db = await createReportingRecurringTestDb();
    try {
      await connectReporting(db); await claimReporting(db); await apply(db, 'harvest');
      const saved = await state(db);
      await dueNow(db); await claimReporting(db);
      if (change === 'membership') await db.query("update workspace_members set status='inactive' where user_id=$1", [ids.actor]);
      if (change === 'ban') await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [ids.actor]);
      if (change === 'deleted-user') await db.query('update auth.users set deleted_at=clock_timestamp() where id=$1', [ids.actor]);
      if (change === 'billing') await db.query("insert into customer_subscriptions(workspace_id,billing_provider,status,current_period_end,stripe_customer_id,stripe_subscription_id) values($1,'stripe','canceled',now()+interval '1 day','fictional-customer','fictional-subscription')", [ids.workspace]);
      assert.equal(await apply(db, 'harvest', 99), false);
      assert.equal((await db.query('select save_reporting_refresh($1,$2,$3,$4,$5) ok', [ids.workspace, 'harvest', ids.connection, ids.lease, 'B'.repeat(64)])).rows[0].ok, false);
      assert.equal((await state(db)).last_sync_at.getTime(), saved.last_sync_at.getTime());
      await fail(db); await dueNow(db);
      assert.deepEqual(await due(db), []);
      assert.equal(await claimReporting(db), false);
    } finally { await db.close(); }
  }
});

test('tenant-fair dispatch and atomic admission enforce one worker per workspace and four globally', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db);
    const sameTenant = randomUUID(); await connectReporting(db, { provider: 'xero', connection: sameTenant });
    const workspaces = [ids.workspace], connections = [ids.connection];
    for (let i = 0; i < 4; i++) {
      const workspace = randomUUID(), connection = randomUUID();
      await db.query('insert into workspaces(id) values($1)', [workspace]);
      await db.query("insert into workspace_members values($1,$2,'active','owner')", [workspace, ids.actor]);
      await connectReporting(db, { workspace, connection }); workspaces.push(workspace); connections.push(connection);
    }
    const ordered = await due(db, workspaces, providers, 5);
    assert.equal(new Set(ordered.map(row => row.workspace_id)).size, 5, 'one busy tenant cannot fill the due page');
    const duplicate = await Promise.all([claimReporting(db), claimReporting(db, { lease: randomUUID() })]);
    assert.equal(duplicate.filter(Boolean).length, 1);
    assert.equal(await claimReporting(db, { provider: 'xero', connection: sameTenant, lease: randomUUID() }), false);
    assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) ok', [ids.workspace, 'xero', sameTenant, randomUUID()])).rows[0].ok, false);
    for (let i = 1; i < 4; i++) assert.equal(await claimReporting(db, { workspace: workspaces[i], connection: connections[i], lease: randomUUID() }), true);
    assert.equal(await claimReporting(db, { workspace: workspaces[4], connection: connections[4], lease: randomUUID() }), false);
    assert.equal((await db.query('select count(*)::int n from reporting_connections where lease_expires_at>clock_timestamp()')).rows[0].n, 4);
  } finally { await db.close(); }
});

test('authorization failures stop recurring reads without deleting valid evidence; manual refresh remains usable after upgrade', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db, { provider: 'toggl' });
    await claimReporting(db, { provider: 'toggl' }); await apply(db, 'toggl');
    const saved = await state(db);
    await dueNow(db); await claimReporting(db, { provider: 'toggl' });
    assert.equal(await fail(db, 'toggl', 'authorization_required'), true);
    const revoked = await state(db);
    assert.equal(revoked.status, 'reauthorization_required');
    assert.equal(revoked.recurring_enabled, false);
    assert.equal(revoked.recurring_next_refresh_at, null);
    assert.equal(revoked.last_sync_at.getTime(), saved.last_sync_at.getTime());
    assert.deepEqual(revoked.snapshot, saved.snapshot);
    assert.deepEqual(await due(db), []);
    const connection = randomUUID(); await connectReporting(db, { provider: 'katana', connection, recurring: false });
    assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) ok', [ids.workspace, 'katana', connection, ids.lease])).rows[0].ok, true);
    assert.equal(await apply(db, 'katana', 1, { connection }), true);
    assert.equal((await state(db, connection)).recurring_enabled, false);
    assert.equal((await state(db, connection)).recurring_next_refresh_at, null);
  } finally { await db.close(); }
});

test('a new owner must give their own consent and cannot reuse the former authorizer\'s in-flight lease', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db); await claimReporting(db);
    await db.query("update workspace_members set status='inactive' where user_id=$1", [ids.actor]);
    await db.query("update workspace_members set role='owner' where user_id=$1", [ids.viewer]);
    await db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [ids.workspace, 'harvest', ids.connection, ids.viewer]);
    const renewed = await state(db);
    assert.equal(renewed.recurring_authorized_by, ids.viewer);
    assert.equal(renewed.lease_id, null);
    assert.equal(await apply(db, 'harvest'), false);
    await dueNow(db); assert.equal(await claimReporting(db), true);
    assert.equal(await apply(db, 'harvest'), true);
  } finally { await db.close(); }
});

test('settings truthfully show paused authority and scope status to the requested connection', async () => {
  const db = await createReportingRecurringTestDb();
  const status = async (workspace = ids.workspace) => (await db.query('select reporting_recurring_status($1,$2,$3) value', [workspace, 'harvest', ids.connection])).rows[0].value;
  try {
    await connectReporting(db, { recurring: false });
    assert.deepEqual(await status(), { authorized: false, reason: 'disabled' });
    assert.equal(await status(ids.other), null);
    await db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [ids.workspace, 'harvest', ids.connection, ids.actor]);
    assert.deepEqual(await status(), { authorized: true, reason: 'active' });
    await db.query("update workspace_members set role='member' where user_id=$1", [ids.actor]);
    assert.deepEqual(await status(), { authorized: false, reason: 'owner_unavailable' });
    await db.query("update workspace_members set role='owner' where user_id=$1", [ids.actor]);
    await db.query("update workspaces set subscription_required=true,subscription_status='expired' where id=$1", [ids.workspace]);
    assert.deepEqual(await status(), { authorized: false, reason: 'entitlement_unavailable' });
    await db.query('select set_reporting_recurring($1,$2,$3,$4,false)', [ids.workspace, 'harvest', ids.connection, ids.actor]);
    assert.deepEqual(await status(), { authorized: false, reason: 'disabled' });
    await db.query('select disconnect_reporting_connection($1,$2,$3)', [ids.workspace, 'harvest', ids.connection]);
    assert.deepEqual(await status(), { authorized: false, reason: 'connection_unavailable' });
  } finally { await db.close(); }
});

test('scoped recovery also frees an expired manual reader on a recurring-enabled connection', async () => {
  const db = await createReportingRecurringTestDb();
  try {
    await connectReporting(db, { provider: 'toggl' });
    await claimReporting(db, { provider: 'toggl' }); await apply(db, 'toggl');
    const saved = await state(db);
    await dueNow(db);
    assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) ok', [ids.workspace, 'toggl', ids.connection, ids.lease])).rows[0].ok, true);
    await db.query("update reporting_connections set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [ids.connection]);
    assert.equal((await db.query('select recover_reporting_recurring(20,$1,$2) n', [[ids.workspace], providers])).rows[0].n, 1);
    const recovered = await state(db);
    assert.equal(recovered.lease_id, null);
    assert.equal(recovered.last_error_code, 'sync_failed');
    assert.equal(recovered.recurring_failure_count, 0, 'manual recovery is not a scheduled attempt');
    assert.equal(recovered.last_sync_at.getTime(), saved.last_sync_at.getTime());
    assert.deepEqual(recovered.snapshot, saved.snapshot);
    assert.deepEqual(await due(db), [], 'one-hour cooldown prevents a tight retry loop');
    await dueNow(db); assert.equal(await claimReporting(db, { provider: 'toggl', lease: randomUUID() }), true);
  } finally { await db.close(); }
});

test('the migration preserves prior valid reports, credentials and history without opting existing customers in', async () => {
  let before;
  const db = await createReportingRecurringTestDb({ beforeRecurringMigration: async prior => {
    await connectReporting(prior, { recurring: false });
    await prior.query('select claim_reporting_sync($1,$2,$3,$4)', [ids.workspace, 'harvest', ids.connection, ids.lease]);
    const day = '2020-01-01';
    await prior.query('select apply_reporting_history($1,$2,$3,$4,$5,$5,$6,$7,$8)',
      [ids.workspace, 'harvest', ids.connection, ids.lease, day, JSON.stringify([fact('harvest', day, 8)]), [], `${day}T23:59:59Z`]);
    before = {
      row: (await prior.query('select last_sync_at,status,account,next_sync_at from reporting_connections')).rows,
      facts: (await prior.query('select * from reporting_history_facts')).rows,
      days: (await prior.query('select * from reporting_history_days')).rows,
      credentials: (await prior.query('select * from reporting_credentials')).rows
    };
  } });
  try {
    assert.deepEqual((await db.query('select last_sync_at,status,account,next_sync_at from reporting_connections')).rows, before.row);
    assert.deepEqual((await db.query('select * from reporting_history_facts')).rows, before.facts);
    assert.deepEqual((await db.query('select * from reporting_history_days')).rows, before.days);
    assert.deepEqual((await db.query('select * from reporting_credentials')).rows, before.credentials);
    assert.equal((await state(db)).recurring_enabled, false);
    assert.equal((await state(db)).recurring_next_refresh_at, null);
    assert.deepEqual(await due(db), []);
  } finally { await db.close(); }
});
