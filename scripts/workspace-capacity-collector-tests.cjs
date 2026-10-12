/* eslint-disable @typescript-eslint/no-require-imports -- Offline capacity evidence regression. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCollectors}=require('./workspace-capacity-collectors.cjs');
test('independent telemetry readers cannot miss overwritten completion samples',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vaeroex-completion-regression-')),runtime=path.join(dir,'runtime.json');
 fs.writeFileSync(runtime,JSON.stringify({syntheticOnly:true,paidCredentialsPresent:false,runId:'test'}),{mode:0o600});
 const baseline={id:'baseline',eligible_at:new Date(0),started_at:new Date(100),status:'succeeded'};
 const one={id:'one',eligible_at:new Date(1000),started_at:new Date(9000),status:'succeeded'};
 const two={id:'two',eligible_at:new Date(2000),started_at:new Date(12000),status:'failed'};
 let terminal=[baseline,one];
 const db={query:async sql=>({rows:sql.includes('information_schema')?[{present:true}]:sql.includes('count(*)filter')?[{inflight:0,completed:2,failed:1}]:sql.includes('eligible_at,started_at,status')?terminal:[]})};
 try {
  const collectors=createCollectors({runtimeFile:runtime,baselineRunIds:['baseline']}),plan={workspaces:[{id:'tenant'}]};
  const first=await collectors.queueCollector({db,plan});assert.deepEqual(first.completed.map(x=>x.id),['one']);
  terminal=[baseline,one,two];await collectors.queueCollector({db,plan}); // Intentionally not consumed by runner.
  const latest=await collectors.queueCollector({db,plan});assert.equal(latest.completionHistoryComplete,true);
  assert.deepEqual(latest.completed.map(x=>x.id),['one','two']);assert.equal(latest.completed.length,new Set(latest.completed.map(x=>x.id)).size);
  assert.deepEqual(latest.completed.map(x=>Date.parse(x.startedAt)-Date.parse(x.eligibleAt)),[8000,10000]);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
