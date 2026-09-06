import { z } from "zod";

import {
  CanonicalDecimalSchema,
  CanonicalIntegerSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_ORDER_STATES,
  SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
  SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION,
  SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION,
  SQUARE_ORDER_CORE_ENTITY_VERSION,
  SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION,
  SQUARE_ORDER_LINE_ITEM_MINIMIZATION_VERSION,
  SQUARE_ORDER_LINE_ITEM_RESPONSE_CONTRACT_VERSION,
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
  type SquareResponseFailureResult,
  type SquareResponseParserInput,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  type SquareSafeJsonObject,
  type SquareSafeJsonValue,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableCurrencyCode,
  squareOptionalNullableDisplayText,
  squareOptionalNullableEnum,
  squareOptionalNullableIdentifier,
  squareOptionalNullableString,
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

export const SQUARE_ORDER_LINE_ITEM_RESPONSE_OFFICIAL_REFERENCES =
  Object.freeze([
    "https://developer.squareup.com/reference/square/objects/OrderLineItem",
    "https://developer.squareup.com/reference/square/objects/OrderLineItemModifier",
    "https://developer.squareup.com/reference/square/objects/OrderQuantityUnit",
    "https://developer.squareup.com/reference/square/objects/MeasurementUnit",
    "https://developer.squareup.com/reference/square/objects/Money",
    "https://developer.squareup.com/reference/square/objects/Order",
    "https://developer.squareup.com/docs/orders-api/create-orders",
    "https://developer.squareup.com/docs/orders-api/how-it-works",
    "https://developer.squareup.com/docs/catalog-api/manage-nested-modifiers",
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderLineItem.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderLineItemModifier.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderQuantityUnit.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/MeasurementUnit.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItem.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemModifier.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderQuantityUnit.ts`
  ] as const);

export const SQUARE_ORDER_ADJUSTMENT_RESPONSE_OFFICIAL_REFERENCES =
  Object.freeze([
    "https://developer.squareup.com/reference/square/objects/OrderLineItemTax",
    "https://developer.squareup.com/reference/square/objects/OrderLineItemDiscount",
    "https://developer.squareup.com/reference/square/objects/OrderServiceCharge",
    "https://developer.squareup.com/reference/square/objects/OrderLineItemAppliedTax",
    "https://developer.squareup.com/reference/square/objects/OrderLineItemAppliedDiscount",
    "https://developer.squareup.com/reference/square/objects/OrderLineItemAppliedServiceCharge",
    "https://developer.squareup.com/reference/square/enums/OrderLineItemTaxType",
    "https://developer.squareup.com/reference/square/enums/OrderLineItemTaxScope",
    "https://developer.squareup.com/reference/square/enums/OrderLineItemDiscountType",
    "https://developer.squareup.com/reference/square/enums/OrderLineItemDiscountScope",
    "https://developer.squareup.com/reference/square/enums/OrderServiceChargeCalculationPhase",
    "https://developer.squareup.com/reference/square/enums/OrderServiceChargeType",
    "https://developer.squareup.com/reference/square/enums/OrderServiceChargeTreatmentType",
    "https://developer.squareup.com/reference/square/enums/OrderServiceChargeScope",
    "https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts",
    "https://developer.squareup.com/docs/orders-api/service-charges",
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderLineItemTax.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderLineItemDiscount.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/api/types/OrderServiceCharge.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemTax.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemDiscount.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderServiceCharge.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemAppliedTax.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemAppliedDiscount.ts`,
    `https://github.com/square/square-nodejs-sdk/blob/${SQUARE_ORDER_RESPONSE_SDK_REVISION}/src/serialization/types/OrderLineItemAppliedServiceCharge.ts`
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

export const SQUARE_ORDER_LINE_ITEM_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "uid",
  "catalog_object_id",
  "catalog_version",
  "name",
  "variation_name",
  "item_type",
  "quantity",
  "quantity_unit",
  "modifiers",
  "base_price_money",
  "variation_total_price_money",
  "gross_sales_money",
  "total_tax_money",
  "total_discount_money",
  "total_service_charge_money",
  "total_money"
] as const);

export const SQUARE_ORDER_LINE_ITEM_DISCARDED_RESPONSE_FIELDS = Object.freeze([
  "note",
  "metadata",
  "applied_taxes",
  "applied_discounts",
  "applied_service_charges",
  "pricing_blocklists"
] as const);

export const SQUARE_ORDER_LINE_ITEM_MODIFIER_TRUSTED_RESPONSE_FIELDS =
  Object.freeze([
    "uid",
    "catalog_object_id",
    "catalog_version",
    "name",
    "quantity",
    "base_price_money",
    "total_price_money",
    "parent_modifier_uid"
  ] as const);

export const SQUARE_ORDER_LINE_ITEM_MODIFIER_DISCARDED_RESPONSE_FIELDS =
  Object.freeze(["metadata"] as const);

export const SQUARE_ORDER_TAX_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "uid",
  "catalog_object_id",
  "catalog_version",
  "name",
  "type",
  "percentage",
  "applied_money",
  "scope",
  "auto_applied"
] as const);

export const SQUARE_ORDER_TAX_DISCARDED_RESPONSE_FIELDS = Object.freeze([
  "metadata"
] as const);

export const SQUARE_ORDER_DISCOUNT_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "uid",
  "catalog_object_id",
  "catalog_version",
  "name",
  "type",
  "percentage",
  "amount_money",
  "applied_money",
  "scope"
] as const);

export const SQUARE_ORDER_DISCOUNT_DISCARDED_RESPONSE_FIELDS = Object.freeze([
  "metadata",
  "reward_ids",
  "pricing_rule_id"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "uid",
  "name",
  "catalog_object_id",
  "catalog_version",
  "percentage",
  "amount_money",
  "applied_money",
  "total_money",
  "total_tax_money",
  "calculation_phase",
  "taxable",
  "applied_taxes",
  "type",
  "treatment_type",
  "scope"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_DISCARDED_RESPONSE_FIELDS =
  Object.freeze(["metadata"] as const);

export const SQUARE_ORDER_APPLIED_TAX_TRUSTED_RESPONSE_FIELDS = Object.freeze([
  "uid",
  "tax_uid",
  "applied_money",
  "auto_applied"
] as const);

export const SQUARE_ORDER_APPLIED_DISCOUNT_TRUSTED_RESPONSE_FIELDS =
  Object.freeze(["uid", "discount_uid", "applied_money"] as const);

export const SQUARE_ORDER_APPLIED_SERVICE_CHARGE_TRUSTED_RESPONSE_FIELDS =
  Object.freeze(["uid", "service_charge_uid", "applied_money"] as const);

const MAXIMUM_ORDER_RESPONSE_ITEMS = 1_000;
const MAXIMUM_BATCH_ORDER_RESPONSE_ITEMS = 100;
const MAXIMUM_ORDER_LINE_ITEMS = 1_000;
const MAXIMUM_ORDER_LINE_ITEM_MODIFIERS = 1_000;
const MAXIMUM_ORDER_ADJUSTMENTS = 1_000;
const MAXIMUM_ORDER_APPLIED_ADJUSTMENTS = 1_000;
const MAXIMUM_ORDER_ADJUSTMENT_PERCENTAGE_LENGTH = 10;
const MAXIMUM_ORDER_LINE_ITEM_QUANTITY_LENGTH = 12;
const MAXIMUM_ORDER_MODIFIER_QUANTITY_LENGTH = 4_096;
const MAXIMUM_ORDER_MODIFIER_NESTING_DEPTH = 3;
const MAXIMUM_PROVIDER_ERRORS = 100;
const MAXIMUM_RESULT_DIAGNOSTICS = 100;
const MAXIMUM_FROZEN_RESULT_OBJECTS = 50_000;
const ORDER_CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const ORDER_COMPONENT_UID_PATTERN = /^[A-Za-z0-9._-]{1,60}$/;
const ORDER_CATALOG_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,192}$/;
const ORDER_QUANTITY_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const ORDER_PERCENTAGE_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);
const MINIMUM_ORDER_PROVIDER_VERSION = -2_147_483_648;
const MAXIMUM_ORDER_PROVIDER_VERSION = 2_147_483_647;

export const SQUARE_ORDER_LINE_ITEM_ITEM_TYPES = Object.freeze([
  "ITEM",
  "CUSTOM_AMOUNT",
  "GIFT_CARD"
] as const);

export const SQUARE_ORDER_TAX_TYPES = Object.freeze([
  "UNKNOWN_TAX",
  "ADDITIVE",
  "INCLUSIVE"
] as const);

export const SQUARE_ORDER_TAX_SCOPES = Object.freeze([
  "OTHER_TAX_SCOPE",
  "LINE_ITEM",
  "ORDER"
] as const);

export const SQUARE_ORDER_DISCOUNT_TYPES = Object.freeze([
  "UNKNOWN_DISCOUNT",
  "FIXED_PERCENTAGE",
  "FIXED_AMOUNT",
  "VARIABLE_PERCENTAGE",
  "VARIABLE_AMOUNT"
] as const);

