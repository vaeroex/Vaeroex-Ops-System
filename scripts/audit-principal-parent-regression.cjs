/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename, load = Module._load;
const quotas = new Map(), calls = [];
const admin = { rpc(name, args) { assert.equal(name, 'consume_request_rate_limit_v1'); calls.push(args); const key = args.p_action_key + args.p_identifier_hash; const count = (quotas.get(key) || 0) + 1; quotas.set(key, count); return {maybeSingle:async()=>({data:{allowed:count<=args.p_limit,request_count:count},error:null})}; } };
Module._resolveFilename = function(request,parent,isMain,options) { return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,isMain,options); };
Module._load = function(request,parent,isMain) { if(request==='server-only') return {}; if(request==='next/headers') return {headers:async()=>new Headers()}; if(request==='@/lib/supabase/admin') return {createSupabaseAdminClient:()=>admin}; return load.call(this,request,parent,isMain); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText, filename);
global.fetch=()=>{throw Error('External network forbidden');};
const {enforceRateLimit} = require('../lib/security/rate-limit.ts');
const {loadSourceParentEligibilityResult} = require('../lib/intelligence/source-parent-eligibility.ts');
const {buildIntelligenceLayer} = require('../lib/intelligence/layer.ts');
const {buildBusinessIntelligenceCoverage} = require('../lib/intelligence/coverage.ts');
const asOf='2026-10-05T00:00:00.000Z';
const file=(id,extra={})=>({id,workspace_id:'workspace-a',display_name:'Revenue evidence',original_name:'revenue.csv',file_extension:'csv',import_type:'kpi',processing_status:'ready',created_at:asOf,updated_at:asOf,processed_at:asOf,archived_at:null,deleted_at:null,metadata_json:{},...extra});
async function main() {
  for(const principal of [{userId:'user-a'},{workspaceId:'workspace-a'}]) {
    const responses=[];
    for(const ip of ['192.0.2.1','192.0.2.2','192.0.2.3']) responses.push(await enforceRateLimit({action:Object.keys(principal)[0],...principal,limit:2,windowSeconds:600,strict:true,requestHeaders:new Headers({'x-forwarded-for':ip})}));
    assert.deepEqual(responses.map(x=>x.allowed),[true,true,false],'rotating IP must not reset authenticated quota');
    assert.equal(new Set(calls.slice(-3).map(c=>c.p_identifier_hash)).size,1);
  }
  for(const ip of ['192.0.2.1','192.0.2.2']) assert.equal((await enforceRateLimit({action:'public',limit:1,windowSeconds:600,strict:true,requestHeaders:new Headers({'x-forwarded-for':ip})})).allowed,true);
  assert.equal((await enforceRateLimit({action:'public',limit:1,windowSeconds:600,strict:true,requestHeaders:new Headers({'x-forwarded-for':'192.0.2.1'})})).allowed,false);
  if(process.argv.includes('--quota-only')) { console.log('Principal rate-limit regressions passed.'); return; }
  const hiddenParent=file('older-parent'),displayFiles=Array.from({length:200},(_,i)=>file('display-'+i));
  const kpi={id:'kpi-a',workspace_id:'workspace-a',name:'Revenue',metric_date:'2026-10-05',actual_value:110,target:100,source_file_id:hiddenParent.id,import_id:null,created_at:asOf,updated_at:asOf,archived_at:null,deleted_at:null};
  const allFiles=[...displayFiles,hiddenParent],queries=[];
  const supabase={from(table){const filters=[]; const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},in(key,ids){filters.push([key,ids]);return query;},then(ok,bad){queries.push({table,filters});let data=table==='file_uploads'?allFiles:[];for(const [key,value]of filters)data=data.filter(row=>Array.isArray(value)?value.includes(row[key]):row[key]===value);return Promise.resolve({data,error:null}).then(ok,bad);}};return query;}};
  const loaded=await loadSourceParentEligibilityResult({supabase,workspaceId:'workspace-a',rows:[kpi]});
  assert.equal(loaded.error,null);assert.equal(loaded.eligibility.records.files.length,1);
  assert(queries.every(q=>q.filters.some(([k,v])=>k==='workspace_id'&&v==='workspace-a')),'every parent fetch must be workspace scoped');
  const memoryChunk={id:'memory-a',workspace_id:'workspace-a',source_type:'file',source_file_id:hiddenParent.id,archived_at:null,deleted_at:null,metadata_json:{}};
  const input={asOf,files:displayFiles,kpis:[kpi],memoryChunks:[memoryChunk],sourceParents:loaded.eligibility.records};
  assert.equal(buildIntelligenceLayer(input).memorySummary.kpiHistoryRecords,1,'201st parent must not erase its eligible KPI');
  assert.equal(buildBusinessIntelligenceCoverage(input).forecastReadiness.totalMeasurementCount,1);
  assert.equal(buildBusinessIntelligenceCoverage(input).evidenceSummary.memoryItemCount,1,'201st parent must not erase its eligible memory count');
  for(const excluded of [{archived_at:asOf},{deleted_at:asOf},{metadata_json:{business_evidence_eligible:false}}]) {
    const blocked={...input,sourceParents:{files:[file(hiddenParent.id,excluded)],imports:[]}};
    assert.equal(buildIntelligenceLayer(blocked).memorySummary.kpiHistoryRecords,0,'authoritative parents must still pass evidence eligibility');
    assert.equal(buildBusinessIntelligenceCoverage(blocked).evidenceSummary.memoryItemCount,0,'memory count must exclude archived, deleted or ineligible parents');
    assert.equal(buildBusinessIntelligenceCoverage({...input,memoryChunks:[{...memoryChunk,...excluded}]}).evidenceSummary.memoryItemCount,0,'memory count must preserve chunk lifecycle and evidence gates');
  }
  assert.equal(buildIntelligenceLayer({...input,sourceParents:{files:[],imports:[]}}).memorySummary.kpiHistoryRecords,0,'missing parents must fail closed');
  assert.equal(buildBusinessIntelligenceCoverage({...input,sourceParents:{files:[],imports:[]}}).evidenceSummary.memoryItemCount,0,'missing authoritative memory parents must fail closed');
  for(const source_type of ['business_signal','task','platform_run','ai_agent_run']) {
    const unlinked={...memoryChunk,source_type,source_file_id:null};
    assert.equal(buildBusinessIntelligenceCoverage({...input,memoryChunks:[unlinked]}).evidenceSummary.memoryItemCount,0,'memory count must preserve generated signal/task/run exclusions');
  }
  const importOnly={...kpi,source_file_id:null,import_id:'import-a'};
  assert.equal(buildIntelligenceLayer({...input,kpis:[importOnly],sourceParents:{files:[hiddenParent],imports:[{id:'import-a',file_upload_id:hiddenParent.id}]}}).memorySummary.kpiHistoryRecords,1);
  console.log('Audit principal-quota and authoritative-parent regressions passed (synthetic collaborators; actual source functions).');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
