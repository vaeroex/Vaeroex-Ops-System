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

export const SQUARE_PAYMENT_RESPONSE_CONTRACT_VERSION = "square_payment_response_v1" as const;
export const SQUARE_PAYMENT_MINIMIZATION_VERSION = "square_payment_minimizer_v1" as const;
export const SQUARE_PAYMENT_REQUEST_AUTHORITY_VERSION = "square_payment_request_authority_v1" as const;
export const SQUARE_PAYMENT_RESPONSE_SDK_VERSION = "45.1.0" as const;
export const SQUARE_PAYMENT_RESPONSE_SDK_REVISION = "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76" as const;
export const SQUARE_PAYMENT_RESPONSE_OPERATION_KEYS = Object.freeze(["list_payments", "retrieve_payment"] as const);
// SDK fields are strings. These are the documented values supported by this projection,
// not a claim that the SDK defines closed enums.
export const SQUARE_PAYMENT_RESPONSE_STATUSES = Object.freeze(["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"] as const);
export const SQUARE_PAYMENT_RESPONSE_SOURCE_TYPES = Object.freeze(["CARD", "BANK_ACCOUNT", "WALLET", "BUY_NOW_PAY_LATER", "SQUARE_ACCOUNT", "CASH", "EXTERNAL"] as const);
export const SQUARE_PAYMENT_PROCESSING_FEE_TYPES = Object.freeze(["INITIAL", "ADJUSTMENT"] as const);
export const SQUARE_PAYMENT_TRUSTED_FIELDS = Object.freeze([
  "id", "location_id", "order_id", "created_at", "updated_at", "status", "source_type",
  "amount_money", "tip_money", "total_money", "refunded_money", "processing_fee"
] as const);
export const SQUARE_PAYMENT_RESPONSE_OFFICIAL_REFERENCES = Object.freeze([
  "https://developer.squareup.com/reference/square/objects/Payment",
  "https://developer.squareup.com/reference/square/objects/ProcessingFee",
  "https://developer.squareup.com/reference/square/objects/Money",
  "https://developer.squareup.com/reference/square/payments-api/list-payments",
  "https://developer.squareup.com/reference/square/payments-api/get-payment",
  ...["api", "serialization"].flatMap((directory) =>
    ["Payment", "ProcessingFee", "Money", "ListPaymentsResponse", "GetPaymentResponse"].map((name) =>
      `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_PAYMENT_RESPONSE_SDK_REVISION}/src/${directory}/types/${name}.ts`
    )
  )
]);