export const SQUARE_ORDER_DISCOUNT_SCOPES = Object.freeze([
  "OTHER_DISCOUNT_SCOPE",
  "LINE_ITEM",
  "ORDER"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_CALCULATION_PHASES = Object.freeze([
  "SUBTOTAL_PHASE",
  "TOTAL_PHASE",
  "APPORTIONED_PERCENTAGE_PHASE",
  "APPORTIONED_AMOUNT_PHASE"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_TYPES = Object.freeze([
  "AUTO_GRATUITY",
  "CUSTOM"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_TREATMENT_TYPES = Object.freeze([
  "LINE_ITEM_TREATMENT",
  "APPORTIONED_TREATMENT"
] as const);

export const SQUARE_ORDER_SERVICE_CHARGE_SCOPES = Object.freeze([
  "OTHER_SERVICE_CHARGE_SCOPE",
  "LINE_ITEM",
  "ORDER"
] as const);

export const SQUARE_ORDER_MEASUREMENT_UNIT_TYPES = Object.freeze([
  "TYPE_CUSTOM",
  "TYPE_AREA",
  "TYPE_LENGTH",
  "TYPE_VOLUME",
  "TYPE_WEIGHT",
  "TYPE_GENERIC"
] as const);

export const SQUARE_ORDER_MEASUREMENT_AREA_UNITS = Object.freeze([
  "IMPERIAL_ACRE",
  "IMPERIAL_SQUARE_INCH",
  "IMPERIAL_SQUARE_FOOT",
  "IMPERIAL_SQUARE_YARD",
  "IMPERIAL_SQUARE_MILE",
  "METRIC_SQUARE_CENTIMETER",
  "METRIC_SQUARE_METER",
  "METRIC_SQUARE_KILOMETER"
] as const);

export const SQUARE_ORDER_MEASUREMENT_LENGTH_UNITS = Object.freeze([
  "IMPERIAL_INCH",
  "IMPERIAL_FOOT",
  "IMPERIAL_YARD",
  "IMPERIAL_MILE",
  "METRIC_MILLIMETER",
  "METRIC_CENTIMETER",
  "METRIC_METER",
  "METRIC_KILOMETER"
] as const);

export const SQUARE_ORDER_MEASUREMENT_VOLUME_UNITS = Object.freeze([
  "GENERIC_FLUID_OUNCE",
  "GENERIC_SHOT",
  "GENERIC_CUP",
  "GENERIC_PINT",
  "GENERIC_QUART",
  "GENERIC_GALLON",
  "IMPERIAL_CUBIC_INCH",
  "IMPERIAL_CUBIC_FOOT",
  "IMPERIAL_CUBIC_YARD",
  "METRIC_MILLILITER",
  "METRIC_LITER"
] as const);

export const SQUARE_ORDER_MEASUREMENT_WEIGHT_UNITS = Object.freeze([
  "IMPERIAL_WEIGHT_OUNCE",
  "IMPERIAL_POUND",
  "IMPERIAL_STONE",
  "METRIC_MILLIGRAM",
  "METRIC_GRAM",
  "METRIC_KILOGRAM"
] as const);

export const SQUARE_ORDER_MEASUREMENT_TIME_UNITS = Object.freeze([
  "GENERIC_MILLISECOND",
  "GENERIC_SECOND",
  "GENERIC_MINUTE",
  "GENERIC_HOUR",
  "GENERIC_DAY"
] as const);

const SQUARE_ORDER_DIAGNOSTIC_CODES = new Set([
  "square_api_version_incompatible",
  "square_currency_invalid",
  "square_display_text_invalid",
  "square_boolean_invalid",
  "square_duplicate_order_applied_discount_identity",
  "square_duplicate_order_applied_service_charge_identity",
  "square_duplicate_order_applied_tax_identity",
  "square_duplicate_order_authority_identity",
  "square_duplicate_order_discount_identity",
  "square_duplicate_order_line_item_identity",
  "square_duplicate_order_line_item_applied_discount_reference",
  "square_duplicate_order_line_item_applied_service_charge_reference",
  "square_duplicate_order_line_item_applied_tax_reference",
  "square_duplicate_order_modifier_identity",
  "square_duplicate_order_service_charge_applied_tax_reference",
  "square_duplicate_order_service_charge_identity",
  "square_duplicate_order_tax_identity",
  "square_enum_invalid",
  "square_identifier_invalid",
  "square_order_aggregate_currency_mismatch",
  "square_order_adjustment_currency_mismatch",
  "square_order_adjustment_percentage_invalid",
  "square_order_applied_discount_array_invalid",
  "square_order_applied_discount_reference_dangling",
  "square_order_applied_discount_reference_missing",
  "square_order_applied_service_charge_array_invalid",
  "square_order_applied_service_charge_reference_dangling",
  "square_order_applied_service_charge_reference_missing",
  "square_order_applied_tax_array_invalid",
  "square_order_applied_tax_reference_dangling",
  "square_order_applied_tax_reference_missing",
  "square_order_connection_authority_invalid",
  "square_order_context_field_invalid",
  "square_order_cursor_invalid",
  "square_order_discount_array_invalid",
  "square_order_discount_catalog_reference_invalid",
  "square_order_discount_identity_missing",
  "square_order_discount_type_incompatible",
  "square_order_discount_value_incompatible",
  "square_order_entries_invalid",
  "square_order_entries_request_invalid",
  "square_order_entries_unsupported",
  "square_order_envelope_operation_mismatch",
  "square_order_identifier_array_invalid",
  "square_order_identity_missing",
  "square_order_identity_request_mismatch",
  "square_order_integer_invalid",
  "square_order_line_item_array_invalid",
  "square_order_line_item_catalog_reference_invalid",
  "square_order_line_item_currency_mismatch",
  "square_order_line_item_identity_missing",
  "square_order_line_item_modifier_array_invalid",
  "square_order_line_item_modifier_identity_missing",
  "square_order_line_item_quantity_invalid",
  "square_order_location_authority_mismatch",
  "square_order_location_request_mismatch",
  "square_order_operation_invalid",
  "square_order_parser_input_invalid",
  "square_order_modifier_catalog_reference_invalid",
  "square_order_modifier_parent_cross_line_item",
  "square_order_modifier_parent_cycle",
  "square_order_modifier_parent_missing",
  "square_order_modifier_parent_self",
  "square_order_modifier_quantity_invalid",
  "square_order_modifier_price_missing",
  "square_order_modifier_nesting_depth_invalid",
  "square_order_provider_errors_present",
  "square_order_quantity_precision_invalid",
  "square_order_quantity_precision_mismatch",
  "square_order_quantity_unit_catalog_reference_invalid",
  "square_order_measurement_unit_invalid",
  "square_order_measurement_unit_type_unsupported",
  "square_order_request_location_unauthorized",
  "square_order_response_array_invalid",
  "square_order_response_missing",
  "square_order_service_charge_array_invalid",
  "square_order_service_charge_catalog_reference_invalid",
  "square_order_service_charge_identity_missing",
  "square_order_service_charge_phase_incompatible",
  "square_order_service_charge_value_incompatible",
  "square_order_state_array_invalid",
  "square_order_state_request_mismatch",
  "square_order_tax_array_invalid",
  "square_order_tax_catalog_reference_invalid",
  "square_order_tax_identity_missing",
  "square_parser_input_invalid",
  "square_provider_environment_invalid",
  "square_provider_errors_invalid",
  "square_provider_key_invalid",
  "square_required_field_missing",
  "square_response_accessor_rejected",
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
  "square_timestamp_invalid"
]);

const SQUARE_ORDER_INTERNAL_REJECTION_RESULT = Object.freeze({
  outcome: "rejected" as const,
  diagnostics: Object.freeze([
    Object.freeze({
      code: "square_response_internal_rejection",
      field: "$response"
    })
  ])
}) satisfies SquareResponseFailureResult;

const SquareOrderIntegerStringSchema = CanonicalIntegerSchema.refine(
  isSafeIntegerText,
  "Integer must fit JSON safe integer bounds"
);
const SquareOrderProviderVersionStringSchema = CanonicalIntegerSchema.refine(
  isOrderProviderVersionText,
  "Order provider version must fit signed 32-bit bounds"
);
const SquareOrderComponentUidSchema = z
  .string()
  .regex(ORDER_COMPONENT_UID_PATTERN);
const SquareOrderCatalogIdentifierSchema = z
  .string()
  .regex(ORDER_CATALOG_IDENTIFIER_PATTERN);
const SquareOrderAdjustmentComponentUidSchema =
  squareOrderSafeOpaqueStringSchema(60);
const SquareOrderAdjustmentCatalogIdentifierSchema =
  squareOrderSafeOpaqueStringSchema(192);
const SquareOrderCatalogVersionStringSchema = CanonicalIntegerSchema.refine(
  isSafeIntegerText,
  "Catalog version must fit JSON safe integer bounds"
);
const SquareOrderLineItemQuantitySchema = z
  .string()
  .min(1)
  .max(MAXIMUM_ORDER_LINE_ITEM_QUANTITY_LENGTH)
  .regex(ORDER_QUANTITY_PATTERN);
const SquareOrderModifierQuantitySchema = z
  .string()
  .min(1)
  .max(MAXIMUM_ORDER_MODIFIER_QUANTITY_LENGTH)
  .regex(ORDER_QUANTITY_PATTERN);
const SquareOrderLineItemNameSchema = squareOrderDisplayTextSchema(512);
const SquareOrderLineItemVariationNameSchema = squareOrderDisplayTextSchema(400);
const SquareOrderLineItemModifierNameSchema = squareOrderDisplayTextSchema(255);
const SquareOrderMeasurementCustomTextSchema = squareOrderDisplayTextSchema(4_096);
const SquareOrderTaxNameSchema = squareOrderDisplayTextSchema(255);
const SquareOrderDiscountNameSchema = squareOrderDisplayTextSchema(255);
const SquareOrderServiceChargeNameSchema = squareOrderDisplayTextSchema(512);
const SquareOrderAdjustmentPercentageSchema = CanonicalDecimalSchema.refine(
  (value) => value.length <= MAXIMUM_ORDER_ADJUSTMENT_PERCENTAGE_LENGTH,
  "Order adjustment percentage must fit the Square text bound"
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
    providerVersion: SquareOrderProviderVersionStringSchema.nullable(),
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

export const SquareOrderCatalogReferenceSchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    referenceKind: z.literal("catalog_object"),
    reconciliationState: z.literal("unverified"),
    providerId: SquareOrderCatalogIdentifierSchema,
    providerVersion: SquareOrderCatalogVersionStringSchema.nullable()
  })
  .strict();

const SquareOrderAdjustmentCatalogReferenceSchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    referenceKind: z.literal("catalog_object"),
    reconciliationState: z.literal("unverified"),
    providerId: SquareOrderAdjustmentCatalogIdentifierSchema,
    providerVersion: SquareOrderCatalogVersionStringSchema.nullable()
  })
  .strict();

const SquareOrderMeasurementCustomUnitSchema = z
  .object({
    name: SquareOrderMeasurementCustomTextSchema,
    abbreviation: SquareOrderMeasurementCustomTextSchema
  })
  .strict();

export const SquareOrderMeasurementUnitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("custom"),
      type: z.literal("TYPE_CUSTOM").nullable(),
      custom: SquareOrderMeasurementCustomUnitSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("area"),
      type: z.literal("TYPE_AREA").nullable(),
      unit: z.enum(SQUARE_ORDER_MEASUREMENT_AREA_UNITS)
    })
    .strict(),
  z
    .object({
      kind: z.literal("length"),
      type: z.literal("TYPE_LENGTH").nullable(),
      unit: z.enum(SQUARE_ORDER_MEASUREMENT_LENGTH_UNITS)
    })
    .strict(),
  z
    .object({
      kind: z.literal("volume"),
      type: z.literal("TYPE_VOLUME").nullable(),
      unit: z.enum(SQUARE_ORDER_MEASUREMENT_VOLUME_UNITS)
    })
    .strict(),
  z
    .object({
      kind: z.literal("weight"),
      type: z.literal("TYPE_WEIGHT").nullable(),
      unit: z.enum(SQUARE_ORDER_MEASUREMENT_WEIGHT_UNITS)
    })
    .strict(),
  z
    .object({
      kind: z.literal("generic"),
      type: z.literal("TYPE_GENERIC").nullable(),
      unit: z.literal("UNIT")
    })
    .strict(),
  z
    .object({
      kind: z.literal("time"),
      type: z.null(),
      unit: z.enum(SQUARE_ORDER_MEASUREMENT_TIME_UNITS)
    })
    .strict()
]);

export const SquareOrderQuantityUnitSchema = z
  .object({
    measurementUnit: SquareOrderMeasurementUnitSchema.nullable(),
    precision: z.number().int().min(0).max(5).nullable(),
    catalogReference: SquareOrderCatalogReferenceSchema.nullable()
  })
  .strict();

const SquareOrderLineItemAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema
  })
  .strict();

const SquareOrderLineItemModifierAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item_modifier"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema,
    modifierUid: SquareOrderComponentUidSchema
  })
  .strict();

// Square may omit UIDs in write shapes, but a trusted response projection needs
// Order ID plus the returned component UID as its minimum stable authority.

export const SquareOrderLineItemModifierSchema = z
  .object({
    entityType: z.literal("order_line_item_modifier"),
    entityVersion: z.literal(SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION),
    authority: SquareOrderLineItemModifierAuthoritySchema,
    sourceKind: z.enum(["catalog_backed", "ad_hoc"]),
    pricingSource: z.enum([
      "catalog_default_or_unknown",
      "catalog_base_price_override",
      "ad_hoc_base_price"
    ]),
    uid: SquareOrderComponentUidSchema,
    catalogReference: SquareOrderCatalogReferenceSchema.nullable(),
    name: SquareOrderLineItemModifierNameSchema.nullable(),
    quantity: SquareOrderModifierQuantitySchema.nullable(),
    basePriceMoney: SquareOrderMoneySchema.nullable(),
    totalPriceMoney: SquareOrderMoneySchema.nullable(),
    parentModifierUid: SquareOrderComponentUidSchema.nullable(),
    nestingDepth: z
      .number()
      .int()
      .min(1)
      .max(MAXIMUM_ORDER_MODIFIER_NESTING_DEPTH)
  })
  .strict();

export const SquareOrderLineItemSchema = z
  .object({
    entityType: z.literal("order_line_item"),
    entityVersion: z.literal(SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION),
    authority: SquareOrderLineItemAuthoritySchema,
    sourceKind: z.enum(["catalog_backed", "ad_hoc"]),
    uid: SquareOrderComponentUidSchema,
    catalogReference: SquareOrderCatalogReferenceSchema.nullable(),
    name: SquareOrderLineItemNameSchema.nullable(),
    variationName: SquareOrderLineItemVariationNameSchema.nullable(),
    itemType: z.enum(SQUARE_ORDER_LINE_ITEM_ITEM_TYPES).nullable(),
    quantity: SquareOrderLineItemQuantitySchema,
    quantityUnit: SquareOrderQuantityUnitSchema.nullable(),
    modifiers: z
      .array(SquareOrderLineItemModifierSchema)
      .max(MAXIMUM_ORDER_LINE_ITEM_MODIFIERS),
    modifierCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_LINE_ITEM_MODIFIERS)
      .safe(),
    basePriceMoney: SquareOrderMoneySchema.nullable(),
    variationTotalPriceMoney: SquareOrderMoneySchema.nullable(),
    grossSalesMoney: SquareOrderMoneySchema.nullable(),
    totalTaxMoney: SquareOrderMoneySchema.nullable(),
    totalDiscountMoney: SquareOrderMoneySchema.nullable(),
    totalServiceChargeMoney: SquareOrderMoneySchema.nullable(),
    totalMoney: SquareOrderMoneySchema.nullable()
  })
  .strict();

export const SquareMinimizedOrderLineItemDetailSchema = z
  .object({
    contractVersion: z.literal(
      SQUARE_ORDER_LINE_ITEM_RESPONSE_CONTRACT_VERSION
    ),
    minimizationVersion: z.literal(
      SQUARE_ORDER_LINE_ITEM_MINIMIZATION_VERSION
    ),
    entityType: z.literal("order_line_item_detail"),
    entityVersion: z.literal(SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION),
    projectionScope: z.literal("order_core_with_line_items"),
    core: SquareMinimizedOrderCoreSchema,
    lineItems: z.array(SquareOrderLineItemSchema).max(MAXIMUM_ORDER_LINE_ITEMS),
    lineItemCount: z.number().int().nonnegative().max(MAXIMUM_ORDER_LINE_ITEMS).safe()
  })
  .strict();

