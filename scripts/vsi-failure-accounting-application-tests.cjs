/* Actual storage helpers; synthetic clients and no network/provider calls. */
const assert=require('node:assert/strict');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let gate=true,state;
const binding={workspace_id:id(1),actor_user_id:id(2),id:id(3)};
const admin={from:table=>{
 assert.equal(table,'vsi_requests','failure path must not read content');
 const filters={};const q={select:fields=>{assert.equal(fields,'status,attempt,conversation_id');return q;},
 eq:(key,value)=>{filters[key]=value;return q;},maybeSingle:async()=>{assert.deepEqual(filters,binding);state.statusReads++;return state.status;}};return q;
},rpc:async(name,args)=>{state.calls.push({name,args});
 if(name==='vsi_mutate_v3')return{data:null,error:{code:'42501'}};
 if(name==='vsi_mutate_v2')return{data:{state:'settled'},error:null};
 assert.equal(name,'fail_vsi_request_accounting_v1');return state.result;
}};
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{},'./failure-accounting-gate':{vsiFailureAccountingEnabled:()=>gate},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin}});
const {settleFailedVsi,settleGeneratedVsi}=require('../lib/vsi/storage.ts');
const access={workspaceId:id(1),userId:id(2),sessionId:id(4),supabase:{from:()=>{throw Error('failure reconciliation must not read exchange content');}}};
const input={id:id(3),conversationId:id(5),attempt:2,usage:{estimatedCostUsd:0.0123456789,providerCalls:2,costEstimated:true,providerRequestId:'synthetic-do-not-persist',answer:'synthetic-do-not-persist'},answer:'synthetic-do-not-persist',citations:['synthetic-do-not-persist']};
function reset(){state={calls:[],statusReads:0,status:{data:{status:'pending',attempt:2,conversation_id:id(5)},error:null},result:{data:{state:'failed'},error:null}};}
(async()=>{
 reset();assert.equal(await settleFailedVsi(access,input),undefined);
 assert.deepEqual(state.calls,[{name:'fail_vsi_request_accounting_v1',args:{p_workspace_id:id(1),p_actor_user_id:id(2),p_session_id:id(4),p_conversation_id:id(5),p_request_id:id(3),p_attempt:2,p_cost_usd:0.01234568,p_provider_calls:2,p_cost_estimated:true}}]);
 assert(!JSON.stringify(state.calls).includes('synthetic-do-not-persist'));
 reset();state.status.data.status='failed';state.result.data.state='already_failed';assert.equal(await settleFailedVsi(access,input),undefined);
 reset();await settleFailedVsi(access,{...input,usage:{estimatedCostUsd:0}});assert.equal(state.calls[0].args.p_provider_calls,null);assert.equal(state.calls[0].args.p_cost_estimated,false);
 for(const change of [s=>s.status.error={code:'42501'},s=>s.status.data=null,s=>s.status.data.status='completed',s=>s.status.data.attempt=3,s=>s.status.data.conversation_id=null,s=>s.status.data.conversation_id=id(99)]){
  reset();change(state);await assert.rejects(settleFailedVsi(access,input),e=>e.code==='failure_accounting_unavailable');assert.equal(state.calls.length,0);
 }
 for(const usage of [{estimatedCostUsd:NaN},{estimatedCostUsd:Infinity},{estimatedCostUsd:-1},{estimatedCostUsd:11},{estimatedCostUsd:1,providerCalls:1.2},{estimatedCostUsd:1,providerCalls:1001},{estimatedCostUsd:1,costEstimated:'true'}]){
  reset();await assert.rejects(settleFailedVsi(access,{...input,usage}),e=>e.code==='failure_accounting_unavailable');assert.equal(state.calls.length,0);assert.equal(state.statusReads,0);
 }
 for(const result of [{data:null,error:{code:'40001'}},{data:{state:'completed'},error:null},{data:{state:'failed',answer:'forbidden'},error:null},{data:null,error:null}]){
  reset();state.result=result;await assert.rejects(settleFailedVsi(access,input),e=>e.code==='failure_accounting_unavailable');assert.equal(state.calls.length,1,'no fallback or retry after uncertain outcome');
 }
 reset();await assert.rejects(settleGeneratedVsi(access,input,id(6)),e=>e.code==='access_denied');assert.deepEqual(state.calls.map(c=>c.name),['vsi_mutate_v3','fail_vsi_request_accounting_v1']);
 reset();state.status.data.status='completed';await assert.rejects(settleGeneratedVsi(access,input,id(6)),e=>e.code==='access_denied');assert.deepEqual(state.calls.map(c=>c.name),['vsi_mutate_v3']);
 reset();gate=false;await settleFailedVsi(access,input);assert.equal(state.calls[0].name,'vsi_mutate_v2');assert.equal(state.statusReads,0);assert.equal(state.calls[0].args.p_input.answer,undefined);assert.equal(state.calls[0].args.p_input.usage.failed,true);
 console.log('Accounting-only application path passed: fixed scalar projection, status-only reconciliation, no success conversion, no retry/fallback, unknown count preserved, invalid input and competing completion denied; gate false retains old behavior. No external calls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
