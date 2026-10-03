import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { CanonicalIntegerSchema, IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { SQUARE_API_VERSION, SQUARE_ENVIRONMENTS, SQUARE_PROVIDER_KEY, SQUARE_ALLOWED_INVENTORY_STATES } from "@/lib/integrations/providers/square/contracts";
import { assertSquareReadOperation } from "@/lib/integrations/providers/square/request-validators";
import { SquareOrderMeasurementUnitSchema } from "@/lib/integrations/providers/square/order-responses";
import {
  SquareCurrencyCodeSchema, SquareProviderEnvironmentSchema, SquareResponseProvenanceSchema,
  type SquareResponseFailureResult, type SquareResponseParserInput, type SquareResponseParserResult,
  type SquareResponseProvenance, type SquareSafeJsonObject,
  squareAcceptedResult, squareFailureResult, squareMinimizedProjectionFingerprint,
  squareOptionalNullableCurrencyCode, squareOptionalNullableTimestamp, squareRejectResponse,
  squareResponseParserInput, squareResponseProvenance, squareSafeJsonObject, squareUnsupportedResult
} from "@/lib/integrations/providers/square/response-validation";

export const SQUARE_INVENTORY_RESPONSE_CONTRACT_VERSION = "square_inventory_response_v1" as const;
export const SQUARE_INVENTORY_MINIMIZATION_VERSION = "square_inventory_minimizer_v1" as const;
export const SQUARE_INVENTORY_REQUEST_AUTHORITY_VERSION = "square_inventory_request_authority_v1" as const;
export const SQUARE_INVENTORY_RESPONSE_SDK_VERSION = "45.1.0" as const;
export const SQUARE_INVENTORY_RESPONSE_SDK_REVISION = "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76" as const;
export const SQUARE_INVENTORY_RESPONSE_OFFICIAL_REFERENCES = Object.freeze([
  "https://developer.squareup.com/reference/square/objects/InventoryCount",
  "https://developer.squareup.com/reference/square/objects/InventoryAdjustment",
  "https://developer.squareup.com/reference/square/objects/InventoryPhysicalCount",
  "https://developer.squareup.com/reference/square/objects/InventoryChange",
  "https://developer.squareup.com/reference/square/objects/Money",
  "https://developer.squareup.com/reference/square/objects/CatalogMeasurementUnit",
  "https://developer.squareup.com/reference/square/objects/MeasurementUnit",
  "https://developer.squareup.com/reference/square/inventory-api/RetrieveInventoryCount",
  "https://developer.squareup.com/reference/square/inventory-api/retrieve-inventory-adjustment",
  "https://developer.squareup.com/reference/square/inventory-api/retrieve-inventory-physical-count",
  "https://developer.squareup.com/reference/square/inventory-api/batch-retrieve-inventory-counts",
  "https://developer.squareup.com/reference/square/inventory/BatchRetrieveInventoryChanges",
  ...["api", "serialization"].flatMap((directory) => [
    "InventoryCount", "InventoryAdjustment", "InventoryPhysicalCount", "InventoryChange", "InventoryState", "InventoryChangeType",
    "GetInventoryCountResponse", "GetInventoryAdjustmentResponse", "GetInventoryPhysicalCountResponse",
    "BatchGetInventoryCountsResponse", "BatchGetInventoryChangesResponse", "CatalogMeasurementUnit", "MeasurementUnit",
    "InventoryAdjustmentGroup", "InventoryAdjustmentReasonId", "InventoryAdjustmentReasonIdType"
  ].map((name) => "https://github.com/square/square-nodejs-sdk/blob/" + SQUARE_INVENTORY_RESPONSE_SDK_REVISION + "/src/" + directory + "/types/" + name + ".ts"))
]);
export const SQUARE_INVENTORY_RESPONSE_OPERATION_KEYS = Object.freeze([
  "retrieve_inventory_count", "retrieve_inventory_adjustment", "retrieve_inventory_physical_count",
  "inventory_counts_batch_retrieve", "inventory_changes_batch_retrieve"
] as const);
// UNTRACKED is a pinned response enum, not an expansion of the existing request allowlist.
export const SQUARE_INVENTORY_RESPONSE_STATES = Object.freeze([...SQUARE_ALLOWED_INVENTORY_STATES, "UNTRACKED"] as const);
export const SQUARE_INVENTORY_REASON_TYPES = Object.freeze([
  "RECEIVED", "DAMAGED", "THEFT", "LOST", "RETURNED", "SPOILAGE_WASTE", "SAMPLES_PROMOTIONAL",
  "INTERNAL_USE", "VENDOR_RETURN", "PRODUCTION_WASTE", "SALE", "RECOUNT", "TRANSFER", "IN_TRANSIT", "CANCELED_SALE", "CUSTOM"
] as const);
// Upfront finite-schema proof in docs/architecture/square-inventory-response-contract.md:
// result/diagnostics/response/provider/connection/pagination/items = 7.
// Each snapshot <=4; physical count <=9; adjustment <=19 containers (including all
// references, both Money, group, reason, measurement wrapper/unit/custom). P<=1,000.
// The independent 20,000 expanded raw-value budget can only reduce this ceiling.
export const SQUARE_INVENTORY_MAXIMUM_RESULT_CONTAINERS = 19_007;
const MAXIMUM_FROZEN_RESULT_NODES = SQUARE_INVENTORY_MAXIMUM_RESULT_CONTAINERS;
const MAXIMUM_FROZEN_RESULT_DEPTH = 32;
const MAXIMUM_FROZEN_RESULT_ARRAY_LENGTH = 1_000;
const MAXIMUM_FROZEN_RESULT_OBJECT_PROPERTIES = 64;
const MAXIMUM_FROZEN_RESULT_STRING_LENGTH = 4_096;
const MAXIMUM_RESULT_DIAGNOSTICS = 100;
const MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH = 80;
const IdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const LegacyIdSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/);
const QuantitySchema = z.string().min(1).max(26).regex(/^-?[0-9]+(?:\.[0-9]{1,5})?$/);
const StateSchema = z.enum(SQUARE_INVENTORY_RESPONSE_STATES);
const OperationSchema = z.enum(SQUARE_INVENTORY_RESPONSE_OPERATION_KEYS);
const EntitySchema = z.enum(["inventory_count_snapshot", "inventory_physical_count", "inventory_adjustment"]);
const CursorPattern = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const safeIntegerText = (value: string) => {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const maximum = String(Number.MAX_SAFE_INTEGER);
  return unsigned.length < maximum.length || (unsigned.length === maximum.length && unsigned <= maximum);
};
export const SquareInventoryMoneySchema = z.object({
  amountMinor: CanonicalIntegerSchema.refine((value) => !value.startsWith("-") && safeIntegerText(value)).nullable(),
  currency: SquareCurrencyCodeSchema.nullable()
}).strict();
export const SquareInventoryConnectionAuthoritySchema = z.object({
  workspaceId: UuidSchema, connectionId: UuidSchema,
  providerEntityType: z.literal("merchant"), providerEntityId: IdSchema
}).strict();
const AuthoritySchema = SquareInventoryConnectionAuthoritySchema.extend({
  providerKey: z.literal(SQUARE_PROVIDER_KEY), providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: EntitySchema, identityState: z.enum(["provider_id", "provider_snapshot_composite"]),
  providerId: IdSchema.nullable(), snapshotIdentityFingerprint: Sha256FingerprintSchema.nullable(),
  locationId: IdSchema.nullable(), fromLocationId: IdSchema.nullable(), toLocationId: IdSchema.nullable()
}).strict();
export const SquareInventoryReferenceSchema = z.object({
  referenceType: z.literal("unverified_inventory_relationship"),
  providerKey: z.literal(SQUARE_PROVIDER_KEY), providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.enum(["catalog_object", "legacy_transaction", "legacy_refund", "purchase_order",
    "goods_receipt", "inventory_physical_count", "inventory_adjustment", "inventory_adjustment_reason", "catalog_measurement_unit"]),
  providerId: LegacyIdSchema
}).strict();
const MeasurementSchema = z.object({
  precision: z.number().int().min(0).max(5).nullable(),
  measurementUnit: SquareOrderMeasurementUnitSchema.nullable()
}).strict();
const GroupSchema = z.object({
  id: IdSchema.nullable(), rootAdjustmentReference: SquareInventoryReferenceSchema.nullable(),
  fromState: StateSchema.nullable(), toState: StateSchema.nullable()
}).strict();
const ReasonSchema = z.object({
  type: z.enum(SQUARE_INVENTORY_REASON_TYPES), customReasonReference: SquareInventoryReferenceSchema.nullable()
}).strict();
export const SquareMinimizedInventoryRecordSchema = z.object({
  contractVersion: z.literal(SQUARE_INVENTORY_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_INVENTORY_MINIMIZATION_VERSION),
  entityType: EntitySchema, entityVersion: z.literal(1),
  projectionScope: z.literal("provider_inventory_source_facts_only"),
  provider: SquareResponseProvenanceSchema, authority: AuthoritySchema,
  id: IdSchema.nullable(), catalogReference: SquareInventoryReferenceSchema.nullable(),
  catalogObjectType: z.enum(["ITEM", "ITEM_VARIATION"]).nullable(),
  state: StateSchema.nullable(), fromState: StateSchema.nullable(), toState: StateSchema.nullable(),
  locationId: IdSchema.nullable(), fromLocationId: IdSchema.nullable(), toLocationId: IdSchema.nullable(),
  quantity: QuantitySchema.nullable(), calculatedAt: IsoTimestampSchema.max(34).nullable(),
  occurredAt: IsoTimestampSchema.max(34).nullable(), createdAt: IsoTimestampSchema.max(34).nullable(),
  isEstimated: z.boolean().nullable(),
  totalPriceMoney: SquareInventoryMoneySchema.nullable(), costMoney: SquareInventoryMoneySchema.nullable(),
  transactionReference: SquareInventoryReferenceSchema.nullable(), refundReference: SquareInventoryReferenceSchema.nullable(),
  purchaseOrderReference: SquareInventoryReferenceSchema.nullable(), goodsReceiptReference: SquareInventoryReferenceSchema.nullable(),
  physicalCountReference: SquareInventoryReferenceSchema.nullable(), adjustmentReference: SquareInventoryReferenceSchema.nullable(),
  adjustmentGroup: GroupSchema.nullable(), reason: ReasonSchema.nullable(),
  measurement: MeasurementSchema.nullable(), measurementUnitReference: SquareInventoryReferenceSchema.nullable(),
  inventorySemantics: z.literal("provider_record_not_stock_movement_valuation_or_accounting")
}).strict();
export const SquareInventoryResponseSchema = z.object({
  contractVersion: z.literal(SQUARE_INVENTORY_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_INVENTORY_MINIMIZATION_VERSION),
  entityType: z.literal("inventory_response"), operation: OperationSchema,
  provider: SquareResponseProvenanceSchema, connectionAuthority: SquareInventoryConnectionAuthoritySchema,
  requestAuthorityVersion: z.literal(SQUARE_INVENTORY_REQUEST_AUTHORITY_VERSION),
  requestAuthorityFingerprint: Sha256FingerprintSchema, requestFingerprint: Sha256FingerprintSchema,
  cursorBindingFingerprint: Sha256FingerprintSchema,
  historyScope: z.literal("response_page_not_complete_inventory_or_history"),
  pagination: z.object({ cursorPresent: z.boolean(), cursorFingerprint: Sha256FingerprintSchema.nullable() }).strict(),
  items: z.array(SquareMinimizedInventoryRecordSchema).max(1_000), itemCount: z.number().int().min(0).max(1_000)
}).strict();
export type SquareInventoryResponseOperation = z.infer<typeof OperationSchema>;
export type SquareMinimizedInventoryRecord = Readonly<z.infer<typeof SquareMinimizedInventoryRecordSchema>>;
export type SquareInventoryResponse = Readonly<z.infer<typeof SquareInventoryResponseSchema>>;
type ConnectionAuthority = z.infer<typeof SquareInventoryConnectionAuthoritySchema>;
type SquareInventoryAcceptedResultFactory<T> = (value: T) => SquareResponseParserResult<T>;
type ReferenceEntity = z.infer<typeof SquareInventoryReferenceSchema>["entityType"];
type Policy = Readonly<{
  authorizedLocationIds: ReadonlySet<string>; requestedLocationIds: ReadonlySet<string> | null;
  requestedCatalogIds: ReadonlySet<string> | null; requestedId: string | null;
  requestedTypes: ReadonlySet<string> | null; maximumItems: number;
  requestAuthorityFingerprint: string; requestFingerprint: string; cursorBindingFingerprint: string;
}>;
const SQUARE_INVENTORY_DIAGNOSTIC_CODES = new Set([
  "square_api_version_incompatible", "square_currency_invalid", "square_identifier_invalid",
  "square_parser_input_invalid", "square_provider_environment_invalid", "square_provider_key_invalid",
  "square_required_field_missing", "square_timestamp_invalid", "square_response_accessor_rejected",
  "square_response_array_custom_property", "square_response_array_sparse", "square_response_array_too_large",
  "square_response_cyclic", "square_response_internal_rejection", "square_response_json_type_invalid",
  "square_response_key_invalid", "square_response_nesting_too_deep", "square_response_number_invalid",
  "square_response_object_expected", "square_response_object_too_large", "square_response_string_invalid",
  "square_response_symbol_key_rejected", "square_response_too_many_values", "square_response_unexpected_prototype",
  "square_inventory_input_invalid", "square_inventory_raw_tree_invalid", "square_inventory_request_invalid",
  "square_inventory_enum_invalid", "square_inventory_enum_unsupported", "square_inventory_money_invalid",
  "square_inventory_quantity_invalid", "square_inventory_measurement_invalid", "square_inventory_boolean_invalid",
  "square_inventory_identity_request_mismatch", "square_inventory_location_authority_mismatch",
  "square_inventory_location_request_mismatch", "square_inventory_envelope_operation_mismatch",
  "square_inventory_response_missing", "square_inventory_array_invalid", "square_inventory_duplicate_identity",
  "square_inventory_provider_errors_invalid", "square_inventory_provider_errors_present",
  "square_inventory_cursor_invalid", "square_inventory_change_unsupported", "square_inventory_reason_invalid"
]);
const SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT = Object.freeze({
  outcome: "rejected" as const,
  diagnostics: Object.freeze([Object.freeze({ code: "square_response_internal_rejection", field: "$response" })])
}) satisfies SquareResponseFailureResult;

