import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createImportRecurringTestDb, ids, asService, importTables, connectImport, dueImportNow, claimImport, importPeriod } from './import-recurring-test-db.mjs';
import { connectReporting, claimReporting } from './reporting-recurring-test-db.mjs';

const providers = Object.keys(importTables);
const factsTables = { loyverse: 'loyverse_receipt_facts', 'zoho-books': 'zoho_books_history_facts', 'wix-orders': 'wix_order_facts' };
const coverageTables = { loyverse: 'loyverse_import_days', 'zoho-books': 'zoho_books_history_coverage', 'wix-orders': 'wix_order_import_days' };
const rowsFor = (provider, day, value = 12) => provider === 'loyverse' ? [{ receipt_number: 'fictional-receipt', store_id: 'store-1',
  created_at: `${day}T12:00:00Z`, receipt_date: `${day}T11:59:00Z`, updated_at: `${day}T12:00:00Z`, receipt_type: 'SALE',
  total_money: value, total_tax: 1, total_discount: 0, cancelled: false }] : provider === 'zoho-books' ? [
  { kind: 'invoice', source_id: '123456', day, counted: true, currency: 'USD', total: value, outstanding: value },
  { kind: 'expense', source_id: '234567', day, counted: true, currency: 'USD', total: 2, outstanding: 0 }
] : [{ order_id: '77777777-7777-4777-8777-777777777777', created_at: `${day}T12:00:00Z`, total_amount: value,
  currency_code: 'USD', payment_status: 'PAID' }];
const state = async (db, provider, connection = ids.connection) =>
  (await db.query(`select * from ${importTables[provider]} where id=$1`, [connection])).rows[0];
const saved = async (db, provider, connection = ids.connection) => ({
  facts: (await db.query(`select * from ${factsTables[provider]} where connection_id=$1`, [connection])).rows,
  coverage: (await db.query(`select * from ${coverageTables[provider]} where connection_id=$1`, [connection])).rows,
  sync: (await state(db, provider, connection)).last_sync_at
});
const due = async (db, workspaces = [ids.workspace], selected = providers, limit = 20) =>
  (await db.query('select * from list_due_import_refreshes($1,$2,$3)', [limit, workspaces, selected])).rows;
const fail = async (db, provider, { workspace = ids.workspace, connection = ids.connection, lease = ids.lease, error = 'sync_failed', retry = 0 } = {}) =>
  (await db.query('select fail_import_refresh($1,$2,$3,$4,$5,$6) ok', [workspace, provider, connection, lease, error, retry])).rows[0].ok;
async function apply(db, provider, value = 12, { workspace = ids.workspace, connection = ids.connection, lease = ids.lease, period, rows } = {}) {
  const range = period ?? await importPeriod(db, { provider, connection });
  const payload = rows ?? rowsFor(provider, range.start, value);
  if (provider === 'zoho-books') return (await db.query('select apply_zoho_books_history($1,$2,$3,$4,$5,$6,$7) n',
    [workspace, connection, lease, range.start, range.end, range.cutoff, JSON.stringify(payload)])).rows[0].n;
  return (await db.query(`select ${provider === 'loyverse' ? 'apply_loyverse_receipts' : 'apply_wix_order_snapshot'}($1,$2,$3,$4,$5,$6) n`,
    [workspace, connection, lease, `${range.start}T00:00:00Z`, range.cutoff, JSON.stringify(payload)])).rows[0].n;
}
const saveToken = async (db, provider, { workspace = ids.workspace, connection = ids.connection, lease = ids.lease } = {}) =>
  (await db.query("select save_import_refresh_token($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour') ok",
    [workspace, provider, connection, lease, 'B'.repeat(64)])).rows[0].ok;