export const SquareOrderLineItemResponseSchema = z
  .object({
    contractVersion: z.literal(
      SQUARE_ORDER_LINE_ITEM_RESPONSE_CONTRACT_VERSION
    ),
    minimizationVersion: z.literal(
      SQUARE_ORDER_LINE_ITEM_MINIMIZATION_VERSION
    ),
    entityType: z.literal("order_line_item_detail_response"),
    operation: SquareOrderResponseOperationSchema,
    provider: SquareResponseProvenanceSchema,
    connectionAuthority: SquareOrderConnectionAuthoritySchema,
    requestAuthorityVersion: z.literal(SQUARE_ORDER_REQUEST_AUTHORITY_VERSION),
    requestAuthorityFingerprint: Sha256FingerprintSchema,
    pagination: SquareOrderPaginationStateSchema,
    items: z
      .array(SquareMinimizedOrderLineItemDetailSchema)
      .max(MAXIMUM_ORDER_RESPONSE_ITEMS),
    itemCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_RESPONSE_ITEMS)
      .safe()
  })
  .strict();

const SquareOrderTaxAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_tax"),
    orderId: SquareIdentifierSchema,
    taxUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderDiscountAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_discount"),
    orderId: SquareIdentifierSchema,
    discountUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderServiceChargeAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_service_charge"),
    orderId: SquareIdentifierSchema,
    serviceChargeUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderLineItemApplicationAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item_adjustments"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema
  })
  .strict();

const SquareOrderLineItemAppliedTaxAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item_applied_tax"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema,
    taxUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderLineItemAppliedDiscountAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item_applied_discount"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema,
    discountUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderLineItemAppliedServiceChargeAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_line_item_applied_service_charge"),
    orderId: SquareIdentifierSchema,
    lineItemUid: SquareOrderComponentUidSchema,
    serviceChargeUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

const SquareOrderServiceChargeAppliedTaxAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: z.literal("order_service_charge_applied_tax"),
    orderId: SquareIdentifierSchema,
    serviceChargeUid: SquareOrderAdjustmentComponentUidSchema,
    taxUid: SquareOrderAdjustmentComponentUidSchema
  })
  .strict();

export const SquareOrderTaxSchema = z
  .object({
    entityType: z.literal("order_tax"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderTaxAuthoritySchema,
    sourceKind: z.enum(["catalog_backed", "ad_hoc"]),
    uid: SquareOrderAdjustmentComponentUidSchema,
    catalogReference: SquareOrderAdjustmentCatalogReferenceSchema.nullable(),
    name: SquareOrderTaxNameSchema.nullable(),
    type: z.enum(SQUARE_ORDER_TAX_TYPES).nullable(),
    percentage: SquareOrderAdjustmentPercentageSchema.nullable(),
    appliedMoney: SquareOrderMoneySchema.nullable(),
    scope: z.enum(SQUARE_ORDER_TAX_SCOPES).nullable(),
    autoApplied: z.boolean().nullable()
  })
  .strict();

export const SquareOrderDiscountSchema = z
  .object({
    entityType: z.literal("order_discount"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderDiscountAuthoritySchema,
    sourceKind: z.enum(["catalog_backed", "ad_hoc"]),
    uid: SquareOrderAdjustmentComponentUidSchema,
    catalogReference: SquareOrderAdjustmentCatalogReferenceSchema.nullable(),
    name: SquareOrderDiscountNameSchema.nullable(),
    type: z.enum(SQUARE_ORDER_DISCOUNT_TYPES).nullable(),
    percentage: SquareOrderAdjustmentPercentageSchema.nullable(),
    amountMoney: SquareOrderMoneySchema.nullable(),
    appliedMoney: SquareOrderMoneySchema.nullable(),
    scope: z.enum(SQUARE_ORDER_DISCOUNT_SCOPES).nullable()
  })
  .strict();

export const SquareOrderLineItemAppliedTaxSchema = z
  .object({
    entityType: z.literal("order_line_item_applied_tax"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderLineItemAppliedTaxAuthoritySchema,
    uid: SquareOrderAdjustmentComponentUidSchema.nullable(),
    taxUid: SquareOrderAdjustmentComponentUidSchema,
    appliedMoney: SquareOrderMoneySchema.nullable(),
    autoApplied: z.boolean().nullable()
  })
  .strict();

export const SquareOrderLineItemAppliedDiscountSchema = z
  .object({
    entityType: z.literal("order_line_item_applied_discount"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderLineItemAppliedDiscountAuthoritySchema,
    uid: SquareOrderAdjustmentComponentUidSchema.nullable(),
    discountUid: SquareOrderAdjustmentComponentUidSchema,
    appliedMoney: SquareOrderMoneySchema.nullable()
  })
  .strict();

export const SquareOrderLineItemAppliedServiceChargeSchema = z
  .object({
    entityType: z.literal("order_line_item_applied_service_charge"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderLineItemAppliedServiceChargeAuthoritySchema,
    uid: SquareOrderAdjustmentComponentUidSchema.nullable(),
    serviceChargeUid: SquareOrderAdjustmentComponentUidSchema,
    appliedMoney: SquareOrderMoneySchema.nullable()
  })
  .strict();

export const SquareOrderServiceChargeAppliedTaxSchema = z
  .object({
    entityType: z.literal("order_service_charge_applied_tax"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderServiceChargeAppliedTaxAuthoritySchema,
    uid: SquareOrderAdjustmentComponentUidSchema.nullable(),
    taxUid: SquareOrderAdjustmentComponentUidSchema,
    appliedMoney: SquareOrderMoneySchema.nullable(),
    autoApplied: z.boolean().nullable()
  })
  .strict();

export const SquareOrderServiceChargeSchema = z
  .object({
    entityType: z.literal("order_service_charge"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderServiceChargeAuthoritySchema,
    sourceKind: z.enum(["catalog_backed", "ad_hoc"]),
    uid: SquareOrderAdjustmentComponentUidSchema,
    catalogReference: SquareOrderAdjustmentCatalogReferenceSchema.nullable(),
    name: SquareOrderServiceChargeNameSchema.nullable(),
    percentage: SquareOrderAdjustmentPercentageSchema.nullable(),
    amountMoney: SquareOrderMoneySchema.nullable(),
    appliedMoney: SquareOrderMoneySchema.nullable(),
    totalMoney: SquareOrderMoneySchema.nullable(),
    totalTaxMoney: SquareOrderMoneySchema.nullable(),
    calculationPhase: z
      .enum(SQUARE_ORDER_SERVICE_CHARGE_CALCULATION_PHASES)
      .nullable(),
    taxable: z.boolean().nullable(),
    appliedTaxes: z
      .array(SquareOrderServiceChargeAppliedTaxSchema)
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS),
    appliedTaxCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS)
      .safe(),
    type: z.enum(SQUARE_ORDER_SERVICE_CHARGE_TYPES).nullable(),
    treatmentType: z
      .enum(SQUARE_ORDER_SERVICE_CHARGE_TREATMENT_TYPES)
      .nullable(),
    scope: z.enum(SQUARE_ORDER_SERVICE_CHARGE_SCOPES).nullable()
  })
  .strict();

export const SquareOrderLineItemAdjustmentApplicationsSchema = z
  .object({
    entityType: z.literal("order_line_item_adjustments"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    authority: SquareOrderLineItemApplicationAuthoritySchema,
    lineItemUid: SquareOrderComponentUidSchema,
    appliedTaxes: z
      .array(SquareOrderLineItemAppliedTaxSchema)
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS),
    appliedTaxCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS)
      .safe(),
    appliedDiscounts: z
      .array(SquareOrderLineItemAppliedDiscountSchema)
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS),
    appliedDiscountCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS)
      .safe(),
    appliedServiceCharges: z
      .array(SquareOrderLineItemAppliedServiceChargeSchema)
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS),
    appliedServiceChargeCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_APPLIED_ADJUSTMENTS)
      .safe()
  })
  .strict();

export const SquareMinimizedOrderAdjustmentDetailSchema = z
  .object({
    contractVersion: z.literal(
      SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION
    ),
    minimizationVersion: z.literal(
      SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION
    ),
    entityType: z.literal("order_adjustment_detail"),
    entityVersion: z.literal(SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION),
    projectionScope: z.literal("order_core_line_items_with_adjustments"),
    lineItemDetail: SquareMinimizedOrderLineItemDetailSchema,
    taxes: z.array(SquareOrderTaxSchema).max(MAXIMUM_ORDER_ADJUSTMENTS),
    taxCount: z.number().int().nonnegative().max(MAXIMUM_ORDER_ADJUSTMENTS).safe(),
    discounts: z.array(SquareOrderDiscountSchema).max(MAXIMUM_ORDER_ADJUSTMENTS),
    discountCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_ADJUSTMENTS)
      .safe(),
    serviceCharges: z
      .array(SquareOrderServiceChargeSchema)
      .max(MAXIMUM_ORDER_ADJUSTMENTS),
    serviceChargeCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_ADJUSTMENTS)
      .safe(),
    lineItemApplications: z
      .array(SquareOrderLineItemAdjustmentApplicationsSchema)
      .max(MAXIMUM_ORDER_LINE_ITEMS),
    lineItemApplicationCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_ORDER_LINE_ITEMS)
      .safe()
  })
  .strict();

