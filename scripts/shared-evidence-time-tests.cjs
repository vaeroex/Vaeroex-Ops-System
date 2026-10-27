/* eslint-disable @typescript-eslint/no-require-imports -- Offline source-date and application-rendering regression. */
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
installLoader({ 'server-only': {} });
let network = 0;
const deny = () => { network++; throw Error('network_denied'); };
global.fetch = deny; require('node:net').Socket.prototype.connect = deny;
const { sharedRow, prepareSharedGeneration, assertSharedPrepared } = require('../lib/ai/shared-evidence/generation.ts');
const { expandFactTimes, selectedFactTimeLines } = require('../lib/ai/shared-evidence/fact-time.ts');
const { renderSharedAnswer } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { serializeVsiAnswerContext } = require('../lib/vsi/answer-context.ts');
const { withVsiSourceSnapshot } = require('../lib/vsi/research.ts');
const workspace=id(1), connection=id(2), entity=id(3);
const record = (n, day) => ({key:['xero',connection,id(n)],day,metrics:[
 {key:'invoices',value:0,currency:'USD'},{key:'billed',value:0,currency:'USD'},
 {key:'outstanding',value:0,currency:'USD'},{key:'bills',value:1,currency:'USD'},{key:'purchases',value:10,currency:'USD'}]});
const xero={identity:{kind:'legacy_binding',binding_id:id(4),start:'2026-09-26',end:'2026-10-25'},hash:'a'.repeat(64),data:{provider:'xero',workspace_id:workspace,connection_id:connection,business_entity_id:entity,
 period_start:'2026-09-26',period_end:'2026-10-25',time_zone:'UTC',scope:'connected_account',
 records:[record(10,'2026-10-13'),record(11,'2026-10-13'),record(12,'2026-10-16')],
 coverage:[['2026-10-13',['USD'],'2026-10-24T00:00:00Z','2026-10-25T12:00:00Z']],read_sources:[]}};
