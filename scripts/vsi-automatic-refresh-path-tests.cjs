/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free scheduler/normalizer/projection composition. */
// Real application scheduler, sync orchestration, row normalization and typed
// projection. Provider replies, DB admission/commit and source resolution are
// modeled below. This is NOT a live ingestion, RLS, model or hosted cron proof.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
const workspace = id(1), otherWorkspace = id(2), connection = id(3), entity = id(4);
const headers = ['Row', 'Date', 'Orders on payment hold'];
const mapping = { rowKeyColumn: 0, dateColumn: 1, dateFormat: 'iso', locationColumn: null,
  metrics: [{ column: 2, name: 'Orders on payment hold', unit: 'count', category: 'Operations', target: null }] };
let sourceRows = [['day-1', '2026-11-15', 3]], retained = [], successfulSync = null;
let run = 0, calls = [], readCalls = 0, mode = 'success', backoffs = 0, network = 0;
let observedAt = '2026-11-15T12:00:00Z';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assertScope = (w, c) => { assert.equal(w, workspace); assert.equal(c, connection); };
const db = {
  from(table) {
    assert.equal(table, 'google_sheets_connections'); const filters = {};
    return { select() { return this; }, eq(key, value) { filters[key] = value; return this; }, abortSignal() { return this; },
      async single() { assertScope(filters.workspace_id, filters.id); return { error: null, data: {
        spreadsheet_id: 'abcdefghijklmnopqrstuvwxyz123456', sheet_id: 0, sheet_title: 'Operations',
        header_row: 1, headers, field_mapping: mapping, business_entity_id: entity
      } }; } };
  },
  rpc(name, args) { return { async abortSignal(signal) {
    assert.equal(signal.aborted, false); assertScope(args.p_workspace_id, args.p_connection_id);
    calls.push({ name, args: structuredClone(args) });
    if (name === 'claim_google_sheets_sync_v1') {
      assert.equal(args.p_trigger, 'scheduled'); assert.equal(args.p_actor_id, null); assert.equal(args.p_session_id, null);
      return { error: null, data: { runId: id(100 + ++run) } };
    }
    if (name === 'commit_google_sheets_sync_v1') {
      assert.equal(args.p_complete, true);
      // Models atomic replacement only after the real orchestrator's two stable
      // full reads. Actual SQL approval/lease/retention tests remain separate.
      retained = structuredClone(args.p_rows); successfulSync = observedAt;
      return { error: null, data: { runId: args.p_run_id, rowCount: retained.length,
        factCount: retained.reduce((n, row) => n + row.metrics.length, 0), rejectedCount: 0, conflictCount: 0 } };
    }
    assert.equal(name, 'fail_google_sheets_sync_v1'); return { error: null, data: null };
  } }; }
};
const server = {
  assertSheetsWorkspaceAllowed(w) { if (w !== workspace) throw Error('google_sheets_pilot_limited'); },
  sheetsAdmin: () => db,
  async sheetsMetadata(w, c) { assertScope(w, c); return { title: 'Synthetic operations', tabs: [{ id: 0, title: 'Operations', rowCount: sourceRows.length + 1 }] }; },
  async sheetsHeaders(w, c) { assertScope(w, c); return headers; },
  async sheetsMappedColumns(w, c) {
    assertScope(w, c); readCalls++;
    if (mode === 'partial_failure' && readCalls === 2) throw Error('google_sheets_provider_request_failed');
    const rows = structuredClone(sourceRows);
    if (mode === 'changing_snapshot' && readCalls === 2) rows[0][2]++;
    return [0, 1, 2].map(column => rows.map(row => [row[column]]));
  }
};
installLoader({ 'server-only': {}, './server': server });
globalThis.fetch = () => { network++; throw Error('network_forbidden'); };
require('node:net').Socket.prototype.connect = globalThis.fetch;
const { runDueSheetsRefreshes } = require('../lib/integrations/google-sheets/scheduler.ts');
const { runSheetsSync } = require('../lib/integrations/google-sheets/sync.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { expandFactTimes, selectedFactTimeLines } = require('../lib/ai/shared-evidence/fact-time.ts');
const { requestedSharedProviders } = require('../lib/ai/shared-evidence/generation-selection.ts');
async function tick() {
  readCalls = 0; calls = [];
  return runDueSheetsRefreshes({
    eligible: row => row.workspace_id === workspace,
    due: async (_at, _limit, _deadline, excluded) => [
      { id: connection, workspace_id: workspace }, { id: id(9), workspace_id: otherWorkspace }
    ].filter(row => !excluded.includes(row.id)),
    sync: (row, execution, admission) => runSheetsSync({ workspaceId: row.workspace_id, connectionId: row.id,
      actorId: null, sessionId: null, trigger: 'scheduled', execution, admission }),
    backoff: async row => { assertScope(row.workspace_id, row.id); backoffs++; }
  });
}
function projections() {
  // Mirror the existing approved-row SQL projection shape; do not invent new
  // mapping semantics or claim this fixture proves protected source admission.
  return retained.filter(row => row.validationState === 'valid').map((row, index) => sharedRow({
    identity: { kind: 'sheets_ticket_source', source_id: id(500 + index) }, hash: hash(row),
    data: { provider: 'google_sheets', workspace_id: workspace, connection_id: connection,
      business_entity_id: entity, date: row.date, observed_at: successfulSync, read_sources: [],
      metrics: row.metrics.map(metric => ({ metric: metric.name, value: metric.value, unit: metric.unit })) }
  }, workspace));
}
(async () => {
  const first = await tick(); assert.equal(first.succeeded, 1); assert.equal(first.attempted, 1);
  assert.equal(readCalls, 2); assert.equal(retained.length, 1); assert.equal(retained[0].metrics[0].value, '3');
  const original = structuredClone(retained[0]);
  const firstProjection = projections()[0]; assert.match(firstProjection.facts[0], /3 count/);
  assert.equal(firstProjection.scope.coverage, 'unknown'); assert.equal(firstProjection.scope.additive, false);

  // The only stimulus is a changed provider reply before the next scheduler tick.
  // No manual sync request, upload or new mapping is issued.
  sourceRows = [['day-1', '2026-11-15', 4], ['day-2', '2026-11-16', 2]];
  observedAt = '2026-11-16T12:00:00Z';
  const second = await tick(); assert.equal(second.succeeded, 1); assert.equal(retained.length, 2);
  assert.equal(retained[0].identity, original.identity, 'stable source row survives revision');
  assert.notEqual(retained[0].fingerprint, original.fingerprint, 'changed value receives a changed version fingerprint');
  assert.notEqual(retained[1].identity, original.identity, 'new provider row has independent identity');
  assert.deepEqual(retained.map(row => row.metrics[0].value), ['4', '2']);
  const updated = projections(); assert.match(updated[0].facts[0], /4 count/); assert.match(updated[1].facts[0], /2 count/);
  assert.notEqual(updated[0].hash, firstProjection.hash);
  assert.equal(expandFactTimes(updated[0].factTimes, 1)[0].connectionLastSyncAt, observedAt);

  // Independently retained Xero observation is available with the refreshed
  // Sheets facts, without converting outstanding balance into cash or revenue.
  const xero = sharedRow({ identity: { kind: 'legacy_reference', reference_id: id(600) }, hash: 'b'.repeat(64),
    data: { provider: 'xero', workspace_id: workspace, connection_id: id(601), business_entity_id: entity,
      period_start: '2026-11-15', period_end: '2026-11-16', time_zone: 'UTC', read_sources: [],
      records: [{ day: '2026-11-15', metrics: [
        { key: 'invoices', value: '1', currency: 'USD' }, { key: 'billed', value: '1500', currency: 'USD' },
        { key: 'outstanding', value: '1200', currency: 'USD' }, { key: 'bills', value: '0', currency: 'USD' },
        { key: 'purchases', value: '0', currency: 'USD' }
      ] }] }
  }, workspace);
  assert.match(xero.facts.join(' '), /1200 USD/); assert.match(xero.facts.join(' '), /balance.*import/);
  assert.equal(xero.scope.additive, false); assert.equal(xero.scope.coverage, 'unknown');
  assert.notEqual(xero.hash, updated[0].hash);
  assert.deepEqual(requestedSharedProviders('Check Xero receivables and Google Sheets orders on payment hold.'), ['google_sheets', 'xero']);
  assert.throws(() => sharedRow({ ...xero, data: { ...xero.data, workspace_id: otherWorkspace } }, workspace), /shared_workspace_mismatch/);

  const beforeFailure = JSON.stringify(retained), beforeSync = successfulSync;
  for (const failure of ['partial_failure', 'changing_snapshot']) {
    mode = failure; observedAt = '2026-11-17T12:00:00Z'; sourceRows[0][2] = 7;
    const result = await tick(); assert.equal(result.failed, 1); assert.equal(result.succeeded, 0);
    assert.equal(calls.filter(call => call.name === 'commit_google_sheets_sync_v1').length, 0);
    assert.equal(calls.filter(call => call.name === 'fail_google_sheets_sync_v1').length, 1);
    assert.equal(JSON.stringify(retained), beforeFailure, 'failed refresh preserves previous normalized facts');
    assert.equal(successfulSync, beforeSync, 'failed refresh must not claim fresh evidence');
    const row = projections()[0];
    const times = expandFactTimes(row.factTimes, row.facts.length);
    assert.equal(times[0].connectionLastSyncAt, beforeSync);
    assert.match(selectedFactTimeLines(times.map(time => ({ ref: 'S', time }))).join(' '), /connection last successful sync/);
  }
  assert.equal(backoffs, 2); assert.equal(network, 0);
  console.log(JSON.stringify({ suite: 'vsi_automatic_refresh_composition', actual: ['scheduler', 'scheduled_sync', 'row_normalization', 'source_fingerprint', 'typed_projection', 'fact_time', 'requested_provider_selection'],
    modeled: ['provider_responses', 'SQL_admission_commit', 'protected_source_resolution', 'preexisting_Xero_original'],
    successfulTicks: 2, failedTicks: 2, sourcesAfterRefresh: updated.length + 1, liveProviderCalls: 0, modelCalls: 0,
    hostedCron: false, hostedAuthRls: false, automaticXeroRefresh: false, fullVsiAnswer: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
