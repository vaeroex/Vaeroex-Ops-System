import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";

import {
  CanonicalIntegerSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_API_VERSION,
  SQUARE_ENVIRONMENTS,
  SQUARE_PROVIDER_KEY
} from "@/lib/integrations/providers/square/contracts";
import { assertSquareReadOperation } from "@/lib/integrations/providers/square/request-validators";
import {
  SquareCurrencyCodeSchema,
  SquareProviderEnvironmentSchema,
  SquareResponseProvenanceSchema,
  type SquareResponseFailureResult,
  type SquareResponseParserInput,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  type SquareSafeJsonObject,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableCurrencyCode,
  squareOptionalNullableTimestamp,
  squareRejectResponse,
  squareResponseParserInput,
  squareResponseProvenance,
  squareSafeJsonObject,
  squareUnsupportedResult
} from "@/lib/integrations/providers/square/response-validation";

export const SQUARE_REFUND_RESPONSE_CONTRACT_VERSION = "square_refund_response_v1" as const;
export const SQUARE_REFUND_MINIMIZATION_VERSION = "square_refund_minimizer_v1" as const;
export const SQUARE_REFUND_REQUEST_AUTHORITY_VERSION = "square_refund_request_authority_v1" as const;
export const SQUARE_REFUND_RESPONSE_SDK_VERSION = "45.1.0" as const;
export const SQUARE_REFUND_RESPONSE_SDK_REVISION = "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76" as const;
export const SQUARE_REFUND_RESPONSE_OPERATION_KEYS = Object.freeze(["list_payment_refunds", "retrieve_payment_refund"] as const);
// SDK fields are strings. These are the documented values supported by this projection,
// not a claim that the SDK defines closed enums.
export const SQUARE_REFUND_RESPONSE_STATUSES = Object.freeze(["PENDING", "COMPLETED", "REJECTED", "FAILED"] as const);
export const SQUARE_REFUND_RESPONSE_DESTINATION_TYPES = Object.freeze(["CARD", "BANK_ACCOUNT", "WALLET", "BUY_NOW_PAY_LATER", "SQUARE_ACCOUNT", "CASH", "EXTERNAL"] as const);
export const SQUARE_REFUND_PROCESSING_FEE_TYPES = Object.freeze(["INITIAL", "ADJUSTMENT"] as const);
export const SQUARE_REFUND_TRUSTED_FIELDS = Object.freeze([
  "id", "location_id", "unlinked", "payment_id", "order_id", "created_at", "updated_at", "status",
  "destination_type", "amount_money", "processing_fee"
] as const);
export const SQUARE_REFUND_RESPONSE_OFFICIAL_REFERENCES = Object.freeze([
  "https://developer.squareup.com/reference/square/objects/PaymentRefund",
  "https://developer.squareup.com/reference/square/objects/ProcessingFee",
  "https://developer.squareup.com/reference/square/objects/Money",
  "https://developer.squareup.com/reference/square/refunds-api/list-payment-refunds",
  "https://developer.squareup.com/reference/square/refunds-api/get-payment-refund",
  ...["api", "serialization"].flatMap((directory) =>
    ["PaymentRefund", "ProcessingFee", "Money", "ListPaymentRefundsResponse", "GetPaymentRefundResponse"].map((name) =>
      `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_REFUND_RESPONSE_SDK_REVISION}/src/${directory}/types/${name}.ts`
    )
  )
]);