const MAXIMUM_PAYMENT_ITEMS = 100;
const MAXIMUM_PROCESSING_FEES = 1_000;
const MAXIMUM_RESULT_DIAGNOSTICS = 100;
const MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH = 80;
const MAXIMUM_FROZEN_RESULT_DEPTH = 32;
const MAXIMUM_FROZEN_RESULT_ARRAY_LENGTH = 1_000;
const MAXIMUM_FROZEN_RESULT_OBJECT_PROPERTIES = 64;
const MAXIMUM_FROZEN_RESULT_STRING_LENGTH = 4_096;
// Derived before implementation: docs/architecture/square-payment-response-contract.md.
// List: R = 2 + P + A + F + M + Q + S <= 20,000.
// C = 7 + 4P + F + M + Q; P <= 100, F <= 1,000A, M <= F + 4P, Q <= P.
// Exhausting the raw budget needs >= 10 fee arrays at P=100. C <= 20,295.
// Get has one Payment, <= 1,000 fees, <= 1,004 Money, one reference: C <= 2,016.
export const SQUARE_PAYMENT_MAXIMUM_RESULT_CONTAINERS = 20_295;
const MAXIMUM_FROZEN_RESULT_NODES = SQUARE_PAYMENT_MAXIMUM_RESULT_CONTAINERS;
const PAYMENT_CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const PaymentIdSchema = z.string().min(1).max(192).regex(/^[A-Za-z0-9._:-]+$/);
const LocationIdSchema = PaymentIdSchema.max(50);
const SquarePaymentOperationSchema = z.enum(SQUARE_PAYMENT_RESPONSE_OPERATION_KEYS);
const PaymentIdentityStateSchema = z.enum(["provider_id", "absent"]);
const PaymentLocationStateSchema = z.enum(["authorized_provider_location", "absent"]);
const safeIntegerText = (value: string) => {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  const max = String(Number.MAX_SAFE_INTEGER);
  return unsigned.length < max.length || (unsigned.length === max.length && unsigned <= max);
};
export const SquarePaymentMoneySchema = z.object({
  amountMinor: CanonicalIntegerSchema.refine(safeIntegerText).nullable(),
  currency: SquareCurrencyCodeSchema.nullable()
}).strict();
export const SquarePaymentConnectionAuthoritySchema = z.object({
  workspaceId: UuidSchema,
  connectionId: UuidSchema,
  providerEntityType: z.literal("merchant"),
  providerEntityId: PaymentIdSchema
}).strict();
const SquarePaymentAuthoritySchema = SquarePaymentConnectionAuthoritySchema.extend({
  providerKey: z.literal(SQUARE_PROVIDER_KEY),
  providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.literal("payment"),
  identityState: PaymentIdentityStateSchema,
  providerId: PaymentIdSchema.nullable(),
  locationState: PaymentLocationStateSchema,
  locationId: LocationIdSchema.nullable()
}).strict();
export const SquarePaymentOrderReferenceSchema = z.object({
  referenceType: z.literal("unverified_order_reference"),
  providerKey: z.literal(SQUARE_PROVIDER_KEY),
  providerEnvironment: SquareProviderEnvironmentSchema,
  entityType: z.literal("order"),
  providerId: PaymentIdSchema
}).strict();
export const SquarePaymentProcessingFeeSchema = z.object({
  effectiveAt: IsoTimestampSchema.nullable(),
  type: z.enum(SQUARE_PAYMENT_PROCESSING_FEE_TYPES).nullable(),
  amountMoney: SquarePaymentMoneySchema.nullable()
}).strict();
export const SquareMinimizedPaymentSchema = z.object({
  contractVersion: z.literal(SQUARE_PAYMENT_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_PAYMENT_MINIMIZATION_VERSION),
  entityType: z.literal("payment"),
  entityVersion: z.literal(1),
  projectionScope: z.literal("provider_payment_summary_only"),
  provider: SquareResponseProvenanceSchema,
  authority: SquarePaymentAuthoritySchema,
  id: PaymentIdSchema.nullable(),
  locationId: LocationIdSchema.nullable(),
  orderReference: SquarePaymentOrderReferenceSchema.nullable(),
  createdAt: IsoTimestampSchema.max(32).nullable(),
  updatedAt: IsoTimestampSchema.max(32).nullable(),
  status: z.enum(SQUARE_PAYMENT_RESPONSE_STATUSES).nullable(),
  sourceType: z.enum(SQUARE_PAYMENT_RESPONSE_SOURCE_TYPES).nullable(),
  amountMoney: SquarePaymentMoneySchema.nullable(),
  tipMoney: SquarePaymentMoneySchema.nullable(),
  totalMoney: SquarePaymentMoneySchema.nullable(),
  refundedMoney: SquarePaymentMoneySchema.nullable(),
  refundedMoneySemantics: z.literal("provider_aggregate_not_verified_refunds"),
  processingFees: z.array(SquarePaymentProcessingFeeSchema).max(MAXIMUM_PROCESSING_FEES),
  processingFeeCount: z.number().int().min(0).max(MAXIMUM_PROCESSING_FEES)
}).strict();
export const SquarePaymentResponseSchema = z.object({
  contractVersion: z.literal(SQUARE_PAYMENT_RESPONSE_CONTRACT_VERSION),
  minimizationVersion: z.literal(SQUARE_PAYMENT_MINIMIZATION_VERSION),
  entityType: z.literal("payment_response"),
  operation: SquarePaymentOperationSchema,
  provider: SquareResponseProvenanceSchema,
  connectionAuthority: SquarePaymentConnectionAuthoritySchema,
  requestAuthorityVersion: z.literal(SQUARE_PAYMENT_REQUEST_AUTHORITY_VERSION),
  requestAuthorityFingerprint: Sha256FingerprintSchema,
  requestFingerprint: Sha256FingerprintSchema,
  cursorBindingFingerprint: Sha256FingerprintSchema,
  pagination: z.object({
    cursorPresent: z.boolean(),
    cursorFingerprint: Sha256FingerprintSchema.nullable()
  }).strict(),
  items: z.array(SquareMinimizedPaymentSchema).max(MAXIMUM_PAYMENT_ITEMS),
  itemCount: z.number().int().min(0).max(MAXIMUM_PAYMENT_ITEMS)
}).strict();
export type SquareMinimizedPayment = Readonly<z.infer<typeof SquareMinimizedPaymentSchema>>;
export type SquarePaymentResponse = Readonly<z.infer<typeof SquarePaymentResponseSchema>>;
export type SquarePaymentResponseOperation = z.infer<typeof SquarePaymentOperationSchema>;
type ConnectionAuthority = z.infer<typeof SquarePaymentConnectionAuthoritySchema>;
type SquarePaymentAcceptedResultFactory<T> = (value: T) => SquareResponseParserResult<T>;
type PaymentPolicy = Readonly<{
  authorizedLocationIds: ReadonlySet<string>;
  requestedLocationId: string | null;
  requestedPaymentId: string | null;
  maximumItems: number;
  requestAuthorityFingerprint: string;
  requestFingerprint: string;
  cursorBindingFingerprint: string;
}>;

