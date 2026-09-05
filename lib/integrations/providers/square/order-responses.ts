import { z } from "zod";

import {
  CanonicalIntegerSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_ORDER_STATES,
  SQUARE_ORDER_CORE_ENTITY_VERSION,
  SQUARE_ORDER_MINIMIZATION_VERSION,
  SQUARE_ORDER_REQUEST_AUTHORITY_VERSION,
  SQUARE_ORDER_RESPONSE_CONTRACT_VERSION,
  SQUARE_ORDER_RESPONSE_OPERATION_KEYS,
  SQUARE_PROVIDER_KEY
} from "@/lib/integrations/providers/square/contracts";
import {
  SquareCurrencyCodeSchema,
  SquareIdentifierSchema,
  SquareProviderEnvironmentSchema,
  SquareResponseProvenanceSchema,
  type SquareResponseParserInput,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  type SquareSafeJsonObject,
  type SquareSafeJsonValue,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableCurrencyCode,
  squareOptionalNullableEnum,
  squareOptionalNullableIdentifier,
  squareOptionalNullableTimestamp,
  squareRejectResponse,
  squareRequiredIdentifier,
  squareRequiredString,
  squareResponseParserInput,
  squareResponseProvenance,
  squareSafeJsonObject,
  squareUnsupportedResult
} from "@/lib/integrations/providers/square/response-validation";

export const SQUARE_ORDER_RESPONSE_SDK_VERSION = "45.1.0" as const;
export const SQUARE_ORDER_RESPONSE_SDK_REVISION =
  "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76" as const;

export const SQUARE_ORDER_RESPONSE_OFFICIAL_REFERENCES = Object.freeze([
  "https://developer.squareup.com/reference/square/objects/Order",
  "https://developer.squareup.com/reference/square/enums/OrderState",
  "https://developer.squareup.com/reference/square/orders-api/retrieve-order",
  "https://developer.squareup.com/reference/square/orders-api/batch-retrieve-orders",
  "https://developer.squareup.com/reference/square/orders-api/search-orders",
  "https://developer.squareup.com/reference/square/objects/OrderEntry",
  "https://developer.squareup.com/reference/square/objects/Money",
  "https://developer.squareup.com/docs/build-basics/versioning-overview",
  `https://github.com/square/square-nodejs-sdk/tree/${SQUARE_ORDER_RESPONSE_SDK_REVISION}`
] as const);

export const SQUARE_ORDER_CORE_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "id",
  "location_id",
  "state",
  "version",
  "created_at",
  "updated_at",
  "closed_at",
  "total_money",
  "total_tax_money",
  "total_discount_money",
  "total_tip_money",
  "total_service_charge_money",
  "net_amount_due_money"
] as const);

// These documented fields are structurally inspected, then discarded whole.
export const SQUARE_ORDER_CORE_DISCARDED_RESPONSE_FIELDS = Object.freeze([
  "reference_id",
  "source",
  "customer_id",
  "line_items",
  "taxes",
  "discounts",
  "service_charges",
  "fulfillments",
  "returns",
  "return_amounts",
  "net_amounts",
  "rounding_adjustment",
  "tenders",
  "refunds",
  "metadata",
  "ticket_name",
  "pricing_options",
  "rewards"
] as const);

const MAXIMUM_ORDER_RESPONSE_ITEMS = 1_000;
const MAXIMUM_BATCH_ORDER_RESPONSE_ITEMS = 100;
const MAXIMUM_PROVIDER_ERRORS = 100;
const ORDER_CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

const SquareOrderIntegerStringSchema = CanonicalIntegerSchema.refine(
  isSafeIntegerText,
  "Integer must fit JSON safe integer bounds"
);

export const SquareOrderResponseOperationSchema = z.enum(
  SQUARE_ORDER_RESPONSE_OPERATION_KEYS
);

export const SquareOrderConnectionAuthoritySchema = z
  .object({
    connectionId: UuidSchema,
    providerEntityType: z.literal("merchant"),
    providerEntityId: SquareIdentifierSchema
  })
  .strict();

export const SquareOrderMoneySchema = z
  .object({
    amountMinor: SquareOrderIntegerStringSchema.nullable(),
    currency: SquareCurrencyCodeSchema.nullable()
  })
  .strict();

const SquareOrderAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order"),
    providerId: SquareIdentifierSchema,
    locationId: SquareIdentifierSchema,
    connectionId: UuidSchema,
    providerEntityType: z.literal("merchant"),
    providerEntityId: SquareIdentifierSchema
  })
  .strict();

const SquareOrderLifecycleClassSchema = z.enum([
  "open_nonterminal",
  "draft_nonterminal",
  "completed_terminal",
  "canceled_terminal",
  "unknown"
]);

export const SquareMinimizedOrderCoreSchema = z
  .object({
    contractVersion: z.literal(SQUARE_ORDER_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_ORDER_MINIMIZATION_VERSION),
    entityType: z.literal("order_core"),
    entityVersion: z.literal(SQUARE_ORDER_CORE_ENTITY_VERSION),
    projectionScope: z.literal("core_summary_only"),
    operation: SquareOrderResponseOperationSchema,
    requestAuthorityVersion: z.literal(SQUARE_ORDER_REQUEST_AUTHORITY_VERSION),
    requestAuthorityFingerprint: Sha256FingerprintSchema,
    authority: SquareOrderAuthoritySchema,
    provider: SquareResponseProvenanceSchema,
    id: SquareIdentifierSchema,
    locationId: SquareIdentifierSchema,
    state: z.enum(SQUARE_ALLOWED_ORDER_STATES).nullable(),
    lifecycleClass: SquareOrderLifecycleClassSchema,
    providerVersion: SquareOrderIntegerStringSchema.nullable(),
    createdAt: IsoTimestampSchema.nullable(),
    updatedAt: IsoTimestampSchema.nullable(),
    closedAt: IsoTimestampSchema.nullable(),
    totalMoney: SquareOrderMoneySchema.nullable(),
    totalTaxMoney: SquareOrderMoneySchema.nullable(),
    totalDiscountMoney: SquareOrderMoneySchema.nullable(),
    totalTipMoney: SquareOrderMoneySchema.nullable(),
    totalServiceChargeMoney: SquareOrderMoneySchema.nullable(),
    netAmountDueMoney: SquareOrderMoneySchema.nullable()
  })
  .strict();

const SquareOrderPaginationStateSchema = z
  .object({
    cursorPresent: z.boolean(),
    cursorFingerprint: Sha256FingerprintSchema.nullable()
  })
  .strict();

export const SquareOrderCoreResponseSchema = z
  .object({
    contractVersion: z.literal(SQUARE_ORDER_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_ORDER_MINIMIZATION_VERSION),
    entityType: z.literal("order_core_response"),
    operation: SquareOrderResponseOperationSchema,
    provider: SquareResponseProvenanceSchema,
    connectionAuthority: SquareOrderConnectionAuthoritySchema,
    requestAuthorityVersion: z.literal(SQUARE_ORDER_REQUEST_AUTHORITY_VERSION),
    requestAuthorityFingerprint: Sha256FingerprintSchema,
    pagination: SquareOrderPaginationStateSchema,
    items: z.array(SquareMinimizedOrderCoreSchema).max(MAXIMUM_ORDER_RESPONSE_ITEMS),
    itemCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_RESPONSE_ITEMS)
      .safe()
  })
  .strict();

export type SquareOrderResponseOperation = z.infer<
  typeof SquareOrderResponseOperationSchema
>;
export type SquareOrderConnectionAuthority = Readonly<
  z.infer<typeof SquareOrderConnectionAuthoritySchema>
>;
export type SquareOrderMoney = Readonly<z.infer<typeof SquareOrderMoneySchema>>;
export type SquareMinimizedOrderCore = Readonly<
  z.infer<typeof SquareMinimizedOrderCoreSchema>
>;
export type SquareOrderCoreResponse = Readonly<
  z.infer<typeof SquareOrderCoreResponseSchema>
>;

type SquareOrderResponseParserInput = SquareResponseParserInput &
  Readonly<{
    operation: SquareOrderResponseOperation;
    connectionAuthority: SquareOrderConnectionAuthority;
    requestPolicy: SquareOrderRequestPolicy;
  }>;

type SquareOrderRequestPolicy = Readonly<{
  requestedOrderIds: ReadonlySet<string> | null;
  requestedLocationId: string | null;
  requestedLocationIds: ReadonlySet<string> | null;
  authorizedLocationIds: ReadonlySet<string>;
  allowedStates: ReadonlySet<SquareOrderState> | null;
  requestAuthorityFingerprint: string;
}>;