const MAXIMUM_REFUND_ITEMS = 100;
const MAXIMUM_PROCESSING_FEES = 1_000;
const MAXIMUM_RESULT_DIAGNOSTICS = 100;
const MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH = 80;
const MAXIMUM_FROZEN_RESULT_DEPTH = 32;
const MAXIMUM_FROZEN_RESULT_ARRAY_LENGTH = 1_000;
const MAXIMUM_FROZEN_RESULT_OBJECT_PROPERTIES = 64;
const MAXIMUM_FROZEN_RESULT_STRING_LENGTH = 4_096;
// Derived before implementation: docs/architecture/square-refund-response-contract.md.
// List: R = 2 + 3P + A + F + M + Q + S <= 20,000; C = 7 + 5P + F + M + Q.
// P <= 100, A <= P, F <= 1,000A, M <= F, Q <= 2P. Thus
// C <= min(20,005 + 2P - A, 7 + 7P + 2,000A); maximum 20,195 at P=100,A=10.
// Get: one required refund/Money, <= 1,000 fees/Money and two references: C <= 2,014.
export const SQUARE_REFUND_MAXIMUM_RESULT_CONTAINERS = 20_195;
const MAXIMUM_FROZEN_RESULT_NODES = SQUARE_REFUND_MAXIMUM_RESULT_CONTAINERS;
const REFUND_CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const RefundIdSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/);
const ReferenceIdSchema = RefundIdSchema.max(192);
const LocationIdSchema = RefundIdSchema.max(50);
const SquareRefundOperationSchema = z.enum(SQUARE_REFUND_RESPONSE_OPERATION_KEYS);
const RefundLocationStateSchema = z.enum(["authorized_provider_location", "absent"]);
const safeIntegerText = (value: string) => {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const max = String(Number.MAX_SAFE_INTEGER);
  return unsigned.length < max.length || (unsigned.length === max.length && unsigned <= max);
};
export const SquareRefundMoneySchema = z.object({
  amountMinor: CanonicalIntegerSchema.refine(safeIntegerText).nullable(),
  currency: SquareCurrencyCodeSchema.nullable()
}).strict();
export const SquareRefundConnectionAuthoritySchema = z.object({
  workspaceId: UuidSchema,
  connectionId: UuidSchema,
  providerEntityType: z.literal("merchant"),
  providerEntityId: ReferenceIdSchema
}).strict();
const SquareRefundAuthoritySchema = SquareRefundConnectionAuthoritySchema.extend({
  providerKey: z.literal(SQUARE_PROVIDER_KEY),
  providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.literal("payment_refund"),
  identityState: z.literal("provider_id"),
  providerId: RefundIdSchema,
  locationState: RefundLocationStateSchema,
  locationId: LocationIdSchema.nullable()
}).strict();
export const SquareRefundOrderReferenceSchema = z.object({
  referenceType: z.literal("unverified_order_reference"),
  providerKey: z.literal(SQUARE_PROVIDER_KEY),
  providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.literal("order"),
  providerId: ReferenceIdSchema
}).strict();
export const SquareRefundPaymentReferenceSchema = z.object({
  referenceType: z.literal("unverified_payment_reference"),
  providerKey: z.literal(SQUARE_PROVIDER_KEY),
  providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.literal("payment"),
  providerId: ReferenceIdSchema
}).strict();
export const SquareRefundProcessingFeeSchema = z.object({
  effectiveAt: IsoTimestampSchema.nullable(),
  type: z.enum(SQUARE_REFUND_PROCESSING_FEE_TYPES).nullable(),
  amountMoney: SquareRefundMoneySchema.nullable()
}).strict();
export const SquareMinimizedPaymentRefundSchema = z.object({
  contractVersion: z.literal(SQUARE_REFUND_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_REFUND_MINIMIZATION_VERSION),
  entityType: z.literal("payment_refund"),
  entityVersion: z.literal(1),
  projectionScope: z.literal("provider_payment_refund_summary_only"),
  provider: SquareResponseProvenanceSchema,
  authority: SquareRefundAuthoritySchema,
  id: RefundIdSchema,
  locationId: LocationIdSchema.nullable(),
  orderReference: SquareRefundOrderReferenceSchema.nullable(),
  paymentReference: SquareRefundPaymentReferenceSchema.nullable(),
  unlinkedState: z.enum(["absent", "null", "provided"]),
  unlinked: z.boolean().nullable(),
  createdAt: IsoTimestampSchema.max(32).nullable(),
  updatedAt: IsoTimestampSchema.max(32).nullable(),
  status: z.enum(SQUARE_REFUND_RESPONSE_STATUSES).nullable(),
  destinationType: z.enum(SQUARE_REFUND_RESPONSE_DESTINATION_TYPES).nullable(),
  amountMoney: SquareRefundMoneySchema,
  financialSemantics: z.literal("provider_refund_summary_not_accounting_or_reconciliation"),
  processingFees: z.array(SquareRefundProcessingFeeSchema).max(MAXIMUM_PROCESSING_FEES),
  processingFeeCount: z.number().int().min(0).max(MAXIMUM_PROCESSING_FEES)
}).strict().refine((item) => item.unlinkedState === "provided" ? typeof item.unlinked === "boolean" : item.unlinked === null);
export const SquareRefundResponseSchema = z.object({
  contractVersion: z.literal(SQUARE_REFUND_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_REFUND_MINIMIZATION_VERSION),
  entityType: z.literal("refund_response"),
  operation: SquareRefundOperationSchema,
  provider: SquareResponseProvenanceSchema,
  connectionAuthority: SquareRefundConnectionAuthoritySchema,
  requestAuthorityVersion: z.literal(SQUARE_REFUND_REQUEST_AUTHORITY_VERSION),
  requestAuthorityFingerprint: Sha256FingerprintSchema,
  requestFingerprint: Sha256FingerprintSchema,
  cursorBindingFingerprint: Sha256FingerprintSchema,
  historyScope: z.literal("response_page_not_complete_refund_history"),
  pagination: z.object({
    cursorPresent: z.boolean(),
    cursorFingerprint: Sha256FingerprintSchema.nullable()
  }).strict(),
  items: z.array(SquareMinimizedPaymentRefundSchema).max(MAXIMUM_REFUND_ITEMS),
  itemCount: z.number().int().min(0).max(MAXIMUM_REFUND_ITEMS)
}).strict();
export type SquareMinimizedPaymentRefund = Readonly<z.infer<typeof SquareMinimizedPaymentRefundSchema>>;
export type SquareRefundResponse = Readonly<z.infer<typeof SquareRefundResponseSchema>>;
export type SquareRefundResponseOperation = z.infer<typeof SquareRefundOperationSchema>;
type ConnectionAuthority = z.infer<typeof SquareRefundConnectionAuthoritySchema>;
type SquareRefundAcceptedResultFactory<T> = (value: T) => SquareResponseParserResult<T>;
type RefundPolicy = Readonly<{
  authorizedLocationIds: ReadonlySet<string>;
  requestedLocationId: string | null;
  requestedRefundId: string | null;
  maximumItems: number;
  requestAuthorityFingerprint: string;
  requestFingerprint: string;
  cursorBindingFingerprint: string;
}>;

