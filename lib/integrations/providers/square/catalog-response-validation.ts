import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { SQUARE_API_VERSION, SQUARE_ENVIRONMENTS, SQUARE_PROVIDER_KEY } from "@/lib/integrations/providers/square/contracts";
import {
  SquareCatalogResponseOperationSchema, SquareCatalogResponseSchema,
  parseSquareCatalogResponseWithAcceptance,
  type SquareCatalogResponse, type SquareCatalogResponseOperation, type SquareMinimizedCatalogObject
} from "@/lib/integrations/providers/square/catalog-responses";
import { assertSquareReadOperation } from "@/lib/integrations/providers/square/request-validators";
import {
  SquareIdentifierSchema, type SquareResponseParserInput, type SquareResponseParserResult,
  type SquareResponseFailureResult, type SquareSafeJsonObject,
  squareAcceptedResult, squareFailureResult, squareMinimizedProjectionFingerprint,
  squareRejectResponse, squareResponseParserInput, squareResponseProvenance, squareSafeJsonObject
} from "@/lib/integrations/providers/square/response-validation";

export const SQUARE_CATALOG_VALIDATION_VERSION = "square_catalog_response_validation_v1" as const;
export const SQUARE_CATALOG_REQUEST_AUTHORITY_VERSION = "square_catalog_request_authority_v1" as const;
// Proven conservative bound, not the largest fixture tried. R>=1+6N+E,
// C<=9+7N+E<=8+R+floor((R-1)/6), R<=20,000. See contract audit.
export const SQUARE_CATALOG_MAXIMUM_RESULT_CONTAINERS = 23_341;
const MAXIMUM_FROZEN_RESULT_NODES = SQUARE_CATALOG_MAXIMUM_RESULT_CONTAINERS;
const MAXIMUM_RESULT_DIAGNOSTICS = 100;
const MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH = 80;
const MAXIMUM_FROZEN_RESULT_DEPTH = 32;
const MAXIMUM_FROZEN_RESULT_ARRAY_LENGTH = 1_000;
const MAXIMUM_FROZEN_RESULT_OBJECT_PROPERTIES = 64;
const MAXIMUM_FROZEN_RESULT_STRING_LENGTH = 4_096;
export const SquareCatalogConnectionAuthoritySchema = z.object({
  workspaceId: UuidSchema, connectionId: UuidSchema,
  providerEntityType: z.literal("merchant"), providerEntityId: SquareIdentifierSchema
}).strict();
export const SquareCatalogValidatedResponseSchema = SquareCatalogResponseSchema.extend({
  validationVersion: z.literal(SQUARE_CATALOG_VALIDATION_VERSION),
  connectionAuthority: SquareCatalogConnectionAuthoritySchema,
  relationshipScope: z.literal("catalog_references_and_applicability_not_location_authority"),
  responseScope: z.literal("minimized_catalog_page_not_complete_configuration"),
  requestAuthorityFingerprint: Sha256FingerprintSchema,
  requestFingerprint: Sha256FingerprintSchema,
  cursorBindingFingerprint: Sha256FingerprintSchema
}).strict();
export type SquareCatalogValidatedResponse = Readonly<z.infer<typeof SquareCatalogValidatedResponseSchema>>;
type SquareCatalogAcceptedResultFactory<T> = (value: T) => SquareResponseParserResult<T>;
type ConnectionAuthority = z.infer<typeof SquareCatalogConnectionAuthoritySchema>;
type CatalogPolicy = Readonly<{
  requestedIds: ReadonlySet<string> | null; requestedTypes: ReadonlySet<string> | null;
  maximumItems: number; includeDeleted: boolean; includeRelated: boolean;
  includes: ReadonlySet<string>; catalogVersion: bigint | null;
  requestAuthorityFingerprint: string; requestFingerprint: string; cursorBindingFingerprint: string;
}>;