export function parseSquareInventoryResponse(input: unknown): SquareResponseParserResult<SquareInventoryResponse> {
  return squareInventoryResultBoundary((accept) => parseInventory(input, accept), SquareInventoryResponseSchema);
}
function parseInventory(input: unknown, acceptedResult: SquareInventoryAcceptedResultFactory<SquareInventoryResponse>): SquareResponseParserResult<SquareInventoryResponse> {
  try {
    if (!squareInventoryHasExactDataProperties(input, ["providerKey", "providerEnvironment", "apiVersion", "operation", "connectionAuthority", "requestContext", "response"])) {
      squareRejectResponse("square_inventory_input_invalid", "$input");
    }
    const base = squareResponseParserInput(input);
    const operationValue = squareInventoryDataProperty(input, "operation");
    if (typeof operationValue !== "string") squareRejectResponse("square_inventory_input_invalid", "$input");
    const operation = OperationSchema.parse(operationValue);
    const connection = SquareInventoryConnectionAuthoritySchema.parse(inventorySafeObject(squareInventoryDataProperty(input, "connectionAuthority"), "$input"));
    const policy = requestPolicy(operation, inventorySafeObject(squareInventoryDataProperty(input, "requestContext"), "$input"), base, connection);
    const provider = squareResponseProvenance(base);
    const response = inventorySafeObject(base.response, "$response");
    if (objectArray(response, "errors", 100).length) throw new SquareInventoryUnsupportedProjectionFailure("square_inventory_provider_errors_present", "$response");
    const field = operation === "retrieve_inventory_adjustment" ? "adjustment"
      : operation === "retrieve_inventory_physical_count" ? "count"
      : operation === "inventory_changes_batch_retrieve" ? "changes" : "counts";
    const paginated = field === "counts" || field === "changes";
    // Recognizable envelopes from another operation cannot become an empty
    // terminal page. Unrelated extension metadata is still minimized away.
    const forbidden = [
      "counts", "count", "changes", "adjustment", "transfer",
      "object", "objects", "related_objects", "included_resources", "latest_time",
      "order", "orders", "payment", "payments", "refund", "refunds",
      "merchant", "merchants", "location", "locations"
    ].filter((key) => key !== field);
    if (forbidden.some((key) => Object.hasOwn(response, key)) || (!paginated && Object.hasOwn(response, "cursor"))) {
      squareRejectResponse("square_inventory_envelope_operation_mismatch", "$response");
    }
    let rawItems: readonly SquareSafeJsonObject[];
    if (paginated) rawItems = objectArray(response, field, policy.maximumItems);
    else {
      if (response[field] == null) squareRejectResponse("square_inventory_response_missing", "$response");
      rawItems = [squareSafeJsonObject(response[field])];
    }
    const seen = new Set<string>();
    const entries = rawItems.map((raw) => {
      let kind: z.infer<typeof EntitySchema>;
      let detail = raw;
      let wrapper: SquareSafeJsonObject | null = null;
      if (field === "changes") {
        const type = enumeration(raw, "type", ["ADJUSTMENT", "PHYSICAL_COUNT"] as const);
        if (type === null || raw.transfer != null) throw new SquareInventoryUnsupportedProjectionFailure("square_inventory_change_unsupported", "$response");
        if (policy.requestedTypes !== null && !policy.requestedTypes.has(type)) squareRejectResponse("square_inventory_identity_request_mismatch", "$response");
        const payload = type === "ADJUSTMENT" ? "adjustment" : "physical_count";
        const other = type === "ADJUSTMENT" ? "physical_count" : "adjustment";
        if (raw[payload] == null || raw[other] != null) squareRejectResponse("square_inventory_envelope_operation_mismatch", "$response");
        detail = squareSafeJsonObject(raw[payload]);
        wrapper = raw;
        kind = type === "ADJUSTMENT" ? "inventory_adjustment" : "inventory_physical_count";
      } else kind = field === "counts" ? "inventory_count_snapshot" : field === "count" ? "inventory_physical_count" : "inventory_adjustment";
      const item = minimize(detail, kind, wrapper, provider, connection, policy);
      const identity = item.entityType + ":" + (item.id ?? item.authority.snapshotIdentityFingerprint);
      if (seen.has(identity)) squareRejectResponse("square_inventory_duplicate_identity", "$response");
      seen.add(identity);
      return { identity, item };
    });
    entries.sort((a, b) => compareStrings(a.identity, b.identity));
    const cursor = paginated ? responseCursor(response) : null;
    const items = entries.map(({ item }) => item);
    return acceptedResult(SquareInventoryResponseSchema.parse({
      contractVersion: SQUARE_INVENTORY_RESPONSE_CONTRACT_VERSION, minimizationVersion: SQUARE_INVENTORY_MINIMIZATION_VERSION,
      entityType: "inventory_response", operation, provider, connectionAuthority: connection,
      requestAuthorityVersion: SQUARE_INVENTORY_REQUEST_AUTHORITY_VERSION,
      requestAuthorityFingerprint: policy.requestAuthorityFingerprint, requestFingerprint: policy.requestFingerprint,
      cursorBindingFingerprint: policy.cursorBindingFingerprint,
      historyScope: "response_page_not_complete_inventory_or_history",
      pagination: { cursorPresent: cursor !== null, cursorFingerprint: cursor === null ? null : cursorFingerprint(policy.requestAuthorityFingerprint, cursor) },
      items, itemCount: items.length
    }));
  } catch (error) {
    if (error !== null && (typeof error === "object" || typeof error === "function") && isProxy(error)) return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
    if (error instanceof SquareInventoryUnsupportedProjectionFailure) return squareUnsupportedResult(error.code, error.field);
    return squareFailureResult(error);
  }
}
function requestPolicy(operation: SquareInventoryResponseOperation, context: SquareSafeJsonObject, base: SquareResponseParserInput, connection: ConnectionAuthority): Policy {
  const batch = operation.startsWith("inventory_");
  const countGet = operation === "retrieve_inventory_count";
  const paginated = batch || countGet;
  const allowed = ["authorizedLocationIds", ...(batch ? ["body"] : countGet ? ["catalogObjectId", "query"] : ["id"]),
    ...(paginated ? ["expectedCursorBindingFingerprint", "expectedResponseCursorFingerprint"] : [])];
  if (Object.keys(context).some((key) => !allowed.includes(key))) squareRejectResponse("square_inventory_input_invalid", "$input");
  const authorizedLocationIds = identifierSet(context.authorizedLocationIds, 1_000);
  const requestedId = batch ? null : identifier(countGet ? context.catalogObjectId : context.id, "$input");
  const body = batch ? squareSafeJsonObject(context.body, "$input") : {};
  const query = countGet ? squareSafeJsonObject(context.query, "$input") : {};
  if (Object.entries(query).some(([key, value]) => !/^[A-Za-z0-9_]+$/.test(key) || typeof value !== "string" || /[&#%?\\]/.test(value))) {
    squareRejectResponse("square_inventory_request_invalid", "$input");
  }
  const requestedLocationIds = batch
    ? body.location_ids === undefined ? null : identifierSet(body.location_ids, 100)
    : query.location_ids === undefined ? null : identifierSet((query.location_ids as string).split(","), 100);
  if (requestedLocationIds && [...requestedLocationIds].some((id) => !authorizedLocationIds.has(id))) squareRejectResponse("square_inventory_location_authority_mismatch", "$input");
  const requestedCatalogIds = countGet ? new Set([requestedId!])
    : body.catalog_object_ids === undefined ? null : identifierSet(body.catalog_object_ids, operation === "inventory_changes_batch_retrieve" ? 500 : 1_000);
  const expectedCursor = context.expectedCursorBindingFingerprint;
  const expectedResponseCursor = context.expectedResponseCursorFingerprint;
  for (const value of [expectedCursor, expectedResponseCursor]) if (value != null && !Sha256FingerprintSchema.safeParse(value).success) squareRejectResponse("square_inventory_request_invalid", "$input");
  const endpoint = batch ? operation === "inventory_counts_batch_retrieve" ? "/counts/batch-retrieve" : "/changes/batch-retrieve"
    : countGet ? "/" + requestedId : operation === "retrieve_inventory_adjustment" ? "/adjustments/" + requestedId : "/physical-counts/" + requestedId;
  const path = "https://" + SQUARE_ENVIRONMENTS[base.providerEnvironment].hostname + "/v2/inventory" + endpoint;
  const authorize = (includeCursor: boolean) => {
    const pairs = Object.keys(query).sort().filter((key) => includeCursor || key !== "cursor").map((key) => key + "=" + query[key]);
    const bodyValue = Object.fromEntries(Object.entries(body).filter(([key]) => includeCursor || key !== "cursor"));
    return assertSquareReadOperation({
      providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: base.providerEnvironment,
      method: batch ? "POST" : "GET", url: path + (pairs.length ? "?" + pairs.join("&") : ""),
      headers: { "Square-Version": SQUARE_API_VERSION, ...(batch ? { "Content-Type": "application/json" } : {}) },
      ...(batch ? { body: JSON.stringify(bodyValue) } : {}),
      ...(includeCursor ? { expectedCursorBindingFingerprint: expectedCursor as string | null | undefined } : {})
    });
  };
  let decision: ReturnType<typeof assertSquareReadOperation>;
  let queryDecision: ReturnType<typeof assertSquareReadOperation>;
  try { decision = authorize(true); queryDecision = authorize(false); } catch { squareRejectResponse("square_inventory_request_invalid", "$input"); }
  if (decision.operationKey !== (batch ? base.providerEnvironment + "_" + operation : operation)) squareRejectResponse("square_inventory_request_invalid", "$input");
  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_inventory_request_authority", fingerprintVersion: SQUARE_INVENTORY_REQUEST_AUTHORITY_VERSION,
    provider: squareResponseProvenance(base), operation, connection, authorizedLocationIds: [...authorizedLocationIds].sort(),
    requestedId, queryFingerprint: queryDecision.requestFingerprint
  });
  const cursor = batch ? body.cursor : query.cursor;
  if (cursor !== undefined) {
    if (typeof cursor !== "string" || expectedResponseCursor !== cursorFingerprint(requestAuthorityFingerprint, cursor)) squareRejectResponse("square_inventory_cursor_invalid", "$input");
  } else if (expectedResponseCursor != null) squareRejectResponse("square_inventory_cursor_invalid", "$input");
  return {
    authorizedLocationIds, requestedLocationIds, requestedCatalogIds, requestedId: countGet ? null : requestedId,
    requestedTypes: Array.isArray(body.types) ? new Set(body.types as string[]) : null,
    maximumItems: paginated ? Number(body.limit ?? 1_000) : 1,
    requestAuthorityFingerprint, requestFingerprint: decision.requestFingerprint, cursorBindingFingerprint: decision.cursorBindingFingerprint
  };
}
function minimize(raw: SquareSafeJsonObject, entityType: z.infer<typeof EntitySchema>, wrapper: SquareSafeJsonObject | null, provider: SquareResponseProvenance, connection: ConnectionAuthority, policy: Policy): SquareMinimizedInventoryRecord {
  const adjustment = entityType === "inventory_adjustment";
  const snapshot = entityType === "inventory_count_snapshot";
  const id = snapshot ? null : requiredId(raw, "id");
  if (policy.requestedId !== null && id !== policy.requestedId) squareRejectResponse("square_inventory_identity_request_mismatch", "$response");
  const catalogId = optionalId(raw, "catalog_object_id");
  if (policy.requestedCatalogIds !== null && (catalogId === null || !policy.requestedCatalogIds.has(catalogId))) squareRejectResponse("square_inventory_identity_request_mismatch", "$response");
  const locationId = adjustment ? null : optionalId(raw, "location_id");
  const fromLocationId = adjustment ? optionalId(raw, "from_location_id") : null;
  const toLocationId = adjustment ? optionalId(raw, "to_location_id") : null;
  for (const location of [locationId, fromLocationId, toLocationId]) {
    if (location !== null && !policy.authorizedLocationIds.has(location)) squareRejectResponse("square_inventory_location_authority_mismatch", "$response");
  }
  const providedLocations = [locationId, fromLocationId, toLocationId].filter((value): value is string => value !== null);
  // Location filters can match either adjustment endpoint; all supplied endpoints
  // must still be in trusted scope. Missing provider locations are never fabricated.
  if (policy.requestedLocationIds !== null && providedLocations.length > 0 && !providedLocations.some((location) => policy.requestedLocationIds!.has(location))) {
    squareRejectResponse("square_inventory_location_request_mismatch", "$response");
  }
  const state = adjustment ? null : enumeration(raw, "state", SQUARE_INVENTORY_RESPONSE_STATES);
  if (snapshot && (catalogId === null || locationId === null || state === null)) squareRejectResponse("square_required_field_missing", "$response");
  const ref = (record: SquareSafeJsonObject, key: string, type: ReferenceEntity, legacy = false) => {
    const providerId = optionalId(record, key, legacy ? LegacyIdSchema : IdSchema);
    return providerId === null ? null : {
      referenceType: "unverified_inventory_relationship" as const, providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provider.providerEnvironment, entityType: type, providerId
    };
  };
  let quantity: string | null = null;
  if (raw.quantity != null) {
    if (!QuantitySchema.safeParse(raw.quantity).success) squareRejectResponse("square_inventory_quantity_invalid", "$response");
    quantity = raw.quantity as string;
  }
  const measurement = wrapper === null ? null : measurementValue(wrapper, quantity);
  let adjustmentGroup: z.infer<typeof GroupSchema> | null = null;
  if (adjustment && raw.adjustment_group != null) {
    const group = squareSafeJsonObject(raw.adjustment_group);
    adjustmentGroup = { id: optionalId(group, "id"), rootAdjustmentReference: ref(group, "root_adjustment_id", "inventory_adjustment"),
      fromState: enumeration(group, "from_state", SQUARE_INVENTORY_RESPONSE_STATES), toState: enumeration(group, "to_state", SQUARE_INVENTORY_RESPONSE_STATES) };
  }
  let reason: z.infer<typeof ReasonSchema> | null = null;
  if (adjustment && raw.reason_id != null) {
    const detail = squareSafeJsonObject(raw.reason_id);
    const type = enumeration(detail, "type", SQUARE_INVENTORY_REASON_TYPES);
    if (type === null) squareRejectResponse("square_inventory_reason_invalid", "$response");
    const customReasonReference = ref(detail, "custom_reason_id", "inventory_adjustment_reason");
    if (type !== "CUSTOM" && customReasonReference !== null) squareRejectResponse("square_inventory_reason_invalid", "$response");
    reason = { type, customReasonReference };
  }
  const snapshotIdentityFingerprint = snapshot ? squareMinimizedProjectionFingerprint({
    purpose: "square_inventory_snapshot_identity_v1", connection, provider, catalogId, locationId, state
  }) : null;
  const isEstimated = snapshot ? nullableBoolean(raw, "is_estimated") : null;
  return SquareMinimizedInventoryRecordSchema.parse({
    contractVersion: SQUARE_INVENTORY_RESPONSE_CONTRACT_VERSION, minimizationVersion: SQUARE_INVENTORY_MINIMIZATION_VERSION,
    entityType, entityVersion: 1, projectionScope: "provider_inventory_source_facts_only", provider,
    authority: { ...connection, providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: provider.providerEnvironment, entityType,
      identityState: snapshot ? "provider_snapshot_composite" : "provider_id", providerId: id, snapshotIdentityFingerprint,
      locationId, fromLocationId, toLocationId },
    id, catalogReference: ref(raw, "catalog_object_id", "catalog_object"),
    catalogObjectType: enumeration(raw, "catalog_object_type", ["ITEM", "ITEM_VARIATION"] as const),
    state, fromState: adjustment ? enumeration(raw, "from_state", SQUARE_INVENTORY_RESPONSE_STATES) : null,
    toState: adjustment ? enumeration(raw, "to_state", SQUARE_INVENTORY_RESPONSE_STATES) : null,
    locationId, fromLocationId, toLocationId, quantity, isEstimated,
    calculatedAt: snapshot ? timestamp(raw, "calculated_at") : null,
    occurredAt: snapshot ? null : timestamp(raw, "occurred_at"), createdAt: snapshot ? null : timestamp(raw, "created_at"),
    totalPriceMoney: adjustment ? money(raw, "total_price_money") : null, costMoney: adjustment ? money(raw, "cost_money") : null,
    transactionReference: adjustment ? ref(raw, "transaction_id", "legacy_transaction", true) : null,
    refundReference: adjustment ? ref(raw, "refund_id", "legacy_refund", true) : null,
    purchaseOrderReference: adjustment ? ref(raw, "purchase_order_id", "purchase_order") : null,
    goodsReceiptReference: adjustment ? ref(raw, "goods_receipt_id", "goods_receipt") : null,
    physicalCountReference: adjustment ? ref(raw, "physical_count_id", "inventory_physical_count") : null,
    adjustmentReference: !snapshot && !adjustment ? ref(raw, "adjustment_id", "inventory_adjustment") : null,
    adjustmentGroup, reason, measurement,
    measurementUnitReference: wrapper === null ? null : ref(wrapper, "measurement_unit_id", "catalog_measurement_unit"),
    inventorySemantics: "provider_record_not_stock_movement_valuation_or_accounting"
  });
}
function measurementValue(wrapper: SquareSafeJsonObject, quantity: string | null): z.infer<typeof MeasurementSchema> | null {
  if (wrapper.measurement_unit == null) return null;
  const raw = squareSafeJsonObject(wrapper.measurement_unit);
  const precision = raw.precision == null ? null : raw.precision;
  if (precision !== null && (typeof precision !== "number" || !Number.isInteger(precision) || precision < 0 || precision > 5)) squareRejectResponse("square_inventory_measurement_invalid", "$response");
  // Trailing zeros carry representation, not extra unit precision.
  if (precision !== null && quantity !== null && (quantity.split(".")[1]?.replace(/0+$/, "").length ?? 0) > (precision as number)) squareRejectResponse("square_inventory_measurement_invalid", "$response");
  let measurementUnit: z.infer<typeof SquareOrderMeasurementUnitSchema> | null = null;
  if (raw.measurement_unit != null) {
    const unit = squareSafeJsonObject(raw.measurement_unit);
    const keys = ["custom_unit", "area_unit", "length_unit", "volume_unit", "weight_unit", "generic_unit", "time_unit"].filter((key) => unit[key] != null);
    if (keys.length !== 1) squareRejectResponse("square_inventory_measurement_invalid", "$response");
    const kind = keys[0].slice(0, -5);
    const candidate = kind === "custom"
      ? { kind, type: unit.type ?? null, custom: { name: squareSafeJsonObject(unit.custom_unit).name, abbreviation: squareSafeJsonObject(unit.custom_unit).abbreviation } }
      : { kind, type: unit.type ?? null, unit: unit[keys[0]] };
    const parsed = SquareOrderMeasurementUnitSchema.safeParse(candidate);
    if (!parsed.success) throw new SquareInventoryUnsupportedProjectionFailure("square_inventory_measurement_invalid", "$response");
    measurementUnit = parsed.data;
  }
  return { precision: precision as number | null, measurementUnit };
}
function identifier(value: unknown, field: string) {
  if (typeof value !== "string" || !IdSchema.safeParse(value).success) squareRejectResponse("square_identifier_invalid", field);
  return value;
}
function identifierSet(value: unknown, maximum: number): Set<string> {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) squareRejectResponse("square_inventory_input_invalid", "$input");
  const values = value.map((id) => identifier(id, "$input"));
  const result = new Set(values);
  if (result.size !== values.length) squareRejectResponse("square_inventory_input_invalid", "$input");
  return result;
}
function optionalId(raw: SquareSafeJsonObject, key: string, schema: z.ZodType<string> = IdSchema): string | null {
  if (raw[key] == null) return null;
  if (typeof raw[key] !== "string" || !schema.safeParse(raw[key]).success) squareRejectResponse("square_identifier_invalid", "$response");
  return raw[key] as string;
}
function requiredId(raw: SquareSafeJsonObject, key: string) {
  const id = optionalId(raw, key);
  if (id === null) squareRejectResponse("square_required_field_missing", "$response");
  return id;
}
function enumeration<T extends string>(raw: SquareSafeJsonObject, key: string, choices: readonly T[]): T | null {
  if (raw[key] == null) return null;
  if (typeof raw[key] !== "string" || (raw[key] as string).length > 128) squareRejectResponse("square_inventory_enum_invalid", "$response");
  if (!choices.includes(raw[key] as T)) throw new SquareInventoryUnsupportedProjectionFailure("square_inventory_enum_unsupported", "$response");
  return raw[key] as T;
}
function timestamp(raw: SquareSafeJsonObject, key: string) {
  if (raw[key] != null && (typeof raw[key] !== "string" || (raw[key] as string).length > 34)) squareRejectResponse("square_timestamp_invalid", "$response");
  return squareOptionalNullableTimestamp(raw, key, "$response");
}
function nullableBoolean(raw: SquareSafeJsonObject, key: string) {
  if (raw[key] == null) return null;
  if (typeof raw[key] !== "boolean") squareRejectResponse("square_inventory_boolean_invalid", "$response");
  return raw[key] as boolean;
}
function money(raw: SquareSafeJsonObject, key: string) {
  if (raw[key] == null) return null;
  const value = squareSafeJsonObject(raw[key]);
  const amount = value.amount;
  // Both retained fields are unsigned: total price explicitly; cost inherits
  // the pinned Money contract's default in the absence of a signed exception.
  if (amount != null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) squareRejectResponse("square_inventory_money_invalid", "$response");
  return { amountMinor: amount == null ? null : String(amount), currency: squareOptionalNullableCurrencyCode(value, "currency", "$response") };
}
function objectArray(raw: SquareSafeJsonObject, key: string, maximum: number): readonly SquareSafeJsonObject[] {
  if (raw[key] == null) return [];
  const value = raw[key];
  if (!Array.isArray(value) || value.length > maximum) squareRejectResponse(key === "errors" ? "square_inventory_provider_errors_invalid" : "square_inventory_array_invalid", "$response");
  return value.map((item) => squareSafeJsonObject(item));
}
function responseCursor(raw: SquareSafeJsonObject) {
  if (raw.cursor == null || raw.cursor === "") return null;
  if (typeof raw.cursor !== "string" || !CursorPattern.test(raw.cursor)) squareRejectResponse("square_inventory_cursor_invalid", "$response");
  return raw.cursor;
}
function cursorFingerprint(requestAuthorityFingerprint: string, cursor: string) {
  return squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_inventory_response_cursor", fingerprintVersion: "square_inventory_response_cursor_v1",
    requestAuthorityFingerprint, cursor
  });
}
function compareStrings(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

// Proxy rejection precedes every reflection on raw context/response. The established
// sanitizer still performs the canonical copy/key checks. Both count aliases per path.
function inventorySafeObject(input: unknown, field: string): SquareSafeJsonObject {
  if (!inventoryRawTreeIsSafe(input)) squareRejectResponse("square_inventory_raw_tree_invalid", field);
  const value = squareSafeJsonObject(input, field);
  if (!inventoryRawTreeIsSafe(value)) squareRejectResponse("square_inventory_raw_tree_invalid", field);
  return value;
}
function inventoryRawTreeIsSafe(root: unknown) {
  let count = 0;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): boolean => {
    count += 1;
    if (count > 20_000 || depth > 12) return false;
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "string") return value.length <= 4_096;
    if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0);
    if (typeof value !== "object" || isProxy(value) || active.has(value)) return false;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !("value" in length) || length.enumerable ||
          !Number.isSafeInteger(length.value) || length.value < 0 || length.value > 1_000 ||
          keys.length !== length.value + 1) return false;
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) return false;
      }
    } else if (keys.length > 64) return false;
    active.add(value);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || key.length < 1 || key.length > 128) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor) || !visit(descriptor.value, depth + 1)) return false;
    }
    active.delete(value);
    return true;
  };
  return visit(root, 0);
}

