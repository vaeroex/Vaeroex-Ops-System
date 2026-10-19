/* eslint-disable @typescript-eslint/no-require-imports -- Native evidence boundary regression. */
const assert=require('node:assert/strict');
const {loadSource}=require('./integrations-ui-test-support');
const {retrieveReportingEvidence}=loadSource('lib/integrations/reporting/evidence.ts');
const id='11111111-1111-4111-8111-111111111111';
let rows=[{id,provider:'clockify',status:'connected',snapshot:null,last_sync_at:'2026-10-19T00:00:00Z'}];
let history={hasHistory:true,records:1,metrics:[{key:'hours',value:150}],coverage:{days:28,completeDays:28,incompleteDays:0,startDate:'2026-08-24',endDate:'2026-09-20',lastImportedAt:'2026-09-21T00:00:00Z',coveredThrough:'2026-09-21T00:00:00Z'}};
let calls=0;
const access={workspaceId:id,user:{id},membership:{workspace_id:id,user_id:id,status:'active'},supabase:{from(table){assert.equal(table,'reporting_connections');const filters=[];const q={then(resolve){assert(filters.some(f=>f[0]==='eq'&&f[1]==='workspace_id'&&f[2]===id));assert(filters.some(f=>f[0]==='eq'&&f[1]==='status'&&f[2]==='connected'));return resolve({data:rows,error:null})}};for(const m of ['select','eq','in','limit'])q[m]=(...args)=>{filters.push([m,...args]);return q};return q},async rpc(name,args){calls++;assert.equal(name,'read_reporting_history');assert.equal(args.p_workspace,id);assert.equal(args.p_start_date,'2026-08-24');return {data:history,error:null}}}};
const read=()=>retrieveReportingEvidence(access,'2026-10-19T12:00:00Z',[{periodStart:'2026-08-24',periodEnd:'2026-09-20'}]);
(async()=>{
 let result=await read();assert.equal(result.sources.length,1);let value=JSON.parse(result.sources[0].text);assert.equal(value.stale,true);assert.equal(value.lastImportedAt,history.coverage.lastImportedAt);assert.equal(value.observation.completeRequestedPeriod,true);assert.match(value.limitation,/Not the workforce/);assert.deepEqual(value.subject,{scope:"authenticated_provider_user",businessRole:"unknown",businessOwnership:"unknown",workforceCoverage:false});assert.match(value.limitation,/business ownership are unknown/);assert.match(value.limitation,/full completed duration/);assert.equal(result.sources[0].treatment,'reported_context');
 history.coverage.lastImportedAt='2026-10-19T00:00:00Z';assert.equal(JSON.parse((await read()).sources[0].text).stale,false);
 for(const timestamp of ['invalid','2026-10-20T00:00:00Z']){history.coverage.lastImportedAt=timestamp;assert.equal((await read()).sources.length,0)}
 history.coverage.lastImportedAt='2026-10-19T00:00:00Z';history.coverage.completeDays=27;history.coverage.incompleteDays=1;assert.equal(JSON.parse((await read()).sources[0].text).observation.completeRequestedPeriod,false);
 history.hasHistory=false;history.coverage.days=0;result=await read();assert.equal(result.sources.length,0);assert.match(result.limitations.join(' '),/not zero/);
 history.hasHistory=true;history.coverage.days=28;history.records=0;history.metrics=[{key:'hours',value:0}];result=await read();assert.equal(JSON.parse(result.sources[0].text).observation.metrics[0].value,0);
 for(const status of ['disconnected','reauthorization_required']){rows[0].status=status;assert.equal((await read()).sources.length,0)}rows[0].status='connected';
 const before=calls;access.membership.workspace_id='foreign';assert.equal((await read()).sources.length,0);assert.equal(calls,before);
 console.log('Reported evidence: tenant/status guards, selected-window freshness, invalid/future timestamps, partial and missing/zero history, personal scope passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
