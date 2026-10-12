import { createHash } from 'node:crypto';
// HARNESS UNIT TEST ONLY: no Vaeroex server, application endpoint, database or provider is contacted.
import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,readFileSync,rmSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{localUrl,sameOriginPath,guardedFetch,quantile,mixAt,accepted,validatePlan,summarize,uploadTargetBytes,checkTelemetry,createWorkloadSelector,quietBaselineQualified,PAGE_ROUTES,eligibleRequests,recordQueueDelays,verifyDispatchAccounting}from'./core.mjs';const here=fileURLToPath(new URL('.',import.meta.url));
test('harness-only literal loopback rejects production, DNS, credentials and URL escapes',()=>{for(const u of['https://www.vaeroex.com','http://localhost:3000','http://127.0.0.1.evil.test','http://127.0.0.1@evil.test','http://192.168.1.1','http://127.0.0.1:3000/#x','http://127.0.0.1:3000/?project=mdiianhfrojmxqpwrflh'])assert.throws(()=>localUrl(u));assert.equal(localUrl('http://127.0.0.1:3000').hostname,'127.0.0.1');assert.throws(()=>sameOriginPath('http://127.0.0.1:3000','//evil.test'));});
test('harness-only external redirect refused without followup',async()=>{let n=0;await assert.rejects(guardedFetch('http://127.0.0.1:3000','/safe',{},async(_,opts)=>{n++;assert.equal(opts.redirect,'manual');return new Response(null,{status:303,headers:{location:'https://www.vaeroex.com/app'}});}));assert.equal(n,1);});
test('harness-only same-origin redirect inspected not followed, with explicit ack',async()=>{const r=await guardedFetch('http://127.0.0.1:3000','/app/issues',{},async()=>new Response(null,{status:303,headers:{location:'/app/issues?message=Issue%20logged.'}}));assert.equal(accepted(r,{statuses:[303],location:{pathname:'/app/issues',query:{message:'Issue logged.'}}}),true);assert.equal(accepted(r,{statuses:[303]}),false);});
test('harness-only hard-stop abort reaches fetch',async()=>{const controller=new AbortController();const p=guardedFetch('http://127.0.0.1:3000','/safe',{signal:controller.signal},async(_,opts)=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));controller.abort();await assert.rejects(p);});
test('harness-only max body and error thresholds retain planned failures separately',async()=>{await assert.rejects(guardedFetch('http://127.0.0.1:3000','/safe',{},async()=>new Response('x'.repeat(4*1024*1024+1))));const r=summarize([{kind:'read',accepted:true,ms:100},{kind:'read',accepted:false,plannedFault:true,ms:1},{kind:'read',accepted:false,ms:1}]);assert.equal(r.unplannedFailureRate,1/2);assert.equal(r.unplannedFailureRateAllRequests,1/3);assert.equal(r.plannedFaultFailures,1);assert.equal(quantile([1,2,3,4,5],.95),5);const sizes=Array.from({length:20},(_,i)=>uploadTargetBytes(i));assert.equal(sizes.filter(n=>n===40960).length,16);assert.equal(sizes.filter(n=>n===419430).length,3);assert.equal(sizes.filter(n=>n===2202009).length,1);});
test('harness-only mix totals one hundred actions and generated plans preserve required cohort/corpus',()=>{const counts={};for(let i=0;i<100;i++)counts[mixAt(i)]=(counts[mixAt(i)]??0)+1;assert.deepEqual(counts,{pages:30,search:20,filters:20,upload:8,create:8,repeat:4,ai:5,manualSync:5});const temp=mkdtempSync(join(tmpdir(),'vaeroex-harness-unit-'));try{for(const size of[10,100,250,500]){const out=join(temp,String(size)),r=spawnSync(process.execPath,[join(here,'generate.mjs'),String(size),out],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const plan=JSON.parse(readFileSync(join(out,'plan.json')));validatePlan(plan);assert.equal(plan.actors.length,size*2);assert.equal(plan.corpus.activeFilesPerWorkspace,200);assert.equal(plan.corpus.kpiObservationsPerWorkspace,10000);const adapters=JSON.parse(readFileSync(join(out,'adapters.template.json')));assert.equal(adapters.upload.ready,false);assert.equal(adapters.scheduled.ready,false);}}finally{rmSync(temp,{recursive:true,force:true});}});
test('harness-only empty or missing exported evidence cannot verify integrity',()=>{const temp=mkdtempSync(join(tmpdir(),'vaeroex-harness-verify-'));try{const out=join(temp,'plan');assert.equal(spawnSync(process.execPath,[join(here,'generate.mjs'),'100',out]).status,0);const plan=JSON.parse(readFileSync(join(out,'plan.json')));const snap={runId:plan.runId,sourceCommit:'a'.repeat(40),schemaFingerprint:'b'.repeat(64),completeness:{databaseRows:true,storageObjects:true,primaryMutationMapping:true,allRelations:true,citations:true,jobs:true,actorVisibility:true},rows:[],objects:[],jobs:[],citations:[],observations:[],jobDispatches:[],requestReadbacksComplete:true};for(const f of['before','after'])writeFileSync(join(temp,f),JSON.stringify(snap));for(const f of['actions','requests'])writeFileSync(join(temp,f),'');const r=spawnSync(process.execPath,[join(here,'verify-inventory.mjs'),join(out,'plan.json'),join(temp,'before'),join(temp,'after'),join(temp,'actions'),join(temp,'requests'),join(temp,'result')],{encoding:'utf8'});assert.equal(r.status,2);assert.equal(JSON.parse(readFileSync(join(temp,'result'))).status,'BLOCKED');}finally{rmSync(temp,{recursive:true,force:true});}});


test('harness-only Server Action redirect is same-origin, explicit and never followed', async () => {
  let calls = 0;
  const response = await guardedFetch('http://127.0.0.1:3000', '/app/issues', {}, async (_, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    return new Response('action result', { status: 200, headers: { 'x-action-redirect': '/app/issues?message=Issue%20logged.;push' } });
  });
  assert.equal(calls, 1);
  assert.equal(accepted(response, { statuses: [200], actionRedirect: { pathname: '/app/issues', queryAny: { message: ['Issue logged.', 'Issue already logged. No duplicate was created.'] } } }), true);
  assert.equal(accepted(response, { statuses: [200] }), false);
  assert.equal(accepted({ ...response, headers: new Headers({ 'x-action-redirect': '/app/issues?error=permission%20denied;push' }) }, { statuses: [200], actionRedirect: { pathname: '/app/issues' } }), false);
});

test('harness-only every redirect header is checked for external egress independently', async () => {
  for (const headers of [
    { 'x-action-redirect': 'https://example.invalid/app;push' },
    { 'x-action-redirect': '//example.invalid/app;replace' },
    { 'x-action-redirect': 'http://127.0.0.1:3001/app;push' },
    { location: '/app/issues', 'x-action-redirect': 'https://example.invalid/app;push' },
    { location: 'https://example.invalid/app', 'x-action-redirect': '/app/issues;push' }
  ]) {
    let calls = 0;
    await assert.rejects(guardedFetch('http://127.0.0.1:3000', '/app/issues', {}, async () => {
      calls++; return new Response(null, { status: 200, headers });
    }), /denied/, JSON.stringify(headers));
    assert.equal(calls, 1);
  }
});

function telemetryFixture() {
  const now = Date.now(), plan = { runId: 'synthetic-telemetry', actors: [{ id: 'actor' }], workspaces: [{ id: 'workspace' }],
    corpus: { activeFilesPerWorkspace: 200, archivedFilesPerWorkspace: 0 } };
  const env = { sourceCommit: 'a'.repeat(40), instanceNonce: 'synthetic-instance'.repeat(2), schemaFingerprint: 'b'.repeat(64), databaseOrigin: 'postgresql://127.0.0.1:54322' };
  const resources = { allocationBytes: 2000, cpuAllocationCores: 2, totalRssBytes: 150, cpuCores: .3, cpuCoverageComplete: true,
    processes: [
      { pid: 101, group: 'application', rssBytes: 100, allocationBytes: 1000, cpuPercentOneCore: 10 },
      { pid: 102, group: 'worker', rssBytes: 50, allocationBytes: 500, cpuPercentOneCore: 20 }
    ] };
  const sample = { runId: plan.runId, observedAt: new Date(now).toISOString(), ready: true,
    app: { ...env, buildMode: 'production', pid: 101, rssBytes: 100, allocationBytes: 1000 },
    db: { schemaFingerprint: env.schemaFingerprint, origin: env.databaseOrigin, connections: 2, maxConnections: 60 }, resources,
    fixtures: { runId: plan.runId, syntheticOnly: true, registeredUsers: 1, workspaces: 1, activeFilesPerWorkspace: 200,
      archivedFilesPerWorkspace: 0, kpiObservationsPerWorkspace: 10000, historyMonths: 24, providerFixturesReady: true, legalAcceptanceReady: true,
      corpus: [{ workspaceId: 'workspace', activeFiles: 200, archivedFiles: 0, kpiObservations: 10000, confirmedMetricDefinitions: 20, historyDays: 730, verifiedStorageObjects: 200 }] },
    egress: { enforced: true, violations: 0 }, providers: { paidCalls: 0, mode: 'local_stubs_only' }, integrity: { ready: true, violations: [] },
    queue: { depth: 0, inFlight: 0, oldestAgeMs: 0, completed: [] }, storageBytesWritten: 1024 };
  return { sample, env, plan, now };
}

test('harness-only first CPU sample is unknown and cannot qualify a workload', () => {
  const { sample, env, plan, now } = telemetryFixture(); assert.equal(checkTelemetry(sample, env, plan, now), sample);
  sample.ready = false; sample.resources.cpuCores = null; sample.resources.cpuCoverageComplete = false;
  for (const process of sample.resources.processes) process.cpuPercentOneCore = null;
  assert.throws(() => checkTelemetry(sample, env, plan, now), /telemetry|resource/);
});

test('harness-only aggregate resource evidence must match valid complete process samples', () => {
  for (const [description, corrupt] of [
    ['missing processes', t => { t.resources.processes = []; }],
    ['unknown worker RSS', t => { t.resources.processes[1].rssBytes = null; }],
    ['unknown worker CPU despite declared coverage', t => { t.resources.processes[1].cpuPercentOneCore = null; }],
    ['duplicate process counted twice', t => { t.resources.processes[1].pid = 101; }],
    ['missing application process', t => { t.resources.processes[0].pid = 103; }],
    ['aggregate RSS hides worker', t => { t.resources.totalRssBytes = 100; }],
    ['aggregate CPU hides worker', t => { t.resources.cpuCores = .1; }],
    ['invalid worker allocation', t => { t.resources.processes[1].allocationBytes = 0; }],
    ['invalid aggregate budget', t => { t.resources.allocationBytes = 0; }],
    ['incomplete integrity observer', t => { t.integrity.ready = false; }]
  ]) {
    const { sample, env, plan, now } = telemetryFixture(); corrupt(sample);
    assert.throws(() => checkTelemetry(sample, env, plan, now), undefined, description);
  }
});

// Execute the runner's own threshold/drain expressions with synthetic telemetry.
// This checks its decisions without duplicating the implementation or launching
// an application, database, provider, session, or workload.
const runnerSource = readFileSync(join(here, 'run.mjs'), 'utf8');
function actualRunnerBlock(start, end) {
  const from = runnerSource.indexOf(start), to = runnerSource.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'runner decision boundary moved; inspect before updating the regression');
  return runnerSource.slice(from, to);
}
const actualDrain = new Function('telemetry', 'startEpoch', 'steadyEnd', actualRunnerBlock('const drainSample=', ' const recovery=') + ';return drainMs;');
const resourceLine = runnerSource.split('\n').find(line => line.includes('for(const[key,condition]of Object.entries('));
assert(resourceLine, 'runner resource decisions must remain testable');
const actualResourceStop = new Function('t', 'eligible', 'err', 'sustained', 'elapsed', 'stop', resourceLine);

