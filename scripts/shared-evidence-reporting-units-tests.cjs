/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic offline extraction, contracts and server-rendered view; no credentials or external calls. */
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');

let networkAttempts = 0, transportReads = 0, rpcReads = 0, negativeCases = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('unmocked_network_forbidden'); };
global.fetch = denyNetwork;
require('node:net').Socket.prototype.connect = denyNetwork;
const day = '2026-10-14', observedAt = '2026-10-15T12:00:00.000Z';
const workspace = id(1), entity = id(2), connection = id(3);
const invoice = (n, Type, CurrencyCode, Total, AmountDue) => ({ InvoiceID: id(n), DateString: `${day}T00:00:00`, Type, Status: 'AUTHORISED', CurrencyCode, Total, AmountDue });
const xeroInput = [invoice(10, 'ACCREC', 'USD', 234, 123.45), invoice(11, 'ACCPAY', 'USD', 12.34, 12.34),
  invoice(12, 'ACCREC', 'EUR', 0, 0), invoice(13, 'ACCPAY', 'EUR', 78.90, 0)];
const providerInputs = JSON.stringify(xeroInput);
// Only the reporting transport is replaced: provider extraction/validation stays real.
installLoader({ 'server-only': {}, './transport': { reader(base, headers, signal) {
  assert(signal instanceof AbortSignal);
  assert(Object.values(headers).some(value => String(value).includes('synthetic-offline-token')));
  return async (route, query = {}) => {
    transportReads++;
    if (base === 'https://api.xero.com/api.xro/2.0' && route === '/Invoices') {
      assert.equal(query.page, '1'); return { Invoices: structuredClone(xeroInput) };
    }
    if (base === 'https://api.harvestapp.com/v2' && route === '/time_entries') return {
      time_entries: [{ id: 'completed', spent_date: day, hours: 1.25, billable: true, is_running: false },
        { id: 'running', spent_date: day, hours: 0, billable: false, is_running: true }],
      next_page: null, page: 1, total_entries: 2
    };
    if (base === 'https://api.clockify.me/api/v1' && route === '/workspaces/synthetic/user/owner/time-entries') return [
      { id: 'completed', billable: true, timeInterval: { start: `${day}T10:00:00Z`, end: `${day}T10:01:01Z` } },
      { id: 'running', billable: false, timeInterval: { start: `${day}T11:00:00Z`, end: null } }
    ];
    if (base === 'https://www.zohoapis.com/inventory/v1' && route === '/items') return {
      code: 0, items: query.filter_by === 'ItemType.Inventory' ? [{ item_id: 'item', status: 'active', item_type: 'inventory' }] : [],
      page_context: { has_more_page: false }
    };
    if (base === 'https://focus.toggl.com/api' && route === '/organizations/1/workspaces/synthetic/projects') return {
      data: [{ id: 'project', total_tracked_secs: 4500 }], total: 1, page: 1
    };
    if (base === 'https://api.katanamrp.com/v1' && route === '/inventory') return {
      data: [{ variant_id: 'variant', location_id: 'location', quantity_in_stock: '1.5', quantity_committed: '0.5' }]
    };
    throw new Error(`unexpected_mock_transport:${base}${route}`);
  };
} } });

