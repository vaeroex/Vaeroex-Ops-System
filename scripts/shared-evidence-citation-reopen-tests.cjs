/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
const assert=require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({'server-only':{}});
const {reopenSharedCitation,sharedCitationHref}=require('../lib/ai/shared-evidence/citation-reopen.ts');
const {sharedEvidenceRuntimeEnabled}=require('../lib/ai/shared-evidence/runtime-gate.ts');
const target={workspaceId:'00000000-0000-4000-8000-000000000001',kind:'vsi_exchange',id:'00000000-0000-4000-8000-000000000002',revision:'a'.repeat(64)};
const packet={stage:'revalidated_saved_evidence',artifact_kind:target.kind,artifact_id:target.id,artifact_revision:target.revision,
 projections:[{identity:{kind:'square_payment',payment_id:'composite:payment'},hash:'b'.repeat(64),data:{provider:'square',workspace_id:target.workspaceId,amount_minor:'1200',currency:'USD',read_sources:[],eligibility:{internal:'not rendered'}}}]};
(async()=>{
 assert.equal(sharedEvidenceRuntimeEnabled(),false);
 assert.match(sharedCitationHref(target),/\/vsi_exchange\/00000000-0000-4000-8000-000000000002\?workspace=.*&revision=a{64}$/);
 let calls=0;const reader={rpc:async(name,args)=>{calls++;assert.equal(name,'reopen_shared_evidence_artifact_v1');assert.equal(args.p_expected_revision,target.revision);return{data:packet,error:null};}};
 const rows=await reopenSharedCitation(reader,target);assert.equal(calls,1);assert.match(rows[0].text,/1200/);assert.doesNotMatch(rows[0].text,/eligibility|internal|read_sources/);
 await assert.rejects(reopenSharedCitation({rpc:async()=>({data:null,error:{code:'42501'}})},target),/unavailable/);
 await assert.rejects(reopenSharedCitation({rpc:async()=>({data:{...packet,artifact_revision:'c'.repeat(64)},error:null})},target));
 const foreign=structuredClone(packet);foreign.projections[0].data.workspace_id='00000000-0000-4000-8000-000000000009';
 await assert.rejects(reopenSharedCitation({rpc:async()=>({data:foreign,error:null})},target),/workspace_mismatch/);
 const ancestor={identity:{kind:'inherited_artifact'},hash:'d'.repeat(64),data:{artifact_kind:'vsi_exchange',artifact_id:target.id,revision:target.revision}};
 const stableTarget={...target};delete stableTarget.revision;
 const inherited=await reopenSharedCitation({rpc:async(name,args)=>{assert.equal(name,'reopen_shared_evidence_target_v1');assert.equal('p_expected_revision' in args,false);return{data:{...packet,projections:[...packet.projections,ancestor]},error:null};}},stableTarget);assert.equal(inherited.length,1);
 assert.throws(()=>sharedCitationHref({...target,id:'../another-workspace'}));
 console.log('Exact saved citation reopening checks passed; runtime gate remains disabled.');
})().catch(e=>{console.error(e);process.exitCode=1;});