test('harness-only drain requires zero queued and zero in-flight accepted work', () => {
  const start = Date.parse('2026-10-05T00:00:00.000Z'), steadyEnd = 10;
  const row = (offset, depth, inFlight) => ({ observedAt: new Date(start + steadyEnd * 1000 + offset).toISOString(), queue: { depth, inFlight } });
  assert.equal(actualDrain([row(1000, 0, 1), row(2000, 1, 0)], start, steadyEnd), null);
  assert.equal(actualDrain([row(-1000, 0, 0), row(1000, 0, 1), row(2500, 0, 0)], start, steadyEnd), 2500);
});

test('harness-only aggregate and per-worker budgets retain 80 percent for 60 seconds stop conditions', () => {
  for (const [key, setOverBudget] of [
    ['rss', t => { t.app.rssBytes = t.app.allocationBytes * .81; }],
    ['workerRss', t => { t.resources.processes[1].rssBytes = t.resources.processes[1].allocationBytes * .81; }],
    ['totalRss', t => { t.resources.totalRssBytes = t.resources.allocationBytes * .81; }],
    ['cpu', t => { t.resources.cpuCores = t.resources.cpuAllocationCores * .81; }],
    ['db', t => { t.db.connections = t.db.maxConnections * .81; }]
  ]) {
    const { sample } = telemetryFixture(), sustained = new Map(), stops = [];
    setOverBudget(sample);
    for (const at of [0, 59.999]) actualResourceStop(sample, [], 0, sustained, at, reason => stops.push(reason));
    assert.deepEqual(stops, [], key + ' stopped before the unchanged grace interval');
    actualResourceStop(sample, [], 0, sustained, 60, reason => stops.push(reason));
    assert(stops.includes('sustained_' + key), key + ' did not stop at the declared boundary');
  }
  const { sample } = telemetryFixture(), sustained = new Map(), stops = [];
  sample.resources.cpuCores = sample.resources.cpuAllocationCores * .8;
  for (const at of [0, 60]) actualResourceStop(sample, [], 0, sustained, at, reason => stops.push(reason));
  assert.deepEqual(stops, [], 'the existing threshold is above80%, not at80%');
});

