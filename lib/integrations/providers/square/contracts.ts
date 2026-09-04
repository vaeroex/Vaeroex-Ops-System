import {
  type ProviderReadOnlyPostOperation,
  ProviderReadOnlyPostOperationSchema
} from "@/lib/integrations/contracts/provider-adapter";

export const SQUARE_PROVIDER_KEY = "square" as const;
export const SQUARE_PROVIDER_DISPLAY_NAME = "Square" as const;
export const SQUARE_PROVIDER_ADAPTER_VERSION =
  "square_phase_2a_dormant_provider_contract_v1" as const;
export const SQUARE_API_VERSION = "2026-08-19" as const;
export const SQUARE_RESPONSE_VALIDATION_VERSION =
  "square_phase_2b1a_response_validation_v1" as const;
export const SQUARE_MERCHANT_RESPONSE_CONTRACT_VERSION =
  "square_merchant_response_minimized_v1" as const;
export const SQUARE_LOCATION_RESPONSE_CONTRACT_VERSION =
  "square_location_response_minimized_v1" as const;
export const SQUARE_MERCHANT_LOCATION_MINIMIZATION_VERSION =
  "square_merchant_location_minimizer_v1" as const;
export const SQUARE_MERCHANT_LOCATION_ENTITY_VERSION = 1 as const;
export const SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION =
  "square_catalog_response_minimized_v1" as const;
export const SQUARE_CATALOG_MINIMIZATION_VERSION =
  "square_catalog_minimizer_v1" as const;
export const SQUARE_CATALOG_ENTITY_VERSION = 1 as const;
export const SQUARE_DORMANT_GATE_VERSION =
  "square_phase_2a_dormant_descriptor_only_v1" as const;
export const SQUARE_MODEL_CALL_COUNT = 0 as const;

export const SQUARE_ENVIRONMENTS = {
  production: {
    key: "production",
    hostname: "connect.squareup.com",
    authorizationEndpointClass: "production"
  },
  sandbox: {
    key: "sandbox",
    hostname: "connect.squareupsandbox.com",
    authorizationEndpointClass: "sandbox"
  }
} as const;

export type SquareProviderEnvironmentKey = keyof typeof SQUARE_ENVIRONMENTS;

export const SQUARE_MINIMUM_READ_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ITEMS_READ",
  "INVENTORY_READ",
  "ORDERS_READ",
  "PAYMENTS_READ"
] as const;

export const SQUARE_OPTIONAL_READ_SCOPES = [] as const;

export type SquareMinimumReadScope = (typeof SQUARE_MINIMUM_READ_SCOPES)[number];

export const SQUARE_ALLOWED_MERCHANT_STATUSES = [
  "ACTIVE",
  "INACTIVE"
] as const;

export const SQUARE_ALLOWED_LOCATION_STATUSES = [
  "ACTIVE",
  "INACTIVE"
] as const;

export const SQUARE_ALLOWED_LOCATION_TYPES = [
  "PHYSICAL",
  "MOBILE"
] as const;

export const SQUARE_WRITE_OR_DEFERRED_SCOPE_PATTERNS = [
  /_WRITE(?:_|$)/,
  /^BANK_ACCOUNTS_READ$/,
  /^CASH_DRAWER_READ$/,
  /^CUSTOMERS_READ$/,
  /^DEVICE_CREDENTIAL_MANAGEMENT$/,
  /^DEVICES_READ$/,
  /^DISPUTES_READ$/,
  /^EMPLOYEES_READ$/,
  /^GIFTCARDS_READ$/,
  /^LOYALTY_READ$/,
  /^ONLINE_STORE_/,
  /^PAYOUTS_READ$/,
  /^SETTLEMENTS_READ$/,
  /^SUBSCRIPTIONS_READ$/,
  /^TIMECARDS_/,
  /^VENDOR_READ$/
] as const;

