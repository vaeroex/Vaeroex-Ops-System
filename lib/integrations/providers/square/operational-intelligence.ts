import "server-only";

import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";
import { assertSquareInterpretation, type SquareInterpretation } from "./canonical-interpretation";

export const SQUARE_OPERATIONAL_POLICY = "square_operational_intelligence_v1" as const;
export const SQUARE_OPERATIONAL_MAX_FACTS = 1_000;
export const SQUARE_OPERATIONAL_PAGE_SIZE = 25;
export const SQUARE_AI_DISPATCH_ENABLED = false as const;

const kinds = ["payment", "refund", "order", "catalog", "inventory"] as const;
type Money={amountMinor:string|null;currency:string|null};
const amount = z.object({ amountMinor: z.string().regex(/^-?(0|[1-9][0-9]{0,39})$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const metric = z.object({ count: z.number().int().min(0).max(SQUARE_OPERATIONAL_MAX_FACTS), total: amount.nullable(),
  exactAverageMinor: z.string().regex(/^-?(0|[1-9][0-9]{0,39})$/).nullable(), averageState: z.enum(["exact", "no_observations", "mixed_currency", "non_integral_minor_unit", "amount_unavailable"]) }).strict();
const Activity = z.object({ evidenceRef: z.string().regex(/^sqe_[a-f0-9]{16}$/), kind: z.enum(kinds), status: z.string().min(1).max(80),
  occurredAt: IsoTimestampSchema.nullable(), location: z.enum(["mapped_location", "seller_scoped", "explicitly_unresolved"]),
  amount: amount.nullable(), quantity: z.string().max(80).nullable(), unitState: z.enum(["not_applicable", "unverified"]),
  label: z.string().min(1).max(512).nullable(), relationship: z.enum(["not_applicable", "observed_id_match", "unresolved", "conflict"]),
  admission: z.literal("verified_non_economic") }).strict();
const Group=z.object({kind:z.enum(["payment","refund","order"]),locationGroup:z.string().regex(/^(seller_scoped|explicitly_unresolved|sqg_[a-f0-9]{16})$/),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),summary:metric,evidenceRefs:z.array(z.string().regex(/^sqe_[a-f0-9]{16}$/)).min(1).max(SQUARE_OPERATIONAL_MAX_FACTS)}).strict();
const KpiEvidence=z.object({evidenceRefs:z.array(z.string().regex(/^sqe_[a-f0-9]{16}$/)).max(SQUARE_OPERATIONAL_MAX_FACTS),
  dimensionalScope:z.literal("current_workspace_entity_generation"),freshness:z.enum(["observed","stale","unknown","mixed"]),
  admission:z.literal("verified_non_economic"),completeness:z.literal("unknown"),reasonCodes:z.array(z.string().min(1).max(120)).min(1).max(8)}).strict();
export const SquareOperationalIntelligenceSchema = z.object({
  policyVersion: z.literal(SQUARE_OPERATIONAL_POLICY), calculationVersion: z.literal("square_operational_calculation_v1"),
  economic: z.literal("blocked"), historical: z.literal("unknown"), aiDispatch: z.literal("disabled"),
  counts: z.record(z.enum(kinds), z.number().int().min(0).max(SQUARE_OPERATIONAL_MAX_FACTS)),
  payment: metric, refund: metric, order: metric,
  groups:z.array(Group).max(SQUARE_OPERATIONAL_MAX_FACTS),
  refundRate: z.object({ numerator: z.number().int().min(0), denominator: z.number().int().min(0), state: z.literal("observed_count_ratio_not_financial_rate") }).strict(),
  statusMix: z.record(z.enum(kinds), z.record(z.string().min(1).max(80), z.number().int().min(0))),
  kpiEvidence:z.object({payment:KpiEvidence,refund:KpiEvidence,order:KpiEvidence,catalog:KpiEvidence,inventory:KpiEvidence,statusMix:KpiEvidence,refundRate:KpiEvidence}).strict(),
  orderStatusMix: z.record(z.string().min(1).max(80), z.number().int().min(0)),
  catalog: z.object({ admittedVariations: z.number().int().min(0), activeVariations: z.null(), activeState: z.literal("lifecycle_state_not_admitted") }).strict(),
  inventory: z.object({ observations: z.number().int().min(0), movementTotal: z.null(), movementState: z.literal("unit_compatibility_and_completeness_unverified") }).strict(),
  fulfillment: z.object({ activity: z.null(), state: z.literal("fulfillment_state_not_admitted") }).strict(),
  activity: z.array(Activity).max(SQUARE_OPERATIONAL_MAX_FACTS),
  insights: z.array(z.object({ code: z.string().min(1).max(80), state: z.enum(["observed", "insufficient_evidence"]), rule: z.string().min(1).max(160), text: z.string().min(1).max(300), blockedReason: z.string().min(1).max(160).nullable(), evidenceRefs: z.array(z.string()).max(100) }).strict()).max(20),
  limitations: z.array(z.enum(["historical_completeness_unknown", "orders_are_not_revenue", "refunds_are_not_netted", "catalog_is_not_stock", "inventory_units_unverified", "fulfillment_not_admitted"])).min(6).max(6),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
export type SquareOperationalIntelligence = z.infer<typeof SquareOperationalIntelligenceSchema>;

const compare = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;
const compareTimestamp = (a:string,b:string) => Date.parse(a)-Date.parse(b) || compare(a,b);
const timestamp = (item:SquareInterpretation) => Object.values(item.timestamps).filter((v):v is string=>typeof v === "string").sort(compareTimestamp).at(-1) ?? null;
const compareActivity = (a:{occurredAt:string|null;evidenceRef:string},b:{occurredAt:string|null;evidenceRef:string}) =>
  a.occurredAt === null ? b.occurredAt === null ? compare(a.evidenceRef,b.evidenceRef) : 1
    : b.occurredAt === null ? -1 : compareTimestamp(b.occurredAt,a.occurredAt) || compare(a.evidenceRef,b.evidenceRef);
const compareActivityOldest = (a:{occurredAt:string|null;evidenceRef:string},b:{occurredAt:string|null;evidenceRef:string}) =>
  a.occurredAt === null ? b.occurredAt === null ? compare(a.evidenceRef,b.evidenceRef) : 1
    : b.occurredAt === null ? -1 : compareTimestamp(a.occurredAt,b.occurredAt) || compare(a.evidenceRef,b.evidenceRef);
const moneyFor = (item:SquareInterpretation) => item.kind === "payment" ? item.money.total : item.kind === "refund" ? item.money.amount : item.kind === "order" ? item.money.total : null;
const displayMoney=(item:SquareInterpretation)=>{const value=moneyFor(item);return value?.amountMinor&&value.currency?{amountMinor:value.amountMinor,currency:value.currency}:null;};
export function summarizeSquareOperationalAmounts(values:readonly (Money|null)[]) {
  if (!values.length) return {count:0,total:null,exactAverageMinor:null,averageState:"no_observations" as const};
  if (values.some(v=>!v?.amountMinor || !v.currency)) return {count:values.length,total:null,exactAverageMinor:null,averageState:"amount_unavailable" as const};
  const currencies=new Set(values.map(v=>v!.currency!));
  if(currencies.size!==1) return {count:values.length,total:null,exactAverageMinor:null,averageState:"mixed_currency" as const};
  const sum=values.reduce((n,v)=>n+BigInt(v!.amountMinor!),BigInt(0)), count=BigInt(values.length);
  return {count:values.length,total:{amountMinor:String(sum),currency:values[0]!.currency!},
    exactAverageMinor:sum%count===BigInt(0)?String(sum/count):null,
    averageState:sum%count===BigInt(0)?"exact" as const:"non_integral_minor_unit" as const};
}

/** Deterministic, bounded projection of already authenticated interpretations.
 * It never imports a provider, database, model, telemetry or dispatch client. */
export function deriveSquareOperationalIntelligence(items:readonly SquareInterpretation[], relationships:readonly {fromFingerprint:string;state:string}[]) {
  if(items.length>SQUARE_OPERATIONAL_MAX_FACTS || relationships.length>20_000) throw new Error("square_operational_capacity");
  items.forEach(assertSquareInterpretation);
  if(new Set(items.map(i=>i.scopeKey)).size>1 || new Set(items.map(i=>i.resourceKey)).size!==items.length) throw new Error("square_operational_scope_denied");
  const byKind=Object.fromEntries(kinds.map(k=>[k,items.filter(i=>i.kind===k)])) as Record<typeof kinds[number],SquareInterpretation[]>;
  const evidenceFor=(selected:readonly SquareInterpretation[],reasonCodes:string[])=>{const values=new Set(selected.map(item=>item.freshness));return KpiEvidence.parse({
    evidenceRefs:selected.map(item=>`sqe_${item.fact.factFingerprint.slice(7,23)}`).sort(compare),dimensionalScope:"current_workspace_entity_generation",
    freshness:values.size===0?"unknown":values.size===1?[...values][0]:"mixed",admission:"verified_non_economic",completeness:"unknown",reasonCodes});};
  const linkState=(item:SquareInterpretation) => {
    const states=relationships.filter(link=>link.fromFingerprint===item.fact.factFingerprint).map(link=>link.state);
    if(!states.length) return "not_applicable" as const;
    if(states.includes("reference_conflict")) return "conflict" as const;
    if(states.length&&states.every(state=>state==="observed_id_match")) return "observed_id_match" as const;
    return "unresolved" as const;
  };
  const activity=items.map(item=>Activity.parse({evidenceRef:`sqe_${item.fact.factFingerprint.slice(7,23)}`,kind:item.kind,status:item.status??"unknown",
    occurredAt:timestamp(item),location:item.locationId?"mapped_location":item.kind==="catalog"?"seller_scoped":"explicitly_unresolved",
    amount:displayMoney(item),quantity:item.kind==="inventory"?item.quantity:null,unitState:item.kind==="inventory"?"unverified":"not_applicable",
    label:item.kind==="catalog"?item.presentationLabel:null,
    relationship:linkState(item),admission:"verified_non_economic"})).sort(compareActivity);
  const orderStatusMix=Object.fromEntries([...new Set(byKind.order.map(i=>i.status??"unknown"))].sort(compare).map(s=>[s,byKind.order.filter(i=>(i.status??"unknown")===s).length]));
  const statusMix=Object.fromEntries(kinds.map(kind=>[kind,Object.fromEntries([...new Set(byKind[kind].map(i=>i.status??"unknown"))].sort(compare).map(status=>[status,byKind[kind].filter(i=>(i.status??"unknown")===status).length]))]));
  const completedPayments=byKind.payment.filter(i=>i.status==="COMPLETED"), completedRefunds=byKind.refund.filter(i=>i.status==="COMPLETED");
  const groupItems=[...completedPayments,...completedRefunds,...byKind.order],groups=new Map<string,SquareInterpretation[]>();
  for(const item of groupItems){const value=moneyFor(item),locationGroup=item.locationId?`sqg_${contractSha256({scope:item.scopeKey,location:item.locationId}).slice(7,23)}`:"explicitly_unresolved";
    const key=contractSha256({kind:item.kind,locationGroup,currency:value?.currency??null});groups.set(key,[...(groups.get(key)??[]),item]);}
  const grouped=[...groups.values()].map(group=>{const first=group[0],value=moneyFor(first);return Group.parse({kind:first.kind,locationGroup:first.locationId?`sqg_${contractSha256({scope:first.scopeKey,location:first.locationId}).slice(7,23)}`:"explicitly_unresolved",currency:value?.currency??null,summary:summarizeSquareOperationalAmounts(group.map(moneyFor)),evidenceRefs:group.map(item=>`sqe_${item.fact.factFingerprint.slice(7,23)}`).sort(compare)});})
    .sort((a,b)=>compare(contractSha256(a),contractSha256(b)));
  const core={policyVersion:SQUARE_OPERATIONAL_POLICY,calculationVersion:"square_operational_calculation_v1" as const,economic:"blocked" as const,historical:"unknown" as const,aiDispatch:"disabled" as const,
    counts:Object.fromEntries(kinds.map(k=>[k,byKind[k].length])),payment:summarizeSquareOperationalAmounts(completedPayments.map(moneyFor)),refund:summarizeSquareOperationalAmounts(completedRefunds.map(moneyFor)),order:summarizeSquareOperationalAmounts(byKind.order.map(moneyFor)),groups:grouped,
    refundRate:{numerator:completedRefunds.length,denominator:completedPayments.length,state:"observed_count_ratio_not_financial_rate" as const},statusMix,orderStatusMix,
    kpiEvidence:{payment:evidenceFor(completedPayments,["provider_completed_payment_activity_not_revenue","historical_completeness_unknown"]),
      refund:evidenceFor(completedRefunds,["provider_completed_refund_activity_not_netting","historical_completeness_unknown"]),
      order:evidenceFor(byKind.order,["provider_order_activity_not_revenue","historical_completeness_unknown"]),
      catalog:evidenceFor(byKind.catalog,["catalog_lifecycle_not_admitted","catalog_not_stock"]),inventory:evidenceFor(byKind.inventory,["inventory_units_unverified","historical_completeness_unknown"]),
      statusMix:evidenceFor(items,["provider_status_observation_only"]),refundRate:evidenceFor([...completedPayments,...completedRefunds],["observed_count_ratio_not_financial_rate","refund_linkage_not_netting_authority"])},
    catalog:{admittedVariations:byKind.catalog.length,activeVariations:null,activeState:"lifecycle_state_not_admitted" as const},
    inventory:{observations:byKind.inventory.length,movementTotal:null,movementState:"unit_compatibility_and_completeness_unverified" as const},
    fulfillment:{activity:null,state:"fulfillment_state_not_admitted" as const},activity,
    insights:[{code:"history_required_for_trend",state:"insufficient_evidence" as const,rule:"compare only when both bounded periods are proven complete",text:"Trend comparisons are unavailable because historical completeness is unknown.",blockedReason:"historical_completeness_unknown",evidenceRefs:[]},
      {code:"observed_activity_only",state:"observed" as const,rule:"material when at least one verified admitted observation exists",text:`${items.length} verified non-economic provider observations are available.`,blockedReason:null,evidenceRefs:activity.slice(0,100).map(a=>a.evidenceRef)}],
    limitations:["historical_completeness_unknown","orders_are_not_revenue","refunds_are_not_netted","catalog_is_not_stock","inventory_units_unverified","fulfillment_not_admitted"] as const};
  return SquareOperationalIntelligenceSchema.parse({...core,fingerprint:contractSha256(core)});
}

export function pageSquareOperationalActivity(intelligence:SquareOperationalIntelligence, input:{kind?:string;status?:string;location?:string;from?:string;to?:string;sort?:"newest"|"oldest";page?:number;pageSize?:number}) {
  const parsed=SquareOperationalIntelligenceSchema.parse(intelligence), page=Math.max(1,Math.min(40,Math.trunc(input.page??1))), size=Math.max(1,Math.min(SQUARE_OPERATIONAL_PAGE_SIZE,Math.trunc(input.pageSize??SQUARE_OPERATIONAL_PAGE_SIZE)));
  const validDate=(value:string)=>{const instant=Date.parse(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===value;};
  if((input.from&&!validDate(input.from))||(input.to&&!validDate(input.to))||(input.from&&input.to&&input.from>input.to))throw new Error("square_operational_filter_denied");
  const from=input.from?Date.parse(`${input.from}T00:00:00Z`):null,to=input.to?Date.parse(`${input.to}T00:00:00Z`)+86_400_000:null;
  const rows=parsed.activity.filter(row=>(!input.kind||row.kind===input.kind)&&(!input.status||row.status===input.status)&&(!input.location||row.location===input.location)&&
    (from===null||(row.occurredAt!==null&&Date.parse(row.occurredAt)>=from))&&(to===null||(row.occurredAt!==null&&Date.parse(row.occurredAt)<to)))
    .sort(input.sort==="oldest"?compareActivityOldest:compareActivity);
  return {rows:rows.slice((page-1)*size,page*size),page,pageSize:size,total:rows.length,pages:Math.max(1,Math.ceil(rows.length/size))};
}

export function authorizeSquareAiDispatch(): {allowed:false;reason:"square_ai_dispatch_disabled"} {
  return {allowed:false,reason:"square_ai_dispatch_disabled"};
}