const SQUARE_PAYMENT_DIAGNOSTIC_CODES = new Set([
  "square_api_version_incompatible", "square_currency_invalid", "square_identifier_invalid",
  "square_parser_input_invalid", "square_provider_environment_invalid", "square_provider_key_invalid",
  "square_required_field_missing", "square_timestamp_invalid", "square_response_accessor_rejected",
  "square_response_array_custom_property", "square_response_array_sparse", "square_response_array_too_large",
  "square_response_cyclic", "square_response_internal_rejection", "square_response_json_type_invalid",
  "square_response_key_invalid", "square_response_nesting_too_deep", "square_response_number_invalid",
  "square_response_object_expected", "square_response_object_too_large", "square_response_string_invalid",
  "square_response_symbol_key_rejected", "square_response_too_many_values", "square_response_unexpected_prototype",
  "square_payment_input_invalid", "square_payment_raw_tree_invalid", "square_payment_request_invalid",
  "square_payment_enum_invalid", "square_payment_enum_unsupported", "square_payment_money_invalid",
  "square_payment_identity_missing", "square_payment_identity_request_mismatch",
  "square_payment_location_authority_mismatch", "square_payment_location_request_mismatch",
  "square_payment_envelope_operation_mismatch", "square_payment_response_missing",
  "square_payment_array_invalid", "square_payment_duplicate_identity",
  "square_payment_provider_errors_invalid", "square_payment_provider_errors_present",
  "square_payment_cursor_invalid"
]);
const SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT = Object.freeze({
  outcome: "rejected" as const,
  diagnostics: Object.freeze([Object.freeze({
    code: "square_response_internal_rejection", field: "$response"
  })])
}) satisfies SquareResponseFailureResult;

export function parseSquarePaymentResponse(input: unknown): SquareResponseParserResult<SquarePaymentResponse> {
  return squarePaymentResultBoundary(
    (acceptedResult) => parseSquarePaymentResponseResult(input, acceptedResult),
    SquarePaymentResponseSchema
  );
}

