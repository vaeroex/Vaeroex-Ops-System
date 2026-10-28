import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bindGoogleSheetsRead } from "@/lib/integrations/google-sheets/read-authority";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { QboPreviewSchema } from "@/lib/integrations/qbo-customer/contracts";
import { decimalSchema, daySchema, instantSchema, pluginProviders } from "./contracts";
import { sharedFinancialBoundaries, type SharedRelationship } from "./financial-boundaries";
import { validateSharedMemoryProjection } from "./memory-eligibility";
import { reportingMetricSemantics } from "./adapters";
import { groupFactTimes, type FactTime, type FactTimeGroup } from "./fact-time";
import { decodeSharedDiscoveryCatalog, prioritizeSharedCandidates, prioritizeSharedRows, requestedSharedProviders } from "./generation-selection";
import { sharedRpcFailure, withSharedPreparationPhase as preparationPhase } from "./preparation-diagnostics";

export type SharedClient = { rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}> };
export async function sharedRpc(reader:SharedClient,name:string,args:Record<string,unknown>) {
 let result;
 try { result=await reader.rpc(name,args); } catch(error) { throw sharedRpcFailure(name,error); }
 if(result.error) throw sharedRpcFailure(name,result.error);return result.data;
}
const identity=z.record(z.unknown()),hash=z.string().regex(/^[a-f0-9]{64}$/);
const resolved=z.object({identity,hash,data:z.record(z.unknown())});
const root=z.object({table:z.string().regex(/^[a-z][a-z0-9_]*$/),id:z.string().uuid()});
export type SharedRow={identity:Record<string,unknown>;hash:string;provider:string;facts:string[];factTimes?:FactTimeGroup[];salesInvoiceFactGroups?:number[][];scope:Record<string,unknown>;reported:boolean;data:Record<string,unknown>;roots:z.infer<typeof root>[]};
export type SharedProviderCoverage={provider:string;catalog:number;discovered:number;prepared:number;empty:number;unsupported:number;factBudgetOmitted:number;rowBudgetOmitted:number};
export type SharedPrepared={workspaceId:string;start:string;end:string;rows:SharedRow[];fingerprint:string;limitations:string[];relationships:SharedRelationship[];coverage:{providers:SharedProviderCoverage[];requestedProviders:string[];maxCandidates:96;maxRows:24;maxFactChars:12000}};
const issued=new WeakMap<SharedPrepared,string>();
const num=(v:unknown)=>decimalSchema.parse(v);
const label=(v:unknown)=>z.string().min(1).max(160).parse(v).replace(/[_-]/g," ");
const object=(v:unknown)=>z.record(z.unknown()).parse(v);
/** Opposite-family zero metrics remain selectable; only exact count markers
 * establish the stored record's contribution family, never its money value. */
function xeroContribution(metrics: readonly {key:string;value:string;currency?:string}[]): string {
 const invoices=metrics.filter(metric=>metric.key==='invoices'),bills=metrics.filter(metric=>metric.key==='bills');
 if(invoices.length===1&&bills.length===1&&invoices[0].currency
  &&metrics.every(metric=>metric.currency===invoices[0].currency)) {
  const zero=(value:string)=>/^-?0+(?:\.0+)?$/.test(value),one=(value:string)=>/^0*1(?:\.0+)?$/.test(value);
  if(one(invoices[0].value)&&zero(bills[0].value)) return 'sales-invoice contribution';
  if(zero(invoices[0].value)&&one(bills[0].value)) return 'purchase-bill contribution';
 }
 return 'record contribution';
}
/** An authorized protected projection can legitimately have no usable facts. This typed
 * outcome is never used for malformed fields, failed authority or stale binding. */