const SQUARE_REFUND_DIAGNOSTIC_CODES = new Set([
  "square_api_version_incompatible", "square_currency_invalid", "square_identifier_invalid",
  "square_parser_input_invalid", "square_provider_environment_invalid", "square_provider_key_invalid",
  "square_required_field_missing", "square_timestamp_invalid", "square_response_accessor_rejected",
  "square_response_array_custom_property", "square_response_array_sparse", "square_response_array_too_large",
  "square_response_cyclic", "square_response_internal_rejection", "square_response_json_type_invalid",
  "square_response_key_invalid", "square_response_nesting_too_deep", "square_response_number_invalid",
  "square_response_object_expected", "square_response_object_too_large", "square_response_string_invalid",
  "square_response_symbol_key_rejected", "square_response_too_many_values", "square_response_unexpected_prototype",
  "square_refund_input_invalid", "square_refund_raw_tree_invalid", "square_refund_request_invalid",
  "square_refund_enum_invalid", "square_refund_enum_unsupported", "square_refund_money_invalid",
  "square_refund_unlinked_invalid", "square_refund_identity_request_mismatch",
  "square_refund_location_authority_mismatch", "square_refund_location_request_mismatch",
  "square_refund_envelope_operation_mismatch", "square_refund_response_missing",
  "square_refund_array_invalid", "square_refund_duplicate_identity",
  "square_refund_provider_errors_invalid", "square_refund_provider_errors_present",
  "square_refund_cursor_invalid"
]);
const SQUARE_REFUND_INTERNAL_REJECTION_RESULT = Object.freeze({
  outcome: "rejected" as const,
  diagnostics: Object.freeze([Object.freeze({
    code: "square_response_internal_rejection", field: "$response"
  })])
}) satisfies SquareResponseFailureResult;

export function parseSquareRefundResponse(input: unknown): SquareResponseParserResult<SquareRefundResponse> {
  return squareRefundResultBoundary(
    (acceptedResult) => parseSquareRefundResponseResult(input, acceptedResult),
    SquareRefundResponseSchema
  );
}