export const SquareOrderAdjustmentResponseSchema = z
  .object({
    contractVersion: z.literal(
      SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION
    ),
    minimizationVersion: z.literal(
      SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION
    ),
    entityType: z.literal("order_adjustment_detail_response"),
    operation: SquareOrderResponseOperationSchema,
    provider: SquareResponseProvenanceSchema,
    connectionAuthority: SquareOrderConnectionAuthoritySchema,
    requestAuthorityVersion: z.literal(SQUARE_ORDER_REQUEST_AUTHORITY_VERSION),
    requestAuthorityFingerprint: Sha256FingerprintSchema,
    pagination: SquareOrderPaginationStateSchema,
    items: z
      .array(SquareMinimizedOrderAdjustmentDetailSchema)
      .max(MAXIMUM_ORDER_RESPONSE_ITEMS),
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
export type SquareOrderCatalogReference = Readonly<
  z.infer<typeof SquareOrderCatalogReferenceSchema>
>;
type SquareOrderAdjustmentCatalogReference = Readonly<
  z.infer<typeof SquareOrderAdjustmentCatalogReferenceSchema>
>;
export type SquareOrderMeasurementUnit = Readonly<
  z.infer<typeof SquareOrderMeasurementUnitSchema>
>;
export type SquareOrderQuantityUnit = Readonly<
  z.infer<typeof SquareOrderQuantityUnitSchema>
>;
export type SquareOrderLineItemModifier = Readonly<
  z.infer<typeof SquareOrderLineItemModifierSchema>
>;
export type SquareOrderLineItem = Readonly<
  z.infer<typeof SquareOrderLineItemSchema>
>;
export type SquareMinimizedOrderLineItemDetail = Readonly<
  z.infer<typeof SquareMinimizedOrderLineItemDetailSchema>
>;
export type SquareOrderLineItemResponse = Readonly<
  z.infer<typeof SquareOrderLineItemResponseSchema>
>;
export type SquareOrderTax = Readonly<z.infer<typeof SquareOrderTaxSchema>>;
export type SquareOrderDiscount = Readonly<
  z.infer<typeof SquareOrderDiscountSchema>
>;
export type SquareOrderLineItemAppliedTax = Readonly<
  z.infer<typeof SquareOrderLineItemAppliedTaxSchema>
>;
export type SquareOrderLineItemAppliedDiscount = Readonly<
  z.infer<typeof SquareOrderLineItemAppliedDiscountSchema>
>;
export type SquareOrderLineItemAppliedServiceCharge = Readonly<
  z.infer<typeof SquareOrderLineItemAppliedServiceChargeSchema>
>;
export type SquareOrderServiceChargeAppliedTax = Readonly<
  z.infer<typeof SquareOrderServiceChargeAppliedTaxSchema>
>;
export type SquareOrderServiceCharge = Readonly<
  z.infer<typeof SquareOrderServiceChargeSchema>
>;
export type SquareOrderLineItemAdjustmentApplications = Readonly<
  z.infer<typeof SquareOrderLineItemAdjustmentApplicationsSchema>
>;
export type SquareMinimizedOrderAdjustmentDetail = Readonly<
  z.infer<typeof SquareMinimizedOrderAdjustmentDetailSchema>
>;
export type SquareOrderAdjustmentResponse = Readonly<
  z.infer<typeof SquareOrderAdjustmentResponseSchema>
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

type SquareParsedOrderEnvelope = Readonly<{
  parserInput: SquareOrderResponseParserInput;
  provenance: SquareResponseProvenance;
  response: SquareSafeJsonObject;
  orders: readonly Readonly<{
    raw: SquareSafeJsonObject;
    core: SquareMinimizedOrderCore;
  }>[];
  coreResponse: SquareOrderCoreResponse;
}>;

type SquareUnorderedOrderLineItemModifier = Readonly<
  Omit<SquareOrderLineItemModifier, "nestingDepth">
>;

type SquareUnorderedOrderLineItem = Readonly<{
  projection: Omit<SquareOrderLineItem, "modifiers" | "modifierCount">;
  modifiers: readonly SquareUnorderedOrderLineItemModifier[];
}>;

type SquareOrderAdjustmentTargets = Readonly<{
  taxUids: ReadonlySet<string>;
  discountUids: ReadonlySet<string>;
  serviceChargeUids: ReadonlySet<string>;
}>;

type SquareOrderAppliedIdentityState = {
  taxUids: Set<string>;
  discountUids: Set<string>;
  serviceChargeUids: Set<string>;
};

export function parseSquareOrderCoreResponse(
  input: unknown
): SquareResponseParserResult<SquareOrderCoreResponse> {
  return squareOrderResultBoundary(
    () => parseSquareOrderCoreResponseResult(input),
    SquareOrderCoreResponseSchema
  );
}

export function parseSquareOrderLineItemResponse(
  input: unknown
): SquareResponseParserResult<SquareOrderLineItemResponse> {
  return squareOrderResultBoundary(
    () => parseSquareOrderLineItemResponseResult(input),
    SquareOrderLineItemResponseSchema
  );
}

export function parseSquareOrderAdjustmentResponse(
  input: unknown
): SquareResponseParserResult<SquareOrderAdjustmentResponse> {
  return squareOrderResultBoundary(
    () => parseSquareOrderAdjustmentResponseResult(input),
    SquareOrderAdjustmentResponseSchema
  );
}

function parseSquareOrderCoreResponseResult(
  input: unknown
): SquareResponseParserResult<SquareOrderCoreResponse> {
  try {
    return squareAcceptedResult(parseSquareOrderEnvelope(input).coreResponse);
  } catch (error) {
    return squareOrderParserFailureResult(error);
  }
}

function parseSquareOrderLineItemResponseResult(
  input: unknown
): SquareResponseParserResult<SquareOrderLineItemResponse> {
  try {
    const parsed = parseSquareOrderEnvelope(input);
    const items = parsed.orders.map(({ raw, core }) =>
      minimizeSquareOrderLineItemDetail(raw, core, parsed.provenance)
    );
    return squareAcceptedResult(
      SquareOrderLineItemResponseSchema.parse({
        contractVersion: SQUARE_ORDER_LINE_ITEM_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_ORDER_LINE_ITEM_MINIMIZATION_VERSION,
        entityType: "order_line_item_detail_response",
        operation: parsed.coreResponse.operation,
        provider: parsed.coreResponse.provider,
        connectionAuthority: parsed.coreResponse.connectionAuthority,
        requestAuthorityVersion: parsed.coreResponse.requestAuthorityVersion,
        requestAuthorityFingerprint:
          parsed.coreResponse.requestAuthorityFingerprint,
        pagination: parsed.coreResponse.pagination,
        items,
        itemCount: items.length
      })
    );
  } catch (error) {
    return squareOrderParserFailureResult(error);
  }
}

function parseSquareOrderAdjustmentResponseResult(
  input: unknown
): SquareResponseParserResult<SquareOrderAdjustmentResponse> {
  try {
    const parsed = parseSquareOrderEnvelope(input);
    const items = parsed.orders.map(({ raw, core }) => {
      const lineItemDetail = minimizeSquareOrderLineItemDetail(
        raw,
        core,
        parsed.provenance
      );
      return minimizeSquareOrderAdjustmentDetail(
        raw,
        lineItemDetail,
        parsed.provenance
      );
    });
    return squareAcceptedResult(
      SquareOrderAdjustmentResponseSchema.parse({
        contractVersion: SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION,
        entityType: "order_adjustment_detail_response",
        operation: parsed.coreResponse.operation,
        provider: parsed.coreResponse.provider,
        connectionAuthority: parsed.coreResponse.connectionAuthority,
        requestAuthorityVersion: parsed.coreResponse.requestAuthorityVersion,
        requestAuthorityFingerprint:
          parsed.coreResponse.requestAuthorityFingerprint,
        pagination: parsed.coreResponse.pagination,
        items,
        itemCount: items.length
      })
    );
  } catch (error) {
    return squareOrderParserFailureResult(error);
  }
}

function parseSquareOrderEnvelope(input: unknown): SquareParsedOrderEnvelope {
  const parserInput = squareOrderResponseParserInput(input);
  const provenance = squareResponseProvenance(parserInput);
  const response = squareSafeJsonObject(parserInput.response);

  if (orderProviderErrorState(response) === "present") {
    throw new SquareOrderUnsupportedProjectionFailure(
      "square_order_provider_errors_present",
      "$response.errors"
    );
  }
  if (
    parserInput.operation === "orders_search" &&
    orderEntriesState(response) === "present"
  ) {
    throw new SquareOrderUnsupportedProjectionFailure(
      "square_order_entries_unsupported",
      "$response.order_entries"
    );
  }
  assertOrderEnvelopeShape(response, parserInput.operation);

  const orders = orderResponseItems(response, parserInput.operation).map(
    (raw) => ({
      raw,
      core: minimizeSquareOrderCore(raw, provenance, parserInput)
    })
  );
  assertUniqueOrderAuthorities(orders.map(({ core }) => core));
  orders.sort((left, right) => compareOrders(left.core, right.core));
  const items = orders.map(({ core }) => core);
  const coreResponse = SquareOrderCoreResponseSchema.parse({
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
  });
  return { parserInput, provenance, response, orders, coreResponse };
}

function squareOrderParserFailureResult(error: unknown) {
  if (error instanceof SquareOrderUnsupportedProjectionFailure) {
    return squareUnsupportedResult(error.code, error.field);
  }
  return squareFailureResult(error);
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

export function squareOrderLineItemDetailFingerprint(
  input: SquareMinimizedOrderLineItemDetail
) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedOrderLineItemDetailSchema.parse(input)
  );
}

export function squareOrderLineItemResponseFingerprint(
  input: SquareOrderLineItemResponse
) {
  return squareMinimizedProjectionFingerprint(
    SquareOrderLineItemResponseSchema.parse(input)
  );
}

export function squareOrderAdjustmentDetailFingerprint(
  input: SquareMinimizedOrderAdjustmentDetail
) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedOrderAdjustmentDetailSchema.parse(input)
  );
}

export function squareOrderAdjustmentResponseFingerprint(
  input: SquareOrderAdjustmentResponse
) {
  return squareMinimizedProjectionFingerprint(
    SquareOrderAdjustmentResponseSchema.parse(input)
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
      `${field}.version`,
      {
        minimum: MINIMUM_ORDER_PROVIDER_VERSION,
        maximum: MAXIMUM_ORDER_PROVIDER_VERSION
      }
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

function minimizeSquareOrderLineItemDetail(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance
): SquareMinimizedOrderLineItemDetail {
  const field = orderItemField(core.operation);
  const unorderedLineItems = unorderedOrderLineItems(
    input,
    core,
    provenance,
    field
  );
  assertUniqueLineItemAuthorities(unorderedLineItems);

  const modifierOwners = orderModifierOwners(unorderedLineItems);
  const lineItems = unorderedLineItems
    .map(({ projection, modifiers }) => {
      const orderedModifiers = orderedOrderLineItemModifiers(
        projection.uid,
        modifiers,
        modifierOwners,
        field
      );
      return SquareOrderLineItemSchema.parse({
        ...projection,
        modifiers: orderedModifiers,
        modifierCount: orderedModifiers.length
      });
    })
    .sort((left, right) => compareStrings(left.uid, right.uid));

  assertCompatibleOrderLineItemCurrencies(core, lineItems, field);
  return SquareMinimizedOrderLineItemDetailSchema.parse({
    contractVersion: SQUARE_ORDER_LINE_ITEM_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_ORDER_LINE_ITEM_MINIMIZATION_VERSION,
    entityType: "order_line_item_detail",
    entityVersion: SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION,
    projectionScope: "order_core_with_line_items",
    core,
    lineItems,
    lineItemCount: lineItems.length
  });
}

function minimizeSquareOrderAdjustmentDetail(
  input: SquareSafeJsonObject,
  lineItemDetail: SquareMinimizedOrderLineItemDetail,
  provenance: SquareResponseProvenance
): SquareMinimizedOrderAdjustmentDetail {
  const field = orderItemField(lineItemDetail.core.operation);
  const taxes = orderTaxes(input, lineItemDetail.core, provenance, field);
  const discounts = orderDiscounts(
    input,
    lineItemDetail.core,
    provenance,
    field
  );
  const taxUids = new Set(taxes.map(({ uid }) => uid));
  const discountUids = new Set(discounts.map(({ uid }) => uid));
  const appliedIdentityState: SquareOrderAppliedIdentityState = {
    taxUids: new Set(),
    discountUids: new Set(),
    serviceChargeUids: new Set()
  };
  const serviceCharges = orderServiceCharges(
    input,
    lineItemDetail.core,
    provenance,
    taxUids,
    appliedIdentityState,
    field
  );
  const targets: SquareOrderAdjustmentTargets = {
    taxUids,
    discountUids,
    serviceChargeUids: new Set(serviceCharges.map(({ uid }) => uid))
  };
  const lineItemApplications = orderLineItemAdjustmentApplications(
    input,
    lineItemDetail,
    provenance,
    targets,
    appliedIdentityState,
    field
  );
  assertCompatibleOrderAdjustmentCurrencies(
    lineItemDetail,
    taxes,
    discounts,
    serviceCharges,
    lineItemApplications,
    field
  );

  return SquareMinimizedOrderAdjustmentDetailSchema.parse({
    contractVersion: SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION,
    entityType: "order_adjustment_detail",
    entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
    projectionScope: "order_core_line_items_with_adjustments",
    lineItemDetail,
    taxes,
    taxCount: taxes.length,
    discounts,
    discountCount: discounts.length,
    serviceCharges,
    serviceChargeCount: serviceCharges.length,
    lineItemApplications,
    lineItemApplicationCount: lineItemApplications.length
  });
}

function orderTaxes(
  order: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
) {
  const taxes = optionalOrderAdjustmentObjects(
    order,
    "taxes",
    `${field}.taxes`,
    "square_order_tax_array_invalid"
  ).map((tax) => orderTax(tax, core, provenance, `${field}.taxes[]`));
  assertUniqueOrderAdjustmentIdentities(
    taxes,
    "square_duplicate_order_tax_identity"
  );
  return taxes.sort((left, right) => compareStrings(left.uid, right.uid));
}

function orderTax(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
): SquareOrderTax {
  const uid = requiredOrderAdjustmentComponentUid(
    input,
    "uid",
    `${field}.uid`,
    "square_order_tax_identity_missing"
  );
  const catalogReference = optionalOrderAdjustmentCatalogReference(
    input,
    "catalog_object_id",
    "catalog_version",
    provenance,
    `${field}.catalog_object_id`,
    `${field}.catalog_version`,
    "square_order_tax_catalog_reference_invalid"
  );
  return SquareOrderTaxSchema.parse({
    entityType: "order_tax",
    entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order_tax",
      orderId: core.id,
      taxUid: uid
    },
    sourceKind: catalogReference === null ? "ad_hoc" : "catalog_backed",
    uid,
    catalogReference,
    name: squareOptionalNullableDisplayText(input, "name", `${field}.name`, 255),
    type: squareOptionalNullableEnum(
      input,
      "type",
      `${field}.type`,
      SQUARE_ORDER_TAX_TYPES
    ),
    percentage: optionalOrderAdjustmentPercentage(
      input,
      "percentage",
      `${field}.percentage`
    ),
    appliedMoney: optionalOrderMoney(
      input,
      "applied_money",
      `${field}.applied_money`
    ),
    scope: squareOptionalNullableEnum(
      input,
      "scope",
      `${field}.scope`,
      SQUARE_ORDER_TAX_SCOPES
    ),
    autoApplied: optionalOrderBoolean(
      input,
      "auto_applied",
      `${field}.auto_applied`
    )
  });
}

function orderDiscounts(
  order: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
) {
  const discounts = optionalOrderAdjustmentObjects(
    order,
    "discounts",
    `${field}.discounts`,
    "square_order_discount_array_invalid"
  ).map((discount) =>
    orderDiscount(discount, core, provenance, `${field}.discounts[]`)
  );
  assertUniqueOrderAdjustmentIdentities(
    discounts,
    "square_duplicate_order_discount_identity"
  );
  return discounts.sort((left, right) => compareStrings(left.uid, right.uid));
}

function orderDiscount(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
): SquareOrderDiscount {
  const uid = requiredOrderAdjustmentComponentUid(
    input,
    "uid",
    `${field}.uid`,
    "square_order_discount_identity_missing"
  );
  const catalogReference = optionalOrderAdjustmentCatalogReference(
    input,
    "catalog_object_id",
    "catalog_version",
    provenance,
    `${field}.catalog_object_id`,
    `${field}.catalog_version`,
    "square_order_discount_catalog_reference_invalid"
  );
  const type = squareOptionalNullableEnum(
    input,
    "type",
    `${field}.type`,
    SQUARE_ORDER_DISCOUNT_TYPES
  );
  const percentage = optionalOrderAdjustmentPercentage(
    input,
    "percentage",
    `${field}.percentage`
  );
  const amountMoney = optionalOrderMoney(
    input,
    "amount_money",
    `${field}.amount_money`
  );
  assertOrderDiscountCompatibility(
    catalogReference,
    type,
    percentage,
    amountMoney,
    field
  );

  return SquareOrderDiscountSchema.parse({
    entityType: "order_discount",
    entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order_discount",
      orderId: core.id,
      discountUid: uid
    },
    sourceKind: catalogReference === null ? "ad_hoc" : "catalog_backed",
    uid,
    catalogReference,
    name: squareOptionalNullableDisplayText(input, "name", `${field}.name`, 255),
    type,
    percentage,
    amountMoney,
    appliedMoney: optionalOrderMoney(
      input,
      "applied_money",
      `${field}.applied_money`
    ),
    scope: squareOptionalNullableEnum(
      input,
      "scope",
      `${field}.scope`,
      SQUARE_ORDER_DISCOUNT_SCOPES
    )
  });
}