export const SQUARE_OFFICIAL_DOCUMENTATION_LINKS = [
  "https://developer.squareup.com/docs/changelog/connect-logs/2026-08-19",
  "https://developer.squareup.com/docs/build-basics/versioning-overview",
  "https://developer.squareup.com/docs/build-basics/general-considerations/using-rest-api",
  "https://developer.squareup.com/docs/build-basics/common-api-patterns/pagination",
  "https://developer.squareup.com/docs/devtools/sandbox/overview",
  "https://developer.squareup.com/docs/oauth-api/overview",
  "https://developer.squareup.com/reference/square/enums/OAuthPermission",
  "https://developer.squareup.com/reference/square/merchants-api/ListMerchants",
  "https://developer.squareup.com/reference/square/merchants-api/RetrieveMerchant",
  "https://developer.squareup.com/reference/square/locations-api/ListLocations",
  "https://developer.squareup.com/reference/square/locations-api",
  "https://developer.squareup.com/reference/square/orders-api/SearchOrders",
  "https://developer.squareup.com/reference/square/orders-api/BatchRetrieveOrders",
  "https://developer.squareup.com/reference/square/orders",
  "https://developer.squareup.com/reference/square/payments-api/ListPayments",
  "https://developer.squareup.com/reference/square/payments-api",
  "https://developer.squareup.com/reference/square/refunds-api/ListPaymentRefunds",
  "https://developer.squareup.com/reference/square/refunds",
  "https://developer.squareup.com/reference/square/catalog-api/SearchCatalogObjects",
  "https://developer.squareup.com/reference/square/catalog-api/BatchRetrieveCatalogObjects",
  "https://developer.squareup.com/reference/square/catalog-api/ListCatalog",
  "https://developer.squareup.com/reference/square/catalog/retrieve-catalog-object",
  "https://developer.squareup.com/reference/square/inventory-api/BatchRetrieveInventoryCounts",
  "https://developer.squareup.com/reference/square/inventory/BatchRetrieveInventoryChanges",
  "https://developer.squareup.com/docs/inventory-api/migrate-to-updated-api-entities"
] as const;

export const SQUARE_ALLOWED_CATALOG_OBJECT_TYPES = [
  "ITEM",
  "ITEM_VARIATION",
  "CATEGORY",
  "MODIFIER",
  "MODIFIER_LIST",
  "DISCOUNT",
  "TAX"
] as const;

export const SQUARE_PHASE_2B1B1_SUPPORTED_CATALOG_OBJECT_TYPES = [
  "CATEGORY",
  "ITEM",
  "ITEM_VARIATION"
] as const;

export const SQUARE_CATALOG_OBJECT_TYPE_DATA_KEY_BY_TYPE = {
  ITEM: "item_data",
  IMAGE: "image_data",
  CATEGORY: "category_data",
  ITEM_VARIATION: "item_variation_data",
  TAX: "tax_data",
  DISCOUNT: "discount_data",
  MODIFIER_LIST: "modifier_list_data",
  MODIFIER: "modifier_data",
  PRICING_RULE: "pricing_rule_data",
  PRODUCT_SET: "product_set_data",
  TIME_PERIOD: "time_period_data",
  MEASUREMENT_UNIT: "measurement_unit_data",
  SUBSCRIPTION_PLAN_VARIATION: "subscription_plan_variation_data",
  ITEM_OPTION: "item_option_data",
  ITEM_OPTION_VAL: "item_option_value_data",
  CUSTOM_ATTRIBUTE_DEFINITION: "custom_attribute_definition_data",
  QUICK_AMOUNTS_SETTINGS: "quick_amounts_settings_data",
  SUBSCRIPTION_PLAN: "subscription_plan_data",
  AVAILABILITY_PERIOD: "availability_period_data"
} as const;

export const SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS = Object.values(
  SQUARE_CATALOG_OBJECT_TYPE_DATA_KEY_BY_TYPE
);

export const SQUARE_CATALOG_RESPONSE_OPERATION_KEYS = [
  "list_catalog",
  "catalog_search",
  "retrieve_catalog_object",
  "catalog_batch_retrieve"
] as const;

export const SQUARE_ALLOWED_CATALOG_PRICING_TYPES = [
  "FIXED_PRICING",
  "VARIABLE_PRICING"
] as const;

export const SQUARE_ALLOWED_ORDER_STATES = [
  "OPEN",
  "COMPLETED",
  "CANCELED",
  "DRAFT"
] as const;

export const SQUARE_ALLOWED_ORDER_SORT_FIELDS = [
  "CREATED_AT",
  "UPDATED_AT",
  "CLOSED_AT"
] as const;