test('all three imports default off and require exact scope, current owner consent and internal-only RPC privileges', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection, recurring: false });
      assert.equal((await state(db, provider, connection)).recurring_enabled, false);
      assert.equal(await claimImport(db, { provider, connection }), false);
      await assert.rejects(db.query('select set_import_recurring($1,$2,$3,$4,true)', [ids.workspace, provider, connection, ids.viewer]), /owner_required/);
      assert.equal((await db.query('select set_import_recurring($1,$2,$3,$4,true) ok', [ids.other, provider, connection, ids.actor])).rows[0].ok, false);
      await db.query('select set_import_recurring($1,$2,$3,$4,true)', [ids.workspace, provider, connection, ids.actor]);
      const enabled = await state(db, provider, connection);
      await db.query('select set_import_recurring($1,$2,$3,$4,true)', [ids.workspace, provider, connection, ids.actor]);
      assert.equal((await state(db, provider, connection)).recurring_next_refresh_at.getTime(), enabled.recurring_next_refresh_at.getTime());
    }
    assert.equal((await due(db)).length, 3);
    assert.deepEqual(await due(db, [ids.other]), []);
    for (const scopes of [null, [], [null]]) await assert.rejects(due(db, scopes), /invalid_import_dispatch_scope/);
    await assert.rejects(due(db, [ids.workspace], ['loyverse;drop table workspaces']), /invalid_import_dispatch_scope/);
    await assert.rejects(db.query('select import_recurring_status($1,$2,$3)', [ids.workspace, 'loyverse;drop table workspaces', ids.connection]), /invalid_import_provider/);
    const signatures = ['set_import_recurring(uuid,text,uuid,uuid,boolean)', 'import_recurring_status(uuid,text,uuid)',
      'claim_reporting_recurring(uuid,text,uuid,uuid)', 'claim_reporting_sync(uuid,text,uuid,uuid)',
      'list_due_import_refreshes(integer,uuid[],text[])', 'claim_import_refresh(uuid,text,uuid,uuid,text,uuid)',
      'fail_import_refresh(uuid,text,uuid,uuid,text,integer)', 'recover_import_refreshes(integer,uuid[],text[])',
      'save_import_refresh_token(uuid,text,uuid,uuid,text,timestamptz)',
      'apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)', 'apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb)',
      'apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)'];
    for (const signature of signatures) assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service", [`public.${signature}`])).rows[0], { anon: false, authenticated: false, service: true });
    for (const signature of ['apply_loyverse_receipts_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)',
      'apply_zoho_books_history_before_recurring(uuid,uuid,uuid,date,date,timestamptz,jsonb)',
      'apply_wix_order_snapshot_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb)']) {
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') ok", [`private.${signature}`])).rows[0].ok, false);
    }
    assert.equal((await db.query("select has_table_privilege('service_role','private.import_refresh_connections','select') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_table_privilege('service_role','private.integration_refresh_active_leases','select') ok")).rows[0].ok, false);
    assert.equal((await db.query("select has_function_privilege('service_role','public.apply_zoho_books_summary(uuid,uuid,uuid,date,date,jsonb)','execute') ok")).rows[0].ok, false, 'retired destructive summary remains inaccessible');
  } finally { await db.close(); }
});

test('all three atomically replace refreshed source versions and retain complete seven-date coverage and financial fields', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      assert.equal(await claimImport(db, { provider, connection }), true);
      const expectedCount = provider === 'zoho-books' ? 2 : 1;
      assert.equal(await apply(db, provider, 12, { connection }), expectedCount);
      const first = await state(db, provider, connection);
      assert.equal(first.sync_lease_id, null); assert.equal(first.sync_lease_kind, null);
      assert.ok(Math.abs(first.recurring_next_refresh_at.getTime() - first.last_sync_at.getTime() - 86400_000) < 1000);
      assert.equal((await saved(db, provider, connection)).coverage.length, 7);
      await assert.rejects(apply(db, provider, 99, { connection }), /lease_invalid/);
      await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection, lease: ids.lease });
      assert.equal(await apply(db, provider, 15, { connection }), expectedCount);
      const updated = await saved(db, provider, connection);
      assert.equal(updated.facts.length, expectedCount, 'the provider record is replaced, not added twice');
      if (provider === 'loyverse') {
        assert.equal(Number(updated.facts[0].total_money), 15); assert.equal(updated.facts[0].receipt_type, 'SALE');
        assert.equal(Number(updated.facts[0].total_tax), 1); assert.equal((await state(db, provider, connection)).currency_code, 'USD');
      } else if (provider === 'zoho-books') {
        assert.equal(Number(updated.facts.find(row => row.kind === 'invoice').outstanding), 15);
        assert.equal(Number(updated.facts.find(row => row.kind === 'expense').total), 2);
        assert.ok(updated.facts.every(row => row.currency === 'USD'));
      } else {
        assert.equal(Number(updated.facts[0].total_amount), 15); assert.equal(updated.facts[0].currency_code, 'USD');
        assert.equal(updated.facts[0].payment_status, 'PAID');
      }
      assert.equal((await state(db, provider, connection)).recurring_failure_count, 0);
    }
  } finally { await db.close(); }
});

