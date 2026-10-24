/* eslint-disable @typescript-eslint/no-require-imports -- Pure synthetic contracts; no provider or database calls. */
const assert = require('node:assert/strict');
const { loadSource } = require('./integrations-ui-test-support');
const adapters = loadSource('lib/ai/shared-evidence/adapters.ts');
const { dependency, pluginProviders } = loadSource('lib/ai/shared-evidence/contracts.ts');
const { relationship, aggregateSquarePayments, selectEvidenceGroups } = loadSource('lib/ai/shared-evidence/relationships.ts');
const { projectSharedEvidence } = loadSource('lib/ai/shared-evidence/projections.ts');
const workspaceId = '00000000-0000-4000-8000-000000000001';
const context = (id, extra = {}) => ({ workspaceId, connectionId: '00000000-0000-4000-8000-000000000002',
  entityId: '00000000-0000-4000-8000-000000000003', entityBinding: 'protected', scopeKey: 'entity-all-operations', scopeVerified: true,
  start: '2026-09-01', end: '2026-09-30', timeZone: 'UTC', observedAt: '2026-10-01T00:00:00Z', currency: 'USD',
  sourceId: id, version: 'fixture-v1', href: `/app/sources/${id}`, coverage: 'complete', lifecycle: 'active', ...extra });
const history = (metrics) => ({ hasHistory: true, metrics, records: 1, coverage: { days: 30, completeDays: 30, incompleteDays: 0,
  coveredThrough: '2026-10-01T00:00:00Z', startDate: '2026-09-01', endDate: '2026-09-30', lastImportedAt: '2026-10-01T00:00:00Z' } });
const snapshot = metrics => ({ start: '2026-09-30T00:00:00Z', end: '2026-09-30T00:00:00Z', metrics });
const parsed = {
  google_sheets: adapters.parseCanonicalMetrics('google_sheets', [{ metric: 'waste_kg', value: '160', unit: 'kg' }], context('sheets')),
  quickbooks_online: adapters.parseQuickBooksTotals({ basis: 'accrual', truncated: false, totals: { revenue: '12000', grossProfit: '3600' } }, context('qbo')),
  square: adapters.parseSquarePayments([{ id: 'p1', amount: '6000', currency: 'USD', status: 'COMPLETED' },
    { id: 'p2', amount: '4000', currency: 'USD', status: 'COMPLETED' }], context('square')),
  harvest: adapters.parseReportingHistory('harvest', history([{ key: 'hours', value: 250 }]), context('harvest', { currency: null })),
  clockify: adapters.parseReportingHistory('clockify', history([{ key: 'hours', value: 50 }]), context('clockify', { currency: null, scopeKey: 'connected-user-only' })),
  xero: adapters.parseReportingHistory('xero', history([{ key: 'billed', value: 400, currency: 'USD' }]), context('xero')),
  'zoho-inventory': adapters.parseReportingSnapshot('zoho-inventory', snapshot([{ key: 'items', value: 20 }, { key: 'low_stock', value: 4 }]), context('inventory', { currency: null })),
  toggl: adapters.parseReportingSnapshot('toggl', snapshot([{ key: 'hours', value: 900 }]), context('toggl', { currency: null })),
  katana: adapters.parseReportingSnapshot('katana', snapshot([{ key: 'stock_rows', value: 30 }]), context('katana', { currency: null })),
  loyverse: adapters.parseLoyverse({ sales: 500, refunds: 20, receipts: 12, unknown_date_receipts: 0,
    first_day: '2026-09-01', last_day: '2026-09-30', covered_days: 30, complete_days: 30, requested_days: 30,
    covered_through: '2026-10-01T00:00:00Z' }, context('loyverse')),
  'zoho-books': adapters.parseZohoBooks({ invoice_total: 500, invoice_count: 5, outstanding_total: 100, expense_total: 200, expense_count: 2,
    excluded_foreign_count: 0, covered_days: 30, complete_days: 30, incomplete_days: 0, missing_days: 0,
    latest_covered_through: '2026-10-01T00:00:00Z', start: '2026-09-01', end: '2026-09-30',
    legacy: { days: 0, start: null, end: null, invoice_total: null, expense_total: null, outstanding_total: null } }, context('zoho')),
  'wix-orders': adapters.parseWixOrders({ totals: [{ currency_code: 'USD', order_count: 3, paid_count: 2, total_amount: 200 }],
    coverage: [{ start_date: '2026-09-01', end_date: '2026-09-30', imported_through: '2026-10-01T00:00:00Z', complete: true }],
    covered_days: 30, complete_days: 30, requested_days: 30 }, context('wix'))
};
assert.deepEqual(Object.keys(parsed).sort(), [...pluginProviders].sort());
assert.deepEqual(Object.keys(adapters.adapterInventory).sort(), [...pluginProviders].sort());
for (const result of Object.values(parsed)) { assert.equal(result.stage, 'unadmitted'); assert(result.observations.length); }
assert.equal(parsed.toggl.observations[0].temporalKind, 'lifetime');
assert.equal(parsed['zoho-inventory'].observations[0].coverage, 'snapshot');
const file = adapters.parseCanonicalMetrics('file', [{ metric: 'purchased_kg', value: '1200', unit: 'kg' }], context('approved-file'));
const payment = aggregateSquarePayments(parsed.square.observations);
assert.equal(payment.value, '10000.000000');
assert.deepEqual(parsed.square.dependencies.map(row => row.sourceId).sort(), ['p1', 'p2']);
const otherVersion = adapters.parseSquarePayments([{ id: 'p1', amount: '6000', currency: 'USD', status: 'COMPLETED' }], context('square', { version: 'fixture-v2' }));
assert.throws(() => aggregateSquarePayments([parsed.square.observations[0], otherVersion.observations[0]]), /ambiguous_source_versions/);
const multicurrency = adapters.parseReportingHistory('xero', history([{ key: 'invoices', value: 2, currency: 'USD' },
  { key: 'invoices', value: 3, currency: 'EUR' }]), context('xero'));
