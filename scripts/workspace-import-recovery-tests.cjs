/* eslint-disable @typescript-eslint/no-require-imports -- Actual-action isolated persistence adapter. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'scripts/audit-import-finalization.cjs'),'utf8');
const load=Function('require','__dirname',source.slice(0,source.indexOf('async function scenario'))+'\nreturn load;')(require,__dirname);
const baseline=process.argv.includes('--baseline'),results=[];
async function scenario(type,boundary,mode='reject'){
 const workspace='workspace-one', file={id:'file-one',workspace_id:workspace,display_name:'Synthetic',metadata_json:{},imported_rows:0};
 const record={id:'import-one',workspace_id:workspace,file_upload_id:file.id,import_type:type,status:'needs_review',rows_total:1,rows_imported:0,mapping_json:type==='kpi'?{name:'Metric',actual_value:'Value',metric_date:'Date'}:{metric_name:'Metric',value:'Value',metric_date:'Date'},errors_json:[]};
 const row={id:'row-one',workspace_id:workspace,file_upload_id:file.id,import_id:record.id,status:'staged',row_number:2,data_json:{Metric:'Revenue',Value:100,Date:'2026-10-01'},mapped_data_json:{}};
 const state={file,record,row,kpis:[],operational_metrics:[],writes:[],faulted:false,redirect:null};
 const original=structuredClone({file,record,row});
 const supabase={rpc:async(name,args)=>{
   if(name==='begin_file_import_attempt_v1'){if(mode==='claim-denied')return {data:{admitted:false,status:'running'},error:null};if(mode==='claim-ack-lost')return {data:null,error:{message:'Claim response lost'}};if(state.attempt)return {data:{admitted:false,status:state.attempt},error:null};state.attempt='running';return {data:{admitted:true,status:'running',attempt_id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'},error:null};}
   if(!state.attempt)return {data:{status:'not_started'},error:null};
   if(state.record.status==='completed'&&state.file.import_status==='imported'&&state.row.status==='imported')state.attempt='completed';
   else if(args.p_failed)state.attempt='reconciliation_required';
   return {data:{status:state.attempt},error:null};
 },auth:{getUser:async()=>({data:{user:{id:'user-one',email:'synthetic@example.invalid'}}})},from(table){let operation='select',value,single=false;const predicates=[];
 const q={select(){return q;},eq(k,v){predicates.push(r=>r[k]===v);return q;},in(k,vs){predicates.push(r=>vs.includes(r[k]));return q;},is(k,v){predicates.push(r=>(r[k]??null)===v);return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},update(v){operation='update';value=v;return q;},insert(v){operation='insert';value=v;return q;},upsert(v){operation='insert';value=v;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
   if(operation!=='select')state.writes.push({table,operation,value});
   if(table==='kpi_settings')return {data:null,error:{message:'permission denied for synthetic staff settings'}};
   const rows=table==='file_uploads'?[state.file]:table==='file_imports'?[state.record]:table==='file_import_rows'?[state.row]:state[table];assert(rows,`unexpected table ${table}`);
   const chosen=rows.filter(r=>predicates.every(p=>p(r)));
   const matches=!state.faulted&&table===boundary&&operation===(mode==='ambiguous-business-insert'?'insert':'update')&&(operation==='insert'||value.status==='completed'||value.status==='imported'||value.import_status==='imported');
   if(matches){state.faulted=true;if(mode==='reject'||mode==='zero')return {data:mode==='zero'?[]:null,error:mode==='zero'?null:{message:'Synthetic finalization unavailable'}};}
   if(operation==='update')for(const r of chosen)Object.assign(r,value);
   if(operation==='insert')rows.push(...value.map((r,i)=>({id:'persisted-'+i,...r})));
   if(matches&&(mode==='ack-lost'||mode==='ambiguous-business-insert'))return {data:null,error:{message:'Synthetic acknowledgement lost after commit'}};
   const data=operation==='insert'?rows:chosen;return {data:single?structuredClone(data[0]||null):structuredClone(data),error:null};
 }).then(resolve,reject);}};return q;}};
 const mocks={'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){const e=new Error('REDIRECT');e.url=url;throw e;}},'@/lib/ai/evidence-index':{},'@/lib/ai/vaeroex-client':{},'@/lib/ai/usage':{},'@/lib/ai/vaeroex-workflows':{},'@/lib/billing/require-active-subscription':{requireActiveSubscription:async()=>{}},'@/lib/billing/usage-limits':{},'@/lib/kpis/settings':{},'@/lib/kpis/semantics':{},'@/lib/security/rate-limit':{enforceRateLimit:async()=>({allowed:true})},'@/lib/security/tool-execution-gateway':{requireToolExecution:async()=>{}},'@/lib/supabase/server':{createSupabaseServerClient:async()=>supabase},'@/lib/workspaces/current':{getWorkspaceContext:async()=>({activeWorkspace:{id:workspace},membership:{workspace_id:workspace,status:'active',role:'staff'}})}};
 const actions=load('app/app/files/actions.ts',mocks),form=new FormData();form.set('file_id',file.id);form.set('import_id',record.id);
 try{await actions.saveExtractedImportAction(form);}catch(e){if(!e.url)throw e;state.redirect=e.url;}
 if(mode.startsWith('claim-')){assert.equal(state.writes.length,0,'losing or ambiguous claim must precede every import mutation');assert.deepEqual({file,record,row},original,'loser cannot relabel rows, change diagnostics or alter winner lifecycle');assert(!new URL(state.redirect,'http://localhost').searchParams.has('message'));results.push({type,mode,mutations:state.writes.length,preservedWinningState:true});return;}
 const saved=state[type==='kpi'?'kpis':'operational_metrics'];assert.equal(saved.length,1,'accepted business record retained');
 const success=new URL(state.redirect,'http://localhost').searchParams.has('message');
 if(boundary===null||(!baseline&&mode==='ack-lost'&&boundary==='file_uploads')){assert(success,'healthy path succeeds');assert.equal(record.status,'completed');}
 else if(baseline&&mode!=='ambiguous-business-insert'){assert(success,'baseline reproduces ignored finalization failure');}
 else {assert.equal(success,false,'unknown or denied finalization cannot report success');assert.equal(record.status,'failed');assert.equal(record.rows_imported,mode==='ambiguous-business-insert'?0:1,'count only acknowledged business writes');}
 results.push({type,boundary,mode,success,savedBusinessRows:saved.length,recordStatus:record.status,acknowledgedRows:record.rows_imported});
}
(async()=>{for(const type of ['kpi','metrics']){if(!baseline){await scenario(type,null,'claim-denied');await scenario(type,null,'claim-ack-lost');}await scenario(type,null);for(const boundary of ['file_import_rows','file_imports','file_uploads'])for(const mode of ['reject','zero','ack-lost'])await scenario(type,boundary,mode);await scenario(type,type==='kpi'?'kpis':'operational_metrics','ambiguous-business-insert');}console.log(JSON.stringify({status:'passed',baseline,checks:results.length,results,limitation:'Actual action, synthetic DB responses including applied-write/lost-ack; claim responses are mocked; native SQL suite separately verifies durable coordination.'},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