test('harness-only worker descendants share the declared worker RSS budget', () => {
  const { sample } = telemetryFixture(), sustained = new Map(), stops = [];
  sample.resources.processes.push({ pid: 103, group: 'worker', rssBytes: 400, cpuPercentOneCore: 0 });
  sample.resources.totalRssBytes += 400;
  // Worker root50 + child400 =450 of500 bytes; aggregate550 of2000 remains low.
  for (const at of [0, 60]) actualResourceStop(sample, [], 0, sustained, at, reason => stops.push(reason));
  assert(stops.includes('sustained_workerRss'), 'child RSS must not bypass the worker allocation');
});

test('harness-only literal-loopback NextRequest authority needs runtime normalization disabled, with all origin guards retained', () => {
  const root = resolve(here, '../../../../..');
  const script = `
    const fs=require('node:fs'),path=require('node:path'),ts=require(path.join(process.cwd(),'node_modules/typescript'));
    const {NextRequest}=require(path.join(process.cwd(),'node_modules/next/server'));
    const source=fs.readFileSync('lib/integrations/google-sheets/server.ts','utf8');
    const begin=source.indexOf('export function assertSheetsOrigin('),end=source.indexOf('export async function readSheetsForm(',begin);
    if(begin<0||end<begin)throw Error('origin_guard_boundary_changed');
    const code=ts.transpileModule(source.slice(begin,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const origin='https://127.0.0.1:49100',out={};new Function('exports','sheetsConfiguration',code)(out,()=>({appOrigin:origin}));
    const request=override=>new NextRequest(origin+'/api/integrations/google-sheets/sync',{method:'POST',headers:{host:'127.0.0.1:49100',origin,'x-forwarded-host':'127.0.0.1:49100','x-forwarded-proto':'https',...override},body:'confirmation=sync'});
    const allowed=request=>{try{out.assertSheetsOrigin(request);return true;}catch(error){if(error.message!=='google_sheets_request_origin_denied')throw error;return false;}};
    const normal=request({});console.log(JSON.stringify({actualOrigin:new URL(normal.url).origin,accepted:allowed(normal),wrongOriginDenied:!allowed(request({origin:'https://example.invalid'})),wrongHostDenied:!allowed(request({host:'example.invalid'})),wrongProtocolDenied:!allowed(request({'x-forwarded-proto':'http'})),crossSiteDenied:!allowed(request({'sec-fetch-site':'cross-site'}))}));
  `;
  for (const enabled of [false, true]) {
    const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, __NEXT_NO_MIDDLEWARE_URL_NORMALIZE: enabled ? '1' : '' } });
    assert.equal(result.status, 0, result.stderr); const observed = JSON.parse(result.stdout);
    assert.equal(observed.accepted, enabled);
    assert.equal(observed.actualOrigin, enabled ? 'https://127.0.0.1:49100' : 'https://localhost:49100');
    for (const denial of ['wrongOriginDenied', 'wrongHostDenied', 'wrongProtocolDenied', 'crossSiteDenied']) assert.equal(observed[denial], true, denial);
  }
});


