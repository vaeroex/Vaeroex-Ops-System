import "server-only";

import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { prepareCanonicalFactVersionCommit } from "@/lib/integrations/persistence/serializers";
import { prepareSquareObservationAdmission } from "@/lib/integrations/providers/square/observation-admission";
import { SquareMinimizedPaymentSchema } from "@/lib/integrations/providers/square/payment-responses";
import { SquareMinimizedPaymentRefundSchema } from "@/lib/integrations/providers/square/refund-responses";
import { SquareMinimizedInventoryRecordSchema } from "@/lib/integrations/providers/square/inventory-responses";
import { SquareMinimizedCatalogItemVariationSchema } from "@/lib/integrations/providers/square/catalog-responses";
import { SquareMinimizedOrderCoreSchema, SquareOrderTenderSchema } from "@/lib/integrations/providers/square/order-responses";

export const SQUARE_INTERPRETATION_POLICY = "square_canonical_interpretation_v1" as const;
export const SQUARE_RECONCILIATION_POLICY = "square_observed_relationships_v1" as const;
export const SquareInterpretationContextSchema = z.object({
  workspaceId: UuidSchema, businessEntityId: UuidSchema, connectionId: UuidSchema,
  sellerId: z.string().min(1).max(255), environment: z.literal("sandbox"),
  generation: z.number().int().positive().safe(), authorizedLocationIds: z.array(z.string().min(1).max(255)).min(1).max(1000),
  authority: z.enum(["active", "revoked", "disconnected"]), asOf: IsoTimestampSchema,
  freshness: z.enum(["observed", "stale", "unknown"]),
  scan: z.enum(["exhausted", "partial", "interrupted", "unavailable", "unknown"])
}).strict();
export type SquareInterpretationContext = z.infer<typeof SquareInterpretationContextSchema>;
export type SquareObservationInput = Parameters<typeof prepareSquareObservationAdmission>[0];
type Money = { amountMinor: string | null; currency: string | null };
type Reference = { kind: "payment" | "order" | "catalog"; providerId: string; reason: string };
const interpretations = new WeakSet<object>();
const Core = SquareMinimizedOrderCoreSchema.omit({ operation: true, requestAuthorityVersion: true, requestAuthorityFingerprint: true });
const Order = z.object({ adjustmentDetail: z.object({ lineItemDetail: z.object({ core: Core }).passthrough() }).passthrough(),
  tenders: z.array(SquareOrderTenderSchema).max(1000) }).passthrough();
