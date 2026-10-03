/* eslint-disable @typescript-eslint/no-require-imports -- Offline worker/RPC and pg serialization tests. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
const pools = [];
class MockPool {
  constructor() { this.queries = []; this.releases = 0; this.closed = false; pools.push(this); }
  async connect() {
    return { query: async (sql, values) => {
      this.queries.push({ sql, values });
      if (sql.startsWith('select ') && this.failure) throw this.failure;
      return { rows: [{ data: { synthetic: true } }] };
    }, release: () => { this.releases++; } };
  }
  async end() { this.closed = true; }
}
installLoader({ pg: { Pool: MockPool }, './database-config': {
  // TLS configuration has its own suite; this test never creates a real pg pool.
  qboDatabaseConfiguration: () => ({ connectionString: 'synthetic-offline' })
} });
global.fetch = async () => { throw Error('live_network_denied'); };
const { contractSha256, externalSourceFingerprint } = require('../lib/integrations/contracts/canonical.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { qboMinimizedRecordToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { QBO_PRODUCTION_VALIDATOR_VERSION } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const { cleanFullRecompute } = require('../lib/integrations/deterministic/engine.ts');
const { PHASE_3_DEPENDENCY_REGISTRY: registry } = require('../lib/integrations/deterministic/registry.ts');
const { recoverQboProductionAccounting: recover } = require('../services/external-integrations-qbo/src/accounting-recovery.ts');
const { QboProductionDatabase } = require('../services/external-integrations-qbo/src/database.ts');
const at = '2026-09-30T12:00:00.000Z';
const provider = { providerKey: 'quickbooks_online', sourceEnvironment: 'production', realmId: 'synthetic-private-realm' };
function fixture(n, withdrawal = false) {
  const connectionId = id(n), scope = { workspaceId: id(n + 1000), businessEntityId: id(n + 2000) };
  const sourceContext = { ...scope, connectionId, providerKey: 'quickbooks_online', providerEnvironment: 'production' };
  function source(type, raw, ordinal) {
    const record = minimizeQboSourceRecord({ recordType: type, raw: {
      SyncToken: '1', MetaData: { CreateTime: at, LastUpdatedTime: at }, ...raw
    }, provider });
    const pending = qboMinimizedRecordToExternalSourceVersion({ context: sourceContext, record, id: id(n + ordinal),
      immutableVersion: 1, priorVersionId: null, observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
    const valid = { ...pending, validation: { state: 'valid', validatorVersion: QBO_PRODUCTION_VALIDATOR_VERSION, issues: [] } };
    return { ...valid, sourceFingerprint: externalSourceFingerprint(valid) };
  }
  const account = source('Account', { Id: '401', Active: true, AccountType: 'Income' }, 3000);
  const invoice = source('Invoice', { Id: 'synthetic-private-invoice', SyncToken: '1', TxnDate: '2026-09-29',
    CurrencyRef: { value: 'USD' }, TotalAmt: '100.25', GlobalTaxCalculation: 'NotApplicable',
    Line: [{ Id: '1', Amount: '100.25', DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: '301' }, ItemAccountRef: { value: '401' }, TaxCodeRef: { value: 'NON' } } }]
  }, 4000);
  const accountSources = [{ sourceRecordId: id(n + 5000), sourceVersionId: account.id,
    sourceFingerprint: account.sourceFingerprint, version: account }];
  const page = { authorityId: id(n + 6000), connectionGeneration: 1, mappingId: id(n + 7000), mappedAt: at,
    accountContextFingerprint: contractSha256(accountSources), accountSources,
    context: { ...scope, connectionId, realmId: provider.realmId, providerEnvironment: 'production',
      sourceAuthorityPolicyVersionId: id(n + 8000), policyEffectiveFrom: '2026-09-01T00:00:00.000Z',
      accountingBasis: 'accrual', reportingCurrency: 'USD', postingDateFrom: '2026-09-01', postingDateThrough: '2026-09-30', revenueAccountRefs: ['401'] },
    sources: [{ sourceRecordId: id(n + 9000), sourceIdentityFingerprint: externalSourceIdentityFingerprint(invoice),
      sourceVersion: invoice, priorSourceVersion: null, priorFacts: [], factHeads: [] }] };
  const contribution = { id: id(n + 10000), ...scope, eventFingerprint: contractSha256({ event: n }),
    sourceFactFingerprint: contractSha256({ fact: n }), contributionFamilyKey: 'recognized_revenue_transactions',
    contributionFamilyKind: 'additive_transaction', measureKey: 'recognized_revenue', aggregateKey: 'recognized_revenue_actual',
    valueCanonical: '100.25', economicDate: '2026-09-29', periodStart: null, periodEnd: null, dimensions: [],
    accountingBasis: 'accrual', currency: 'USD', observationKind: 'active_additive' };
  const prior = withdrawal ? cleanFullRecompute({ ...scope, contributions: [contribution], registry, asOfDate: '2026-09-30' }).snapshot
    : { ...scope, states: [], watermark: null };
  return { connectionId, page, calculation: { connectionId, authorityId: page.authorityId,
    contributions: withdrawal ? [] : [contribution], prior, asOfDate: '2026-09-30', calculatedAt: at } };
}
function worker(fixtures, claims, response) {
  const calls = [], byConnection = new Map(fixtures.map(value => [value.connectionId, value]));
  return { calls, client: { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (response) { const result = await response(name, args); if (result !== undefined) return result; }
    if (name === 'claim_qbo_accounting_work_v1') return { data: structuredClone(claims), error: null };
    const value = byConnection.get(args.p_connection_id); assert(value, 'unexpected connection');
    if (name === 'read_qbo_accounting_page_v1') {
      assert.equal(args.p_after_source_id, null); assert.equal(args.p_maximum_results, 25);
      return { data: structuredClone(value.page), error: null };
    }
    if (name === 'commit_qbo_accounting_source_v1') return { data: { applicationId: id(30000),
      factVersionIds: args.p_facts.map(fact => fact.id), retractedCount: 0, idempotent: false }, error: null };
    if (name === 'read_qbo_accounting_calculation_v1') return { data: structuredClone(value.calculation), error: null };
    assert.equal(name, 'commit_qbo_accounting_calculation_v1');
    return { data: { state: 'completed', publishedStateCount: args.p_result.states.length, idempotent: false }, error: null };
  } } };
}
const counts = overrides => ({ visitedConnections: 0, appliedSources: 0, calculatedConnections: 0,
  admissionFailures: 0, calculationFailures: 0, ...overrides });

test('worker uses the bounded native fairness claim, processes each row once and reports only counts', async () => {
  const a = fixture(10), b = fixture(11), work = [b, a].map(value => ({ connectionId: value.connectionId, admissionEnabled: true }));
  const m = worker([a, b], work), result = await recover(m.client, 2);
  assert.deepEqual(m.calls[0], { name: 'claim_qbo_accounting_work_v1', args: { p_maximum_connections: 2 } });
  assert.deepEqual(m.calls.filter(call => call.name === 'read_qbo_accounting_page_v1').map(call => call.args.p_connection_id), [b.connectionId, a.connectionId]);
  assert.deepEqual(result, counts({ visitedConnections: 2, appliedSources: 2, calculatedConnections: 2 }));
  assert(m.calls.every(call => !/discover|credential|dispatch|provider/.test(call.name)));
  assert(!JSON.stringify(result).includes('synthetic-private'));
});

test('disabled authority skips all admission RPCs but calculates the real withdrawal', async () => {
  const value = fixture(10, true), m = worker([value], [{ connectionId: value.connectionId, admissionEnabled: false }]);
  assert.deepEqual(await recover(m.client), counts({ visitedConnections: 1, calculatedConnections: 1 }));
  assert.equal(m.calls[0].args.p_maximum_connections, 5);
  assert(!m.calls.some(call => /accounting_page|accounting_source/.test(call.name)));
  const commit = m.calls.find(call => call.name === 'commit_qbo_accounting_calculation_v1').args;
  assert.equal(commit.p_change_set.priorDeterministicWatermark, value.calculation.prior.watermark.watermarkFingerprint);
  assert.equal(commit.p_result.states.length, 2);
  assert(commit.p_result.states.every(state => state.valueCanonical === '0' && state.supportingContributionCount === 0));
});

test('a tenant admission or calculation failure cannot starve the next tenant or expose its error', async () => {
  const a = fixture(10, true), b = fixture(11);
  for (const failure of ['admission', 'calculation', 'both']) {
    const m = worker([a, b], [a, b].map(value => ({ connectionId: value.connectionId, admissionEnabled: true })), (name, args) => {
      if (args.p_connection_id === a.connectionId &&
        ((name === 'read_qbo_accounting_page_v1' && failure !== 'calculation') ||
        (name === 'read_qbo_accounting_calculation_v1' && failure !== 'admission'))) {
        throw Error(`synthetic-private-error-${a.connectionId}`);
      }
    });
    const result = await recover(m.client, 2);
    assert.deepEqual(result, counts({ visitedConnections: 2, appliedSources: failure === 'calculation' ? 2 : 1,
      calculatedConnections: failure === 'admission' ? 2 : 1, admissionFailures: failure === 'calculation' ? 0 : 1,
      calculationFailures: failure === 'admission' ? 0 : 1 }));
    assert(m.calls.some(call => call.name === 'commit_qbo_accounting_calculation_v1' && call.args.p_connection_id === b.connectionId));
    if (failure === 'admission') assert(m.calls.some(call => call.name === 'commit_qbo_accounting_calculation_v1' && call.args.p_connection_id === a.connectionId));
    assert(!JSON.stringify(result).includes(a.connectionId));
  }
});

test('successive worker cycles respect the native claim order without a sticky local cursor', async () => {
  const a = fixture(10), b = fixture(11), claimOrder = [a.connectionId, b.connectionId];
  const m = worker([a, b], [], name => name === 'claim_qbo_accounting_work_v1'
    ? { data: [{ connectionId: claimOrder.shift(), admissionEnabled: false }], error: null } : undefined);
  await recover(m.client, 1); await recover(m.client, 1);
  assert.deepEqual(m.calls.filter(call => call.name === 'read_qbo_accounting_calculation_v1').map(call => call.args.p_connection_id), [a.connectionId, b.connectionId]);
  // Native last-visit scheduling fairness itself requires separately owned database tests.
});

test('maximum 25 connections keeps source reads capped at 25 and visits every claim once', async () => {
  const fixtures = Array.from({ length: 25 }, (_, index) => fixture(index + 10));
  const m = worker(fixtures, fixtures.map(value => ({ connectionId: value.connectionId, admissionEnabled: true })));
  assert.deepEqual(await recover(m.client, 25), counts({ visitedConnections: 25, appliedSources: 25, calculatedConnections: 25 }));
  assert.equal(m.calls.filter(call => call.name === 'read_qbo_accounting_page_v1').length, 25);
});

test('invalid limits fail before claiming work', async () => {
  for (const maximum of [0, 26, -1, 1.5, '5', null, NaN]) {
    const m = worker([], []); await assert.rejects(recover(m.client, maximum)); assert.equal(m.calls.length, 0);
  }
});

test('malformed, duplicate, oversized and failed claims reject before tenant processing', async () => {
  const row = { connectionId: id(10), admissionEnabled: true };
  for (const data of [null, {}, [row, row], [row, { ...row, connectionId: id(11) }, { ...row, connectionId: id(12) }],
    [row, { connectionId: 'invalid', admissionEnabled: true }], [{ connectionId: id(10) }],
    [{ ...row, admissionEnabled: 'false' }], [{ ...row, realmId: 'private' }]]) {
    const m = worker([], data); await assert.rejects(recover(m.client, 2)); assert.equal(m.calls.length, 1);
  }
  const m = worker([], [], () => ({ data: [row], error: { code: '42501', message: 'private' } }));
  await assert.rejects(recover(m.client), { message: 'qbo_accounting_work_claim_failed' });
  assert.equal(m.calls.length, 1);
  assert.deepEqual(await recover(worker([], []).client), counts());
});

test('named JSONB p_facts/p_nodes are JSON strings; reason_codes and unrelated arrays remain native', async () => {
  const db = new QboProductionDatabase('synthetic', ['integration_provider_source_authority'], 'synthetic');
  const pool = pools.at(-1), client = db.role('integration_provider_source_authority');
  for (const [name, key] of [['commit_qbo_accounting_source_v1', 'p_facts'], ['commit_qbo_accounting_calculation_v1', 'p_nodes']]) {
    for (const payload of [[], [{ id: id(10), value: '0.100000001', dimensions: ['one', 'two'] }]]) {
      const reasons = ['synthetic_reason_one', 'synthetic_reason_two'], other = ['native-array'];
      const args = { p_reason_codes: reasons, [key]: payload, p_other: other, p_result: { states: [] } };
      assert.deepEqual(await client.rpc(name, args), { data: { synthetic: true }, error: null });
      const query = pool.queries.filter(row => row.sql.startsWith('select ')).at(-1);
      assert.equal(query.sql, `select public.${name}(p_reason_codes => $1, ${key} => $2, p_other => $3, p_result => $4) as data`);
      assert.strictEqual(query.values[0], reasons);
      assert.equal(typeof query.values[1], 'string'); assert.deepEqual(JSON.parse(query.values[1]), payload);
      assert.strictEqual(query.values[2], other); assert.strictEqual(query.values[3], args.p_result);
      assert.deepEqual(args[key], payload);
    }
  }
  const untouched = ['native']; await client.rpc('unrelated_rpc_v1', { p_facts: untouched, p_nodes: untouched });
  const unrelated = pool.queries.filter(row => row.sql.startsWith('select ')).at(-1);
  assert.strictEqual(unrelated.values[0], untouched); assert.strictEqual(unrelated.values[1], untouched);
  assert.equal(pool.releases, 5);
  await db.close(); assert.equal(pool.closed, true);
});

test('mock pg failures roll back and release with a redacted result', async () => {
  const db = new QboProductionDatabase('synthetic', ['integration_provider_source_authority'], 'synthetic');
  const pool = pools.at(-1); pool.failure = Object.assign(Error('synthetic-private-database-error'), { code: '40001' });
  assert.deepEqual(await db.role('integration_provider_source_authority').rpc('commit_qbo_accounting_calculation_v1', { p_nodes: [] }),
    { data: null, error: { code: '40001', message: 'qbo_production_database_rpc_failed' } });
  assert.equal(pool.queries.at(-1).sql, 'rollback'); assert.equal(pool.releases, 1); await db.close();
});