function parseSquareRefundResponseResult(
  input: unknown,
  acceptedResult: SquareRefundAcceptedResultFactory<SquareRefundResponse>
): SquareResponseParserResult<SquareRefundResponse> {
  try {
    if (!squareRefundHasExactDataProperties(input, [
      "providerKey", "providerEnvironment", "apiVersion", "operation",
      "connectionAuthority", "requestContext", "response"
    ])) squareRejectResponse("square_refund_input_invalid", "$input");
    const base = squareResponseParserInput(input);
    const operationValue = squareRefundDataProperty(input, "operation");
    if (typeof operationValue !== "string") squareRejectResponse("square_refund_input_invalid", "$input");
    const operation = SquareRefundOperationSchema.parse(operationValue);
    const connectionAuthority = SquareRefundConnectionAuthoritySchema.parse(
      refundSafeObject(squareRefundDataProperty(input, "connectionAuthority"), "$input")
    );
    const policy = refundRequestPolicy(operation, refundSafeObject(
      squareRefundDataProperty(input, "requestContext"), "$input"
    ), base, connectionAuthority);
    const provider = squareResponseProvenance(base);
    const response = refundSafeObject(base.response, "$response");
    const errors = optionalObjectArray(response, "errors", 100);
    if (errors.length > 0) throw new SquareRefundUnsupportedProjectionFailure("square_refund_provider_errors_present", "$response");
    const forbidden = operation === "list_payment_refunds" ? ["refund"] : ["refunds", "cursor"];
    if (forbidden.some((key) => Object.hasOwn(response, key))) {
      squareRejectResponse("square_refund_envelope_operation_mismatch", "$response");
    }
    let rawItems: readonly SquareSafeJsonObject[];
    if (operation === "list_payment_refunds") {
      rawItems = optionalObjectArray(response, "refunds", policy.maximumItems);
    } else {
      if (!Object.hasOwn(response, "refund") || response.refund === null) {
        squareRejectResponse("square_refund_response_missing", "$response");
      }
      rawItems = [squareSafeJsonObject(response.refund)];
    }
    // The SDK documents mutually exclusive non-null List errors/refunds envelopes.
    if (operation === "list_payment_refunds" && response.errors != null && response.refunds != null) {
      squareRejectResponse("square_refund_envelope_operation_mismatch", "$response");
    }
    const seen = new Set<string>();
    const entries = rawItems.map((raw) => {
      const item = minimizeRefund(raw, provider, connectionAuthority, policy);
      if (seen.has(item.id)) squareRejectResponse("square_refund_duplicate_identity", "$response");
      seen.add(item.id);
      return { item, fingerprint: squareMinimizedProjectionFingerprint(item) };
    });
    entries.sort((a, b) => compareStrings(a.item.id, b.item.id) || compareStrings(a.fingerprint, b.fingerprint));
    const items = entries.map(({ item }) => item);
    const cursor = responseCursor(response, operation);
    return acceptedResult(SquareRefundResponseSchema.parse({
      contractVersion: SQUARE_REFUND_RESPONSE_CONTRACT_VERSION,
      minimizationVersion: SQUARE_REFUND_MINIMIZATION_VERSION,
      entityType: "refund_response", operation, provider, connectionAuthority,
      requestAuthorityVersion: SQUARE_REFUND_REQUEST_AUTHORITY_VERSION,
      requestAuthorityFingerprint: policy.requestAuthorityFingerprint,
      requestFingerprint: policy.requestFingerprint,
      cursorBindingFingerprint: policy.cursorBindingFingerprint,
      historyScope: "response_page_not_complete_refund_history",
      pagination: {
        cursorPresent: cursor !== null,
        cursorFingerprint: cursor === null ? null : refundCursorFingerprint(policy.requestAuthorityFingerprint, cursor)
      },
      items, itemCount: items.length
    }));
  } catch (error) {
    if (error !== null && (typeof error === "object" || typeof error === "function") && isProxy(error)) {
      return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
    }
    if (error instanceof SquareRefundUnsupportedProjectionFailure) {
      return squareUnsupportedResult(error.code, error.field);
    }
    return squareFailureResult(error);
  }
}