function denied(): never { throw new Error("square_interpretation_denied"); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function squareInterpretationId(value: unknown) {
  const h = contractSha256(value).slice(7);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Pure derivation, NOT caller authentication. Only a transactionally checked
 * repository may supply currentAuthority/context. No provider or model client. */
export function interpretSquareObservation(input: SquareObservationInput, rawContext: SquareInterpretationContext) {
  const context = SquareInterpretationContextSchema.parse(rawContext);
  const admitted = prepareSquareObservationAdmission(input);
  const scope = input.pending.scope;
  if (["workspaceId", "businessEntityId", "connectionId", "sellerId", "environment", "generation"].some(
    key => scope[key as keyof typeof scope] !== context[key as keyof typeof context]) ||
    contractSha256([...scope.authorizedLocationIds].sort()) !== contractSha256([...context.authorizedLocationIds].sort()) ||
    new Set(context.authorizedLocationIds).size !== context.authorizedLocationIds.length) denied();
  const exclusion = (reason: string) => frozen({ outcome: "excluded" as const, resourceKey: input.pending.resourceKey, reason });
  if (context.authority !== "active") return exclusion(context.authority);
  if (admitted.outcome !== "admitted") return exclusion(admitted.reason);
  if (Date.parse(input.pending.observedAt) > Date.parse(context.asOf)) return exclusion("future_observation");
  const data = input.pending.projection!.data;
  let kind: "payment" | "refund" | "order" | "catalog" | "inventory";
  let status: string | null = null, locationId: string | null = null;
  let money: Record<string, Money | null> = {}, quantity: string | null = null;
  let timestamps: Record<string, string | null> = {};
  let references: Reference[] = [], applicableLocationIds: string[] = [];
  let units: unknown = null, detail: unknown = null;
  let meaning: string, unlinked = false;
  const type = input.pending.providerRecordType;
  if (type === "square_payment") {
    const p = SquareMinimizedPaymentSchema.parse(data); kind = "payment";
    status = p.status; locationId = p.locationId;
    money = { amount: p.amountMoney, tip: p.tipMoney, total: p.totalMoney, providerRefundedAggregate: p.refundedMoney };
    timestamps = { createdAt: p.createdAt, updatedAt: p.updatedAt };
    if (p.orderReference) references.push({ kind: "order", providerId: p.orderReference.providerId, reason: "payment_order_id" });
    meaning = ({ APPROVED: "provider_approved_not_completed", PENDING: "provider_pending", COMPLETED: "provider_completed_not_revenue",
      CANCELED: "provider_canceled", FAILED: "provider_failed" } as Record<string, string>)[status ?? ""] ?? "unknown";
  } else if (type === "square_refund") {
    const p = SquareMinimizedPaymentRefundSchema.parse(data); kind = "refund";
    status = p.status; locationId = p.locationId; money = { amount: p.amountMoney };
    timestamps = { createdAt: p.createdAt, updatedAt: p.updatedAt }; unlinked = p.unlinked === true;
    if (p.paymentReference) references.push({ kind: "payment", providerId: p.paymentReference.providerId, reason: "refund_payment_id" });
    if (p.orderReference) references.push({ kind: "order", providerId: p.orderReference.providerId, reason: "refund_order_id" });
    meaning = ({ PENDING: "provider_pending", COMPLETED: "provider_completed_refund_not_netting", REJECTED: "provider_rejected", FAILED: "provider_failed" } as Record<string, string>)[status ?? ""] ?? "unknown";
  } else if (type === "square_order_tenders") {
    const p = Order.parse(data), core = p.adjustmentDetail.lineItemDetail.core; kind = "order";
    status = core.state; locationId = core.locationId; money = { total: core.totalMoney, netAmountDue: core.netAmountDueMoney };
    timestamps = { createdAt: core.createdAt, updatedAt: core.updatedAt, closedAt: core.closedAt };
    references = p.tenders.flatMap(t => t.paymentReference ? [{ kind: "payment" as const, providerId: t.paymentReference.providerId, reason: "tender_payment_id" }] : []);
    meaning = status === null ? "unknown" : `provider_order_${status.toLowerCase()}_not_revenue`;
  } else if (type === "square_catalog_primary_item_variation") {
    const p = SquareMinimizedCatalogItemVariationSchema.parse(data); kind = "catalog";
    money = { listedPrice: p.price }; timestamps = { updatedAt: p.updatedAt };
    applicableLocationIds = context.authorizedLocationIds.filter(id => p.availability.mode === "specific_locations"
      ? p.availability.presentLocationIds.includes(id) : !p.availability.absentLocationIds.includes(id)).sort();
    detail = { availability: p.availability, displayName: p.displayName, sku: p.sku,
      trackInventory: p.trackInventory, sellable: p.sellable, stockable: p.stockable };
    meaning = "seller_catalog_with_location_applicability_not_stock";
  } else {
    const p = SquareMinimizedInventoryRecordSchema.parse(data); kind = "inventory";
    status = p.state; locationId = p.locationId; quantity = p.quantity;
    money = { cost: p.costMoney, totalPrice: p.totalPriceMoney };
    timestamps = { calculatedAt: p.calculatedAt, occurredAt: p.occurredAt, createdAt: p.createdAt };
    units = { measurement: p.measurement, reference: p.measurementUnitReference, resolution: "unverified" };
    detail = { entityType: p.entityType, fromState: p.fromState, toState: p.toState, fromLocationId: p.fromLocationId,
      toLocationId: p.toLocationId, isEstimated: p.isEstimated };
    if (p.catalogReference) references.push({ kind: "catalog", providerId: p.catalogReference.providerId, reason: "inventory_catalog_id" });
    meaning = `${p.entityType}_not_computed_stock`;
    for (const id of [p.fromLocationId, p.toLocationId]) if (id && !context.authorizedLocationIds.includes(id)) denied();
  }
  if (locationId && !context.authorizedLocationIds.includes(locationId)) denied();
  if (kind !== "catalog" && locationId) applicableLocationIds = [locationId];
  const currencies = [...new Set(Object.values(money).flatMap(m => m?.currency ? [m.currency] : []))].sort();
  const scopeKey = contractSha256({ workspaceId: scope.workspaceId, businessEntityId: scope.businessEntityId,
    connectionId: scope.connectionId, sellerId: scope.sellerId, environment: scope.environment, generation: scope.generation });
  const semantic = { policyVersion: SQUARE_INTERPRETATION_POLICY, classification: "verified_provider_interpretation", kind,
    providerRecordType: type, providerId: input.pending.providerRecordId, scope, scopeKey, locationId, applicableLocationIds,
    status, meaning, money, currencies, quantity, units, detail, timestamps, unlinked,
    references: [...new Map(references.map(r => [contractSha256(r), r])).values()].sort((a, b) => compare(contractSha256(a), contractSha256(b))),
    providerRevision: input.pending.providerRevision, resourceKey: input.pending.resourceKey, versionKey: input.pending.versionKey,
    observationFactId: admitted.fact.id, observationFingerprint: admitted.fact.factFingerprint,
    economic: "blocked", historical: "unknown",
    rationale: ["current_checked_source_version", "provider_status_not_accounting_truth", "no_completeness_inference"] };
  const fact = prepareCanonicalFactVersionCommit({ ...admitted.fact, factFingerprint: undefined,
    id: squareInterpretationId({ policy: SQUARE_INTERPRETATION_POLICY, version: input.pending.versionKey, semantic }),
    factKey: contractSha256({ policy: SQUARE_INTERPRETATION_POLICY, resourceKey: input.pending.resourceKey }),
    factKind: `${type}_interpretation`, value: { kind: "structured", value: JSON.parse(JSON.stringify(semantic)) },
    transformationVersion: SQUARE_INTERPRETATION_POLICY,
    decision: { ...admitted.fact.decision, policyVersion: SQUARE_INTERPRETATION_POLICY, reasonCodes: semantic.rationale }
  }).version;
  const result = frozen({ outcome: "interpreted" as const, ...semantic, freshness: context.freshness, scan: context.scan, fact });
  interpretations.add(result);
  return result;
}
export type SquareInterpretation = Extract<ReturnType<typeof interpretSquareObservation>, { outcome: "interpreted" }>;
export function assertSquareInterpretation(value: SquareInterpretation) {
  if (!interpretations.has(value)) denied();
  return value;
}

/** Links attest only to matching observed provider identifiers; never balances,
 * settlement, fulfillment, inventory movement or economic equivalence. */
export function reconcileSquareInterpretations(items: readonly SquareInterpretation[]) {
  if (items.length > 1000) denied();
  items.forEach(assertSquareInterpretation);
  if (items.reduce((n,item)=>n+item.references.length,0)>20_000) denied();
  const scopeKeys = new Set(items.map(i => i.scopeKey)); if (scopeKeys.size > 1) denied();
  const unique = new Map<string, SquareInterpretation>();
  for (const item of items) {
    const previous = unique.get(item.resourceKey);
    if (previous && (previous.fact.factFingerprint !== item.fact.factFingerprint || previous.freshness !== item.freshness || previous.scan !== item.scan)) denied();
    unique.set(item.resourceKey, item);
  }
  const nodes = [...unique.values()].sort((a, b) => compare(a.resourceKey, b.resourceKey));
  const index = new Map(nodes.map(n => [`${n.kind}/${n.providerId}`, n]));
  const links = nodes.flatMap(from => from.references.map(reference => {
    const to = index.get(`${reference.kind}/${reference.providerId}`);
    let state = "target_unobserved";
    if (from.unlinked) state = "explicitly_unlinked";
    else if (to) {
      if (from.freshness !== "observed" || to.freshness !== "observed") state = "stale_or_unknown";
      else if (!from.locationId || (to.kind !== "catalog" && !to.locationId)) state = "location_unknown";
      else if (!to.applicableLocationIds.includes(from.locationId)) state = "location_mismatch";
      else if (from.currencies.length > 1 || to.currencies.length > 1 || (from.currencies.length && to.currencies.length && from.currencies[0] !== to.currencies[0])) state = "currency_mismatch";
      else state = "observed_id_match";
      if (state === "observed_id_match" && to.kind === "payment") {
        const paymentOrder = to.references.find(r=>r.kind === "order")?.providerId;
        const claimedOrder = from.kind === "order" ? from.providerId : from.references.find(r=>r.kind === "order")?.providerId;
        if (paymentOrder && claimedOrder && paymentOrder !== claimedOrder) state = "reference_conflict";
      }
    }
    const evidence = { policyVersion: SQUARE_RECONCILIATION_POLICY, fromFactId: from.fact.id,
      fromFingerprint: from.fact.factFingerprint, targetKind: reference.kind, targetProviderId: reference.providerId,
      toFactId: to?.fact.id ?? null, toFingerprint: to?.fact.factFingerprint ?? null, state,
      rationale: reference.reason, economic: "blocked", historical: "unknown" };
    return { ...evidence, relationshipFingerprint: contractSha256(evidence) };
  })).sort((a, b) => compare(a.relationshipFingerprint, b.relationshipFingerprint));
  return frozen({ policyVersion: SQUARE_RECONCILIATION_POLICY, links, economic: "blocked" as const, historical: "unknown" as const,
    fingerprint: contractSha256({ policy: SQUARE_RECONCILIATION_POLICY, links }) });
}