test('partial, duplicate, cross-workspace and mismatched-period results cannot overwrite a valid import or advance freshness', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
      const before = await saved(db, provider, connection);
      await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection });
      const period = await importPeriod(db, { provider, connection });
      await assert.rejects(apply(db, provider, 99, { connection, period: { ...period, start: period.end } }), /invalid_scheduled_import_period/);
      const row = rowsFor(provider, period.start)[0];
      await assert.rejects(apply(db, provider, 99, { connection, rows: [row, row] }), /snapshot_invalid|fact_invalid/);
      await assert.rejects(apply(db, provider, 99, { connection, rows: [{ ...row, ...(provider === 'loyverse' ? { store_id: null } : provider === 'zoho-books' ? { counted: null } : { total_amount: null }) }] }));
      await assert.rejects(apply(db, provider, 99, { connection, workspace: ids.other }), /lease_invalid/);
      assert.deepEqual(await saved(db, provider, connection), before);
      assert.equal(await fail(db, provider, { connection, error: 'snapshot_too_large' }), true);
      assert.deepEqual(await saved(db, provider, connection), before);
      assert.equal((await state(db, provider, connection)).last_error_code, 'snapshot_too_large');
    }
  } finally { await db.close(); }
});

test('failed reads preserve the previous report whereas a completed empty read truthfully replaces the selected period', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
      const before = await saved(db, provider, connection);
      await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection });
      await fail(db, provider, { connection });
      assert.deepEqual(await saved(db, provider, connection), before);
      await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection });
      assert.equal(await apply(db, provider, 0, { connection, rows: [] }), 0);
      const empty = await saved(db, provider, connection);
      assert.equal(empty.facts.length, 0); assert.equal(empty.coverage.length, 7);
      assert.ok(empty.sync > before.sync); assert.equal((await state(db, provider, connection)).last_error_code, null);
    }
  } finally { await db.close(); }
});

test('Retry-After and exponential backoff apply to scheduled and manual admission and cannot be duplicated', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
      const before = await saved(db, provider, connection);
      for (let attempt = 1; attempt <= 6; attempt++) {
        await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection });
        assert.equal(await fail(db, provider, { connection, error: 'quota_exceeded', retry: attempt === 1 ? 7200 : 0 }), true);
        const failed = await state(db, provider, connection);
        const expected = Math.max(attempt === 1 ? 7200 : 0, Math.min(86400, 3600 * 2 ** (attempt - 1)));
        assert.ok(Math.abs(failed.recurring_next_refresh_at.getTime() - failed.recurring_last_failure_at.getTime() - expected * 1000) < 1000);
        assert.equal(failed.recurring_failure_count, attempt);
        assert.equal(await claimImport(db, { provider, connection, trigger: 'manual' }), false);
        assert.equal(await fail(db, provider, { connection }), false);
        assert.deepEqual(await saved(db, provider, connection), before);
      }
    }
  } finally { await db.close(); }
});

test('disable and disconnect fence old evidence and token writes, preserve ordinary history on disable, and never recreate credentials', async () => {
  for (const provider of providers) {
    const db = await createImportRecurringTestDb();
    try {
      await connectImport(db, { provider }); await claimImport(db, { provider }); await apply(db, provider);
      const before = await saved(db, provider);
      await dueImportNow(db, { provider }); await claimImport(db, { provider });
      await db.query('select set_import_recurring($1,$2,$3,$4,false)', [ids.workspace, provider, ids.connection, ids.actor]);
      await assert.rejects(apply(db, provider, 99), /lease_invalid/);
      if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider), false);
      assert.deepEqual(await saved(db, provider), before);
      await db.query('select set_import_recurring($1,$2,$3,$4,true)', [ids.workspace, provider, ids.connection, ids.actor]);
      await dueImportNow(db, { provider }); await claimImport(db, { provider });
      const disconnect = provider === 'loyverse' ? 'disconnect_loyverse_connection' : provider === 'zoho-books' ? 'disconnect_zoho_books_connection' : 'disconnect_wix_order_connection';
      await db.query(`select ${disconnect}($1,$2)`, [ids.workspace, ids.connection]);
      assert.equal((await state(db, provider)).recurring_enabled, false);
      await assert.rejects(apply(db, provider, 99), /lease_invalid/);
      if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider), false);
      const credentialTable = provider === 'loyverse' ? 'loyverse_credentials' : provider === 'zoho-books' ? 'zoho_books_credentials' : 'wix_order_credentials';
      assert.equal((await db.query(`select count(*)::int n from ${credentialTable}`)).rows[0].n, 0);
      assert.equal((await db.query(`select count(*)::int n from ${factsTables[provider]}`)).rows[0].n, 0);
    } finally { await db.close(); }
  }
});

