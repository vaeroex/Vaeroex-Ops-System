/* eslint-disable @typescript-eslint/no-require-imports -- Independent owned-DB workload collectors. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verifyFixtures } = require('./workspace-capacity-sheets-fixtures.cjs');
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file); assert.equal(stat.mode & 0o077, 0, 'private_event_file_required');
  assert(stat.size <= 64 * 1024 ** 2, 'event_export_requires_streaming');
  const text = fs.readFileSync(file, 'utf8');
  // A current writer can have one incomplete final line; retain it for the next
  // sample. Complete lines are never skipped or silently truncated.
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function createCollectors({ runtimeFile, state, baselineRunIds = [] }) {
  assert.equal(fs.statSync(runtimeFile).mode & 0o077, 0, 'private_runtime_required');
  const cfg = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); assert(cfg.syntheticOnly === true && cfg.paidCredentialsPresent === false && cfg.runId, 'synthetic_runtime_required');
  const prior = new Set(baselineRunIds), completedHistory = new Map();
  const providerFixtureVerifier = input => verifyFixtures({ ...input, runtimeFile, requireConnected: false });
  async function primaryResolver({ db, plan, actions }) {
    assert.equal(plan.runId, cfg.runId); const ids = plan.workspaces.map(w => w.id), supported = actions.filter(a => ['create', 'repeat', 'upload', 'ai'].includes(a.action));
    assert(supported.every(a => /^[a-f0-9-]{36}$/.test(a.logicalId)), 'primary_uuid_required');
    const logical = new Map(supported.map(a => [a.logicalId, a])); assert(logical.size === supported.length, 'duplicate_action_logical_id');
    const mappings = [], checkedLogicalIds = [...logical.keys()];
    const issues = (await db.query("select id,workspace_id,title from public.issues where workspace_id=any($1::uuid[]) and title=any($2::text[])", [ids, supported.filter(a => ['create', 'repeat'].includes(a.action)).map(a => 'SYNTHETIC ' + a.logicalId)])).rows;
    for (const r of issues) mappings.push({ table: 'issues', id: r.id, workspaceId: r.workspace_id, logicalId: r.title.slice('SYNTHETIC '.length) });
    const files = (await db.query('select id,workspace_id,original_name from public.file_uploads where workspace_id=any($1::uuid[]) and original_name=any($2::text[])', [ids, supported.filter(a => a.action === 'upload').map(a => `SYNTHETIC-${a.logicalId}.csv`)])).rows;
    for (const r of files) mappings.push({ table: 'file_uploads', id: r.id, workspaceId: r.workspace_id, logicalId: r.original_name.slice('SYNTHETIC-'.length, -4) });
    // Conversational /api/search persists usage, not an ai_agent_runs record.
    // An HTTP success with missing usage is therefore an integrity/accounting
    // failure under this workload contract, never a fabricated accepted row.
    const usage = (await db.query("select id,workspace_id,metadata_json->>'analysis_session_id' logical_id from public.ai_usage where workspace_id=any($1::uuid[]) and agent_type='global_search_or_ask' and metadata_json->>'analysis_session_id'=any($2::text[])", [ids, supported.filter(a => a.action === 'ai').map(a => a.logicalId)])).rows;
    for (const r of usage) mappings.push({ table: 'ai_usage', id: r.id, workspaceId: r.workspace_id, logicalId: r.logical_id });
    return { mappings, checkedLogicalIds, evidence: { markerReads: ['issues.title', 'file_uploads.original_name', 'ai_usage.metadata_json.analysis_session_id'], rows: mappings.length } };
  }
  async function jobCollector({ db, plan, requests = [] }) {
    assert.equal(plan.runId, cfg.runId); const ids = plan.workspaces.map(w => w.id);
    const hasEligibility = (await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='google_sheets_sync_runs' and column_name='eligible_at') present")).rows[0].present;
    if (!hasEligibility) return { jobs: [], jobDispatches: [], complete: false, evidence: { reason: 'eligible_at_migration_missing' } };
    const rows = (await db.query('select id,workspace_id,connection_id,approval_id,trigger_kind,status,eligible_at,started_at,completed_at,error_code,row_count,fact_count,rejected_count,conflict_count from public.google_sheets_sync_runs where workspace_id=any($1::uuid[]) order by started_at,id', [ids])).rows;
    const claims = readEvents(cfg.transportEvents).filter(e => e.runId === plan.runId && e.event === 'rpc_response' && e.rpc === 'claim_google_sheets_sync_v1' && e.status === 200 && e.runIdAccepted);
    const byRun = new Map(), conflicts = [];
    for (const c of claims) {
      if (byRun.has(c.runIdAccepted) && byRun.get(c.runIdAccepted).logicalId !== c.logicalId) conflicts.push(c.runIdAccepted);
      else byRun.set(c.runIdAccepted, c);
    }
    const jobs = rows.map(r => {
      const claim = byRun.get(r.id), matched = claim && claim.workspaceId === r.workspace_id && claim.connectionId === r.connection_id && typeof claim.logicalId === 'string';
      const baseline = prior.has(r.id), committed = r.status === 'succeeded';
      return { id: r.id, workspaceId: r.workspace_id, connectionId: r.connection_id, approvalId: r.approval_id,
        originalEligibleAt: r.eligible_at?.toISOString() || null, startedAt: r.started_at.toISOString(), completedAt: r.completed_at?.toISOString() || null,
        accepted: true, status: r.status === 'succeeded' ? 'completed' : r.status === 'failed' ? 'failed_explicitly' : 'running',
        committed: committed && !baseline, effectKey: committed && matched && !baseline ? hash({ workspace: r.workspace_id, connection: r.connection_id, trigger: r.trigger_kind, requestLogicalId: claim.logicalId }) : null,
        requestLogicalId: matched ? claim.logicalId : null, claimTransportMatched: Boolean(matched), baseline, errorCode: r.error_code,
        rows: r.row_count, facts: r.fact_count, rejected: r.rejected_count, conflicts: r.conflict_count };
    });
    const dispatch = new Map(); for (const j of jobs.filter(j => j.requestLogicalId)) {
      const d = dispatch.get(j.requestLogicalId) || { requestLogicalId: j.requestLogicalId, jobIds: [] }; d.jobIds.push(j.id); dispatch.set(j.requestLogicalId, d);
    }
    const dueEvents = readEvents(cfg.transportEvents).filter(e => e.runId === plan.runId && e.event === 'rpc_response' && e.rpc === 'due_google_sheets_syncs_v1' && e.status === 200);
    const deniedClaims = readEvents(cfg.transportEvents).filter(e => e.runId === plan.runId && e.event === 'rpc_response' && e.rpc === 'claim_google_sheets_sync_v1' && e.status !== 200);
    const acknowledgementLosses = readEvents(cfg.transportEvents).filter(e => e.runId === plan.runId && e.event === 'fault_injected' && e.kind === 'commit_ack_loss' && e.actualInjection === true);
    for (const req of requests.filter(r => r.action === 'scheduled')) {
      const item = dispatch.get(req.logicalId) || { requestLogicalId: req.logicalId, jobIds: [] };
      const lostAcknowledgements = acknowledgementLosses.filter(e => e.logicalId === req.logicalId);
      for (const e of lostAcknowledgements) assert(jobs.some(j => j.id === e.runIdAccepted && j.workspaceId === e.workspaceId && j.requestLogicalId === req.logicalId && j.status === 'completed'), 'lost_ack_durable_run_mismatch');
      item.scheduling = { response: req.schedulingResponse || null,
        acknowledgementLossRunIds: [...new Set(lostAcknowledgements.map(e => e.runIdAccepted))],
        dueQueries: dueEvents.filter(e => e.logicalId === req.logicalId).map(e => ({ at: e.at, tickAt: e.tickAt, limit: e.limit, excludedConnectionIds: e.excludedConnectionIds, connections: e.connections })),
        claimDenials: deniedClaims.filter(e => e.logicalId === req.logicalId).map(e => ({ at: e.at, workspaceId: e.workspaceId, connectionId: e.connectionId, errorCode: e.outcomeCode })) };
      dispatch.set(req.logicalId, item);
    }
    const unmapped = jobs.filter(j => !j.claimTransportMatched && !j.baseline).map(j => j.id);
    const acknowledgedNoClaims = requests.filter(r => r.accepted && ['manualSync', 'scheduled'].includes(r.action) && !dispatch.has(r.logicalId)).map(r => r.logicalId);
    return { jobs, jobDispatches: [...dispatch.values()], complete: !unmapped.length && !conflicts.length && jobs.every(j => j.originalEligibleAt), evidence: {
      sqlRows: rows.length, actualClaimResponses: claims.length, unmappedAcceptedRunIds: unmapped, conflictingClaimMappings: conflicts, acknowledgedRequestsWithoutNewClaims: acknowledgedNoClaims,
      effectKeyMeaning: 'Intent/connection/trigger from real claim transport plus durable SQL receipt, not run-ID uniqueness. Different deliberate refreshes may observe the same unchanged facts. Separate integrity checks require unique canonical source/version/metric links and one persisted KPI per link.' } };
  }
  async function queueCollector({ db, plan }) {
    const ids = plan.workspaces.map(w => w.id);
    const queued = (await db.query("select id,workspace_id,next_sync_at from public.google_sheets_connections where workspace_id=any($1::uuid[]) and status='connected' and automatic_refresh_enabled and active_approval_id is not null and next_sync_at<=clock_timestamp() and (sync_lease_expires_at is null or sync_lease_expires_at<=clock_timestamp()) order by next_sync_at,id", [ids])).rows;
    const counts = (await db.query("select count(*)filter(where status='running')::int inflight,count(*)filter(where status='succeeded')::int completed,count(*)filter(where status='failed')::int failed from public.google_sheets_sync_runs where workspace_id=any($1::uuid[])", [ids])).rows[0];
    const columns = (await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='google_sheets_sync_runs' and column_name='eligible_at') present")).rows[0].present;
    // Publish bounded cumulative completions: independent consumers must not lose a
    // completion when a newer telemetry sample replaces the one that introduced it.
    if (columns) {
      const terminal = (await db.query("select id,eligible_at,started_at,status from public.google_sheets_sync_runs where workspace_id=any($1::uuid[]) and status<>'running' order by started_at,id", [ids])).rows;
      for (const r of terminal) if (!prior.has(r.id) && !completedHistory.has(r.id)) { assert(r.eligible_at, 'unknown_job_eligibility'); assert(completedHistory.size < 100000, 'completion_history_budget_exceeded'); completedHistory.set(r.id, { id: r.id, eligibleAt: r.eligible_at.toISOString(), startedAt: r.started_at.toISOString(), status: r.status }); }
    }
    const oldestEligibleAt = queued[0]?.next_sync_at.toISOString() || null;
    return { depth: queued.length, inFlight: counts.inflight, oldestEligibleAt, oldestAgeMs: oldestEligibleAt ? Math.max(0, Date.now() - Date.parse(oldestEligibleAt)) : 0,
      completed: [...completedHistory.values()], completionHistoryComplete: true, completedCount: counts.completed, failedCount: counts.failed, eligibilityAvailable: columns,
      tenantQueues: queued.map(r => ({ workspaceId: r.workspace_id, connectionId: r.id, originalEligibleAt: r.next_sync_at.toISOString() })) };
  }
  async function integrityCollector({ db, plan, draining = false }) {
    const ids = plan.workspaces.map(w => w.id), violations = [];
    const probes = [
      ['kpi_source_scope', "select k.id from public.kpis k left join public.file_uploads f on f.id=k.source_file_id where k.workspace_id=any($1::uuid[]) and k.source_file_id is not null and (f.id is null or f.workspace_id<>k.workspace_id) limit 20"],
      ['import_parent_scope', "select r.id from public.file_import_rows r left join public.file_uploads f on f.id=r.file_upload_id left join public.file_imports i on i.id=r.import_id where r.workspace_id=any($1::uuid[]) and (f.id is null or i.id is null or f.workspace_id<>r.workspace_id or i.workspace_id<>r.workspace_id or i.file_upload_id<>r.file_upload_id) limit 20"],
      ['memory_source_scope', "select m.id from public.business_memory_chunks m left join public.file_uploads f on f.id=m.source_file_id where m.workspace_id=any($1::uuid[]) and m.source_file_id is not null and (f.id is null or f.workspace_id<>m.workspace_id) limit 20"],
      ['sheet_fact_scope', "select f.kpi_id as id from public.google_sheets_fact_links f left join public.kpis k on k.id=f.kpi_id left join public.google_sheets_source_versions v on v.id=f.source_version_id where f.workspace_id=any($1::uuid[]) and (k.id is null or v.id is null or k.workspace_id<>f.workspace_id or v.workspace_id<>f.workspace_id or v.connection_id<>f.connection_id or v.source_row_id<>f.source_row_id) limit 20"],
      ['duplicate_sheet_source', "select min(id::text) id from public.google_sheets_source_rows where workspace_id=any($1::uuid[]) group by workspace_id,connection_id,source_identity_fingerprint having count(*)>1 limit 20"],
      ['duplicate_sheet_fact', "select min(kpi_id::text) id from public.google_sheets_fact_links where workspace_id=any($1::uuid[]) group by workspace_id,connection_id,source_row_id,metric_column having count(*)>1 limit 20"],
      ['duplicate_sheet_kpi_reference', "select kpi_id as id from public.google_sheets_fact_links where workspace_id=any($1::uuid[]) group by kpi_id having count(*)>1 limit 20"],
      ['multiple_live_tenant_leases', "select workspace_id as id from public.google_sheets_connections where workspace_id=any($1::uuid[]) and sync_lease_expires_at>clock_timestamp() group by workspace_id having count(*)>1 limit 20"],
      ['held_import_scope', "select a.id from private.file_import_attempts a left join public.file_uploads f on f.id=a.file_id left join public.file_imports i on i.id=a.import_id where a.workspace_id=any($1::uuid[]) and (f.id is null or i.id is null or f.workspace_id<>a.workspace_id or i.workspace_id<>a.workspace_id or i.file_upload_id<>a.file_id) limit 20"]
    ];
    // These checks only read; no validation/policy/constraint is disabled.
    for (const [code, sql] of probes) for (const row of (await db.query(sql, [ids])).rows) violations.push({ code, id: row.id });
    const leases = (await db.query('select count(*)::int n from public.google_sheets_connections where sync_lease_expires_at>clock_timestamp()')).rows[0].n;
    if (leases > 4) violations.push({ code: 'aggregate_sheet_lease_budget_exceeded', actual: leases, limit: 4 });
    const objects = state ? [...state.verifiedObjects.values()] : [];
    if (state) for (const o of objects) {
      if (!o.orphan && o.declaredBytes !== o.bytes) violations.push({ code: 'storage_size_mismatch', id: o.id });
      if (draining && o.orphan) violations.push({ code: 'unreconciled_storage_object_after_drain', id: o.id });
    }
    return { ready: Boolean(state), violations, checks: probes.map(p => p[0]), aggregateSheetsLiveLeases: leases,
      storageVerifiedObjects: objects.length, provisionalObjectsDuringWrites: objects.filter(o => o.orphan).length,
      limitations: 'Live checks cover named relations and duplicate canonical Sheets facts. In-flight upload objects may precede metadata and are provisional until drain. Final uncapped independent inventory verifies every scoped row, object, accepted mutation and job.' };
  }
  return { primaryResolver, jobCollector, queueCollector, integrityCollector, providerFixtureVerifier };
}
module.exports = { createCollectors, readEvents };
