const assert = require("node:assert/strict");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { runSquareMappedSync } = require("../lib/integrations/control-plane/square-gcp-mapped-sync.ts");
let assertions = 0;
const eq = (a,b) => { assertions++; assert.deepEqual(a,b); };
const page = (extra={}) => ({ outcome:"committed",code:"page_committed",sourceCount:2,continuation:true,retryAfterMs:null,completeness:null,...extra });
async function run(values, options={}) {
  let clock=0,calls=0;const waits=[],controller=new AbortController();
  if(options.aborted)controller.abort();
  const result=await runSquareMappedSync({ monotonicNow:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;if(options.abortWait)controller.abort();},
    runPage:async()=>{calls++;clock+=options.pageTime??1;if(options.abortPage)controller.abort();if(options.throw)throw Error("SECRET_MUST_NOT_ESCAPE");return values[Math.min(calls-1,values.length-1)];}
  },options.duration??300000,controller.signal);
  eq(JSON.stringify(result).includes("SECRET"),false);eq(result.historical,"unknown");eq(result.economic,"blocked");
  return {result,calls,waits};
}
async function main(){
  let f=await run([page(),page({continuation:false})]);eq(f.calls,2);eq(f.waits,[500]);eq(f.result.stop,"scan_exhausted");eq(f.result.sourceObservations,4);
  f=await run([page()]);eq(f.calls,10);eq(f.result.stop,"page_budget");eq(f.result.acknowledgedPages,10);
  f=await run([page({outcome:"finished",sourceCount:0,continuation:false})]);eq(f.calls,1);eq(f.result.acknowledgedPages,0);eq(f.result.stop,"scan_exhausted");
  for(const outcome of ["blocked","rejected","conflict"]){f=await run([page({outcome})]);eq(f.calls,1);eq(f.result.stop,outcome);eq(f.result.sourceObservations,0);}
  for(const code of ["rate_limited","transient","deadline","checkpoint_deferred"]){f=await run([page({outcome:"retry",code,retryAfterMs:60000})]);eq(f.calls,1);eq(f.result.stop,"retry_deferred");eq(f.result.retryAfterMs,60000);eq(f.waits,[]);}
  for(const code of ["invocation_interrupted","invocation_deadline","cancelled","SECRET"]){f=await run([page({outcome:"retry",code,retryAfterMs:30000})]);eq(f.calls,1);eq(f.result.stop,"recovery_required");}
  for(const retryAfterMs of [null,-1,Infinity,1.5,86400001]){f=await run([page({outcome:"retry",retryAfterMs})]);eq(f.result.stop,"recovery_required");}
  for(const value of [null,{},page({sourceCount:-1}),page({sourceCount:Infinity}),page({continuation:"SECRET"}),page({outcome:"SECRET"}),new Proxy(page(),{}),Object.defineProperty(page(),"outcome",{get(){throw Error("SECRET");}})]){f=await run([value]);eq(f.calls,1);eq(f.result.stop,"recovery_required");}
  f=await run([page()],{throw:true});eq(f.result.stop,"recovery_required");eq(f.result.retryAfterMs,30000);
  f=await run([page()],{aborted:true});eq(f.calls,0);eq(f.result.stop,"cancelled");
  for(const option of ["abortPage","abortWait"]){f=await run([page()],{[option]:true});eq(f.calls,1);eq(f.result.stop,"cancelled");}
  f=await run([page()],{duration:61999});eq(f.calls,0);eq(f.result.stop,"deadline");
  f=await run([page()],{duration:62000});eq(f.calls,1);eq(f.result.stop,"deadline");
  f=await run([page()],{duration:124000,pageTime:62000});eq(f.calls,1);eq(f.result.stop,"deadline");
  for(const pageTime of [45000,60000]){f=await run([page()],{duration:90000,pageTime});eq(f.calls,1);eq(f.result.stop,"deadline");}
  for(const duration of [0,300001,Infinity,NaN,1.1]){await assert.rejects(()=>runSquareMappedSync({runPage:()=>assert.fail()},duration,new AbortController().signal));assertions++;}
  // Real timer cancellation settles without another invocation.
  const c=new AbortController();let calls=0;const started=Date.now();
  const pending=runSquareMappedSync({runPage:async()=>{calls++;setTimeout(()=>c.abort(),5);return page();}},120000,c.signal);
  eq((await pending).stop,"cancelled");eq(calls,1);eq(Date.now()-started<1000,true);
  process.stdout.write(`square_bounded_sync_passed ${assertions}\n`);
}
main().catch(()=>{process.stderr.write("square_bounded_sync_failed\n");process.exitCode=1;});
