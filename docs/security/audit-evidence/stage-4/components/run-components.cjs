const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'plan.json'),'utf8'));
const selected=process.argv[2]?plan.datasets.filter((j,i)=>String(i)===process.argv[2]):plan.datasets;
if(!selected.length)throw Error('No selected dataset');
const watcherPreflight=Number(execFileSync('/bin/ps',['-o','rss=','-p',String(process.pid)],{encoding:'utf8',timeout:1000}).trim());
if(!Number.isFinite(watcherPreflight)||watcherPreflight<=0)throw Error('RSS watcher unavailable; refuse to run.');
async function run(job){
 const label=job.kind==='import'?`import-${job.rows}`:`sources-${job.files}-${job.months}`;
 const started=new Date().toISOString(),begin=Date.now();
 const child=spawn(process.execPath,['--max-old-space-size=256','--expose-gc',path.join(__dirname,'component-child.cjs'),JSON.stringify(job)],{env:{...process.env,NODE_PATH:path.join(plan.sourceRoot,'node_modules'),VAEROEX_AUDIT_ROOT:plan.sourceRoot},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',observedRssBytes=0,stopReason=null;
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1000000){stopReason='output limit';child.kill('SIGKILL');}});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>1000000)child.kill('SIGKILL');});
 const watchdog=setInterval(()=>{try{const rss=Number(execFileSync('/bin/ps',['-o','rss=','-p',String(child.pid)],{encoding:'utf8',timeout:1000}).trim())*1024;observedRssBytes=Math.max(rss,observedRssBytes);if(rss>plan.hardBounds.maxRssBytes){stopReason='RSS limit';child.kill('SIGKILL');}}catch(e){if(e.status!==1){stopReason='RSS watchdog failed';child.kill('SIGKILL');}}},plan.hardBounds.rssWatchdogIntervalMs);
 const timer=setTimeout(()=>{stopReason='wall time limit';child.kill('SIGKILL');},plan.hardBounds.wallMsPerChild);
 const code=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
 clearInterval(watchdog);clearTimeout(timer);
 let output=null;try{output=JSON.parse(stdout);}catch{}
 const result={started,elapsedMs:Date.now()-begin,job,...code,stopReason,observedRssBytes,output,stderr:stderr.slice(0,10000)};
 fs.writeFileSync(path.join(__dirname,`${label}.json`),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({label,code,stopReason,elapsedMs:result.elapsedMs,observedRssBytes,summary:output?.summary,integrity:output?.integrity}));
 if(code.code!==0||stopReason||!output||output.maxRssBytes>plan.hardBounds.maxRssBytes)throw Error('Stop: failing resource/integrity bound; do not advance larger dataset.');
}
(async()=>{for(const job of selected)await run(job);})().catch(e=>{console.error(e.message);process.exitCode=1;});