function assertOrderDiscountCompatibility(
  catalogReference: SquareOrderAdjustmentCatalogReference | null,
  type: (typeof SQUARE_ORDER_DISCOUNT_TYPES)[number] | null,
  percentage: string | null,
  amountMoney: SquareOrderMoney | null,
  field: string
) {
  if (
    catalogReference === null &&
    type !== "FIXED_PERCENTAGE" &&
    type !== "FIXED_AMOUNT"
  ) {
    squareRejectResponse(
      "square_order_discount_type_incompatible",
      `${field}.type`
    );
  }
  if (
    (percentage !== null && amountMoney !== null) ||
    ((type === "FIXED_PERCENTAGE" || type === "VARIABLE_PERCENTAGE") &&
      amountMoney !== null) ||
    ((type === "FIXED_AMOUNT" || type === "VARIABLE_AMOUNT") &&
      percentage !== null)
  ) {
    squareRejectResponse(
      "square_order_discount_value_incompatible",
      field
    );
  }
}

function orderServiceCharges(
  order: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  taxUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const serviceCharges = optionalOrderAdjustmentObjects(
    order,
    "service_charges",
    `${field}.service_charges`,
    "square_order_service_charge_array_invalid"
  ).map((serviceCharge) =>
    orderServiceCharge(
      serviceCharge,
      core,
      provenance,
      taxUids,
      appliedIdentityState,
      `${field}.service_charges[]`
    )
  );
  assertUniqueOrderAdjustmentIdentities(
    serviceCharges,
    "square_duplicate_order_service_charge_identity"
  );
  return serviceCharges.sort((left, right) =>
    compareStrings(left.uid, right.uid)
  );
}

function orderServiceCharge(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  taxUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
): SquareOrderServiceCharge {
  const uid = requiredOrderAdjustmentComponentUid(
    input,
    "uid",
    `${field}.uid`,
    "square_order_service_charge_identity_missing"
  );
  const catalogReference = optionalOrderAdjustmentCatalogReference(
    input,
    "catalog_object_id",
    "catalog_version",
    provenance,
    `${field}.catalog_object_id`,
    `${field}.catalog_version`,
    "square_order_service_charge_catalog_reference_invalid"
  );
  const percentage = optionalOrderAdjustmentPercentage(
    input,
    "percentage",
    `${field}.percentage`
  );
  const amountMoney = optionalOrderMoney(
    input,
    "amount_money",
    `${field}.amount_money`
  );
  const calculationPhase = squareOptionalNullableEnum(
    input,
    "calculation_phase",
    `${field}.calculation_phase`,
    SQUARE_ORDER_SERVICE_CHARGE_CALCULATION_PHASES
  );
  const taxable = optionalOrderBoolean(input, "taxable", `${field}.taxable`);
  const treatmentType = squareOptionalNullableEnum(
    input,
    "treatment_type",
    `${field}.treatment_type`,
    SQUARE_ORDER_SERVICE_CHARGE_TREATMENT_TYPES
  );
  const scope = squareOptionalNullableEnum(
    input,
    "scope",
    `${field}.scope`,
    SQUARE_ORDER_SERVICE_CHARGE_SCOPES
  );
  assertOrderServiceChargeCompatibility(
    percentage,
    amountMoney,
    calculationPhase,
    taxable,
    treatmentType,
    scope,
    field
  );
  const appliedTaxes = orderServiceChargeAppliedTaxes(
    input,
    core,
    uid,
    provenance,
    taxUids,
    appliedIdentityState,
    field
  );

  return SquareOrderServiceChargeSchema.parse({
    entityType: "order_service_charge",
    entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order_service_charge",
      orderId: core.id,
      serviceChargeUid: uid
    },
    sourceKind: catalogReference === null ? "ad_hoc" : "catalog_backed",
    uid,
    catalogReference,
    name: squareOptionalNullableDisplayText(input, "name", `${field}.name`, 512),
    percentage,
    amountMoney,
    appliedMoney: optionalOrderMoney(
      input,
      "applied_money",
      `${field}.applied_money`
    ),
    totalMoney: optionalOrderMoney(
      input,
      "total_money",
      `${field}.total_money`
    ),
    totalTaxMoney: optionalOrderMoney(
      input,
      "total_tax_money",
      `${field}.total_tax_money`
    ),
    calculationPhase,
    taxable,
    appliedTaxes,
    appliedTaxCount: appliedTaxes.length,
    type: squareOptionalNullableEnum(
      input,
      "type",
      `${field}.type`,
      SQUARE_ORDER_SERVICE_CHARGE_TYPES
    ),
    treatmentType,
    scope
  });
}

function assertOrderServiceChargeCompatibility(
  percentage: string | null,
  amountMoney: SquareOrderMoney | null,
  calculationPhase:
    | (typeof SQUARE_ORDER_SERVICE_CHARGE_CALCULATION_PHASES)[number]
    | null,
  taxable: boolean | null,
  treatmentType:
    | (typeof SQUARE_ORDER_SERVICE_CHARGE_TREATMENT_TYPES)[number]
    | null,
  scope: (typeof SQUARE_ORDER_SERVICE_CHARGE_SCOPES)[number] | null,
  field: string
) {
  if ((percentage === null) === (amountMoney === null)) {
    squareRejectResponse(
      "square_order_service_charge_value_incompatible",
      field
    );
  }
  if (
    (calculationPhase === "TOTAL_PHASE" && taxable === true) ||
    ((calculationPhase === "SUBTOTAL_PHASE" ||
      calculationPhase === "TOTAL_PHASE") &&
      scope === "LINE_ITEM") ||
    ((calculationPhase === "APPORTIONED_AMOUNT_PHASE" ||
      calculationPhase === "APPORTIONED_PERCENTAGE_PHASE") &&
      treatmentType === "LINE_ITEM_TREATMENT") ||
    (calculationPhase === "APPORTIONED_AMOUNT_PHASE" &&
      percentage !== null) ||
    (calculationPhase === "APPORTIONED_PERCENTAGE_PHASE" &&
      amountMoney !== null)
  ) {
    squareRejectResponse(
      "square_order_service_charge_phase_incompatible",
      `${field}.calculation_phase`
    );
  }
}

function orderServiceChargeAppliedTaxes(
  serviceCharge: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  serviceChargeUid: string,
  provenance: SquareResponseProvenance,
  taxUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const seenReferences = new Set<string>();
  return optionalOrderAdjustmentObjects(
    serviceCharge,
    "applied_taxes",
    `${field}.applied_taxes`,
    "square_order_applied_tax_array_invalid"
  )
    .map((appliedTax) => {
      const projection = orderAppliedTaxFacts(
        appliedTax,
        taxUids,
        appliedIdentityState,
        seenReferences,
        "square_duplicate_order_service_charge_applied_tax_reference",
        `${field}.applied_taxes[]`
      );
      return SquareOrderServiceChargeAppliedTaxSchema.parse({
        entityType: "order_service_charge_applied_tax",
        entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
        authority: {
          providerKey: SQUARE_PROVIDER_KEY,
          providerEnvironment: provenance.providerEnvironment,
          entityType: "order_service_charge_applied_tax",
          orderId: core.id,
          serviceChargeUid,
          taxUid: projection.taxUid
        },
        ...projection
      });
    })
    .sort(compareAppliedTaxes);
}

function orderLineItemAdjustmentApplications(
  order: SquareSafeJsonObject,
  lineItemDetail: SquareMinimizedOrderLineItemDetail,
  provenance: SquareResponseProvenance,
  targets: SquareOrderAdjustmentTargets,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const lineItemsByUid = new Map(
    lineItemDetail.lineItems.map((lineItem) => [lineItem.uid, lineItem])
  );
  const rawLineItems = optionalOrderAdjustmentObjects(
    order,
    "line_items",
    `${field}.line_items`,
    "square_order_line_item_array_invalid"
  );
  const applications = rawLineItems.map((lineItem) => {
    const lineItemUid = requiredOrderComponentUid(
      lineItem,
      "uid",
      `${field}.line_items[].uid`,
      "square_order_line_item_identity_missing"
    );
    if (!lineItemsByUid.has(lineItemUid)) {
      squareRejectResponse("square_response_internal_rejection", "$response");
    }
    return orderLineItemAdjustmentApplication(
      lineItem,
      lineItemDetail.core,
      lineItemUid,
      provenance,
      targets,
      appliedIdentityState,
      `${field}.line_items[]`
    );
  });
  if (applications.length !== lineItemDetail.lineItems.length) {
    squareRejectResponse("square_response_internal_rejection", "$response");
  }
  return applications.sort((left, right) =>
    compareStrings(left.lineItemUid, right.lineItemUid)
  );
}

function orderLineItemAdjustmentApplication(
  lineItem: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  targets: SquareOrderAdjustmentTargets,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
): SquareOrderLineItemAdjustmentApplications {
  const appliedTaxes = orderLineItemAppliedTaxes(
    lineItem,
    core,
    lineItemUid,
    provenance,
    targets.taxUids,
    appliedIdentityState,
    field
  );
  const appliedDiscounts = orderLineItemAppliedDiscounts(
    lineItem,
    core,
    lineItemUid,
    provenance,
    targets.discountUids,
    appliedIdentityState,
    field
  );
  const appliedServiceCharges = orderLineItemAppliedServiceCharges(
    lineItem,
    core,
    lineItemUid,
    provenance,
    targets.serviceChargeUids,
    appliedIdentityState,
    field
  );
  return SquareOrderLineItemAdjustmentApplicationsSchema.parse({
    entityType: "order_line_item_adjustments",
    entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order_line_item_adjustments",
      orderId: core.id,
      lineItemUid
    },
    lineItemUid,
    appliedTaxes,
    appliedTaxCount: appliedTaxes.length,
    appliedDiscounts,
    appliedDiscountCount: appliedDiscounts.length,
    appliedServiceCharges,
    appliedServiceChargeCount: appliedServiceCharges.length
  });
}

function orderLineItemAppliedTaxes(
  lineItem: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  taxUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const seenReferences = new Set<string>();
  return optionalOrderAdjustmentObjects(
    lineItem,
    "applied_taxes",
    `${field}.applied_taxes`,
    "square_order_applied_tax_array_invalid"
  )
    .map((appliedTax) => {
      const projection = orderAppliedTaxFacts(
        appliedTax,
        taxUids,
        appliedIdentityState,
        seenReferences,
        "square_duplicate_order_line_item_applied_tax_reference",
        `${field}.applied_taxes[]`
      );
      return SquareOrderLineItemAppliedTaxSchema.parse({
        entityType: "order_line_item_applied_tax",
        entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
        authority: {
          providerKey: SQUARE_PROVIDER_KEY,
          providerEnvironment: provenance.providerEnvironment,
          entityType: "order_line_item_applied_tax",
          orderId: core.id,
          lineItemUid,
          taxUid: projection.taxUid
        },
        ...projection
      });
    })
    .sort(compareAppliedTaxes);
}