export function parseSquareCatalogValidatedResponse(input: unknown): SquareResponseParserResult<SquareCatalogValidatedResponse> {
  return squareCatalogResultBoundary((acceptedResult) => {
    try {
      if (!squareCatalogHasExactDataProperties(input, [
        "providerKey", "providerEnvironment", "apiVersion", "operation", "connectionAuthority", "requestContext", "response"
      ])) squareRejectResponse("square_catalog_input_invalid", "$input");
      if (!catalogRawTreeIsSafe(squareCatalogDataProperty(input, "response"))) squareRejectResponse("square_catalog_raw_tree_invalid", "$response");
      const base = squareResponseParserInput(input);
      const operationValue = squareCatalogDataProperty(input, "operation");
      if (typeof operationValue !== "string") squareRejectResponse("square_catalog_input_invalid", "$input");
      const operation = SquareCatalogResponseOperationSchema.parse(operationValue);
      const connectionAuthority = SquareCatalogConnectionAuthoritySchema.parse(catalogSafeObject(squareCatalogDataProperty(input, "connectionAuthority"), "$input"));
      const policy = catalogRequestPolicy(operation, catalogSafeObject(squareCatalogDataProperty(input, "requestContext"), "$input"), base, connectionAuthority);
      const response = catalogSafeObject(base.response, "$response");
      const normalized = catalogEnvelope(response, operation, policy);
      return parseSquareCatalogResponseWithAcceptance({ ...base, operation, response: normalized }, (projection) => {
        assertCatalogRequestMatches(projection, policy);
        const cursor = normalized.cursor;
        // Flat extension keeps the fixed-container overhead at nine. Entity and
        // legacy projection fingerprints remain independently available unchanged.
        const value: SquareCatalogValidatedResponse = {
          ...projection, validationVersion: SQUARE_CATALOG_VALIDATION_VERSION, connectionAuthority,
          relationshipScope: "catalog_references_and_applicability_not_location_authority",
          responseScope: "minimized_catalog_page_not_complete_configuration",
          requestAuthorityFingerprint: policy.requestAuthorityFingerprint,
          requestFingerprint: policy.requestFingerprint, cursorBindingFingerprint: policy.cursorBindingFingerprint,
          pagination: { cursorPresent: typeof cursor === "string", cursorFingerprint: typeof cursor === "string" ? catalogCursorFingerprint(policy.requestAuthorityFingerprint, cursor) : null }
        };
        return acceptedResult(value);
      });
    } catch (error) {
      if ((typeof error === "object" && error !== null || typeof error === "function") && isProxy(error)) return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
      return squareFailureResult(error);
    }
  }, SquareCatalogValidatedResponseSchema);
}