function parseSquarePaymentResponseResult(
  input: unknown,
  acceptedResult: SquarePaymentAcceptedResultFactory<SquarePaymentResponse>
): SquareResponseParserResult<SquarePaymentResponse> {
  try {
    if (!squarePaymentHasExactDataProperties(input, [
      "providerKey", "providerEnvironment", "apiVersion", "operation",
      "connectionAuthority", "requestContext", "response"
    ])) squareRejectResponse("square_payment_input_invalid", "$input");
    const base = squareResponseParserInput(input);
    const operationValue = squarePaymentDataProperty(input, "operation");
    if (typeof operationValue !== "string") squareRejectResponse("square_payment_input_invalid", "$input");
    const operation = SquarePaymentOperationSchema.parse(operationValue);
    const connectionAuthority = SquarePaymentConnectionAuthoritySchema.parse(
      paymentSafeObject(squarePaymentDataProperty(input, "connectionAuthority"), "$input")
    );
    const policy = paymentRequestPolicy(operation, paymentSafeObject(
      squarePaymentDataProperty(input, "requestContext"), "$input"
    ), base, connectionAuthority);
    const provider = squareResponseProvenance(base);
    const response = paymentSafeObject(base.response, "$response");
    const errors = optionalObjectArray(response, "errors", 100);
    if (errors.length > 0) throw new SquarePaymentUnsupportedProjectionFailure("square_payment_provider_errors_present", "$response");
    const forbidden = operation === "list_payments" ? ["payment"] : ["payments", "cursor"];
    if (forbidden.some((key) => Object.hasOwn(response, key))) {
      squareRejectResponse("square_payment_envelope_operation_mismatch", "$response");
    }
    let rawItems: readonly SquareSafeJsonObject[];
    if (operation === "list_payments") {
      rawItems = optionalObjectArray(response, "payments", policy.maximumItems);
    } else {
      if (!Object.hasOwn(response, "payment") || response.payment === null) {
        squareRejectResponse("square_payment_response_missing", "$response");
      }
      rawItems = [squareSafeJsonObject(response.payment)];
    }
    const seen = new Set<string>();
    const entries = rawItems.map((raw) => {
      const item = minimizePayment(raw, provider, connectionAuthority, policy);
      if (item.id !== null) {
        if (seen.has(item.id)) squareRejectResponse("square_payment_duplicate_identity", "$response");
        seen.add(item.id);
      }
      return { item, fingerprint: squareMinimizedProjectionFingerprint(item) };
    });
    entries.sort((a, b) => compareStrings(a.item.id ?? "", b.item.id ?? "") || compareStrings(a.fingerprint, b.fingerprint));
    const items = entries.map(({ item }) => item);
    const cursor = responseCursor(response, operation);
    return acceptedResult(SquarePaymentResponseSchema.parse({
      contractVersion: SQUARE_PAYMENT_RESPONSE_CONTRACT_VERSION,
      minimizationVersion: SQUARE_PAYMENT_MINIMIZATION_VERSION,
      entityType: "payment_response", operation, provider, connectionAuthority,
      requestAuthorityVersion: SQUARE_PAYMENT_REQUEST_AUTHORITY_VERSION,
      requestAuthorityFingerprint: policy.requestAuthorityFingerprint,
      requestFingerprint: policy.requestFingerprint,
      cursorBindingFingerprint: policy.cursorBindingFingerprint,
      pagination: {
        cursorPresent: cursor !== null,
        cursorFingerprint: cursor === null ? null : paymentCursorFingerprint(policy.requestAuthorityFingerprint, cursor)
      },
      items, itemCount: items.length
    }));
  } catch (error) {
    if (error !== null && (typeof error === "object" || typeof error === "function") && isProxy(error)) {
      return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
    }
    if (error instanceof SquarePaymentUnsupportedProjectionFailure) {
      return squareUnsupportedResult(error.code, error.field);
    }
    return squareFailureResult(error);
  }
}