test('harness-only configuration loader preserves all original settings and security-header functions', () => {
  const root = resolve(here, '../../../../..'), temp = mkdtempSync(join(tmpdir(), 'vaeroex-next-config-unit-'));
  const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
  const loaderPath = spawnSync(process.execPath, ['-p', "require.resolve('next/dist/server/config')"], { cwd: root, encoding: 'utf8' });
  assert.equal(loaderPath.status, 0, loaderPath.stderr);
  const file = join(temp, 'runtime.private.json');
  const cfg = { out: temp, runId: 'synthetic-config-unit', syntheticOnly: true, paidCredentialsPresent: false,
    nextConfigOverride: { skipMiddlewareUrlNormalize: true, originalConfigSha256: hash(join(root, 'next.config.mjs')), originalLoaderSha256: hash(loaderPath.stdout.trim()) } };
  const script = `
    const assert=require('node:assert/strict'),original=require('next/dist/server/config').default;
    (async()=>{const before=await original('phase-production-server',process.cwd());require('./scripts/workspace-capacity-next-config.cjs');
      const load=require('next/dist/server/config').default,after=await load('phase-production-server',process.cwd());
      assert.equal(after.skipMiddlewareUrlNormalize,true);
      for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(key!=='skipMiddlewareUrlNormalize')assert.equal(after[key],before[key],key);
      assert.equal(typeof after.headers,'function');assert.deepEqual(await after.headers(),await before.headers());
      await assert.rejects(load('phase-development-server',process.cwd()),/isolated_configuration_scope_denied/);
      console.log(JSON.stringify({onlyChangedOption:'skipMiddlewareUrlNormalize',allOtherReferencesPreserved:true,securityHeadersPreserved:true}));
    })().catch(e=>{console.error(e.message);process.exitCode=1;});
  `;
  try {
    writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
    const env = { PATH: process.env.PATH, VAEROEX_CAPACITY_RUNTIME_CONFIG: file };
    const result = spawnSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).securityHeadersPreserved, true);
    cfg.nextConfigOverride.originalConfigSha256 = '0'.repeat(64); writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
    const denied = spawnSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8' });
    assert.notEqual(denied.status, 0); assert.match(denied.stderr, /application_configuration_changed/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('harness-only per-actor variants cover every page and filter without changing cadence or action mix', () => {
  for (const actors of [10, 25, 50, 100, 250, 500]) for (const rampActionsPerActor of [0, 6]) {
    const choose = createWorkloadSelector(actors), observations = Array.from({ length: actors }, () => ({ routes: Array(5).fill(0), filters: Array(4).fill(0) }));
    for (let n = 0; n < actors * (120 + rampActionsPerActor); n++) {
      const chosen = choose(n); assert.equal(chosen.actorIndex, n % actors); assert.equal(chosen.kind, mixAt((n * 37 + Math.floor(n / 100) * 13) % 100));
      if (n < actors * rampActionsPerActor) continue;
      const observed = observations[chosen.actorIndex];
      if (chosen.kind === 'pages') observed.routes[chosen.variant % 5]++;
      if (chosen.kind === 'filters') observed.filters[chosen.variant % 4]++;
    }
    for (const actor of observations) { assert(actor.routes.every(n => n > 0)); assert(actor.filters.every(n => n > 0)); }
    for (let workspace = 0; workspace < actors / 5; workspace++) for (let route = 0; route < 5; route++) {
      const count = observations.slice(workspace * 5, workspace * 5 + 5).reduce((n, actor) => n + actor.routes[route], 0);
      assert(count >= 30, `${actors} actors, ramp=${rampActionsPerActor}, workspace=${workspace}, route=${route}: ${count}`);
      if (actors === 10 && rampActionsPerActor === 0) assert.equal(count, 36, 'twenty-minute quiet baseline retains36 samples per route');
    }
    const oldActorZero = new Set(); for (let n = 0; n < actors * 120; n++) if (n % actors === 0 && mixAt((n * 37 + Math.floor(n / 100) * 13) % 100) === 'pages') oldActorZero.add(n % 5);
    assert.equal(oldActorZero.size, 1, 'negative control establishes the prior actor/route correlation');
  }
});

test('harness-only quiet baseline requires all five route samples before a primary workload', () => {
  const baseline = { byWorkspace: { tenant: { count: 200, p95Ms: 10, routes: Object.fromEntries(PAGE_ROUTES.map(route => [route, { count: 36, p95Ms: 10 }])) } } };
  assert.equal(quietBaselineQualified(baseline, ['tenant']), true);
  baseline.byWorkspace.tenant.routes['/app/reports'].count = 29; assert.equal(quietBaselineQualified(baseline, ['tenant']), false);
  baseline.byWorkspace.tenant.routes['/app/reports'].count = 36; baseline.byWorkspace.tenant.routes['/app/reports'].p95Ms = null;
  assert.equal(quietBaselineQualified(baseline, ['tenant']), false); assert.equal(quietBaselineQualified(baseline, ['missing']), false);
});

test('harness-only acknowledged expected denials cannot dilute the valid-request failure denominator', () => {
  const rows = [{ kind: 'read', accepted: true, ms: 5 }, { kind: 'read', accepted: false, ms: 5 }, ...Array.from({ length: 98 }, () => ({ kind: 'mutation', expectedDenial: true, accepted: true, ms: 1 }))];
  assert.equal(eligibleRequests(rows).length, 2); const result = summarize(rows);
  assert.equal(result.unplannedFailureRate, .5); assert.equal(result.unplannedFailureRateAllRequests, .01); assert.equal(result.expectedDenialAcknowledgments, 98); assert.equal(result.mutationAckP95Ms, null);
  rows.push({ kind: 'mutation', expectedDenial: true, accepted: false, ms: 1 }); assert.equal(summarize(rows).unplannedFailureRate, 2 / 3, 'failed denial contract remains an unplanned failure');
});

test('harness-only cumulative queue evidence survives skipped polls without duplicate percentile samples', () => {
  const start = Date.parse('2026-10-05T00:00:00Z'), samples = new Map();
  const job = (id, delay) => ({ id, eligibleAt: new Date(start + 1000).toISOString(), startedAt: new Date(start + 1000 + delay).toISOString() });
  const a = job('a', 10), b = job('b', 20000), c = job('c', 40000);
  assert.deepEqual(recordQueueDelays(samples, [a], start), [a]);
  // The collector's intermediate[a,b] sample was overwritten before polling.
  assert.deepEqual(recordQueueDelays(samples, [a, b, c], start), [b, c]); assert.equal(samples.size, 3); assert.equal(quantile([...samples.values()], .95), 40000);
  assert.deepEqual(recordQueueDelays(samples, [a, b, c], start), []); assert.throws(() => recordQueueDelays(samples, [job('b', 1)], start), /queue_eligibility_changed/);
  const observe = actualRunnerBlock('function observe(){', '\nfunction contract('); assert(!observe.includes('telemetry.push(t)')); assert(observe.includes('completedJobs:completed'));
});

function scheduledFixture() {
  const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002', connection = '00000000-0000-4000-8000-000000000003';
  const at = '2026-10-05T00:00:00.000Z';
  const response = { enabled: true, attempted: 0, succeeded: 0, failed: 0, deferred: 0, backoffFailed: 0, peakActive: 0, admissionRpcAttempts: 0, admissionRetries: 0, admissionWaitMs: 0 };
  const query = { at, tickAt: at, limit: 10, excludedConnectionIds: [], connections: [] };
  return { a, b, connection, at, plan: { workspaces: [{ id: a }, { id: b }] }, requests: [{ logicalId: 'tick', accepted: true, action: 'scheduled' }], jobs: [], dispatches: [{ requestLogicalId: 'tick', jobIds: [], scheduling: { response, dueQueries: [query], claimDenials: [] } }] };
}
test('harness-only truthful no-due scheduling preserves integrity but does not establish burst coverage', () => {
  const f = scheduledFixture(), r = verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches);
  assert.deepEqual(r.blocked, []); assert.deepEqual(r.violations, []); assert.equal(r.scheduledCoverage.complete, false); assert.deepEqual(r.scheduledCoverage.missingWorkspaceIds, [f.a, f.b]);
  f.dispatches[0].scheduling.dueQueries = []; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.includes('scheduled_dispatch_evidence_missing'));
});
test('harness-only deferred scheduling requires actual matching due and busy-denial evidence', () => {
  const f = scheduledFixture(), e = f.dispatches[0].scheduling; e.response.attempted = 1; e.response.deferred = 1; e.response.admissionRpcAttempts = 2;
  e.dueQueries[0].connections = [{ id: f.connection, workspaceId: f.a, eligibleAt: f.at }];
  assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.includes('scheduled_dispatch_evidence_mismatch'));
  e.claimDenials = [{ at: f.at, workspaceId: f.a, connectionId: f.connection, errorCode: 'google_sheets_workspace_busy' }];
  const r = verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches); assert.deepEqual(r.blocked, []); assert.equal(r.scheduledCoverage.complete, false);
  e.claimDenials[0].workspaceId = f.b; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.length);
});
test('harness-only scheduled accepted jobs remain terminal, unique, scoped and evidenced', () => {
  const f = scheduledFixture(), e = f.dispatches[0].scheduling; e.response.attempted = 1; e.response.succeeded = 1;
  e.dueQueries[0].connections = [{ id: f.connection, workspaceId: f.a, eligibleAt: f.at }];
  f.jobs = [{ id: 'job', workspaceId: f.a, connectionId: f.connection, status: 'completed', accepted: true }]; f.dispatches[0].jobIds = ['job'];
  const r = verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches); assert.deepEqual(r.blocked, []); assert.deepEqual(r.violations, []); assert.deepEqual(r.scheduledCoverage.missingWorkspaceIds, [f.b]);
  f.jobs[0].status = 'running'; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).violations.some(v => v.code === 'dispatch_job_unaccounted'));
  f.jobs[0].status = 'completed'; f.dispatches[0].jobIds.push('job'); assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.includes('accepted_dispatch_mapping_missing'));
  f.dispatches[0].jobIds = ['lost']; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.includes('accepted_dispatch_mapping_missing'));
});
test('harness-only scheduled burst coverage aggregates verified admissions across bounded ticks', () => {
  const f = scheduledFixture(); f.requests = []; f.dispatches = []; f.jobs = [];
  for (const [i, workspaceId] of [f.a, f.b].entries()) {
    const id = `tick${i}`, jobId = `job${i}`, fixture = scheduledFixture(), e = fixture.dispatches[0].scheduling;
    e.response.attempted = 1; e.response.succeeded = 1; e.dueQueries[0].connections = [{ id: f.connection, workspaceId, eligibleAt: f.at }];
    f.requests.push({ logicalId: id, action: 'scheduled', accepted: true }); f.jobs.push({ id: jobId, connectionId: f.connection, workspaceId, accepted: true, status: 'completed' });
    f.dispatches.push({ requestLogicalId: id, jobIds: [jobId], scheduling: e });
  }
  const r = verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches); assert.deepEqual(r.blocked, []); assert.deepEqual(r.violations, []); assert.equal(r.scheduledCoverage.complete, true);
  f.jobs[1].workspaceId = '00000000-0000-4000-8000-000000000099'; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).violations.some(v => v.code === 'cross_workspace_dispatch'));
});


test('harness-only a lost scheduler completion acknowledgement needs exact persisted-run injection evidence', () => {
  const f = scheduledFixture(), e = f.dispatches[0].scheduling; e.response.attempted = 1; e.response.failed = 1;
  e.dueQueries[0].connections = [{ id: f.connection, workspaceId: f.a, eligibleAt: f.at }];
  f.jobs = [{ id: 'completed-run', workspaceId: f.a, connectionId: f.connection, status: 'completed', accepted: true }]; f.dispatches[0].jobIds = ['completed-run'];
  assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.includes('scheduled_dispatch_evidence_mismatch'));
  e.acknowledgementLossRunIds = ['completed-run'];
  const verified = verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches); assert.deepEqual(verified.blocked, []); assert.deepEqual(verified.violations, []);
  e.acknowledgementLossRunIds = ['foreign-run']; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.length);
  e.acknowledgementLossRunIds = ['completed-run', 'completed-run']; assert(verifyDispatchAccounting(f.plan, f.requests, f.jobs, f.dispatches).blocked.length);
});
