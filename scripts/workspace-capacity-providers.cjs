/* eslint-disable @typescript-eslint/no-require-imports -- Local synthetic provider transport; never production code. */
const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function executive(payload){
 const raw=payload.input?.find(x=>x.role==='user')?.content??payload.messages?.find(x=>x.role==='user')?.content;
 const text=typeof raw==='string'?raw:raw?.find(x=>x.type==='input_text')?.text;const input=JSON.parse(text);
 const m=input.extra_inputs?.executive_reasoning_manifest?.signal_synthesis;assert(m?.candidates?.length,'synthetic_signal_manifest_required');
 const ids=m.required_signal_ids.slice(0,Math.max(1,Math.min(3,m.minimum_distinct_findings)));
 const selected=ids.map(id=>m.candidates.find(c=>c.signal_id===id));assert(selected.every(Boolean));
 const findings=selected.map((c,i)=>({id:`F${i+1}`,signal_id:c.signal_id,finding:`Synthetic capacity response: ${c.title}`.slice(0,240),impact:'Synthetic evidence requires owner review; no business conclusion is inferred.',confidence:'Low',citations:c.original_citation_ids.slice(0,2)}));
 assert(findings.every(f=>f.citations.length));
 const pair=m.relationship_candidates.find(p=>ids.includes(p.left_signal_id)&&ids.includes(p.right_signal_id));
 const relationships=m.require_cross_signal_assessment&&pair?[{finding_ids:[findings[ids.indexOf(pair.left_signal_id)].id,findings[ids.indexOf(pair.right_signal_id)].id],status:'Not established',assessment:'Synthetic transport output; this relationship is not established.',citations:[...new Set([findings[ids.indexOf(pair.left_signal_id)].citations[0],findings[ids.indexOf(pair.right_signal_id)].citations[0]])]}]:[];
 return {analysis:{evidence_sufficiency:'Partial',evidence_agreement:'Insufficient',findings,relationships,actions:[{id:'A1',action:'Review the synthetic records.',priority:'Low',why:'This is an isolated workload simulation.',outcome:'Verify evidence without changing business records.',horizon:'30 Days',citations:findings[0].citations}],uncertainty:['Synthetic provider transport does not measure model quality or real provider latency.']},executive_summary:findings.map(f=>f.finding).join(' ').slice(0,600),overall_confidence:'Low',summary_signal_ids:ids};
}
function createProviders(cfg){
 assert(cfg.syntheticOnly&&cfg.paidCredentialsPresent===false);const manifest=()=>JSON.parse(fs.readFileSync(cfg.providerManifest));const plan=JSON.parse(fs.readFileSync(cfg.planFile));assert(plan.runId===cfg.runId);const day=Date.parse(plan.asOf.slice(0,10)+'T00:00:00.000Z');assert(Number.isFinite(day));
 const log=value=>fs.appendFileSync(cfg.providerEvents,JSON.stringify({at:new Date().toISOString(),runId:cfg.runId,...value})+'\n',{mode:0o600});let calls=0,inFlight=0,peak=0,bytes=0;
 return http.createServer(async(req,res)=>{const start=Date.now();let identity=null;inFlight++;peak=Math.max(peak,inFlight);const send=(status,body)=>{const value=JSON.stringify(body);bytes+=Buffer.byteLength(value);res.writeHead(status,{'content-type':'application/json','x-request-id':'synthetic-'+randomUUID()});res.end(value);};
  try{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname==='/telemetry'){send(200,{mode:'local_stubs_only',paidCalls:0,calls,inFlight:inFlight-1,peak,bytes});return;}
   assert(u.pathname.startsWith('/provider/'),'unknown_provider_path');calls++;const host=u.pathname.split('/')[2],p=u.pathname.slice(('/provider/'+host).length);let raw='';for await(const b of req){raw+=b;assert(raw.length<=2*1024*1024,'provider_input_bound');}
   let fault={};try{fault=JSON.parse(fs.readFileSync(cfg.faultControl));}catch{}
   if(host==='sheets.googleapis.com'){
    const id=p.match(/^\/v4\/spreadsheets\/([^/]+)/)?.[1];identity=manifest().connections.find(c=>c.spreadsheetId===id);assert(identity,'unseeded_spreadsheet_denied');assert(req.headers.authorization===`Bearer ${identity.accessToken}`,'synthetic_credential_mismatch');
    const active=fault.workspaceId===identity.workspaceId&&Date.now()<fault.until;
    if(active&&['provider_throttle','expired_authorization'].includes(fault.kind)){log({event:'fault_injected',kind:fault.kind,faultId:fault.id,workspaceId:identity.workspaceId,actualInjection:true});send(fault.kind==='provider_throttle'?429:401,{error:'synthetic_provider_fault'});return;}
    if(active&&fault.kind==='partial_read'&&p.includes('values:batchGet')){log({event:'fault_injected',kind:fault.kind,faultId:fault.id,workspaceId:identity.workspaceId,actualInjection:true});res.writeHead(200,{'content-type':'application/json'});res.write('{"valueRanges":[');setTimeout(()=>res.destroy(),50);return;}
    if(active&&fault.kind==='slow_workspace')log({event:'fault_injected',kind:fault.kind,faultId:fault.id,workspaceId:identity.workspaceId,actualInjection:true,delayMs:fault.delayMs});await sleep(active&&fault.kind==='slow_workspace'?fault.delayMs:cfg.providerLatencyMs??30);
    if(!p.includes('/values')){send(200,{spreadsheetId:id,properties:{title:'Synthetic operations'},sheets:[{properties:{sheetId:0,title:'Daily',sheetType:'GRID',gridProperties:{rowCount:101}}}]});}
    else if(p.endsWith('/values:batchGet')){send(200,{valueRanges:u.searchParams.getAll('ranges').map(range=>{const hit=range.match(/([A-Z]+)(\d+):[A-Z]+(\d+)$/);assert(hit,'range_invalid');const col=hit[1],from=Number(hit[2]),to=Number(hit[3]);return{values:Array.from({length:Math.max(0,Math.min(101,to)-from+1)},(_,n)=>[col==='A'?`synthetic-row-${from+n}`:col==='B'?new Date(day-(from+n-2)*86400000).toISOString().slice(0,10):100+from+n])};})});}
    else send(200,{values:[['Key','Date','Orders']]});
   }else if(host==='oauth2.googleapis.com'){assert(req.method==='POST');if(p==='/revoke')send(200,{});else{const params=new URLSearchParams(raw);if(params.get('grant_type')==='authorization_code'){assert(params.get('client_id')==='synthetic-capacity-client'&&params.get('client_secret')==='synthetic-capacity-secret'&&params.get('redirect_uri')===cfg.appOrigin+'/api/integrations/google-sheets/callback','synthetic_oauth_client_denied');const code=params.get('code')||'';assert(/^synthetic-reconnect:[a-f0-9-]{36}:[a-f0-9-]{36}$/.test(code),'synthetic_oauth_code_denied');identity=manifest().connections.find(c=>c.connectionId===code.split(':')[1]);}else{assert(params.get('grant_type')==='refresh_token','synthetic_oauth_grant_denied');const token=params.get('refresh_token');identity=manifest().connections.find(c=>c.refreshToken===token);}assert(identity,'synthetic_refresh_denied');send(200,{access_token:identity.accessToken,refresh_token:identity.refreshToken,expires_in:86400,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',token_type:'Bearer'});}}
   else if(['api.openai.com','integrate.api.nvidia.com'].includes(host)){assert(req.headers.authorization==='Bearer synthetic-capacity-provider-key','non_synthetic_ai_credential_denied');const body=JSON.parse(raw);await sleep(cfg.modelLatencyMs??100);
    if(p.endsWith('/embeddings')){send(200,{data:body.input.map(()=>({embedding:Array.from({length:1536},(_,i)=>i===0?1:0)})),usage:{total_tokens:Math.ceil(JSON.stringify(body.input).length/4)}});}
    else{const content=JSON.stringify(executive(body));const inputTokens=Math.ceil(raw.length/4),outputTokens=Math.ceil(content.length/4);send(200,host==='api.openai.com'?{model:body.model,status:'completed',output_text:content,usage:{input_tokens:inputTokens,output_tokens:outputTokens,total_tokens:inputTokens+outputTokens}}:{choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens,total_tokens:inputTokens+outputTokens}});}
   }else throw Error('provider_host_denied');
   log({event:'provider_response',host,status:res.statusCode,workspaceId:identity?.workspaceId??null,ms:Date.now()-start});
  }catch(error){log({event:'provider_error',code:/^[a-z_]+$/.test(error.message)?error.message:'synthetic_contract_failure'});if(!res.headersSent)send(500,{error:'synthetic_provider_contract_failed'});else res.destroy();}finally{inFlight--;}
 });
}
module.exports={createProviders,executive};
if(require.main===module){const cfg=JSON.parse(fs.readFileSync(process.argv[2]));const s=createProviders(cfg);s.listen(new URL(cfg.stubOrigin).port,'127.0.0.1',()=>console.log(JSON.stringify({localProviderReady:true,pid:process.pid})));}