function paymentRequestPolicy(
  operation: SquarePaymentResponseOperation,
  context: SquareSafeJsonObject,
  base: SquareResponseParserInput,
  connectionAuthority: ConnectionAuthority
): PaymentPolicy {
  const list = operation === "list_payments";
  const allowed = list
    ? ["authorizedLocationIds", "locationId", "query", "expectedCursorBindingFingerprint", "expectedResponseCursorFingerprint"]
    : ["authorizedLocationIds", "paymentId"];
  if (Object.keys(context).some((key) => !allowed.includes(key))) {
    squareRejectResponse("square_payment_input_invalid", "$input");
  }
  const locations = context.authorizedLocationIds;
  if (!Array.isArray(locations) || locations.length < 1 || locations.length > 1_000 ||
      locations.some((id) => typeof id !== "string" || !LocationIdSchema.safeParse(id).success)) {
    squareRejectResponse("square_payment_input_invalid", "$input");
  }
  const authorizedLocationIds = new Set(locations as string[]);
  if (authorizedLocationIds.size !== locations.length) squareRejectResponse("square_payment_input_invalid", "$input");
  const requestedPaymentId = list ? null : inputIdentifier(context.paymentId, PaymentIdSchema);
  const requestedLocationId = list ? inputIdentifier(context.locationId, LocationIdSchema) : null;
  if (requestedLocationId !== null && !authorizedLocationIds.has(requestedLocationId)) {
    squareRejectResponse("square_payment_location_authority_mismatch", "$input");
  }
  const query = list ? squareSafeJsonObject(context.query, "$input") : {};
  if (Object.values(query).some((value) => typeof value !== "string")) {
    squareRejectResponse("square_payment_request_invalid", "$input");
  }
  if (query.location_id !== undefined && query.location_id !== requestedLocationId) {
    squareRejectResponse("square_payment_location_request_mismatch", "$input");
  }
  const expectedCursor = context.expectedCursorBindingFingerprint;
  const expectedResponseCursor = context.expectedResponseCursorFingerprint;
  for (const fingerprint of [expectedCursor, expectedResponseCursor]) {
    if (fingerprint !== undefined && fingerprint !== null &&
        (typeof fingerprint !== "string" || !Sha256FingerprintSchema.safeParse(fingerprint).success)) {
      squareRejectResponse("square_payment_request_invalid", "$input");
    }
  }
  // The established request policy consumes literal queries (including RFC3339
  // colons and cursor padding), not percent-encoded URLSearchParams output.
  // Disallow separators before assembly so a value cannot inject another query key.
  if (Object.entries(query).some(([key, value]) =>
    !/^[A-Za-z0-9_]+$/.test(key) || /[&#%?\\]/.test(value as string)
  )) squareRejectResponse("square_payment_request_invalid", "$input");
  const path = `https://${SQUARE_ENVIRONMENTS[base.providerEnvironment].hostname}/v2/payments${list ? "" : `/${requestedPaymentId}`}`;
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
    squareRejectResponse("square_payment_request_invalid", "$input");
  }
  if (decision.operationKey !== operation) squareRejectResponse("square_payment_request_invalid", "$input");
  // Existing request/cursor contracts remain byte-for-byte unchanged. Include the full
  // cursor-free request fingerprint as well: it covers total/offline/sort filters that
  // the older cursor binding omits, and bind identities/tenant explicitly.
  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_payment_request_authority",
    fingerprintVersion: SQUARE_PAYMENT_REQUEST_AUTHORITY_VERSION,
    provider: squareResponseProvenance(base), operation, connectionAuthority,
    authorizedLocationIds: [...authorizedLocationIds].sort(),
    requestedPaymentId, requestedLocationId,
    cursorBindingFingerprint: queryDecision.cursorBindingFingerprint,
    queryFingerprint: queryDecision.requestFingerprint
  });
  if (query.cursor !== undefined) {
    if (expectedResponseCursor !== paymentCursorFingerprint(requestAuthorityFingerprint, query.cursor as string)) {
      squareRejectResponse("square_payment_cursor_invalid", "$input");
    }
  } else if (expectedResponseCursor !== undefined && expectedResponseCursor !== null) {
    squareRejectResponse("square_payment_cursor_invalid", "$input");
  }
  return {
    authorizedLocationIds, requestedPaymentId, requestedLocationId,
    maximumItems: list ? Number(query.limit ?? 100) : 1,
    requestAuthorityFingerprint, requestFingerprint: decision.requestFingerprint,
    cursorBindingFingerprint: decision.cursorBindingFingerprint
  };
}

