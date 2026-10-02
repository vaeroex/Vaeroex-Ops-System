/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic provider adapter boundary using actual sync orchestration. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,isMain,options){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,isMain,options);};
const contracts=require('../lib/integrations/google-sheets/contracts.ts'),ingestion=require('../lib/integrations/google-sheets/ingestion.ts');
const {randomUUID}=require('node:crypto');const workspaceId=randomUUID(),connectionId=randomUUID(),businessEntityId=randomUUID();
const mapping={rowKeyColumn:0,dateColumn:1,dateFormat:'iso',locationColumn:null,metrics:[{column:2,name:'Daily orders',unit:'count',category:'Operations',target:null}]};
const headers=['Key','Date','Orders'];
async function scenario(mode){
 let metadataCalls=0,headerCalls=0,valueCalls=0;const mutations=[];
 const connection={spreadsheet_id:'abcdefghijklmnopqrstuvwxyz123456',sheet_id:0,sheet_title:'Daily',header_row:1,headers,field_mapping:mapping,business_entity_id:businessEntityId};
 const query={select(){return this;},eq(){return this;},async single(){return{data:connection,error:null};}};
 const server={sheetsAdmin:()=>({from:()=>query,rpc:async(name,args)=>{mutations.push({name,args});if(name==='claim_google_sheets_sync_v1')return{data:{runId:randomUUID()},error:null};if(name==='commit_google_sheets_sync_v1')return{data:{runId:args.p_run_id,rowCount:1,factCount:1,rejectedCount:0,conflictCount:0},error:null};return{data:null,error:null};}}),
 sheetsMetadata:async()=>{metadataCalls++;return{title:'Daily report',tabs:[{id:0,title:'Daily',rowCount:mode==='grid_changed'&&metadataCalls===2?3:2}]};},
 sheetsHeaders:async()=>{headerCalls++;return mode==='headers_changed'&&headerCalls===2?['Key','Date','Refunds']:headers;},
 sheetsMappedColumns:async()=>{valueCalls++;if(mode==='partial_failure'&&valueCalls===2)throw Error('google_sheets_provider_request_failed');return[[['row-1']],[['2026-10-01']],[[mode==='values_changed'&&valueCalls===2?11:10]]];}};
 const filename=path.join(root,'lib/integrations/google-sheets/sync.ts');const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;
 loaded.require=name=>{if(name==='server-only')return{};if(name==='./server')return server;if(name==='./contracts')return contracts;if(name==='./ingestion')return ingestion;return require(name);};
 loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
 const promise=loaded.exports.runSheetsSync({workspaceId,connectionId,actorId:randomUUID(),sessionId:randomUUID(),trigger:'manual'});
 if(mode==='success'){await promise;assert.equal(mutations.filter(item=>item.name==='commit_google_sheets_sync_v1').length,1);assert.equal(metadataCalls,2);assert.equal(headerCalls,2);assert.equal(valueCalls,2);}
 else{await assert.rejects(promise);assert.equal(mutations.filter(item=>item.name==='commit_google_sheets_sync_v1').length,0);assert.equal(mutations.filter(item=>item.name==='fail_google_sheets_sync_v1').length,1);}
}
(async()=>{for(const mode of ['success','partial_failure','values_changed','headers_changed','grid_changed'])await scenario(mode);console.log(JSON.stringify({suite:'google_sheets_sync_adapter',scenarios:5,liveProviderCalls:0}));})().catch(error=>{console.error(error);process.exitCode=1;});
