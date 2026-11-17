// Local composition proof: real dispatcher, provider parsers, SQL admission and
// atomic writes, then the existing protected legacy readers and VSI projection.
// Provider HTTP and live-session verification are controlled fixtures. This is
// not hosted OAuth/PostgREST, concurrent-backend, or live-model qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createReportingRecurringTestDb, ids, asService, connectReporting, dueNow } from './reporting-recurring-test-db.mjs';
const require = createRequire(import.meta.url);
require('./qbo-customer-test-support.cjs').installLoader();
const { seal } = require('../lib/integrations/reporting/security.ts');
const { runDueReportingRefreshes, runScheduledReportingRefresh, recurringReportingRange } = require('../lib/integrations/reporting/scheduler.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { renderSharedAnswer } = require('../lib/ai/shared-evidence/answer-contract.ts');
import { installProtectedReaders, owner, entity } from './recurring-evidence-test-support.mjs';
const providers = ['xero', 'harvest', 'katana'];
const connectionId = i => `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`;

function sqlClient(db) {
  const lazy = run => { const q = { then: (yes, no) => Promise.resolve().then(run).then(yes, no), abortSignal: () => q }; return q; };
  return {
    rpc(name, args) {
      assert(['list_due_reporting_refreshes', 'claim_reporting_recurring', 'fail_reporting_recurring', 'apply_reporting_history', 'apply_reporting_snapshot', 'save_reporting_refresh'].includes(name));
      return lazy(async () => {
        await asService(db); await db.exec('set role service_role');
        const entries = Object.entries(args); entries.forEach(([key]) => assert(/^p_[a-z_]+$/.test(key)));
        const values = entries.map(([key, value]) => ['p_records', 'p_snapshot'].includes(key) ? JSON.stringify(value) : value);
        try {
          const call = `public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')})`;
          const result = await db.query(name.startsWith('list_') ? `select * from ${call}` : `select ${call} v`, values);
          return { data: name.startsWith('list_') ? result.rows : result.rows[0].v, error: null };
        } catch (error) { console.error('Local composition SQL rejection', name, error.code, error.message); return { data: null, error: { code: error.code, message: error.message } }; }
      });
    },
    from(table) {
      assert(['reporting_connections', 'reporting_credentials'].includes(table));
      const filters = []; let columns;
      const q = lazy(async () => {
        await asService(db); await db.exec('set role service_role');
        const result = await db.query(`select ${columns} from public.${table} where ${filters.map(([key, op], i) => `${key}${op}$${i + 1}`).join(' and ')}`, filters.map(([, , value]) => value));
        // PostgREST serializes timestamps as ISO strings; PGlite returns Dates.
        return result.rows.length === 1 ? { data: JSON.parse(JSON.stringify(result.rows[0])), error: null } : { data: null, error: { code: 'fixture_single' } };
      });
      q.select = value => { assert(/^(account,recurring_last_attempt_at|ciphertext)$/.test(value)); columns = value; return q; };
      for (const [method, op] of [['eq', '='], ['gt', '>']]) q[method] = (key, value) => {
        assert(['workspace_id', 'provider', 'id', 'connection_id', 'status', 'recurring_enabled', 'lease_id', 'lease_kind', 'lease_expires_at'].includes(key));
        filters.push([key, op, value]); return q;
      };
      q.single = () => q; return q;
    }
  };
}

test('scheduled reporting updates become new protected source versions; failed/revoked reads preserve or deny evidence', async () => {
  const oldFetch = globalThis.fetch, oldEnv = { ...process.env }, db = await createReportingRecurringTestDb();
  let scale = 1, fail = false, calls = 0;
  try {
    Object.assign(process.env, { REPORTING_AUTOMATIC_REFRESH_ENABLED: 'true', REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS: ids.workspace,
      REPORTING_AUTOMATIC_REFRESH_PROVIDERS: providers.join(','), REPORTING_CONNECTOR_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-no-access' });
    for (const provider of providers) {
      const prefix = provider.toUpperCase();
      process.env[`${prefix}_REPORTING_ENABLED`] = 'true'; process.env[`${prefix}_CLIENT_ID`] = 'synthetic'; process.env[`${prefix}_CLIENT_SECRET`] = 'synthetic';
    }
    await installProtectedReaders(db);
    const bindings = new Map(), range = recurringReportingRange(), day = range.endDate;
    for (const [i, provider] of providers.entries()) {
      const connection = connectionId(i);
      await connectReporting(db, { provider, connection, account: { id: provider === 'katana' ? 'key-account' : '123', name: 'Fictional account' }, ciphertext: seal(provider, ids.workspace, connection, { accessToken: 'synthetic-never-sent' }) });
      await owner(db);
      const state = (await db.query('select preview_legacy_evidence_mapping_v1($1,$2,$3) v', [ids.workspace, provider, connection])).rows[0].v;
      const binding = (await db.query('select confirm_legacy_evidence_mapping_v1($1,$2,$3,$4,$5) v', [ids.workspace, provider, connection, entity, state.incarnation_hash])).rows[0].v;
      bindings.set(provider, binding);
    }
    globalThis.fetch = async url => {
      calls++; assert.equal(new URL(url).protocol, 'https:');
      if (fail) return new Response(null, { status: 429, headers: { 'retry-after': '7200' } });
      switch (new URL(url).hostname) {
        case 'api.xero.com': return Response.json({ Invoices: [{ InvoiceID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DateString: `${day}T00:00:00`, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'USD', Total: 125 * scale, AmountDue: 75 * scale }] });
        case 'api.harvestapp.com': return Response.json({ time_entries: [{ id: 'entry-1', spent_date: day, hours: 1.25 * scale, billable: true, is_running: false }], page: 1, next_page: null, total_entries: 1 });
        case 'api.katanamrp.com': return Response.json({ data: Array.from({ length: scale }, (_, i) => ({ variant_id: `variant-${i}`, location_id: 'location', quantity_in_stock: '4', quantity_committed: '2' })) });
        default: throw Error('unexpected_network_destination');
      }
    };
    const client = sqlClient(db), scope = { p_limit: 20, p_allowed_workspaces: [ids.workspace], p_allowed_providers: providers };
    const tick = () => runDueReportingRefreshes({ due: async () => {
      const result = await client.rpc('list_due_reporting_refreshes', scope); assert.equal(result.error, null); return result.data;
    }, eligible: c => c.workspace_id === ids.workspace, sync: (c, execution) => runScheduledReportingRefresh(c, execution, client) });
    const read = async provider => {
      await owner(db);
      const v = (await db.query('select capture_legacy_evidence_v1($1,$2,$3,$4) v', [ids.workspace, bindings.get(provider), range.startDate, range.endDate])).rows[0].v;
      return { ...v, projected: sharedRow({ identity: { kind: 'legacy_reference', reference_id: v.reference_id }, hash: v.source_hash, data: v.data }, ids.workspace) };
    };
    const firstTick = await tick(); assert.equal(firstTick.succeeded, 3, JSON.stringify(firstTick));
    const first = new Map(); for (const provider of providers) first.set(provider, await read(provider));
    const noDuplicateCalls = calls; assert.equal((await tick()).attempted, 0); assert.equal(calls, noDuplicateCalls);
    scale = 2; await asService(db); for (let i = 0; i < 3; i++) await dueNow(db, connectionId(i));
    assert.equal((await tick()).succeeded, 3);
    const second = new Map();
    for (const provider of providers) {
      const updated = await read(provider); second.set(provider, updated);
      assert.notEqual(updated.source_hash, first.get(provider).source_hash);
      assert.equal(updated.data.binding_id, first.get(provider).data.binding_id, 'same reviewed connection/entity, new content version');
      const prior = (await db.query('select reopen_legacy_evidence_v1($1,$2) v', [ids.workspace, first.get(provider).reference_id])).rows[0].v;
      assert.equal(prior.status, 'changed');
    }
    assert.match(second.get('xero').projected.facts.join('\n'), /billed: 250 USD/);
    assert.match(second.get('xero').projected.facts.join('\n'), /balance at import/);
    assert.match(second.get('harvest').projected.facts.join('\n'), /hours: 2.5 hours/);
    assert.match(second.get('katana').projected.facts.join('\n'), /stock rows: 2 count/);
    assert.match(second.get('katana').projected.facts.join('\n'), /snapshot/);
    const sources = [...second.values()].map(({ projected: p }, i) => ({ ref: `B${i + 1}`, binding: p.hash, dependencies: [p.hash], facts: p.facts, factTimes: p.factTimes, reported: false, provider: p.provider, environment: 'production' }));
    const answer = renderSharedAnswer({ observations: sources.map(s => ({ ref: s.ref, binding: s.binding, factIndex: 0 })), results: [], hypotheses: [], missing_information: [], next_checks: [] },
      { sources, results: [], hypothesesEnabled: true, scopes: new Map([...second.values()].map(({ projected: p }, i) => [`B${i + 1}`, p.scope])) });
    assert.equal(answer.citationIds.length, 3, 'three actual refreshed sources can be cited together; no generated business conclusion is claimed');
    fail = true; await asService(db); for (let i = 0; i < 3; i++) await dueNow(db, connectionId(i));
    assert.equal((await tick()).failed, 3);
    for (const provider of providers) assert.equal((await read(provider)).source_hash, second.get(provider).source_hash, 'failed read cannot change evidence content/freshness');
    await owner(db, ids.other);
    await assert.rejects(db.query('select capture_legacy_evidence_v1($1,$2,$3,$4)', [ids.other, bindings.get('xero'), range.startDate, range.endDate]), /fixture_owner_session_denied/);
    await owner(db, ids.workspace, ids.viewer);
    await assert.rejects(db.query('select capture_legacy_evidence_v1($1,$2,$3,$4)', [ids.workspace, bindings.get('xero'), range.startDate, range.endDate]), /fixture_owner_session_denied/);
    await asService(db);
    await db.query('select disconnect_reporting_connection($1,$2,$3)', [ids.workspace, 'xero', connectionId(0)]);
    await owner(db);
    await assert.rejects(db.query('select reopen_legacy_evidence_v1($1,$2)', [ids.workspace, second.get('xero').reference_id]), /evidence_binding_unavailable/);
    console.log('Reporting composition: 3 providers, 2 successful automatic ticks, 1 failed tick; actual SQL + protected read + typed citation rendering; no hosted provider/model execution.');
  } finally { globalThis.fetch = oldFetch; process.env = oldEnv; await db.close(); }
});