function minimizePayment(
  raw: SquareSafeJsonObject,
  provider: SquareResponseProvenance,
  connection: ConnectionAuthority,
  policy: PaymentPolicy
): SquareMinimizedPayment {
  const id = optionalIdentifier(raw, "id", PaymentIdSchema);
  const locationId = optionalIdentifier(raw, "location_id", LocationIdSchema);
  if (policy.requestedPaymentId !== null) {
    if (id === null) throw new SquarePaymentUnsupportedProjectionFailure("square_payment_identity_missing", "$response");
    if (id !== policy.requestedPaymentId) squareRejectResponse("square_payment_identity_request_mismatch", "$response");
  }
  if (locationId !== null) {
    if (!policy.authorizedLocationIds.has(locationId)) squareRejectResponse("square_payment_location_authority_mismatch", "$response");
    if (policy.requestedLocationId !== null && locationId !== policy.requestedLocationId) {
      squareRejectResponse("square_payment_location_request_mismatch", "$response");
    }
  }
  const orderId = optionalIdentifier(raw, "order_id", PaymentIdSchema);
  const processingFees = optionalObjectArray(raw, "processing_fee", MAXIMUM_PROCESSING_FEES).map((fee) => ({
    effectiveAt: paymentTimestamp(fee, "effective_at", 4_096),
    type: optionalEnum(fee, "type", SQUARE_PAYMENT_PROCESSING_FEE_TYPES, 4_096),
    amountMoney: optionalMoney(fee, "amount_money")
  }));
  // Fees have no provider IDs: retain the multiset, including identical adjustments.
  const fees = processingFees.map((fee) => ({ fee, fingerprint: squareMinimizedProjectionFingerprint(fee) }));
  fees.sort((a, b) => compareStrings(a.fingerprint, b.fingerprint));
  return SquareMinimizedPaymentSchema.parse({
    contractVersion: SQUARE_PAYMENT_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_PAYMENT_MINIMIZATION_VERSION,
    entityType: "payment", entityVersion: 1, projectionScope: "provider_payment_summary_only",
    provider,
    authority: {
      ...connection, providerKey: SQUARE_PROVIDER_KEY, providerEnvironment: provider.providerEnvironment,
      entityType: "payment", identityState: id === null ? "absent" : "provider_id", providerId: id,
      locationState: locationId === null ? "absent" : "authorized_provider_location", locationId
    },
    id, locationId,
    orderReference: orderId === null ? null : {
      referenceType: "unverified_order_reference", providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provider.providerEnvironment, entityType: "order", providerId: orderId
    },
    createdAt: paymentTimestamp(raw, "created_at", 32),
    updatedAt: paymentTimestamp(raw, "updated_at", 32),
    status: optionalEnum(raw, "status", SQUARE_PAYMENT_RESPONSE_STATUSES, 50),
    sourceType: optionalEnum(raw, "source_type", SQUARE_PAYMENT_RESPONSE_SOURCE_TYPES, 50),
    amountMoney: optionalMoney(raw, "amount_money"),
    tipMoney: optionalMoney(raw, "tip_money"),
    totalMoney: optionalMoney(raw, "total_money"),
    refundedMoney: optionalMoney(raw, "refunded_money"),
    refundedMoneySemantics: "provider_aggregate_not_verified_refunds",
    processingFees: fees.map(({ fee }) => fee), processingFeeCount: fees.length
  });
}