const reporting = require('../lib/integrations/reporting/adapters.ts');
const { resolveImportRange } = require('../lib/integrations/date-range.ts');
const { parseReportingHistory, parseReportingSnapshot, reportingMetricSemantics } = require('../lib/ai/shared-evidence/adapters.ts');
const { sharedRow, sharedTargetHref } = require('../lib/ai/shared-evidence/generation.ts');
const { renderSharedAnswer, sharedAnswerSchema, SharedAnswerContractError } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
const { evidenceEngineHash } = require('../lib/ai/evidence-engine/hash.ts');
const { withVsiSourceSnapshot } = require('../lib/vsi/research.ts');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { AnswerContent } = require('../components/vsi/AnswerContent.tsx');
const definitions = {
  xero: { kind: 'history', units: { invoices: 'count', billed: 'currency', outstanding: 'currency', bills: 'count', purchases: 'currency' } },
  harvest: { kind: 'history', units: { entries: 'count', hours: 'hours', billable_hours: 'hours', running: 'count' } },
  clockify: { kind: 'history', units: { entries: 'count', hours: 'hours', billable_hours: 'hours', running: 'count' } },
  'zoho-inventory': { kind: 'snapshot', units: { items: 'count', low_stock: 'count' } },
  toggl: { kind: 'snapshot', units: { projects: 'count', hours: 'hours' } },
  katana: { kind: 'snapshot', units: { stock_rows: 'count', unavailable: 'count' } }
};
const context = provider => ({ workspaceId: workspace, connectionId: connection, entityId: entity, entityBinding: 'protected',
  scopeKey: 'synthetic-reporting', scopeVerified: true, start: day, end: day, timeZone: 'UTC', observedAt, currency: null,
  sourceId: provider, version: 'synthetic-version', href: `/app/sources/${provider}`, coverage: 'complete', lifecycle: 'active' });
const historyReport = metrics => ({ hasHistory: true, metrics, records: 1, coverage: { days: 1, completeDays: 1, incompleteDays: 0,
  coveredThrough: '2026-10-15T00:00:00.000Z', startDate: day, endDate: day, lastImportedAt: observedAt } });
const snapshotReport = metrics => ({ start: observedAt, end: observedAt, metrics });
const rawSource = (provider, records, n = 0) => ({ identity: { kind: 'legacy_reference', reference_id: id(100 + n) },
  hash: evidenceEngineHash({ provider, records }), data: { provider, workspace_id: workspace, entity_id: entity, connection_id: connection,
    period_start: day, period_end: day, time_zone: 'UTC', scope: 'synthetic reporting originals', coverage: 'partial', records,
    read_sources: [{ table: 'reporting_connections', id: connection }], eligibility: { internal: 'synthetic-not-for-display' } } });
const recordsFor = (kind, metrics) => kind === 'history' ? [{ day, metrics }] : [{ snapshot: snapshotReport(metrics) }];
const typed = (provider, kind, metrics) => kind === 'history'
  ? parseReportingHistory(provider, historyReport(metrics), context(provider))
  : parseReportingSnapshot(provider, snapshotReport(metrics), context(provider));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function denied(run) { assert.throws(run); negativeCases++; }
function invalidMetric(provider, kind, metric) {
  denied(() => reportingMetricSemantics(provider, metric, kind));
  denied(() => typed(provider, kind, [metric]));
  denied(() => sharedRow(rawSource(provider, recordsFor(kind, [metric])), workspace));
}

