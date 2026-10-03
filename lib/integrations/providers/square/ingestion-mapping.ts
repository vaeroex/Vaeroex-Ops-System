import "server-only";

import { isProxy } from "node:util/types";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, UuidSchema, type ContractJsonValue } from "@/lib/integrations/contracts/primitives";
import type { ExternalSourceRecordVersion } from "@/lib/integrations/contracts/source-facts";
import { prepareExternalSourceVersionCommit } from "@/lib/integrations/persistence/serializers";
import type { SquareCatalogValidatedResponse } from "@/lib/integrations/providers/square/catalog-response-validation";
import type { SquareMinimizedCatalogObject } from "@/lib/integrations/providers/square/catalog-responses";
import type { SquareInventoryResponse } from "@/lib/integrations/providers/square/inventory-responses";
import type { SquareOrderCoreResponse, SquareOrderLineItemResponse, SquareOrderAdjustmentResponse, SquareOrderTenderResponse, SquareMinimizedOrderCore } from "@/lib/integrations/providers/square/order-responses";
import type { SquarePaymentResponse } from "@/lib/integrations/providers/square/payment-responses";
import type { SquareRefundResponse } from "@/lib/integrations/providers/square/refund-responses";
import type {
  SquareCompletenessReason, SquareIngestionScope, SquareIngestionStream, SquareMappedPage,
  SquarePageCompleteness, SquarePendingSource, SquareProviderOrdering, SquareProviderRevision
} from "@/lib/integrations/providers/square/ingestion-contracts";

export const SQUARE_SOURCE_MAPPING_VERSION = "square_pending_source_mapping_v1" as const;
export type SquareParsedPage = SquareOrderCoreResponse | SquareOrderLineItemResponse |
  SquareOrderAdjustmentResponse | SquareOrderTenderResponse | SquarePaymentResponse |
  SquareRefundResponse | SquareCatalogValidatedResponse | SquareInventoryResponse;
type JsonObject = Record<string, ContractJsonValue>;
type Role = "primary" | "related" | "included";

// Existing guards include result wrappers: Order 60,000; Catalog 23,341;
// Inventory 19,007; Payment 20,295; Refund 20,195. Copy each root subtree once,
// never flatten nested Catalog/Order children or replicate a response per source.
// At most N=1,000 Order/Inventory, 100 Payment/Refund, or 3,000 Catalog roots.
// Each source adds <=5 containers (pending, scope, location array, revision,
// projection wrapper); the mapped page adds four. Thus the maximum conservative
// bound is Order 60,000+5*1,000+4 = 65,004 (Catalog <=38,345).
export const SQUARE_MAXIMUM_MAPPED_PAGE_CONTAINERS = 65_004;
export const SQUARE_MAXIMUM_MAPPED_PAGE_SOURCES = 3_000;
const LIMITS: Readonly<Record<SquareIngestionStream, readonly [number, number, string]>> = {
  order_core: [60_000, 1_000, "order_core_response"],
  order_line_items: [60_000, 1_000, "order_line_item_detail_response"],
  order_adjustments: [60_000, 1_000, "order_adjustment_detail_response"],
  order_tenders: [60_000, 1_000, "order_tender_detail_response"],
  payments: [20_295, 100, "payment_response"],
  refunds: [20_195, 100, "refund_response"],
  catalog: [23_341, 3_000, "catalog_response"],
  inventory: [19_007, 1_000, "inventory_response"]
};
const BASE_REASONS: readonly SquareCompletenessReason[] = [
  "history_unknown", "economic_fields_omitted", "references_unresolved",
  "eventual_consistency", "overlapping_representations"
];
const ORDER_REQUEST_KEYS = new Set(["operation", "requestAuthorityVersion", "requestAuthorityFingerprint"]);
const PENDING_KEYS = ["resourceKey", "versionKey", "scope", "stream", "providerRecordType", "providerRecordId", "providerRevision", "observedAt", "deleted", "projection"];

function fail(): never { throw new Error("square_ingestion_mapping_invalid"); }
function exactKeys(value: object, keys: readonly string[]) {
  const found = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (found.length !== expected.length || found.some((key, i) => key !== expected[i])) fail();
}