function orderAppliedTaxFacts(
  input: SquareSafeJsonObject,
  targetUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  seenReferences: Set<string>,
  duplicateReferenceCode: string,
  field: string
) {
  const uid = optionalOrderAdjustmentComponentUid(
    input,
    "uid",
    `${field}.uid`
  );
  trackAppliedIdentity(
    uid,
    appliedIdentityState.taxUids,
    "square_duplicate_order_applied_tax_identity"
  );
  const taxUid = requiredOrderAdjustmentReferenceUid(
    input,
    "tax_uid",
    `${field}.tax_uid`,
    "square_order_applied_tax_reference_missing"
  );
  assertOrderAdjustmentReference(
    taxUid,
    targetUids,
    seenReferences,
    "square_order_applied_tax_reference_dangling",
    duplicateReferenceCode,
    field
  );
  return {
    uid,
    taxUid,
    appliedMoney: optionalOrderMoney(
      input,
      "applied_money",
      `${field}.applied_money`
    ),
    autoApplied: optionalOrderBoolean(
      input,
      "auto_applied",
      `${field}.auto_applied`
    )
  } as const;
}

function orderLineItemAppliedDiscounts(
  lineItem: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  discountUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const seenReferences = new Set<string>();
  return optionalOrderAdjustmentObjects(
    lineItem,
    "applied_discounts",
    `${field}.applied_discounts`,
    "square_order_applied_discount_array_invalid"
  )
    .map((appliedDiscount) => {
      const uid = optionalOrderAdjustmentComponentUid(
        appliedDiscount,
        "uid",
        `${field}.applied_discounts[].uid`
      );
      trackAppliedIdentity(
        uid,
        appliedIdentityState.discountUids,
        "square_duplicate_order_applied_discount_identity"
      );
      const discountUid = requiredOrderAdjustmentReferenceUid(
        appliedDiscount,
        "discount_uid",
        `${field}.applied_discounts[].discount_uid`,
        "square_order_applied_discount_reference_missing"
      );
      assertOrderAdjustmentReference(
        discountUid,
        discountUids,
        seenReferences,
        "square_order_applied_discount_reference_dangling",
        "square_duplicate_order_line_item_applied_discount_reference",
        `${field}.applied_discounts[]`
      );
      return SquareOrderLineItemAppliedDiscountSchema.parse({
        entityType: "order_line_item_applied_discount",
        entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
        authority: {
          providerKey: SQUARE_PROVIDER_KEY,
          providerEnvironment: provenance.providerEnvironment,
          entityType: "order_line_item_applied_discount",
          orderId: core.id,
          lineItemUid,
          discountUid
        },
        uid,
        discountUid,
        appliedMoney: optionalOrderMoney(
          appliedDiscount,
          "applied_money",
          `${field}.applied_discounts[].applied_money`
        )
      });
    })
    .sort((left, right) =>
      compareAppliedAdjustments(
        left.discountUid,
        left.uid,
        right.discountUid,
        right.uid
      )
    );
}

function orderLineItemAppliedServiceCharges(
  lineItem: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  serviceChargeUids: ReadonlySet<string>,
  appliedIdentityState: SquareOrderAppliedIdentityState,
  field: string
) {
  const seenReferences = new Set<string>();
  return optionalOrderAdjustmentObjects(
    lineItem,
    "applied_service_charges",
    `${field}.applied_service_charges`,
    "square_order_applied_service_charge_array_invalid"
  )
    .map((appliedServiceCharge) => {
      const uid = optionalOrderAdjustmentComponentUid(
        appliedServiceCharge,
        "uid",
        `${field}.applied_service_charges[].uid`
      );
      trackAppliedIdentity(
        uid,
        appliedIdentityState.serviceChargeUids,
        "square_duplicate_order_applied_service_charge_identity"
      );
      const serviceChargeUid = requiredOrderAdjustmentReferenceUid(
        appliedServiceCharge,
        "service_charge_uid",
        `${field}.applied_service_charges[].service_charge_uid`,
        "square_order_applied_service_charge_reference_missing"
      );
      assertOrderAdjustmentReference(
        serviceChargeUid,
        serviceChargeUids,
        seenReferences,
        "square_order_applied_service_charge_reference_dangling",
        "square_duplicate_order_line_item_applied_service_charge_reference",
        `${field}.applied_service_charges[]`
      );
      return SquareOrderLineItemAppliedServiceChargeSchema.parse({
        entityType: "order_line_item_applied_service_charge",
        entityVersion: SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION,
        authority: {
          providerKey: SQUARE_PROVIDER_KEY,
          providerEnvironment: provenance.providerEnvironment,
          entityType: "order_line_item_applied_service_charge",
          orderId: core.id,
          lineItemUid,
          serviceChargeUid
        },
        uid,
        serviceChargeUid,
        appliedMoney: optionalOrderMoney(
          appliedServiceCharge,
          "applied_money",
          `${field}.applied_service_charges[].applied_money`
        )
      });
    })
    .sort((left, right) =>
      compareAppliedAdjustments(
        left.serviceChargeUid,
        left.uid,
        right.serviceChargeUid,
        right.uid
      )
    );
}

function optionalOrderAdjustmentObjects(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  diagnosticCode: string
) {
  if (!hasOwn(record, key) || record[key] === null) return [];
  const values = record[key];
  if (!Array.isArray(values) || values.length > MAXIMUM_ORDER_ADJUSTMENTS) {
    squareRejectResponse(diagnosticCode, field);
  }
  return values.map((value) => squareSafeJsonObject(value, `${field}[]`));
}

function assertUniqueOrderAdjustmentIdentities(
  items: readonly Readonly<{ uid: string }>[],
  diagnosticCode: string
) {
  const seen = new Set<string>();
  for (const { uid } of items) {
    if (seen.has(uid)) squareRejectResponse(diagnosticCode, "$response");
    seen.add(uid);
  }
}

function requiredOrderAdjustmentReferenceUid(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  diagnosticCode: string
) {
  if (!hasOwn(record, key)) {
    squareRejectResponse(diagnosticCode, field);
  }
  const parsed = SquareOrderAdjustmentComponentUidSchema.safeParse(record[key]);
  if (!parsed.success) squareRejectResponse(diagnosticCode, field);
  return parsed.data;
}

function assertOrderAdjustmentReference(
  targetUid: string,
  targetUids: ReadonlySet<string>,
  seenReferences: Set<string>,
  danglingCode: string,
  duplicateCode: string,
  field: string
) {
  if (!targetUids.has(targetUid)) squareRejectResponse(danglingCode, field);
  if (seenReferences.has(targetUid)) squareRejectResponse(duplicateCode, field);
  seenReferences.add(targetUid);
}

function trackAppliedIdentity(
  uid: string | null,
  seen: Set<string>,
  diagnosticCode: string
) {
  if (uid === null) return;
  if (seen.has(uid)) squareRejectResponse(diagnosticCode, "$response");
  seen.add(uid);
}

function optionalOrderAdjustmentPercentage(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_ORDER_ADJUSTMENT_PERCENTAGE_LENGTH ||
    !ORDER_PERCENTAGE_PATTERN.test(value)
  ) {
    squareRejectResponse("square_order_adjustment_percentage_invalid", field);
  }
  const [whole, fractional = ""] = value.split(".");
  const canonicalFractional = fractional.replace(/0+$/u, "");
  const canonical =
    canonicalFractional.length > 0 ? `${whole}.${canonicalFractional}` : whole;
  if (!SquareOrderAdjustmentPercentageSchema.safeParse(canonical).success) {
    squareRejectResponse("square_order_adjustment_percentage_invalid", field);
  }
  return canonical;
}

function optionalOrderBoolean(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "boolean") {
    squareRejectResponse("square_boolean_invalid", field);
  }
  return value;
}

function compareAppliedTaxes(
  left: Readonly<{ taxUid: string; uid: string | null }>,
  right: Readonly<{ taxUid: string; uid: string | null }>
) {
  return compareAppliedAdjustments(left.taxUid, left.uid, right.taxUid, right.uid);
}

function compareAppliedAdjustments(
  leftTargetUid: string,
  leftUid: string | null,
  rightTargetUid: string,
  rightUid: string | null
) {
  const targetCompared = compareStrings(leftTargetUid, rightTargetUid);
  if (targetCompared !== 0) return targetCompared;
  return compareStrings(leftUid ?? "", rightUid ?? "");
}

function assertCompatibleOrderAdjustmentCurrencies(
  lineItemDetail: SquareMinimizedOrderLineItemDetail,
  taxes: readonly SquareOrderTax[],
  discounts: readonly SquareOrderDiscount[],
  serviceCharges: readonly SquareOrderServiceCharge[],
  lineItemApplications: readonly SquareOrderLineItemAdjustmentApplications[],
  field: string
) {
  const core = lineItemDetail.core;
  const monies: (SquareOrderMoney | null)[] = [
    core.totalMoney,
    core.totalTaxMoney,
    core.totalDiscountMoney,
    core.totalTipMoney,
    core.totalServiceChargeMoney,
    core.netAmountDueMoney
  ];
  for (const lineItem of lineItemDetail.lineItems) {
    monies.push(
      lineItem.basePriceMoney,
      lineItem.variationTotalPriceMoney,
      lineItem.grossSalesMoney,
      lineItem.totalTaxMoney,
      lineItem.totalDiscountMoney,
      lineItem.totalServiceChargeMoney,
      lineItem.totalMoney
    );
    for (const modifier of lineItem.modifiers) {
      monies.push(modifier.basePriceMoney, modifier.totalPriceMoney);
    }
  }
  for (const tax of taxes) monies.push(tax.appliedMoney);
  for (const discount of discounts) {
    monies.push(discount.amountMoney, discount.appliedMoney);
  }
  for (const serviceCharge of serviceCharges) {
    monies.push(
      serviceCharge.amountMoney,
      serviceCharge.appliedMoney,
      serviceCharge.totalMoney,
      serviceCharge.totalTaxMoney
    );
    for (const appliedTax of serviceCharge.appliedTaxes) {
      monies.push(appliedTax.appliedMoney);
    }
  }
  for (const applications of lineItemApplications) {
    for (const appliedTax of applications.appliedTaxes) {
      monies.push(appliedTax.appliedMoney);
    }
    for (const appliedDiscount of applications.appliedDiscounts) {
      monies.push(appliedDiscount.appliedMoney);
    }
    for (const appliedServiceCharge of applications.appliedServiceCharges) {
      monies.push(appliedServiceCharge.appliedMoney);
    }
  }
  const currencies = new Set(
    monies.flatMap((money) =>
      money?.currency === null || money?.currency === undefined
        ? []
        : [money.currency]
    )
  );
  if (currencies.size > 1) {
    squareRejectResponse(
      "square_order_adjustment_currency_mismatch",
      `${field}.adjustments`
    );
  }
}

function unorderedOrderLineItems(
  order: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
): readonly SquareUnorderedOrderLineItem[] {
  if (!hasOwn(order, "line_items") || order.line_items === null) return [];
  if (
    !Array.isArray(order.line_items) ||
    order.line_items.length > MAXIMUM_ORDER_LINE_ITEMS
  ) {
    squareRejectResponse(
      "square_order_line_item_array_invalid",
      `${field}.line_items`
    );
  }
  return order.line_items.map((lineItem) =>
    unorderedOrderLineItem(
      squareSafeJsonObject(lineItem, `${field}.line_items[]`),
      core,
      provenance,
      `${field}.line_items[]`
    )
  );
}

