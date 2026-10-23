import "server-only";
import { intelligenceBriefingCustomerText } from "@/lib/ai/intelligence-briefing/plain-language";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { INTELLIGENCE_BRIEFING_SECTION_LABELS, type IntelligenceBriefingPackage, type IntelligenceBriefingSignal } from "@/lib/ai/intelligence-briefing/contracts";
import { assertSharedPrepared, sharedTargetHref, type SharedPrepared } from "./generation";
/** Retain normal projector control metadata, never its unbound business content.
 * Sandbox facts (including files/notes) enter only via the protected packet.
 * The existing snapshot receipt remains a control dependency, not model evidence. */
export function isolatedSandboxBriefingBase(base:IntelligenceBriefingPackage,p:SharedPrepared):IntelligenceBriefingPackage {
 assertSharedPrepared(p);if(!p.sandboxInstallationId||base.workspaceId!==p.workspaceId) throw new Error('sandbox_brief_scope_denied');
 const h=evidenceEngineHash({contract:'sandbox_empty_base_v1',snapshot:base.snapshotFingerprint,packet:p.fingerprint});
 return {...base,eligibility:'no_eligible_evidence',confidence:'Low',signals:[],sections:[],citations:[],contextReferences:[],limitations:[],requiredSignalRefs:[],previousBriefing:null,
  businessHealth:{available:false,score:null,status:'Unavailable',trajectory:null,confidence:'Low'},
  evidenceCoverage:{supportingRecordCount:0,independentSourceCount:0,freshness:'unavailable',latestEvidenceAt:null,overallCoverage:null,coverageLabel:'Limited',includedDomains:[],missingOrWeakDomains:[]},
  manifest:{...base.manifest,manifestId:h,evidence:[],sourceRegistry:{version:base.manifest.sourceRegistry.version,workspaceId:base.workspaceId,entries:[],candidateToSourceOrdinal:{},independentOriginalSourceCount:0}},
  evidenceFingerprint:h,effectiveEvidenceFingerprint:h,materialStateFingerprint:h,generationKey:h,
  trustBinding:{...base.trustBinding,projectionFingerprint:h}};
}
/** Extend before the run claim. All evidence/material/generation/trust identities
 * include exact shared identities and facts; citations are application-owned. */
