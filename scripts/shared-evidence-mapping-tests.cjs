const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {confirmEvidenceMapping,mappingTarget,mappingPreview}=require('../lib/ai/shared-evidence/mapping.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const form=()=>{const f=new FormData();for(const [k,v] of Object.entries({workspaceId:id(1),provider:'harvest',connectionId:id(3),entityId:id(4),incarnationHash:'a'.repeat(64),confirmation:'confirm'}))f.set(k,v);return f;};
let calls=[];const access=()=>({workspaceId:id(1),user:{id:id(2)},membership:{workspace_id:id(1),user_id:id(2),role:'owner',status:'active'},supabase:{rpc:async(n,p)=>{calls.push([n,p]);return{data:id(5),error:null};}}});
(async()=>{
 assert.equal(await confirmEvidenceMapping(access(),form(),true),'saved');
 assert.deepEqual(calls[0],['confirm_legacy_evidence_mapping_v1',{p_workspace_id:id(1),p_provider:'harvest',p_connection_id:id(3),p_business_entity_id:id(4),p_expected_incarnation_hash:'a'.repeat(64)}]);
 for(const alter of [a=>a.workspaceId=id(9),a=>a.membership.role='admin',a=>a.membership.status='inactive',a=>a.membership.user_id=id(9),a=>a.membership.user_id=null,a=>a.membership.workspace_id=id(9)]){calls=[];const a=access();alter(a);assert.equal(await confirmEvidenceMapping(a,form(),true),'unavailable');assert.equal(calls.length,0);}
 for(const alter of [f=>f.delete('confirmation'),f=>f.set('provider','square'),f=>f.set('incarnationHash',''),f=>f.append('entityId',id(9)),f=>f.set('workspaceId',id(9)),f=>f.set('entityId','unselected')]){calls=[];const f=form();alter(f);assert.equal(await confirmEvidenceMapping(access(),f,true),'unavailable');assert.equal(calls.length,0);}
 calls=[];assert.equal(await confirmEvidenceMapping(access(),form(),false),'unavailable');assert.equal(calls.length,0);
 for(const result of [{error:{code:'40001'},data:null},{error:{code:'42501'},data:null},{error:null,data:null}]){const a=access();a.supabase.rpc=async()=>result;assert.equal(await confirmEvidenceMapping(a,form(),true),'unavailable');}
 const a=access();a.supabase.rpc=async()=>{throw Error('transport');};assert.equal(await confirmEvidenceMapping(a,form(),true),'unavailable');
 assert.equal(mappingTarget.safeParse({workspaceId:id(1),provider:['harvest','xero'],connectionId:id(3)}).success,false);
 assert.equal(mappingPreview.safeParse({incarnation_hash:'not-a-version',scope:'connected_account'}).success,false);
 console.log('Owner mapping: explicit review/confirmation, nine-provider allowlist, active identity/workspace, disabled gate, duplicate fields, stale RPC, denial and uncertain transport pass. No remote calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