export const SQUARE_ALLOWED_SORT_ORDERS = ["ASC", "DESC"] as const;

export const SQUARE_ALLOWED_PAYMENT_SORT_FIELDS = [
  "CREATED_AT",
  "OFFLINE_CREATED_AT",
  "UPDATED_AT"
] as const;

export const SQUARE_ALLOWED_REFUND_STATUSES = [
  "PENDING",
  "COMPLETED",
  "REJECTED",
  "FAILED"
] as const;

export const SQUARE_ALLOWED_PAYMENT_SOURCE_TYPES = [
  "CARD",
  "BANK_ACCOUNT",
  "WALLET",
  "CASH",
  "EXTERNAL"
] as const;

export const SQUARE_ALLOWED_INVENTORY_STATES = [
  "CUSTOM",
  "IN_STOCK",
  "SOLD",
  "RETURNED_BY_CUSTOMER",
  "RESERVED_FOR_SALE",
  "SOLD_ONLINE",
  "ORDERED_FROM_VENDOR",
  "RECEIVED_FROM_VENDOR",
  "IN_TRANSIT_TO",
  "NONE",
  "WASTE",
  "UNLINKED_RETURN",
  "COMPOSED",
  "DECOMPOSED",
  "SUPPORTED_BY_NEWER_VERSION",
  "IN_TRANSIT"
] as const;

export const SQUARE_ALLOWED_INVENTORY_CHANGE_TYPES = [
  "PHYSICAL_COUNT",
  "ADJUSTMENT"
] as const;

export const SQUARE_GET_OPERATION_KEYS = [
  "list_merchants",
  "retrieve_merchant",
  "list_locations",
  "retrieve_location",
  "retrieve_order",
  "list_payments",
  "retrieve_payment",
  "list_payment_refunds",
  "retrieve_payment_refund",
  "list_catalog",
  "retrieve_catalog_object",
  "retrieve_inventory_count",
  "retrieve_inventory_adjustment",
  "retrieve_inventory_physical_count"
] as const;

export type SquareGetOperationKey = (typeof SQUARE_GET_OPERATION_KEYS)[number];

export type SquareGetOperationDefinition = Readonly<{
  operationKey: SquareGetOperationKey;
  pathPattern: RegExp;
  pathTemplate: string;
  requiredScope: SquareMinimumReadScope;
  maximumResponseBytes: number;
  timeoutMs: number;
  retryClassification: "non_retryable_read" | "idempotent_read_with_backoff";
}>;

const readTimeoutMs = 30_000;
const defaultResponseBytes = 16 * 1024 * 1024;
const largeResponseBytes = 64 * 1024 * 1024;
const squareIdSegment = "[A-Za-z0-9._:-]{1,191}";
const orderIdSegment = "(?!(?:search|batch-retrieve)$)[A-Za-z0-9._:-]{1,191}";
const inventoryCatalogObjectIdSegment =
  "(?!(?:adjustments|changes|counts|physical-counts)$)[A-Za-z0-9._:-]{1,191}";