/** Descriptor-first, expanded traversal. No Proxy traps, accessor evaluation or alias discounts. */
function inspect(value: unknown, maximumContainers: number, maximumArray = 1_000, frozen = false) {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const active = new Set<object>();
  let containers = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    const current = frame.value;
    if (frame.exit) { active.delete(current as object); continue; }
    if (typeof current === "string") { if (current.length > 4_096) fail(); continue; }
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "number") { if (!Number.isSafeInteger(current) || Object.is(current, -0)) fail(); continue; }
    if (typeof current !== "object" || isProxy(current)) fail();
    if (++containers > maximumContainers || frame.depth > 38 || active.has(current)) fail();
    const proto = Object.getPrototypeOf(current);
    const array = Array.isArray(current);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail();
    if (frozen && !Object.isFrozen(current)) fail();
    const keys = Reflect.ownKeys(current);
    let children: unknown[];
    if (array) {
      const length = Object.getOwnPropertyDescriptor(current, "length");
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > maximumArray || keys.length !== length.value + 1) fail();
      children = [];
      for (let i = 0; i < length.value; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
        if (!descriptor?.enumerable || !("value" in descriptor)) fail();
        children.push(descriptor.value);
      }
    } else {
      if (keys.length > 64) fail();
      children = keys.map((key) => {
        if (typeof key !== "string" || key.length > 128 || key === "__proto__") fail();
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) fail();
        return descriptor.value;
      });
    }
    active.add(current);
    stack.push({ value: current, depth: frame.depth, exit: true });
    for (let i = children.length - 1; i >= 0; i--) stack.push({ value: children[i], depth: frame.depth + 1 });
  }
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

function checkedScope(value: SquareIngestionScope): SquareIngestionScope {
  inspect(value, 2);
  exactKeys(value, ["workspaceId", "businessEntityId", "connectionId", "sellerId", "environment", "authorizedLocationIds", "generation"]);
  for (const key of ["workspaceId", "businessEntityId", "connectionId"] as const) if (!UuidSchema.safeParse(value[key]).success) fail();
  if (typeof value.sellerId !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(value.sellerId)) fail();
  if (value.environment !== "sandbox" && value.environment !== "production") fail();
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) fail();
  if (!Array.isArray(value.authorizedLocationIds) || value.authorizedLocationIds.length < 1 || value.authorizedLocationIds.length > 1_000 || new Set(value.authorizedLocationIds).size !== value.authorizedLocationIds.length) fail();
  if (value.authorizedLocationIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(id))) fail();
  return freeze({ ...value, authorizedLocationIds: [...value.authorizedLocationIds].sort() });
}

function stableScope(scope: SquareIngestionScope) {
  return { workspaceId: scope.workspaceId, businessEntityId: scope.businessEntityId,
    connectionId: scope.connectionId, sellerId: scope.sellerId, environment: scope.environment };
}
function resourceKey(scope: SquareIngestionScope, stream: SquareIngestionStream, providerRecordType: string, providerRecordId: string) {
  return contractSha256({ purpose: "square_source_resource_identity_v1", scope: stableScope(scope), stream, providerRecordType, providerRecordId });
}
function versionKey(source: Pick<SquarePendingSource, "resourceKey" | "providerRevision" | "deleted" | "projection">) {
  return contractSha256({ purpose: "square_source_observed_version_v1", mappingVersion: SQUARE_SOURCE_MAPPING_VERSION,
    resourceKey: source.resourceKey, providerRevision: source.providerRevision, deleted: source.deleted, projection: source.projection });
}
function recordTypeValid(stream: SquareIngestionStream, recordType: string) {
  if (stream === "catalog") return /^square_catalog_(?:primary|related|included)_(?:category|item|item_variation|modifier_list|modifier|discount|tax)$/.test(recordType);
  if (stream === "inventory") return /^square_inventory_(?:count_snapshot|physical_count|adjustment)$/.test(recordType);
  return recordType === (stream === "payments" ? "square_payment" : stream === "refunds" ? "square_refund" : `square_${stream}`);
}