test('membership, bans, deleted identity and billing loss are rechecked immediately before reports and token persistence', async () => {
  for (const change of ['membership', 'ban', 'deleted', 'billing']) {
    const db = await createImportRecurringTestDb();
    try {
      for (const provider of providers) {
        const connection = randomUUID(); await connectImport(db, { provider, connection });
        await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
      }
      for (const provider of providers) {
        const connection = (await db.query(`select id from ${importTables[provider]}`)).rows[0].id;
        const before = await saved(db, provider, connection);
        await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection });
        if (change === 'membership') await db.query("update workspace_members set status='inactive' where user_id=$1", [ids.actor]);
        if (change === 'ban') await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1", [ids.actor]);
        if (change === 'deleted') await db.query('update auth.users set deleted_at=clock_timestamp() where id=$1', [ids.actor]);
        if (change === 'billing') await db.query("update workspaces set subscription_required=true,subscription_status='expired' where id=$1", [ids.workspace]);
        await assert.rejects(apply(db, provider, 99, { connection }), /authority_expired/);
        if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider, { connection }), false);
        assert.deepEqual(await saved(db, provider, connection), before);
        await fail(db, provider, { connection }); await dueImportNow(db, { provider, connection });
        assert.equal(await claimImport(db, { provider, connection }), false);
        assert.deepEqual(await due(db), []);
        await db.query("update workspace_members set status='active' where user_id=$1", [ids.actor]);
        await db.query('update auth.users set banned_until=null,deleted_at=null where id=$1', [ids.actor]);
        await db.query('update workspaces set subscription_required=false where id=$1', [ids.workspace]);
      }
    } finally { await db.close(); }
  }
});

test('expired scheduled and manual readers recover without falsifying freshness and reject late workers', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
      const before = await saved(db, provider, connection);
      for (const trigger of ['scheduled', 'manual']) {
        await dueImportNow(db, { provider, connection }); await claimImport(db, { provider, connection, trigger });
        await db.query(`update ${importTables[provider]} set sync_lease_expires_at=clock_timestamp()-interval '1 second' where id=$1`, [connection]);
        await assert.rejects(apply(db, provider, 99, { connection }), /lease_invalid/);
        assert.equal((await db.query('select recover_import_refreshes(20,$1,$2) n', [[ids.other], providers])).rows[0].n, 0);
        assert.equal((await db.query('select recover_import_refreshes(20,$1,$2) n', [[ids.workspace], providers])).rows[0].n, 1);
        assert.equal((await state(db, provider, connection)).last_error_code, 'sync_failed');
        assert.deepEqual(await saved(db, provider, connection), before);
        assert.equal(await fail(db, provider, { connection }), false);
      }
      await dueImportNow(db, { provider, connection }); const replacement = randomUUID();
      await claimImport(db, { provider, connection, lease: replacement }); await apply(db, provider, 20, { connection, lease: replacement });
      assert.equal(await fail(db, provider, { connection }), false);
      await assert.rejects(apply(db, provider, 99, { connection }), /lease_invalid/);
    }
  } finally { await db.close(); }
});

test('all nine connectors share four-worker admission and one worker per workspace across both families', async () => {
  const db = await createImportRecurringTestDb();
  try {
    await connectReporting(db); await connectImport(db, { provider: 'loyverse', connection: randomUUID() });
    const firstImport = (await db.query('select id from loyverse_connections')).rows[0].id;
    assert.equal(await claimReporting(db), true);
    assert.equal(await claimImport(db, { connection: firstImport }), false);
    await db.query('select fail_reporting_recurring($1,$2,$3,$4,$5,0)', [ids.workspace, 'harvest', ids.connection, ids.lease, 'sync_failed']);
    assert.equal(await claimImport(db, { connection: firstImport }), true);
    await db.query("update reporting_connections set next_sync_at=clock_timestamp()-interval '1 second',recurring_next_refresh_at=clock_timestamp()-interval '1 second'");
    assert.equal(await claimReporting(db), false);
    assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) ok', [ids.workspace, 'harvest', ids.connection, randomUUID()])).rows[0].ok, false);
    const workspaces = [ids.workspace]; let lastReporting, lastImport;
    for (let i = 0; i < 4; i++) {
      const workspace = randomUUID(), connection = randomUUID(); workspaces.push(workspace);
      await db.query('insert into workspaces(id) values($1)', [workspace]);
      await db.query("insert into workspace_members values($1,$2,'active','owner')", [workspace, ids.actor]);
      if (i % 2 === 0) {
        await connectReporting(db, { workspace, connection });
        assert.equal(await claimReporting(db, { workspace, connection, lease: randomUUID() }), i < 3);
        lastReporting = { workspace, connection };
      } else {
        await connectImport(db, { provider: 'wix-orders', workspace, connection });
        assert.equal(await claimImport(db, { provider: 'wix-orders', workspace, connection, lease: randomUUID() }), i < 3);
        lastImport = { workspace, connection };
      }
    }
    assert.equal((await db.query('select count(*)::int n from private.integration_refresh_active_leases where lease_expires_at>clock_timestamp()')).rows[0].n, 4);
    assert.equal(await claimReporting(db, { ...lastReporting, lease: randomUUID() }), false);
    assert.equal(await claimImport(db, { ...lastImport, provider: 'wix-orders', lease: randomUUID() }), false);
  } finally { await db.close(); }
});