function refundRequestPolicy(
  operation: SquareRefundResponseOperation,
  context: SquareSafeJsonObject,
  base: SquareResponseParserInput,
  connectionAuthority: ConnectionAuthority
): RefundPolicy {
  const list = operation === "list_payment_refunds";
  const allowed = list
    ? ["authorizedLocationIds", "locationId", "query", "expectedCursorBindingFingerprint", "expectedResponseCursorFingerprint"]
    : ["authorizedLocationIds", "refundId"];
  if (Object.keys(context).some((key) => !allowed.includes(key))) {
    squareRejectResponse("square_refund_input_invalid", "$input");
  }
  const locations = context.authorizedLocationIds;
  if (!Array.isArray(locations) || locations.length < 1 || locations.length > 1_000 ||
      locations.some((id) => typeof id !== "string" || !LocationIdSchema.safeParse(id).success)) {
    squareRejectResponse("square_refund_input_invalid", "$input");
  }
  const authorizedLocationIds = new Set(locations as string[]);
  if (authorizedLocationIds.size !== locations.length) squareRejectResponse("square_refund_input_invalid", "$input");
  const requestedRefundId = list ? null : inputIdentifier(context.refundId, RefundIdSchema);
  // Unlike Payments, omission means all seller locations, never the main location.
  // The trusted requested location must agree with the actual query in both cases.
  const requestedLocationId = list && context.locationId != null ? inputIdentifier(context.locationId, LocationIdSchema) : null;
  if (requestedLocationId !== null && !authorizedLocationIds.has(requestedLocationId)) {
    squareRejectResponse("square_refund_location_authority_mismatch", "$input");
  }
  const query = list ? squareSafeJsonObject(context.query, "$input") : {};
  if (Object.values(query).some((value) => typeof value !== "string")) {
    squareRejectResponse("square_refund_request_invalid", "$input");
  }
  if ((query.location_id ?? null) !== requestedLocationId) {
    squareRejectResponse("square_refund_location_request_mismatch", "$input");
  }
  const expectedCursor = context.expectedCursorBindingFingerprint;
  const expectedResponseCursor = context.expectedResponseCursorFingerprint;
  for (const fingerprint of [expectedCursor, expectedResponseCursor]) {
    if (fingerprint !== undefined && fingerprint !== null &&
        (typeof fingerprint !== "string" || !Sha256FingerprintSchema.safeParse(fingerprint).success)) {
      squareRejectResponse("square_refund_request_invalid", "$input");
    }
  }
  // The established request policy consumes literal queries (including RFC3339
  // colons and cursor padding), not percent-encoded URLSearchParams output.
  // Disallow separators before assembly so a value cannot inject another query key.
  if (Object.entries(query).some(([key, value]) =>
    !/^[A-Za-z0-9_]+$/.test(key) || /[&#%?\\]/.test(value as string)
  )) squareRejectResponse("square_refund_request_invalid", "$input");
  const path = `https://${SQUARE_ENVIRONMENTS[base.providerEnvironment].hostname}/v2/refunds${list ? "" : `/${requestedRefundId}`}`;
  const requestUrl = (includeCursor: boolean) => {
    const parts = Object.keys(query).sort().filter((key) => includeCursor || key !== "cursor")
      .map((key) => `${key}=${query[key]}`);
    return path + (parts.length > 0 ? `?${parts.join("&")}` : "");
  };
  let decision: ReturnType<typeof assertSquareReadOperation>;
  let queryDecision: ReturnType<typeof assertSquareReadOperation>;
  try {
    decision = assertSquareReadOperation({
      providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: base.providerEnvironment,
      method: "GET", url: requestUrl(true), headers: { "Square-Version": SQUARE_API_VERSION },
      expectedCursorBindingFingerprint: expectedCursor as string | null | undefined
    });
    queryDecision = assertSquareReadOperation({
      providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: base.providerEnvironment,
      method: "GET", url: requestUrl(false), headers: { "Square-Version": SQUARE_API_VERSION }
    });
  } catch {
    squareRejectResponse("square_refund_request_invalid", "$input");
  }
  if (decision.operationKey !== operation) squareRejectResponse("square_refund_request_invalid", "$input");
  // Existing request/cursor contracts remain byte-for-byte unchanged. Include the full
  // cursor-free request fingerprint as well: it covers status/source/sort filters that
  // the older cursor binding omits, and bind identities/tenant explicitly.
  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_refund_request_authority",
    fingerprintVersion: SQUARE_REFUND_REQUEST_AUTHORITY_VERSION,
    provider: squareResponseProvenance(base), operation, connectionAuthority,
    authorizedLocationIds: [...authorizedLocationIds].sort(),
    requestedRefundId, requestedLocationId,
    cursorBindingFingerprint: queryDecision.cursorBindingFingerprint,
    queryFingerprint: queryDecision.requestFingerprint
  });
  if (query.cursor !== undefined) {
    if (expectedResponseCursor !== refundCursorFingerprint(requestAuthorityFingerprint, query.cursor as string)) {
      squareRejectResponse("square_refund_cursor_invalid", "$input");
    }
  } else if (expectedResponseCursor !== undefined && expectedResponseCursor !== null) {
    squareRejectResponse("square_refund_cursor_invalid", "$input");
  }
  return {
    authorizedLocationIds, requestedRefundId, requestedLocationId,
    maximumItems: list ? Number(query.limit ?? 100) : 1,
    requestAuthorityFingerprint, requestFingerprint: decision.requestFingerprint,
    cursorBindingFingerprint: decision.cursorBindingFingerprint
  };
}