function completeness(stream: SquareIngestionStream, cursorPresent: boolean, blocked = false, unordered = false): SquarePageCompleteness {
  const reasons: SquareCompletenessReason[] = [...BASE_REASONS];
  if (stream.startsWith("order_")) reasons.push("returns_unknown");
  if (stream === "inventory") reasons.push("inventory_optional");
  if (cursorPresent) reasons.push("partial_page_sequence");
  if (blocked) reasons.push("unsupported_page");
  if (unordered) reasons.push("unordered_provider_revision");
  return { pageSequence: blocked ? "blocked" : cursorPresent ? "partial" : "finished", historical: "unknown", economic: "blocked", reasons: reasons.sort() };
}

// Remove only invocation-dependent fields from Order core, including the core
// nested inside richer scopes. No provider facts, references or exact strings
// are rounded, flattened, or resolved. Provenance contains only provider/API pins.
function intrinsic(value: ContractJsonValue): ContractJsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(intrinsic);
  const core = value.entityType === "order_core";
  return Object.fromEntries(Object.entries(value).filter(([key]) => !core || !ORDER_REQUEST_KEYS.has(key)).map(([key, child]) => [key, intrinsic(child)]));
}

function assertConnection(scope: SquareIngestionScope, authority: { connectionId: string; providerEntityId: string; workspaceId?: string }) {
  if (authority.connectionId !== scope.connectionId || authority.providerEntityId !== scope.sellerId || authority.workspaceId !== undefined && authority.workspaceId !== scope.workspaceId) fail();
}
function assertLocations(scope: SquareIngestionScope, ids: readonly (string | null)[]) {
  for (const id of ids) if (id !== null && !scope.authorizedLocationIds.includes(id)) fail();
}

/** Internal adapter helper: receives the VALUE of this invocation's genuine parser result, not a reusable acceptance token. */
export function mapSquareParsedPage(scopeInput: SquareIngestionScope, stream: SquareIngestionStream, value: SquareParsedPage, observedAt: string, cursorPresent: boolean): SquareMappedPage {
  const scope = checkedScope(scopeInput);
  if (!Object.hasOwn(LIMITS, stream)) fail();
  const limit = LIMITS[stream];
  if (!limit || typeof cursorPresent !== "boolean" || !timestampValid(observedAt)) fail();
  inspect(value, limit[0], 1_000, true);
  if (value.entityType !== limit[2] || value.provider.providerEnvironment !== scope.environment || value.provider.providerKey !== "square" || value.pagination.cursorPresent !== cursorPresent) fail();
  assertConnection(scope, value.connectionAuthority);
  if (stream === "catalog" && !("validationVersion" in value)) fail();
  const sources: SquarePendingSource[] = [];
  let unsupported = false;
  const append = (item: object, naturalId: string | null, providerRecordType: string, revision: SquareProviderRevision, deleted: boolean, role: Role = "primary") => {
    if (naturalId === null || naturalId.length === 0) { unsupported = true; return; }
    const data = intrinsic(item as JsonObject);
    const projection = deleted ? null : {
      mappingVersion: SQUARE_SOURCE_MAPPING_VERSION, stream, role,
      authority: "pending_provider_observation_not_economic_authority", data
    };
    const draft = { resourceKey: resourceKey(scope, stream, providerRecordType, naturalId), scope, stream,
      providerRecordType, providerRecordId: naturalId, providerRevision: revision, observedAt, deleted, projection };
    sources.push({ ...draft, versionKey: versionKey(draft) });
  };
  const order = (item: object, core: SquareMinimizedOrderCore) => {
    assertConnection(scope, core.authority);
    assertLocations(scope, [core.locationId]);
    append(item, core.id, `square_${stream}`, { version: core.providerVersion, updatedAt: core.updatedAt }, false);
  };
  switch (stream) {
    case "order_core": for (const item of (value as SquareOrderCoreResponse).items) order(item, item); break;
    case "order_line_items": for (const item of (value as SquareOrderLineItemResponse).items) order(item, item.core); break;
    case "order_adjustments": for (const item of (value as SquareOrderAdjustmentResponse).items) order(item, item.lineItemDetail.core); break;
    case "order_tenders": for (const item of (value as SquareOrderTenderResponse).items) order(item, item.adjustmentDetail.lineItemDetail.core); break;
    case "payments": for (const item of (value as SquarePaymentResponse).items) {
      assertConnection(scope, item.authority); assertLocations(scope, [item.locationId]);
      append(item, item.id, "square_payment", { version: null, updatedAt: item.updatedAt }, false);
    } break;
    case "refunds": for (const item of (value as SquareRefundResponse).items) {
      assertConnection(scope, item.authority); assertLocations(scope, [item.locationId]);
      append(item, item.id, "square_refund", { version: null, updatedAt: item.updatedAt }, false);
    } break;
    case "catalog": {
      const page = value as SquareCatalogValidatedResponse;
      const catalog = (items: readonly SquareMinimizedCatalogObject[], role: Role) => {
        for (const item of items) append(item, item.id, `square_catalog_${role}_${item.catalogObjectType.toLowerCase()}`,
          { version: item.catalogVersion, updatedAt: item.updatedAt }, item.isDeleted, role);
      };
      catalog(page.items, "primary"); catalog(page.relatedItems, "related"); catalog(page.includedItems, "included");
    } break;
    case "inventory": for (const item of (value as SquareInventoryResponse).items) {
      assertConnection(scope, item.authority); assertLocations(scope, [item.locationId, item.fromLocationId, item.toLocationId]);
      if ([item.state, item.fromState, item.toState, item.adjustmentGroup?.fromState, item.adjustmentGroup?.toState].includes("SUPPORTED_BY_NEWER_VERSION")) {
        unsupported = true; continue;
      }
      const snapshot = item.entityType === "inventory_count_snapshot";
      append(item, snapshot ? item.authority.snapshotIdentityFingerprint : item.id, `square_${item.entityType}`,
        // Event created_at/occurred_at is not a modification clock. Only count
        // snapshots supply a calculated_at observation watermark.
        { version: null, updatedAt: snapshot ? item.calculatedAt : null }, false);
    } break;
  }
  if (sources.length > limit[1]) fail();
  if (unsupported) return freeze({ sources: [], completeness: completeness(stream, cursorPresent, true) });
  if (new Set(sources.map(source => source.resourceKey)).size !== sources.length) fail();
  sources.sort((a, b) => a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0);
  const page = { sources, completeness: completeness(stream, cursorPresent, false,
    sources.some(source => source.providerRevision.version === null && source.providerRevision.updatedAt === null)) };
  inspect(page, SQUARE_MAXIMUM_MAPPED_PAGE_CONTAINERS, 3_000);
  return freeze(page);
}