test('manual historical imports retain their chosen dates, use guarded tokens and cannot bypass current authority', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection, recurring: false });
      assert.equal(await claimImport(db, { provider, connection, trigger: 'manual', actor: ids.viewer }), false);
      assert.equal(await claimImport(db, { provider, connection, trigger: 'manual' }), true);
      if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider, { connection }), true);
      const period = { start: '2020-01-01', end: '2020-01-31', cutoff: '2020-02-01T00:00:00Z' };
      assert.equal(await apply(db, provider, 12, { connection, period }), provider === 'zoho-books' ? 2 : 1);
      assert.equal((await state(db, provider, connection)).recurring_enabled, false);
      assert.equal((await state(db, provider, connection)).recurring_next_refresh_at, null);
      assert.equal((await saved(db, provider, connection)).coverage.length, 31);
      assert.equal(await claimImport(db, { provider, connection, trigger: 'manual' }), true, 'successful manual imports receive no new one-hour cooldown');
      await db.query("update workspace_members set status='inactive' where user_id=$1", [ids.actor]);
      await assert.rejects(apply(db, provider, 99, { connection, period }), /authority_expired/);
      if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider, { connection }), false);
      await fail(db, provider, { connection });
      await db.query("update workspace_members set status='active' where user_id=$1", [ids.actor]);
    }
  } finally { await db.close(); }
});

test('settings disclose paused authority and owner renewal cancels the prior owner\'s lease', async () => {
  const db = await createImportRecurringTestDb();
  try {
    const provider = 'zoho-books'; await connectImport(db, { provider }); await claimImport(db, { provider });
    const status = async (workspace = ids.workspace) => (await db.query('select import_recurring_status($1,$2,$3) value', [workspace, provider, ids.connection])).rows[0].value;
    assert.equal(await status(ids.other), null);
    assert.deepEqual(await status(), { authorized: true, reason: 'active' });
    await db.query("update workspace_members set status='inactive' where user_id=$1", [ids.actor]);
    await db.query("update workspace_members set role='owner' where user_id=$1", [ids.viewer]);
    assert.deepEqual(await status(), { authorized: false, reason: 'owner_unavailable' });
    await db.query('select set_import_recurring($1,$2,$3,$4,true)', [ids.workspace, provider, ids.connection, ids.viewer]);
    assert.equal((await state(db, provider)).recurring_authorized_by, ids.viewer);
    assert.equal((await state(db, provider)).sync_lease_id, null);
    await assert.rejects(apply(db, provider, 99), /lease_invalid/);
    assert.deepEqual(await status(), { authorized: true, reason: 'active' });
    await db.query("update workspaces set subscription_required=true,subscription_status='expired' where id=$1", [ids.workspace]);
    assert.deepEqual(await status(), { authorized: false, reason: 'entitlement_unavailable' });
    await db.query('select set_import_recurring($1,$2,$3,$4,false)', [ids.workspace, provider, ids.connection, ids.viewer]);
    assert.deepEqual(await status(), { authorized: false, reason: 'disabled' });
  } finally { await db.close(); }
});