export class SharedProjectionUnavailableError extends Error {
 constructor(readonly provider: string, readonly reason: 'empty' | 'unsupported') {
  super(`shared_projection_${reason}`); this.name='SharedProjectionUnavailableError';
 }
}
const currencySchema=z.string().regex(/^[A-Z]{3}$/);
const sourceStatus=z.string().min(1).max(40).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
function retainedCaptureTimes(data:Record<string,unknown>,provider:string):Partial<FactTime> {
 const timestamp=(key:string)=>data[key]===null?null:instantSchema.parse(data[key]);
 if(provider==='quickbooks_online')return {
  ...(Object.hasOwn(data,'observed_at')?{recordObservedAt:timestamp('observed_at')}:{}),
  ...(Object.hasOwn(data,'synchronized_at')?{recordSynchronizedAt:timestamp('synchronized_at')}:{})
 };
 // SQL08/12 aliases connection.last_sync_at as observed_at. It is connection
 // import metadata, not a row's business event or measurement timestamp.
 if(provider==='google_sheets')return Object.hasOwn(data,'observed_at')?{connectionLastSyncAt:timestamp('observed_at')}:{};
 return {};
}
function eventTime(value:unknown,basis:'payment_instant'|'receipt_instant'|'order_instant',valueTiming:'payment_record'|'receipt_record'|'order_record',zone:unknown='UTC'):FactTime {
 const instant=instantSchema.parse(value),timeZone=z.string().min(1).max(80).parse(zone);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
 const date=daySchema.parse(['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-'));
 return {date,basis,valueTiming,instant,timeZone};
}
/** Exact stored observations only. Never sum invoice/order/payment/accounting totals,
 * infer a currency exponent, infer entity correspondence, or parse raw file text. */