type SquareOrderState = (typeof SQUARE_ALLOWED_ORDER_STATES)[number];

type CanonicalRequestContext =
  | Readonly<{
      orderId: string;
      authorizedLocationIds: readonly string[];
    }>
  | Readonly<{
      orderIds: readonly string[];
      locationId: string | null;
      authorizedLocationIds: readonly string[];
    }>
  | Readonly<{
      locationIds: readonly string[];
      states: readonly SquareOrderState[] | null;
      returnEntries: false;
      authorizedLocationIds: readonly string[];
    }>;

export function parseSquareOrderCoreResponse(
  input: unknown
): SquareResponseParserResult<SquareOrderCoreResponse> {
  try {
    const parserInput = squareOrderResponseParserInput(input);
    const provenance = squareResponseProvenance(parserInput);
    const response = squareSafeJsonObject(parserInput.response);

    if (orderProviderErrorState(response) === "present") {
      return squareUnsupportedResult(
        "square_order_provider_errors_present",
        "$response.errors"
      );
    }
    if (
      parserInput.operation === "orders_search" &&
      orderEntriesState(response) === "present"
    ) {
      return squareUnsupportedResult(
        "square_order_entries_unsupported",
        "$response.order_entries"
      );
    }
    assertOrderEnvelopeShape(response, parserInput.operation);

    const rawOrders = orderResponseItems(response, parserInput.operation);
    const items = rawOrders.map((order) =>
      minimizeSquareOrderCore(order, provenance, parserInput)
    );
    assertUniqueOrderAuthorities(items);
    items.sort(compareOrders);

    return squareAcceptedResult(
      SquareOrderCoreResponseSchema.parse({
        contractVersion: SQUARE_ORDER_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_ORDER_MINIMIZATION_VERSION,
        entityType: "order_core_response",
        operation: parserInput.operation,
        provider: provenance,
        connectionAuthority: parserInput.connectionAuthority,
        requestAuthorityVersion: SQUARE_ORDER_REQUEST_AUTHORITY_VERSION,
        requestAuthorityFingerprint:
          parserInput.requestPolicy.requestAuthorityFingerprint,
        pagination: orderPaginationState(
          response,
          parserInput.operation,
          provenance,
          parserInput.requestPolicy.requestAuthorityFingerprint
        ),
        items,
        itemCount: items.length
      })
    );
  } catch (error) {
    if (error instanceof SquareOrderUnsupportedProjectionFailure) {
      return squareUnsupportedResult(error.code, error.field);
    }
    return squareFailureResult(error);
  }
}

export function squareOrderCoreFingerprint(input: SquareMinimizedOrderCore) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedOrderCoreSchema.parse(input)
  );
}

export function squareOrderCoreResponseFingerprint(
  input: SquareOrderCoreResponse
) {
  return squareMinimizedProjectionFingerprint(
    SquareOrderCoreResponseSchema.parse(input)
  );
}