export function extendSharedBriefingPackage(base:IntelligenceBriefingPackage,p:SharedPrepared):IntelligenceBriefingPackage {
 assertSharedPrepared(p);if(base.workspaceId!==p.workspaceId||base.period.start!==p.start||base.period.end!==p.end) throw new Error('shared_brief_scope_changed');
 if(p.sandboxInstallationId&&(base.signals.length||base.citations.length||base.contextReferences.length||base.manifest.evidence.length||base.manifest.sourceRegistry.entries.length||base.businessHealth.available||base.previousBriefing)) throw new Error('sandbox_base_evidence_unbound');
 let next=Math.max(0,...base.citations.map(c=>c.citationId));
 const citations=[...base.citations],entries=[...base.manifest.evidence],registry=[...base.manifest.sourceRegistry.entries];
 const contextReferences=[...base.contextReferences];
 const citationByHash=new Map<string,number>();
 const candidateToSourceOrdinal={...base.manifest.sourceRegistry.candidateToSourceOrdinal};const signals:IntelligenceBriefingSignal[]=[...base.signals];
 for(const row of p.rows) {
  const citationId=++next,candidateId=`shared:${row.hash}`,sourceOrdinal=`SHARED-${citationId}`;
  citationByHash.set(row.hash,citationId);
  const fact=row.facts.join(' '),title=row.provider.replace(/[_-]/g,' ');
  const sectionId=row.reported?'business_updates_context': ['quickbooks_online','xero','zoho-books'].includes(row.provider)?'financial_performance':'operations_delivery';
  citations.push({citationId,title,sourceLabel:title,sourceType:`shared_${row.provider}`,excerpt:fact,recordedAt:null,href:`/app/sources/evidence/pending/${row.hash}`});
  entries.push({citationId,candidateId,sourceOrdinal,domain:sectionId,title,excerpt:fact,summary:null,evidenceRole:row.reported?'supporting':'original',originalEvidenceEligible:!row.reported,confidenceScore:0.5,indexedAt:base.manifest.generatedAt,recordedAt:null,lineageVersion:'shared_evidence_v1',eligibilityDecisionVersion:'canonical_memory_semantics_v1'});
  registry.push({sourceOrdinal,canonicalSourceKey:candidateId,independentSourceKey:null,sourceType:`shared_${row.provider}`,title,evidenceRole:row.reported?'supporting':'original',sourceId:null,sourceFileId:null,parentSourceId:null,candidateIds:[candidateId]});candidateToSourceOrdinal[candidateId]=sourceOrdinal;
  const dated=typeof row.scope.start==='string'&&typeof row.scope.end==='string';
  const periodContext=!dated?'undated_context':String(row.scope.start)>=p.start&&String(row.scope.end)<=p.end?'briefing_period':'historical_context';
  row.facts.forEach((value,index)=>{const ref=`SHARED-${citationId}-${index}`;
   if(row.provider==='business_note') contextReferences.push({ref,sourceNoteId:String(row.data.note_id),sourceVersion:Number(row.data.source_version),title,summary:value,approvedAt:String(row.data.approved_at),observedAt:null,applicabilityStart:typeof row.data.user_reporting_period_start==='string'?row.data.user_reporting_period_start:null,applicabilityEnd:typeof row.data.user_reporting_period_end==='string'?row.data.user_reporting_period_end:null});
   if(row.provider==='file') contextReferences.push({ref,sourceKind:'reviewed_file',sourceFileId:String(row.data.file_id),sourceChunkId:String(row.data.chunk_id),sourceHash:row.hash,title:'Reviewed file',summary:value,observedAt:null,applicabilityStart:null,applicabilityEnd:null});
   signals.push({ref:`SHARED-${citationId}-${index}`,stableKey:evidenceEngineHash({identity:row.identity,hash:row.hash,index}),kind:row.reported?'reported_context':'kpi',authority:row.reported?'reported_context':'measured_evidence',sectionId,label:title,fact:intelligenceBriefingCustomerText(`${periodContext==='undated_context'?'Reporting period is not established. ':periodContext==='historical_context'?`Historical context through ${row.scope.end}. `:''}${value}`),confidence:'Low',citationIds:[citationId],evidenceReferenceIds:[candidateId],limitation:row.reported?'Reported context; not independently measured and does not establish causation.':'Source-specific scope and coverage; not additive across overlapping financial systems.',periodRelation:row.reported?'reported_context':'current_state',periodContext,sourceScope:row.scope});});
 }
 for(const relationship of p.relationships) {
  const citationIds=relationship.sourceHashes.map(hash=>citationByHash.get(hash));
  if(citationIds.some(id=>id===undefined)) throw new Error('shared_relationship_dependency_missing');
  const label={financial_stage_boundary:'Order and invoice boundary',payment_accounting_boundary:'Sales and profit interpretation',hours_comparison_boundary:'Hours comparison eligibility',inventory_context_boundary:'Inventory context eligibility limitation',sandbox_observation_boundary:'Sandbox observation interpretation'}[relationship.kind];
  signals.push({ref:`SHARED-R-${relationship.id.slice(0,14)}`,stableKey:relationship.id,kind:'finding',authority:'deterministic_result',sectionId:relationship.kind==='inventory_context_boundary'||relationship.kind==='hours_comparison_boundary'?'operations_delivery':'financial_performance',label,sharedRelationship:`${relationship.kind}_v1`,fact:intelligenceBriefingCustomerText(relationship.fact),confidence:'Low',citationIds:citationIds as number[],evidenceReferenceIds:relationship.sourceHashes.map(hash=>`shared:${hash}`),limitation:'Partial stored observations; no matched transaction, complete coverage, or causation is established.',periodRelation:'current_state',periodContext:!relationship.date?'undated_context':relationship.date>=p.start&&relationship.date<=p.end?'briefing_period':'historical_context',sourceScope:{entityId:relationship.entityId,start:relationship.date,end:relationship.date,currency:relationship.currency,timeZone:relationship.date?'UTC':null,additive:false}});
 }
 const sections=[...base.sections];for(const signal of signals){if(!signal.sectionId)continue;const i=sections.findIndex(s=>s.id===signal.sectionId);if(i<0)sections.push({id:signal.sectionId,label:INTELLIGENCE_BRIEFING_SECTION_LABELS[signal.sectionId],signalRefs:[signal.ref]});else if(!sections[i].signalRefs.includes(signal.ref))sections[i]={...sections[i],signalRefs:[...sections[i].signalRefs,signal.ref]};}
 const limitations=[...base.limitations,...p.limitations.map((text,i)=>({ref:`L-SHARED-${i}`,text}))];
 const manifest={...base.manifest,manifestId:evidenceEngineHash({base:base.manifest.manifestId,shared:p.fingerprint}),evidence:entries,sourceRegistry:{...base.manifest.sourceRegistry,entries:registry,candidateToSourceOrdinal}};
 const evidenceFingerprint=evidenceEngineHash({base:base.evidenceFingerprint,shared:p.fingerprint,manifest:manifest.manifestId});
 const effectiveEvidenceFingerprint=evidenceEngineHash({base:base.effectiveEvidenceFingerprint,shared:p.fingerprint});
 const materialStateFingerprint=evidenceEngineHash({base:base.materialStateFingerprint,shared:p.fingerprint});
 const generationKey=evidenceEngineHash({base:base.generationKey,shared:p.fingerprint});
 return {...base,manifest,signals,sections,limitations,citations,contextReferences,evidenceFingerprint,effectiveEvidenceFingerprint,materialStateFingerprint,generationKey,
  eligibility:base.eligibility==='no_eligible_evidence'&&p.rows.length>0?'limited':base.eligibility,
  sharedEvidenceFingerprint:p.fingerprint,
  trustBinding:{...base.trustBinding,projectionFingerprint:evidenceEngineHash({signals,sections,limitations,evidenceFingerprint})}};
}
export function bindSharedBriefingCitationTarget(p:IntelligenceBriefingPackage,runId:string):IntelligenceBriefingPackage {
 return {...p,citations:p.citations.map(c=>c.sourceType.startsWith('shared_')?{...c,href:sharedTargetHref(p.workspaceId,'briefing_run',runId,p.manifest.evidence.find(entry=>entry.citationId===c.citationId)!.candidateId.replace(/^shared:/,''))}:c)};
}