function timestampValid(value: unknown): value is string {
  return typeof value === "string" && value.length <= 35 && IsoTimestampSchema.safeParse(value).success && Number.isFinite(Date.parse(value));
}
function revisionValid(value: SquareProviderRevision) {
  exactKeys(value, ["version", "updatedAt"]);
  if (value.version !== null && (typeof value.version !== "string" || !/^-?(?:0|[1-9][0-9]{0,15})$/.test(value.version) || value.version === "-0")) fail();
  if (value.updatedAt !== null && !timestampValid(value.updatedAt)) fail();
}
function compareTimestamp(left: string, right: string): number {
  // Compare the whole second plus the exact fractional digits. Date.parse alone
  // silently collapses distinct supported micro/nanosecond timestamps.
  const split = (value: string) => {
    const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) fail();
    return { second: Date.parse(match[1] + match[3]), fraction: match[2] ?? "" };
  };
  const a = split(left), b = split(right);
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  const size = Math.max(a.fraction.length, b.fraction.length);
  const af = a.fraction.padEnd(size, "0"), bf = b.fraction.padEnd(size, "0");
  return af === bf ? 0 : af < bf ? -1 : 1;
}

/** Compare NEXT against PRIOR. Equal revision but different versionKey is a repository conflict, never an overwrite. */
export function compareSquareProviderRevision(prior: SquareProviderRevision, next: SquareProviderRevision): SquareProviderOrdering {
  inspect(prior, 1); inspect(next, 1); revisionValid(prior); revisionValid(next);
  if (prior.version !== null && next.version !== null) {
    const a = BigInt(prior.version), b = BigInt(next.version);
    return a === b ? "same" : b > a ? "newer" : "older";
  }
  if (prior.version !== null || next.version !== null) return "unordered";
  if (prior.updatedAt === null || next.updatedAt === null) return "unordered";
  const comparison = compareTimestamp(next.updatedAt, prior.updatedAt);
  return comparison === 0 ? "same" : comparison > 0 ? "newer" : "older";
}

