/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic provider adapter boundary using actual sync orchestration. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const load=Module._load;Module._load=function(request,parent,isMain){if(request==='server-only')return{};return load.call(this,request,parent,isMain);};
const executionApi=require('../lib/integrations/google-sheets/execution.ts');
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,isMain,options){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,isMain,options);};
const contracts=require('../lib/integrations/google-sheets/contracts.ts'),ingestion=require('../lib/integrations/google-sheets/ingestion.ts');
const {randomUUID}=require('node:crypto');const workspaceId=randomUUID(),connectionId=randomUUID(),businessEntityId=randomUUID();
const mapping={rowKeyColumn:0,dateColumn:1,dateFormat:'iso',locationColumn:null,metrics:[{column:2,name:'Daily orders',unit:'count',category:'Operations',target:null}]};
const headers=['Key','Date','Orders'];
async function scenario(mode){
 let metadataCalls=0,headerCalls=0,valueCalls=0,abortedReads=0,abortedCommits=0,abortedCleanup=0;const mutations=[];
 const deadlineMode=mode.startsWith('deadline_');const execution={deadlineAt:0,cleanupDeadlineAt:0};
 const untilAbort=(signal,mark)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{mark();reject(signal.reason);},{once:true}));
 const connection={spreadsheet_id:'abcdefghijklmnopqrstuvwxyz123456',sheet_id:0,sheet_title:'Daily',header_row:1,headers,field_mapping:mapping,business_entity_id:businessEntityId};
 const query={select(){return this;},eq(){return this;},abortSignal(){return this;},async single(){return{data:connection,error:null};}};
 const server={sheetsAdmin:()=>({from:()=>query,rpc:(name,args)=>({abortSignal:async signal=>{mutations.push({name,args});if(name==='claim_google_sheets_sync_v1')return{data:{runId:randomUUID()},error:null};if(name==='commit_google_sheets_sync_v1'){if(mode==='deadline_commit')return untilAbort(signal,()=>abortedCommits++);return{data:{runId:args.p_run_id,rowCount:1,factCount:1,rejectedCount:0,conflictCount:0},error:null};}assert.equal(signal.aborted,false);if(mode==='deadline_cleanup')return untilAbort(signal,()=>abortedCleanup++);return{data:null,error:null};}})}),
 sheetsMetadata:async(_w,_c,_s,budget)=>{assert.equal(budget,execution);metadataCalls++;return{title:'Daily report',tabs:[{id:0,title:'Daily',rowCount:mode==='grid_changed'&&metadataCalls===2?3:2}]};},
 sheetsHeaders:async(_w,_c,_s,_t,_h,budget)=>{assert.equal(budget,execution);headerCalls++;if(mode==='deadline_before_commit'&&headerCalls===2)await new Promise(resolve=>setTimeout(resolve,150));return mode==='headers_changed'&&headerCalls===2?['Key','Date','Refunds']:headers;},
 sheetsMappedColumns:async(_w,_c,_s,_ranges,_render,budget)=>{assert.equal(budget,execution);valueCalls++;if(mode==='deadline_values'||mode==='deadline_cleanup')return executionApi.withSheetsRequest(budget.deadlineAt,15000,signal=>untilAbort(signal,()=>abortedReads++));if(mode==='partial_failure'&&valueCalls===2)throw Error('google_sheets_provider_request_failed');return[[['row-1']],[['2026-10-01']],[[mode==='values_changed'&&valueCalls===2?11:10]]];}};
 const filename=path.join(root,'lib/integrations/google-sheets/sync.ts');const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;
 loaded.require=name=>{if(name==='server-only')return{};if(name==='./server')return server;if(name==='./contracts')return contracts;if(name==='./ingestion')return ingestion;if(name==='./execution')return executionApi;return require(name);};
 loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
 execution.deadlineAt=Date.now()+(deadlineMode?100:5000);execution.cleanupDeadlineAt=Date.now()+5000;
 if(mode==='deadline_before_claim')execution.deadlineAt=Date.now()-1;
 if(mode==='deadline_cleanup')execution.cleanupDeadlineAt=Date.now()+200;
 const promise=loaded.exports.runSheetsSync({workspaceId,connectionId,actorId:randomUUID(),sessionId:randomUUID(),trigger:deadlineMode?'scheduled':'manual',execution});
 if(mode==='success'){await promise;assert.equal(mutations.filter(item=>item.name==='commit_google_sheets_sync_v1').length,1);assert.equal(metadataCalls,2);assert.equal(headerCalls,2);assert.equal(valueCalls,2);}
 else{await assert.rejects(promise,deadlineMode?/google_sheets_deadline_exceeded/:undefined);
   assert.equal(mutations.filter(item=>item.name==='commit_google_sheets_sync_v1').length,mode==='deadline_commit'?1:0);
   assert.equal(mutations.filter(item=>item.name==='fail_google_sheets_sync_v1').length,mode==='deadline_before_claim'?0:1);
   if(deadlineMode&&mode!=='deadline_before_claim')assert.equal(mutations.find(item=>item.name==='fail_google_sheets_sync_v1').args.p_error_code,'deadline_exceeded');
   if(mode==='deadline_values'||mode==='deadline_cleanup'){assert.equal(valueCalls,1);assert.equal(abortedReads,1);}
   if(mode==='deadline_commit')assert.equal(abortedCommits,1);
   if(mode==='deadline_cleanup')assert.equal(abortedCleanup,1);
 }
}
(async()=>{for(const mode of ['success','partial_failure','values_changed','headers_changed','grid_changed','deadline_before_claim','deadline_values','deadline_before_commit','deadline_commit','deadline_cleanup'])await scenario(mode);console.log(JSON.stringify({suite:'google_sheets_sync_adapter',scenarios:10,liveProviderCalls:0}));})().catch(error=>{console.error(error);process.exitCode=1;});