export function squareInventoryFingerprint(input: SquareMinimizedInventoryRecord) {
  if (!squareInventoryTraverseCanonicalTree(input, "inspect")) throw new TypeError("square_inventory_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareMinimizedInventoryRecordSchema.parse(input));
}
export function squareInventoryResponseFingerprint(input: SquareInventoryResponse) {
  if (!squareInventoryTraverseCanonicalTree({ value: input, diagnostics: [] }, "inspect")) throw new TypeError("square_inventory_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareInventoryResponseSchema.parse(input));
}
function squareInventoryResultBoundary<T>(
  produceResult: (
    acceptedResult: SquareInventoryAcceptedResultFactory<T>
  ) => SquareResponseParserResult<T>,
  acceptedSchema: z.ZodType<T>
): SquareResponseParserResult<T> {
  const acceptance = {
    present: false,
    result: null as unknown,
    value: null as unknown,
    fingerprint: null as string | null
  };
  try {
    const acceptedResult: SquareInventoryAcceptedResultFactory<T> = (value) => {
      if (!squareInventoryTraverseCanonicalTree({ value, diagnostics: [] }, "inspect")) {
        return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
      }
      const fingerprint = squareMinimizedProjectionFingerprint(value);
      const result = squareAcceptedResult(value);
      if (
        squareInventoryHasExactDataProperties(result, [
          "outcome",
          "value",
          "diagnostics"
        ]) &&
        squareInventoryDataProperty(result, "outcome") === "accepted" &&
        squareInventoryDataProperty(result, "value") === value
      ) {
        acceptance.present = true;
        acceptance.result = result;
        acceptance.value = value;
        acceptance.fingerprint = fingerprint;
      }
      return result;
    };
    return squareInventoryRootDiagnosticResult(
      produceResult(acceptedResult),
      acceptedSchema,
      acceptance
    );
  } catch {
    return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
  }
}

function squareInventoryRootDiagnosticResult<T>(
  result: unknown,
  acceptedSchema: z.ZodType<T>,
  acceptance: Readonly<{
    present: boolean;
    result: unknown;
    value: unknown;
    fingerprint: string | null;
  }>
): SquareResponseParserResult<T> {
  if (!squareInventoryHasExactDataProperties(result, ["outcome", "diagnostics"])) {
    if (
      !squareInventoryHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ])
    ) {
      return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
    }
  }

  const outcome = squareInventoryDataProperty(result, "outcome");
  if (outcome === "accepted") {
    const value = squareInventoryDataProperty(result, "value");
    if (
      !acceptance.present ||
      result !== acceptance.result ||
      value !== acceptance.value ||
      !squareInventoryHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ]) ||
      !squareInventoryIsEmptyFrozenArray(
        squareInventoryDataProperty(result, "diagnostics")
      ) ||
      !squareInventoryIsDeeplyFrozen(result) ||
      !acceptedSchema.safeParse(value).success ||
      squareMinimizedProjectionFingerprint(value) !== acceptance.fingerprint
    ) {
      return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
    }
    return result as SquareResponseParserResult<T>;
  }

  if (
    outcome !== "rejected" &&
    outcome !== "unsupported" &&
    outcome !== "incompatible-version"
  ) {
    return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;
  }

  const diagnostics = squareInventorySanitizedDiagnostics(
    squareInventoryDataProperty(result, "diagnostics")
  );
  if (diagnostics === null) return SQUARE_INVENTORY_INTERNAL_REJECTION_RESULT;

  return Object.freeze({
    outcome,
    diagnostics: Object.freeze(diagnostics)
  });
}