assert.equal(multicurrency.observations.length, 2);
assert.deepEqual(multicurrency.observations.map(row => [row.unit, row.currency, row.partition]), [['count', null, 'USD'], ['count', null, 'EUR']]);
const offsetSnapshot = adapters.parseReportingSnapshot('katana', { start: '2026-09-30T10:00:00+02:00', end: '2026-09-30T09:00:00Z',
  metrics: [{ key: 'stock_rows', value: 2 }] }, context('katana'));
assert.equal(offsetSnapshot.observations[0].timeZone, 'UTC');
assert.throws(() => adapters.parseReportingSnapshot('katana', { start: '2026-09-30T09:00:00Z', end: '2026-09-30T10:00:00+02:00',
  metrics: [{ key: 'stock_rows', value: 2 }] }, context('katana')), /invalid_snapshot_time/);
assert.equal(aggregateSquarePayments([...parsed.square.observations, parsed.square.observations[0]]).value, payment.value);
const ratio = relationship('payment_per_tracked_hour', payment, parsed.harvest.observations[0]);
const waste = relationship('waste_share', parsed.google_sheets.observations[0], file.observations[0]);
assert.equal(ratio.value, '40.00'); assert.equal(waste.value, '13.33');
const seconds = adapters.parseReportingHistory('clockify', history([{ key: 'hours', value: 61 / 3600 }]), context('clockify'));
assert.equal(seconds.observations[0].value, String(61 / 3600));
assert.equal(relationship('payment_per_tracked_hour', payment, seconds.observations[0]).value, '590163.93');
const tiny = adapters.parseReportingHistory('harvest', history([{ key: 'hours', value: 1e-7 }]), context('harvest'));
assert.equal(tiny.observations[0].value, '0.0000001');
assert.equal(ratio.dependencies.length, 3); assert.equal(waste.dependencies.length, 2);
const group = { id: 'five-plugins-file-note', observations: [payment, ...parsed.harvest.observations, ...parsed.google_sheets.observations,
  ...file.observations, ...parsed.quickbooks_online.observations, ...parsed['zoho-inventory'].observations], relationships: [ratio, waste],
  contexts: [{ id: 'note', workspaceId, kind: 'approved_note', status: 'approved', lifecycle: 'active',
    text: 'The business reported a supplier change. This does not establish the cause of measured changes.',
    dependencies: [dependency('business_note', context('approved-note'))] }] };