/** Integrity check for the injected repository; not authentication, registration, or SQL write authority. */
export function assertSquarePendingSource(pending: SquarePendingSource): SquarePendingSource {
  inspect(pending, 60_005);
  exactKeys(pending, PENDING_KEYS);
  const scope = checkedScope(pending.scope);
  if (!Object.hasOwn(LIMITS, pending.stream)) fail();
  revisionValid(pending.providerRevision);
  if (typeof pending.providerRecordType !== "string" || !recordTypeValid(pending.stream, pending.providerRecordType)) fail();
  if (typeof pending.providerRecordId !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(pending.providerRecordId)) fail();
  if (!timestampValid(pending.observedAt) || typeof pending.deleted !== "boolean" || (pending.projection === null) !== pending.deleted) fail();
  if (pending.deleted && pending.stream !== "catalog") fail();
  if (pending.projection !== null) {
    exactKeys(pending.projection, ["mappingVersion", "stream", "role", "authority", "data"]);
    if (pending.projection.mappingVersion !== SQUARE_SOURCE_MAPPING_VERSION || pending.projection.stream !== pending.stream ||
      !["primary", "related", "included"].includes(pending.projection.role as string) || pending.projection.authority !== "pending_provider_observation_not_economic_authority" ||
      pending.projection.data === null || Array.isArray(pending.projection.data) || typeof pending.projection.data !== "object") fail();
    if (pending.stream !== "catalog" && pending.projection.role !== "primary") fail();
    if (pending.stream === "catalog") {
      const data = pending.projection.data as JsonObject;
      if (typeof data.catalogObjectType !== "string" || pending.providerRecordType !== `square_catalog_${pending.projection.role}_${data.catalogObjectType.toLowerCase()}` || data.id !== pending.providerRecordId || data.isDeleted !== false) fail();
    }
  }
  if (pending.resourceKey !== resourceKey(scope, pending.stream, pending.providerRecordType, pending.providerRecordId) || pending.versionKey !== versionKey(pending)) fail();
  return pending;
}

/** Generic envelope only. Current registry and checked database source RPCs still reject Square. */
export function materializeSquarePendingSource(pending: SquarePendingSource, ordinal: number, priorId: string | null): ExternalSourceRecordVersion {
  assertSquarePendingSource(pending);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || (ordinal === 1) !== (priorId === null) || priorId !== null && !UuidSchema.safeParse(priorId).success) fail();
  const hex = pending.versionKey.slice("sha256:".length);
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const materialized = prepareExternalSourceVersionCommit({
    contractVersion: "external_source_record_version_v1", id,
    workspaceId: pending.scope.workspaceId, businessEntityId: pending.scope.businessEntityId, connectionId: pending.scope.connectionId,
    immutableVersion: ordinal, priorVersionId: priorId, recordKind: pending.providerRecordType,
    source: { kind: "provider", providerKey: "square", providerRecordType: pending.providerRecordType,
      // Generic identifiers are bounded at128; real Square IDs may reach255.
      // Use the scoped identity digest without truncating the retained natural ID.
      providerRecordId: pending.resourceKey, providerVersionReference: pending.providerRevision.version === null ? null : `square_version/${pending.providerRevision.version}` },
    temporal: { basis: "point_in_time", providerCreatedAt: null, providerUpdatedAt: pending.providerRevision.updatedAt,
      observedAt: pending.observedAt, synchronizedAt: pending.observedAt, ingestedAt: pending.observedAt,
      effectiveAt: null, postingDate: null, periodStart: null, periodEnd: null, sourceTimeZone: null },
    accounting: { basis: "unknown", currency: null }, normalizedSchemaVersion: SQUARE_SOURCE_MAPPING_VERSION,
    changeKind: pending.deleted ? "deleted" : ordinal === 1 ? "created" : "updated",
    normalizedProjection: pending.projection, trust: "untrusted_external_input",
    validation: { state: "pending", validatorVersion: SQUARE_SOURCE_MAPPING_VERSION, issues: [] }, receivedAt: pending.observedAt
  }).version;
  return freeze(materialized);
}