function minimizeSquareOrderCore(
  input: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  parserInput: SquareOrderResponseParserInput
): SquareMinimizedOrderCore {
  const field = orderItemField(parserInput.operation);
  const id = squareOptionalNullableIdentifier(input, "id", `${field}.id`);
  if (id === null) {
    throw new SquareOrderUnsupportedProjectionFailure(
      "square_order_identity_missing",
      `${field}.id`
    );
  }
  const locationId = squareRequiredIdentifier(
    input,
    "location_id",
    `${field}.location_id`
  );
  assertOrderAuthority(id, locationId, parserInput.requestPolicy, field);

  const state = squareOptionalNullableEnum(
    input,
    "state",
    `${field}.state`,
    SQUARE_ALLOWED_ORDER_STATES
  );
  assertOrderStateAuthority(state, parserInput.requestPolicy, field);

  const monies = {
    totalMoney: optionalOrderMoney(input, "total_money", `${field}.total_money`),
    totalTaxMoney: optionalOrderMoney(
      input,
      "total_tax_money",
      `${field}.total_tax_money`
    ),
    totalDiscountMoney: optionalOrderMoney(
      input,
      "total_discount_money",
      `${field}.total_discount_money`
    ),
    totalTipMoney: optionalOrderMoney(
      input,
      "total_tip_money",
      `${field}.total_tip_money`
    ),
    totalServiceChargeMoney: optionalOrderMoney(
      input,
      "total_service_charge_money",
      `${field}.total_service_charge_money`
    ),
    netAmountDueMoney: optionalOrderMoney(
      input,
      "net_amount_due_money",
      `${field}.net_amount_due_money`
    )
  };
  assertCompatibleOrderCurrencies(monies, field);

  return SquareMinimizedOrderCoreSchema.parse({
    contractVersion: SQUARE_ORDER_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_ORDER_MINIMIZATION_VERSION,
    entityType: "order_core",
    entityVersion: SQUARE_ORDER_CORE_ENTITY_VERSION,
    projectionScope: "core_summary_only",
    operation: parserInput.operation,
    requestAuthorityVersion: SQUARE_ORDER_REQUEST_AUTHORITY_VERSION,
    requestAuthorityFingerprint:
      parserInput.requestPolicy.requestAuthorityFingerprint,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order",
      providerId: id,
      locationId,
      connectionId: parserInput.connectionAuthority.connectionId,
      providerEntityType:
        parserInput.connectionAuthority.providerEntityType,
      providerEntityId: parserInput.connectionAuthority.providerEntityId
    },
    provider: provenance,
    id,
    locationId,
    state,
    lifecycleClass: orderLifecycleClass(state),
    providerVersion: optionalIntegerString(
      input,
      "version",
      `${field}.version`
    ),
    createdAt: squareOptionalNullableTimestamp(
      input,
      "created_at",
      `${field}.created_at`
    ),
    updatedAt: squareOptionalNullableTimestamp(
      input,
      "updated_at",
      `${field}.updated_at`
    ),
    closedAt: squareOptionalNullableTimestamp(
      input,
      "closed_at",
      `${field}.closed_at`
    ),
    ...monies
  });
}

function squareOrderResponseParserInput(
  input: unknown
): SquareOrderResponseParserInput {
  const parserInput = squareResponseParserInput(input);
  const inputRecord = input as Readonly<Record<string, unknown>>;
  assertInputKeys(inputRecord);

  const operationResult = SquareOrderResponseOperationSchema.safeParse(
    inputProperty(inputRecord, "operation", "$input.operation")
  );
  if (!operationResult.success) {
    squareRejectResponse("square_order_operation_invalid", "$input.operation");
  }
  const operation = operationResult.data;
  const connectionAuthority = parseConnectionAuthority(
    inputProperty(
      inputRecord,
      "connectionAuthority",
      "$input.connectionAuthority"
    )
  );
  const requestContext = squareSafeJsonObject(
    inputProperty(inputRecord, "requestContext", "$input.requestContext"),
    "$input.requestContext"
  );
  const requestPolicy = parseRequestPolicy(
    operation,
    requestContext,
    parserInput,
    connectionAuthority
  );

  return {
    ...parserInput,
    operation,
    connectionAuthority,
    requestPolicy
  };
}

function parseConnectionAuthority(input: unknown): SquareOrderConnectionAuthority {
  const authority = squareSafeJsonObject(
    input,
    "$input.connectionAuthority"
  );
  assertAllowedKeys(
    authority,
    ["connectionId", "providerEntityType", "providerEntityId"],
    "$input.connectionAuthority"
  );
  const connectionId = squareRequiredString(
    authority,
    "connectionId",
    "$input.connectionAuthority.connectionId",
    64
  );
  if (!UuidSchema.safeParse(connectionId).success) {
    squareRejectResponse(
      "square_order_connection_authority_invalid",
      "$input.connectionAuthority.connectionId"
    );
  }
  if (authority.providerEntityType !== "merchant") {
    squareRejectResponse(
      "square_order_connection_authority_invalid",
      "$input.connectionAuthority.providerEntityType"
    );
  }
  return SquareOrderConnectionAuthoritySchema.parse({
    connectionId,
    providerEntityType: "merchant",
    providerEntityId: squareRequiredIdentifier(
      authority,
      "providerEntityId",
      "$input.connectionAuthority.providerEntityId"
    )
  });
}

