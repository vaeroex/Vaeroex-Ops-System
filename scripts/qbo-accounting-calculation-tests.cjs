/* eslint-disable @typescript-eslint/no-require-imports -- Offline RPC tests exercise the real deterministic engine. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
installLoader();
global.fetch = async () => { throw Error('live_network_denied'); };
const { contractSha256 } = require('../lib/integrations/contracts/canonical.ts');
const { cleanFullRecompute } = require('../lib/integrations/deterministic/engine.ts');
const { PHASE_3_DEPENDENCY_REGISTRY: registry } = require('../lib/integrations/deterministic/registry.ts');
const { prepareQboAccountingCalculation: prepare, calculateQboAccounting: calculate } =
  require('../lib/integrations/persistence/qbo-accounting-calculation-repository.ts');
const scope = { workspaceId: id(1), businessEntityId: id(2) };
const at = '2026-09-30T12:00:00.000Z';
function contribution(n, valueCanonical = '100.25', overrides = {}) {
  const value = { id: id(n), ...scope, sourceFactFingerprint: contractSha256({ fact: n }),
    contributionFamilyKey: 'recognized_revenue_transactions', contributionFamilyKind: 'additive_transaction',
    measureKey: 'recognized_revenue', aggregateKey: 'recognized_revenue_actual', valueCanonical,
    economicDate: '2026-09-29', periodStart: null, periodEnd: null, dimensions: [], accountingBasis: 'accrual',
    currency: 'USD', observationKind: 'active_additive', ...overrides };
  return { ...value, eventFingerprint: contractSha256(value) };
}
function input(contributions = [contribution(10)], prior = { ...scope, states: [], watermark: null }) {
  return { connectionId: id(3), authorityId: id(4), contributions, prior, asOfDate: '2026-09-30', calculatedAt: at };
}
function snapshot(value) {
  return cleanFullRecompute({ ...scope, contributions: value.contributions, registry,
    asOfDate: value.asOfDate, scopeHints: value.prior.states }).snapshot;
}
function mock(value, respond) {
  const calls = [];
  return { calls, client: { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (respond) { const response = await respond(name, args); if (response !== undefined) return response; }
    if (name === 'read_qbo_accounting_calculation_v1') return { data: structuredClone(value), error: null };
    assert.equal(name, 'commit_qbo_accounting_calculation_v1');
    return { data: { state: 'completed', publishedStateCount: args.p_result.states.length, idempotent: false }, error: null };
  } } };
}
const commits = m => m.calls.filter(call => call.name === 'commit_qbo_accounting_calculation_v1');
const keys = nodes => nodes.map(node => node.nodeKey).sort();
const affectedKeys = ['recognized_revenue_month_total', 'revenue', 'business_health_revenue_invalidation',
  'deterministic_revenue_risk_invalidation', 'deterministic_revenue_opportunity_invalidation', 'snapshot_revenue_invalidation'].sort();

test('admitted contribution amounts feed real cleanFull states and bound commit arguments', async () => {
  const value = input([contribution(10, '100.25'), contribution(11, '-20.05')]);
  const command = prepare(value, id(100)), full = snapshot(value);
  assert.deepEqual(command.result.states, full.states);
  assert.deepEqual(command.result.states.map(state => state.valueCanonical), ['80.2', '80.2']);
  assert.equal(command.result.resultWatermark, full.watermark.watermarkFingerprint);
  assert.equal(command.result.resultStateFingerprint, full.watermark.stateFingerprint);
  assert.equal(command.changeSet.executionMode, 'clean_full');
  assert.deepEqual(keys(command.nodes), affectedKeys);
  assert(command.nodes.every(node => node.changeSetId === id(100) && node.workspaceId === scope.workspaceId));
  const m = mock(value), result = await calculate(value.connectionId, m.client), args = commits(m)[0].args;
  assert.deepEqual(m.calls[0], { name: 'read_qbo_accounting_calculation_v1', args: { p_connection_id: value.connectionId } });
  assert.equal(args.p_authority_id, value.authorityId);
  assert.equal(args.p_connection_id, value.connectionId);
  assert.equal(args.p_result.changeSetId, args.p_change_set.id);
  assert.equal(args.p_result.inputContributionFingerprint, args.p_change_set.inputContributionFingerprint);
  assert.deepEqual(args.p_result.states, full.states);
  assert.deepEqual(result, { state: 'completed', publishedStateCount: 2, idempotent: false });
});

test('decimal arithmetic is exact beyond Number precision and never combines currencies or months', () => {
  const value = input([contribution(10, '9007199254740993.1'), contribution(11, '0.2'), contribution(12, '-0.1'),
    contribution(13, '0.000000001'), contribution(14, '7.03', { currency: 'EUR' }),
    contribution(15, '4.5', { economicDate: '2026-08-20' })]);
  const command = prepare(value), revenue = command.result.states.filter(state => state.nodeKey === 'revenue');
  assert.equal(revenue.length, 3);
  for (const [currency, periodStart, amount, count] of [
    ['USD', '2026-09-01', '9007199254740993.200000001', 4], ['EUR', '2026-09-01', '7.03', 1],
    ['USD', '2026-08-01', '4.5', 1]
  ]) {
    const state = revenue.find(row => row.scope.currency === currency && row.scope.periodStart === periodStart);
    assert.equal(state.valueCanonical, amount);
    assert.equal(state.supportingContributionCount, count);
    assert.equal(state.scope.accountingBasis, 'accrual');
  }
});

test('withdrawal publishes explicit zero states and reconsent uses the withdrawal predecessor', () => {
  const initial = input(), admitted = snapshot(initial);
  const withdrawnInput = input([], admitted), withdrawn = prepare(withdrawnInput, id(101));
  assert.equal(withdrawn.changeSet.priorDeterministicWatermark, admitted.watermark.watermarkFingerprint);
  assert.equal(withdrawn.changeSet.priorStateFingerprint, admitted.watermark.stateFingerprint);
  assert.equal(withdrawn.result.states.length, 2);
  assert(withdrawn.result.states.every(state => state.valueCanonical === '0' && state.supportingContributionCount === 0));
  assert.deepEqual(keys(withdrawn.nodes), affectedKeys);
  const empty = snapshot(withdrawnInput);
  assert.equal(prepare(input([], empty)), null);
  const reconsentInput = { ...input([contribution(12)], empty), authorityId: id(44) };
  const restored = prepare(reconsentInput, id(102));
  assert.equal(restored.authorityId, id(44));
  assert.equal(restored.changeSet.priorDeterministicWatermark, withdrawn.result.resultWatermark);
  assert.equal(restored.changeSet.priorStateFingerprint, withdrawn.result.resultStateFingerprint);
  assert(restored.result.states.every(state => state.valueCanonical === '100.25' && state.supportingContributionCount === 1));
  assert.notEqual(restored.changeSet.changeSetFingerprint, withdrawn.changeSet.changeSetFingerprint);
});

test('only changed currency/month dependency nodes are dirtied while other states remain intact', () => {
  const original = input([contribution(10), contribution(11, '7', { currency: 'EUR' }),
    contribution(12, '8', { economicDate: '2026-08-20' })]);
  const prior = snapshot(original), next = [...original.contributions];
  next[0] = contribution(20, '101.25');
  const command = prepare(input(next, prior));
  assert.deepEqual(keys(command.nodes), affectedKeys);
  assert(command.nodes.every(node => node.scope.currency === 'USD' && node.scope.periodStart === '2026-09-01'));
  assert.equal(new Set(command.nodes.map(node => node.nodeIdentityFingerprint)).size, command.nodes.length);
  for (const state of prior.states.filter(row => row.scope.currency === 'EUR' || row.scope.periodStart === '2026-08-01')) {
    assert.deepEqual(command.result.states.find(row => row.nodeIdentityFingerprint === state.nodeIdentityFingerprint), state);
  }
});

test('input order and calculation ID do not change semantic fingerprints; unchanged replay skips commit', async () => {
  const value = input([contribution(10, '0.1'), contribution(11, '0.2')]);
  const first = prepare(value, id(100)), reverse = prepare({ ...value, contributions: [...value.contributions].reverse() }, id(101));
  assert.equal(first.changeSet.changeSetFingerprint, reverse.changeSet.changeSetFingerprint);
  assert.equal(first.result.resultWatermark, reverse.result.resultWatermark);
  const replay = input(value.contributions, snapshot(value)), m = mock(replay);
  assert.equal(prepare(replay), null);
  assert.deepEqual(await calculate(replay.connectionId, m.client), { state: 'completed', publishedStateCount: 0, idempotent: true });
  assert.equal(commits(m).length, 0);
});

for (const [label, mutate] of [
  ['workspace', value => { value.contributions[0].workspaceId = id(99); }],
  ['business entity', value => { value.contributions[0].businessEntityId = id(99); }],
  ['duplicate contribution', value => { value.contributions.push(structuredClone(value.contributions[0])); }],
  ['duplicate fingerprint', value => { value.contributions.push({ ...value.contributions[0], id: id(99) }); }],
  ['cash basis', value => { value.contributions[0].accountingBasis = 'cash'; }],
  ['missing currency', value => { value.contributions[0].currency = null; }],
  ['numeric amount', value => { value.contributions[0].valueCanonical = 100.25; }],
  ['noncanonical decimal', value => { value.contributions[0].valueCanonical = '100.250'; }],
  ['unknown family', value => { value.contributions[0].contributionFamilyKey = 'provider_report'; }],
  ['control report', value => { Object.assign(value.contributions[0], { contributionFamilyKind: 'control_observation', observationKind: 'control_observation' }); }],
  ['raw provider data', value => { value.sources = [{ TotalAmt: '999' }]; }]
]) {
  test(`invalid ${label} fails before any calculation commit`, async () => {
    const value = input(); mutate(value); const m = mock(value);
    await assert.rejects(calculate(value.connectionId, m.client));
    assert.equal(commits(m).length, 0);
  });
}

test('wrong connection and failed native read/commit fail closed without retry', async () => {
  const value = input(), mismatch = mock({ ...value, connectionId: id(99) });
  await assert.rejects(calculate(value.connectionId, mismatch.client), /connection_mismatch/);
  assert.equal(commits(mismatch).length, 0);
  for (const stage of ['read', 'commit']) {
    const m = mock(value, name => name === `${stage}_qbo_accounting_calculation_v1`
      ? { data: null, error: { code: '40001', message: 'synthetic-sensitive-detail' } } : undefined);
    await assert.rejects(calculate(value.connectionId, m.client), { message: `qbo_accounting_calculation_${stage}_failed` });
    assert.equal(commits(m).length, stage === 'read' ? 0 : 1);
  }
});

test('malformed or non-completed commit receipts cannot report success', async () => {
  for (const receipt of [null, { state: 'failed', publishedStateCount: 0, idempotent: false },
    { state: 'completed', publishedStateCount: -1, idempotent: false },
    { state: 'completed', publishedStateCount: 10001, idempotent: false },
    { state: 'completed', publishedStateCount: 2, idempotent: 'false' },
    { state: 'completed', publishedStateCount: 2, idempotent: false, connectionId: id(99) }]) {
    const value = input(), m = mock(value, name => name.startsWith('commit_') ? { data: receipt, error: null } : undefined);
    await assert.rejects(calculate(value.connectionId, m.client));
    assert.equal(commits(m).length, 1);
  }
});

test('unchanged-input shortcut must still reject a cross-workspace contribution', async () => {
  const valid = input(), value = input(valid.contributions, snapshot(valid));
  value.contributions[0].workspaceId = id(99);
  const m = mock(value);
  await assert.rejects(calculate(value.connectionId, m.client));
  assert.equal(commits(m).length, 0);
});

test('stale aggregate rows reject even when the contribution watermark matches unchanged input', async () => {
  const valid = input(), value = input(valid.contributions, snapshot(valid));
  value.prior.states.find(state => state.nodeKind === 'aggregate').valueCanonical = '999';
  const m = mock(value);
  await assert.rejects(calculate(value.connectionId, m.client), { message: 'qbo_accounting_calculation_head_mismatch' });
  assert.equal(commits(m).length, 0);
});

test('foreign prior states cannot become local withdrawal scope hints', async () => {
  const prior = snapshot(input());
  for (const state of prior.states) state.businessEntityId = id(99);
  const value = input([], prior), m = mock(value);
  await assert.rejects(calculate(value.connectionId, m.client));
  assert.equal(commits(m).length, 0);
});

test('non-idempotent commit count must match the states submitted for publication', async () => {
  const value = input(), m = mock(value, name => name.startsWith('commit_')
    ? { data: { state: 'completed', publishedStateCount: 0, idempotent: false }, error: null } : undefined);
  await assert.rejects(calculate(value.connectionId, m.client));
  assert.equal(commits(m).length, 1);
});