function catalogRequestPolicy(operation: SquareCatalogResponseOperation, context: SquareSafeJsonObject, base: SquareResponseParserInput, connectionAuthority: ConnectionAuthority): CatalogPolicy {
  const get = operation === "list_catalog" || operation === "retrieve_catalog_object";
  const retrieve = operation === "retrieve_catalog_object";
  const allowed = [get ? "query" : "body", "expectedCursorBindingFingerprint", "expectedResponseCursorFingerprint", ...(retrieve ? ["objectId"] : [])];
  if (Object.keys(context).some((key) => !allowed.includes(key))) squareRejectResponse("square_catalog_input_invalid", "$input");
  const parameters = catalogSafeObject(context[get ? "query" : "body"], "$input");
  const objectId = retrieve ? SquareIdentifierSchema.parse(context.objectId) : null;
  const path = operation === "list_catalog" ? "/v2/catalog/list" : retrieve ? `/v2/catalog/object/${objectId}` : operation === "catalog_search" ? "/v2/catalog/search" : "/v2/catalog/batch-retrieve";
  const hostname = SQUARE_ENVIRONMENTS[base.providerEnvironment].hostname;
  if (get && Object.entries(parameters).some(([key, value]) => typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(key) || /[&#%?\\]/.test(value))) squareRejectResponse("square_catalog_request_invalid", "$input");
  for (const value of [context.expectedCursorBindingFingerprint, context.expectedResponseCursorFingerprint]) {
    if (value != null && !Sha256FingerprintSchema.safeParse(value).success) squareRejectResponse("square_catalog_request_invalid", "$input");
  }
  const authorize = (withCursor: boolean) => {
    const entries = Object.entries(parameters).filter(([key]) => withCursor || key !== "cursor").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const query = get && entries.length ? "?" + entries.map(([key, value]) => `${key}=${value}`).join("&") : "";
    return assertSquareReadOperation({
      providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: base.providerEnvironment, method: get ? "GET" : "POST",
      url: `https://${hostname}${path}${query}`,
      headers: { "Square-Version": SQUARE_API_VERSION, ...(get ? {} : { "Content-Type": "application/json" }) },
      ...(get ? {} : { body: JSON.stringify(Object.fromEntries(entries)) }),
      expectedCursorBindingFingerprint: withCursor ? context.expectedCursorBindingFingerprint as string | null | undefined : undefined
    });
  };
  let decision: ReturnType<typeof assertSquareReadOperation>;
  let queryDecision: ReturnType<typeof assertSquareReadOperation>;
  try { decision = authorize(true); queryDecision = authorize(false); }
  catch { squareRejectResponse("square_catalog_request_invalid", "$input"); }
  if (decision.operationKey !== (get ? operation : `${base.providerEnvironment}_${operation}`)) squareRejectResponse("square_catalog_request_invalid", "$input");
  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: SQUARE_CATALOG_REQUEST_AUTHORITY_VERSION, provider: squareResponseProvenance(base),
    operation, connectionAuthority, objectId, queryFingerprint: queryDecision.requestFingerprint,
    cursorBindingFingerprint: queryDecision.cursorBindingFingerprint
  });
  if (parameters.cursor !== undefined) {
    if (context.expectedResponseCursorFingerprint !== catalogCursorFingerprint(requestAuthorityFingerprint, parameters.cursor as string)) squareRejectResponse("square_catalog_cursor_binding_invalid", "$input");
  } else if (context.expectedResponseCursorFingerprint != null) squareRejectResponse("square_catalog_cursor_binding_invalid", "$input");
  const options = parameters.include_options as SquareSafeJsonObject | undefined;
  return {
    requestedIds: retrieve ? new Set([objectId!]) : operation === "catalog_batch_retrieve" ? new Set(parameters.object_ids as string[]) : null,
    requestedTypes: operation === "list_catalog" ? new Set((parameters.types as string).toUpperCase().split(",")) : operation === "catalog_search" ? new Set(parameters.object_types as string[]) : null,
    // Search limit is advisory; retain the existing schema bound, not a guessed
    // provider default or a hard limit equal to the requested advisory limit.
    maximumItems: operation === "list_catalog" ? 100 : retrieve ? 1 : operation === "catalog_search" ? 1_000 : (parameters.object_ids as string[]).length,
    includeDeleted: retrieve || parameters.include_deleted_objects === true,
    includeRelated: parameters.include_related_objects === true || parameters.include_related_objects === "true",
    includes: new Set((options?.include ?? []) as string[]),
    catalogVersion: parameters.catalog_version == null ? null : BigInt(parameters.catalog_version as string | number),
    requestAuthorityFingerprint, requestFingerprint: decision.requestFingerprint, cursorBindingFingerprint: decision.cursorBindingFingerprint
  };
}

function catalogEnvelope(response: SquareSafeJsonObject, operation: SquareCatalogResponseOperation, policy: CatalogPolicy): SquareSafeJsonObject {
  const allowed = operation === "list_catalog" ? ["objects", "cursor", "errors"] : operation === "retrieve_catalog_object" ? ["object", "related_objects", "errors"] : operation === "catalog_search" ? ["objects", "related_objects", "included_resources", "cursor", "latest_time", "errors"] : ["objects", "related_objects", "included_resources", "errors"];
  // Unknown extension metadata is minimized away, but known incompatible endpoint
  // envelopes cannot be silently treated as an empty successful Catalog page.
  const envelopeKeys = ["object", "objects", "related_objects", "included_resources", "cursor", "latest_time", "order", "orders", "payment", "payments", "refund", "refunds", "merchant", "merchants", "location", "locations", "count", "counts", "adjustment", "transfer", "changes"];
  if (envelopeKeys.some((key) => Object.hasOwn(response, key) && !allowed.includes(key))) squareRejectResponse("square_catalog_envelope_mismatch", "$response");
  const normalized: Record<string, unknown> = Object.fromEntries(Object.entries(response).filter(([key, value]) => allowed.includes(key) && value !== null));
  if (normalized.related_objects !== undefined && (!Array.isArray(normalized.related_objects) || (normalized.related_objects.length > 0 && !policy.includeRelated))) squareRejectResponse("square_catalog_related_not_requested", "$response");
  if (normalized.included_resources !== undefined) {
    const included = catalogSafeObject(normalized.included_resources, "$response");
    for (const [key, option] of [["nested_modifiers", "INCLUDE_NESTED_MODIFIERS"], ["ancestor_modifiers", "INCLUDE_ANCESTOR_MODIFIERS"]]) {
      if (included[key] != null && (!Array.isArray(included[key]) || ((included[key] as unknown[]).length > 0 && !policy.includes.has(option)))) squareRejectResponse("square_catalog_included_not_requested", "$response");
    }
    if (Object.keys(included).some((key) => key !== "nested_modifiers" && key !== "ancestor_modifiers")) squareRejectResponse("square_catalog_envelope_mismatch", "$response");
  }
  return normalized as SquareSafeJsonObject;
}

function assertCatalogRequestMatches(response: SquareCatalogResponse, policy: CatalogPolicy) {
  if (response.items.length > policy.maximumItems) squareRejectResponse("square_catalog_limit_mismatch", "$response");
  for (const item of response.items) {
    if (policy.requestedIds && !policy.requestedIds.has(item.id)) squareRejectResponse("square_catalog_identity_request_mismatch", "$response");
    if (policy.requestedTypes && !policy.requestedTypes.has(item.catalogObjectType)) squareRejectResponse("square_catalog_type_request_mismatch", "$response");
    if (item.isDeleted && !policy.includeDeleted) squareRejectResponse("square_catalog_deleted_not_requested", "$response");
  }
  const identityTypes = new Map<string, string>();
  const visit = (item: SquareMinimizedCatalogObject) => {
    const previousType = identityTypes.get(item.id);
    if (previousType !== undefined && previousType !== item.catalogObjectType) squareRejectResponse("square_catalog_identity_type_conflict", "$response");
    identityTypes.set(item.id, item.catalogObjectType);
    if (policy.catalogVersion !== null && BigInt(item.catalogVersion) > policy.catalogVersion) squareRejectResponse("square_catalog_version_request_mismatch", "$response");
    if (item.catalogObjectType === "ITEM") item.variations.forEach(visit);
    if (item.catalogObjectType === "MODIFIER_LIST") item.modifiers.forEach(visit);
  };
  [...response.items, ...response.relatedItems, ...response.includedItems].forEach(visit);
}

function catalogCursorFingerprint(requestAuthorityFingerprint: string, cursor: string) {
  return squareMinimizedProjectionFingerprint({ fingerprintPurpose: "square_catalog_validated_cursor_v1", requestAuthorityFingerprint, cursor });
}
export function squareCatalogValidatedResponseFingerprint(input: SquareCatalogValidatedResponse) {
  if (!squareCatalogTraverseCanonicalTree({ value: input, diagnostics: [] }, "inspect")) throw new TypeError("square_catalog_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareCatalogValidatedResponseSchema.parse(input));
}

const SQUARE_CATALOG_DIAGNOSTIC_CODES = new Set([
  "square_api_version_incompatible",
  "square_boolean_invalid",
  "square_catalog_authority_identity_conflict",
  "square_catalog_category_location_scope_invalid",
  "square_catalog_category_reference_duplicate",
  "square_catalog_cursor_binding_invalid",
  "square_catalog_cursor_invalid",
  "square_catalog_deleted_not_requested",
  "square_catalog_discount_amount_conflict",
  "square_catalog_discount_amount_missing",
  "square_catalog_discount_maximum_amount_conflict",
  "square_catalog_discount_percentage_conflict",
  "square_catalog_discount_percentage_missing",
  "square_catalog_discount_variable_amount_invalid",
  "square_catalog_discount_variable_percentage_invalid",
  "square_catalog_envelope_mismatch",
  "square_catalog_identifier_duplicate",
  "square_catalog_identity_request_mismatch",
  "square_catalog_identity_type_conflict",
  "square_catalog_included_not_requested",
  "square_catalog_included_resource_type_invalid",
  "square_catalog_input_invalid",
  "square_catalog_item_child_type_invalid",
  "square_catalog_item_variations_missing",
  "square_catalog_limit_mismatch",
  "square_catalog_modifier_child_lists_unsupported",
  "square_catalog_modifier_list_child_type_invalid",
  "square_catalog_modifier_list_modifiers_missing",
  "square_catalog_modifier_list_quantities_unsupported",
  "square_catalog_modifier_list_text_unsupported",
  "square_catalog_modifier_location_overrides_unsupported",
  "square_catalog_modifier_parent_mismatch",
  "square_catalog_modifier_selection_bounds_unsupported",
  "square_catalog_object_discriminator_conflict",
  "square_catalog_object_discriminator_missing",
  "square_catalog_object_type_invalid",
  "square_catalog_object_type_unsupported",
  "square_catalog_object_unsupported",
  "square_catalog_operation_invalid",
  "square_catalog_percentage_invalid",
  "square_catalog_price_invalid",
  "square_catalog_projection_invalid",
  "square_catalog_provider_errors_present",
  "square_catalog_raw_tree_invalid",
  "square_catalog_related_not_requested",
  "square_catalog_request_authority_v1",
  "square_catalog_request_invalid",
  "square_catalog_response_cursor",
  "square_catalog_response_cursor_fingerprint_v1",
  "square_catalog_response_validation_v1",
  "square_catalog_tax_product_set_unsupported",
  "square_catalog_temporary_id_rejected",
  "square_catalog_type_request_mismatch",
  "square_catalog_validated_cursor_v1",
  "square_catalog_variation_parent_mismatch",
  "square_catalog_version_request_mismatch",
  "square_country_invalid",
  "square_currency_invalid",
  "square_display_text_invalid",
  "square_duplicate_authority_identity",
  "square_enum_invalid",
  "square_identifier_invalid",
  "square_integer_invalid",
  "square_language_code_invalid",
  "square_parser_input_invalid",
  "square_provider_environment_invalid",
  "square_provider_errors_invalid",
  "square_provider_key_invalid",
  "square_required_field_missing",
  "square_response_accessor_rejected",
  "square_response_api_version_incompatible",
  "square_response_array_custom_property",
  "square_response_array_expected",
  "square_response_array_invalid",
  "square_response_array_sparse",
  "square_response_array_too_large",
  "square_response_cyclic",
  "square_response_internal_rejection",
  "square_response_json_type_invalid",
  "square_response_key_invalid",
  "square_response_nesting_too_deep",
  "square_response_number_invalid",
  "square_response_object_expected",
  "square_response_object_too_large",
  "square_response_string_invalid",
  "square_response_symbol_key_rejected",
  "square_response_too_many_values",
  "square_response_unexpected_prototype",
  "square_response_validation_failed",
  "square_timestamp_invalid",
  "square_timezone_invalid"
]);
const SQUARE_CATALOG_INTERNAL_REJECTION_RESULT = Object.freeze({
  outcome: "rejected" as const,
  diagnostics: Object.freeze([Object.freeze({ code: "square_response_internal_rejection", field: "$response" })])
}) satisfies SquareResponseFailureResult;

function catalogSafeObject(input: unknown, field: string): SquareSafeJsonObject {
  if (!catalogRawTreeIsSafe(input)) squareRejectResponse("square_catalog_raw_tree_invalid", field);
  const value = squareSafeJsonObject(input, field);
  if (!catalogRawTreeIsSafe(value)) squareRejectResponse("square_catalog_raw_tree_invalid", field);
  return value;
}
function catalogRawTreeIsSafe(root: unknown) {
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


function squareCatalogResultBoundary<T>(
  produceResult: (
    acceptedResult: SquareCatalogAcceptedResultFactory<T>
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
    const acceptedResult: SquareCatalogAcceptedResultFactory<T> = (value) => {
      if (!squareCatalogTraverseCanonicalTree({ value, diagnostics: [] }, "inspect")) {
        return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
      }
      const fingerprint = squareMinimizedProjectionFingerprint(value);
      const result = squareAcceptedResult(value);
      if (
        squareCatalogHasExactDataProperties(result, [
          "outcome",
          "value",
          "diagnostics"
        ]) &&
        squareCatalogDataProperty(result, "outcome") === "accepted" &&
        squareCatalogDataProperty(result, "value") === value
      ) {
        acceptance.present = true;
        acceptance.result = result;
        acceptance.value = value;
        acceptance.fingerprint = fingerprint;
      }
      return result;
    };
    return squareCatalogRootDiagnosticResult(
      produceResult(acceptedResult),
      acceptedSchema,
      acceptance
    );
  } catch {
    return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
  }
}

function squareCatalogRootDiagnosticResult<T>(
  result: unknown,
  acceptedSchema: z.ZodType<T>,
  acceptance: Readonly<{
    present: boolean;
    result: unknown;
    value: unknown;
    fingerprint: string | null;
  }>
): SquareResponseParserResult<T> {
  if (!squareCatalogHasExactDataProperties(result, ["outcome", "diagnostics"])) {
    if (
      !squareCatalogHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ])
    ) {
      return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
    }
  }

  const outcome = squareCatalogDataProperty(result, "outcome");
  if (outcome === "accepted") {
    const value = squareCatalogDataProperty(result, "value");
    if (
      !acceptance.present ||
      result !== acceptance.result ||
      value !== acceptance.value ||
      !squareCatalogHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ]) ||
      !squareCatalogIsEmptyFrozenArray(
        squareCatalogDataProperty(result, "diagnostics")
      ) ||
      !squareCatalogIsDeeplyFrozen(result) ||
      !acceptedSchema.safeParse(value).success ||
      squareMinimizedProjectionFingerprint(value) !== acceptance.fingerprint
    ) {
      return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
    }
    return result as SquareResponseParserResult<T>;
  }

  if (
    outcome !== "rejected" &&
    outcome !== "unsupported" &&
    outcome !== "incompatible-version"
  ) {
    return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;
  }

  const diagnostics = squareCatalogSanitizedDiagnostics(
    squareCatalogDataProperty(result, "diagnostics")
  );
  if (diagnostics === null) return SQUARE_CATALOG_INTERNAL_REJECTION_RESULT;

  return Object.freeze({
    outcome,
    diagnostics: Object.freeze(diagnostics)
  });
}

function squareCatalogSanitizedDiagnostics(
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
      !squareCatalogHasExactDataProperties(diagnostic, ["code", "field"])
    ) {
      return null;
    }
    const code = squareCatalogDataProperty(diagnostic, "code");
    const field = squareCatalogDataProperty(diagnostic, "field");
    if (
      typeof code !== "string" ||
      code.length > MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH ||
      !SQUARE_CATALOG_DIAGNOSTIC_CODES.has(code) ||
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

function squareCatalogHasExactDataProperties(
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

function squareCatalogDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string
) {
  if (isProxy(value)) {
    throw new TypeError("square_catalog_result_property_invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("square_catalog_result_property_invalid");
  }
  return descriptor.value;
}

function squareCatalogIsEmptyFrozenArray(value: unknown) {
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

function squareCatalogIsDeeplyFrozen(value: unknown) {
  return squareCatalogTraverseCanonicalTree(value, "verify");
}

function squareCatalogTraverseCanonicalTree(
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
    const children = squareCatalogCanonicalDataValues(candidate);
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

function squareCatalogCanonicalDataValues(value: object): readonly unknown[] | null {
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