const sheet = (n,date) => ({identity:{kind:'sheets_ticket_source',source_id:id(20+n),version_id:id(30+n)},hash:String(n+1).repeat(64),data:{provider:'google_sheets',workspace_id:workspace,entity_id:entity,connection_id:id(40),date,time_zone:'UTC',metrics:[{metric:'Synthetic dispatches',value:6,unit:'count'},{metric:'Synthetic backlog',value:4,unit:'count'}],read_sources:[]}});
const raw=[xero,sheet(1,'2026-10-14'),sheet(2,'2026-10-15')],before=JSON.stringify(raw),rows=raw.map(value=>sharedRow(value,workspace));
const sources=rows.map((row,i)=>({ref:`B${i+1}`,binding:row.hash,dependencies:[row.hash],facts:row.facts,factTimes:row.factTimes,reported:false,environment:'production',provider:row.provider}));
const pick=(n,factIndex)=>({ref:sources[n].ref,binding:sources[n].binding,factIndex});
const observations=[pick(0,0),pick(0,2),pick(0,5),pick(0,7),pick(1,0),pick(2,1)];
const answer={observations,results:[],hypotheses:[],missing_information:[{kind:'selected_fact_time_comparison',premises:observations}],next_checks:[{premises:observations,text:'Confirm the balance observation time and obtain date-aligned order and invoice references before comparing collections with dispatch activity.'}]};
const context={sources,results:[],hypothesesEnabled:false,scopes:new Map(rows.map((row,i)=>[sources[i].ref,row.scope]))};
assert.equal(rows[0].facts.length,15);assert.equal(expandFactTimes(rows[0].factTimes,15).length,15);
assert.deepEqual(expandFactTimes(rows[0].factTimes,15)[2],{date:'2026-10-13',basis:'invoice_or_bill_date',valueTiming:'balance_at_import'});
assert.equal(expandFactTimes(rows[0].factTimes,15)[10].date,'2026-10-16');
assert.match(rows[0].facts[2],/purchase-bill contribution dated 2026-10-13/);
assert.match(rows[0].facts[2],/balance at import/);
assert.match(rows[0].facts[2],/as-of unknown/);
assert.match(renderSharedAnswer(answer,context).content,/stored record contributions, not account\/day totals/);
assert.equal(rows[0].facts[0],rows[0].facts[5],'distinct source records can have identical displayed contributions');
assert.doesNotMatch(rows[0].facts.join('\n'),/recorded|2026-10-25T12:00:00Z/);
assert.equal(rows[0].scope.windowKind,'retrieval_selection');
assert.deepEqual(expandFactTimes(rows[1].factTimes,2)[0],{date:'2026-10-14',basis:'sheet_row_date',valueTiming:'row_value'});
const rendered=renderSharedAnswer(answer,context);
assert.deepEqual(rendered.citationIds,['B1','B2','B3']);
assert.match(rendered.content,/Source retrieval selection window: 2026-09-26 through 2026-10-25/);
assert.match(rendered.content,/Selected fact dates: invoice\/bill date 2026-10-13/);
assert.doesNotMatch(rendered.content,/invoice\/bill date 2026-10-16/,'unselected fact date cannot enter selected-date summary');
assert.match(rendered.content,/selected date labels differ; same-period alignment is not established/);
assert.match(rendered.content,/Outstanding values are balances at import/);
assert.match(rendered.content,/Retrieval-window overlap does not establish date alignment or record correspondence/);
// Even equal labels are not comparable measurement times or record joins.
const same=sharedRow(sheet(3,'2026-10-13'),workspace),sameSource={...sources[1],facts:same.facts,factTimes:same.factTimes};
const two={...answer,observations:[pick(0,2),pick(1,0)],missing_information:[],next_checks:[]};
assert.match(renderSharedAnswer(two,{...context,sources:[sources[0],sameSource],scopes:undefined}).content,/matching date labels alone do not establish comparable measurement times/);
const unknown={...sameSource};delete unknown.factTimes;
const incomplete=renderSharedAnswer(two,{...context,sources:[sources[0],unknown]}).content;
assert.match(incomplete,/some selected date semantics are unknown; date-label comparison is incomplete/);
assert.doesNotMatch(incomplete,/selected date labels differ|matching date labels alone/);
const allUnknown=selectedFactTimeLines([{ref:'B1',time:null},{ref:'B2',time:null}]).join('\n');
assert.match(allUnknown,/date-label comparison is incomplete/);
assert.doesNotMatch(allUnknown,/selected date labels differ|matching date labels alone/);
// A provider with snapshot timing does not inherit a history date basis merely
// because its enclosing source also has period_start/period_end fields.
const snapshotRaw={...xero,hash:'d'.repeat(64),data:{...xero.data,provider:'toggl',records:[{snapshot:{start:'2026-10-25T12:00:00Z',end:'2026-10-25T12:00:00Z',metrics:[{key:'projects',value:1}]}}]}};
const snapshot=sharedRow(snapshotRaw,workspace);
assert.deepEqual(expandFactTimes(snapshot.factTimes,1),[{date:'2026-10-25',basis:'snapshot_capture',valueTiming:'snapshot_at_capture',periodEnd:'2026-10-25',instant:'2026-10-25T12:00:00Z',endInstant:'2026-10-25T12:00:00Z',timeZone:'UTC'}]);
assert.equal(snapshot.scope.windowKind,'retrieval_selection');
const snapshotSource={...sources[1],binding:snapshot.hash,dependencies:[snapshot.hash],provider:snapshot.provider,facts:snapshot.facts,factTimes:snapshot.factTimes};
const snapshotAnswer={...two,observations:[pick(0,2),{ref:snapshotSource.ref,binding:snapshot.hash,factIndex:0}]};
const snapshotRendered=renderSharedAnswer(snapshotAnswer,{...context,sources:[sources[0],snapshotSource],scopes:new Map([['B1',rows[0].scope],['B2',snapshot.scope]])});
assert.deepEqual(snapshotRendered.citationIds,['B1','B2']);
assert.match(snapshotRendered.content,/Selected fact dates: snapshot capture date 2026-10-25/);
assert.match(snapshotRendered.content,/selected date labels differ/);
assert.doesNotMatch(snapshotRendered.content,/date-label comparison is incomplete|matching date labels alone/);
// Running records preserve zero completed-time contributions and a running
// count; none of those facts may be classified as a completed entry.
for(const provider of ['harvest','clockify']){
 const entry=sharedRow({...xero,data:{...xero.data,provider,records:[{day:'2026-10-13',metrics:[{key:'entries',value:0},{key:'hours',value:0},{key:'billable_hours',value:0},{key:'running',value:1}]}]}},workspace);
 assert.deepEqual(expandFactTimes(entry.factTimes,4),Array.from({length:4},()=>({date:'2026-10-13',basis:provider==='harvest'?'spent_date':'entry_start_utc_date',valueTiming:'entry_contribution'})));
 assert.match(entry.facts[3],/running: 1 count/);
}
let negatives=0;
const groups=sources[0].factTimes;
for(const bad of [[],[{date:'2026-02-30',basis:'sheet_row_date',valueTiming:'row_value',factIndexes:[0]}],groups.map(time=>({...time,basis:'retrieved_at'})),groups.map(time=>({...time,date:'2026-10-25T12:00:00Z'})),
 groups.map((group,index)=>index?group:{...group,factIndexes:[...group.factIndexes,group.factIndexes[0]]}),
 [...groups,{...groups[0],factIndexes:[groups[0].factIndexes[0]]}],
 groups.map((group,index)=>index?group:{...group,factIndexes:[...group.factIndexes,rows[0].facts.length]}),
 groups.map((group,index)=>index?group:{...group,factIndexes:group.factIndexes.slice(1)})]){
 assert.throws(()=>renderSharedAnswer(answer,{...context,sources:[{...sources[0],factTimes:bad},...sources.slice(1)]}),error=>error.rule==='context_reference');negatives++;
}
assert.throws(()=>sharedRow({...xero,data:{...xero.data,provider:'loyverse',records:[{day:'2026-10-13',metrics:[{key:'entries',value:1}]}]}},workspace),/invalid_metric/);negatives++;
assert.throws(()=>renderSharedAnswer({...answer,observations:[...observations,observations[0]]},context),error=>error.rule==='duplicate_fact');negatives++;
assert.throws(()=>renderSharedAnswer({...answer,observations:[{...observations[0],binding:'f'.repeat(64)},...observations.slice(1)]},context),error=>error.rule==='fact_reference');negatives++;
assert.throws(()=>sharedRow(xero,id(99)),/workspace_mismatch/);negatives++;
// Canonical snapshots bind the new metadata; lossless packing keeps one exact copy.
const businessSources=rows.map((row,i)=>withVsiSourceSnapshot({id:sources[i].ref,title:row.provider,url:`/app/sources/${i}`,sourceType:`shared_${row.provider}`,sourceId:row.hash,evidenceDate:null,retrievedAt:'2026-10-25T22:00:00Z',text:JSON.stringify({scope:row.scope,observations:row.facts,factTimes:row.factTimes})}));
const payload={businessSources,qualitative_sources:sources},packed=JSON.parse(serializeVsiAnswerContext(payload).json);
assert.deepEqual(packed.qualitative_sources,sources);
assert.equal(packed.businessSources[0].snapshotHash,businessSources[0].snapshotHash);
assert.equal(JSON.parse(packed.businessSources[0].text).observationsRef,'B1');
assert.equal(JSON.parse(packed.businessSources[0].text).factTimes,undefined);
for(const variant of ['missing','different']){
 const altered=structuredClone(payload);
 if(variant==='missing')delete altered.qualitative_sources[0].factTimes;
 else altered.qualitative_sources[0].factTimes[0].date='2026-10-14';
 const transport=JSON.parse(serializeVsiAnswerContext(altered).json);
 assert.deepEqual(JSON.parse(transport.businessSources[0].text).factTimes,JSON.parse(businessSources[0].text).factTimes,'unequal or missing issued metadata cannot replace canonical date metadata');
 assert.equal(transport.businessSources[0].snapshotHash,businessSources[0].snapshotHash);
}
const changed=withVsiSourceSnapshot({...businessSources[0],snapshotHash:undefined,text:JSON.stringify({...JSON.parse(businessSources[0].text),factTimes:rows[0].factTimes.map(time=>({...time,date:'2026-10-14'}))})});
assert.notEqual(changed.snapshotHash,businessSources[0].snapshotHash);assert.equal(changed.sourceId,businessSources[0].sourceId);
assert.equal(JSON.stringify(raw),before,'canonical source data/hash/key order unchanged');
// The known false cross-original limitation is now structurally rejected;
// independent free-draft channels remain explicitly unverified, not repaired.
const retainedFalse='The Xero records contain invoice and outstanding-balance observations for those dates.';
const misleading=structuredClone(answer);misleading.missing_information=[{premises:observations,text:retainedFalse}];
assert.throws(()=>renderSharedAnswer(misleading,context),error=>error.rule==='temporal_assessment_required');negatives++;
assert.doesNotMatch(rendered.content,/for those dates/);
assert.match(rendered.content,/Dates across all selected business observations \(application-computed\)/);
const residual={...answer,missing_information:[],next_checks:[{premises:observations,text:retainedFalse}]};
assert.match(renderSharedAnswer(residual,context).content,/Recommended check \(model draft; not performed\)/);
assert.match(renderSharedAnswer(residual,context).content,/for those dates/,'free proposed-check prose is still not semantic proof');
(async()=>{
 const reader={rpc:async(name,args)=>({data:name==='discover_shared_evidence_v2'?{stage:'catalog_only',candidates:raw.map(r=>({provider:r.data.provider,identity:r.identity})),truncated:false,totalCandidates:raw.length,providerCounts:[...new Set(raw.map(r=>r.data.provider))].map(provider=>({provider,total:raw.filter(r=>r.data.provider===provider).length,returned:raw.filter(r=>r.data.provider===provider).length}))}:{stage:'unadmitted',resolved:name==='preview_shared_legacy_evidence_v1'?xero:raw.find(r=>r.identity.source_id===args.p_identity.source_id)},error:null})};
 const prepared=await prepareSharedGeneration(reader,workspace,'2026-09-26','2026-10-25');assertSharedPrepared(prepared);
 prepared.rows[0].factTimes[0].date='2026-10-14';assert.throws(()=>assertSharedPrepared(prepared),/preparation_changed/);negatives++;
 assert.equal(network,0);console.log(JSON.stringify({passed:true,selectedDateMismatch:true,equalDateNotComparability:true,incompleteDatesDoNotClaimComparison:true,runningEntriesNotClaimedComplete:true,unknownTimingPreserved:true,rawAndFactOrderPreserved:true,metadataSnapshotAndIntegrityBound:true,negativeCases:negatives,crossOriginalFalseLimitationRejected:true,residualFreeDraftStillRequiresReview:true,manualQualityReviewRequired:true,paidCalls:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