function parseRequestPolicy(
  operation: SquareOrderResponseOperation,
  request: SquareSafeJsonObject,
  parserInput: SquareResponseParserInput,
  connectionAuthority: SquareOrderConnectionAuthority
): SquareOrderRequestPolicy {
  const authorizedLocationIds = identifierArray(
    request,
    "authorizedLocationIds",
    "$input.requestContext.authorizedLocationIds",
    1_000
  );
  const authorizedLocationSet = new Set(authorizedLocationIds);
  let context: CanonicalRequestContext;
  let requestedOrderIds: readonly string[] | null = null;
  let requestedLocationId: string | null = null;
  let requestedLocationIds: readonly string[] | null = null;
  let allowedStates: readonly SquareOrderState[] | null = null;

  if (operation === "retrieve_order") {
    assertAllowedKeys(
      request,
      ["orderId", "authorizedLocationIds"],
      "$input.requestContext"
    );
    const orderId = squareRequiredIdentifier(
      request,
      "orderId",
      "$input.requestContext.orderId"
    );
    requestedOrderIds = [orderId];
    context = { orderId, authorizedLocationIds };
  } else if (operation === "orders_batch_retrieve") {
    assertAllowedKeys(
      request,
      ["orderIds", "locationId", "authorizedLocationIds"],
      "$input.requestContext"
    );
    requestedOrderIds = identifierArray(
      request,
      "orderIds",
      "$input.requestContext.orderIds",
      MAXIMUM_BATCH_ORDER_RESPONSE_ITEMS
    );
    requestedLocationId = squareOptionalNullableIdentifier(
      request,
      "locationId",
      "$input.requestContext.locationId"
    );
    if (
      requestedLocationId !== null &&
      !authorizedLocationSet.has(requestedLocationId)
    ) {
      squareRejectResponse(
        "square_order_request_location_unauthorized",
        "$input.requestContext.locationId"
      );
    }
    context = {
      orderIds: requestedOrderIds,
      locationId: requestedLocationId,
      authorizedLocationIds
    };
  } else {
    assertAllowedKeys(
      request,
      ["locationIds", "states", "returnEntries", "authorizedLocationIds"],
      "$input.requestContext"
    );
    requestedLocationIds = identifierArray(
      request,
      "locationIds",
      "$input.requestContext.locationIds",
      10
    );
    for (const locationId of requestedLocationIds) {
      if (!authorizedLocationSet.has(locationId)) {
        squareRejectResponse(
          "square_order_request_location_unauthorized",
          "$input.requestContext.locationIds"
        );
      }
    }
    allowedStates = optionalOrderStateArray(
      request,
      "states",
      "$input.requestContext.states"
    );
    if (request.returnEntries !== false) {
      squareRejectResponse(
        "square_order_entries_request_invalid",
        "$input.requestContext.returnEntries"
      );
    }
    context = {
      locationIds: requestedLocationIds,
      states: allowedStates,
      returnEntries: false,
      authorizedLocationIds
    };
  }

  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_order_request_authority",
    fingerprintVersion: SQUARE_ORDER_REQUEST_AUTHORITY_VERSION,
    provider: squareResponseProvenance(parserInput),
    operation,
    connectionAuthority,
    requestContext: context
  });

  return {
    requestedOrderIds:
      requestedOrderIds === null ? null : new Set(requestedOrderIds),
    requestedLocationId,
    requestedLocationIds:
      requestedLocationIds === null ? null : new Set(requestedLocationIds),
    authorizedLocationIds: authorizedLocationSet,
    allowedStates: allowedStates === null ? null : new Set(allowedStates),
    requestAuthorityFingerprint
  };
}

function orderProviderErrorState(
  response: SquareSafeJsonObject
): "empty" | "present" {
  if (!hasOwn(response, "errors") || response.errors === null) return "empty";
  const errors = response.errors;
  if (!Array.isArray(errors) || errors.length > MAXIMUM_PROVIDER_ERRORS) {
    squareRejectResponse("square_provider_errors_invalid", "$response.errors");
  }
  for (const error of errors) {
    squareSafeJsonObject(error, "$response.errors[]");
  }
  return errors.length === 0 ? "empty" : "present";
}

function orderEntriesState(
  response: SquareSafeJsonObject
): "absent" | "present" {
  if (!hasOwn(response, "order_entries") || response.order_entries === null) {
    return "absent";
  }
  if (
    !Array.isArray(response.order_entries) ||
    response.order_entries.length > MAXIMUM_ORDER_RESPONSE_ITEMS
  ) {
    squareRejectResponse(
      "square_order_entries_invalid",
      "$response.order_entries"
    );
  }
  return "present";
}