export const SQUARE_GET_OPERATIONS: readonly SquareGetOperationDefinition[] = [
  {
    operationKey: "list_merchants",
    pathPattern: /^\/v2\/merchants$/,
    pathTemplate: "/v2/merchants",
    requiredScope: "MERCHANT_PROFILE_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_merchant",
    pathPattern: new RegExp(`^/v2/merchants/(?:me|${squareIdSegment})$`),
    pathTemplate: "/v2/merchants/{merchant_id}",
    requiredScope: "MERCHANT_PROFILE_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "list_locations",
    pathPattern: /^\/v2\/locations$/,
    pathTemplate: "/v2/locations",
    requiredScope: "MERCHANT_PROFILE_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_location",
    pathPattern: new RegExp(`^/v2/locations/(?:main|${squareIdSegment})$`),
    pathTemplate: "/v2/locations/{location_id}",
    requiredScope: "MERCHANT_PROFILE_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_order",
    pathPattern: new RegExp(`^/v2/orders/${orderIdSegment}$`),
    pathTemplate: "/v2/orders/{order_id}",
    requiredScope: "ORDERS_READ",
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "list_payments",
    pathPattern: /^\/v2\/payments$/,
    pathTemplate: "/v2/payments",
    requiredScope: "PAYMENTS_READ",
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_payment",
    pathPattern: new RegExp(`^/v2/payments/${squareIdSegment}$`),
    pathTemplate: "/v2/payments/{payment_id}",
    requiredScope: "PAYMENTS_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "list_payment_refunds",
    pathPattern: /^\/v2\/refunds$/,
    pathTemplate: "/v2/refunds",
    requiredScope: "PAYMENTS_READ",
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_payment_refund",
    pathPattern: new RegExp(`^/v2/refunds/${squareIdSegment}$`),
    pathTemplate: "/v2/refunds/{refund_id}",
    requiredScope: "PAYMENTS_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "list_catalog",
    pathPattern: /^\/v2\/catalog\/list$/,
    pathTemplate: "/v2/catalog/list",
    requiredScope: "ITEMS_READ",
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_catalog_object",
    pathPattern: new RegExp(`^/v2/catalog/object/${squareIdSegment}$`),
    pathTemplate: "/v2/catalog/object/{object_id}",
    requiredScope: "ITEMS_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_inventory_count",
    pathPattern: new RegExp(`^/v2/inventory/${inventoryCatalogObjectIdSegment}$`),
    pathTemplate: "/v2/inventory/{catalog_object_id}",
    requiredScope: "INVENTORY_READ",
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_inventory_adjustment",
    pathPattern: new RegExp(`^/v2/inventory/adjustments/${squareIdSegment}$`),
    pathTemplate: "/v2/inventory/adjustments/{adjustment_id}",
    requiredScope: "INVENTORY_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  },
  {
    operationKey: "retrieve_inventory_physical_count",
    pathPattern: new RegExp(`^/v2/inventory/physical-counts/${squareIdSegment}$`),
    pathTemplate: "/v2/inventory/physical-counts/{physical_count_id}",
    requiredScope: "INVENTORY_READ",
    maximumResponseBytes: defaultResponseBytes,
    timeoutMs: readTimeoutMs,
    retryClassification: "idempotent_read_with_backoff"
  }
] as const;

const readOnlyPostEndpointTemplates = [
  {
    operationKey: "orders_search",
    path: "/v2/orders/search",
    requestValidatorKey: "square_orders_search_request_v1",
    maximumRequestBodyBytes: 24 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  },
  {
    operationKey: "orders_batch_retrieve",
    path: "/v2/orders/batch-retrieve",
    requestValidatorKey: "square_orders_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 16 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  },
  {
    operationKey: "catalog_search",
    path: "/v2/catalog/search",
    requestValidatorKey: "square_catalog_search_request_v1",
    maximumRequestBodyBytes: 24 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  },
  {
    operationKey: "catalog_batch_retrieve",
    path: "/v2/catalog/batch-retrieve",
    requestValidatorKey: "square_catalog_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  },
  {
    operationKey: "inventory_counts_batch_retrieve",
    path: "/v2/inventory/counts/batch-retrieve",
    requestValidatorKey: "square_inventory_counts_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  },
  {
    operationKey: "inventory_changes_batch_retrieve",
    path: "/v2/inventory/changes/batch-retrieve",
    requestValidatorKey: "square_inventory_changes_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024,
    maximumResponseBytes: largeResponseBytes,
    timeoutMs: readTimeoutMs
  }
] as const;

export const SQUARE_READ_ONLY_POST_OPERATIONS: readonly ProviderReadOnlyPostOperation[] =
  readOnlyPostEndpointTemplates.flatMap((template) =>
    Object.values(SQUARE_ENVIRONMENTS).map((environment) =>
      ProviderReadOnlyPostOperationSchema.parse({
        operationKey: `${environment.key}_${template.operationKey}`,
        providerKey: SQUARE_PROVIDER_KEY,
        providerEnvironment: environment.key,
        hostname: environment.hostname,
        path: template.path,
        method: "POST",
        contentType: "application/json",
        maximumRequestBodyBytes: template.maximumRequestBodyBytes,
        requestValidatorKey: template.requestValidatorKey,
        maximumResponseBytes: template.maximumResponseBytes,
        timeoutMs: template.timeoutMs,
        retryClassification: "idempotent_read_with_backoff"
      })
    )
  );
