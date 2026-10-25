/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
const assert=require('node:assert/strict'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let enabled=true,role='owner',status='active',memberUser=id(2),rpcCalls=0,authCalls=0,confirmResult={data:id(5),error:null};
const db={rpc:async(name,args)=>{
 rpcCalls++;assert.equal(args.p_workspace_id,id(1));
 if(name==='confirm_legacy_evidence_mapping_v1'){
  assert.deepEqual(args,{p_workspace_id:id(1),p_provider:'harvest',p_connection_id:id(3),p_business_entity_id:id(4),p_expected_incarnation_hash:'a'.repeat(64)});
  if(confirmResult instanceof Error)throw confirmResult;
  return confirmResult;
 }
 assert.equal(name,'preview_legacy_evidence_mapping_v1');return{data:{incarnation_hash:'a'.repeat(64),scope:'permission_visible_entries'},error:null};
},from:table=>{
 assert.equal(table,'business_entities');const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},order:async()=>{assert.deepEqual(filters,{workspace_id:id(1),status:'active'});return{data:[{id:id(4),display_name:'Synthetic entity'}],error:null};}};return q;
}};
require('./qbo-customer-test-support.cjs').installLoader({
 'server-only':{},'next/link':({children,...props})=>React.createElement('a',props,children),
 'next/navigation':{notFound:()=>{throw Error('not_found');},redirect:url=>{throw Error(`redirect:${url}`);}},
 '@/lib/ai/shared-evidence/mapping-gate':{evidenceMappingSetupEnabled:()=>enabled},
 '@/lib/security/require-workspace-access':{requireWorkspaceAccess:async()=>{authCalls++;return{supabase:db,workspaceId:id(1),user:{id:id(2)},workspace:{name:'Synthetic workspace'},membership:{role,status,workspace_id:id(1),user_id:memberUser}};}},
 './actions':{confirmMappingAction:async()=>{}},
});
const Page=require('../app/app/integrations/evidence-mapping/page.tsx').default;
const {EvidenceMappingLink}=require('../components/integrations/EvidenceMappingLink.tsx');
const {confirmMappingAction}=require('../app/app/integrations/evidence-mapping/actions.ts');
const query={workspaceId:id(1),provider:'harvest',connectionId:id(3)};
const form=()=>{const f=new FormData();for(const[k,v]of Object.entries({...query,entityId:id(4),incarnationHash:'a'.repeat(64),confirmation:'confirm'}))f.set(k,v);return f;};
(async()=>{
 assert.equal(require('../lib/ai/shared-evidence/mapping-gate.ts').evidenceMappingSetupEnabled(),true);
 assert.equal(require('../lib/ai/shared-evidence/runtime-gate.ts').sharedEvidenceRuntimeEnabled(),true);
 assert.equal(require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled(),true);
 assert.equal(require('../lib/vsi/failure-accounting-gate.ts').vsiFailureAccountingEnabled(),true);
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}));
 assert.match(html,/name="entityId" required=""/);assert.match(html,/value="" disabled="" selected=""/);assert.match(html,/type="checkbox"[^>]+required=""/);assert.match(html,/name="incarnationHash" value="a{64}"/);assert.match(html,/Synthetic entity/);assert.doesNotMatch(html,/<option[^>]+value="000[^>]+selected/);
 const link=renderToStaticMarkup(EvidenceMappingLink({...query,owner:true,status:'connected'}));assert.match(link,/evidence-mapping\?workspaceId=/);
 assert.equal(EvidenceMappingLink({...query,owner:false,status:'connected'}),null);assert.equal(EvidenceMappingLink({...query,owner:true,status:'disconnected'}),null);
 let count=rpcCalls;
 await assert.rejects(Page({searchParams:Promise.resolve({...query,workspaceId:id(9)})}),/not_found/);
 role='admin';await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);role='owner';
 memberUser=id(9);await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);memberUser=id(2);
 status='inactive';await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);status='active';
 assert.equal(rpcCalls,count);
 await assert.rejects(confirmMappingAction(form()),/redirect:\/app\/integrations\/evidence-mapping\?result=saved/);
 assert.equal(rpcCalls,++count);
 for(const alter of[f=>f.delete('confirmation'),f=>f.append('entityId',id(9)),f=>f.set('workspaceId',id(9))]){
  const f=form();alter(f);await assert.rejects(confirmMappingAction(f),/result=unavailable/);assert.equal(rpcCalls,count);
 }
 role='admin';await assert.rejects(confirmMappingAction(form()),/result=unavailable/);role='owner';
 memberUser=id(9);await assert.rejects(confirmMappingAction(form()),/result=unavailable/);memberUser=id(2);
 status='inactive';await assert.rejects(confirmMappingAction(form()),/result=unavailable/);status='active';
 assert.equal(rpcCalls,count);
 for(const result of[{data:null,error:{code:'40001'}},{data:null,error:{code:'42501'}},new Error('uncertain_transport')]){
  confirmResult=result;await assert.rejects(confirmMappingAction(form()),/result=unavailable/);assert.equal(rpcCalls,++count);
 }
 enabled=false;
 const authCount=authCalls;
 assert.equal(EvidenceMappingLink({...query,owner:true,status:'connected'}),null);
 await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);
 await assert.rejects(confirmMappingAction(form()),/^Error: redirect:\/app\/integrations$/);
 assert.equal(rpcCalls,count);assert.equal(authCalls,authCount);
 console.log('Mapping setup: independent of the three generation/accounting gates; actual link, page and action preserve owner/actor/workspace, explicit confirmation, version binding, disabled setup and fail-closed/no-retry behavior. Static render and mocked authenticated RPC only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
