/* eslint-disable @typescript-eslint/no-require-imports -- Owned isolated Health qualification only. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const { prepare } = require('./workspace-capacity-environment.cjs');
const { validate, inspectStatus, openOwnedDatabase } = require('./workspace-capacity-confine-stack.cjs');
const root = path.resolve(__dirname, '..');
const read = file => { assert.equal(fs.statSync(file).mode & 0o077, 0); return JSON.parse(fs.readFileSync(file)); };
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (result, label) => { assert(!result.error, label + ':' + (result.error?.code || result.error?.status || 'failed')); return result.data; };
async function denyNetwork() {
  const result = await new Promise(resolve => { const s = require('node:net').connect({ host: '192.0.2.1', port: 9 }); s.once('connect', () => { s.destroy(); resolve('connected'); }); s.once('error', e => resolve(e.code)); s.setTimeout(1000, () => { s.destroy(); resolve('timeout'); }); });
  assert.equal(result, 'EPERM', 'kernel_local_only_profile_required'); return result;
}
function client(config, key) {
  const origin = new URL(config.apiUrl); assert.equal(origin.hostname, '127.0.0.1');
  const safeFetch = (input, options = {}) => { assert.equal(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).origin, origin.origin); return fetch(input, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); };
  return { admin: createClient(config.apiUrl, key || config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } }), safeFetch };
}
async function setup(configFile, out) {
  assert(!fs.existsSync(out), 'fresh_output_required'); fs.mkdirSync(out, { mode: 0o700 });
  const runId = randomUUID(), workspaces = ['current', 'stale', 'empty', 'foreign', 'unentitled'].map(kind => ({ id: randomUUID(), kind, label: `SYNTHETIC HEALTH ${runId.slice(0, 8)} ${kind}` }));
  const actors = workspaces.map(w => ({ id: randomUUID(), workspaceId: w.id, kind: w.kind, role: 'owner' }));
  actors.push({ id: randomUUID(), workspaceId: workspaces[0].id, kind: 'viewer', role: 'viewer' });
  for (const a of actors) { a.email = `health-${a.id}@example.invalid`; a.password = randomBytes(28).toString('base64url'); }
  const plan = { runId, kind: 'isolated_health_functional_v1', syntheticOnly: true, asOf: new Date().toISOString(), workspaces, actors, capacityClaim: false };
  const planFile = path.join(out, 'plan.private.json'); write(planFile, plan);
  return prepare(configFile, planFile, out);
}
async function inventory(db, ids, exclude = false) {
  const output = {};
  for (const table of ['workspaces', 'business_health_snapshots', 'ai_agent_runs', 'reports', 'kpis', 'kpi_settings', 'file_uploads', 'sops']) {
    const column = table === 'workspaces' ? 'id' : 'workspace_id';
    const rows = (await db.query(`select count(*)::text count,coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text hash0,coalesce(sum(hashtextextended(to_jsonb(t)::text,1)::numeric),0)::text hash1 from public.${table} t where ${exclude ? 'not ' : ''}(${column}=any($1::uuid[]))`, [ids])).rows;
    output[table] = rows[0];
  }
  return output;
}
async function verifyLedger(db) {
  const versions = (await db.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r => r.version);
  const expected = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => /^\d+_.*\.sql$/.test(f)).map(f => f.split('_')[0]).sort();
  assert.deepEqual(versions, expected, 'local_canonical_ledger_mismatch');
  const retained = JSON.parse(fs.readFileSync(path.join(root, 'docs/security/audit-evidence/capacity-closeout/baseline-keyset-source-manifest.json')));
  const schemaFingerprint = await require('./workspace-capacity-state.cjs').CapacityState.prototype.readSchemaFingerprint.call({ db });
  assert.equal(schemaFingerprint, retained.schemaFingerprint, 'retained_schema_fingerprint_mismatch');
  return { migrationCount: versions.length, migrationVersionsSha256: hash(JSON.stringify(versions)), schemaFingerprint, exactRepositoryVersions: true, retainedCapacitySchemaMatched: true, productionPrefixDifferent: true };
}
async function session(config, actor, runtime) {
  const { safeFetch } = client(config), jar = new Map();
  const auth = createServerClient(config.apiUrl, config.anonKey, { auth: { autoRefreshToken: false }, global: { fetch: safeFetch }, cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(v => jar.set(v.name, v.value)) } });
  const login = check(await auth.auth.signInWithPassword({ email: actor.email, password: actor.password }), 'synthetic_login');
  assert.equal(login.user.id, actor.id); assert.equal(login.user.app_metadata.health_qualification_run, runtime.runId);
  jar.set('vaeroex_workspace_id', actor.workspaceId);
  return { cookies: [...jar].map(([name, value]) => ({ name, value, url: runtime.appOrigin, sameSite: 'Lax' })), accessToken: login.session.access_token };
}
async function seed(runtimeFile) {
  await denyNetwork(); const runtime = read(runtimeFile), ctx = validate(runtime.configFile, runtimeFile), plan = read(runtime.planFile);
  assert.equal(plan.kind, 'isolated_health_functional_v1'); assert(!fs.existsSync(path.join(runtime.out, 'fixtures-ready.json')), 'refuse_reseed');
  await inspectStatus(ctx); const { db } = await openOwnedDatabase(ctx); const { admin } = client(ctx.config);
  try {
    write(path.join(runtime.out, 'native-identity.json'), await verifyLedger(db));
    const ids = plan.workspaces.map(w => w.id), before = await inventory(db, ids, true);
    assert.equal(Number((await db.query('select count(*) n from public.workspaces where id=any($1::uuid[])', [ids])).rows[0].n), 0, 'new_workspace_ids_required');
    write(path.join(runtime.out, 'fixture-progress.private.json'), { phase: 'seed_started', runId: plan.runId });
    for (const a of plan.actors) check(await admin.auth.admin.createUser({ id: a.id, email: a.email, password: a.password, email_confirm: true, app_metadata: { synthetic: true, health_qualification_run: plan.runId }, user_metadata: { full_name: `SYNTHETIC HEALTH ${a.kind}` } }), 'create_owned_actor');
    const legalSource = fs.readFileSync(path.join(root, 'lib/legal/content.ts'), 'utf8'), legal = key => new RegExp(key + ': "([\\d-]+)"').exec(legalSource)[1];
    const ago = days => new Date(Date.parse(plan.asOf) - days * 86400000).toISOString();
    for (const w of plan.workspaces) {
      const members = plan.actors.filter(a => a.workspaceId === w.id), owner = members.find(a => a.role === 'owner'), entitled = w.kind !== 'unentitled';
      check(await admin.from('workspaces').insert({ id: w.id, name: w.label, created_by: owner.id, primary_contact_email: owner.email, industry: 'Synthetic functional qualification', reporting_timezone: 'UTC', subscription_required: true, subscription_status: entitled ? 'active' : 'expired', manually_unlocked: entitled, plan_slug: 'vaeroex', trial_ends_at: ago(2) }), 'workspace');
      check(await admin.from('workspace_members').insert(members.map(a => ({ workspace_id: w.id, user_id: a.id, role: a.role, status: 'active' }))), 'members');
      if (entitled) check(await admin.from('customer_subscriptions').insert({ user_id: owner.id, workspace_id: w.id, customer_email: owner.email, customer_name: w.label, source: 'manual', billing_provider: 'manual', status: 'active', plan_slug: 'vaeroex', manually_activated: true, notes: `SYNTHETIC HEALTH ${plan.runId}` }), 'entitlement');
      check(await admin.from('legal_acceptances').insert(members.map(a => ({ user_id: a.id, workspace_id: w.id, terms_version: legal('terms'), privacy_version: legal('privacy'), ai_disclaimer_version: legal('aiDisclaimer'), sensitive_data_policy_version: legal('sensitiveData'), user_email: a.email, user_agent: 'Synthetic Health qualification; fixture acceptance only' }))), 'legal');
      if (['empty', 'unentitled'].includes(w.kind)) continue;
      const offset = w.kind === 'stale' ? 80 : 0, at = ago(offset), sourceId = randomUUID(), bytes = Buffer.from(`Date,Revenue,Marker\n${at.slice(0, 10)},140,${w.label}\n`), storagePath = `${w.id}/health-${plan.runId}/${sourceId}.csv`;
      check(await admin.storage.from('workspace-files').upload(storagePath, bytes, { contentType: 'text/csv', upsert: false }), 'synthetic_source_object');
      check(await admin.from('file_uploads').insert({ id: sourceId, workspace_id: w.id, original_name: 'synthetic-health.csv', display_name: w.label + ' source', file_extension: 'csv', mime_type: 'text/csv', file_size_bytes: bytes.length, storage_bucket: 'workspace-files', storage_path: storagePath, import_status: 'imported', processing_status: 'uploaded', metadata_json: { synthetic: true, health_qualification_run: plan.runId }, created_by: owner.id, created_at: at, updated_at: at }), 'source_metadata');
      w.source = { id: sourceId, path: storagePath, sha256: hash(bytes) };
      check(await admin.from('sops').insert({ id: randomUUID(), workspace_id: w.id, title: w.label + ' procedure', body_markdown: 'Synthetic source supporting qualification only.', status: 'Draft', version: 1, created_by: owner.id, created_at: at, updated_at: at }), 'source_diversity');
      const name = w.label + ' Revenue';
      check(await admin.from('kpi_settings').insert({ workspace_id: w.id, kpi_name: name, category: 'Financial', target: 100, weight: 1, is_visible: true, canonical_name: name, original_source_label: name, semantic_unit: 'USD', semantic_scale: 1, aggregation_basis: 'sum', period_basis: 'day', desired_direction: 'maximize', target_behavior: 'minimum_goal', metric_role: 'actual', classification_source: 'user', classification_confidence: 1, classification_confirmed: true, classification_rationale: 'Confirmed synthetic qualification, no model call.', created_by: owner.id, created_at: at, updated_at: at }), 'confirmed_kpi');
      check(await admin.from('kpis').insert([0, 1, 2, 4, 7, 14].map((days, i) => ({ id: randomUUID(), workspace_id: w.id, name, category: 'Financial', target: 100, actual_value: 140 - i * 7, metric_date: ago(offset + days).slice(0, 10), source: 'Synthetic Health CSV', source_file_id: sourceId, raw_data_json: { synthetic: true, health_qualification_run: plan.runId }, created_by: owner.id, created_at: ago(offset + days), updated_at: ago(offset + days) }))), 'kpi_history');
      check(await admin.from('business_health_snapshots').insert([0, 1, 3, 10, 45, 100, 150, 210].map((days, i) => ({ id: randomUUID(), workspace_id: w.id, snapshot_date: ago(days).slice(0, 10), score: 70 + i, status: 'Watch', trend: 'Stable', data_confidence: 'Medium', data_quality_score: 65, memory_signal_count: 6, source_summary: { synthetic: true, health_qualification_run: plan.runId, business_health_calculation_version: i < 3 ? 'business_health_calculation_v2' : 'business_health_calculation_v1' }, created_at: ago(days), updated_at: ago(days) }))), 'versioned_history');
      const citations = [{ citationId: 1, title: w.label + ' preserved citation', sourceLabel: 'Synthetic imported source', sourceType: 'CSV', excerpt: 'Synthetic historical evidence must remain unchanged.', recordedAt: ago(5) }];
      const artifact = { contractId: 'business_health_explanation_v1', contractVersion: 'business_health_explanation_v1', validatorVersion: 'business_health_explanation_validator_v1', fingerprint: hash(w.id + ':historical'), generatedAt: ago(5), analysis: { executive_interpretation: w.label + ' preserved historical analysis [1].', why_it_matters: 'Synthetic history remains distinguishable from the current calculation [1].', leadership_consideration: 'Review the current supporting evidence before acting [1].', provisional_hypothesis: null }, facts: { available: true, score: 70, status: 'Watch', trajectory: 'Stable', comparison: 'Stored historical review', comparisonDelta: null, dataQualityBase: 50, riskPenalty: 0, opportunityAdjustment: 20, confidence: 'Medium', freshness: 'current', latestEvidenceAt: ago(5), deterministicSummary: 'Synthetic historical facts.', drivers: [], limitations: ['Synthetic preserved artifact; no live model qualification.'] }, citations, providerAttribution: { provider: 'openai', model: 'synthetic-unexecuted', fallbackUsed: false, providerPolicyId: 'synthetic-history-only' } };
      const runId = randomUUID();
      await db.query("insert into public.ai_agent_runs(id,workspace_id,agent_type,status,input_json,output_json,created_by,created_at,updated_at) values($1,$2,'business_health_explanation_v1','completed',$3::jsonb,$4::jsonb,$5,$6,$6)", [runId, w.id, JSON.stringify({ fingerprint: artifact.fingerprint }), JSON.stringify(artifact), owner.id, ago(5)]);
      w.reportId = randomUUID(); w.historicalRunId = runId;
      const envelope = { record_kind: 'saved_analysis', envelope_version: 1, saved_analysis_key: hash(runId), workspace_id: w.id, release_channel: 'development', analysis_type: 'business_health', title: w.label + ' saved review', source_artifact: { id: runId, workflow: 'business_health_explanation_v1', contract_id: artifact.contractId, contract_version: artifact.contractVersion, validator_version: artifact.validatorVersion, policy_id: 'synthetic-history-only' }, provider_attribution: { provider: 'openai', model: 'synthetic-unexecuted', fallback_used: false }, generated_at: ago(5), saved_at: ago(4), confidence: 'Medium', freshness: 'current', evidence_fingerprint: artifact.fingerprint, citations, evidence_lineage: citations, display: { summary_label: 'Historical review', summary: artifact.analysis.executive_interpretation, sections: [{ id: 'context', label: 'Context', body: artifact.analysis.why_it_matters }], evidence_status: 'Preserved synthetic evidence', date_range: null, business_health_state: 'Watch' }, artifact };
      check(await admin.from('reports').insert({ id: w.reportId, workspace_id: w.id, title: envelope.title, report_type: 'Business Health', body_markdown: envelope.display.summary, source_data_json: envelope, created_by: owner.id }), 'saved_report');
    }
    assert.deepEqual(await inventory(db, ids, true), before, 'prior_fixture_records_changed');
    write(runtime.planFile, plan); write(path.join(runtime.out, 'fixtures-ready.json'), { runId: plan.runId, at: new Date().toISOString(), workspaces: 5, actors: 6, sourceFiles: 3, kpiRows: 18, historyRows: 24, historicalArtifacts: 3, savedAnalyses: 3, priorRecordsUnchanged: true, productionTouched: false, capacityClaim: false });
    write(path.join(runtime.out, 'history-baseline.private.json'), await inventory(db, ids));
    return { ready: true, output: runtime.out, capacityClaim: false };
  } finally { await db.end(); }
}
module.exports = { read, write, hash, check, client, session, inventory, verifyLedger, denyNetwork, setup, seed };
if (require.main === module) (async () => { const [op, ...args] = process.argv.slice(2); assert(['prepare', 'seed'].includes(op)); console.log(JSON.stringify(await (op === 'prepare' ? setup(...args) : seed(...args)))); })().catch(error => { console.error(JSON.stringify({ failed: true, reason: /^[a-z_]+(?::[a-zA-Z0-9_]+)?$/.test(error.message) ? error.message : 'health_fixture_assertion_failed' })); process.exitCode = 1; });