function optionalMoney(record: SquareSafeJsonObject, key: string) {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  const money = squareSafeJsonObject(record[key]);
  const amount = money.amount;
  if (amount !== undefined && amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount))) {
    squareRejectResponse("square_payment_money_invalid", "$response");
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
  if (typeof value !== "string" || !schema.safeParse(value).success) squareRejectResponse("square_payment_input_invalid", "$input");
  return value;
}
function optionalEnum<T extends string>(record: SquareSafeJsonObject, key: string, values: readonly T[], maximum: number): T | null {
  if (!Object.hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    squareRejectResponse("square_payment_enum_invalid", "$response");
  }
  if (!values.includes(value as T)) throw new SquarePaymentUnsupportedProjectionFailure("square_payment_enum_unsupported", "$response");
  return value as T;
}
function paymentTimestamp(record: SquareSafeJsonObject, key: string, maximum: number) {
  if (typeof record[key] === "string" && record[key].length > maximum) {
    squareRejectResponse("square_timestamp_invalid", "$response");
  }
  return squareOptionalNullableTimestamp(record, key, "$response");
}
function optionalObjectArray(record: SquareSafeJsonObject, key: string, maximum: number): readonly SquareSafeJsonObject[] {
  if (!Object.hasOwn(record, key) || record[key] === null) return [];
  const value = record[key];
  if (!Array.isArray(value) || value.length > maximum) {
    squareRejectResponse(key === "errors" ? "square_payment_provider_errors_invalid" : "square_payment_array_invalid", "$response");
  }
  return value.map((item) => squareSafeJsonObject(item));
}
function responseCursor(response: SquareSafeJsonObject, operation: SquarePaymentResponseOperation) {
  if (operation !== "list_payments" || !Object.hasOwn(response, "cursor") || response.cursor === null || response.cursor === "") return null;
  if (typeof response.cursor !== "string" || !PAYMENT_CURSOR_PATTERN.test(response.cursor)) squareRejectResponse("square_payment_cursor_invalid", "$response");
  return response.cursor;
}
function paymentCursorFingerprint(requestAuthorityFingerprint: string, cursor: string) {
  return squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_payment_response_cursor",
    fingerprintVersion: "square_payment_response_cursor_v1",
    requestAuthorityFingerprint, cursor
  });
}
function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Proxy rejection precedes every reflection on raw context/response. The established
// sanitizer still performs the canonical copy/key checks. Both count aliases per path.
function paymentSafeObject(input: unknown, field: string): SquareSafeJsonObject {
  if (!paymentRawTreeIsSafe(input)) squareRejectResponse("square_payment_raw_tree_invalid", field);
  const value = squareSafeJsonObject(input, field);
  if (!paymentRawTreeIsSafe(value)) squareRejectResponse("square_payment_raw_tree_invalid", field);
  return value;
}
function paymentRawTreeIsSafe(root: unknown) {
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

export function squarePaymentFingerprint(input: SquareMinimizedPayment) {
  if (!squarePaymentTraverseCanonicalTree(input, "inspect")) throw new TypeError("square_payment_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquareMinimizedPaymentSchema.parse(input));
}
export function squarePaymentResponseFingerprint(input: SquarePaymentResponse) {
  if (!squarePaymentTraverseCanonicalTree({ value: input, diagnostics: [] }, "inspect")) throw new TypeError("square_payment_projection_invalid");
  return squareMinimizedProjectionFingerprint(SquarePaymentResponseSchema.parse(input));
}

function squarePaymentResultBoundary<T>(
  produceResult: (
    acceptedResult: SquarePaymentAcceptedResultFactory<T>
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
    const acceptedResult: SquarePaymentAcceptedResultFactory<T> = (value) => {
      if (!squarePaymentTraverseCanonicalTree({ value, diagnostics: [] }, "inspect")) {
        return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
      }
      const fingerprint = squareMinimizedProjectionFingerprint(value);
      const result = squareAcceptedResult(value);
      if (
        squarePaymentHasExactDataProperties(result, [
          "outcome",
          "value",
          "diagnostics"
        ]) &&
        squarePaymentDataProperty(result, "outcome") === "accepted" &&
        squarePaymentDataProperty(result, "value") === value
      ) {
        acceptance.present = true;
        acceptance.result = result;
        acceptance.value = value;
        acceptance.fingerprint = fingerprint;
      }
      return result;
    };
    return squarePaymentRootDiagnosticResult(
      produceResult(acceptedResult),
      acceptedSchema,
      acceptance
    );
  } catch {
    return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
  }
}

function squarePaymentRootDiagnosticResult<T>(
  result: unknown,
  acceptedSchema: z.ZodType<T>,
  acceptance: Readonly<{
    present: boolean;
    result: unknown;
    value: unknown;
    fingerprint: string | null;
  }>
): SquareResponseParserResult<T> {
  if (!squarePaymentHasExactDataProperties(result, ["outcome", "diagnostics"])) {
    if (
      !squarePaymentHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ])
    ) {
      return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
    }
  }

  const outcome = squarePaymentDataProperty(result, "outcome");
  if (outcome === "accepted") {
    const value = squarePaymentDataProperty(result, "value");
    if (
      !acceptance.present ||
      result !== acceptance.result ||
      value !== acceptance.value ||
      !squarePaymentHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ]) ||
      !squarePaymentIsEmptyFrozenArray(
        squarePaymentDataProperty(result, "diagnostics")
      ) ||
      !squarePaymentIsDeeplyFrozen(result) ||
      !acceptedSchema.safeParse(value).success ||
      squareMinimizedProjectionFingerprint(value) !== acceptance.fingerprint
    ) {
      return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
    }
    return result as SquareResponseParserResult<T>;
  }

  if (
    outcome !== "rejected" &&
    outcome !== "unsupported" &&
    outcome !== "incompatible-version"
  ) {
    return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;
  }

  const diagnostics = squarePaymentSanitizedDiagnostics(
    squarePaymentDataProperty(result, "diagnostics")
  );
  if (diagnostics === null) return SQUARE_PAYMENT_INTERNAL_REJECTION_RESULT;

  return Object.freeze({
    outcome,
    diagnostics: Object.freeze(diagnostics)
  });
}