function unorderedOrderLineItem(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  provenance: SquareResponseProvenance,
  field: string
): SquareUnorderedOrderLineItem {
  const uid = requiredOrderComponentUid(
    input,
    "uid",
    `${field}.uid`,
    "square_order_line_item_identity_missing"
  );
  const catalogReference = optionalOrderCatalogReference(
    input,
    "catalog_object_id",
    "catalog_version",
    provenance,
    `${field}.catalog_object_id`,
    `${field}.catalog_version`,
    "square_order_line_item_catalog_reference_invalid"
  );
  const quantity = requiredOrderQuantity(
    input,
    "quantity",
    `${field}.quantity`,
    MAXIMUM_ORDER_LINE_ITEM_QUANTITY_LENGTH,
    "square_order_line_item_quantity_invalid"
  );
  const quantityUnit = optionalOrderQuantityUnit(
    input,
    quantity,
    provenance,
    field
  );
  const modifiers = unorderedOrderLineItemModifiers(
    input,
    core,
    uid,
    provenance,
    field
  );

  return {
    projection: {
      entityType: "order_line_item",
      entityVersion: SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION,
      authority: {
        providerKey: SQUARE_PROVIDER_KEY,
        providerEnvironment: provenance.providerEnvironment,
        entityType: "order_line_item",
        orderId: core.id,
        lineItemUid: uid
      },
      sourceKind: catalogReference === null ? "ad_hoc" : "catalog_backed",
      uid,
      catalogReference,
      name: squareOptionalNullableDisplayText(
        input,
        "name",
        `${field}.name`,
        512
      ),
      variationName: squareOptionalNullableDisplayText(
        input,
        "variation_name",
        `${field}.variation_name`,
        400
      ),
      itemType: squareOptionalNullableEnum(
        input,
        "item_type",
        `${field}.item_type`,
        SQUARE_ORDER_LINE_ITEM_ITEM_TYPES
      ),
      quantity,
      quantityUnit,
      basePriceMoney: optionalOrderMoney(
        input,
        "base_price_money",
        `${field}.base_price_money`
      ),
      variationTotalPriceMoney: optionalOrderMoney(
        input,
        "variation_total_price_money",
        `${field}.variation_total_price_money`
      ),
      grossSalesMoney: optionalOrderMoney(
        input,
        "gross_sales_money",
        `${field}.gross_sales_money`
      ),
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
      totalServiceChargeMoney: optionalOrderMoney(
        input,
        "total_service_charge_money",
        `${field}.total_service_charge_money`
      ),
      totalMoney: optionalOrderMoney(
        input,
        "total_money",
        `${field}.total_money`
      )
    },
    modifiers
  };
}

function optionalOrderQuantityUnit(
  lineItem: SquareSafeJsonObject,
  quantity: string,
  provenance: SquareResponseProvenance,
  field: string
): SquareOrderQuantityUnit | null {
  if (!hasOwn(lineItem, "quantity_unit") || lineItem.quantity_unit === null) {
    return null;
  }
  const quantityUnit = squareSafeJsonObject(
    lineItem.quantity_unit,
    `${field}.quantity_unit`
  );
  const precision = optionalOrderSafeInteger(
    quantityUnit,
    "precision",
    `${field}.quantity_unit.precision`,
    0,
    5,
    "square_order_quantity_precision_invalid"
  );
  if (precision !== null && orderQuantityFractionalDigits(quantity) > precision) {
    squareRejectResponse(
      "square_order_quantity_precision_mismatch",
      `${field}.quantity`
    );
  }

  return SquareOrderQuantityUnitSchema.parse({
    measurementUnit: optionalOrderMeasurementUnit(quantityUnit, field),
    precision,
    catalogReference: optionalOrderCatalogReference(
      quantityUnit,
      "catalog_object_id",
      "catalog_version",
      provenance,
      `${field}.quantity_unit.catalog_object_id`,
      `${field}.quantity_unit.catalog_version`,
      "square_order_quantity_unit_catalog_reference_invalid"
    )
  });
}

function optionalOrderMeasurementUnit(
  quantityUnit: SquareSafeJsonObject,
  field: string
): SquareOrderMeasurementUnit | null {
  if (
    !hasOwn(quantityUnit, "measurement_unit") ||
    quantityUnit.measurement_unit === null
  ) {
    return null;
  }
  const measurementUnit = squareSafeJsonObject(
    quantityUnit.measurement_unit,
    `${field}.quantity_unit.measurement_unit`
  );
  const unitKeys = [
    "custom_unit",
    "area_unit",
    "length_unit",
    "volume_unit",
    "weight_unit",
    "generic_unit",
    "time_unit"
  ] as const;
  const selectedKeys = unitKeys.filter(
    (key) => hasOwn(measurementUnit, key) && measurementUnit[key] !== null
  );
  if (selectedKeys.length !== 1) {
    squareRejectResponse(
      "square_order_measurement_unit_invalid",
      `${field}.quantity_unit.measurement_unit`
    );
  }

  const declaredType = optionalOrderMeasurementUnitType(
    measurementUnit,
    `${field}.quantity_unit.measurement_unit.type`
  );
  const selectedKey = selectedKeys[0];
  const unitField = `${field}.quantity_unit.measurement_unit.${selectedKey}`;

  if (selectedKey === "custom_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_CUSTOM", unitField);
    const custom = squareSafeJsonObject(measurementUnit[selectedKey], unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "custom",
      type: declaredType,
      custom: {
        name: requiredOrderDisplayText(custom, "name", `${unitField}.name`),
        abbreviation: requiredOrderDisplayText(
          custom,
          "abbreviation",
          `${unitField}.abbreviation`
        )
      }
    });
  }
  if (selectedKey === "area_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_AREA", unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "area",
      type: declaredType,
      unit: requiredOrderMeasurementEnum(
        measurementUnit,
        selectedKey,
        unitField,
        SQUARE_ORDER_MEASUREMENT_AREA_UNITS
      )
    });
  }
  if (selectedKey === "length_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_LENGTH", unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "length",
      type: declaredType,
      unit: requiredOrderMeasurementEnum(
        measurementUnit,
        selectedKey,
        unitField,
        SQUARE_ORDER_MEASUREMENT_LENGTH_UNITS
      )
    });
  }
  if (selectedKey === "volume_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_VOLUME", unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "volume",
      type: declaredType,
      unit: requiredOrderMeasurementEnum(
        measurementUnit,
        selectedKey,
        unitField,
        SQUARE_ORDER_MEASUREMENT_VOLUME_UNITS
      )
    });
  }
  if (selectedKey === "weight_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_WEIGHT", unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "weight",
      type: declaredType,
      unit: requiredOrderMeasurementEnum(
        measurementUnit,
        selectedKey,
        unitField,
        SQUARE_ORDER_MEASUREMENT_WEIGHT_UNITS
      )
    });
  }
  if (selectedKey === "generic_unit") {
    assertOrderMeasurementType(declaredType, "TYPE_GENERIC", unitField);
    return SquareOrderMeasurementUnitSchema.parse({
      kind: "generic",
      type: declaredType,
      unit: requiredOrderMeasurementEnum(
        measurementUnit,
        selectedKey,
        unitField,
        ["UNIT"] as const
      )
    });
  }

  if (declaredType !== null) {
    squareRejectResponse("square_order_measurement_unit_invalid", unitField);
  }
  return SquareOrderMeasurementUnitSchema.parse({
    kind: "time",
    type: null,
    unit: requiredOrderMeasurementEnum(
      measurementUnit,
      selectedKey,
      unitField,
      SQUARE_ORDER_MEASUREMENT_TIME_UNITS
    )
  });
}

function optionalOrderMeasurementUnitType(
  measurementUnit: SquareSafeJsonObject,
  field: string
): (typeof SQUARE_ORDER_MEASUREMENT_UNIT_TYPES)[number] | null {
  const type = squareOptionalNullableString(measurementUnit, "type", field, 128);
  if (type === null) return null;
  if (
    !SQUARE_ORDER_MEASUREMENT_UNIT_TYPES.includes(
      type as (typeof SQUARE_ORDER_MEASUREMENT_UNIT_TYPES)[number]
    )
  ) {
    throw new SquareOrderUnsupportedProjectionFailure(
      "square_order_measurement_unit_type_unsupported",
      field
    );
  }
  return type as (typeof SQUARE_ORDER_MEASUREMENT_UNIT_TYPES)[number];
}

function assertOrderMeasurementType(
  actual: (typeof SQUARE_ORDER_MEASUREMENT_UNIT_TYPES)[number] | null,
  expected: (typeof SQUARE_ORDER_MEASUREMENT_UNIT_TYPES)[number],
  field: string
) {
  if (actual !== null && actual !== expected) {
    squareRejectResponse("square_order_measurement_unit_invalid", field);
  }
}

function requiredOrderMeasurementEnum<T extends string>(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  allowed: readonly T[]
): T {
  const value = record[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    squareRejectResponse("square_order_measurement_unit_invalid", field);
  }
  return value as T;
}

function requiredOrderDisplayText(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  const value = squareOptionalNullableDisplayText(record, key, field, 4_096);
  if (value === null) {
    squareRejectResponse("square_display_text_invalid", field);
  }
  return value;
}

function squareOrderSafeOpaqueStringSchema(maximumLength: number) {
  return z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => {
      try {
        return (
          squareOptionalNullableString(
            { value },
            "value",
            "$response",
            maximumLength
          ) === value
        );
      } catch {
        return false;
      }
    }, "Opaque Square identifier must be bounded and safe");
}

function squareOrderDisplayTextSchema(maximumLength: number) {
  return z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => {
      try {
        return (
          squareOptionalNullableDisplayText(
            { value },
            "value",
            "$response",
            maximumLength
          ) === value
        );
      } catch {
        return false;
      }
    }, "Display text must be safe and canonical");
}

function unorderedOrderLineItemModifiers(
  lineItem: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  field: string
): readonly SquareUnorderedOrderLineItemModifier[] {
  if (!hasOwn(lineItem, "modifiers") || lineItem.modifiers === null) return [];
  if (
    !Array.isArray(lineItem.modifiers) ||
    lineItem.modifiers.length > MAXIMUM_ORDER_LINE_ITEM_MODIFIERS
  ) {
    squareRejectResponse(
      "square_order_line_item_modifier_array_invalid",
      `${field}.modifiers`
    );
  }
  return lineItem.modifiers.map((modifier) =>
    unorderedOrderLineItemModifier(
      squareSafeJsonObject(modifier, `${field}.modifiers[]`),
      core,
      lineItemUid,
      provenance,
      `${field}.modifiers[]`
    )
  );
}

function unorderedOrderLineItemModifier(
  input: SquareSafeJsonObject,
  core: SquareMinimizedOrderCore,
  lineItemUid: string,
  provenance: SquareResponseProvenance,
  field: string
): SquareUnorderedOrderLineItemModifier {
  const uid = requiredOrderComponentUid(
    input,
    "uid",
    `${field}.uid`,
    "square_order_line_item_modifier_identity_missing"
  );
  const catalogReference = optionalOrderCatalogReference(
    input,
    "catalog_object_id",
    "catalog_version",
    provenance,
    `${field}.catalog_object_id`,
    `${field}.catalog_version`,
    "square_order_modifier_catalog_reference_invalid"
  );
  const basePriceMoney = optionalOrderMoney(
    input,
    "base_price_money",
    `${field}.base_price_money`
  );
  if (catalogReference === null && basePriceMoney === null) {
    squareRejectResponse("square_order_modifier_price_missing", field);
  }

  return {
    entityType: "order_line_item_modifier",
    entityVersion: SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType: "order_line_item_modifier",
      orderId: core.id,
      lineItemUid,
      modifierUid: uid
    },
    sourceKind: catalogReference === null ? "ad_hoc" : "catalog_backed",
    pricingSource:
      catalogReference === null
        ? "ad_hoc_base_price"
        : basePriceMoney === null
          ? "catalog_default_or_unknown"
          : "catalog_base_price_override",
    uid,
    catalogReference,
    name: squareOptionalNullableDisplayText(input, "name", `${field}.name`, 255),
    quantity: optionalOrderQuantity(
      input,
      "quantity",
      `${field}.quantity`,
      MAXIMUM_ORDER_MODIFIER_QUANTITY_LENGTH,
      "square_order_modifier_quantity_invalid"
    ),
    basePriceMoney,
    totalPriceMoney: optionalOrderMoney(
      input,
      "total_price_money",
      `${field}.total_price_money`
    ),
    parentModifierUid: optionalOrderComponentUid(
      input,
      "parent_modifier_uid",
      `${field}.parent_modifier_uid`
    )
  };
}

function assertUniqueLineItemAuthorities(
  lineItems: readonly SquareUnorderedOrderLineItem[]
) {
  const seen = new Set<string>();
  for (const { projection } of lineItems) {
    if (seen.has(projection.uid)) {
      squareRejectResponse(
        "square_duplicate_order_line_item_identity",
        "$response"
      );
    }
    seen.add(projection.uid);
  }
}

function orderModifierOwners(
  lineItems: readonly SquareUnorderedOrderLineItem[]
) {
  const owners = new Map<string, string>();
  for (const { projection, modifiers } of lineItems) {
    for (const modifier of modifiers) {
      if (owners.has(modifier.uid)) {
        squareRejectResponse(
          "square_duplicate_order_modifier_identity",
          "$response"
        );
      }
      owners.set(modifier.uid, projection.uid);
    }
  }
  return owners;
}

