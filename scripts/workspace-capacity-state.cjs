/* eslint-disable @typescript-eslint/no-require-imports -- Owned local capacity fixture/telemetry adapter. */
// Real local Supabase only. No production configuration, provider calls, deletion,
// migration or application deployment. Credentials and sessions stay in 0600 files.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const ROOT = path.resolve(__dirname, '..');
const MAX_BYTES = 8 * 1024 ** 3;
function readProcessMetrics(binary, pids) {
  assert(path.isAbsolute(binary) && fs.statSync(binary).isFile(), 'native_process_reader_required');
  assert(pids.length > 0 && pids.length <= 32 && pids.every(p => Number.isInteger(p) && p > 0), 'process_roots_required');
  const result = spawnSync(binary, pids.map(String), { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, 'native_process_read_failed'); const metrics = JSON.parse(result.stdout);
  assert.equal(metrics.source, 'darwin_libproc_same_uid'); assert.equal(metrics.missingRoots, 0); for (const p of metrics.processes) { p.startTimestamp = new Date(p.startSeconds * 1000 + Math.floor(p.startMicroseconds / 1000)).toISOString(); p.startedAtUnixMs = p.startSeconds * 1000 + p.startMicroseconds / 1000; } return metrics;
}
const sha = value => createHash('sha256').update(value).digest('hex');
const qi = value => '"' + String(value).replaceAll('"', '""') + '"';
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function privateJson(file) { assert.equal(fs.statSync(file).mode & 0o077, 0, 'private_configuration_required'); return json(file); }
function writePrivate(file, value, exclusive = false) {
  if (fs.existsSync(file)) assert(!fs.lstatSync(file).isSymbolicLink(), 'output_symlink_denied');
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' });
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'private_output_required');
}
function loopback(raw, protocols, allowQuery = false) {
  const u = new URL(raw); assert(protocols.includes(u.protocol), 'local_protocol_required');
  assert(['127.0.0.1', '[::1]'].includes(u.hostname) && u.port, 'literal_loopback_port_required');
  assert((allowQuery || !u.search) && !u.hash, 'url_override_denied'); return u;
}
function validatePlan(plan) {
  assert(plan.kind === 'vaeroex-isolated-workload-v1' && /^[a-f0-9-]{36}$/.test(plan.runId), 'synthetic_plan_required');
  assert([10, 100, 250, 500].includes(plan.activeUsers), 'bounded_scale_required');
  assert.equal(plan.workspaces.length, plan.activeUsers / 5, 'workspace_scale');
  assert.equal(plan.actors.length, plan.workspaces.length * 10, 'actor_scale');
  assert.equal(new Set(plan.actors.map(a => a.id)).size, plan.actors.length, 'unique_actors_required');
  assert.equal(new Set(plan.workspaces.map(w => w.id)).size, plan.workspaces.length, 'unique_workspaces_required');
  for (const w of plan.workspaces) {
    const members = plan.actors.filter(a => a.workspaceId === w.id);
    assert.equal(members.length, 10); assert.equal(members.filter(a => a.active).length, 5); assert.equal(members.filter(a => a.role === 'owner').length, 1);
  }
  for (const a of plan.actors) assert(/^[a-f0-9-]{36}$/.test(a.id) && a.email.endsWith('@example.invalid') && ['owner', 'admin', 'manager', 'staff', 'viewer'].includes(a.role), 'synthetic_actor_required');
  assert.equal(plan.corpus.activeFilesPerWorkspace, 200, 'normal_full_corpus_required');
  assert.equal(plan.corpus.archivedFilesPerWorkspace, 0, 'growth_requires_separate_quota_qualification');
  assert.equal(plan.corpus.kpiObservationsPerWorkspace, 10000); assert.equal(plan.corpus.historyMonths, 24);
  assert(Number.isFinite(Date.parse(plan.asOf)), 'fixture_clock_required');
}
function createPlan({ activeUsers = 10, runId = randomUUID(), asOf = new Date().toISOString() } = {}) {
  const workspaces = [], actors = [];
  for (let w = 0; w < activeUsers / 5; w++) {
    const id = randomUUID(); workspaces.push({ id, label: `SYNTHETIC-CAPACITY-${runId}-W${w}`, sheetsConnectionId: null });
    for (let a = 0; a < 10; a++) actors.push({ id: randomUUID(), workspaceId: id, email: `capacity-${runId}-${w}-${a}@example.invalid`, role: a === 0 ? 'owner' : a < 5 ? 'manager' : a < 8 ? 'staff' : 'viewer', active: a < 5 });
  }
  const plan = { kind: 'vaeroex-isolated-workload-v1', runId, asOf, activeUsers, qualificationTarget: activeUsers >= 100 ? activeUsers : null,
    corpus: { activeFilesPerWorkspace: 200, archivedFilesPerWorkspace: 0, kpiObservationsPerWorkspace: 10000, historyMonths: 24, activeFixtureBytes: 40960 },
    actionsPerUserPerMinute: 6, durationSeconds: 1500, rampSeconds: 120, steadySeconds: 1200, drainSeconds: 180, workspaces, actors };
  validatePlan(plan); return plan;
}
const check = (result, code) => { assert(!result.error, code + (result.error?.code ? ':' + result.error.code : '')); return result.data; };
async function boundedMap(items, concurrency, fn) {
  let cursor = 0; const output = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { for (;;) { const index = cursor++; if (index >= items.length) return; output[index] = await fn(items[index], index); } })); return output;
}
function sourceCommit() { const p = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(p.status, 0); const head = p.stdout.trim(); assert(/^[a-f0-9]{40}$/.test(head)); return head; }
class CapacityState {
  constructor(config, plan, outputDir) {
    this.config = config; this.plan = plan; this.outputDir = outputDir; this.ids = plan.workspaces.map(w => w.id); this.actorIds = plan.actors.map(a => a.id);
    this.apiOrigin = loopback(config.apiUrl, ['http:', 'https:']).origin;
    const u = loopback(config.dbUrl, ['postgres:', 'postgresql:']); this.databaseOrigin = `postgresql://${u.host}`;
    this.safeFetch = (input, init = {}) => { const target = loopback(typeof input === 'string' || input instanceof URL ? input : input.url, ['http:', 'https:'], true); assert.equal(target.origin, this.apiOrigin, 'supabase_origin_only'); return fetch(input, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); };
    this.admin = createClient(config.apiUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: this.safeFetch } });
    this.db = new Client({ connectionString: config.dbUrl, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 30000, query_timeout: 35000, application_name: `capacity-state-${plan.runId.slice(0, 8)}` });
    this.sessionsFile = path.join(outputDir, 'sessions.private.json'); this.progressFile = path.join(outputDir, 'seed-progress.private.json');
    this.progress = { kind: 'real_local_fixture_seed', runId: plan.runId, localStackRunId: config.runId, phase: 'unseeded', createdUsers: [], createdWorkspaces: [], corpus: [], bytesWritten: 0, completed: false, providerFixturesReady: false, legalAcceptanceReady: false };
    this.sessions = { runId: plan.runId, anonKey: config.anonKey, actors: {} }; this.verifiedObjects = new Map(); this.previousCpu = null;
  }
  async open() {
    await this.db.connect();
    const identity = (await this.db.query("select current_database() db,current_setting('data_directory') directory,current_setting('server_version') version,current_setting('max_connections')::int max_connections,inet_server_addr()::text ip")).rows[0];
    assert.equal(identity.db, 'postgres'); assert(['127.0.0.1/32', '::1/128', '127.0.0.1', '::1', null].includes(identity.ip), 'local_database_address_required');
    const home = fs.realpathSync(this.config.ownedSupabaseHome); assert(/^\/(?:private\/)?tmp\/vaeroex-closeout-assembly-[a-zA-Z0-9-]+\/home$/.test(home), 'owned_supabase_home_required');
    assert(fs.realpathSync(identity.directory).startsWith(home + '/stacks/'), 'owned_database_directory_required');
    this.identity = { database: identity.db, version: identity.version, maxConnections: identity.max_connections, ownedDataDirectory: identity.directory, localStackRunId: this.config.runId };
    this.schemaFingerprint = await this.readSchemaFingerprint(); this.commit = sourceCommit();
    if (fs.existsSync(this.progressFile)) { this.progress = privateJson(this.progressFile); assert.equal(this.progress.runId, this.plan.runId); }
    if (fs.existsSync(this.sessionsFile)) { this.sessions = privateJson(this.sessionsFile); assert.equal(this.sessions.runId, this.plan.runId); }
    return this;
  }
  async close() { await this.db.end(); }
  async readSchemaFingerprint() {
    const queries = [
      "select version from supabase_migrations.schema_migrations order by version",
      "select n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) typ,a.attnotnull from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1,2,a.attnum",
      "select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind in ('f','p') order by 1,2,3",
      "select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','private','storage') order by 1,2,3",
      "select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) def,k.convalidated from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') order by 1,2,3",
      "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','private','storage') order by 1,2,3",
      "select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and not t.tgisinternal order by 1,2,3"
    ];
    const parts = []; for (const q of queries) parts.push((await this.db.query(q)).rows); return sha(JSON.stringify(parts));
  }
  saveProgress() { writePrivate(this.progressFile, this.progress); writePrivate(this.sessionsFile, this.sessions); }
  async seedFixtures() {
    assert.equal(this.progress.phase, 'unseeded', 'refuse_reseed_or_partial_resume');
    assert.equal((await this.db.query('select count(*)::int n from public.workspaces where id=any($1::uuid[])', [this.ids])).rows[0].n, 0, 'new_cohort_only');
    this.progress.phase = 'creating_auth'; this.saveProgress();
    for (const actor of this.plan.actors) {
      const password = randomBytes(32).toString('base64url');
      const data = check(await this.admin.auth.admin.createUser({ id: actor.id, email: actor.email, password, email_confirm: true, user_metadata: { full_name: `SYNTHETIC CAPACITY ${actor.id}` }, app_metadata: { audit_run_id: this.plan.runId, synthetic: true } }), 'seed_auth');
      assert.equal(data.user.id, actor.id); this.progress.createdUsers.push(actor.id);
      if (actor.active) {
        const jar = new Map(); const client = createServerClient(this.config.apiUrl, this.config.anonKey, { global: { fetch: this.safeFetch }, auth: { autoRefreshToken: false }, cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(c => jar.set(c.name, c.value)) } });
        const login = check(await client.auth.signInWithPassword({ email: actor.email, password }), 'seed_login'); jar.set('vaeroex_workspace_id', actor.workspaceId);
        this.sessions.actors[actor.id] = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), accessToken: login.session.access_token, refreshToken: login.session.refresh_token, expiresAt: new Date(login.session.expires_at * 1000).toISOString() };
      }
      this.saveProgress();
    }
    const legalSource = fs.readFileSync(path.join(ROOT, 'lib/legal/content.ts'), 'utf8'); const legal = key => { const m = new RegExp(key + ': "([\\d-]+)"').exec(legalSource); assert(m, 'legal_version_missing'); return m[1]; };
    this.progress.phase = 'seeding_workspaces';
    for (const workspace of this.plan.workspaces) {
      const members = this.plan.actors.filter(a => a.workspaceId === workspace.id), owner = members.find(a => a.role === 'owner');
      check(await this.admin.from('workspaces').insert({ id: workspace.id, name: workspace.label, created_by: owner.id, primary_contact_email: owner.email, industry: 'Synthetic capacity fixture', subscription_required: true, subscription_status: 'active', manually_unlocked: true, plan_slug: 'vaeroex', reporting_timezone: 'UTC' }), 'seed_workspace');
      this.progress.createdWorkspaces.push(workspace.id); this.saveProgress();
      check(await this.admin.from('workspace_members').insert(members.map(a => ({ workspace_id: workspace.id, user_id: a.id, role: a.role, status: 'active' }))), 'seed_members');
      check(await this.admin.from('customer_subscriptions').insert({ user_id: owner.id, workspace_id: workspace.id, customer_email: owner.email, customer_name: workspace.label, source: 'manual', billing_provider: 'manual', status: 'active', plan_slug: 'vaeroex', manually_activated: true, notes: `SYNTHETIC ${this.plan.runId}` }), 'seed_entitlement');
      check(await this.admin.from('legal_acceptances').insert(members.map(a => ({ user_id: a.id, workspace_id: workspace.id, terms_version: legal('terms'), privacy_version: legal('privacy'), ai_disclaimer_version: legal('aiDisclaimer'), sensitive_data_policy_version: legal('sensitiveData'), user_email: a.email, user_agent: 'Synthetic capacity fixture; explicit seeded acceptance, no consent interaction' }))), 'seed_legal');
      check(await this.admin.from('issues').insert(Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), workspace_id: workspace.id, title: `SYNTHETIC ${this.plan.runId} baseline ${i}`, description: 'Synthetic capacity baseline', severity: i % 3 ? 'Medium' : 'High', status: i % 4 ? 'Open' : 'Closed', created_by: owner.id }))), 'seed_issues');
      check(await this.admin.from('sops').insert(Array.from({ length: 3 }, (_, i) => ({ id: randomUUID(), workspace_id: workspace.id, title: `SYNTHETIC ${this.plan.runId} procedure ${i}`, body_markdown: 'Synthetic procedure. No customer information.', status: 'Draft', version: 1, created_by: owner.id }))), 'seed_sops');
      const formId = randomUUID(); check(await this.admin.from('forms').insert({ id: formId, workspace_id: workspace.id, name: `SYNTHETIC ${this.plan.runId} capacity form`, schema_json: [{ key: 'equipment', label: 'Equipment', type: 'text', required: true }], created_by: owner.id }), 'seed_form');
      workspace.formId = formId;
      await this.seedCorpus(workspace, owner); this.saveProgress();
    }
    this.progress.phase = 'corpus_seeded_provider_pending'; this.progress.completed = true; this.progress.legalAcceptanceReady = true; this.saveProgress();
    writePrivate(path.join(this.outputDir, 'plan.json'), this.plan);
    return { kind: 'capacity_seed_result', runId: this.plan.runId, phase: this.progress.phase, registeredUsers: this.progress.createdUsers.length, activeUsers: this.plan.activeUsers, workspaces: this.progress.createdWorkspaces.length, corpus: this.progress.corpus, bytesWritten: this.progress.bytesWritten, providerFixturesReady: false, readyForLoad: false, sessionsFile: this.sessionsFile, sourceCommit: this.commit, schemaFingerprint: this.schemaFingerprint };
  }
  async seedCorpus(workspace, owner) {
    const sourceIds = [];
    for (let i = 0; i < 200; i++) {
      const id = randomUUID(), line = `2026-09-01,100,SYNTHETIC-${id}\n`, bytes = Buffer.from('date,Revenue,Marker\n' + line.repeat(Math.ceil(40960 / line.length)));
      const storagePath = `${workspace.id}/capacity-${this.plan.runId}/${id}.csv`; assert(this.progress.bytesWritten + bytes.length <= MAX_BYTES, 'storage_budget_exceeded');
      check(await this.admin.storage.from('workspace-files').upload(storagePath, bytes, { contentType: 'text/csv', upsert: false }), 'seed_storage'); this.progress.bytesWritten += bytes.length;
      check(await this.admin.from('file_uploads').insert({ id, workspace_id: workspace.id, original_name: `SYNTHETIC-${id}.csv`, display_name: `SYNTHETIC ${this.plan.runId} source ${i}`, file_extension: 'csv', mime_type: 'text/csv', file_size_bytes: bytes.length, storage_bucket: 'workspace-files', storage_path: storagePath, import_status: 'imported', processing_status: 'uploaded', metadata_json: { audit_run_id: this.plan.runId, synthetic: true, fixture_seed: true }, created_by: owner.id }), 'seed_file');
      sourceIds.push(id); if (i % 25 === 0) this.saveProgress();
    }
    check(await this.admin.from('kpi_settings').insert(Array.from({ length: 20 }, (_, i) => ({ workspace_id: workspace.id, kpi_name: `Synthetic Revenue ${i}`, category: 'Financial', target: 100, weight: 1, is_visible: true, canonical_name: `Synthetic Revenue ${i}`, original_source_label: `Synthetic Revenue ${i}`, semantic_unit: 'USD', semantic_scale: 1, aggregation_basis: 'sum', period_basis: 'day', desired_direction: i % 2 ? 'minimize' : 'maximize', target_behavior: i % 2 ? 'maximum_limit' : 'minimum_goal', metric_role: 'actual', classification_source: 'user', classification_confidence: 1, classification_confirmed: true, classification_rationale: 'Confirmed synthetic fixture; no model call.', created_by: owner.id }))), 'seed_settings');
    const anchor = Date.parse(this.plan.asOf);
    for (let offset = 0; offset < 10000; offset += 500) {
      const records = Array.from({ length: 500 }, (_, j) => { const i = offset + j, metric = i % 20, day = Math.floor(Math.floor(i / 20) * 730 / 499); return { id: randomUUID(), workspace_id: workspace.id, name: `Synthetic Revenue ${metric}`, category: 'Financial', target: 100, actual_value: 80 + i % 45, metric_date: new Date(anchor - day * 86400000).toISOString().slice(0, 10), source: 'Synthetic CSV fixture', source_file_id: sourceIds[i % sourceIds.length], raw_data_json: { audit_run_id: this.plan.runId, synthetic: true, fixture_row: i }, created_by: owner.id }; });
      check(await this.admin.from('kpis').insert(records), 'seed_kpis');
    }
    this.progress.corpus.push({ workspaceId: workspace.id, activeFiles: 200, archivedFiles: 0, kpiObservations: 10000, historyDays: 730, formId: workspace.formId });
  }
  actorClient(actorId) {
    const session = this.sessions.actors[actorId]; assert(session?.accessToken, 'actor_session_required');
    return createClient(this.config.apiUrl, this.config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: this.safeFetch, headers: { Authorization: `Bearer ${session.accessToken}` } } });
  }
  async fixtureMetadata({ providerFixtureVerifier } = {}) {
    const counts = (await this.db.query(`select w.id as "workspaceId",(select count(*)::int from public.file_uploads f where f.workspace_id=w.id and f.deleted_at is null and f.archived_at is null and f.metadata_json->>'audit_run_id'=$2 and f.metadata_json->>'fixture_seed'='true') as "activeFiles",(select count(*)::int from public.file_uploads f where f.workspace_id=w.id and f.archived_at is not null and f.metadata_json->>'audit_run_id'=$2 and f.metadata_json->>'fixture_seed'='true') as "archivedFiles",(select count(*)::int from public.kpis k where k.workspace_id=w.id) as "kpiObservations",(select count(*)::int from public.kpi_settings k where k.workspace_id=w.id and k.classification_confirmed) as "confirmedMetricDefinitions",(select coalesce(max(metric_date)-min(metric_date),0) from public.kpis k where k.workspace_id=w.id) as "historyDays" from public.workspaces w where id=any($1::uuid[]) order by id`, [this.ids, this.plan.runId])).rows;
    for (const c of counts) { c.verifiedStorageObjects = [...this.verifiedObjects.values()].filter(o => o.workspaceId === c.workspaceId && o.fixtureSeed === true).length; c.verifiedTotalStorageObjects = [...this.verifiedObjects.values()].filter(o => o.workspaceId === c.workspaceId).length; }
    const registered = (await this.db.query('select count(*)::int n from auth.users where id=any($1::uuid[]) and raw_app_meta_data->>\'audit_run_id\'=$2', [this.actorIds, this.plan.runId])).rows[0].n;
    const legalCount = (await this.db.query('select count(distinct user_id)::int n from public.legal_acceptances where workspace_id=any($1::uuid[]) and user_id=any($2::uuid[])', [this.ids, this.actorIds])).rows[0].n;
    const provider = providerFixtureVerifier ? await providerFixtureVerifier({ db: this.db, plan: this.plan }) : { ready: false, reason: 'provider_verifier_missing' };
    return { runId: this.plan.runId, syntheticOnly: true, corpusVerificationScope: 'Declared seed corpus; newly arriving workload objects are independently downloaded and reported in verifiedTotalStorageObjects, then fully reconciled at drain.', registeredUsers: registered, workspaces: counts.length, activeFilesPerWorkspace: Math.min(...counts.map(c => c.activeFiles)), archivedFilesPerWorkspace: Math.min(...counts.map(c => c.archivedFiles)), kpiObservationsPerWorkspace: Math.min(...counts.map(c => c.kpiObservations)), historyMonths: counts.every(c => c.historyDays >= 730) ? 24 : 0, providerFixturesReady: provider.ready === true, providerVerification: provider, legalAcceptanceReady: legalCount === this.plan.actors.length, corpus: counts };
  }
  async verifyStorage({ incremental = false } = {}) {
    const files = (await this.db.query('select id,workspace_id,storage_bucket,storage_path,file_size_bytes,metadata_json from public.file_uploads where workspace_id=any($1::uuid[]) order by id', [this.ids])).rows;
    const objects = (await this.db.query("select id,bucket_id,name,metadata,updated_at from storage.objects where split_part(name,'/',1)=any($1::text[]) order by bucket_id,name", [this.ids])).rows;
    let bytesRead = 0; const fileByPath = new Map(files.map(f => [f.storage_bucket + ':' + f.storage_path, f]));
    const verified = await boundedMap(objects, 4, async object => {
      const id = object.bucket_id + ':' + object.name, revision = sha(JSON.stringify({ id: object.id, metadata: object.metadata, updatedAt: object.updated_at }));
      const prior = this.verifiedObjects.get(id); let digest, length, verifiedAt;
      if (incremental && prior?.storageRevision === revision) { digest = prior.sha256; length = prior.bytes; verifiedAt = prior.verifiedAt; }
      else { const blob = check(await this.admin.storage.from(object.bucket_id).download(object.name), 'inventory_storage_read');
        const bytes = Buffer.from(await blob.arrayBuffer()); digest = sha(bytes); length = bytes.length; verifiedAt = new Date().toISOString(); }
      bytesRead += length; assert(bytesRead <= MAX_BYTES, 'inventory_storage_budget');
      const f = fileByPath.get(id);
      return { id, workspaceId: object.name.split('/')[0], recordTable: 'file_uploads', recordId: f?.id || null, sha256: digest, bytes: length, declaredBytes: f ? Number(f.file_size_bytes) : null, orphan: !f, fixtureSeed: f?.metadata_json?.fixture_seed === true && f?.metadata_json?.audit_run_id === this.plan.runId, storageRevision: revision, verifiedAt };
    });
    this.verifiedObjects = new Map(verified.map(o => [o.id, o])); this.storageBytes = bytesRead; return verified;
  }
  async relationCatalog() {
    const relations = (await this.db.query(`select c.oid,n.nspname as schema,c.relname as name,
      case when c.relname='workspaces' and n.nspname='public' then 'id' else 'workspace_id' end as workspace_column,
      coalesce((select jsonb_agg(a.attname order by k.ordinality) from pg_constraint p
        cross join lateral unnest(p.conkey) with ordinality k(attnum,ordinality)
        join pg_attribute a on a.attrelid=p.conrelid and a.attnum=k.attnum
        where p.conrelid=c.oid and p.contype='p'),'[]') as primary_key
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r' and
        (exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped)
          or n.nspname='public' and c.relname='workspaces') order by n.nspname,c.relname`)).rows;
    const foreignKeys = (await this.db.query(`select k.conrelid as source_oid,k.confrelid as target_oid,k.conname,
      (select jsonb_agg(a.attname order by x.n) from unnest(k.conkey) with ordinality x(attnum,n) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.attnum) as source_columns,
      (select jsonb_agg(a.attname order by x.n) from unnest(k.confkey) with ordinality x(attnum,n) join pg_attribute a on a.attrelid=k.confrelid and a.attnum=x.attnum) as target_columns
      from pg_constraint k where k.contype='f' order by k.conrelid,k.conname`)).rows;
    return { relations, foreignKeys };
  }
  async exportInventory({ actions = [], requests = [], readbacks = [], primaryResolver, jobCollector, outputFile } = {}) {
    // Export after intake has stopped. REPEATABLE READ binds rows/receipts to one
    // DB snapshot; separately downloaded Storage bytes are verified, not guessed.
    const rows = [], unresolved = [], relationCounts = [], catalog = await this.relationCatalog();
    const byOid = new Map(catalog.relations.map(r => [r.oid, r]));
    const tableName = r => r.schema === 'public' ? r.name : `${r.schema}.${r.name}`;
    const identity = parts => parts.length === 1 ? String(parts[0]) : sha(JSON.stringify(parts));
    const primary = primaryResolver ? await primaryResolver({ db: this.db, plan: this.plan, actions }) : { mappings: [], checkedLogicalIds: [] };
    assert(Array.isArray(primary.mappings) && Array.isArray(primary.checkedLogicalIds), 'primary_resolver_contract');
    const mappings = new Map(); for (const mapping of primary.mappings) {
      const key = `${mapping.table}:${mapping.id}`; assert(!mappings.has(key), 'primary_row_has_multiple_logical_ids'); mappings.set(key, mapping.logicalId);
    }
    let rawCitations;
    await this.db.query('begin isolation level repeatable read read only');
    try {
      for (const relation of catalog.relations) {
        const references = catalog.foreignKeys.filter(f => f.source_oid === relation.oid && byOid.has(f.target_oid));
        const refColumns = [...new Set(references.flatMap(f => f.source_columns))];
        const keyExpression = relation.primary_key.length ? `jsonb_build_array(${relation.primary_key.map(c => `t.${qi(c)}::text`).join(',')})` : 'null::jsonb';
        const referenceExpression = refColumns.length ? `jsonb_build_object(${refColumns.flatMap(c => ["'" + c + "'", `t.${qi(c)}::text`]).join(',')})` : "'{}'::jsonb";
        const query = `select ${keyExpression} as key_parts,t.${qi(relation.workspace_column)}::text as workspace_id,
          encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as content_hash,${referenceExpression} as references,
          ${relation.name === 'kpis' && relation.schema === 'public' ? "coalesce((t.raw_data_json->>'fixture_row') is not null,false)" : 'false'} as immutable
          from ${qi(relation.schema)}.${qi(relation.name)} t where t.${qi(relation.workspace_column)}=any($1::uuid[])`;
        await this.db.query('declare capacity_export_cursor no scroll cursor for ' + query, [this.ids]);
        let count = 0;
        for (;;) {
          const batch = (await this.db.query('fetch forward 1000 from capacity_export_cursor')).rows; if (!batch.length) break;
          for (const row of batch) {
            const id = row.key_parts ? identity(row.key_parts) : row.content_hash;
            if (!row.key_parts) unresolved.push({ table: tableName(relation), reason: 'no_primary_key', id });
            const parents = [];
            for (const reference of references) {
              const target = byOid.get(reference.target_oid);
              if (reference.source_columns.some(c => row.references[c] === null)) continue;
              const columns = Object.fromEntries(reference.target_columns.map((c, i) => [c, row.references[reference.source_columns[i]]]));
              if (target.primary_key.some(c => !Object.hasOwn(columns, c)) || !target.primary_key.length) { unresolved.push({ table: tableName(relation), id, relation: reference.conname, reason: 'foreign_key_not_primary_key' }); continue; }
              parents.push({ table: tableName(target), id: identity(target.primary_key.map(c => columns[c])) });
            }
            const item = { id, table: tableName(relation), workspaceId: row.workspace_id, contentHash: row.content_hash };
            if (row.immutable) item.immutable = true;
            if (parents.length) item.parents = parents;
            if (relation.schema === 'public' && relation.name === 'file_uploads') item.requiresStorage = true;
            const logicalId = mappings.get(`${item.table}:${id}`); if (logicalId) item.primaryLogicalId = logicalId;
            rows.push(item); count++;
          }
        }
        await this.db.query('close capacity_export_cursor'); relationCounts.push({ table: tableName(relation), count });
      }
      rawCitations = (await this.db.query('select id,workspace_id,output_json from public.ai_agent_runs where workspace_id=any($1::uuid[]) order by id', [this.ids])).rows;
      await this.db.query('commit');
    } catch (error) { await this.db.query('rollback'); throw error; }
    const objects = await this.verifyStorage();
    const observations = await this.visibilityObservations(readbacks);
    const jobState = jobCollector ? await jobCollector({ db: this.db, plan: this.plan, actions, requests }) : { jobs: [], jobDispatches: [], complete: false, reason: 'job_collector_missing' };
    assert(Array.isArray(jobState.jobs) && Array.isArray(jobState.jobDispatches), 'job_collector_contract');
    const rowIds = new Map(); for (const row of rows) { const values = rowIds.get(row.id) || []; values.push(row); rowIds.set(row.id, values); }
    const citations = [];
    function visit(value, run, pathParts = []) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) visit(value[i], run, [...pathParts, String(i)]); return; }
      for (const [key, child] of Object.entries(value)) {
        if (['citations', 'contextReferences'].includes(key) && Array.isArray(child)) {
          child.forEach((citation, index) => {
            const ref = typeof citation === 'object' && citation ? citation : {};
            const sourceId = ref.source_record_id || ref.sourceRecordId || ref.source_file_id || ref.sourceFileId || ref.record_id || ref.recordId || ref.source_id || ref.sourceId || ref.chunk_id || ref.chunkId;
            const matches = sourceId ? (rowIds.get(String(sourceId)) || []) : [];
            const match = matches.find(r => r.workspaceId === run.workspace_id);
            citations.push({ id: `${run.id}:${[...pathParts, key, index].join('.')}`, workspaceId: run.workspace_id,
              sourceWorkspaceId: match?.workspaceId || matches[0]?.workspaceId || null, resolved: Boolean(match), sourceId: sourceId || null,
              reason: match ? null : sourceId ? 'persisted_source_unresolved' : 'citation_shape_requires_explicit_adapter' });
          });
        } else visit(child, run, [...pathParts, key]);
      }
    }
    for (const run of rawCitations) visit(run.output_json, run);
    const required = actions.filter(a => a.expectedPrimaryCount !== null && a.expectedPrimaryCount !== undefined);
    const checked = new Set(primary.checkedLogicalIds); const allPrimaryChecked = required.every(a => checked.has(a.logicalId));
    const readbackIds = new Set(observations.filter(o => o.probe === 'request_readback').map(o => `${o.requestLogicalId}:${o.actorId}`));
    const allReadbacks = requests.filter(r => r.accepted && r.kind === 'read').every(r => readbackIds.has(`${r.logicalId}:${r.actorId}`));
    const fingerprint = await this.readSchemaFingerprint(); assert.equal(fingerprint, this.schemaFingerprint, 'schema_changed_during_inventory');
    const snapshot = { kind: 'independent_capacity_inventory', runId: this.plan.runId, sourceCommit: this.commit, schemaFingerprint: fingerprint, observedAt: new Date().toISOString(),
      completeness: { databaseRows: true, storageObjects: true, primaryMutationMapping: allPrimaryChecked, allRelations: unresolved.length === 0, citations: true, jobs: jobState.complete === true, actorVisibility: true },
      scope: 'All public/private physical tables with workspace_id plus workspaces, every selected row hashed in PostgreSQL; same-scope SQL foreign keys resolved. Auth/profile authority checked separately by real actor probes. Storage downloaded independently. No credential/source contents exported.',
      rows, objects, citations, observations, jobs: jobState.jobs, jobDispatches: jobState.jobDispatches, relationCounts, unresolvedRelations: unresolved, jobCollectorEvidence: jobState.evidence || null,
      requestReadbacksComplete: allReadbacks, storageBytesWritten: Math.max(this.progress.bytesWritten, this.storageBytes), noTruncation: true };
    if (outputFile) { const serialized = JSON.stringify(snapshot); assert(Buffer.byteLength(serialized) <= 256 * 1024 ** 2, 'inventory_requires_sharded_verifier'); fs.writeFileSync(outputFile, serialized + '\n', { mode: 0o600, flag: 'wx' }); snapshot.exportBytes = Buffer.byteLength(serialized); }
    return snapshot;
  }
  async sampleTelemetry({ app, processes = [], processMetricsPath = path.join(this.outputDir, 'process-metrics'), resourceBudget, providerFixtureVerifier, queueCollector, egressCollector, providerCollector, integrityCollector } = {}) {
    assert(app && /^[a-f0-9]{40}$/.test(app.sourceCommit) && app.instanceNonce?.length >= 24 && app.buildMode === 'production', 'running_app_identity_required');
    assert.equal(app.sourceCommit, this.commit, 'app_commit_mismatch');
    assert(Number.isInteger(app.pid) && app.pid > 0 && Number.isInteger(app.startSeconds) && Number.isInteger(app.startMicroseconds) && app.buildId, 'process_start_and_build_evidence_required');
    assert.equal(fs.readFileSync(path.join(ROOT, '.next/BUILD_ID'), 'utf8').trim(), app.buildId, 'running_build_changed');
    assert(Number.isFinite(app.allocationBytes) && app.allocationBytes > 0 && app.allocationBytes <= os.totalmem(), 'declared_allocation_exceeds_host');
    const roots = [{ pid: app.pid, label: 'application', allocationBytes: app.allocationBytes }, ...processes];
    for (const r of roots) if (r.allocationBytes !== undefined) assert(Number.isFinite(r.allocationBytes) && r.allocationBytes > 0 && r.allocationBytes <= os.totalmem(), 'process_allocation_invalid');
    const raw = readProcessMetrics(processMetricsPath, roots.map(r => r.pid));
    const application = raw.processes.find(p => p.pid === app.pid);
    assert(application && application.startSeconds === app.startSeconds && application.startMicroseconds === app.startMicroseconds, 'pid_reused');
    assert(resourceBudget && Number.isFinite(resourceBudget.allocationBytes) && resourceBudget.allocationBytes > 0 && resourceBudget.allocationBytes <= os.totalmem() && Number.isFinite(resourceBudget.cpuAllocationCores) && resourceBudget.cpuAllocationCores > 0 && resourceBudget.cpuAllocationCores <= os.cpus().length, 'aggregate_resource_budget_required');
    const sampleAt = process.hrtime.bigint(), wallAt = Date.now(), prior = this.previousProcessSample;
    const observedProcesses = raw.processes.map(p => {
      let previous = prior?.values.get(`${p.pid}:${p.startSeconds}:${p.startMicroseconds}`);
      if (previous === undefined && prior && p.startedAtUnixMs >= prior.wallAt) previous = 0;
      const cpuNanoseconds = p.userCpuNanoseconds + p.systemCpuNanoseconds;
      const elapsed = prior ? Number(sampleAt - prior.at) : 0;
      return { ...p, group: roots[p.rootIndex].label, ...(roots[p.rootIndex].pid === p.pid && roots[p.rootIndex].allocationBytes ? { allocationBytes: roots[p.rootIndex].allocationBytes } : {}), cpuPercentOneCore: previous !== undefined && elapsed > 0 ? 100 * Math.max(0, cpuNanoseconds - previous) / elapsed : null };
    });
    this.previousProcessSample = { at: sampleAt, wallAt, values: new Map(raw.processes.map(p => [`${p.pid}:${p.startSeconds}:${p.startMicroseconds}`, p.userCpuNanoseconds + p.systemCpuNanoseconds])) };
    const appProcesses = observedProcesses.filter(p => p.group === 'application');
    const db = (await this.db.query("select count(*)::int connections,count(*)filter(where state='active')::int active,count(*)filter(where state='idle')::int idle,count(*)filter(where wait_event_type='Lock')::int lock_waiting,count(*)filter(where state='idle in transaction')::int idle_in_transaction,current_setting('max_connections')::int max_connections from pg_stat_activity where backend_type='client backend'")).rows[0];
    await this.verifyStorage({ incremental: true });
    const fixtures = await this.fixtureMetadata({ providerFixtureVerifier });
    const queue = queueCollector ? await queueCollector({ db: this.db, plan: this.plan }) : null;
    const egress = egressCollector ? await egressCollector() : { enforced: false, violations: null };
    const providers = providerCollector ? await providerCollector() : { mode: 'unverified', paidCalls: null };
    const integrity = integrityCollector ? await integrityCollector({ db: this.db, plan: this.plan }) : { violations: [], ready: false, reason: 'integrity_collector_missing' };
    const nowCpu = os.cpus().map(c => ({ ...c.times })), previous = this.previousCpu; this.previousCpu = nowCpu;
    let hostCpuPercent = null;
    if (previous && previous.length === nowCpu.length) { let idle = 0, total = 0; for (let i = 0; i < nowCpu.length; i++) for (const key of Object.keys(nowCpu[i])) { const delta = nowCpu[i][key] - previous[i][key]; total += delta; if (key === 'idle') idle += delta; } if (total > 0) hostCpuPercent = 100 * (1 - idle / total); }
    const complete = Boolean(prior) && fixtures.providerFixturesReady && fixtures.legalAcceptanceReady && fixtures.corpus.every(c => c.activeFiles >= 200 && c.kpiObservations >= 10000 && c.historyDays >= 730 && c.verifiedStorageObjects >= c.activeFiles + c.archivedFiles)
      && queue && egress.enforced === true && Number.isFinite(egress.violations) && providers.mode === 'local_stubs_only' && providers.paidCalls === 0 && integrity.ready === true;
    return { runId: this.plan.runId, observedAt: new Date().toISOString(), phase: complete ? 'ready_for_workload' : 'bootstrap_or_adapter_incomplete', ready: Boolean(complete),
      app: { ...app, rssBytes: appProcesses.reduce((n, p) => n + p.rssBytes, 0), cpuPercentOneCore: prior ? appProcesses.reduce((n, p) => n + (p.cpuPercentOneCore || 0), 0) : null },
      db: { origin: this.databaseOrigin, schemaFingerprint: this.schemaFingerprint, connections: db.connections, maxConnections: db.max_connections, active: db.active, idle: db.idle, lockWaiting: db.lock_waiting, idleInTransaction: db.idle_in_transaction },
      resources: { allocationBytes: resourceBudget.allocationBytes, cpuAllocationCores: resourceBudget.cpuAllocationCores, totalRssBytes: observedProcesses.reduce((n, p) => n + p.rssBytes, 0), cpuCores: prior ? observedProcesses.reduce((n, p) => n + (p.cpuPercentOneCore || 0), 0) / 100 : null, cpuCoverageComplete: observedProcesses.every(p => p.cpuPercentOneCore !== null), hostPhysicalBytes: os.totalmem(), hostFreeBytes: os.freemem(), hostCpuPercent, logicalCores: nowCpu.length, declaredProcessAllocations: roots.map(r => ({ pid: r.pid, label: r.label, allocationBytes: r.allocationBytes ?? null })), ownedProcessesRssBytes: observedProcesses.reduce((n, p) => n + p.rssBytes, 0), processes: observedProcesses, caveat: 'Local host is shared. Allocation is the declared launch envelope, not proof of an OS memory limit. Process CPU is an actual libproc CPU-time delta divided by monotonic sample time; first sample is unknown. Host CPU is sampled CPU-time delta.' },
      fixtures, queue, egress, providers, integrity, storageBytesWritten: Math.max(this.progress.bytesWritten, this.storageBytes || 0) };
  }
  async visibilityObservations(readbacks = []) {
    const observations = [], issues = (await this.db.query('select distinct on(workspace_id) id,workspace_id from public.issues where workspace_id=any($1::uuid[]) order by workspace_id,id', [this.ids])).rows;
    for (const actor of this.plan.actors.filter(a => a.active)) {
      const own = issues.find(r => r.workspace_id === actor.workspaceId), foreign = issues.find(r => r.workspace_id !== actor.workspaceId); assert(own && foreign, 'two_workspace_visibility_fixture_required');
      const client = this.actorClient(actor.id);
      for (const [probe, record] of [['own_workspace', own], ['foreign_workspace', foreign]]) {
        const data = check(await client.from('issues').select('id,workspace_id').eq('id', record.id), 'actor_visibility_probe');
        observations.push({ actorId: actor.id, probe, visible: data.length > 0, recordTable: 'issues', recordId: record.id, recordWorkspaceId: record.workspace_id, observedAt: new Date().toISOString() });
      }
    }
    for (const readback of readbacks) {
      const actor = this.plan.actors.find(a => a.id === readback.actorId); assert(actor?.active, 'readback_actor_required');
      assert(/^[a-z_]+$/.test(readback.recordTable) && /^[a-f0-9-]{36}$/.test(readback.recordId), 'readback_record_required');
      const workspaceProjection = readback.recordTable === 'workspaces' ? 'id as workspace_id' : 'workspace_id';
      const actual = (await this.db.query(`select ${workspaceProjection} from public.${qi(readback.recordTable)} where id=$1`, [readback.recordId])).rows;
      assert.equal(actual.length, 1, 'readback_persisted_record_required');
      const data = check(await this.actorClient(actor.id).from(readback.recordTable).select(readback.recordTable === 'workspaces' ? 'id' : 'id,workspace_id').eq('id', readback.recordId), 'actor_readback');
      observations.push({ actorId: actor.id, requestLogicalId: readback.requestLogicalId, probe: 'request_readback', visible: data.length > 0, recordTable: readback.recordTable, recordId: readback.recordId, recordWorkspaceId: actual[0].workspace_id, ...(readback.recordTable === 'workspaces' ? { scope: 'Response-linked workspace context only; this does not assert aggregate calculations or all records in the response.' } : {}), observedAt: new Date().toISOString() });
    }
    return observations;
  }
}
async function openState({ configFile, planFile, plan, outputDir }) {
  const config = privateJson(configFile); assert.equal(config.mode, 'disposable-native-local'); assert(config.runId && config.ownedSupabaseHome && config.ownedProjectRoot && config.anonKey && config.serviceKey, 'owned_config_required');
  loopback(config.apiUrl, ['http:', 'https:']); loopback(config.dbUrl, ['postgres:', 'postgresql:']);
  assert(!fs.existsSync(path.join(ROOT, 'supabase/.temp/project-ref')), 'linked_checkout_denied');
  plan = plan || privateJson(planFile); validatePlan(plan);
  assert(path.isAbsolute(outputDir) && /^\/(?:private\/)?tmp\/vaeroex-capacity-[a-zA-Z0-9-]+$/.test(outputDir), 'owned_capacity_output_required');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { mode: 0o700 });
  assert(fs.lstatSync(outputDir).isDirectory() && !fs.lstatSync(outputDir).isSymbolicLink() && (fs.statSync(outputDir).mode & 0o077) === 0, 'private_output_directory_required');
  return new CapacityState(config, plan, outputDir).open();
}
module.exports = { openState, createPlan, validatePlan, CapacityState, boundedMap, sha, writePrivate, loopback, readProcessMetrics, readProcessTree: readProcessMetrics };
if (require.main === module) (async () => {
  const [command, configFile, planFile, outputDir] = process.argv.slice(2);
  if (command === 'plan') { const plan = createPlan({ activeUsers: Number(configFile) }); writePrivate(planFile, plan, true); console.log(JSON.stringify({ kind: 'capacity_plan_only', runId: plan.runId, activeUsers: plan.activeUsers, workspaces: plan.workspaces.length })); return; }
  assert(['seed', 'inspect'].includes(command) && outputDir, 'usage_plan_scale_file_or_seed_config_plan_output');
  const state = await openState({ configFile, planFile, outputDir });
  try { const result = command === 'seed' ? await state.seedFixtures() : { phase: state.progress.phase, identity: state.identity, schemaFingerprint: state.schemaFingerprint, sourceCommit: state.commit, fixtures: await state.fixtureMetadata() }; console.log(JSON.stringify(result)); }
  finally { await state.close(); }
})().catch(error => { console.error(JSON.stringify({ kind: 'capacity_state_blocked', reason: /^[a-z_]+$/.test(error.message) ? error.message : 'state_operation_failed', code: error.code || null, preservedFixtures: true })); process.exitCode = 1; });