function minimizeRefund(
  raw: SquareSafeJsonObject,
  provider: SquareResponseProvenance,
  connection: ConnectionAuthority,
  policy: RefundPolicy
): SquareMinimizedPaymentRefund {
  const id = optionalIdentifier(raw, "id", RefundIdSchema);
  if (id === null) squareRejectResponse("square_required_field_missing", "$response");
  const amountMoney = optionalMoney(raw, "amount_money");
  if (amountMoney === null) squareRejectResponse("square_required_field_missing", "$response");
  const unlinkedState = !Object.hasOwn(raw, "unlinked") ? "absent" : raw.unlinked === null ? "null" : "provided";
  if (unlinkedState === "provided" && typeof raw.unlinked !== "boolean") squareRejectResponse("square_refund_unlinked_invalid", "$response");
  const locationId = optionalIdentifier(raw, "location_id", LocationIdSchema);
  if (policy.requestedRefundId !== null) {
    if (id !== policy.requestedRefundId) squareRejectResponse("square_refund_identity_request_mismatch", "$response");
  }
  if (locationId !== null) {
    if (!policy.authorizedLocationIds.has(locationId)) squareRejectResponse("square_refund_location_authority_mismatch", "$response");
    if (policy.requestedLocationId !== null && locationId !== policy.requestedLocationId) {
      squareRejectResponse("square_refund_location_request_mismatch", "$response");
    }
  }
  const orderId = optionalIdentifier(raw, "order_id", ReferenceIdSchema);
  const paymentId = optionalIdentifier(raw, "payment_id", ReferenceIdSchema);
  const processingFees = optionalObjectArray(raw, "processing_fee", MAXIMUM_PROCESSING_FEES).map((fee) => ({
    effectiveAt: refundTimestamp(fee, "effective_at", 4_096),
    type: optionalEnum(fee, "type", SQUARE_REFUND_PROCESSING_FEE_TYPES, 4_096),
    amountMoney: optionalMoney(fee, "amount_money")
  }));
  // Fees have no provider IDs: retain the multiset, including identical adjustments.
  const fees = processingFees.map((fee) => ({ fee, fingerprint: squareMinimizedProjectionFingerprint(fee) }));
  fees.sort((a, b) => compareStrings(a.fingerprint, b.fingerprint));
  return SquareMinimizedPaymentRefundSchema.parse({
    contractVersion: SQUARE_REFUND_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_REFUND_MINIMIZATION_VERSION,
    entityType: "payment_refund", entityVersion: 1, projectionScope: "provider_payment_refund_summary_only",
    provider,
    authority: {
      ...connection, providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: provider.providerEnvironment,
      entityType: "payment_refund", identityState: "provider_id", providerId: id,
      locationState: locationId === null ? "absent" : "authorized_provider_location", locationId
    },
    id, locationId, unlinkedState, unlinked: unlinkedState === "provided" ? raw.unlinked : null,
    paymentReference: paymentId === null ? null : {
      referenceType: "unverified_payment_reference", providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provider.providerEnvironment, entityType: "payment", providerId: paymentId
    },
    orderReference: orderId === null ? null : {
      referenceType: "unverified_order_reference", providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provider.providerEnvironment, entityType: "order", providerId: orderId
    },
    createdAt: refundTimestamp(raw, "created_at", 32),
    updatedAt: refundTimestamp(raw, "updated_at", 32),
    status: optionalEnum(raw, "status", SQUARE_REFUND_RESPONSE_STATUSES, 50),
    destinationType: optionalEnum(raw, "destination_type", SQUARE_REFUND_RESPONSE_DESTINATION_TYPES, 50),
    amountMoney, financialSemantics: "provider_refund_summary_not_accounting_or_reconciliation",
    processingFees: fees.map(({ fee }) => fee), processingFeeCount: fees.length
  });
}

