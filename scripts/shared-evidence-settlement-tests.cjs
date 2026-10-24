/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
/* Actual settlement function, synthetic local clients only. No network or credentials. */
const assert=require('node:assert/strict');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let state;
function query(result,expected){const conditions={};const q={select:()=>q,eq:(k,v)=>{conditions[k]=v;return q;},maybeSingle:async()=>{assert.deepEqual(conditions,expected);return result;}};return q;}
const binding={workspace_id:id(1),actor_user_id:id(2),id:id(3)};
const admin={rpc:async(name,args)=>{state.calls.push({name,args});return state.calls.length===1?{data:null,error:{code:'42501'}}:{data:{state:'settled'},error:null};},from:table=>{assert.equal(table,'vsi_requests');state.statusReads++;return query(state.status,binding);}};
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin}});
const {settleGeneratedVsi}=require('../lib/vsi/storage.ts');
const access={workspaceId:id(1),userId:id(2),sessionId:id(4),supabase:{from:table=>{assert.equal(table,'vsi_exchanges');return query(state.saved,binding);}}};
const input={id:id(3),conversationId:id(5),attempt:2,question:'Synthetic',answer:'Observed',citations:[{id:'B1',url:'/app/example'}],usage:{inputTokens:120,outputTokens:40,estimatedCostUsd:0.02,providerCalls:2}};
function reset(){state={calls:[],statusReads:0,saved:{data:null,error:null},status:{data:{status:'pending',attempt:2,conversation_id:id(5)},error:null}};}
(async()=>{
 reset();await assert.rejects(settleGeneratedVsi(access,input,id(6)),/access/);assert.equal(state.calls.length,2);assert.equal(state.calls[0].name,'vsi_mutate_v3');assert.equal(state.calls[1].name,'vsi_mutate_v2');
 assert.deepEqual(state.calls[1].args.p_input,{id:id(3),conversationId:id(5),attempt:2,usage:{...input.usage,failed:true}});assert.equal('answer' in state.calls[1].args.p_input,false);
 reset();state.saved.data={conversation_id:id(5),user_message:'Synthetic',answer:'Observed',citations:[{url:'/app/example',id:'B1'}]};assert.deepEqual(await settleGeneratedVsi(access,input,id(6)),{state:'settled'});assert.equal(state.calls.length,1);assert.equal(state.statusReads,0);
 for(const change of [s=>s.saved.error={code:'42501'},s=>s.saved.data={answer:'different'},s=>s.status.error={code:'42501'},s=>s.status.data.status='completed',s=>s.status.data.attempt=3,s=>s.status.data.conversation_id=id(99),s=>s.status.data=null]){
 reset();change(state);await assert.rejects(settleGeneratedVsi(access,input,id(6)));assert.equal(state.calls.length,1);
 }
 console.log('Settlement reconciliation: known failure preserves observed usage once; matching saved answer reconciles; 7 uncertain/mismatched states perform no second mutation. Offline only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
