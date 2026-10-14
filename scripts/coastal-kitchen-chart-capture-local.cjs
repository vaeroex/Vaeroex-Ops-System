/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in owned loopback-only financial qualification. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(root+'/package.json'),ts=req('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const resolver=Module._resolveFilename;Module._resolveFilename=function(r,p,...rest){if(r==='server-only')return r;return resolver.call(this,r.startsWith('@/')?root+'/'+r.slice(2):r,p,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const privateDir=process.argv[process.argv.indexOf('--config-dir')+1];
assert(process.argv.includes('--config-dir')&&path.isAbsolute(privateDir),'Owned local config required');
assert(!path.resolve(privateDir).startsWith(root+path.sep),'Private config must remain outside Git');
const config=req('./scripts/vsi-e2e-fixture.cjs').readConfig(path.join(privateDir,'private-e2e-config.json'));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:config.apiUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anonKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,VERCEL_ENV:'preview',QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED:'true'});
const {Client}=req('pg'),{createClient}=req('@supabase/supabase-js');
const {financialQuestion}=req('./scripts/website-demo/financial-history.ts');
async function main(){
 const actor=JSON.parse(fs.readFileSync(path.join(privateDir,'coastal-actor.private.json')));
 const db=new Client({connectionString:config.dbUrl});await db.connect();
 assert(fs.realpathSync((await db.query("select current_setting('data_directory') directory")).rows[0].directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+'/stacks/'));
 await db.end();
 const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 assert(!(await client.auth.signInWithPassword({email:actor.email,password:actor.password})).error,'Local login failed');
 const begin=req('./lib/integrations/google-sheets/read-authority.ts').beginGoogleSheetsRead;
 const ticket=await begin(client,actor.workspaceId,actor.id);
 const {briefingPackage}=await req('./lib/ai/intelligence-briefing/workspace-context.ts').buildWorkspaceIntelligenceBriefingPackage({supabase:client,workspaceId:actor.workspaceId,workspace:{name:'Coastal Kitchen',industry:'Restaurant'},briefingType:'monthly',asOf:'2026-10-12T18:00:00.000Z',readTicket:ticket});
 console.log(JSON.stringify({eligibility:briefingPackage.eligibility,period:briefingPackage.period,chartSignals:briefingPackage.signals.filter(s=>s.comparisonUnit!==undefined).map(s=>({ref:s.ref,label:s.label,lineage:s.temporalLineage}))}));
 fs.writeFileSync(path.join(privateDir,'imagery-briefing-package.json'),JSON.stringify(briefingPackage,null,2),{mode:0o600});
 if(!process.argv.includes('--generate'))return;
 const priorPath=path.join(privateDir,'imagery-charts-generation.private.json');
 const resume=process.argv.includes('--briefing-only');
 const out=path.join(privateDir,resume?'imagery-briefing-retry.private.json':'imagery-charts-generation.private.json');assert(!fs.existsSync(out),'Attempt already exists; inspect before retrying');
 const keyFile=path.join(require('node:os').homedir(),'.config/vaeroex/coastal-kitchen/provider.env');assert.equal(fs.statSync(keyFile).mode&0o077,0);
 process.env.OPENAI_API_KEY=require('node:util').parseEnv(fs.readFileSync(keyFile,'utf8')).OPENAI_API_KEY;
 assert(req('./lib/vsi/config.ts').getVsiConfig().requestReserveUsd<=.25);
 fs.writeFileSync(out,JSON.stringify({status:'started',synthetic:true}),{mode:0o600});
 const prior=resume?JSON.parse(fs.readFileSync(priorPath)):null;
 if(resume) assert(prior?.synthetic===true && prior?.vsi?.content && prior?.vsi?.citations?.length,'Resume requires an inspected synthetic VSI answer');
 const result={...(resume?{vsi:prior.vsi}:{}),synthetic:true,applicationCommit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
 try {
 const vsiTicket=await begin(client,actor.workspaceId,actor.id);
 if(!resume) result.vsi=await req('./lib/vsi/engine.ts').runVsiAnswer({readTicket:vsiTicket,supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id,question:financialQuestion,recentMessages:[],requestId:crypto.randomUUID()});
 fs.writeFileSync(out,JSON.stringify({...result,status:'vsi-completed'},null,2),{mode:0o600});

 process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY=req('./lib/ai/providers/workflow-provider-policy.ts').INTELLIGENCE_BRIEFING_POLICY_SELECTOR;
 result.briefing=await req('./lib/ai/intelligence-briefing/service.ts').generateIntelligenceBriefing({supabase:client,workspaceId:actor.workspaceId,readTicketId:ticket.ticketId,briefingPackage});
 fs.writeFileSync(out,JSON.stringify({...result,status:'completed'},null,2),{mode:0o600});
 console.log(JSON.stringify({completed:true,vsiUsage:result.vsi.usage,briefingUsage:result.briefing.usage,briefingCharts:req('./lib/charts/briefing.ts').briefingComparisons(result.briefing.artifact).length}));
 }catch(e){fs.writeFileSync(out,JSON.stringify({...result,status:'failed',message:e.message},null,2),{mode:0o600});throw e;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
