import "server-only";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { assertSquareInterpretation, reconcileSquareInterpretations, type SquareInterpretation } from "./canonical-interpretation";

const snapshots = new WeakSet<object>();
export const SQUARE_EXPLANATION_LIMITS = Object.freeze({ dailyRequests:3, cooldownMs:3_600_000,
  coalesceMs:300_000, maximumOutputTokens:1000, maximumInputBytes:16_384, dailyOutputTokenBudget:3000 });

/** Counts and assessed reference states only. Never transactions, free text,
 * amounts, quantities, customer fields, credentials or provider identifiers. */
export function squareVerifiedIntelligenceSnapshot(items: readonly SquareInterpretation[], asOf: string) {
  IsoTimestampSchema.parse(asOf); items.forEach(assertSquareInterpretation);
  if (!items.length || items.length>1000 || new Set(items.map(i=>i.resourceKey)).size!==items.length) throw new Error("square_snapshot_invalid");
  const relationships = reconcileSquareInterpretations(items);
  const counts = Object.fromEntries(["payment","refund","order","catalog","inventory"].map(kind=>[kind,items.filter(i=>i.kind===kind).length]));
  const statuses = Object.fromEntries([...new Set(items.map(i=>`${i.kind}:${i.status ?? "unknown"}`))].sort().map(key=>[key,items.filter(i=>`${i.kind}:${i.status ?? "unknown"}`===key).length]));
  const referenceStates = Object.fromEntries([...new Set(relationships.links.map(l=>l.state))].sort().map(key=>[key,relationships.links.filter(l=>l.state===key).length]));
  const assessment = { counts,statuses,referenceStates,economic:"blocked" as const,historical:"unknown" as const,
    freshness:items.every(i=>i.freshness==="observed")?"observed":"stale_or_unknown",
    scans: [...new Set(items.map(i=>i.scan))].sort(),
    limitations:["observations_not_accounting_truth","matching_ids_not_financial_reconciliation","no_complete_history","no_computed_stock"] };
  const result = Object.freeze({ policyVersion:"square_verified_intelligence_snapshot_v1",scopeKey:items[0].scopeKey,
    workspaceId:items[0].scope.workspaceId,connectionId:items[0].scope.connectionId,generation:items[0].scope.generation,
    asOf,assessment,aggregateFingerprint:contractSha256(assessment),
    evidenceFingerprint:contractSha256(items.map(i=>i.fact.factFingerprint).sort()) });
  if (Buffer.byteLength(JSON.stringify(result))>SQUARE_EXPLANATION_LIMITS.maximumInputBytes) throw new Error("square_snapshot_capacity");
  // Freeze nested structures too; a caller cannot change what was verified.
  function freeze(value: unknown) { if(value && typeof value==="object") {Object.values(value).forEach(freeze);Object.freeze(value);} }
  freeze(result); snapshots.add(result); return result;
}
export type SquareVerifiedSnapshot = ReturnType<typeof squareVerifiedIntelligenceSnapshot>;
const Trigger = z.discriminatedUnion("kind",[
  z.object({kind:z.literal("user_request"),requestId:UuidSchema}).strict(),
  z.object({kind:z.literal("scheduled_brief"),requestId:UuidSchema,cadence:z.enum(["daily","weekly","monthly"])}).strict(),
  z.object({kind:z.literal("material_change"),requestId:UuidSchema,firstChangedAt:IsoTimestampSchema,
    previousAggregateFingerprint:Sha256FingerprintSchema}).strict()
]);
export type SquareExplanationLedger = { day:string; lastIssuedAt:number|null; requestIds:string[]; aggregateFingerprints:string[]; reservedOutputTokens:number;
  seenRequestIds:string[]; seenMaterialAggregates:string[] };