(async () => {
  const now = new Date(observedAt), range = resolveImportRange(day, day, now), extracted = [];
  for (const [provider, definition] of Object.entries(definitions)) {
    const account = { id: provider === 'katana' ? 'key-account' : 'synthetic', name: 'Synthetic account',
      ...(provider === 'clockify' ? { user: 'owner' } : {}), ...(provider === 'toggl' ? { parent: '1' } : {}) };
    const signal = new AbortController().signal;
    const records = definition.kind === 'history'
      ? (await reporting.importHistory(provider, 'synthetic-offline-token', account, signal, range, now)).records
      : [{ snapshot: await reporting.snapshot(provider, 'synthetic-offline-token', account, signal, now) }];
    extracted.push({ provider, definition, records });
  }
  assert.equal(JSON.stringify(xeroInput), providerInputs);
  assert.deepEqual(extracted[0].records[0].metrics, [
    { key: 'invoices', value: 1, currency: 'USD' }, { key: 'billed', value: 234, currency: 'USD' },
    { key: 'outstanding', value: 123.45, currency: 'USD' }, { key: 'bills', value: 0, currency: 'USD' },
    { key: 'purchases', value: 0, currency: 'USD' }
  ]);
  assert.deepEqual(extracted[0].records[1].metrics.map(metric => metric.value), [0, 0, 0, 1, 12.34]);
  assert.deepEqual(extracted[0].records[2].metrics.map(metric => metric.value), [1, 0, 0, 0, 0]);
  assert.deepEqual(extracted[0].records[3].metrics.map(metric => metric.value), [0, 0, 0, 1, 78.9]);

  const originals = extracted.map(({ provider, records }, index) => freeze(rawSource(provider, records, index)));
  const before = originals.map(value => JSON.stringify(value));
  const rows = originals.map(raw => sharedRow(raw, workspace));
  let observationsCompared = 0;
  for (const [index, { provider, definition, records }] of extracted.entries()) {
    const row = rows[index], expectedFacts = [];
    for (const record of records) {
      const metrics = record.snapshot?.metrics ?? record.metrics;
      const parsed = typed(provider, definition.kind, metrics);
      assert.deepEqual(parsed.observations.map(value => value.metric), metrics.map(value => value.key));
      for (const [metricIndex, metric] of metrics.entries()) {
        const observation = parsed.observations[metricIndex], unit = definition.units[metric.key];
        const currency = unit === 'currency' ? metric.currency : null, partition = provider === 'xero' ? metric.currency : null;
        assert.deepEqual([observation.unit, observation.currency, observation.partition], [unit, currency, partition]);
        assert.equal(observation.value, String(metric.value));
        assert.equal(observation.dependencies[0].version, 'synthetic-version');
        assert.equal(observation.dependencies[0].href, `/app/sources/${provider}`);
        const renderedUnit = currency ?? unit;
        const partitionText = unit === 'count' && partition ? ` (currency partition: ${partition})` : '';
        const dateText = record.snapshot ? `snapshot ${record.snapshot.start} through ${record.snapshot.end}` : `recorded ${record.day}`;
        expectedFacts.push(`${provider.replace(/[_-]/g, ' ')} ${metric.key.replace(/[_-]/g, ' ')}: ${metric.value} ${renderedUnit}${partitionText}; ${dateText}. Scope: synthetic reporting originals.`);
        if (definition.kind === 'snapshot') assert.equal(observation.temporalKind, provider === 'toggl' && metric.key === 'hours' ? 'lifetime' : 'snapshot');
        observationsCompared++;
      }
    }
    assert.deepEqual(row.facts, expectedFacts, 'facts preserve record/key order and exact typed units');
    assert.equal(row.hash, originals[index].hash);
    assert.deepEqual(row.identity, originals[index].identity);
    assert.deepEqual(row.data, originals[index].data);
    assert.deepEqual(row.roots, originals[index].data.read_sources);
  }
  assert.equal(observationsCompared, 42);
  const xero = rows[0];
  assert.match(xero.facts[0], /invoices: 1 count \(currency partition: USD\)/);
  assert.match(xero.facts[1], /billed: 234 USD;/);
  assert.match(xero.facts[2], /outstanding: 123\.45 USD;/);
  assert.match(xero.facts[8], /bills: 1 count \(currency partition: USD\)/);
  assert.match(xero.facts[10], /invoices: 1 count \(currency partition: EUR\)/);
  assert.match(xero.facts[19], /purchases: 78\.9 EUR;/);
  assert.doesNotMatch(xero.facts.join('\n'), /(?:invoices|bills): [\d.]+ (?:USD|EUR);/);
  const partitions = parseReportingHistory('xero', historyReport([extracted[0].records[0].metrics[0], extracted[0].records[2].metrics[0]]), context('xero')).observations;
  assert.deepEqual(partitions.map(value => [value.value, value.unit, value.currency, value.partition]), [['1', 'count', null, 'USD'], ['1', 'count', null, 'EUR']]);
  assert.notEqual(partitions[0].id, partitions[1].id);

  const sources = rows.map((row, index) => ({ ref: `B${index + 1}`, binding: row.hash, dependencies: [row.hash], facts: row.facts,
    provider: row.provider, reported: false, environment: 'production' }));
  const answer = { observations: sources.flatMap(source => source.facts.map((_, factIndex) => ({ ref: source.ref, binding: source.binding, factIndex }))),
    results: [], hypotheses: [], missing_information: [], next_checks: [] };
  const renderContext = { sources, results: [], hypothesesEnabled: false, scopes: new Map(rows.map((row, index) => [sources[index].ref, row.scope])) };
  const rendered = renderSharedAnswer(answer, renderContext);
  const markup = renderToStaticMarkup(React.createElement(AnswerContent, { content: rendered.content }));
  for (const row of rows) for (const fact of row.facts) { assert(rendered.content.includes(fact)); assert(markup.includes(fact)); }
  assert.deepEqual(rendered.citationIds, sources.map(source => source.ref));
  assert.doesNotMatch(markup, /(?:invoices|bills): [\d.]+ (?:USD|EUR);/);
  const citation = { id: 'B1', title: 'Synthetic Xero', url: sharedTargetHref(workspace, 'vsi_exchange', id(50), xero.hash),
    sourceType: 'shared_xero', sourceId: xero.hash, evidenceDate: day, retrievedAt: observedAt };
  const snapshotText = facts => JSON.stringify({ scope: xero.scope, observations: facts });
  const currentSnapshot = withVsiSourceSnapshot({ ...citation, text: snapshotText(xero.facts) });
  const oldUnitFacts = xero.facts.map(fact => fact.replace(/ count \(currency partition: ([A-Z]{3})\)/g, ' $1'));
  const oldDisplaySnapshot = withVsiSourceSnapshot({ ...citation, text: snapshotText(oldUnitFacts) });
  assert.notEqual(currentSnapshot.snapshotHash, oldDisplaySnapshot.snapshotHash, 'corrected display has a fresh text snapshot');
  assert.equal(currentSnapshot.sourceId, oldDisplaySnapshot.sourceId);
  assert.equal(currentSnapshot.url, oldDisplaySnapshot.url);
  assert(currentSnapshot.url.endsWith(`#source-${xero.hash}`));

  const target = { workspaceId: workspace, kind: 'vsi_exchange', id: id(50), revision: 'a'.repeat(64) };
  const packet = { stage: 'revalidated_saved_evidence', artifact_kind: target.kind, artifact_id: target.id, artifact_revision: target.revision, projections: originals };
  const reopened = await reopenSharedCitation({ rpc: async (name, args) => {
    rpcReads++; assert.equal(name, 'reopen_shared_evidence_artifact_v1');
    assert.deepEqual(args, { p_workspace_id: workspace, p_artifact_kind: target.kind, p_artifact_id: target.id, p_expected_revision: target.revision });
    return { data: packet, error: null };
  } }, target);
  for (const [index, source] of reopened.entries()) {
    const expected = structuredClone(originals[index].data); delete expected.eligibility; delete expected.read_sources;
    assert.deepEqual(JSON.parse(source.text), expected, 'reopen retains exact raw numeric metrics and currency partitions');
    assert.equal(source.hash, originals[index].hash); assert.deepEqual(source.identity, originals[index].identity);
    assert.doesNotMatch(source.text, /synthetic-not-for-display|read_sources/);
  }
  assert.equal(reopened.length, 6); assert.equal(rpcReads, 1);
  assert.deepEqual(originals.map(value => JSON.stringify(value)), before, 'extraction, rendering and reopen do not mutate originals');

  for (const [provider, definition] of Object.entries(definitions)) {
    const currency = provider === 'xero' ? { currency: 'USD' } : {};
    invalidMetric(provider, definition.kind, { key: 'unknown_metric', value: 1, ...currency });
    if (provider !== 'xero') invalidMetric(provider, definition.kind, { key: Object.keys(definition.units)[0], value: 1, currency: 'USD' });
    for (const [key, unit] of Object.entries(definition.units)) if (unit === 'count') {
      for (const value of ['1.5', '1.000000000000000000000001', '-1']) invalidMetric(provider, definition.kind, { key, value, ...currency });
      const integerDecimal = { key, value: '1.0', ...currency };
      assert.equal(reportingMetricSemantics(provider, integerDecimal, definition.kind).unit, 'count');
      assert.match(sharedRow(rawSource(provider, recordsFor(definition.kind, [integerDecimal])), workspace).facts[0], /: 1\.0 count/);
    }
  }
  for (const provider of ['not-a-provider', 'constructor', '__proto__']) invalidMetric(provider, 'history', { key: 'invoices', value: 1, currency: 'USD' });
  invalidMetric('xero', 'snapshot', { key: 'invoices', value: 1, currency: 'USD' });
  invalidMetric('toggl', 'history', { key: 'projects', value: 1 });
  invalidMetric('xero', 'history', { key: 'invoices', value: 1 });
  for (const currency of ['usd', 'US', 'USD count', '', null]) invalidMetric('xero', 'history', { key: 'billed', value: 234, currency });
  for (const value of ['234 USD', '1e2', 'NaN', 'Infinity', '', null, -0.01, NaN, Infinity]) invalidMetric('xero', 'history', { key: 'billed', value, currency: 'USD' });
  const preciseMoney = { key: 'billed', value: '234.123456789012345678901234', currency: 'USD' };
  assert.equal(typed('xero', 'history', [preciseMoney]).observations[0].value, preciseMoney.value);
  assert(sharedRow(rawSource('xero', recordsFor('history', [preciseMoney])), workspace).facts[0].includes(`${preciseMoney.value} USD`));
  denied(() => sharedRow(originals[0], id(99)));
  await assert.rejects(reopenSharedCitation({ rpc: async () => ({ data: packet, error: null }) }, { ...target, workspaceId: id(99) }), /workspace_mismatch/); negativeCases++;
  await assert.rejects(reopenSharedCitation({ rpc: async () => ({ data: null, error: { code: '42501' } }) }, target), /unavailable/); negativeCases++;
  await assert.rejects(reopenSharedCitation({ rpc: async () => ({ data: { ...packet, artifact_revision: 'b'.repeat(64) }, error: null }) }, target)); negativeCases++;
  for (const [change, reason] of [[{ binding: 'f'.repeat(64) }, 'binding_mismatch'], [{ ref: 'B999' }, 'unknown_ref'], [{ factIndex: xero.facts.length }, 'fact_index_out_of_bounds']]) {
    assert.throws(() => renderSharedAnswer({ ...answer, observations: [{ ...answer.observations[0], ...change }, ...answer.observations.slice(1)] }, renderContext),
      error => error instanceof SharedAnswerContractError && error.rule === 'fact_reference' && error.factReference.reason === reason); negativeCases++;
  }
  assert.equal(sharedAnswerSchema.safeParse({ ...answer, observations: [{ ...answer.observations[0], binding: `sha256:${xero.hash}` }] }).success, false); negativeCases++;
  assert.throws(() => renderSharedAnswer(answer, { ...renderContext, sources: sources.map((source, index) => index ? source : { ...source, dependencies: [] }) }),
    error => error instanceof SharedAnswerContractError && error.factReference.reason === 'source_dependencies_missing'); negativeCases++;
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, providers: Object.keys(definitions), observationsCompared, negativeCases, mockTransportReads: transportReads,
    positiveMockCitationReads: rpcReads, realReportingExtraction: true, actualSSR: true, rawIdentityHashAndOrderPreserved: true, strictBindingsPreserved: true,
    countCurrencyPartitionsPreserved: true, externalCalls: 0, paidCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