function assertOrderEnvelopeShape(
  response: SquareSafeJsonObject,
  operation: SquareOrderResponseOperation
) {
  const forbiddenKeys =
    operation === "retrieve_order"
      ? ["orders", "order_entries", "cursor"]
      : operation === "orders_batch_retrieve"
        ? ["order", "order_entries", "cursor"]
        : ["order"];
  for (const key of forbiddenKeys) {
    if (hasOwn(response, key)) {
      squareRejectResponse(
        "square_order_envelope_operation_mismatch",
        "$response.*"
      );
    }
  }
}

function orderResponseItems(
  response: SquareSafeJsonObject,
  operation: SquareOrderResponseOperation
): readonly SquareSafeJsonObject[] {
  if (operation === "retrieve_order") {
    if (!hasOwn(response, "order") || response.order === null) return [];
    return [squareSafeJsonObject(response.order, "$response.order")];
  }

  if (!hasOwn(response, "orders") || response.orders === null) return [];
  const maximum =
    operation === "orders_batch_retrieve"
      ? MAXIMUM_BATCH_ORDER_RESPONSE_ITEMS
      : MAXIMUM_ORDER_RESPONSE_ITEMS;
  const orders = response.orders;
  if (!Array.isArray(orders) || orders.length > maximum) {
    squareRejectResponse("square_order_response_array_invalid", "$response.orders");
  }
  return orders.map((order) =>
    squareSafeJsonObject(order, "$response.orders[]")
  );
}

function orderPaginationState(
  response: SquareSafeJsonObject,
  operation: SquareOrderResponseOperation,
  provenance: SquareResponseProvenance,
  requestAuthorityFingerprint: string
) {
  if (operation !== "orders_search" || !hasOwn(response, "cursor")) {
    return { cursorPresent: false, cursorFingerprint: null };
  }
  const cursor = response.cursor;
  if (cursor === null) {
    return { cursorPresent: false, cursorFingerprint: null };
  }
  if (typeof cursor !== "string" || !ORDER_CURSOR_PATTERN.test(cursor)) {
    squareRejectResponse("square_order_cursor_invalid", "$response.cursor");
  }
  return {
    cursorPresent: true,
    cursorFingerprint: squareMinimizedProjectionFingerprint({
      fingerprintPurpose: "square_order_response_cursor",
      fingerprintVersion: "square_order_response_cursor_fingerprint_v1",
      provider: provenance,
      operation,
      requestAuthorityFingerprint,
      cursor
    })
  };
}

function optionalOrderMoney(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): SquareOrderMoney | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const money = squareSafeJsonObject(record[key], field);
  return SquareOrderMoneySchema.parse({
    amountMinor: optionalIntegerString(money, "amount", `${field}.amount`),
    currency: squareOptionalNullableCurrencyCode(
      money,
      "currency",
      `${field}.currency`
    )
  });
}

function optionalIntegerString(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): string | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    squareRejectResponse("square_order_integer_invalid", field);
  }
  return String(value);
}

function assertCompatibleOrderCurrencies(
  monies: Readonly<Record<string, SquareOrderMoney | null>>,
  field: string
) {
  const currencies = new Set<string>();
  for (const money of Object.values(monies)) {
    if (money?.currency !== null && money?.currency !== undefined) {
      currencies.add(money.currency);
    }
  }
  if (currencies.size > 1) {
    squareRejectResponse(
      "square_order_aggregate_currency_mismatch",
      `${field}.aggregate_money`
    );
  }
}

function assertOrderAuthority(
  orderId: string,
  locationId: string,
  policy: SquareOrderRequestPolicy,
  field: string
) {
  if (!policy.authorizedLocationIds.has(locationId)) {
    squareRejectResponse(
      "square_order_location_authority_mismatch",
      `${field}.location_id`
    );
  }
  if (
    policy.requestedLocationId !== null &&
    policy.requestedLocationId !== locationId
  ) {
    squareRejectResponse(
      "square_order_location_request_mismatch",
      `${field}.location_id`
    );
  }
  if (
    policy.requestedLocationIds !== null &&
    !policy.requestedLocationIds.has(locationId)
  ) {
    squareRejectResponse(
      "square_order_location_request_mismatch",
      `${field}.location_id`
    );
  }
  if (
    policy.requestedOrderIds !== null &&
    !policy.requestedOrderIds.has(orderId)
  ) {
    squareRejectResponse(
      "square_order_identity_request_mismatch",
      `${field}.id`
    );
  }
}