test('import source records and operational settings retain tenant RLS and credential isolation', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection });
      await claimImport(db, { provider, connection }); await apply(db, provider, 12, { connection });
    }
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ids.viewer}';set request.jwt.claims='{"role":"authenticated"}';`);
    for (const provider of providers) {
      assert.equal((await db.query(`select count(*)::int n from ${importTables[provider]}`)).rows[0].n, 1);
      assert.ok((await db.query(`select count(*)::int n from ${factsTables[provider]}`)).rows[0].n > 0);
      await assert.rejects(db.query(`update ${importTables[provider]} set recurring_enabled=true`), /permission denied/);
    }
    for (const table of ['loyverse_credentials', 'zoho_books_credentials', 'wix_order_credentials']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    await assert.rejects(due(db), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${randomUUID()}';`);
    for (const provider of providers) for (const table of [importTables[provider], factsTables[provider], coverageTables[provider]]) {
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0);
    }
  } finally { await db.close(); }
});

test('due selection is tenant-fair and duplicate claims admit exactly one accepted attempt', async () => {
  const db = await createImportRecurringTestDb();
  try {
    await db.query("insert into workspace_members values($1,$2,'active','owner')", [ids.other, ids.actor]);
    for (const workspace of [ids.workspace, ids.other]) for (const provider of providers) {
      await connectImport(db, { provider, workspace, connection: randomUUID() });
    }
    const first = await due(db, [ids.workspace, ids.other], providers, 2);
    assert.equal(new Set(first.map(row => row.workspace_id)).size, 2);
    const candidate = first[0];
    const accepted = await Promise.all([claimImport(db, { workspace: candidate.workspace_id, provider: candidate.provider, connection: candidate.id }),
      claimImport(db, { workspace: candidate.workspace_id, provider: candidate.provider, connection: candidate.id, lease: randomUUID() })]);
    assert.equal(accepted.filter(Boolean).length, 1);
  } finally { await db.close(); }
});

test('provider account replacements cancel consent and all leases for that exact connection', async () => {
  const db = await createImportRecurringTestDb();
  try {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(db, { provider, connection }); await claimImport(db, { provider, connection });
      const field = provider === 'loyverse' ? 'merchant_id' : provider === 'zoho-books' ? 'organization_id' : 'site_id';
      await db.query(`update ${importTables[provider]} set ${field}=$1 where id=$2`, [provider === 'zoho-books' ? '987654' : randomUUID(), connection]);
      const changed = await state(db, provider, connection);
      assert.equal(changed.recurring_enabled, false); assert.equal(changed.sync_lease_id, null);
      await assert.rejects(apply(db, provider, 99, { connection }), /lease_invalid/);
      if (provider !== 'wix-orders') assert.equal(await saveToken(db, provider, { connection }), false);
    }
  } finally { await db.close(); }
});

test('migration-first installation preserves existing reports, historical periods and credentials without automatic consent', async () => {
  const before = new Map();
  const db = await createImportRecurringTestDb({ beforeImportMigration: async prior => {
    for (const provider of providers) {
      const connection = randomUUID(); await connectImport(prior, { provider, connection, recurring: false });
      await prior.query(`update ${importTables[provider]} set sync_lease_id=$1,sync_lease_expires_at=clock_timestamp()+interval '65 seconds' where id=$2`, [ids.lease, connection]);
      const period = { start: '2020-01-01', end: '2020-01-31', cutoff: '2020-02-01T00:00:00Z' };
      await apply(prior, provider, 12, { connection, period });
      before.set(provider, { connection, saved: await saved(prior, provider, connection) });
    }
  } });
  try {
    for (const [provider, original] of before) {
      assert.deepEqual(await saved(db, provider, original.connection), original.saved);
      assert.equal((await state(db, provider, original.connection)).recurring_enabled, false);
      assert.equal((await state(db, provider, original.connection)).recurring_next_refresh_at, null);
      const credentialTable = provider === 'loyverse' ? 'loyverse_credentials' : provider === 'zoho-books' ? 'zoho_books_credentials' : 'wix_order_credentials';
      assert.equal((await db.query(`select count(*)::int n from ${credentialTable} where connection_id=$1`, [original.connection])).rows[0].n, 1);
      // Old server deployments retain their original manual route protection;
      // no such legacy lease is eligible as a scheduled admission.
      await db.query(`update ${importTables[provider]} set sync_lease_id=$1,sync_lease_expires_at=clock_timestamp()+interval '65 seconds' where id=$2`, [ids.lease, original.connection]);
      await apply(db, provider, 13, { connection: original.connection, period: { start: '2020-01-01', end: '2020-01-31', cutoff: '2020-02-01T00:00:00Z' } });
      assert.equal((await state(db, provider, original.connection)).recurring_enabled, false);
    }
    assert.deepEqual(await due(db), []);
  } finally { await db.close(); }
});