function squareInventorySanitizedDiagnostics(
  value: unknown
): SquareResponseFailureResult["diagnostics"] | null {
  if (
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return null;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > MAXIMUM_RESULT_DIAGNOSTICS
  ) {
    return null;
  }
  const length = lengthDescriptor.value;
  if (Reflect.ownKeys(value).length !== length + 1) return null;

  const diagnostics = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    const diagnostic = descriptor.value;
    if (
      !squareInventoryHasExactDataProperties(diagnostic, ["code", "field"])
    ) {
      return null;
    }
    const code = squareInventoryDataProperty(diagnostic, "code");
    const field = squareInventoryDataProperty(diagnostic, "field");
    if (
      typeof code !== "string" ||
      code.length > MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH ||
      !SQUARE_INVENTORY_DIAGNOSTIC_CODES.has(code) ||
      typeof field !== "string" ||
      field.length > 160
    ) {
      return null;
    }
    diagnostics.push(
      Object.freeze({
        code,
        field: field.startsWith("$input") ? "$input" : "$response"
      })
    );
  }
  return diagnostics;
}

function squareInventoryHasExactDataProperties(
  value: unknown,
  keys: readonly string[]
): value is Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function squareInventoryDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string
) {
  if (isProxy(value)) {
    throw new TypeError("square_inventory_result_property_invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("square_inventory_result_property_invalid");
  }
  return descriptor.value;
}

function squareInventoryIsEmptyFrozenArray(value: unknown) {
  if (
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return false;
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  return (
    length !== undefined &&
    "value" in length &&
    !length.enumerable &&
    length.value === 0 &&
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).length === 1
  );
}

function squareInventoryIsDeeplyFrozen(value: unknown) {
  return squareInventoryTraverseCanonicalTree(value, "verify");
}

function squareInventoryTraverseCanonicalTree(
  value: unknown,
  mode: "inspect" | "verify"
) {
  type Frame = {
    readonly value: object;
    readonly children: readonly unknown[];
    readonly depth: number;
    childIndex: number;
  };

  const active = new Set<object>();
  const pending: Frame[] = [];
  let expandedNodeCount = 0;

  const enter = (candidate: unknown, depth: number) => {
    if (candidate === null) return true;
    if (typeof candidate === "string") {
      return candidate.length <= MAXIMUM_FROZEN_RESULT_STRING_LENGTH;
    }
    if (typeof candidate === "boolean") {
      return true;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) && !Object.is(candidate, -0);
    }
    if (typeof candidate !== "object" && typeof candidate !== "function") {
      return false;
    }
    if (typeof candidate === "function" || isProxy(candidate)) return false;
    expandedNodeCount += 1;
    if (expandedNodeCount > MAXIMUM_FROZEN_RESULT_NODES) return false;
    if (depth > MAXIMUM_FROZEN_RESULT_DEPTH || active.has(candidate)) {
      return false;
    }
    if (mode === "verify" && !Object.isFrozen(candidate)) return false;
    const children = squareInventoryCanonicalDataValues(candidate);
    if (children === null) return false;
    active.add(candidate);
    pending.push({ value: candidate, children, depth, childIndex: 0 });
    return true;
  };

  if (!enter(value, 0)) return false;
  while (pending.length > 0) {
    const frame = pending[pending.length - 1];
    if (frame.childIndex < frame.children.length) {
      const child = frame.children[frame.childIndex];
      frame.childIndex += 1;
      if (!enter(child, frame.depth + 1)) return false;
      continue;
    }
    active.delete(frame.value);
    pending.pop();
  }
  return true;
}

function squareInventoryCanonicalDataValues(value: object): readonly unknown[] | null {
  if (isProxy(value)) return null;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      length.enumerable ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > MAXIMUM_FROZEN_RESULT_ARRAY_LENGTH
    ) {
      return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length.value + 1) return null;
    for (const key of ownKeys) {
      if (key === "length") continue;
      if (typeof key !== "string") return null;
      const index = Number(key);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= length.value ||
        String(index) !== key
      ) {
        return null;
      }
    }
    const children = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      children.push(descriptor.value);
    }
    return children;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAXIMUM_FROZEN_RESULT_OBJECT_PROPERTIES) return null;
  const children = [];
  for (const key of ownKeys) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    children.push(descriptor.value);
  }
  return children;
}

class SquareInventoryUnsupportedProjectionFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_inventory_projection_unsupported");
    this.name = "SquareInventoryUnsupportedProjectionFailure";
    this.code = code;
    this.field = field;
  }
}
