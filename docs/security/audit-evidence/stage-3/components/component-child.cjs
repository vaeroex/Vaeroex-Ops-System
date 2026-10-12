const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const ts=require('typescript');
const root=process.env.VAEROEX_AUDIT_ROOT||'/tmp/vaeroex-audit-production';
const job=JSON.parse(process.argv[2]),fixed='2026-10-05T00:00:00.000Z',NativeDate=Date;
global.Date=class AuditDate extends NativeDate {constructor(...args){if(args.length)super(...args);else super(fixed);}static now(){return NativeDate.parse(fixed);}};
const resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(r,p,i,o){return resolve.call(this,r.startsWith('@/')?path.join(root,r.slice(2)):r,p,i,o);};
Module._load=function(r,p,i){return r==='server-only'?{}:load.call(this,r,p,i);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
global.fetch=()=>{throw Error('Network prohibited');};
const {parseSpreadsheetWorkbook}=require(path.join(root,'lib/imports/spreadsheets.ts'));
const {buildCanonicalKpiProducerOutputV1}=require(path.join(root,'lib/kpis/snapshot-producer.ts'));
const {buildIntelligenceLayer}=require(path.join(root,'lib/intelligence/layer.ts'));
const {buildBusinessIntelligenceCoverage}=require(path.join(root,'lib/intelligence/coverage.ts'));
const ws='synthetic-bounded-component',asOf=fixed,hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const dateFor=m=>new Date(Date.UTC(2024,10+m,1)).toISOString().slice(0,10);
const samples=[],digests=[];
let bytes=0,integrity={};
for(let iteration=0;iteration<job.iterations;iteration++){
 if(global.gc)global.gc();
 const cpuBefore=process.cpuUsage();
 if(job.kind==='import'){
  const csv='id,name,date,value\n'+Array.from({length:job.rows},(_,i)=>`row-${i},Audit metric ${String(i%job.series).padStart(3,'0')},${dateFor(Math.floor(i/job.series)%job.months)},${i+1}`).join('\n');
  bytes=Buffer.byteLength(csv);assert(bytes<=10*1024*1024);
  const start=performance.now();
  const workbook=parseSpreadsheetWorkbook({fileName:'synthetic.csv',buffer:Buffer.from(csv)});
  const parsedAt=performance.now();
  assert.equal(workbook.rows.length,job.rows);
  const rows=workbook.rows.map((r,i)=>{assert.equal(r.values.id,`row-${i}`);assert.equal(Number(r.values.value),i+1);return {id:r.values.id,name:r.values.name,metric_date:r.values.date,actual_value:Number(r.values.value),target:null,workspace_id:ws,created_at:asOf,source_file_id:'synthetic-source',archived_at:null,deleted_at:null};});
  const mappedAt=performance.now();
  const result=buildCanonicalKpiProducerOutputV1({workspaceId:ws,rows,settings:[],asOf});
  const end=performance.now();
  assert.equal(result.length,job.series);
  assert.equal(result.reduce((n,r)=>n+r.observations.selectedRange.totalObservationCount,0),job.rows);
  assert.equal(rows.reduce((n,r)=>n+r.actual_value,0),job.rows*(job.rows+1)/2);
  for(const metric of result){const chosen=rows.find(r=>r.id===metric.id);assert(chosen);const expected=rows.filter(r=>r.name===chosen.name);assert(expected.length);expected.sort((a,b)=>a.metric_date.localeCompare(b.metric_date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));assert.equal(metric.observations.current.value,expected.at(-1).actual_value);}
  digests.push(hash(result));
  integrity={rows:rows.length,series:result.length,valueChecksum:rows.reduce((n,r)=>n+r.actual_value,0),allIdsPreserved:true};
  samples.push({iteration,parseMs:parsedAt-start,mapAndIntegrityMs:mappedAt-parsedAt,canonicalMs:end-mappedAt,totalMs:end-start,cpuMs:(()=>{const c=process.cpuUsage(cpuBefore);return(c.user+c.system)/1000;})(),rssBytes:process.memoryUsage().rss});
 }else{
  const files=Array.from({length:job.files},(_,i)=>({id:`file-${i}`,workspace_id:ws,display_name:`Revenue source ${i}`,original_name:`revenue-${i}.csv`,file_extension:'csv',processing_status:'ready',metadata_json:{},created_at:asOf,updated_at:asOf,processed_at:asOf,deleted_at:null,archived_at:null}));
  const rows=files.flatMap((f,i)=>Array.from({length:job.months},(_,m)=>({id:`kpi-${i}-${m}`,workspace_id:ws,name:`Revenue category ${i%job.series}`,metric_date:dateFor(m),actual_value:110+m,target:100,source_file_id:f.id,created_at:asOf,updated_at:asOf,deleted_at:null,archived_at:null})));
  const kpiSettings=Array.from({length:job.series},(_,i)=>({workspace_id:ws,kpi_name:`Revenue category ${i}`,canonical_name:`revenue_category_${i}`,desired_direction:'maximize',classification_confirmed:true,classification_source:'user',target:100}));
  const input={asOf,files,kpis:rows,kpiSettings};
  const start=performance.now(),layer=buildIntelligenceLayer(input),layerAt=performance.now(),coverage=buildBusinessIntelligenceCoverage(input),end=performance.now();
  assert.equal(layer.memorySummary.kpiHistoryRecords,rows.length);
  const fileCategory=layer.memorySummary.eligibleSignalCategories.find(c=>c.id==='files');assert.equal(fileCategory.count,files.length);
  assert.equal(layer.insights.length,job.series);
  digests.push(hash({layer,coverage}));
  integrity={files:files.length,rows:rows.length,eligibleKpiRecords:layer.memorySummary.kpiHistoryRecords,eligibleFiles:fileCategory.count,findings:layer.insights.length};
  samples.push({iteration,layerMs:layerAt-start,coverageMs:end-layerAt,totalMs:end-start,cpuMs:(()=>{const c=process.cpuUsage(cpuBefore);return(c.user+c.system)/1000;})(),rssBytes:process.memoryUsage().rss});
 }
}
assert.equal(new Set(digests).size,1);
const sorted=samples.map(s=>s.totalMs).sort((a,b)=>a-b),percentile=p=>sorted[Math.ceil(sorted.length*p)-1];
console.log(JSON.stringify({job,sourceRoot:root,node:process.version,platform:process.platform,bytes,integrity,deterministicDigest:digests[0],samples,summary:{p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:sorted.at(-1),diagnosticBudgetMs:job.kind==='import'?5000:10000,withinDiagnosticBudget:sorted.at(-1)<=(job.kind==='import'?5000:10000)},resourceUsage:process.resourceUsage(),maxRssBytes:process.resourceUsage().maxRSS*1024,scope:'actual functions with synthetic in-memory inputs; excludes IO/persistence/API/model/user capacity'},null,2));