export function sharedRow(raw:unknown,workspaceId:string):SharedRow {
 const r=resolved.parse(raw),d=r.data;if(d.workspace_id!==workspaceId) throw new Error("shared_workspace_mismatch");
 const provider=z.enum([...pluginProviders,"file","business_note"]).parse(d.provider);
 // Validate even empty sources before returning a nonfatal projection outcome.
 const roots=z.array(root).parse(d.read_sources??[]),captureTimes=retainedCaptureTimes(d,provider);
 for(const key of ['period_start','period_end','date','posting_date'])if(d[key]!==undefined&&d[key]!==null)daySchema.parse(d[key]);
 if(typeof d.period_start==='string'&&typeof d.period_end==='string'&&d.period_start>d.period_end)throw new Error('shared_period_invalid');
 if(d.time_zone!==undefined&&d.time_zone!==null)new Intl.DateTimeFormat('en',{timeZone:z.string().parse(d.time_zone)});
 if(d.scope!==undefined)label(d.scope);
 if(provider==='loyverse'&&d.currency!==undefined&&d.currency!==null)currencySchema.parse(d.currency);
 let facts:string[]=[];let unavailableReason:'empty'|'unsupported'='empty';const factTimes:FactTime[]=[];const salesInvoiceFactGroups:number[][]=[];const reported=provider==='file'||provider==='business_note';
 if(reported) facts=[`${provider==='file'?'The reviewed file reports':'The business reports'}: ${validateSharedMemoryProjection(d,workspaceId).text}. This reported context is not independently measured and does not establish causation.`];
 else if(provider==='google_sheets') {daySchema.parse(d.date);facts=z.array(z.object({metric:z.string(),value:decimalSchema,unit:z.string()})).max(100).parse(d.metrics)
  .map(m=>{const date=daySchema.parse(d.date);factTimes.push({date,basis:'sheet_row_date',valueTiming:'row_value',...captureTimes});
   return `Google Sheets ${label(m.metric)}: ${m.value} ${label(m.unit)}, supplied row date ${date}.`;});}
 else if(provider==='square') {
  if(d.status!=='COMPLETED') throw new Error('shared_square_status_invalid');
  const time=eventTime(d.created_at,'payment_instant','payment_record',d.time_zone);factTimes.push(time);
  const amount=num(d.amount_minor);if(!/^-?\d+$/.test(amount)||Number(amount)<0)throw new Error('shared_square_minor_units_invalid');
  facts=[`Square completed payment: ${amount} ${currencySchema.parse(d.currency)} minor units, recorded ${time.instant}. This is a payment record, not posted accounting revenue.`];
 } else if(provider==='quickbooks_online') {
  const q=QboPreviewSchema.parse(d.preview),currency=currencySchema.parse(d.currency);unavailableReason='unsupported';
  if(q.kind==='record') {
   if(['voided','deleted','inactive'].includes(q.status)||q.accounting.sourceCurrency!==currency||q.accounting.basis!==d.basis||q.temporal.postingDate!==d.posting_date)
    throw new Error('shared_qbo_scope_invalid');
   const date=d.posting_date===null?null:daySchema.parse(d.posting_date);
   facts=Object.entries(q.amounts).map(([k,m])=>{
    if(m!.currency!==currency)throw new Error('shared_qbo_currency_invalid');
    factTimes.push({date,basis:'posting_date',valueTiming:k==='balance'?'balance_at_import':'document_contribution',...captureTimes});
    return `QuickBooks ${label(d.record_type)} ${k}: ${num(m!.amount)} ${currency}, posting date ${date??'unknown'}, ${label(d.basis)} basis.${k==='balance'?' Balance at import; exact as-of time is not established by the posting date.':''}`;
   });
  } else {
   const start=daySchema.parse(q.periodStart),end=daySchema.parse(q.periodEnd);
   if(start>end||q.sourceCurrency!==currency||q.reportBasis!==d.basis||start!==d.period_start||end!==d.period_end
    ||new Set(q.columns.map(column=>column.columnKey)).size!==q.columns.length
    ||q.rows.some(row=>new Set(row.cells.map(cell=>cell.columnKey)).size!==row.cells.length))throw new Error('shared_qbo_scope_invalid');
   if(q.truncated)throw new Error('shared_qbo_truncated');
   if(q.columns.length!==2||!/^(account|distribution account)$/i.test(q.columns[0].title||'')||!/^(total|amount|[A-Z]{3})$/i.test(q.columns[1].title||'')) throw new SharedProjectionUnavailableError(provider,'unsupported');
   facts=q.rows.filter(row=>row.rowType==='summary').map(row=>{
    const name=row.cells.find(c=>c.columnKey===q.columns[0].columnKey)?.value;
    const amount=row.cells.find(c=>c.columnKey===q.columns[1].columnKey)?.value;
    factTimes.push({date:start,periodEnd:end,basis:'report_period',valueTiming:'stored_report_value',...captureTimes});
    return `QuickBooks ${label(q.reportType)} stored summary ${label(name)}: ${num(amount)} ${q.sourceCurrency}, ${q.periodStart} through ${q.periodEnd}, ${q.reportBasis} basis. Summary rows may overlap and must not be added.`;
   });
  }
 } else {
  const records=z.array(z.record(z.unknown())).max(2000).parse(d.records);if(records.length)unavailableReason='unsupported';
  for(const record of records) {
   const snapshot=record.snapshot?object(record.snapshot):null;
   if(record.metrics||snapshot) {
    const metrics=z.array(z.object({key:z.string(),value:decimalSchema,currency:z.string().optional()})).parse(snapshot?.metrics??record.metrics);
    const contribution=provider==='xero'&&!snapshot?xeroContribution(metrics):null;
    let snapshotTime:FactTime|null=null;
    if(snapshot){
     const instant=instantSchema.parse(snapshot.start),endInstant=instantSchema.parse(snapshot.end);
     if(Date.parse(instant)>Date.parse(endInstant))throw new Error('shared_snapshot_time_invalid');
     snapshotTime={date:daySchema.parse(new Date(instant).toISOString().slice(0,10)),periodEnd:daySchema.parse(new Date(endInstant).toISOString().slice(0,10)),
      basis:'snapshot_capture',valueTiming:'snapshot_at_capture',instant,endInstant,timeZone:'UTC'};
    }
    const invoiceGroup:number[]=[];
    for(const metric of metrics) {
     if(contribution==='sales-invoice contribution'&&['invoices','billed','outstanding'].includes(metric.key)) invoiceGroup.push(facts.length);
     const semantics=reportingMetricSemantics(provider,metric,snapshot?'snapshot':'history');
     const unit=semantics.currency??semantics.unit;
     const partition=semantics.unit==='count'&&semantics.partition?` (currency partition: ${semantics.partition})`:'';
     const date=snapshot?null:daySchema.parse(record.day);
     if(date) factTimes.push({date,basis:provider==='xero'?'invoice_or_bill_date':provider==='clockify'?'entry_start_utc_date':'spent_date',
      valueTiming:provider==='xero'?metric.key==='outstanding'?'balance_at_import':'document_contribution':'entry_contribution'});
     else if(snapshotTime) factTimes.push(provider==='toggl'&&metric.key==='hours'
      ?{date:null,basis:'lifetime_project_snapshot',valueTiming:'lifetime_through_capture',instant:snapshotTime.instant!,endInstant:snapshotTime.endInstant!,timeZone:'UTC'}:snapshotTime);
     const dateLabel=snapshot?`snapshot ${snapshot.start} through ${snapshot.end}`:provider==='xero'?`invoice/bill date ${date}`:provider==='clockify'?`entry start date (UTC) ${date}`:`entry spent date ${date}`;
     if(contribution) {
      const dated=contribution==='record contribution'?`${contribution}; invoice/bill date ${date}`:`${contribution} dated ${date}`;
      const timing=metric.key==='outstanding'?'; balance at import; as-of unknown':'';
      facts.push(`${label(metric.key)}: ${metric.value} ${unit}${partition}; ${dated}${timing}.`);
     } else facts.push(`${label(provider)} ${label(metric.key)}: ${metric.value} ${unit}${partition}; ${dateLabel}. Scope: ${label(d.scope)}.${provider==='toggl'&&metric.key==='hours'?' Lifetime visible-active-project total; beginning unknown, not hours worked during the snapshot capture interval.':''}`);
    }
    if(invoiceGroup.length) salesInvoiceFactGroups.push(invoiceGroup);
   } else if(provider==='wix-orders') {
    const time=eventTime(record.created_at,'order_instant','order_record'),amount=num(record.total_amount),status=sourceStatus.parse(record.payment_status);
    if(Number(amount)<0)throw new Error('shared_wix_amount_invalid');factTimes.push(time);
    facts.push(`Wix approved order amount: ${amount} ${currencySchema.parse(record.currency_code)}, created ${time.instant}; stored payment status ${JSON.stringify(status)}. Order value and status are not a settlement or accounting revenue.`);
   } else if(provider==='zoho-books') {
    const counted=z.boolean().parse(record.counted),currency=currencySchema.parse(record.currency),key=z.array(z.unknown()).min(4).parse(record.key);
    const kind=z.enum(['invoice','expense']).parse(key[2]),date=daySchema.parse(record.day),total=num(record.total),outstanding=num(record.outstanding);
    if(Number(total)<0||Number(outstanding)<0||kind==='expense'&&Number(outstanding)!==0)throw new Error('shared_zoho_amount_invalid');
    if(!counted||currency!=='USD')continue;
    facts.push(`Zoho Books stored ${kind}: ${total} USD, document date ${date}. This record does not establish cash received or profit.`);
    factTimes.push({date,basis:'invoice_or_expense_date',valueTiming:'document_contribution'});
    if(kind==='invoice'){
     facts.push(`Zoho Books invoice outstanding: ${outstanding} USD; document date ${date}; balance at import, exact as-of time unknown. This is not a historical balance on the document date.`);
     factTimes.push({date,basis:'invoice_or_expense_date',valueTiming:'balance_at_import'});
    }
   } else if(provider==='loyverse') {
    const time=eventTime(record.receipt_date,'receipt_instant','receipt_record'),created=instantSchema.parse(record.created_at),updated=instantSchema.parse(record.updated_at);
    const type=z.enum(['SALE','REFUND']).parse(record.receipt_type),cancelled=z.boolean().parse(record.cancelled);
    const total=num(record.total_money),tax=num(record.total_tax),discount=num(record.total_discount);
    const currency=d.currency===null||d.currency===undefined?null:currencySchema.parse(d.currency);
    factTimes.push(time);
    facts.push(`Loyverse ${type} receipt dated ${time.instant}; created ${created}; updated ${updated}; ${cancelled?'cancelled, excluded from active sale/refund comparisons':'not marked cancelled'}. Creation time selects this import, not the possibly backdated receipt date.${currency?` Stored total ${total} ${currency}; tax ${tax} ${currency}; discount ${discount} ${currency}. Stored signs are preserved; tax and discount are separate components, not amounts to add to or subtract from the total. A refund remains separate from a sale; this is not accounting revenue.`:' Monetary comparison is unavailable because protected merchant currency is not established.'}`);
   } else throw new Error('shared_projection_unsupported');
  }
 }
 if(facts.some(f=>f.length>8000)) throw new Error('shared_projection_large');
 if(!facts.length)throw new SharedProjectionUnavailableError(provider,unavailableReason);
 const eventDay=provider==='square'?factTimes[0]?.date:null;
 const scope={entityId:d.entity_id??d.business_entity_id??null,connectionId:d.connection_id??null,
  entityBinding:d.entity_id||d.business_entity_id?'protected':'unavailable',scope:d.scope??'stored_record_only',
  start:d.period_start??d.posting_date??d.date??eventDay??null,end:d.period_end??d.posting_date??d.date??eventDay??null,timeZone:d.time_zone??null,
  currency:d.currency??null,coverage:typeof d.coverage==='string'?d.coverage:'unknown',additive:false,
  ...(['xero','harvest','clockify','loyverse','zoho-books','wix-orders','toggl','zoho-inventory','katana'].includes(provider)?{windowKind:'retrieval_selection'}:{})};
 if(factTimes.length&&factTimes.length!==facts.length) throw new Error('shared_fact_time_alignment');
 return {...r,provider,facts,...(factTimes.length?{factTimes:groupFactTimes(factTimes)}:{}),...(provider==='xero'?{salesInvoiceFactGroups}:{}),scope,reported,roots};
}