export function emptySquareExplanationLedger(day:string): SquareExplanationLedger {
  return {day,lastIssuedAt:null,requestIds:[],aggregateFingerprints:[],reservedOutputTokens:0,seenRequestIds:[],seenMaterialAggregates:[]};
}
/** Execute inside the same durable lock/CAS as the checked authority read. The
 * returned reservation must be committed BEFORE dispatch. Failed/uncertain model
 * calls consume their reservation; replay never dispatches a second call.
 * This module has no model client and cannot write or authorize facts. */
export function reserveSquareExplanation(snapshot: SquareVerifiedSnapshot, rawTrigger: z.infer<typeof Trigger>,
  ledger: SquareExplanationLedger, now: string) {
  if(!snapshots.has(snapshot)) throw new Error("square_snapshot_unverified");
  const trigger = Trigger.parse(rawTrigger), time=Date.parse(IsoTimestampSchema.parse(now));
  const deny=(reason:string)=>({outcome:"denied" as const,reason,modelCalls:0 as const});
  const age=time-Date.parse(snapshot.asOf);
  if(age<0 || age>300_000 || snapshot.assessment.freshness!=="observed") return deny("snapshot_stale");
  // Ledger is trusted persisted state; validate rather than reset malformed or
  // exhausted state. Day rollover keeps the cross-midnight cooldown intact.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ledger.day) || ledger.day>now.slice(0,10) ||
    !Number.isSafeInteger(ledger.reservedOutputTokens) || ledger.reservedOutputTokens<0 ||
    ledger.requestIds.length>3 || ledger.aggregateFingerprints.length>3 || ledger.seenRequestIds.length>128 || ledger.seenMaterialAggregates.length>128 ||
    ledger.reservedOutputTokens!==ledger.requestIds.length*1000 ||
    (ledger.lastIssuedAt!==null && (!Number.isSafeInteger(ledger.lastIssuedAt)||ledger.lastIssuedAt>time))) return deny("ledger_invalid");
  const next = ledger.day===now.slice(0,10) ? structuredClone(ledger) : {...emptySquareExplanationLedger(now.slice(0,10)),lastIssuedAt:ledger.lastIssuedAt,
    seenRequestIds:[...ledger.seenRequestIds],seenMaterialAggregates:[...ledger.seenMaterialAggregates]};
  if(next.seenRequestIds.includes(trigger.requestId)) return deny("duplicate_request");
  if(next.seenRequestIds.length>=128 || next.seenMaterialAggregates.length>=128) return deny("claim_capacity");
  if(next.lastIssuedAt!==null && time-next.lastIssuedAt<SQUARE_EXPLANATION_LIMITS.cooldownMs) return deny("cooldown");
  if(next.requestIds.length>=3 || next.reservedOutputTokens+1000>3000) return deny("daily_budget");
  if(trigger.kind==="material_change") {
    if(time-Date.parse(trigger.firstChangedAt)<300_000) return deny("coalescing");
    if(trigger.previousAggregateFingerprint===snapshot.aggregateFingerprint || next.seenMaterialAggregates.includes(snapshot.aggregateFingerprint)) return deny("no_new_material_aggregate");
    // v1 materiality: a changed verified descriptive status/count/reference-state
    // aggregate, not a raw record/version change. Never interpret monetary impact.
  }
  next.requestIds.push(trigger.requestId);next.aggregateFingerprints.push(snapshot.aggregateFingerprint);
  next.seenRequestIds.push(trigger.requestId);
  if(trigger.kind==="material_change")next.seenMaterialAggregates.push(snapshot.aggregateFingerprint);
  next.lastIssuedAt=time;next.reservedOutputTokens+=1000;
  return {outcome:"reserved" as const,ledger:next,reservationFingerprint:contractSha256({scope:snapshot.scopeKey,trigger,aggregate:snapshot.aggregateFingerprint}),
    maximumOutputTokens:1000,modelInput:snapshot.assessment,
    instruction:"Explain only supplied deterministic evidence. Preserve unknown history and non-economic status. Do not create, alter, reconcile or authorize facts."};
}
