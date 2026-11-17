// Controlled composition proof. Provider HTTP and live identities are fixtures;
// scheduler, parsers, SQL claims/commits, protected source reads and typed facts
// are the real application code. No hosted provider/model proof is asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createImportRecurringTestDb, connectImport, dueImportNow, ids } from './import-recurring-test-db.mjs';
import { asService } from './reporting-recurring-test-db.mjs';
import { installProtectedReaders, owner, entity } from './recurring-evidence-test-support.mjs';
const require = createRequire(import.meta.url);
require('./qbo-customer-test-support.cjs').installLoader();
const { runDueImportRefreshes } = require('../lib/integrations/import-refresh/scheduler.ts');
const { runImportRefresh } = require('../lib/integrations/import-refresh/execution.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { renderSharedAnswer } = require('../lib/ai/shared-evidence/answer-contract.ts');
const loyverse = require('../lib/integrations/loyverse/server.ts');
const books = require('../lib/integrations/zoho-books/server.ts');
const wix = require('../lib/integrations/wix-orders/server.ts');
const providers = ['loyverse', 'zoho-books', 'wix-orders'];
const connectionId = i => `99999999-9999-4999-8999-${String(i + 11).padStart(12, '0')}`;
const tables = { loyverse: 'loyverse_connections', 'zoho-books': 'zoho_books_connections', 'wix-orders': 'wix_order_connections' };
function sqlClient(db) {
  const lazy = run => { const q = { then: (yes, no) => Promise.resolve().then(run).then(yes, no), abortSignal: () => q }; return q; };
  return {
    rpc(name, args) {
      assert(['list_due_import_refreshes', 'claim_import_refresh', 'fail_import_refresh', 'save_import_refresh_token',
        'apply_loyverse_receipts', 'apply_zoho_books_history', 'apply_wix_order_snapshot'].includes(name), name);
      return lazy(async () => {
        await asService(db); await db.exec('set role service_role');
        const entries = Object.entries(args); entries.forEach(([key]) => assert(/^p_[a-z_]+$/.test(key)));
        const values = entries.map(([key, value]) => ['p_receipts', 'p_facts', 'p_orders'].includes(key) ? JSON.stringify(value) : value);
        try {
          const call = `public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')})`;
          const result = await db.query(name.startsWith('list_') ? `select * from ${call}` : `select ${call} v`, values);
          return { data: name.startsWith('list_') ? result.rows : result.rows[0].v, error: null };
        } catch (error) { console.error('Local composition SQL rejection', name, error.code, error.message); return { data: null, error: { code: error.code } }; }
      });
    },
    from(table) {
      assert([...Object.values(tables), 'loyverse_credentials', 'zoho_books_credentials', 'wix_order_credentials'].includes(table));
      const filters = []; let columns;
      const q = lazy(async () => {
        await asService(db); await db.exec('set role service_role');
        const result = await db.query(`select ${columns} from public.${table} where ${filters.map(([key, op], i) => `${key}${op}$${i + 1}`).join(' and ')}`, filters.map(([, , value]) => value));
        return result.rows.length === 1 ? { data: JSON.parse(JSON.stringify(result.rows[0])), error: null } : { data: null, error: { code: 'fixture_single' } };
      });
      q.select = value => { assert(/^[a-z_,]+$/.test(value)); columns = value; return q; };
      for (const [method, op] of [['eq', '='], ['gt', '>']]) q[method] = (key, value) => {
        assert(['workspace_id', 'id', 'connection_id', 'status', 'recurring_enabled', 'sync_lease_id', 'sync_lease_kind', 'sync_lease_expires_at'].includes(key), key);
        filters.push([key, op, value]); return q;
      };
      q.single = () => q; return q;
    }
  };
}

test('all three standalone automatic imports update protected typed evidence and preserve prior sources on incomplete/duplicate/failing reads', async () => {
  const savedFetch = globalThis.fetch, savedEnv = { ...process.env }, db = await createImportRecurringTestDb();
  let scale = 1, mode = 'ok', calls = 0;
  try {
    const key = Buffer.alloc(32, 9).toString('base64');
    Object.assign(process.env, { IMPORT_AUTOMATIC_REFRESH_ENABLED: 'true', IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS: ids.workspace,
      IMPORT_AUTOMATIC_REFRESH_PROVIDERS: providers.join(','), NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-no-access', VERCEL_ENV: 'preview',
      LOYVERSE_ENABLED: 'true', LOYVERSE_REDIRECT_URI: 'https://synthetic.invalid/api/integrations/loyverse/callback',
      LOYVERSE_CLIENT_ID: 'synthetic-never-sent', LOYVERSE_CLIENT_SECRET: 'synthetic-never-sent', LOYVERSE_TOKEN_ENCRYPTION_KEY: key,
      ZOHO_BOOKS_ENABLED: 'true', ZOHO_BOOKS_REDIRECT_URI: 'https://synthetic.invalid/api/integrations/zoho-books/callback',
      ZOHO_BOOKS_CLIENT_ID: 'synthetic-never-sent', ZOHO_BOOKS_CLIENT_SECRET: 'synthetic-never-sent', ZOHO_BOOKS_TOKEN_ENCRYPTION_KEY: key,
      WIX_ORDERS_ENABLED: 'true', WIX_ORDERS_ORIGIN: 'https://synthetic.invalid', WIX_ORDERS_APP_ID: ids.workspace,
      WIX_ORDERS_APP_SECRET: 'synthetic-never-sent', WIX_ORDERS_SHARE_URL_ID: ids.other, WIX_ORDERS_ENCRYPTION_KEY: key });
    await installProtectedReaders(db, Object.values(tables));
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const range = { startDate: new Date(end.getTime() - 7 * 86400000).toISOString().slice(0, 10),
      endDate: new Date(end.getTime() - 86400000).toISOString().slice(0, 10) };
    const day = range.endDate, bindings = new Map();
    for (const [i, provider] of providers.entries()) {
      const connection = connectionId(i), token = { accessToken: 'synthetic-never-sent', refreshToken: 'synthetic-never-sent', expiresAt: new Date(Date.now() + 3600000).toISOString() };
      const ciphertext = provider === 'loyverse' ? loyverse.encryptToken(ids.workspace, connection, token)
        : provider === 'zoho-books' ? books.encryptToken(ids.workspace, connection, token) : wix.encryptInstance(ids.workspace, connection, ids.other);
      await connectImport(db, { provider, connection, ciphertext });
      await owner(db);
      const state = (await db.query('select preview_legacy_evidence_mapping_v1($1,$2,$3) v', [ids.workspace, provider, connection])).rows[0].v;
      const binding = (await db.query('select confirm_legacy_evidence_mapping_v1($1,$2,$3,$4,$5) v', [ids.workspace, provider, connection, entity, state.incarnation_hash])).rows[0].v;
      bindings.set(provider, binding);
    }
    globalThis.fetch = async raw => {
      calls++; const url = new URL(raw); assert.equal(url.protocol, 'https:');
      if (mode === 'rate_limited') return new Response(null, { status: 429, headers: { 'retry-after': '7200' } });
      const duplicate = row => mode === 'duplicate' ? [row, row] : [row];
      if (url.hostname === 'api.loyverse.com') return Response.json({ receipts: duplicate({ receipt_number: 'SALE-1', store_id: 'location-1',
        receipt_date: `${day}T10:00:00Z`, created_at: `${day}T10:01:00Z`, updated_at: `${day}T10:01:00Z`, receipt_type: 'SALE', total_money: 125 * scale, total_tax: 5, total_discount: 0 }), ...(mode === 'partial' ? { cursor: 'repeating-cursor' } : {}) });
      if (url.hostname === 'www.zohoapis.com') {
        if (url.pathname.endsWith('/expenses')) {
          if (mode === 'partial') return new Response(null, { status: 503 });
          return Response.json({ code: 0, expenses: duplicate({ expense_id: '22222', date: day, currency_code: 'USD', total: 25 * scale }), page_context: { has_more_page: false } });
        }
        return Response.json({ code: 0, invoices: duplicate({ invoice_id: '11111', date: day, status: 'sent', currency_code: 'USD', total: 125 * scale, balance: 75 * scale }), page_context: { has_more_page: false } });
      }
      if (url.hostname === 'www.wixapis.com') {
        if (url.pathname === '/oauth2/token') return Response.json({ access_token: 'synthetic-never-sent' });
        return Response.json({ orders: duplicate({ id: ids.lease, createdDate: `${day}T12:00:00Z`, status: 'APPROVED', paymentStatus: 'PAID', currency: 'USD', priceSummary: { total: { amount: String(125 * scale) } } }),
          metadata: mode === 'partial' ? { hasNext: true } : { hasNext: false } });
      }
      throw new Error('unexpected_network_destination');
    };
    const client = sqlClient(db), scope = { p_limit: 20, p_allowed_workspaces: [ids.workspace], p_allowed_providers: providers };
    const tick = () => runDueImportRefreshes({ due: async () => {
      const result = await client.rpc('list_due_import_refreshes', scope); assert.equal(result.error, null); return result.data;
    }, eligible: c => c.workspace_id === ids.workspace, sync: (c, execution) => runImportRefresh({
      provider: c.provider, workspaceId: c.workspace_id, connectionId: c.id, trigger: 'scheduled', execution, db: client }) });
    const read = async provider => {
      await owner(db);
      const v = (await db.query('select capture_legacy_evidence_v1($1,$2,$3,$4) v', [ids.workspace, bindings.get(provider), range.startDate, range.endDate])).rows[0].v;
      return { ...v, projected: sharedRow({ identity: { kind: 'legacy_reference', reference_id: v.reference_id }, hash: v.source_hash, data: v.data }, ids.workspace) };
    };
    const forceDue = async () => { await asService(db); for (const [i, provider] of providers.entries()) await dueImportNow(db, { provider, connection: connectionId(i) }); };
    const firstTick = await tick(); assert.equal(firstTick.succeeded, 3, JSON.stringify(firstTick));
    const first = new Map(); for (const provider of providers) first.set(provider, await read(provider));
    const firstCalls = calls; assert.equal((await tick()).attempted, 0); assert.equal(calls, firstCalls, 'duplicate timer cannot repeat a completed import');
    scale = 2; await forceDue(); assert.equal((await tick()).succeeded, 3);
    const second = new Map();
    for (const provider of providers) {
      const source = await read(provider); second.set(provider, source);
      assert.notEqual(source.source_hash, first.get(provider).source_hash);
      const previous = (await db.query('select reopen_legacy_evidence_v1($1,$2) v', [ids.workspace, first.get(provider).reference_id])).rows[0].v;
      assert.equal(previous.status, 'changed');
      assert.equal(source.data.binding_id, first.get(provider).data.binding_id);
      assert(source.projected.facts.some(f => f.includes('250')));
      assert(source.projected.factTimes.length > 0);
    }
    assert.match(second.get('loyverse').projected.facts.join('\n'), /USD/);
    assert.match(second.get('zoho-books').projected.facts.join('\n'), /balance at import/);
    assert.match(second.get('wix-orders').projected.facts.join('\n'), /PAID/);
    const sources = [...second.values()].map(({ projected: p }, i) => ({ ref: `B${i + 1}`, binding: p.hash, dependencies: [p.hash], facts: p.facts, factTimes: p.factTimes, reported: false, provider: p.provider, environment: 'production' }));
    const answer = renderSharedAnswer({ observations: sources.map(s => ({ ref: s.ref, binding: s.binding, factIndex: 0 })), results: [], hypotheses: [], missing_information: [], next_checks: [] },
      { sources, results: [], hypothesesEnabled: true, scopes: new Map([...second.values()].map(({ projected: p }, i) => [`B${i + 1}`, p.scope])) });
    assert.equal(answer.citationIds.length, 3);
    for (const failure of ['partial', 'duplicate', 'rate_limited']) {
      mode = failure; await forceDue(); assert.equal((await tick()).failed, 3, failure);
      for (const provider of providers) assert.equal((await read(provider)).source_hash, second.get(provider).source_hash, `${failure}: prior committed data and freshness retained`);
    }
    await owner(db, ids.other);
    await assert.rejects(db.query('select capture_legacy_evidence_v1($1,$2,$3,$4)', [ids.other, bindings.get('loyverse'), range.startDate, range.endDate]));
    await owner(db, ids.workspace, ids.viewer);
    await assert.rejects(db.query('select capture_legacy_evidence_v1($1,$2,$3,$4)', [ids.workspace, bindings.get('loyverse'), range.startDate, range.endDate]));
    await asService(db);
    await db.query('update loyverse_connections set status=\'disconnected\' where workspace_id=$1 and id=$2', [ids.workspace, connectionId(0)]);
    await owner(db);
    await assert.rejects(db.query('select reopen_legacy_evidence_v1($1,$2)', [ids.workspace, second.get('loyverse').reference_id]), /evidence_binding_unavailable/);
    console.log('Standalone import composition: 3 providers, 2 successful automatic ticks, partial/duplicate/rate-limit preservation; actual SQL and protected typed citations, no hosted provider/model execution.');
  } finally { globalThis.fetch = savedFetch; process.env = savedEnv; await db.close(); }
});
