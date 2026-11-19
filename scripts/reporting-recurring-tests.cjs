/* eslint-disable @typescript-eslint/no-require-imports -- Real scheduler, transport, parsers and protected projection with controlled provider/SQL boundaries. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let actor = id(90), role = 'owner';
const workspace = id(1), otherWorkspace = id(2), entity = id(3), day = new Date(Date.now() - 86400000).toISOString().slice(0,10);
installLoader({ '@/lib/security/require-workspace-access': { requireWorkspaceAccess: async () => ({ workspaceId: workspace, user: { id: actor }, membership: { role } }) } });
const security = require('../lib/integrations/reporting/security.ts');
const { reportingRefreshScope, reportingRecurringAllowed, validReportingSchedulerSecret, recurringReportingRange, runScheduledReportingRefresh, runDueReportingRefreshes } = require('../lib/integrations/reporting/scheduler.ts');
const { ReportingProviderError, reportingRetryAfter, readJson } = require('../lib/integrations/reporting/transport.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { evidenceEngineHash } = require('../lib/ai/evidence-engine/hash.ts');
const { post } = require('../lib/integrations/reporting/routes.ts');
const { GET } = require('../app/api/integrations/reporting/scheduled-sync/route.ts');
const providers = ['xero','harvest','clockify','toggl','zoho-inventory','katana'];
const oldFetch = global.fetch, oldEnv = { ...process.env }, originalAdmin = security.admin;
after(() => { global.fetch = oldFetch; process.env = oldEnv; security.admin = originalAdmin; });
function configure() {
  process.env.REPORTING_AUTOMATIC_REFRESH_ENABLED = 'true';
  process.env.REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS = workspace;
  process.env.REPORTING_AUTOMATIC_REFRESH_PROVIDERS = providers.join(',');
  process.env.REPORTING_CONNECTOR_TOKEN_KEY = Buffer.alloc(32,5).toString('base64');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-role-key-not-a-credential';
  process.env.CRON_SECRET = 'synthetic-cron-secret-not-a-real-credential';
  for (const provider of providers) {
    const prefix = provider.replaceAll('-','_').toUpperCase();
    process.env[`${prefix}_REPORTING_ENABLED`] = 'true';
    process.env[`${prefix}_CLIENT_ID`] = 'synthetic-client';
    process.env[`${prefix}_CLIENT_SECRET`] = 'synthetic-secret';
  }
  role = 'owner';
}
function harness(provider = 'harvest', number = 10) {
  const row = { id: id(number), provider, workspace_id: workspace, recurring_enabled: true, status: 'connected',
    account: { id: provider === 'katana' ? 'key-account' : '123', name: 'Fictional controlled account', ...(provider === 'clockify' ? { user: 'owner' } : {}), ...(provider === 'toggl' ? { parent: '1' } : {}) },
    lease_id: null, lease_kind: null, lease_expires_at: null, records: null, snapshot: null, last_sync_at: null, last_error_code: null };
  const cipher = security.seal(provider, workspace, row.id, { accessToken: 'synthetic-offline-token' });
  const calls = [], queries = [];
  let applyCount = 0;
  const lazy = run => { const value = { then: (yes,no) => Promise.resolve().then(run).then(yes,no), abortSignal: signal => { assert(signal instanceof AbortSignal); return value; } }; return value; };
  const db = { from(table) {
    const filters = [], query = { table, filters }; queries.push(query);
    const chain = lazy(() => {
      if (!filters.some(([key,value]) => key === 'workspace_id' && value === workspace) ||
        !filters.some(([key,value]) => key === 'provider' && value === provider) ||
        !filters.some(([key,value]) => ['id','connection_id'].includes(key) && value === row.id)) return { data: null, error: {} };
      if (filters.some(([key,value]) => key !== 'connection_id' && key !== 'lease_expires_at' && row[key] !== value)) return { data: null, error: {} };
      return { data: table === 'reporting_connections' ? { account: row.account, recurring_last_attempt_at: row.recurring_last_attempt_at } : { ciphertext: cipher }, error: null };
    });
    for (const name of ['select','single']) chain[name] = () => chain;
    chain.eq = (key,value) => { filters.push([key,value]); return chain; };
    chain.gt = (key,value) => { filters.push([key,value]); return chain; };
    return chain;
  }, rpc(name,args) {
    return lazy(() => {
      calls.push({ name,args: structuredClone(args) });
      if (name === 'recover_reporting_recurring') return { data: 0, error: null };
      if (name === 'list_due_reporting_refreshes') return { data: [connection()], error: null };
      const matches = args.p_workspace === workspace && args.p_provider === provider && args.p_connection === row.id;
      if (name === 'set_reporting_recurring') { if (matches) row.recurring_enabled = args.p_enabled; return { data: matches, error: null }; }
      if (name === 'claim_reporting_recurring') {
        const allowed = matches && row.recurring_enabled && row.status === 'connected' && !row.lease_id;
        if (allowed) { row.lease_id = args.p_lease; row.lease_kind = 'scheduled'; row.recurring_last_attempt_at = new Date().toISOString(); row.lease_expires_at = new Date(Date.now()+65000).toISOString(); }
        return row.loseClaimResponse && allowed ? {data:null,error:{code:'controlled_lost_response'}} : { data: allowed, error: null };
      }
      const ownsLease = matches && row.recurring_enabled && row.status === 'connected' && row.lease_id === args.p_lease;
      if (name === 'fail_reporting_recurring') {
        if (ownsLease) { row.lease_id = null; row.last_error_code = args.p_error; if (args.p_error === 'authorization_required') row.status = 'reauthorization_required'; }
        return { data: ownsLease, error: null };
      }
      if (name === 'apply_reporting_history' || name === 'apply_reporting_snapshot') {
        if (ownsLease) {
          applyCount++; row.records = args.p_records ?? null; row.snapshot = args.p_snapshot ?? null;
          row.last_sync_at = new Date().toISOString(); row.last_error_code = null; row.lease_id = null;
        }
        return { data: ownsLease, error: null };
      }
      throw new Error(`unexpected_rpc:${name}`);
    });
  } };
  const connection = () => ({ id: row.id, workspace_id: workspace, provider });
  const execution = () => ({ deadlineAt: Date.now()+240000, cleanupDeadlineAt: Date.now()+285000 });
  const refresh = () => runScheduledReportingRefresh(connection(), execution(), db);
  const tick = () => runDueReportingRefreshes({ due: async () => [connection()], eligible: c => reportingRecurringAllowed(c.workspace_id,c.provider), sync: (c,e) => runScheduledReportingRefresh(c,e,db) });
  const projected = () => {
    const records = row.records ?? [{ snapshot: row.snapshot }];
    const range = recurringReportingRange();
    const source = { identity: { kind: 'legacy_reference', reference_id: id(number+100) }, hash: evidenceEngineHash({ provider, records, observedAt: row.last_sync_at }),
      data: { provider, workspace_id: workspace, entity_id: entity, connection_id: row.id,
        period_start: row.snapshot ? row.snapshot.start.slice(0,10) : range.startDate, period_end: row.snapshot ? row.snapshot.end.slice(0,10) : range.endDate,
        time_zone: 'UTC', scope: 'Fictional reviewed provider binding', coverage: 'partial', records,
        read_sources: [{ table: 'reporting_connections', id: row.id }], eligibility: { internal: 'controlled-fixture' } } };
    return { source, projected: sharedRow(source,workspace) };
  };
  return { row, db, calls, queries, refresh, tick, connection, projected, applyCount: () => applyCount };
}
function providerReplies(provider, scale = 1) {
  if (provider === 'xero') return [{ Invoices: [{ InvoiceID: id(1000), DateString: `${day}T00:00:00`, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'USD', Total: 125*scale, AmountDue: 75*scale }] }];
  if (provider === 'harvest') return [{ time_entries: [{ id: 'entry', spent_date: day, hours: 1.25*scale, billable: true, is_running: false }], page: 1, next_page: null, total_entries: 1 }];
  if (provider === 'clockify') return [[{ id: 'entry', billable: true, timeInterval: { start: `${day}T10:00:00Z`, end: `${day}T${10+scale}:00:00Z` } }]];
  if (provider === 'toggl') return [{ data: [{ id: 'project', total_tracked_secs: 3600*scale }], page: 1, total: 1 }];
  if (provider === 'zoho-inventory') return [
    { code: 0, items: Array.from({length:scale},(_,i)=>({item_id:`item${i}`,status:'active',item_type:'inventory'})), page_context:{has_more_page:false} },
    { code: 0, items: [], page_context:{has_more_page:false} }];
  return [{ data: Array.from({length:scale},(_,i)=>({variant_id:`variant${i}`,location_id:'location',quantity_in_stock:'4',quantity_committed:'2'})) }];
}
function mockProvider(replies, onRead) {
  let reads = 0;
  global.fetch = async (url,init) => {
    reads++; onRead?.(reads);
    assert.equal(init.method,'GET'); assert.equal(init.redirect,'error'); assert.equal(init.cache,'no-store'); assert(init.signal instanceof AbortSignal);
    assert.match(new URL(url).hostname,/^(api\.xero\.com|api\.harvestapp\.com|api\.clockify\.me|focus\.toggl\.com|www\.zohoapis\.com|api\.katanamrp\.com)$/);
    const reply = replies.shift(); if (!reply) throw new Error('unexpected_provider_request');
    return reply instanceof Response ? reply : Response.json(reply);
  };
  return () => reads;
}

test('recurring deployment scope is explicit, bounded and fail-closed; scheduler secret comparison rejects missing/malformed values', () => {
  configure(); assert.equal(reportingRefreshScope().providers.length,6);
  for (const patch of [{REPORTING_AUTOMATIC_REFRESH_ENABLED:'false'}, {REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS:''},
    {REPORTING_AUTOMATIC_REFRESH_PROVIDERS:'*'}, {REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS:`${workspace},${workspace}`},
    {REPORTING_AUTOMATIC_REFRESH_PROVIDERS:'xero,xero'}, {REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS:Array.from({length:101},(_,i)=>id(i+1)).join(',')}])
    assert.equal(reportingRefreshScope({...process.env,...patch}),null);
  assert.equal(reportingRecurringAllowed(otherWorkspace,'xero'),false);
  assert.equal(validReportingSchedulerSecret(`Bearer ${process.env.CRON_SECRET}`,process.env.CRON_SECRET),true);
  for (const auth of [null,'Bearer short',`Bearer ${process.env.CRON_SECRET}x`]) assert.equal(validReportingSchedulerSecret(auth,process.env.CRON_SECRET),false);
});
test('automatic history refresh revisits exactly seven completed UTC dates across month/year and DST boundaries', () => {
  for (const now of ['2027-01-01T00:00:00Z','2026-03-09T07:30:00Z','2026-11-02T07:30:00Z']) {
    const range = recurringReportingRange(new Date(now));
    assert.equal(Date.parse(range.endAt)-Date.parse(range.startAt),7*86400000);
    assert.equal(range.endAt.slice(0,10),now.slice(0,10));
    assert(range.endDate < now.slice(0,10));
  }
});
for (const [index,provider] of providers.entries()) test(`${provider}: scheduled changed records reach checked typed evidence with preserved units, dates and source version`, async () => {
  configure(); const h = harness(provider,index+10);
  mockProvider(providerReplies(provider)); const firstTick = await h.tick(); assert.equal(firstTick.succeeded,1);
  const before = h.projected(); assert.equal(h.applyCount(),1);
  mockProvider(providerReplies(provider,2)); const secondTick = await h.tick(); assert.equal(secondTick.succeeded,1);
  const after = h.projected(); assert.equal(h.applyCount(),2); assert.notEqual(after.projected.hash,before.projected.hash);
  assert.notDeepEqual(after.projected.facts,before.projected.facts);
  assert.equal(after.projected.data.connection_id,h.row.id); assert.equal(after.projected.data.workspace_id,workspace);
  assert.throws(() => sharedRow(after.source,otherWorkspace));
  assert(after.projected.factTimes,'timing survives retrieval projection');
  if (provider === 'xero') { assert(after.projected.facts.some(f => f.includes('250 USD'))); assert(after.projected.facts.some(f => f.includes('balance at import'))); }
  if (provider === 'clockify') assert(after.projected.facts.some(f => f.includes('2 hours') && f.includes('UTC')));
  if (provider === 'harvest') assert(after.projected.facts.some(f => f.includes('2.5 hours')));
  if (provider === 'toggl') assert(after.projected.facts.some(f => f.includes('Lifetime') && f.includes('beginning unknown')));
  if (h.row.snapshot) assert.equal(h.row.snapshot.start,h.row.snapshot.end,'snapshot is a capture instant, not fabricated history');
  const saved = structuredClone(h.row); mockProvider([new Response('',{status:429,headers:{'retry-after':'7200'}})]);
  assert.equal(await h.refresh(),'failed'); assert.equal(h.row.last_sync_at,saved.last_sync_at);
  assert.deepEqual(h.row.records,saved.records); assert.deepEqual(h.row.snapshot,saved.snapshot); assert.equal(h.applyCount(),2);
  assert.equal(h.calls.at(-1).args.p_retry_seconds,7200); assert.equal(h.row.last_error_code,'quota_exceeded');
  for (const query of h.queries) { assert(query.filters.some(f => f[0]==='workspace_id'&&f[1]===workspace)); assert(query.filters.some(f => f[0]==='provider'&&f[1]===provider)); }
});
test('incomplete pagination, duplicate records and mid-read revocation preserve prior valid evidence', async () => {
  configure(); const h = harness(); mockProvider(providerReplies('harvest')); assert.equal(await h.refresh(),'succeeded');
  const saved = structuredClone(h.row), entry = providerReplies('harvest')[0].time_entries[0];
  for (const bad of [
    [{time_entries:[entry],page:1,next_page:null,total_entries:2}],
    [{time_entries:[entry,entry],page:1,next_page:null,total_entries:2}],
    [{time_entries:[entry],page:1,next_page:2,total_entries:2},new Response('',{status:503})]
  ]) {
    mockProvider(bad); assert.equal(await h.refresh(),'failed');
    assert.equal(h.applyCount(),1); assert.equal(h.row.last_sync_at,saved.last_sync_at); assert.deepEqual(h.row.records,saved.records);
  }
  mockProvider(providerReplies('harvest',2), () => { h.row.recurring_enabled=false; h.row.lease_id=null; });
  assert.equal(await h.refresh(),'deferred'); assert.equal(h.applyCount(),1); assert.deepEqual(h.row.records,saved.records);
  const reads = mockProvider([]); assert.equal(await h.refresh(),'deferred'); assert.equal(reads(),0);
});
test('excluded workspace, disabled consent and another live lease make no provider calls', async () => {
  configure(); const h = harness(), reads = mockProvider([]);
  h.row.recurring_enabled=false; assert.equal(await h.refresh(),'deferred'); h.row.recurring_enabled=true;
  h.row.lease_id=id(777); assert.equal(await h.refresh(),'deferred');
  process.env.REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS=otherWorkspace; assert.equal(await h.refresh(),'deferred');
  assert.equal(reads(),0);
});
test('scheduler bounds concurrency/work/deadline and rejects duplicate admission pages', async () => {
  configure(); const candidates = Array.from({length:20},(_,i)=>({id:id(100+i),workspace_id:id(1000+i%4),provider:'harvest'}));
  let active=0,peak=0,started=0; const tenants = new Set();
  const result=await runDueReportingRefreshes({due:async()=>candidates,eligible:()=>true,sync:async c=>{
    assert(!tenants.has(c.workspace_id)); tenants.add(c.workspace_id); active++;started++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1)); active--;tenants.delete(c.workspace_id);return 'succeeded';
  }});
  assert.equal(started,20);assert.equal(result.succeeded,20);assert.equal(peak,2);assert.equal(active,0);
  let clock=0,count=0;
  const bounded=await runDueReportingRefreshes({now:()=>clock,due:async()=>candidates,eligible:()=>true,sync:async()=>{count++;clock=200000;return 'succeeded';}});
  assert(count<=2); assert(bounded.remaining>=18);
  await assert.rejects(runDueReportingRefreshes({due:async()=>[candidates[0],candidates[0]],eligible:()=>true,sync:async()=>{throw new Error('must_not_start');}}),/due_invalid/);
});
test('Retry-After is bounded; credentials and provider error bodies never enter the error', async () => {
  assert.equal(reportingRetryAfter('900000'),86400);assert.equal(reportingRetryAfter('1'),60);assert.equal(reportingRetryAfter('invalid'),0);
  assert.equal(reportingRetryAfter('Mon, 16 Nov 2026 12:00:00 GMT',Date.parse('2026-11-16T11:00:00Z')),3600);
  global.fetch=async()=>new Response('credential-not-for-logs',{status:429,headers:{'retry-after':'120'}});
  await assert.rejects(readJson(new URL('https://api.xero.com/test'),{},new AbortController().signal),error=>
    error instanceof ReportingProviderError && error.message==='quota_exceeded' && error.retryAfterSeconds===120 && !String(error).includes('credential-not-for-logs'));
});
test('settings require explicit owner consent, server workspace and scoped rollout; disabling remains available when rollout/config is off', async () => {
  configure(); const h=harness();security.admin=()=>h.db;
  const request=body=>new Request('https://www.vaeroex.com/api/integrations/harvest/recurring-settings',{method:'POST',headers:{host:'www.vaeroex.com',origin:'https://www.vaeroex.com','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const context={params:Promise.resolve({provider:'harvest',action:'recurring-settings'})};
  const body={connectionId:h.row.id,enabled:'true',confirmation:'enable-recurring'};
  role='admin';await post(request(body),context);assert.equal(h.calls.length,0);role='owner';
  await post(request({...body,confirmation:''}),context);assert.equal(h.calls.length,0);
  assert.match((await post(request(body),context)).headers.get('location'),/recurring_enabled/);
  assert.deepEqual(h.calls.at(-1).args,{p_workspace:workspace,p_provider:'harvest',p_connection:h.row.id,p_actor:actor,p_enabled:true});
  process.env.REPORTING_AUTOMATIC_REFRESH_ENABLED='false';process.env.HARVEST_REPORTING_ENABLED='false';
  assert.match((await post(request({...body,enabled:'false',confirmation:'disable-recurring'}),context)).headers.get('location'),/recurring_disabled/);
  assert.equal(h.calls.at(-1).args.p_enabled,false);
});
test('cron authenticates before database access and stays inactive outside the explicit scope', async () => {
  configure();const h=harness();security.admin=()=>h.db;
  assert.equal((await GET(new Request('https://synthetic.invalid/api/integrations/reporting/scheduled-sync'))).status,401);assert.equal(h.calls.length,0);
  const request=()=>new Request('https://synthetic.invalid/api/integrations/reporting/scheduled-sync',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});
  process.env.REPORTING_AUTOMATIC_REFRESH_ENABLED='false';assert.deepEqual(await (await GET(request())).json(),{enabled:false,attempted:0});assert.equal(h.calls.length,0);
  configure();mockProvider(providerReplies('harvest'));const result=await GET(request());assert.equal(result.status,200);
  const body=await result.json();assert.equal(body.succeeded,1);assert.equal(body.recovered,0);
  assert.deepEqual(h.calls.slice(0,2).map(c=>c.name),['recover_reporting_recurring','list_due_reporting_refreshes']);
  assert.deepEqual(h.calls[0].args.p_allowed_workspaces,[workspace]);
});
test('a lost claim response settles only that attempted lease and does not fetch provider data', async () => {
  configure();const h=harness(),reads=mockProvider([]);h.row.loseClaimResponse=true;
  assert.equal(await h.refresh(),'failed');assert.equal(reads(),0);assert.equal(h.row.lease_id,null);
  assert.deepEqual(h.calls.map(c=>c.name),['claim_reporting_recurring','fail_reporting_recurring']);
  assert.equal(h.calls[0].args.p_lease,h.calls[1].args.p_lease);
  assert.equal(h.row.last_sync_at,null);assert.equal(h.applyCount(),0);
});
test('cron excludes unconfigured providers before due pagination and rejects malformed scopes without database reads', async () => {
  configure();const h=harness();security.admin=()=>h.db;
  const request=()=>new Request('https://synthetic.invalid/api/integrations/reporting/scheduled-sync',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});
  process.env.REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS='*';assert.deepEqual(await (await GET(request())).json(),{enabled:false,attempted:0});assert.equal(h.calls.length,0);
  configure();process.env.XERO_REPORTING_ENABLED='false';mockProvider(providerReplies('harvest'));
  assert.equal((await GET(request())).status,200);
  const args=h.calls.find(c=>c.name==='list_due_reporting_refreshes').args;
  assert(!args.p_allowed_providers.includes('xero'));assert(args.p_allowed_providers.includes('harvest'));
});
test('snapshot pagination and separate inventory filters cannot commit a partial current state', async () => {
  configure();
  for (const provider of ['toggl','zoho-inventory']) {
    const h=harness(provider);mockProvider(providerReplies(provider));assert.equal(await h.refresh(),'succeeded');
    const before=h.projected(),saved=structuredClone(h.row);
    const partial=provider==='toggl'
      ? [{data:[{id:'new-project',total_tracked_secs:18000}],page:1,total:2},new Response('',{status:503})]
      : [providerReplies(provider,2)[0],new Response('',{status:429})];
    const reads=mockProvider(partial);assert.equal(await h.refresh(),'failed');assert.equal(reads(),2);
    assert.equal(h.applyCount(),1);assert.deepEqual(h.row.snapshot,saved.snapshot);assert.equal(h.row.last_sync_at,saved.last_sync_at);
    assert.equal(h.projected().projected.hash,before.projected.hash,'failed read does not create a fresh source version');
  }
});