const fingerprint=(rows:SharedRow[])=>evidenceEngineHash({contract:"shared_generation_v2",rows:rows.map(r=>({identity:r.identity,hash:r.hash,facts:r.facts,...(r.factTimes?{factTimes:r.factTimes}:{}),...(r.salesInvoiceFactGroups?{salesInvoiceFactGroups:r.salesInvoiceFactGroups}:{}),scope:r.scope})),relationships:sharedFinancialBoundaries(rows)});
export async function prepareSharedGeneration(reader:SupabaseClient<Database>,workspaceId:string,start:string,end:string,question=''):Promise<SharedPrepared> {
 daySchema.parse(start);daySchema.parse(end);z.string().uuid().parse(workspaceId);
 const rpc=reader as unknown as SharedClient,requestedProviders=requestedSharedProviders(question);
 // v2 is an explicit SQL dependency: never silently fall back to discovery that
 // truncated requested providers before relevance was considered.
 const catalog=await preparationPhase('discovery',async()=>decodeSharedDiscoveryCatalog(await sharedRpc(rpc,'discover_shared_evidence_v2',{
  p_workspace_id:workspaceId,p_start:start,p_end:end,p_preferred_providers:requestedProviders})));
 const providers:SharedProviderCoverage[]=catalog.providerCounts.map(count=>({provider:count.provider,catalog:count.total,discovered:count.returned,
  prepared:0,empty:0,unsupported:0,factBudgetOmitted:0,rowBudgetOmitted:0}));
 const coverageFor=(provider:string)=>providers.find(row=>row.provider===provider)!;
 const available:SharedRow[]=[];
 for(const candidate of prioritizeSharedCandidates(catalog.candidates,requestedProviders)) {
  const i=candidate.identity;
  const preview=await preparationPhase('source_read',async()=>z.object({stage:z.literal('unadmitted'),resolved}).parse(await sharedRpc(rpc,i.kind==='legacy_binding'?'preview_shared_legacy_evidence_v1':'read_shared_typed_evidence_v1',i.kind==='legacy_binding'
   ?{p_workspace_id:workspaceId,p_binding_id:i.binding_id,p_start:i.start,p_end:i.end}:{p_workspace_id:workspaceId,p_identity:i})));
  try { available.push(await preparationPhase('source_projection',()=>{
   if(preview.resolved.data.provider!==candidate.provider)throw new Error('shared_provider_mismatch');
   return sharedRow(preview.resolved,workspaceId);
  })); }
  catch(error) {
   // Only an explicitly recognized, authorized empty/unsupported shape can be
   // omitted. RPC errors, invalid values, foreign workspaces and stale bindings
   // are never caught here, even when neighboring usable evidence exists.
   if(!(error instanceof SharedProjectionUnavailableError)||error.provider!==candidate.provider)throw error;
   coverageFor(candidate.provider)[error.reason]++;
  }
 }
 const rows:SharedRow[]=[];let chars=0;
 for(const row of prioritizeSharedRows(available,requestedProviders,question)) {
  const coverage=coverageFor(row.provider),size=JSON.stringify(row.facts).length;
  if(rows.length===24){coverage.rowBudgetOmitted++;continue;}
  if(chars+size>12000){coverage.factBudgetOmitted++;continue;}
  chars+=size;rows.push(row);coverage.prepared++;
 }
 const limitations=[
  'Stored observations have source-specific periods and units. Coverage is not proven complete; do not sum overlapping accounting, invoice, order or payment evidence or infer causation.',
  ...providers.filter(count=>count.catalog!==count.prepared).map(count=>`${count.provider}: ${count.prepared} whole source groups prepared from ${count.catalog} catalog candidates; ${count.catalog-count.discovered} outside the discovery cap, ${count.empty} authorized empty, ${count.unsupported} unsupported typed projection, ${count.factBudgetOmitted} outside the fact-character budget, ${count.rowBudgetOmitted} outside the row budget. Omitted details were not assessed; missing is not zero.`),
  ...requestedProviders.filter(provider=>!rows.some(row=>row.provider===provider)).map(provider=>`Requested source ${provider} has no usable evidence in this bounded preparation. Do not substitute another provider or claim it was reviewed.`),
 ];
 if(providers.some(count=>count.factBudgetOmitted||count.rowBudgetOmitted))limitations.push('Some whole source groups were omitted by the evidence budget. This is not an exhaustive audit.');
 const prepared:SharedPrepared={workspaceId,start,end,rows,relationships:sharedFinancialBoundaries(rows),fingerprint:fingerprint(rows),limitations,
  coverage:{providers,requestedProviders,maxCandidates:96,maxRows:24,maxFactChars:12000}};
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
 await preparationPhase('prepared_validation',()=>assertSharedPrepared(p));
 const {user,session}=await preparationPhase('actor_validation',async()=>{
  const {data:{user},error}=await reader.auth.getUser();const claims=await reader.auth.getClaims();
  const session=z.string().uuid().safeParse(claims.data?.claims.session_id);
  if(error||!user||claims.error||claims.data?.claims.sub!==user.id||!session.success) throw new Error('shared_actor_unavailable');
  return {user,session};
 });
 const rpc=reader as unknown as SharedClient;const sources:Record<string,unknown>[]=[];
 for(const row of p.rows) {
  if(row.reported) {
   await preparationPhase('memory_certification',async()=>{
   validateSharedMemoryProjection(row.data,p.workspaceId);
   const admin=createSupabaseAdminClient();if(!admin) throw new Error('shared_semantic_certification_unavailable');
   if(await sharedRpc(admin as unknown as SharedClient,'certify_shared_memory_semantics_v1',{p_workspace_id:p.workspaceId,p_actor_id:user.id,p_session_id:session.data,p_identity:row.identity})!==true) throw new Error('shared_semantic_certification_failed');
   });
  }
  if(row.identity.kind==='legacy_binding') {
   await preparationPhase('legacy_capture',async()=>{
   const captured=z.object({reference_id:z.string().uuid(),source_hash:hash}).parse(await sharedRpc(rpc,'capture_legacy_evidence_v1',{p_workspace_id:p.workspaceId,p_binding_id:row.identity.binding_id,p_start:row.identity.start,p_end:row.identity.end}));
   if(captured.source_hash!==row.hash) throw new Error('shared_source_changed');sources.push({kind:'legacy_reference',reference_id:captured.reference_id});
   });
  } else sources.push(row.identity);
 }
 await preparationPhase('source_roots',()=>bindGoogleSheetsRead(reader,target.ticketId,p.rows.flatMap(r=>r.roots)));
 const deps=await preparationPhase('dependency_read',async()=>z.object({manifestIds:z.array(z.string().uuid()),readSources:z.array(root)}).parse(await sharedRpc(rpc,'shared_evidence_dependencies_v1',{p_workspace_id:p.workspaceId,p_ticket_id:target.ticketId})));
 await preparationPhase('dependency_roots',()=>bindGoogleSheetsRead(reader,target.ticketId,deps.readSources));
 const sealed=await preparationPhase('manifest_seal',async()=>z.object({stage:z.literal('database_bound'),manifest_id:z.string().uuid(),provider_policy_required:z.literal(true)}).parse(await sharedRpc(rpc,'seal_shared_evidence_manifest_v1',{
  p_workspace_id:p.workspaceId,p_target_kind:target.kind,p_target_id:target.id,p_attempt:target.attempt,p_read_ticket_id:target.ticketId,p_sources:sources,p_inherited_manifest_ids:deps.manifestIds})));
 return sealed.manifest_id;
}
