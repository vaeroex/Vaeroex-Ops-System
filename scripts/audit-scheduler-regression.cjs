/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
'use strict';
// Audit-only. Load the actual checked-out scheduler; all collaborators are synthetic.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname,'..');
const req = Module.createRequire(path.join(root, 'package.json'));
const ts = req('typescript');
global.fetch = () => { throw Error('audit_network_disabled'); };
for (const name of ['node:http', 'node:https']) {
  const api = require(name); api.request = api.get = () => { throw Error('audit_network_disabled'); };
}
require('node:net').Socket.prototype.connect = () => { throw Error('audit_network_disabled'); };
const sourcePath = path.join(root, 'lib/integrations/google-sheets/scheduler.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const target = new Module(sourcePath, module);
target.filename = sourcePath;
target.paths = Module._nodeModulePaths(root);
target.require = name => name === 'server-only' ? {} : req(name);
target._compile(compiled, sourcePath);
const {runDueSheetsRefreshes} = target.exports;
const thresholds = JSON.parse(fs.readFileSync(path.join(root, 'docs/security/audit-evidence/stage-3/scheduler-thresholds.json')));
const started = performance.now();
const watchdog = setTimeout(() => { throw Error('audit_wall_budget_exceeded'); }, thresholds.bounds.wallTimeoutMs);
function percentile(xs, p) { return xs.length ? [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1] : null; }
async function scenario(name, count, durationMs, options={}) {
  let time = Date.UTC(2026, 9, 4), origin=time;
  const queue = Array.from({length:count}, (_, i)=>({id:`connection-${i}`, workspace_id:`workspace-${i}`, dueAt:origin-1000+i, readyAt:origin, failed: Boolean(options.failedBackoff && i<10)}));
  const attempts=[], ticks=[];
  let maximumActive=0, active=0;
  const events=[];
  const wait=milliseconds=>new Promise(resolve=>events.push({at:time+milliseconds,resolve}));
  async function advance(promise){
    let settled=false,failure,value;
    promise.then(result=>{value=result;settled=true;},error=>{failure=error;settled=true;});
    while(!settled){
      // Let all runnable promise continuations schedule their next event before
      // advancing the common clock; concurrent work must not add durations.
      await new Promise(resolve=>setImmediate(resolve));
      if(settled)break;
      assert(events.length,'simulation stalled without a scheduled event');
      time=Math.min(...events.map(event=>event.at));
      for(let i=events.length-1;i>=0;i--)if(events[i].at<=time)events.splice(i,1)[0].resolve();
    }
    if(failure)throw failure;return value;
  }
  for (let tick=0; tick<(options.ticks||1); tick++) {
    time=origin+tick*900000;
    const tickStart=time;
    const result=await advance(runDueSheetsRefreshes({
      now:()=>time,
      due:async (tickAt,limit,deadline,excluded)=>queue.filter(c=>!excluded.includes(c.id)&&c.dueAt<=Date.parse(tickAt)).sort((a,b)=>a.dueAt-b.dueAt).slice(0,limit),
      sync:async c=>{
        active++; maximumActive=Math.max(maximumActive, active);
        attempts.push({tick,connection:c.id,workspace:c.workspace_id,queueDelayMs:time-c.readyAt,failed:c.failed});
        await wait(options.slowFirst && c.id==='connection-0' ? 239000 : durationMs);
        active--;
        if(c.failed) throw Error('synthetic_provider_or_database_failure');
        c.dueAt=options.recurring ? origin+(tick+1)*900000 : Infinity;
        c.readyAt=c.dueAt;
      },
      backoff:async c=>{if(options.failedBackoff) throw Error('synthetic_backoff_ack_failure'); c.dueAt=time+3600000;}
    }));
    const samples=attempts.filter(a=>a.tick===tick);
    assert.equal(new Set(samples.map(a=>a.connection)).size,samples.length,'duplicate in tick');
    assert.equal(result.attempted,samples.length);
    assert.equal(result.failed,samples.filter(a=>a.failed).length);
    ticks.push({tick,...result,simulatedElapsedMs:time-tickStart,pendingDue:queue.filter(c=>c.dueAt<=tickStart).length,
      oldestPendingAgeMs:Math.max(0,...queue.filter(c=>c.dueAt<=tickStart).map(c=>time-c.readyAt)),
      attemptedQueueP50Ms:percentile(samples.map(a=>a.queueDelayMs),.5),attemptedQueueP95Ms:percentile(samples.map(a=>a.queueDelayMs),.95),attemptedQueueP99Ms:percentile(samples.map(a=>a.queueDelayMs),.99)});
  }
  const healthyAttempts=attempts.filter(a=>!a.failed).length;
  const acceptance=options.failedBackoff ? {healthyWorkspaceProgress:healthyAttempts>0,truthfulFailureCounts:true,noDuplicatesPerTick:true} : {
    allOfferedAttempted: ticks.every(t=>t.attempted===count),queueP95: ticks.every(t=>t.attemptedQueueP95Ms<=thresholds.nominalAcceptance.queueP95Ms),noDuplicatesPerTick:true
  };
  return {name,workspaces:count,assumedSyncDurationMs:durationMs,slowFirstDurationMs:options.slowFirst?239000:undefined,
    virtualTime:true,maximumActive,ticks,healthyAttempts,workspacesServed:new Set(attempts.filter(a=>!a.failed).map(a=>a.workspace)).size,
    quietWorkspaceFirstDelayMs:attempts.find(a=>a.workspace==='workspace-1')?.queueDelayMs??null,
    allAcceptanceThresholdsPassed:Object.values(acceptance).every(Boolean),acceptance};
}
(async()=>{
  const results=[];
  for(const duration of [500,5000]) for(const count of [20,50,100]) results.push(await scenario(`burst-${count}-${duration}ms`,count,duration));
  const baseline=await scenario('quiet-baseline',20,500);
  const slow=await scenario('one-slow-workspace',20,500,{slowFirst:true});
  slow.quietDelayRatio=baseline.quietWorkspaceFirstDelayMs===0 ? (slow.quietWorkspaceFirstDelayMs===0?1:Infinity) : slow.quietWorkspaceFirstDelayMs/baseline.quietWorkspaceFirstDelayMs;
  slow.acceptance.quietDelayRatio=slow.quietDelayRatio<=thresholds.faultAcceptance.quietWorkspaceQueueDelayRatioToBaselineMax;
  slow.allAcceptanceThresholdsPassed=Object.values(slow.acceptance).every(Boolean);
  results.push(baseline,slow,await scenario('failed-backoff-head-blocking',20,500,{failedBackoff:true,ticks:4}),
    await scenario('recurring-100-workspaces-four-ticks',100,500,{recurring:true,ticks:4}));
  const recovered=results.find(r=>r.name==='failed-backoff-head-blocking');
  assert.equal(recovered.healthyAttempts,10,'healthy workspaces must progress despite failed backoff');
  assert.equal(recovered.workspacesServed,10);
  assert.equal(results.find(r=>r.name==='burst-100-500ms').ticks[0].attempted,50,'preserve bounded tick budget');
  clearTimeout(watchdog);
  console.log(JSON.stringify({sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex'),thresholds,executedAt:new Date().toISOString(),
    runtime:{node:process.version,platform:process.platform,arch:process.arch},wallElapsedMs:performance.now()-started,rssBytes:process.memoryUsage().rss,
    networkCalls:0,limits:'Virtual service times and in-memory queue: not HTTP, DB, persistence, provider, resource-soak or concurrent-user capacity evidence.',results},null,2));
})().catch(e=>{clearTimeout(watchdog);console.error(e);process.exitCode=1;});
