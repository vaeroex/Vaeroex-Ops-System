/* eslint-disable @typescript-eslint/no-require-imports -- Isolated measurement coordinator. */
// Read-only workloads/telemetry; the only Auth mutation is an explicit refresh
// of existing synthetic sessions. No provider work, database mutation or load.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createServerClient } = require('@supabase/ssr');
const { openState, sha, loopback, readProcessMetrics } = require('./workspace-capacity-state.cjs');
const { createCollectors, readEvents } = require('./workspace-capacity-collectors.cjs');
const ROOT = path.resolve(__dirname, '..');
const MAX_JSON = 64 * 1024 ** 2;
const verifiedArtifactCommits = new Set();
const reason = e => /^[a-z_]+$/.test(e?.message || '') ? e.message : 'measurement_operation_failed';
function privateJson(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'private_input_required');
  assert(stat.size <= MAX_JSON, 'input_requires_streaming');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function atomic(file, value) {
  if (fs.existsSync(file)) assert(!fs.lstatSync(file).isSymbolicLink(), 'output_symlink_denied');
  const temporary = `${file}.tmp-${process.pid}`;
  assert(!fs.existsSync(temporary), 'temporary_output_exists');
  try { fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function lines(file, required = false) {
  if (!file || !fs.existsSync(file)) { assert(!required, 'required_event_file_missing'); return []; }
  const stat = fs.lstatSync(file); assert(stat.isFile() && !(stat.mode & 0o077) && stat.size <= MAX_JSON, 'private_bounded_events_required');
  const raw = fs.readFileSync(file, 'utf8'); assert(!raw || raw.endsWith('\n'), 'unfinished_final_event');
  return raw.split('\n').filter(Boolean).map(x => JSON.parse(x));
}
function loadRuntime(runtimeFile) {
  const cfg = privateJson(runtimeFile); assert(cfg.syntheticOnly === true && cfg.paidCredentialsPresent === false, 'synthetic_runtime_required');
  assert(path.dirname(path.resolve(runtimeFile)) === path.resolve(cfg.out), 'runtime_output_mismatch');
  loopback(cfg.appOrigin, ['http:', 'https:']); loopback(cfg.stubOrigin, ['http:']);
  assert.deepEqual(cfg.allocations, { app: 2 * 1024 ** 3, worker: 1024 ** 3, total: 4 * 1024 ** 3, cpuCores: 4 }, 'agreed_resource_envelope_required');
  return cfg;
}
async function createState(cfg) {
  const state = await openState({ configFile: cfg.configFile, planFile: cfg.planFile, outputDir: cfg.out });
  assert.equal(state.plan.runId, cfg.runId); return state;
}
function artifactIdentity(cfg, state) {
  const info = privateJson(cfg.processesFile || path.join(cfg.out, 'processes.json'));
  assert(info.runId === cfg.runId && info.instanceNonce === cfg.instanceNonce && info.buildMode === 'production', 'runtime_process_identity_mismatch');
  assert(!info.diagnosticPreload,'diagnostic_runtime_not_qualified');
  assert(info.loadedRuntimeSourceFiles&&Object.keys(info.loadedRuntimeSourceFiles).length===5,'loaded_runtime_fingerprints_required');
  for(const[name,digest]of Object.entries(info.loadedRuntimeSourceFiles)) assert(name.startsWith('workspace-capacity-')&&sha(fs.readFileSync(path.join(ROOT,'scripts',name)))===digest,'loaded_runtime_source_changed');
  assert(/^[a-f0-9]{40}$/.test(info.sourceCommit), 'artifact_commit_required');
  if (!verifiedArtifactCommits.has(info.sourceCommit)) {
    const commit = spawnSync('git', ['cat-file', '-t', info.sourceCommit], { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
    assert(commit.status === 0 && commit.stdout.trim() === 'commit', 'artifact_commit_unavailable'); verifiedArtifactCommits.add(info.sourceCommit);
  }
  // Running artifact identity comes from the supervisor's explicit launch
  // manifest, not whichever commit happens to be checked out during analysis.
  state.checkoutCommit ||= state.commit; state.commit = info.sourceCommit;
  return info;
}
async function refreshSessions(state, { minimumRemainingSeconds = 1800, force = false } = {}) {
  assert(Number.isFinite(minimumRemainingSeconds) && minimumRemainingSeconds >= 0 && minimumRemainingSeconds <= 86400, 'session_horizon_invalid');
  const lock = path.join(state.outputDir, 'session-refresh.lock');
  const fd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(fd);
  let refreshed = 0, verified = 0;
  try {
    state.sessions = privateJson(state.sessionsFile);
    assert.equal(state.sessions.runId, state.plan.runId);
    for (const actor of state.plan.actors.filter(a => a.active)) {
      const stored = state.sessions.actors[actor.id]; assert(stored?.refreshToken && stored.cookie, 'actor_session_missing');
      if (force || Date.parse(stored.expiresAt) <= Date.now() + minimumRemainingSeconds * 1000) {
        const jar = new Map(stored.cookie.split('; ').map(entry => { const i = entry.indexOf('='); return [entry.slice(0, i), entry.slice(i + 1)]; }));
        const client = createServerClient(state.config.apiUrl, state.config.anonKey, { global: { fetch: state.safeFetch }, auth: { autoRefreshToken: false },
          cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(c => c.options?.maxAge === 0 ? jar.delete(c.name) : jar.set(c.name, c.value)) } });
        const result = await client.auth.refreshSession({ refresh_token: stored.refreshToken });
        assert(!result.error && result.data.session?.user.id === actor.id, 'synthetic_session_refresh_failed');
        const user = await client.auth.getUser(); assert(!user.error && user.data.user?.id === actor.id, 'refreshed_auth_identity_mismatch');
        jar.set('vaeroex_workspace_id', actor.workspaceId); const session = result.data.session;
        state.sessions.actors[actor.id] = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: new Date(session.expires_at * 1000).toISOString() };
        // Persist every successful refresh before proceeding: rotated tokens
        // survive a subsequent failed actor refresh without resetting identity.
        atomic(state.sessionsFile, state.sessions); refreshed++;
      } else {
        const user = await state.actorClient(actor.id).auth.getUser(stored.accessToken);
        assert(!user.error && user.data.user?.id === actor.id, 'auth_identity_probe_failed');
      }
      verified++;
    }
    return { refreshedActors: refreshed, verifiedActors: verified, observedAt: new Date().toISOString(), syntheticOnly: true };
  } finally { fs.unlinkSync(lock); }
}
async function nativeRoot(state, cfg) {
  const binary = path.join(cfg.out, 'process-metrics');
  const backend = Number((await state.db.query('select pg_backend_pid() pid')).rows[0].pid);
  const directory = fs.realpathSync(state.identity.ownedDataDirectory);
  const stacks = path.join(fs.realpathSync(state.config.ownedSupabaseHome), 'stacks');
  const relative = path.relative(stacks, directory); assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'owned_stack_path_required');
  const stack = path.join(stacks, relative.split(path.sep)[0]);
  const ownerFile = path.join(stack, 'owner.json');
  // Native CLI owns this file and includes a control secret. Read only the PID
  // into evidence; never serialize the owner document or its other fields.
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); const pid = Number(owner.pid);
  assert(Number.isInteger(pid) && pid > 1, 'native_supervisor_pid_required');
  const postmaster = Number(fs.readFileSync(path.join(directory, 'postmaster.pid'), 'utf8').split('\n')[0]);
  const metrics = readProcessMetrics(binary, [pid]); const byPid = new Map(metrics.processes.map(p => [p.pid, p]));
  assert(byPid.has(backend) && byPid.has(postmaster), 'native_owner_not_ancestor_of_owned_database');
  let cursor = byPid.get(backend), ancestors = [];
  for (let i = 0; cursor && i < 32; i++) { ancestors.push(cursor.pid); if (cursor.pid === pid) break; cursor = byPid.get(cursor.ppid); }
  assert(ancestors.includes(postmaster) && ancestors.at(-1) === pid, 'database_process_ancestry_unverified');
  const root = byPid.get(pid);
  return { pid, startSeconds: root.startSeconds, startMicroseconds: root.startMicroseconds, backendPid: backend, postmasterPid: postmaster, ancestry: ancestors, source: 'owned_data_directory_postmaster_pid_owner_and_libproc' };
}
function baselineRuns(cfg, state, { capture = false } = {}) {
  const file = cfg.baselineRunIdsFile || path.join(cfg.out, 'baseline-runs.private.json');
  return (async () => {
    if (fs.existsSync(file)) { const x = privateJson(file); assert.equal(x.runId, cfg.runId); assert(Array.isArray(x.runIds), 'baseline_runs_invalid'); return x; }
    if (!capture) return { runId: cfg.runId, runIds: [], captured: false };
    const rows = (await state.db.query('select id from public.google_sheets_sync_runs where workspace_id=any($1::uuid[]) order by id', [state.ids])).rows;
    const x = { runId: cfg.runId, captured: true, observedAt: new Date().toISOString(), runIds: rows.map(r => r.id), scope: 'Durable pre-workload receipt IDs; records are retained.' };
    assert(!fs.existsSync(file), 'baseline_capture_raced'); atomic(file, x); return x;
  })();
}
function adapterQualification(cfg, info, plan) {
  const file = cfg.adaptersFile || path.join(cfg.out, 'adapters.private.json');
  if (!fs.existsSync(file)) return { ready: false, reason: 'adapter_qualification_missing', file };
  const value = privateJson(file);
  if (value.runId !== cfg.runId || value.sourceCommit !== info.sourceCommit || value.instanceNonce !== info.instanceNonce) return { ready: false, reason: 'adapter_identity_mismatch', file };
  const missing = [];
  const test = (kind, actor) => {
    const a = actor ? value[kind]?.byActor?.[actor.id] || value[kind] : value[kind];
    if (!a?.ready || a.sourceCommit !== info.sourceCommit || a.instanceNonce !== info.instanceNonce || !a.ack?.statuses?.length || !(a.ack.location || a.ack.actionRedirect || a.ack.includes || a.ack.json)) { missing.push(`${kind}:${actor?.id || 'shared'}`); return; }
    if (['create', 'repeat', 'upload'].includes(kind) && !(a.actorId === actor.id && a.captureWasAbortedBeforeDispatch === true && a.encoding === 'multipart' && a.entries?.length)) missing.push(`${kind}:${actor.id}:capture`);
  };
  for (const actor of plan.actors.filter(a => a.active)) { for (const kind of ['create', 'repeat', 'upload', 'ai']) test(kind, actor); }
  for (const owner of plan.actors.filter(a => a.role === 'owner')) test('manualSync', owner);
  test('scheduled'); return { ready: missing.length === 0, reason: missing.length ? 'adapters_not_qualified' : null, missing, file, sha256: sha(fs.readFileSync(file)) };
}
function egressEvidence(cfg) {
  const file = cfg.networkEvidenceFile || path.join(cfg.out, 'network-evidence.json');
  const e = privateJson(file);
  assert(e.runId === cfg.runId && e.syntheticOnly === true && e.egressDenyAllExternal === true && e.nativeStackConfined === true && e.paidCredentialsPresent === false, 'network_isolation_evidence_incomplete');
  assert.equal(e.profileSha256, sha(fs.readFileSync(cfg.profileFile)), 'network_profile_changed');
  assert(e.tests?.some(t => t.kind === 'raw_node_socket' && t.deniedByKernel === true) && e.tests?.some(t => t.kind === 'raw_grandchild_socket' && t.deniedByKernel === true) && e.tests?.some(t => t.kind === 'native_postgres_pg_net' && t.databaseProcessInheritedSandbox === true), 'network_kernel_probes_missing');
  const events = readEvents(cfg.transportEvents).filter(e => e.runId === cfg.runId);
  return { enforced: true, violations: events.filter(e => e.event === 'egress_violation').length, evidenceFile: file, profileSha256: e.profileSha256, observedAt: new Date().toISOString(), scope: 'OS-denied external egress plus application transport violation records. Local sockets remain allowed.' };
}
async function providerTelemetry(cfg) {
  const url = new URL('/telemetry', cfg.stubOrigin); loopback(url.href, ['http:']);
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2000) }); assert.equal(r.status, 200, 'provider_telemetry_failed');
  const raw = await r.text(); assert(raw.length <= 65536, 'provider_telemetry_bound'); const p = JSON.parse(raw);
  assert(p.mode === 'local_stubs_only' && p.paidCalls === 0 && ['calls', 'inFlight', 'peak', 'bytes'].every(k => Number.isFinite(p[k]) && p[k] >= 0), 'provider_telemetry_invalid');
  return { ...p, evidence: 'Actual local provider process counters; OS egress evidence establishes external-provider confinement.', observedAt: new Date().toISOString() };
}
function faultStatus(cfg) {
  const file = cfg.faultStatusFile || path.join(cfg.out, 'fault-status.json');
  if (!fs.existsSync(file)) return null; const f = privateJson(file);
  assert.equal(f.runId, cfg.runId, 'fault_run_mismatch');
  if (f.phase === 'stopped' && (cfg.scenario || 'nominal') !== 'chaos') return null;
  assert(f.runId === cfg.runId && Date.now() - Date.parse(f.observedAt) <= 10000 && Date.parse(f.observedAt) <= Date.now() + 1000, 'fault_status_stale'); return f;
}
function processRoots(cfg, info, native, generatorPidFile) {
  const binary = path.join(cfg.out, 'process-metrics'); const roots = [];
  const verify = item => { const raw = readProcessMetrics(binary, [item.pid]).processes.find(p => p.pid === item.pid); if (item.startSeconds !== undefined) assert(raw.startSeconds === item.startSeconds && raw.startMicroseconds === item.startMicroseconds, 'process_identity_reused'); return raw; };
  verify(info.app); verify(info.provider); verify(native);
  let interruption = null;
  try { verify(info.worker); roots.push({ ...info.worker, label: 'worker' }); }
  catch {
    const control = privateJson(cfg.runtimeControl);
    const event = readEvents(cfg.transportEvents).filter(e => e.runId === cfg.runId && e.event === 'fault_injected' && e.kind === 'worker_interruption' && e.actualInjection === true && e.pid === info.worker.pid).at(-1);
    const age = event ? Date.now() - Date.parse(event.at) : Infinity;
    assert(control.runId === cfg.runId && control.kind === 'worker_interruption' && control.id && age >= 0 && age <= 3000, 'unqualified_worker_disappearance');
    interruption = { kind: 'worker_interruption', actualInjection: true, missingPid: info.worker.pid, observedMissingMilliseconds: age };
  }
  roots.push({ ...info.provider, label: 'provider' }, { pid: info.supervisor, label: 'capacity_supervisor' }, { ...native, label: 'native_supabase' }, { pid: process.pid, label: 'measurement_collector' });
  const faultLock=path.join(cfg.out,'fault-controller.lock');if(fs.existsSync(faultLock)){const controller=privateJson(faultLock);assert(controller.runId===cfg.runId&&Number.isInteger(controller.pid),'fault_process_identity_required');verify(controller);roots.push({pid:controller.pid,label:'fault_controller'});}
  if (generatorPidFile && fs.existsSync(generatorPidFile)) {
    const generator = privateJson(generatorPidFile); assert(generator.runId === cfg.runId && Number.isInteger(generator.pid), 'generator_identity_required'); verify(generator); roots.push({ ...generator, label: 'workload_generator' });
  }
  assert(new Set(roots.map(p => p.pid)).size === roots.length, 'duplicate_process_root'); return { roots, interruption, generatorObserved: roots.some(p => p.label === 'workload_generator') };
}
const SOURCE_FILES = ['scripts/workspace-capacity-measure.cjs', 'scripts/workspace-capacity-state.cjs', 'scripts/workspace-capacity-collectors.cjs', 'scripts/workspace-capacity-proc.c', 'scripts/workspace-capacity-environment.cjs', 'scripts/workspace-capacity-preload.cjs', 'scripts/workspace-capacity-providers.cjs', 'docs/security/audit-evidence/stage-3/http/core.mjs', 'docs/security/audit-evidence/stage-3/http/run.mjs', 'scripts/workspace-capacity-next-config.cjs', 'scripts/workspace-capacity-next-server.cjs', 'app/api/integrations/google-sheets/sync/route.ts', 'lib/integrations/google-sheets/sync.ts', 'app/app/files/actions.ts', 'app/app/operations/actions.ts', 'app/api/search/route.ts', 'next.config.mjs', 'patches/next@15.5.24.patch', 'pnpm-lock.yaml', '.next/BUILD_ID', 'supabase/migrations/20261005182541_bounded_google_sheets_dispatch.sql', 'supabase/migrations/20261005183352_issue_submission_receipts.sql', 'supabase/migrations/20261005184031_qbo_scoped_runtime_recovery.sql', 'supabase/migrations/20261005190709_sheets_recovery_fair_scan.sql', 'supabase/migrations/20261005194244_google_sheets_failure_cleanup_transition.sql'];
async function collectTelemetry(runtimeFile, envOutput, generatorPidFile, { signal, maxSamples = Infinity } = {}) {
  const cfg = loadRuntime(runtimeFile), state = await createState(cfg), output = path.resolve(envOutput);
  assert(path.dirname(output) === path.resolve(cfg.out), 'environment_output_must_be_owned');
  const telemetryFile = cfg.telemetryFile || path.join(cfg.out, 'telemetry.json');
  let stopped = false, sampleCount = 0, lastSchemaCheck = Date.now(), schemaChecks = 1;
  const stop = () => { stopped = true; }; process.once('SIGTERM', stop); process.once('SIGINT', stop); signal?.addEventListener('abort', stop, { once: true });
  const startedAt = new Date().toISOString(), sourceFiles = Object.fromEntries(SOURCE_FILES.map(f => [path.join(ROOT, f), sha(fs.readFileSync(path.join(ROOT, f)))]));
  try {
    const native = await nativeRoot(state, cfg), baseline = await baselineRuns(cfg, state), collectors = createCollectors({ runtimeFile, state, baselineRunIds: baseline.runIds });
    while (!stopped && sampleCount < maxSamples) {
      const began = performance.now();
      try {
        const info = artifactIdentity(cfg, state), processInfo = processRoots(cfg, info, native, generatorPidFile);
        // Full catalog hash at open and every 60s; never claim it was freshly
        // recalculated each second. A changed fingerprint stops readiness.
        if (Date.now() - lastSchemaCheck >= 60000) { const fingerprint = await state.readSchemaFingerprint(); assert.equal(fingerprint, state.schemaFingerprint, 'schema_changed_during_measurement'); lastSchemaCheck = Date.now(); schemaChecks++; }
        const sample = await state.sampleTelemetry({ app: { ...info.app, sourceCommit: info.sourceCommit, instanceNonce: info.instanceNonce, buildMode: info.buildMode, buildId: info.buildId }, processes: processInfo.roots,
          resourceBudget: { allocationBytes: cfg.allocations.total, cpuAllocationCores: cfg.allocations.cpuCores }, ...collectors, egressCollector: () => egressEvidence(cfg), providerCollector: () => providerTelemetry(cfg) });
        sample.resources.caveat += ' Processes that start and exit entirely between snapshots are not included in per-process CPU deltas; shared host CPU records their aggregate effect. Native process-reader overhead and collector time are part of this isolated test, not production application throughput.';
        const fault = faultStatus(cfg); if (fault) { sample.fault = fault.activeFault; sample.recovery = fault.recovery; }
        if (processInfo.interruption) sample.workerInterruption = processInfo.interruption;
        const qualification = adapterQualification(cfg, info, state.plan);
        sample.ready = sample.ready && sample.resources.cpuCoverageComplete && qualification.ready && sample.integrity.violations.length === 0 && sample.egress.violations === 0;
        sample.phase = sample.ready ? 'ready_for_workload' : 'bootstrap_or_adapter_incomplete';
        sample.adapterQualification = qualification;
        sample.collector = { pid: process.pid, sampleNumber: ++sampleCount, wallMilliseconds: performance.now() - began, nominalIntervalMilliseconds: 1000,
          cpuAndRssIncludedInAggregate: true, generatorObserved: processInfo.generatorObserved, schemaCheckedAt: new Date(lastSchemaCheck).toISOString(), fullSchemaChecks: schemaChecks,
          runtimeSourceCommit: info.sourceCommit, checkoutCommit: state.checkoutCommit, sourceFiles, scope: 'Actual native/app/worker/provider/supervisor/collector descendants plus generator when supplied. Storage is downloaded initially and for changed revisions, catalog hashing is every 60s.' };
        atomic(telemetryFile, sample);
        const env = { kind: 'vaeroex-disposable-environment-v1', runId: cfg.runId, ready: sample.ready, syntheticOnly: true, productionDataCopied: false, sourceCommit: info.sourceCommit,
          schemaFingerprint: state.schemaFingerprint, appOrigin: cfg.appOrigin, authOrigin: new URL(state.config.apiUrl).origin, storageOrigin: new URL(state.config.apiUrl).origin,
          databaseOrigin: state.databaseOrigin, stubOrigin: cfg.stubOrigin, maxInFlight: cfg.maxInFlight || 500, scenario: cfg.scenario || 'nominal', uploadProfile:cfg.uploadProfile||'agreed_large_rows_v1', buildMode: info.buildMode,
          instanceNonce: info.instanceNonce, networkIsolation: { enforced: sample.egress.enforced, evidenceFile: sample.egress.evidenceFile }, providerMode: sample.providers.mode,
          paidCredentialsPresent: false, provisionedAt: startedAt, sourceFiles, telemetryFile, adapterQualification: qualification,
          readbackCatalogFile: cfg.readbackCatalogFile || path.join(cfg.out, 'readback-catalog.json'),
          baselineInventoryFile: cfg.baselineInventoryFile || path.join(cfg.out, 'inventory-before.json'), quietTenantBaselineFile: cfg.quietTenantBaselineFile || path.join(cfg.out, 'baseline', 'summary.json'),
          ...(cfg.faults ? { faults: cfg.faults } : {}),...(cfg.faultStartFile?{faultStartFile:cfg.faultStartFile}:{}),...(generatorPidFile?{generatorPidFile}:{}), measurement: { checkedOutCommit: state.checkoutCommit, localOnly: true, providerLatencySimulated: true, firstCpuSampleUnknown: sampleCount === 1 } };
        atomic(output, env);
      } catch (error) {
        const blocked = { runId: cfg.runId, ready: false, observedAt: new Date().toISOString(), phase: 'measurement_blocked', reason: reason(error), collector: { pid: process.pid, wallMilliseconds: performance.now() - began } };
        atomic(telemetryFile, blocked); atomic(output, { kind: 'vaeroex-disposable-environment-v1', ...blocked }); throw error;
      }
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, Math.max(0, 1000 - (performance.now() - began)));
        signal?.addEventListener('abort', finish, { once: true }); if (signal?.aborted) finish();
      });
    }
    return { runId: cfg.runId, samples: sampleCount, telemetryFile, environmentFile: output, stopped };
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); signal?.removeEventListener('abort', stop); await state.close(); }
}
async function exportInventory(runtimeFile, output, actionsJsonl, requestsJsonl) {
  const cfg = loadRuntime(runtimeFile), state = await createState(cfg), started = performance.now();
  try {
    const info = artifactIdentity(cfg, state), actions = lines(actionsJsonl, Boolean(actionsJsonl)), requests = lines(requestsJsonl, Boolean(requestsJsonl));
    const baseline = await baselineRuns(cfg, state, { capture: !actionsJsonl && !requestsJsonl });
    assert(!actionsJsonl || baseline.captured !== false, 'pre_workload_baseline_run_inventory_missing');
    const collectors = createCollectors({ runtimeFile, state, baselineRunIds: baseline.runIds });
    const sessionResult = await refreshSessions(state, { minimumRemainingSeconds: 600 });
    const readbacksFile = cfg.readbacksFile || (requestsJsonl ? path.join(path.dirname(requestsJsonl), 'readbacks.jsonl') : null);
    const readbacks = lines(readbacksFile);
    for (const r of requests) if (r.accepted && r.kind === 'read' && Array.isArray(r.readbacks)) for (const item of r.readbacks) readbacks.push({ requestLogicalId: r.logicalId, actorId: r.actorId, ...item });
    const requested = new Set(requests.map(r => `${r.logicalId}:${r.actorId}`));
    for (const r of readbacks) assert(requested.has(`${r.requestLogicalId}:${r.actorId}`), 'unmatched_response_readback');
    const primary = await collectors.primaryResolver({ db: state.db, plan: state.plan, actions });
    const mutationReadbacks = primary.mappings.map(m => { const action = actions.find(a => a.logicalId === m.logicalId); assert(action && action.workspaceId === m.workspaceId, 'mutation_scope_mismatch'); return { requestLogicalId: action.logicalId, actorId: action.actorId, recordTable: m.table, recordId: m.id }; });
    const inventory = await state.exportInventory({ actions, requests, readbacks: [...readbacks, ...mutationReadbacks], primaryResolver: async () => primary, jobCollector: collectors.jobCollector });
    const integrity = await collectors.integrityCollector({ db: state.db, plan: state.plan, draining: true });
    inventory.measurement = { sourceCommit: info.sourceCommit, checkoutCommit: state.checkoutCommit, wallMilliseconds: performance.now() - started, sessionVerification: sessionResult,
      readbacksFile: readbacksFile || null, suppliedReadbacks: readbacks.length, persistedMutationActorReads: mutationReadbacks.length,
      baselineRunInventory: cfg.baselineRunIdsFile || path.join(cfg.out, 'baseline-runs.private.json'), integrity,
      limitations: 'Response-linked readback mappings are mandatory; none are inferred from an HTTP success. Current Auth/PostgREST visibility is independently checked for every supplied record and persisted primary mutation. Final snapshot requires stopped admission and completed drain.' };
    const serialized = JSON.stringify(inventory); assert(Buffer.byteLength(serialized) <= 256 * 1024 ** 2, 'inventory_requires_sharded_verifier');
    assert(!fs.existsSync(output), 'inventory_output_exists'); atomic(output, inventory);
    return { runId: cfg.runId, output, rows: inventory.rows.length, objects: inventory.objects.length, jobs: inventory.jobs.length, completeness: inventory.completeness,
      requestReadbacksComplete: inventory.requestReadbacksComplete, integrityViolations: integrity.violations.length, wallMilliseconds: inventory.measurement.wallMilliseconds };
  } finally { await state.close(); }
}
module.exports = { collectTelemetry, exportInventory, refreshSessions, nativeRoot, artifactIdentity, adapterQualification, egressEvidence, providerTelemetry, loadRuntime, createState, atomic, lines };
if (require.main === module) (async () => {
  const [runtimeFile, command, output, first, second] = process.argv.slice(2);
  assert(runtimeFile && output && ['telemetry', 'inventory', 'refresh'].includes(command), 'usage_runtime_telemetry_environment_generatorpid_or_inventory_output_actions_requests');
  let result;
  if (command === 'telemetry') result = await collectTelemetry(runtimeFile, output, first);
  else if (command === 'inventory') result = await exportInventory(runtimeFile, output, first, second);
  else { const cfg = loadRuntime(runtimeFile), state = await createState(cfg); try { result = await refreshSessions(state, { minimumRemainingSeconds: Number(output) }); } finally { await state.close(); } }
  console.log(JSON.stringify(result));
})().catch(e => { console.error(JSON.stringify({ kind: 'capacity_measurement_blocked', reason: reason(e), preservedFixtures: true })); process.exitCode = 1; });
