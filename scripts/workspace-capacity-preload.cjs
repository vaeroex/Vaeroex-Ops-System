/* eslint-disable @typescript-eslint/no-require-imports -- Isolated capacity process only. Never imported by the application. */
const fs=require('node:fs'),assert=require('node:assert/strict'),net=require('node:net'),http=require('node:http');
const {AsyncLocalStorage}=require('node:async_hooks');
const file=process.env.VAEROEX_CAPACITY_RUNTIME_CONFIG;assert(file&&fs.statSync(file).mode%512===384,'private_capacity_configuration_required');
const cfg=JSON.parse(fs.readFileSync(file));assert(cfg.syntheticOnly===true&&cfg.paidCredentialsPresent===false&&cfg.runId,'synthetic_configuration_required');
const local=h=>['127.0.0.1','::1','[::1]','localhost'].includes(h);const stub=new URL(cfg.stubOrigin);assert(local(stub.hostname)&&stub.protocol==='http:');
const events=new AsyncLocalStorage();const emit=http.Server.prototype.emit;
http.Server.prototype.emit=function(name,...args){return name==='request'?events.run({logicalId:args[0].headers['x-audit-logical-id']||null},()=>emit.call(this,name,...args)):emit.call(this,name,...args);};
const log=value=>fs.appendFileSync(cfg.transportEvents,JSON.stringify({at:new Date().toISOString(),pid:process.pid,runId:cfg.runId,...events.getStore(),...value})+'\n',{mode:0o600});
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0][0]:args[0];const host=typeof first==='object'?first.host:typeof args[1]==='string'?args[1]:'localhost';if(host&&!local(host)){log({event:'egress_violation',transport:'socket'});throw Error('capacity_nonlocal_socket_denied');}return connect.apply(this,args);};
const providers=new Set(['sheets.googleapis.com','oauth2.googleapis.com','api.openai.com','integrate.api.nvidia.com']);
const original=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);let target=input;
 if(providers.has(u.hostname)){
  assert(u.protocol==='https:'&&!u.username&&!u.password,'provider_url_invalid');
  const url=new URL('/provider/'+u.hostname+u.pathname+u.search,stub);target=typeof input==='string'||input instanceof URL?url:new Request(url,input);
 }else if(!local(u.hostname)){log({event:'egress_violation',transport:'fetch'});throw Error('capacity_nonlocal_fetch_denied');}
 const response=await original(target,{...options,redirect:'error'});
 const rpc=u.pathname.match(/\/rpc\/(claim_google_sheets_sync_v1|commit_google_sheets_sync_v1|fail_google_sheets_sync_v1|recover_google_sheets_syncs_v1|due_google_sheets_syncs_v1)$/)?.[1];
 if(rpc){let body=null;try{body=await response.clone().json();}catch{}const args=typeof options.body==='string'?JSON.parse(options.body):{};
  log({event:'rpc_response',rpc,status:response.status,workspaceId:args.p_workspace_id||null,connectionId:args.p_connection_id||null,runIdAccepted:body?.runId||args.p_run_id||null,result:rpc==='recover_google_sheets_syncs_v1'?body:null,...(rpc==='due_google_sheets_syncs_v1'?{tickAt:args.p_tick_at,limit:args.p_limit,excludedConnectionIds:args.p_excluded_ids||[],connections:Array.isArray(body)?body.map(r=>({id:r.id,workspaceId:r.workspace_id,eligibleAt:r.next_sync_at})):null}:{}),...(rpc==='claim_google_sheets_sync_v1'&&!response.ok?{outcomeCode:typeof body?.message==='string'&&/^google_sheets_[a-z_]+$/.test(body.message)?body.message:'claim_denied'}:{})});
  if(rpc==='commit_google_sheets_sync_v1'&&response.ok){let fault={};try{fault=JSON.parse(fs.readFileSync(cfg.faultControl));}catch{}if(fault.kind==='commit_ack_loss'&&fault.workspaceId===args.p_workspace_id&&Date.now()<fault.until){log({event:'fault_injected',kind:fault.kind,faultId:fault.id,actualInjection:true,workspaceId:args.p_workspace_id,runIdAccepted:args.p_run_id});throw new TypeError('synthetic_commit_ack_lost_after_persist');}}
 }
 return response;
};