function orderedOrderLineItemModifiers(
  lineItemUid: string,
  modifiers: readonly SquareUnorderedOrderLineItemModifier[],
  modifierOwners: ReadonlyMap<string, string>,
  field: string
): readonly SquareOrderLineItemModifier[] {
  const byUid = new Map(modifiers.map((modifier) => [modifier.uid, modifier]));
  const ancestry = new Map<
    string,
    Readonly<{ depth: number; path: readonly string[] }>
  >();
  const visiting = new Set<string>();

  const resolveAncestry = (
    modifier: SquareUnorderedOrderLineItemModifier
  ): Readonly<{ depth: number; path: readonly string[] }> => {
    const resolved = ancestry.get(modifier.uid);
    if (resolved !== undefined) return resolved;
    if (visiting.has(modifier.uid)) {
      squareRejectResponse("square_order_modifier_parent_cycle", field);
    }
    visiting.add(modifier.uid);
    try {
      const parentUid = modifier.parentModifierUid;
      let next: Readonly<{ depth: number; path: readonly string[] }>;
      if (parentUid === null) {
        next = { depth: 1, path: [modifier.uid] };
      } else {
        if (parentUid === modifier.uid) {
          squareRejectResponse("square_order_modifier_parent_self", field);
        }
        const parent = byUid.get(parentUid);
        if (parent === undefined) {
          const parentOwner = modifierOwners.get(parentUid);
          if (parentOwner !== undefined && parentOwner !== lineItemUid) {
            squareRejectResponse(
              "square_order_modifier_parent_cross_line_item",
              field
            );
          }
          squareRejectResponse("square_order_modifier_parent_missing", field);
        }
        const parentAncestry = resolveAncestry(parent);
        next = {
          depth: parentAncestry.depth + 1,
          path: [...parentAncestry.path, modifier.uid]
        };
      }
      if (next.depth > MAXIMUM_ORDER_MODIFIER_NESTING_DEPTH) {
        squareRejectResponse(
          "square_order_modifier_nesting_depth_invalid",
          field
        );
      }
      ancestry.set(modifier.uid, next);
      return next;
    } finally {
      visiting.delete(modifier.uid);
    }
  };

  for (const modifier of modifiers) resolveAncestry(modifier);
  return modifiers
    .map((modifier) =>
      SquareOrderLineItemModifierSchema.parse({
        ...modifier,
        nestingDepth: ancestry.get(modifier.uid)?.depth
      })
    )
    .sort((left, right) =>
      compareStringPaths(
        ancestry.get(left.uid)?.path ?? [],
        ancestry.get(right.uid)?.path ?? []
      )
    );
}

function optionalOrderCatalogReference(
  record: SquareSafeJsonObject,
  identifierKey: string,
  versionKey: string,
  provenance: SquareResponseProvenance,
  identifierField: string,
  versionField: string,
  diagnosticCode: string
): SquareOrderCatalogReference | null {
  const providerId = optionalOrderCatalogIdentifier(
    record,
    identifierKey,
    identifierField,
    diagnosticCode
  );
  const providerVersion = optionalOrderCatalogVersion(
    record,
    versionKey,
    versionField,
    diagnosticCode
  );
  if (providerId === null) {
    if (providerVersion !== null) {
      squareRejectResponse(diagnosticCode, versionField);
    }
    return null;
  }
  return SquareOrderCatalogReferenceSchema.parse({
    providerKey: SQUARE_PROVIDER_KEY,
    providerEnvironment: provenance.providerEnvironment,
    referenceKind: "catalog_object",
    reconciliationState: "unverified",
    providerId,
    providerVersion
  });
}

function optionalOrderAdjustmentCatalogReference(
  record: SquareSafeJsonObject,
  identifierKey: string,
  versionKey: string,
  provenance: SquareResponseProvenance,
  identifierField: string,
  versionField: string,
  diagnosticCode: string
): SquareOrderAdjustmentCatalogReference | null {
  const providerId = squareOptionalNullableString(
    record,
    identifierKey,
    identifierField,
    192
  );
  const providerVersion = optionalOrderCatalogVersion(
    record,
    versionKey,
    versionField,
    diagnosticCode
  );
  if (providerId === null) {
    if (providerVersion !== null) {
      squareRejectResponse(diagnosticCode, versionField);
    }
    return null;
  }
  return SquareOrderAdjustmentCatalogReferenceSchema.parse({
    providerKey: SQUARE_PROVIDER_KEY,
    providerEnvironment: provenance.providerEnvironment,
    referenceKind: "catalog_object",
    reconciliationState: "unverified",
    providerId,
    providerVersion
  });
}

function optionalOrderCatalogIdentifier(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  diagnosticCode: string
) {
  const value = squareOptionalNullableString(record, key, field, 192);
  if (value !== null && !ORDER_CATALOG_IDENTIFIER_PATTERN.test(value)) {
    squareRejectResponse(diagnosticCode, field);
  }
  return value;
}

function optionalOrderCatalogVersion(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  diagnosticCode: string
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    squareRejectResponse(diagnosticCode, field);
  }
  return String(value);
}

function requiredOrderComponentUid(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  missingCode: string
) {
  const value = squareOptionalNullableString(record, key, field, 60);
  if (value === null) {
    throw new SquareOrderUnsupportedProjectionFailure(missingCode, field);
  }
  if (!ORDER_COMPONENT_UID_PATTERN.test(value)) {
    squareRejectResponse("square_identifier_invalid", field);
  }
  return value;
}

function optionalOrderComponentUid(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  const value = squareOptionalNullableString(record, key, field, 60);
  if (value !== null && !ORDER_COMPONENT_UID_PATTERN.test(value)) {
    squareRejectResponse("square_identifier_invalid", field);
  }
  return value;
}

function requiredOrderAdjustmentComponentUid(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  missingCode: string
) {
  const value = squareOptionalNullableString(record, key, field, 60);
  if (value === null) {
    throw new SquareOrderUnsupportedProjectionFailure(missingCode, field);
  }
  return value;
}

function optionalOrderAdjustmentComponentUid(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  return squareOptionalNullableString(record, key, field, 60);
}

function requiredOrderQuantity(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number,
  diagnosticCode: string
) {
  if (!hasOwn(record, key) || record[key] === null) {
    squareRejectResponse(diagnosticCode, field);
  }
  return validOrderQuantity(record[key], field, maximumLength, diagnosticCode);
}

function optionalOrderQuantity(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number,
  diagnosticCode: string
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  return validOrderQuantity(record[key], field, maximumLength, diagnosticCode);
}

function validOrderQuantity(
  value: SquareSafeJsonValue,
  field: string,
  maximumLength: number,
  diagnosticCode: string
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !ORDER_QUANTITY_PATTERN.test(value)
  ) {
    squareRejectResponse(diagnosticCode, field);
  }
  return value;
}

function optionalOrderSafeInteger(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  minimum: number,
  maximum: number,
  diagnosticCode: string
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    squareRejectResponse(diagnosticCode, field);
  }
  return value;
}

function orderQuantityFractionalDigits(quantity: string) {
  const decimalIndex = quantity.indexOf(".");
  return decimalIndex === -1 ? 0 : quantity.length - decimalIndex - 1;
}

function assertCompatibleOrderLineItemCurrencies(
  core: SquareMinimizedOrderCore,
  lineItems: readonly SquareOrderLineItem[],
  field: string
) {
  const monies: (SquareOrderMoney | null)[] = [
    core.totalMoney,
    core.totalTaxMoney,
    core.totalDiscountMoney,
    core.totalTipMoney,
    core.totalServiceChargeMoney,
    core.netAmountDueMoney
  ];
  for (const lineItem of lineItems) {
    monies.push(
      lineItem.basePriceMoney,
      lineItem.variationTotalPriceMoney,
      lineItem.grossSalesMoney,
      lineItem.totalTaxMoney,
      lineItem.totalDiscountMoney,
      lineItem.totalServiceChargeMoney,
      lineItem.totalMoney
    );
    for (const modifier of lineItem.modifiers) {
      monies.push(modifier.basePriceMoney, modifier.totalPriceMoney);
    }
  }
  const currencies = new Set(
    monies.flatMap((money) =>
      money?.currency === null || money?.currency === undefined
        ? []
        : [money.currency]
    )
  );
  if (currencies.size > 1) {
    squareRejectResponse(
      "square_order_line_item_currency_mismatch",
      `${field}.line_items`
    );
  }
}

function compareStringPaths(left: readonly string[], right: readonly string[]) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const compared = compareStrings(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
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
    if (!hasOwn(response, "order") || response.order === null) {
      squareRejectResponse("square_order_response_missing", "$response.order");
    }
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
  field: string,
  options: Readonly<{ minimum?: number; maximum?: number }> = {}
): string | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
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

function isOrderProviderVersionText(value: string) {
  const parsed = Number(value);
  return (
    Number.isInteger(parsed) &&
    parsed >= MINIMUM_ORDER_PROVIDER_VERSION &&
    parsed <= MAXIMUM_ORDER_PROVIDER_VERSION
  );
}

function squareOrderResultBoundary<T>(
  produceResult: () => SquareResponseParserResult<T>,
  acceptedSchema: z.ZodType<T>
): SquareResponseParserResult<T> {
  try {
    return squareOrderRootDiagnosticResult(produceResult(), acceptedSchema);
  } catch {
    return SQUARE_ORDER_INTERNAL_REJECTION_RESULT;
  }
}

function squareOrderRootDiagnosticResult<T>(
  result: unknown,
  acceptedSchema: z.ZodType<T>
): SquareResponseParserResult<T> {
  if (!squareOrderHasExactDataProperties(result, ["outcome", "diagnostics"])) {
    if (
      !squareOrderHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ])
    ) {
      return SQUARE_ORDER_INTERNAL_REJECTION_RESULT;
    }
  }

  const outcome = squareOrderDataProperty(result, "outcome");
  if (outcome === "accepted") {
    const value = squareOrderDataProperty(result, "value");
    if (
      !squareOrderHasExactDataProperties(result, [
        "outcome",
        "value",
        "diagnostics"
      ]) ||
      !squareOrderIsEmptyFrozenArray(
        squareOrderDataProperty(result, "diagnostics")
      ) ||
      !acceptedSchema.safeParse(value).success ||
      !squareOrderIsDeeplyFrozen(result)
    ) {
      return SQUARE_ORDER_INTERNAL_REJECTION_RESULT;
    }
    return result as SquareResponseParserResult<T>;
  }

  if (
    outcome !== "rejected" &&
    outcome !== "unsupported" &&
    outcome !== "incompatible-version"
  ) {
    return SQUARE_ORDER_INTERNAL_REJECTION_RESULT;
  }

  const diagnostics = squareOrderSanitizedDiagnostics(
    squareOrderDataProperty(result, "diagnostics")
  );
  if (diagnostics === null) return SQUARE_ORDER_INTERNAL_REJECTION_RESULT;

  return Object.freeze({
    outcome,
    diagnostics: Object.freeze(diagnostics)
  });
}

function squareOrderSanitizedDiagnostics(
  value: unknown
): SquareResponseFailureResult["diagnostics"] | null {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > MAXIMUM_RESULT_DIAGNOSTICS ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    return null;
  }

  const diagnostics = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    const diagnostic = descriptor.value;
    if (
      !squareOrderHasExactDataProperties(diagnostic, ["code", "field"])
    ) {
      return null;
    }
    const code = squareOrderDataProperty(diagnostic, "code");
    const field = squareOrderDataProperty(diagnostic, "field");
    if (
      typeof code !== "string" ||
      !SQUARE_ORDER_DIAGNOSTIC_CODES.has(code) ||
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

function squareOrderHasExactDataProperties(
  value: unknown,
  keys: readonly string[]
): value is Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
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

function squareOrderDataProperty(
  value: Readonly<Record<string, unknown>>,
  key: string
) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("square_order_result_property_invalid");
  }
  return descriptor.value;
}

function squareOrderIsEmptyFrozenArray(value: unknown) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    !Object.isFrozen(value)
  ) {
    return false;
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  return (
    Reflect.ownKeys(value).length === 1 &&
    length !== undefined &&
    "value" in length &&
    length.value === 0
  );
}

function squareOrderIsDeeplyFrozen(value: unknown) {
  const seen = new Set<object>();
  const pending = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (
      candidate === null ||
      (typeof candidate !== "object" && typeof candidate !== "function")
    ) {
      continue;
    }
    if (typeof candidate === "function") return false;
    if (seen.has(candidate)) continue;
    if (
      seen.size >= MAXIMUM_FROZEN_RESULT_OBJECTS ||
      !Object.isFrozen(candidate) ||
      !squareOrderHasCanonicalContainerShape(candidate)
    ) {
      return false;
    }
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !("value" in descriptor)) return false;
      pending.push(descriptor.value);
    }
  }
  return true;
}

function squareOrderHasCanonicalContainerShape(value: object) {
  const ownKeys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      ownKeys.length !== value.length + 1
    ) {
      return false;
    }
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      length.enumerable ||
      length.value !== value.length
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) return false;
    }
    return true;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return ownKeys.every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
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
