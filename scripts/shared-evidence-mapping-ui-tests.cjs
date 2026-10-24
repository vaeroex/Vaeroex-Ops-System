const assert=require('node:assert/strict'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let enabled=true,role='owner',rpcCalls=0;
const db={rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'preview_legacy_evidence_mapping_v1');assert.equal(args.p_workspace_id,id(1));return{data:{incarnation_hash:'a'.repeat(64),scope:'permission_visible_entries'},error:null};},from:table=>{
 assert.equal(table,'business_entities');const filters={};const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},order:async()=>{assert.deepEqual(filters,{workspace_id:id(1),status:'active'});return{data:[{id:id(4),display_name:'Synthetic entity'}],error:null};}};return q;
}};
require('./qbo-customer-test-support.cjs').installLoader({
 'server-only':{},'next/link':({children,...props})=>React.createElement('a',props,children),
 'next/navigation':{notFound:()=>{throw Error('not_found');}},
 '@/lib/ai/shared-evidence/runtime-gate':{sharedEvidenceRuntimeEnabled:()=>enabled},
 '@/lib/security/require-workspace-access':{requireWorkspaceAccess:async()=>({supabase:db,workspaceId:id(1),user:{id:id(2)},workspace:{name:'Synthetic workspace'},membership:{role,status:'active',workspace_id:id(1),user_id:id(2)}})},
 './actions':{confirmMappingAction:async()=>{}},
});
const Page=require('../app/app/integrations/evidence-mapping/page.tsx').default;
const {EvidenceMappingLink}=require('../components/integrations/EvidenceMappingLink.tsx');
const query={workspaceId:id(1),provider:'harvest',connectionId:id(3)};
(async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}));
 assert.match(html,/name="entityId" required=""/);assert.match(html,/value="" disabled="" selected=""/);assert.match(html,/type="checkbox"[^>]+required=""/);assert.match(html,/name="incarnationHash" value="a{64}"/);assert.match(html,/Synthetic entity/);assert.doesNotMatch(html,/<option[^>]+value="000[^>]+selected/);
 const link=renderToStaticMarkup(EvidenceMappingLink({...query,owner:true,status:'connected'}));assert.match(link,/evidence-mapping\?workspaceId=/);
 assert.equal(EvidenceMappingLink({...query,owner:false,status:'connected'}),null);assert.equal(EvidenceMappingLink({...query,owner:true,status:'disconnected'}),null);
 const count=rpcCalls;await assert.rejects(Page({searchParams:Promise.resolve({...query,workspaceId:id(9)})}),/not_found/);role='admin';await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);enabled=false;role='owner';await assert.rejects(Page({searchParams:Promise.resolve(query)}),/not_found/);assert.equal(rpcCalls,count);
 console.log('Mapping UI: required unselected entity and explicit confirmation, bound connection version, active-workspace/owner/gate checks, inaccessible states make no preview call. Static render only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