const selection = selectEvidenceGroups(workspaceId, [group]);
assert.equal(selection.groups.length, 1);
for (const consumer of ['vsi', 'briefing']) {
  const draft = projectSharedEvidence(selection.groups, consumer);
  assert.equal(draft.stage, 'unadmitted'); assert.equal(draft.signals.length, 2);
  assert.equal(new Set(draft.records.filter(row => row.provider !== 'file').map(row => row.provider)).size, 5);
  assert(draft.records.some(row => row.provider === 'file')); assert.equal(draft.reportedContext.length, 1);
  assert(draft.records.find(row => row.provider === 'harvest').qualifications.some(text => text.includes('permissions')));
  assert.equal(draft.records.find(row => row.provider === 'harvest').entityId, context('h').entityId);
  assert.equal(draft.records.find(row => row.provider === 'harvest').observedAt, context('h').observedAt);
  const reopened = JSON.parse(JSON.stringify(draft));
  assert.deepEqual(reopened, draft);
  for (const signal of reopened.signals) for (const id of signal.dependencyIds) assert(reopened.dependencies.some(source => source.id === id));
}
const smallGroup = (provider) => ({ id: provider, observations: [parsed[provider].observations[0]], relationships: [], contexts: [] });
const sixth = selectEvidenceGroups(workspaceId, [group, smallGroup('wix-orders')]);
assert.equal(sixth.groups.length, 2, 'No five-provider cap');
const all = selectEvidenceGroups(workspaceId, pluginProviders.map(smallGroup));
assert.equal(all.groups.length, 12, 'No ten-provider cap');
for (const consumer of ['vsi', 'briefing']) assert.equal(projectSharedEvidence(all.groups, consumer).records.length, 12);
assert.equal(projectSharedEvidence([smallGroup('xero'), smallGroup('xero')], 'vsi').records.length, 1);
assert.equal(selectEvidenceGroups(workspaceId, [group], 2).groups.length, 0, 'Drop whole dependency group');
assert.equal(selectEvidenceGroups(workspaceId, [group], 24, JSON.stringify([group]).length - 1).groups.length, 0);
assert.equal(selectEvidenceGroups(workspaceId, [group, smallGroup('wix-orders')], 1).groups.length, 1, 'Later small group remains useful');
assert.throws(() => selectEvidenceGroups(workspaceId, [{ ...group, observations: group.observations.filter(row => row.id !== payment.id) }]), /missing_relationship_input/);
assert.throws(() => selectEvidenceGroups(workspaceId, [{ ...group, relationships: [{ ...ratio, dependencies: [] }] }]), /missing_relationship_citation/);
assert.throws(() => selectEvidenceGroups(workspaceId, [{ ...group, contexts: [{ ...group.contexts[0], workspaceId: 'other' }] }]), /workspace_mismatch/);
assert.throws(() => selectEvidenceGroups(workspaceId, [{ ...group, contexts: [{ ...group.contexts[0], status: 'draft' }] }]), /unverified_note/);
for (const change of [{ workspaceId: 'other' }, { entityId: null }, { entityBinding: 'missing' }, { scopeVerified: false },
  { scopeKey: 'different-location' }, { start: '2026-08-01' }, { timeZone: 'America/Los_Angeles' }, { coverage: 'partial' },
  { lifecycle: 'revoked' }, { temporalKind: 'lifetime' }]) {
  assert.throws(() => relationship('payment_per_tracked_hour', payment, { ...parsed.harvest.observations[0], ...change }), /incompatible_or_unverified_scope/);
}
assert.throws(() => relationship('payment_per_tracked_hour', payment, parsed.clockify.observations[0]), /incompatible_or_unverified_scope/);
assert.throws(() => relationship('waste_share', parsed.google_sheets.observations[0], { ...file.observations[0], unit: 'lb' }), /unsupported_recipe_inputs/);
assert.throws(() => relationship('waste_share', parsed.google_sheets.observations[0], { ...file.observations[0], value: '0' }), /invalid_ratio_inputs/);
assert.throws(() => aggregateSquarePayments([...parsed.square.observations, parsed.quickbooks_online.observations[0]]), /incompatible_payments/);
assert.throws(() => aggregateSquarePayments([parsed.square.observations[0], { ...parsed.square.observations[1], currency: 'EUR' }]), /incompatible_payments/);
assert.throws(() => aggregateSquarePayments([parsed.square.observations[0], { ...parsed.square.observations[0], value: '7' }]), /conflicting_observation/);
assert.throws(() => adapters.parseReportingHistory('xero', history([{ key: 'profit', value: 4, currency: 'USD' }]), context('xero')));
assert.throws(() => adapters.parseReportingHistory('harvest', history([{ key: 'hours', value: 4, currency: 'USD' }]), context('harvest')));
assert.throws(() => adapters.parseReportingHistory('harvest', history([{ key: 'hours', value: -4 }]), context('harvest')), /invalid_metric_value/);
assert.throws(() => adapters.parseReportingSnapshot('katana', snapshot([{ key: 'stock_rows', value: 1.5 }]), context('katana')), /invalid_metric_value/);
assert.throws(() => adapters.parseWixOrders({ totals: [], coverage: [], covered_days: 30, complete_days: 30, requested_days: 30 }, context('wix')), /invalid_coverage/);
assert.throws(() => adapters.parseCanonicalMetrics('file', [{ metric: 'm', value: Infinity, unit: 'kg' }], context('file')));
assert.throws(() => adapters.parseCanonicalMetrics('file', [{ metric: 'm', value: '1', unit: 'kg' }], context('file', { start: '2026-02-30' })));
const partial = history([{ key: 'hours', value: 0 }]); partial.coverage.completeDays = 29; partial.coverage.incompleteDays = 1;
assert.equal(adapters.parseReportingHistory('harvest', partial, context('harvest')).observations[0].coverage, 'partial');
const missing = history([]); missing.hasHistory = false; missing.coverage.days = 0; missing.coverage.completeDays = 0;
assert.equal(adapters.parseReportingHistory('harvest', missing, context('harvest')).observations.length, 0);
console.log(JSON.stringify({ passed: true, adapters: 12, consumers: ['vsi-draft', 'briefing-draft'], representativePlugins: 5,
  processedFile: true, approvedNote: true, sixthSource: true, allTwelve: true, paidCalls: 0, databaseCalls: 0,
  limitation: 'Pure synthetic unadmitted projections; not runtime admission, database persistence, actual citation navigation, or model-quality proof.' }));