function squarePaymentSanitizedDiagnostics(
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
      !squarePaymentHasExactDataProperties(diagnostic, ["code", "field"])
    ) {
      return null;
    }
    const code = squarePaymentDataProperty(diagnostic, "code");
    const field = squarePaymentDataProperty(diagnostic, "field");
    if (
      typeof code !== "string" ||
      code.length > MAXIMUM_RESULT_DIAGNOSTIC_CODE_LENGTH ||
      !SQUARE_PAYMENT_DIAGNOSTIC_CODES.has(code) ||
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

function squarePaymentHasExactDataProperties(
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

function squarePaymentDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string
) {
  if (isProxy(value)) {
    throw new TypeError("square_payment_result_property_invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("square_payment_result_property_invalid");
  }
  return descriptor.value;
}

function squarePaymentIsEmptyFrozenArray(value: unknown) {
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

function squarePaymentIsDeeplyFrozen(value: unknown) {
  return squarePaymentTraverseCanonicalTree(value, "verify");
}

function squarePaymentTraverseCanonicalTree(
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
    const children = squarePaymentCanonicalDataValues(candidate);
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

function squarePaymentCanonicalDataValues(value: object): readonly unknown[] | null {
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

class SquarePaymentUnsupportedProjectionFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_payment_projection_unsupported");
    this.name = "SquarePaymentUnsupportedProjectionFailure";
    this.code = code;
    this.field = field;
  }
}
