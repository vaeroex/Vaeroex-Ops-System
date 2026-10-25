import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bindGoogleSheetsRead } from "@/lib/integrations/google-sheets/read-authority";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { QboPreviewSchema } from "@/lib/integrations/qbo-customer/contracts";
import { decimalSchema, daySchema, pluginProviders } from "./contracts";
import { sharedFinancialBoundaries, type SharedRelationship } from "./financial-boundaries";
import { validateSharedMemoryProjection } from "./memory-eligibility";
import { reportingMetricSemantics } from "./adapters";

export type SharedClient = { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}> };
export async function sharedRpc(reader:SharedClient,name:string,args:Record<string,unknown>) {
 const result=await reader.rpc(name,args); if(result.error) throw new Error("shared_evidence_authority_unavailable");return result.data;
}
const identity=z.record(z.unknown()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const resolved=z.object({identity,hash,data:z.record(z.unknown())});
const root=z.object({table:z.string().regex(/^[a-z][a-z0-9_]*$/),id:z.string().uuid()});
export type SharedRow={identity:Record<string,unknown>;hash:string;provider:string;facts:string[];scope:Record<string,unknown>;reported:boolean;data:Record<string,unknown>;roots:z.infer<typeof root>[]};
export type SharedPrepared={workspaceId:string;start:string;end:string;rows:SharedRow[];fingerprint:string;limitations:string[];relationships:SharedRelationship[]};
const issued=new WeakMap<SharedPrepared,string>();
const num=(v:unknown)=>decimalSchema.parse(v);
const label=(v:unknown)=>z.string().min(1).max(160).parse(v).replace(/[_-]/g," ");
const object=(v:unknown)=>z.record(z.unknown()).parse(v);
/** Exact stored observations only. Never sum invoice/order/payment/accounting totals,
 * infer a currency exponent, infer entity correspondence, or parse raw file text. */
export function sharedRow(raw:unknown,workspaceId:string):SharedRow {
 const r=resolved.parse(raw),d=r.data;if(d.workspace_id!==workspaceId) throw new Error("shared_workspace_mismatch");
 const provider=z.enum([...pluginProviders,"file","business_note"]).parse(d.provider);
 let facts:string[]=[];const reported=provider==='file'||provider==='business_note';
 if(reported) facts=[`${provider==='file'?'The reviewed file reports':'The business reports'}: ${validateSharedMemoryProjection(d,workspaceId).text}. This reported context is not independently measured and does not establish causation.`];
 else if(provider==='google_sheets') facts=z.array(z.object({metric:z.string(),value:decimalSchema,unit:z.string()})).max(100).parse(d.metrics)
  .map(m=>`Google Sheets ${label(m.metric)}: ${m.value} ${label(m.unit)}, recorded ${daySchema.parse(d.date)}.`);
 else if(provider==='square') facts=[`Square completed payment: ${num(d.amount_minor)} ${z.string().regex(/^[A-Z]{3}$/).parse(d.currency)} minor units, recorded ${z.string().parse(d.created_at)}. This is a payment record, not posted accounting revenue.`];
 else if(provider==='quickbooks_online') {
  const q=QboPreviewSchema.parse(d.preview);
  if(q.kind==='record') facts=Object.entries(q.amounts).map(([k,m])=>`QuickBooks ${label(d.record_type)} ${k}: ${num(m!.amount)} ${m!.currency}, posting date ${daySchema.parse(d.posting_date)}, ${label(d.basis)} basis.`);
  else {
   if(q.truncated||q.columns.length!==2||!/^(account|distribution account)$/i.test(q.columns[0].title||'')||!/^(total|amount|[A-Z]{3})$/i.test(q.columns[1].title||'')) throw new Error('shared_qbo_columns_unqualified');
   facts=q.rows.filter(row=>row.rowType==='summary').map(row=>{
    const name=row.cells.find(c=>c.columnKey===q.columns[0].columnKey)?.value;
    const amount=row.cells.find(c=>c.columnKey===q.columns[1].columnKey)?.value;
    return `QuickBooks ${label(q.reportType)} stored summary ${label(name)}: ${num(amount)} ${q.sourceCurrency}, ${q.periodStart} through ${q.periodEnd}, ${q.reportBasis} basis. Summary rows may overlap and must not be added.`;
   });
  }
 } else {
  const records=z.array(z.record(z.unknown())).max(2000).parse(d.records);
  for(const record of records) {
   const snapshot=record.snapshot?object(record.snapshot):null;
   if(record.metrics||snapshot) {
    const metrics=z.array(z.object({key:z.string(),value:decimalSchema,currency:z.string().optional()})).parse(snapshot?.metrics??record.metrics);
    for(const metric of metrics) {
     const semantics=reportingMetricSemantics(provider,metric,snapshot?'snapshot':'history');
     const unit=semantics.currency??semantics.unit;
     const partition=semantics.unit==='count'&&semantics.partition?` (currency partition: ${semantics.partition})`:'';
     facts.push(`${label(provider)} ${label(metric.key)}: ${metric.value} ${unit}${partition}; ${snapshot?`snapshot ${snapshot.start} through ${snapshot.end}`:`recorded ${daySchema.parse(record.day)}`}. Scope: ${label(d.scope)}.`);
    }
   } else if(provider==='wix-orders') facts.push(`Wix order amount: ${num(record.total_amount)} ${z.string().regex(/^[A-Z]{3}$/).parse(record.currency_code)}, created ${z.string().parse(record.created_at)}; order value is not a settlement or accounting revenue.`);
   else if(provider==='zoho-books') {
    if(record.counted!==true||record.currency!=='USD') continue;
    facts.push(`Zoho Books stored ${label(z.array(z.unknown()).parse(record.key)[2])}: ${num(record.total)} USD, recorded ${daySchema.parse(record.day)}. This record does not establish cash received or profit.`);
   } else if(provider==='loyverse') {
    // This reader has no verified merchant currency. Never expose its money as a usable total.
    facts.push(`Loyverse receipt recorded ${z.string().parse(record.created_at)}; ${record.cancelled===true?'cancelled':'not marked cancelled'}. Monetary comparison is unavailable because currency is not established by this projection.`);
   } else throw new Error('shared_projection_unsupported');
  }
 }
 if(!facts.length||facts.some(f=>f.length>8000)) throw new Error('shared_projection_empty_or_large');
 let eventDay:string|null=null;
 if(provider==='square'&&typeof d.created_at==='string'&&typeof d.time_zone==='string') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:d.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d.created_at));
  eventDay=daySchema.parse(['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-'));
 }
 const scope={entityId:d.entity_id??d.business_entity_id??null,connectionId:d.connection_id??null,
  entityBinding:d.entity_id||d.business_entity_id?'protected':'unavailable',scope:d.scope??'stored_record_only',
  start:d.period_start??d.posting_date??d.date??eventDay??null,end:d.period_end??d.posting_date??d.date??eventDay??null,timeZone:d.time_zone??null,
  currency:d.currency??null,coverage:typeof d.coverage==='string'?d.coverage:'unknown',additive:false};
 return {...r,provider,facts,scope,reported,roots:z.array(root).parse(d.read_sources??[])};
}
const fingerprint=(rows:SharedRow[])=>evidenceEngineHash({contract:"shared_generation_v2",rows:rows.map(r=>({identity:r.identity,hash:r.hash,facts:r.facts,scope:r.scope})),relationships:sharedFinancialBoundaries(rows)});
export async function prepareSharedGeneration(reader:SupabaseClient<Database>,workspaceId:string,start:string,end:string):Promise<SharedPrepared> {
 daySchema.parse(start);daySchema.parse(end);z.string().uuid().parse(workspaceId);
 const rpc=reader as unknown as SharedClient;
 const catalog=z.object({stage:z.literal('catalog_only'),candidates:z.array(z.object({provider:z.string(),identity})).max(97),truncated:z.boolean()}).parse(await sharedRpc(rpc,'discover_shared_evidence_v1',{p_workspace_id:workspaceId,p_start:start,p_end:end}));
 const rows:SharedRow[]=[];let omitted=catalog.truncated;let chars=0;
 for(const candidate of catalog.candidates.slice(0,96)) {
  if(rows.length===24) {omitted=true;break;}
  const i=candidate.identity;
  const raw=await sharedRpc(rpc,i.kind==='legacy_binding'?'preview_shared_legacy_evidence_v1':'read_shared_typed_evidence_v1',i.kind==='legacy_binding'
   ?{p_workspace_id:workspaceId,p_binding_id:i.binding_id,p_start:i.start,p_end:i.end}:{p_workspace_id:workspaceId,p_identity:i});
  const preview=z.object({stage:z.literal('unadmitted'),resolved}).parse(raw);
  // Any unknown, stale or unauthorized input stops the candidate before provider use.
  const row=sharedRow(preview.resolved,workspaceId);if(row.provider!==candidate.provider) throw new Error('shared_provider_mismatch');
  const size=JSON.stringify(row.facts).length;
  if(chars+size>12000){omitted=true;continue;}chars+=size;rows.push(row);
 }
 const prepared={workspaceId,start,end,rows,relationships:sharedFinancialBoundaries(rows),fingerprint:fingerprint(rows),limitations:[
  'Stored observations have source-specific periods and units. Coverage is not proven complete; do not sum overlapping accounting, invoice, order or payment evidence or infer causation.',
  ...(omitted?['Some whole source groups were omitted by the evidence budget. This is not an exhaustive audit.']:[])]};
 issued.set(prepared,evidenceEngineHash(prepared));return prepared;
}
export function assertSharedPrepared(p:SharedPrepared) {
 if(issued.get(p)!==evidenceEngineHash(p)||fingerprint(p.rows)!==p.fingerprint) throw new Error('shared_preparation_changed');
 // Always repeat canonical semantics; issued packets cannot skip this before AI use.
 for(const row of p.rows) if(row.reported) validateSharedMemoryProjection(row.data,p.workspaceId);
}
export function sharedTargetHref(workspaceId:string,kind:'vsi_exchange'|'briefing_run',id:string,sourceHash?:string):`/app/${string}` {
 z.string().uuid().parse(workspaceId);z.string().uuid().parse(id);
 if(sourceHash!==undefined) hash.parse(sourceHash);
 return `/app/sources/evidence/${kind}/${id}?workspace=${workspaceId}${sourceHash?`#source-${sourceHash}`:""}`;
}
export async function sealSharedGeneration(reader:SupabaseClient<Database>,p:SharedPrepared,target:{kind:'vsi_request'|'briefing_run';id:string;attempt:number;ticketId:string}):Promise<string> {
 assertSharedPrepared(p);
 const {data:{user},error}=await reader.auth.getUser();const claims=await reader.auth.getClaims();
 const session=z.string().uuid().safeParse(claims.data?.claims.session_id);
 if(error||!user||claims.error||claims.data?.claims.sub!==user.id||!session.success) throw new Error('shared_actor_unavailable');
 const rpc=reader as unknown as SharedClient;const sources:Record<string,unknown>[]=[];
 for(const row of p.rows) {
  if(row.reported) {
   validateSharedMemoryProjection(row.data,p.workspaceId);
   const admin=createSupabaseAdminClient();if(!admin) throw new Error('shared_semantic_certification_unavailable');
   if(await sharedRpc(admin as unknown as SharedClient,'certify_shared_memory_semantics_v1',{p_workspace_id:p.workspaceId,p_actor_id:user.id,p_session_id:session.data,p_identity:row.identity})!==true) throw new Error('shared_semantic_certification_failed');
  }
  if(row.identity.kind==='legacy_binding') {
   const captured=z.object({reference_id:z.string().uuid(),source_hash:hash}).parse(await sharedRpc(rpc,'capture_legacy_evidence_v1',{p_workspace_id:p.workspaceId,p_binding_id:row.identity.binding_id,p_start:row.identity.start,p_end:row.identity.end}));
   if(captured.source_hash!==row.hash) throw new Error('shared_source_changed');sources.push({kind:'legacy_reference',reference_id:captured.reference_id});
  } else sources.push(row.identity);
 }
 await bindGoogleSheetsRead(reader,target.ticketId,p.rows.flatMap(r=>r.roots));
 const deps=z.object({manifestIds:z.array(z.string().uuid()),readSources:z.array(root)}).parse(await sharedRpc(rpc,'shared_evidence_dependencies_v1',{p_workspace_id:p.workspaceId,p_ticket_id:target.ticketId}));
 await bindGoogleSheetsRead(reader,target.ticketId,deps.readSources);
 const sealed=z.object({stage:z.literal('database_bound'),manifest_id:z.string().uuid(),provider_policy_required:z.literal(true)}).parse(await sharedRpc(rpc,'seal_shared_evidence_manifest_v1',{
  p_workspace_id:p.workspaceId,p_target_kind:target.kind,p_target_id:target.id,p_attempt:target.attempt,p_read_ticket_id:target.ticketId,p_sources:sources,p_inherited_manifest_ids:deps.manifestIds}));
 return sealed.manifest_id;
}