function optionalMoney(record: SquareSafeJsonObject, key: string) {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  const money = squareSafeJsonObject(record[key]);
  const amount = money.amount;
  if (amount !== undefined && amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount))) {
    squareRejectResponse("square_refund_money_invalid", "$response");
  }
  return {
    amountMinor: amount === undefined || amount === null ? null : String(amount),
    currency: squareOptionalNullableCurrencyCode(money, "currency", "$response")
  };
}

function optionalIdentifier(record: SquareSafeJsonObject, key: string, schema: z.ZodType<string>) {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "string" || !schema.safeParse(value).success) squareRejectResponse("square_identifier_invalid", "$response");
  return value;
}
function inputIdentifier(value: unknown, schema: z.ZodType<string>) {
  if (typeof value !== "string" || !schema.safeParse(value).success) squareRejectResponse("square_refund_input_invalid", "$input");
  return value;
}
function optionalEnum<T extends string>(record: SquareSafeJsonObject, key: string, values: readonly T[], maximum: number): T | null {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    squareRejectResponse("square_refund_enum_invalid", "$response");
  }
  if (!values.includes(value as T)) throw new SquareRefundUnsupportedProjectionFailure("square_refund_enum_unsupported", "$response");
  return value as T;
}
function refundTimestamp(record: SquareSafeJsonObject, key: string, maximum: number) {
  if (typeof record[key] === "string" && record[key].length > maximum) {
    squareRejectResponse("square_timestamp_invalid", "$response");
  }
  return squareOptionalNullableTimestamp(record, key, "$response");
}
function optionalObjectArray(record: SquareSafeJsonObject, key: string, maximum: number): readonly SquareSafeJsonObject[] {
  if (!Object.hasOwn(record, key) || record[key] === null) return [];
  const value = record[key];
  if (!Array.isArray(value) || value.length > maximum) {
    squareRejectResponse(key === "errors" ? "square_refund_provider_errors_invalid" : "square_refund_array_invalid", "$response");
  }
  return value.map((item) => squareSafeJsonObject(item));
}
function responseCursor(response: SquareSafeJsonObject, operation: SquareRefundResponseOperation) {
  if (operation !== "list_payment_refunds" || !Object.hasOwn(response, "cursor") || response.cursor === null || response.cursor === "") return null;
  if (typeof response.cursor !== "string" || !REFUND_CURSOR_PATTERN.test(response.cursor)) squareRejectResponse("square_refund_cursor_invalid", "$response");
  return response.cursor;
}
function refundCursorFingerprint(requestAuthorityFingerprint: string, cursor: string) {
  return squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_refund_response_cursor",
    fingerprintVersion: "square_refund_response_cursor_v1",
    requestAuthorityFingerprint, cursor
  });
}
function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Proxy rejection precedes every reflection on raw context/response. The established
// sanitizer still performs the canonical copy/key checks. Both count aliases per path.
function refundSafeObject(input: unknown, field: string): SquareSafeJsonObject {
  if (!refundRawTreeIsSafe(input)) squareRejectResponse("square_refund_raw_tree_invalid", field);
  const value = squareSafeJsonObject(input, field);
  if (!refundRawTreeIsSafe(value)) squareRejectResponse("square_refund_raw_tree_invalid", field);
  return value;
}
function refundRawTreeIsSafe(root: unknown) {
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

export function squareRefundFingerprint(input: SquareMinimizedPaymentRefund) {
  if (!squareRefundTraverseCanonicalTree(input, "inspect")) throw new TypeError("square_refund_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareMinimizedPaymentRefundSchema.parse(input));
}
export function squareRefundResponseFingerprint(input: SquareRefundResponse) {
  if (!squareRefundTraverseCanonicalTree({ value: input, diagnostics: [] }, "inspect")) throw new TypeError("square_refund_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareRefundResponseSchema.parse(input));
}

function squareRefundResultBoundary<T>(
  produceResult: (
    acceptedResult: SquareRefundAcceptedResultFactory<T>
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
    const acceptedResult: SquareRefundAcceptedResultFactory<T> = (value) => {
      if (!squareRefundTraverseCanonicalTree({ value, diagnostics: [] }, "inspect")) {
        return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
      }
      const fingerprint = squareMinimizedProjectionFingerprint(value);
      const result = squareAcceptedResult(value);
      if (
        squareRefundHasExactDataProperties(result, [
          "outcome",
          "value",
          "diagnostics"
        ]) &&
        squareRefundDataProperty(result, "outcome") === "accepted" &&
        squareRefundDataProperty(result, "value") === value
      ) {
        acceptance.present = true;
        acceptance.result = result;
        acceptance.value = value;
        acceptance.fingerprint = fingerprint;
      }
      return result;
    };
    return squareRefundRootDiagnosticResult(
      produceResult(acceptedResult),
      acceptedSchema,
      acceptance
    );
  } catch {
    return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
  }
}

function squareRefundRootDiagnosticResult<T>(
  result: unknown,
  acceptedSchema: z.ZodType<T>,
  acceptance: Readonly<{
    present: boolean;
    result: unknown;
    value: unknown;
    fingerprint: string | null;
  }>
): SquareResponseParserResult<T> {
  if (!squareRefundHasExactDataProperties(result, ["outcome", "diagnostics"])) {
    if (
      !squareRefundHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ])
    ) {
      return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
    }
  }

  const outcome = squareRefundDataProperty(result, "outcome");
  if (outcome === "accepted") {
    const value = squareRefundDataProperty(result, "value");
    if (
      !acceptance.present ||
      result !== acceptance.result ||
      value !== acceptance.value ||
      !squareRefundHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ]) ||
      !squareRefundIsEmptyFrozenArray(
        squareRefundDataProperty(result, "diagnostics")
      ) ||
      !squareRefundIsDeeplyFrozen(result) ||
      !acceptedSchema.safeParse(value).success ||
      squareMinimizedProjectionFingerprint(value) !== acceptance.fingerprint
    ) {
      return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
    }
    return result as SquareResponseParserResult<T>;
  }

  if (
    outcome !== "rejected" &&
    outcome !== "unsupported" &&
    outcome !== "incompatible-version"
  ) {
    return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;
  }

  const diagnostics = squareRefundSanitizedDiagnostics(
    squareRefundDataProperty(result, "diagnostics")
  );
  if (diagnostics === null) return SQUARE_REFUND_INTERNAL_REJECTION_RESULT;

  return Object.freeze({
    outcome,
    diagnostics: Object.freeze(diagnostics)
  });
}