function assertOrderStateAuthority(
  state: SquareOrderState | null,
  policy: SquareOrderRequestPolicy,
  field: string
) {
  if (policy.allowedStates === null) return;
  if (state === null || !policy.allowedStates.has(state)) {
    squareRejectResponse(
      "square_order_state_request_mismatch",
      `${field}.state`
    );
  }
}

function assertUniqueOrderAuthorities(items: readonly SquareMinimizedOrderCore[]) {
  const seen = new Set<string>();
  for (const item of items) {
    const identity = `${item.authority.providerEnvironment}:${item.authority.connectionId}:${item.id}`;
    if (seen.has(identity)) {
      squareRejectResponse(
        "square_duplicate_order_authority_identity",
        "$response.orders[].id"
      );
    }
    seen.add(identity);
  }
}

function identifierArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  const value = requiredField(record, key, field);
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumLength) {
    squareRejectResponse("square_order_identifier_array_invalid", field);
  }
  const output = value.map((item) => {
    if (typeof item !== "string") {
      squareRejectResponse("square_order_identifier_array_invalid", `${field}[]`);
    }
    const parsed = SquareIdentifierSchema.safeParse(item);
    if (!parsed.success) {
      squareRejectResponse("square_order_identifier_array_invalid", `${field}[]`);
    }
    return parsed.data;
  });
  if (new Set(output).size !== output.length) {
    squareRejectResponse("square_order_identifier_array_invalid", field);
  }
  return output.sort(compareStrings);
}

function optionalOrderStateArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): readonly SquareOrderState[] | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    squareRejectResponse("square_order_state_array_invalid", field);
  }
  const states = value.map((item) => {
    if (
      typeof item !== "string" ||
      !SQUARE_ALLOWED_ORDER_STATES.includes(item as SquareOrderState)
    ) {
      squareRejectResponse("square_order_state_array_invalid", `${field}[]`);
    }
    return item as SquareOrderState;
  });
  if (new Set(states).size !== states.length) {
    squareRejectResponse("square_order_state_array_invalid", field);
  }
  return states.sort(compareStrings);
}

function requiredField(
  record: SquareSafeJsonObject,
  key: string,
  field: string
): SquareSafeJsonValue {
  if (!hasOwn(record, key) || record[key] === null) {
    squareRejectResponse("square_required_field_missing", field);
  }
  return record[key];
}

function inputProperty(
  record: Readonly<Record<string, unknown>>,
  key: string,
  field: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    squareRejectResponse("square_order_parser_input_invalid", field);
  }
  return descriptor.value;
}

function assertInputKeys(record: Readonly<Record<string, unknown>>) {
  const allowed = new Set([
    "providerKey",
    "providerEnvironment",
    "apiVersion",
    "operation",
    "connectionAuthority",
    "requestContext",
    "response"
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      squareRejectResponse("square_order_parser_input_invalid", "$input.*");
    }
  }
}

function assertAllowedKeys(
  record: SquareSafeJsonObject,
  allowedKeys: readonly string[],
  field: string
) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      squareRejectResponse("square_order_context_field_invalid", `${field}.*`);
    }
  }
}

function orderLifecycleClass(state: SquareOrderState | null) {
  if (state === "OPEN") return "open_nonterminal" as const;
  if (state === "DRAFT") return "draft_nonterminal" as const;
  if (state === "COMPLETED") return "completed_terminal" as const;
  if (state === "CANCELED") return "canceled_terminal" as const;
  return "unknown" as const;
}

function orderItemField(operation: SquareOrderResponseOperation) {
  return operation === "retrieve_order" ? "$response.order" : "$response.orders[]";
}

function compareOrders(
  left: SquareMinimizedOrderCore,
  right: SquareMinimizedOrderCore
) {
  return (
    compareStrings(left.id, right.id) ||
    compareStrings(left.locationId, right.locationId)
  );
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasOwn(record: SquareSafeJsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isSafeIntegerText(value: string) {
  const unsigned = value.startsWith("-") ? value.slice(1) : value;
  return (
    unsigned.length < MAX_SAFE_INTEGER_TEXT.length ||
    (unsigned.length === MAX_SAFE_INTEGER_TEXT.length &&
      unsigned <= MAX_SAFE_INTEGER_TEXT)
  );
}

class SquareOrderUnsupportedProjectionFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_order_projection_unsupported");
    this.name = "SquareOrderUnsupportedProjectionFailure";
    this.code = code;
    this.field = field;
  }
}