function squareRefundSanitizedDiagnostics(
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
      !squareRefundHasExactDataProperties(diagnostic, ["code", "field"])
    ) {
      return null;
    }
    const code = squareRefundDataProperty(diagnostic, "code");
    const field = squareRefundDataProperty(diagnostic, "field");
    if (
      typeof code !== "string" ||
      code.length > MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH ||
      !SQUARE_REFUND_DIAGNOSTIC_CODES.has(code) ||
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

function squareRefundHasExactDataProperties(
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

function squareRefundDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string
) {
  if (isProxy(value)) {
    throw new TypeError("square_refund_result_property_invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("square_refund_result_property_invalid");
  }
  return descriptor.value;
}

function squareRefundIsEmptyFrozenArray(value: unknown) {
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

function squareRefundIsDeeplyFrozen(value: unknown) {
  return squareRefundTraverseCanonicalTree(value, "verify");
}

function squareRefundTraverseCanonicalTree(
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
    const children = squareRefundCanonicalDataValues(candidate);
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

function squareRefundCanonicalDataValues(value: object): readonly unknown[] | null {
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

class SquareRefundUnsupportedProjectionFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_refund_projection_unsupported");
    this.name = "SquareRefundUnsupportedProjectionFailure";
    this.code = code;
    this.field = field;
  }
}
