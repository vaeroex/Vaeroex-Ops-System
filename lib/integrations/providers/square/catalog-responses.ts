import { z } from "zod";

import {
  IsoTimestampSchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_CATALOG_PRICING_TYPES,
  SQUARE_CATALOG_ENTITY_VERSION,
  SQUARE_CATALOG_MINIMIZATION_VERSION,
  SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION,
  SQUARE_CATALOG_RESPONSE_OPERATION_KEYS,
  SQUARE_PHASE_2B1B1_SUPPORTED_CATALOG_OBJECT_TYPES,
  SQUARE_PROVIDER_KEY
} from "@/lib/integrations/providers/square/contracts";
import {
  SquareCurrencyCodeSchema,
  SquareIdentifierSchema,
  SquareIntegerVersionSchema,
  SquareProviderEnvironmentSchema,
  SquareResponseProvenanceSchema,
  type SquareResponseParserInput,
  type SquareResponseParserResult,
  type SquareResponseProvenance,
  type SquareSafeJsonArray,
  type SquareSafeJsonObject,
  type SquareSafeJsonValue,
  squareAcceptedResult,
  squareFailureResult,
  squareMinimizedProjectionFingerprint,
  squareOptionalNullableTimestamp,
  squareProviderErrorState,
  squareRejectResponse,
  squareRequiredCurrencyCode,
  squareRequiredEnum,
  squareRequiredIdentifier,
  squareRequiredObject,
  squareResponseParserInput,
  squareResponseProvenance,
  squareSafeJsonObject,
  squareUnsupportedResult
} from "@/lib/integrations/providers/square/response-validation";

const SquareCatalogEntityTypeSchema = z.enum([
  "catalog_category",
  "catalog_item",
  "catalog_item_variation"
]);

const SquareCatalogObjectTypeSchema = z.enum(
  SQUARE_PHASE_2B1B1_SUPPORTED_CATALOG_OBJECT_TYPES
);

export const SquareCatalogResponseOperationSchema = z.enum(
  SQUARE_CATALOG_RESPONSE_OPERATION_KEYS
);

const SquareCatalogTrustedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !hasUnsafeCatalogTrustedText(value), "Text must be safe");

const SquareCatalogIntegerStringSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,15})$/)
  .refine(
    (value) =>
      value.length < String(Number.MAX_SAFE_INTEGER).length ||
      value <= String(Number.MAX_SAFE_INTEGER),
    "Integer string must fit JSON safe integer bounds"
  );

const SquareCatalogAuthoritySchema = z
  .object({
    providerKey: z.literal(SQUARE_PROVIDER_KEY),
    providerEnvironment: SquareProviderEnvironmentSchema,
    entityType: SquareCatalogEntityTypeSchema,
    providerId: SquareIdentifierSchema
  })
  .strict();

const SquareCatalogGlobalAvailabilitySchema = z
  .object({
    mode: z.literal("global")
  })
  .strict();

const SquareCatalogAllLocationsAvailabilitySchema = z
  .object({
    mode: z.literal("all_locations_except"),
    absentLocationIds: z.array(SquareIdentifierSchema).max(1_000)
  })
  .strict();

const SquareCatalogSpecificLocationsAvailabilitySchema = z
  .object({
    mode: z.literal("specific_locations"),
    presentLocationIds: z.array(SquareIdentifierSchema).max(1_000)
  })
  .strict();

const SquareCatalogAvailabilitySchema = z.discriminatedUnion("mode", [
  SquareCatalogGlobalAvailabilitySchema,
  SquareCatalogAllLocationsAvailabilitySchema,
  SquareCatalogSpecificLocationsAvailabilitySchema
]);

const SquareCatalogCategoryReferenceSchema = z
  .object({
    id: SquareIdentifierSchema,
    ordinal: SquareCatalogIntegerStringSchema.nullable()
  })
  .strict();

const SquareCatalogPriceSchema = z
  .object({
    amountMinor: SquareCatalogIntegerStringSchema,
    currency: SquareCurrencyCodeSchema
  })
  .strict();

const SquareCatalogBaseObjectSchema = z
  .object({
    contractVersion: z.literal(SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_CATALOG_MINIMIZATION_VERSION),
    entityVersion: SquareIntegerVersionSchema,
    authority: SquareCatalogAuthoritySchema,
    provider: SquareResponseProvenanceSchema,
    id: SquareIdentifierSchema,
    catalogVersion: SquareCatalogIntegerStringSchema,
    updatedAt: IsoTimestampSchema,
    isDeleted: z.boolean()
  })
  .strict();

export const SquareMinimizedCatalogCategorySchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_category"),
    catalogObjectType: z.literal("CATEGORY"),
    availability: SquareCatalogGlobalAvailabilitySchema,
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    parentCategory: SquareCatalogCategoryReferenceSchema.nullable(),
    isTopLevel: z.boolean().nullable()
  }).strict();

export const SquareMinimizedCatalogItemVariationSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_item_variation"),
    catalogObjectType: z.literal("ITEM_VARIATION"),
    availability: z.discriminatedUnion("mode", [
      SquareCatalogAllLocationsAvailabilitySchema,
      SquareCatalogSpecificLocationsAvailabilitySchema
    ]),
    parentItemId: SquareIdentifierSchema.nullable(),
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    sku: SquareCatalogTrustedTextSchema.nullable(),
    pricingType: z.enum(SQUARE_ALLOWED_CATALOG_PRICING_TYPES).nullable(),
    price: SquareCatalogPriceSchema.nullable(),
    ordinal: SquareCatalogIntegerStringSchema.nullable(),
    trackInventory: z.boolean().nullable(),
    sellable: z.boolean().nullable(),
    stockable: z.boolean().nullable()
  }).strict();

export const SquareMinimizedCatalogItemSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_item"),
    catalogObjectType: z.literal("ITEM"),
    availability: z.discriminatedUnion("mode", [
      SquareCatalogAllLocationsAvailabilitySchema,
      SquareCatalogSpecificLocationsAvailabilitySchema
    ]),
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    categoryReferences: z.array(SquareCatalogCategoryReferenceSchema).max(250),
    variations: z.array(SquareMinimizedCatalogItemVariationSchema).max(250),
    variationCount: z.number().int().nonnegative().max(250).safe()
  }).strict();

export const SquareMinimizedCatalogObjectSchema = z.union([
  SquareMinimizedCatalogCategorySchema,
  SquareMinimizedCatalogItemSchema,
  SquareMinimizedCatalogItemVariationSchema
]);

const SquareCatalogPaginationStateSchema = z
  .object({
    cursorPresent: z.boolean(),
    cursorFingerprint: Sha256FingerprintSchema.nullable()
  })
  .strict();

export const SquareCatalogResponseSchema = z
  .object({
    contractVersion: z.literal(SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION),
    minimizationVersion: z.literal(SQUARE_CATALOG_MINIMIZATION_VERSION),
    entityType: z.literal("catalog_response"),
    operation: SquareCatalogResponseOperationSchema,
    provider: SquareResponseProvenanceSchema,
    pagination: SquareCatalogPaginationStateSchema,
    latestTime: IsoTimestampSchema.nullable(),
    items: z.array(SquareMinimizedCatalogObjectSchema).max(1_000),
    relatedItems: z.array(SquareMinimizedCatalogObjectSchema).max(1_000),
    includedItems: z.array(SquareMinimizedCatalogObjectSchema).max(1_000),
    itemCount: z.number().int().nonnegative().max(1_000).safe(),
    relatedItemCount: z.number().int().nonnegative().max(1_000).safe(),
    includedItemCount: z.number().int().nonnegative().max(1_000).safe()
  })
  .strict();

export type SquareCatalogResponseOperation = z.infer<
  typeof SquareCatalogResponseOperationSchema
>;
export type SquareMinimizedCatalogCategory = Readonly<
  z.infer<typeof SquareMinimizedCatalogCategorySchema>
>;
export type SquareMinimizedCatalogItem = Readonly<
  z.infer<typeof SquareMinimizedCatalogItemSchema>
>;
export type SquareMinimizedCatalogItemVariation = Readonly<
  z.infer<typeof SquareMinimizedCatalogItemVariationSchema>
>;
export type SquareMinimizedCatalogObject = Readonly<
  z.infer<typeof SquareMinimizedCatalogObjectSchema>
>;
export type SquareCatalogResponse = Readonly<
  z.infer<typeof SquareCatalogResponseSchema>
>;

type SquareCatalogResponseParserInput = SquareResponseParserInput &
  Readonly<{
    operation: SquareCatalogResponseOperation;
  }>;

type CatalogObjectBucket = Readonly<{
  items: readonly SquareSafeJsonObject[];
  relatedItems: readonly SquareSafeJsonObject[];
  includedItems: readonly SquareSafeJsonObject[];
}>;

const CATALOG_CURSOR_PATTERN = /^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const BIDIRECTIONAL_CONTROL_PATTERN =
  /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const HTML_OR_SCRIPT_PATTERN =
  /(?:<\s*\/?\s*[a-z][^>]*>|&lt;\s*\/?\s*[a-z]|javascript\s*:|data\s*:\s*text\/html)/iu;

export function parseSquareCatalogResponse(
  input: unknown
): SquareResponseParserResult<SquareCatalogResponse> {
  try {
    const parserInput = squareCatalogResponseParserInput(input);
    const provenance = squareResponseProvenance(parserInput);
    const response = squareSafeJsonObject(parserInput.response);

    if (squareProviderErrorState(response) === "present") {
      return squareUnsupportedResult(
        "square_catalog_provider_errors_present",
        "$response.errors"
      );
    }

    const rawObjects = catalogResponseObjects(response, parserInput.operation);
    const primaryObjectField =
      parserInput.operation === "retrieve_catalog_object"
        ? "$response.object"
        : "$response.objects[]";
    const minimizationState = newCatalogMinimizationState();
    const items = rawObjects.items.map((item) =>
      minimizeSquareCatalogObject(item, provenance, primaryObjectField, {
        state: minimizationState
      })
    );
    const relatedItems = rawObjects.relatedItems.map((item) =>
      minimizeSquareCatalogObject(
        item,
        provenance,
        "$response.related_objects[]",
        { state: minimizationState }
      )
    );
    const includedItems = rawObjects.includedItems.map((item) =>
      minimizeSquareCatalogObject(
        item,
        provenance,
        "$response.included_resources.objects[]",
        { state: minimizationState }
      )
    );

    return squareAcceptedResult(
      SquareCatalogResponseSchema.parse({
        contractVersion: SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION,
        minimizationVersion: SQUARE_CATALOG_MINIMIZATION_VERSION,
        entityType: "catalog_response",
        operation: parserInput.operation,
        provider: provenance,
        pagination: catalogPaginationState(
          response,
          parserInput.operation,
          provenance
        ),
        latestTime: catalogLatestTime(response, parserInput.operation),
        items,
        relatedItems,
        includedItems,
        itemCount: items.length,
        relatedItemCount: relatedItems.length,
        includedItemCount: includedItems.length
      })
    );
  } catch (error) {
    if (error instanceof SquareCatalogUnsupportedObjectFailure) {
      return squareUnsupportedResult(error.code, error.field);
    }
    return squareFailureResult(error);
  }
}

export function minimizeSquareCatalogObject(
  input: unknown,
  provenance: SquareResponseProvenance,
  field = "$response.objects[]",
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    parentItemId?: string | null;
  }> = {}
): SquareMinimizedCatalogObject {
  const object = squareSafeJsonObject(input, field);
  const objectType = supportedCatalogObjectType(object, `${field}.type`);
  assertServerCatalogObjectId(object, "id", `${field}.id`);

  if (objectType === "CATEGORY") {
    return minimizeSquareCatalogCategory(object, provenance, field, options);
  }
  if (objectType === "ITEM") {
    return minimizeSquareCatalogItem(object, provenance, field, options);
  }
  return minimizeSquareCatalogItemVariation(object, provenance, field, options);
}

export function squareCatalogObjectFingerprint(
  input: SquareMinimizedCatalogObject
) {
  return squareMinimizedProjectionFingerprint(
    SquareMinimizedCatalogObjectSchema.parse(input)
  );
}

export function squareCatalogResponseFingerprint(
  input: SquareCatalogResponse
) {
  return squareMinimizedProjectionFingerprint(
    SquareCatalogResponseSchema.parse(input)
  );
}

function minimizeSquareCatalogCategory(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
  }>
): SquareMinimizedCatalogCategory {
  const base = catalogBaseProjection(
    object,
    provenance,
    field,
    "catalog_category"
  );
  const availability = categoryAvailability(object, field);
  const categoryData = base.isDeleted
    ? null
    : squareRequiredObject(object, "category_data", `${field}.category_data`);

  const item = SquareMinimizedCatalogCategorySchema.parse({
    ...base,
    entityType: "catalog_category",
    catalogObjectType: "CATEGORY",
    availability,
    displayName:
      categoryData === null
        ? null
        : optionalDisplayText(
            categoryData,
            "name",
            `${field}.category_data.name`,
            255
          ),
    parentCategory:
      categoryData === null
        ? null
        : optionalCatalogObjectCategoryReference(
            categoryData,
            "parent_category",
            `${field}.category_data.parent_category`
          ),
    isTopLevel:
      categoryData === null
        ? null
        : optionalNullableBoolean(
            categoryData,
            "is_top_level",
            `${field}.category_data.is_top_level`
          )
  });
  rememberCatalogAuthority(options.state, item.authority, field);
  return item;
}

function minimizeSquareCatalogItem(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
  }>
): SquareMinimizedCatalogItem {
  const base = catalogBaseProjection(object, provenance, field, "catalog_item");
  const availability = itemAvailability(object, field);
  const itemData = base.isDeleted
    ? null
    : squareRequiredObject(object, "item_data", `${field}.item_data`);
  const variations =
    itemData === null
      ? []
      : catalogItemVariationChildren(
          itemData,
          provenance,
          field,
          options.state,
          base.id
        );

  const item = SquareMinimizedCatalogItemSchema.parse({
    ...base,
    entityType: "catalog_item",
    catalogObjectType: "ITEM",
    availability,
    displayName:
      itemData === null
        ? null
        : optionalDisplayText(
            itemData,
            "name",
            `${field}.item_data.name`,
            512
          ),
    categoryReferences:
      itemData === null
        ? []
        : catalogObjectCategoryReferences(
            itemData,
            "categories",
            `${field}.item_data.categories`,
            250
          ),
    variations,
    variationCount: variations.length
  });
  rememberCatalogAuthority(options.state, item.authority, field);
  return item;
}

function minimizeSquareCatalogItemVariation(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    parentItemId?: string | null;
  }>
): SquareMinimizedCatalogItemVariation {
  const base = catalogBaseProjection(
    object,
    provenance,
    field,
    "catalog_item_variation"
  );
  const availability = itemAvailability(object, field);
  const variationData = base.isDeleted
    ? null
    : squareRequiredObject(
        object,
        "item_variation_data",
        `${field}.item_variation_data`
      );
  const parentItemId =
    variationData === null
      ? null
      : squareRequiredIdentifier(
          variationData,
          "item_id",
          `${field}.item_variation_data.item_id`
        );
  if (
    parentItemId !== null &&
    options.parentItemId !== undefined &&
    options.parentItemId !== null &&
    parentItemId !== options.parentItemId
  ) {
    squareRejectResponse(
      "square_catalog_variation_parent_mismatch",
      `${field}.item_variation_data.item_id`
    );
  }
  const pricingType =
    variationData === null
      ? null
      : squareRequiredEnum(
          variationData,
          "pricing_type",
          `${field}.item_variation_data.pricing_type`,
          SQUARE_ALLOWED_CATALOG_PRICING_TYPES
        );

  const item = SquareMinimizedCatalogItemVariationSchema.parse({
    ...base,
    entityType: "catalog_item_variation",
    catalogObjectType: "ITEM_VARIATION",
    availability,
    parentItemId,
    displayName:
      variationData === null
        ? null
        : optionalDisplayText(
            variationData,
            "name",
            `${field}.item_variation_data.name`,
            512
          ),
    sku:
      variationData === null
        ? null
        : optionalDisplayText(
            variationData,
            "sku",
            `${field}.item_variation_data.sku`,
            255
          ),
    pricingType,
    price:
      variationData === null
        ? null
        : catalogVariationPrice(
            variationData,
            pricingType,
            `${field}.item_variation_data.price_money`
          ),
    ordinal:
      variationData === null
        ? null
        : optionalNullableIntegerString(
            variationData,
            "ordinal",
            `${field}.item_variation_data.ordinal`,
            { minimum: 0, maximum: 2_147_483_647 }
          ),
    trackInventory:
      variationData === null
        ? null
        : optionalNullableBoolean(
            variationData,
            "track_inventory",
            `${field}.item_variation_data.track_inventory`
          ),
    sellable:
      variationData === null
        ? null
        : optionalNullableBoolean(
            variationData,
            "sellable",
            `${field}.item_variation_data.sellable`
          ),
    stockable:
      variationData === null
        ? null
        : optionalNullableBoolean(
            variationData,
            "stockable",
            `${field}.item_variation_data.stockable`
          )
  });
  rememberCatalogAuthority(options.state, item.authority, field);
  return item;
}

function squareCatalogResponseParserInput(
  input: unknown
): SquareCatalogResponseParserInput {
  const parserInput = squareResponseParserInput(input);
  const record = input as Readonly<Record<string, unknown>>;
  const descriptor = Object.getOwnPropertyDescriptor(record, "operation");
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    squareRejectResponse("square_catalog_operation_invalid", "$input.operation");
  }
  const operation = SquareCatalogResponseOperationSchema.safeParse(
    descriptor.value
  );
  if (!operation.success) {
    squareRejectResponse("square_catalog_operation_invalid", "$input.operation");
  }
  return {
    ...parserInput,
    operation: operation.data
  };
}

function catalogResponseObjects(
  response: SquareSafeJsonObject,
  operation: SquareCatalogResponseOperation
): CatalogObjectBucket {
  if (operation === "retrieve_catalog_object") {
    return {
      items: [
        squareSafeJsonObject(
          requiredField(response, "object", "$response.object"),
          "$response.object"
        )
      ],
      relatedItems: optionalCatalogObjectArray(
        response,
        "related_objects",
        "$response.related_objects",
        1_000
      ),
      includedItems: []
    };
  }

  const items = requiredCatalogObjectArray(
    response,
    "objects",
    "$response.objects",
    1_000
  );
  if (operation === "list_catalog") {
    return {
      items,
      relatedItems: [],
      includedItems: []
    };
  }

  return {
    items,
    relatedItems: optionalCatalogObjectArray(
      response,
      "related_objects",
      "$response.related_objects",
      1_000
    ),
    includedItems:
      operation === "catalog_batch_retrieve" || operation === "catalog_search"
        ? optionalIncludedResources(response)
        : []
  };
}

function catalogPaginationState(
  response: SquareSafeJsonObject,
  operation: SquareCatalogResponseOperation,
  provenance: SquareResponseProvenance
) {
  if (operation !== "list_catalog" && operation !== "catalog_search") {
    return {
      cursorPresent: false,
      cursorFingerprint: null
    };
  }
  if (!hasOwn(response, "cursor")) {
    return {
      cursorPresent: false,
      cursorFingerprint: null
    };
  }
  const cursor = response.cursor;
  if (typeof cursor !== "string" || !CATALOG_CURSOR_PATTERN.test(cursor)) {
    squareRejectResponse("square_catalog_cursor_invalid", "$response.cursor");
  }
  return {
    cursorPresent: true,
    cursorFingerprint: squareMinimizedProjectionFingerprint({
      fingerprintPurpose: "square_catalog_response_cursor",
      fingerprintVersion: "square_catalog_response_cursor_fingerprint_v1",
      provider: provenance,
      operation,
      cursor
    })
  };
}

function catalogLatestTime(
  response: SquareSafeJsonObject,
  operation: SquareCatalogResponseOperation
) {
  if (operation !== "catalog_search") return null;
  return squareOptionalNullableTimestamp(
    response,
    "latest_time",
    "$response.latest_time"
  );
}

function catalogBaseProjection(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  entityType: "catalog_category" | "catalog_item" | "catalog_item_variation"
) {
  const id = assertServerCatalogObjectId(object, "id", `${field}.id`);
  return {
    contractVersion: SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION,
    minimizationVersion: SQUARE_CATALOG_MINIMIZATION_VERSION,
    entityVersion: SQUARE_CATALOG_ENTITY_VERSION,
    authority: {
      providerKey: SQUARE_PROVIDER_KEY,
      providerEnvironment: provenance.providerEnvironment,
      entityType,
      providerId: id
    },
    provider: provenance,
    id,
    catalogVersion: requiredIntegerString(object, "version", `${field}.version`, {
      minimum: 1
    }),
    updatedAt: squareOptionalNullableTimestamp(
      object,
      "updated_at",
      `${field}.updated_at`
    ) ?? missingRequired(`${field}.updated_at`),
    isDeleted: requiredBoolean(object, "is_deleted", `${field}.is_deleted`)
  } as const;
}

function categoryAvailability(
  object: SquareSafeJsonObject,
  field: string
): z.infer<typeof SquareCatalogGlobalAvailabilitySchema> {
  const presentAtAllLocations = optionalNullableBoolean(
    object,
    "present_at_all_locations",
    `${field}.present_at_all_locations`
  );
  if (presentAtAllLocations === false) {
    squareRejectResponse(
      "square_catalog_category_location_scope_invalid",
      `${field}.present_at_all_locations`
    );
  }
  if (hasOwn(object, "present_at_location_ids")) {
    squareRejectResponse(
      "square_catalog_category_location_scope_invalid",
      `${field}.present_at_location_ids`
    );
  }
  if (hasOwn(object, "absent_at_location_ids")) {
    squareRejectResponse(
      "square_catalog_category_location_scope_invalid",
      `${field}.absent_at_location_ids`
    );
  }
  return {
    mode: "global"
  };
}

function itemAvailability(object: SquareSafeJsonObject, field: string) {
  const presentAtAllLocations =
    optionalNullableBoolean(
      object,
      "present_at_all_locations",
      `${field}.present_at_all_locations`
    ) ?? true;
  if (presentAtAllLocations) {
    return SquareCatalogAvailabilitySchema.parse({
      mode: "all_locations_except",
      absentLocationIds: optionalIdentifierArray(
        object,
        "absent_at_location_ids",
        `${field}.absent_at_location_ids`,
        1_000
      )
    });
  }
  return SquareCatalogAvailabilitySchema.parse({
    mode: "specific_locations",
    presentLocationIds: optionalIdentifierArray(
      object,
      "present_at_location_ids",
      `${field}.present_at_location_ids`,
      1_000
    )
  });
}

function catalogItemVariationChildren(
  itemData: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  state: SquareCatalogMinimizationState | undefined,
  parentItemId: string
) {
  const raw = requiredArray(
    itemData,
    "variations",
    `${field}.item_data.variations`,
    250
  );
  if (raw.length < 1) {
    squareRejectResponse(
      "square_catalog_item_variations_missing",
      `${field}.item_data.variations`
    );
  }
  return raw.map((item) =>
    minimizeSquareCatalogObject(
      item,
      provenance,
      `${field}.item_data.variations[]`,
      { state, parentItemId }
    )
  ).sort(compareCatalogObjectsByOrdinalThenId) as SquareMinimizedCatalogItemVariation[];
}

function catalogVariationPrice(
  variationData: SquareSafeJsonObject,
  pricingType: "FIXED_PRICING" | "VARIABLE_PRICING" | null,
  field: string
) {
  if (pricingType === "VARIABLE_PRICING") {
    if (hasOwn(variationData, "price_money")) {
      squareRejectResponse("square_catalog_price_invalid", field);
    }
    return null;
  }
  const priceMoney = squareRequiredObject(variationData, "price_money", field);
  return SquareCatalogPriceSchema.parse({
    amountMinor: requiredIntegerString(priceMoney, "amount", `${field}.amount`, {
      minimum: 0
    }),
    currency: squareRequiredCurrencyCode(priceMoney, "currency", `${field}.currency`)
  });
}

function optionalCatalogObjectCategoryReference(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!hasOwn(record, key)) return null;
  if (record[key] === null) {
    squareRejectResponse("square_response_object_expected", field);
  }
  return catalogObjectCategoryReference(
    squareSafeJsonObject(record[key], field),
    field
  );
}

function catalogObjectCategoryReferences(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  const raw = optionalArray(record, key, field, maximumLength);
  const references = raw.map((item) =>
    catalogObjectCategoryReference(
      squareSafeJsonObject(item, `${field}[]`),
      `${field}[]`
    )
  );
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.id)) {
      squareRejectResponse("square_catalog_category_reference_duplicate", field);
    }
    seen.add(reference.id);
  }
  return references.sort(compareCategoryReferences);
}

function catalogObjectCategoryReference(
  record: SquareSafeJsonObject,
  field: string
) {
  return SquareCatalogCategoryReferenceSchema.parse({
    id: assertServerCatalogObjectId(record, "id", `${field}.id`),
    ordinal: optionalNullableIntegerString(record, "ordinal", `${field}.ordinal`, {
      minimum: 0
    })
  });
}

function supportedCatalogObjectType(
  object: SquareSafeJsonObject,
  field: string
): z.infer<typeof SquareCatalogObjectTypeSchema> {
  const value = requiredField(object, "type", field);
  if (typeof value !== "string") {
    squareRejectResponse("square_catalog_object_type_invalid", field);
  }
  const parsed = SquareCatalogObjectTypeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new SquareCatalogUnsupportedObjectFailure(
    "square_catalog_object_type_unsupported",
    field
  );
}

function optionalIncludedResources(response: SquareSafeJsonObject) {
  if (!hasOwn(response, "included_resources")) {
    return [];
  }
  const includedResources = squareSafeJsonObject(
    response.included_resources,
    "$response.included_resources"
  );
  return requiredCatalogObjectArray(
    includedResources,
    "objects",
    "$response.included_resources.objects",
    1_000
  );
}

function requiredCatalogObjectArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  return requiredArray(record, key, field, maximumLength).map((item) =>
    squareSafeJsonObject(item, `${field}[]`)
  );
}

function optionalCatalogObjectArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  return optionalArray(record, key, field, maximumLength).map((item) =>
    squareSafeJsonObject(item, `${field}[]`)
  );
}

function optionalIdentifierArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  const raw = optionalArray(record, key, field, maximumLength);
  const values = raw.map((item) => {
    if (typeof item !== "string") {
      squareRejectResponse("square_identifier_invalid", `${field}[]`);
    }
    return assertCatalogObjectId(item, `${field}[]`);
  });
  const deduped = [...new Set(values)];
  if (deduped.length !== values.length) {
    squareRejectResponse("square_catalog_identifier_duplicate", field);
  }
  return deduped.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function requiredArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): SquareSafeJsonArray {
  const raw = requiredField(record, key, field);
  if (!Array.isArray(raw) || raw.length > maximumLength) {
    squareRejectResponse("square_response_array_invalid", field);
  }
  return raw;
}

function optionalArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): SquareSafeJsonArray {
  if (!hasOwn(record, key)) return [];
  const raw = record[key];
  if (!Array.isArray(raw) || raw.length > maximumLength) {
    squareRejectResponse("square_response_array_invalid", field);
  }
  return raw;
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

function requiredBoolean(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  const value = requiredField(record, key, field);
  if (typeof value !== "boolean") {
    squareRejectResponse("square_boolean_invalid", field);
  }
  return value;
}

function optionalDisplayText(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (typeof value !== "string") {
    squareRejectResponse("square_display_text_invalid", field);
  }
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > maximumLength ||
    hasUnsafeCatalogTrustedText(trimmed)
  ) {
    squareRejectResponse("square_display_text_invalid", field);
  }
  return trimmed;
}

function optionalNullableBoolean(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!hasOwn(record, key)) return null;
  const value = record[key];
  if (value === null) {
    squareRejectResponse("square_boolean_invalid", field);
  }
  if (typeof value !== "boolean") {
    squareRejectResponse("square_boolean_invalid", field);
  }
  return value;
}

function requiredIntegerString(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  options: Readonly<{ minimum?: number; maximum?: number }> = {}
) {
  const value = requiredField(record, key, field);
  return integerString(value, field, options);
}

function optionalNullableIntegerString(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  options: Readonly<{ minimum?: number; maximum?: number }> = {}
) {
  if (!hasOwn(record, key)) return null;
  if (record[key] === null) {
    squareRejectResponse("square_integer_invalid", field);
  }
  return integerString(record[key], field, options);
}

function integerString(
  value: SquareSafeJsonValue,
  field: string,
  options: Readonly<{ minimum?: number; maximum?: number }>
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    squareRejectResponse("square_integer_invalid", field);
  }
  return String(value);
}

function assertServerCatalogObjectId(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  return assertCatalogObjectId(
    squareRequiredIdentifier(record, key, field),
    field
  );
}

function assertCatalogObjectId(value: string, field: string) {
  if (value.startsWith("#")) {
    squareRejectResponse("square_catalog_temporary_id_rejected", field);
  }
  return value;
}

function missingRequired(field: string): never {
  squareRejectResponse("square_required_field_missing", field);
}

function hasOwn(record: SquareSafeJsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function compareCategoryReferences(
  left: z.infer<typeof SquareCatalogCategoryReferenceSchema>,
  right: z.infer<typeof SquareCatalogCategoryReferenceSchema>
) {
  return compareNullableIntegerStrings(left.ordinal, right.ordinal) ||
    compareStrings(left.id, right.id);
}

function compareCatalogObjectsByOrdinalThenId(
  left: SquareMinimizedCatalogObject,
  right: SquareMinimizedCatalogObject
) {
  const leftOrdinal = "ordinal" in left ? left.ordinal : null;
  const rightOrdinal = "ordinal" in right ? right.ordinal : null;
  return compareNullableIntegerStrings(leftOrdinal, rightOrdinal) ||
    compareStrings(left.id, right.id);
}

function compareNullableIntegerStrings(left: string | null, right: string | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (leftNumber !== rightNumber) {
    return leftNumber < rightNumber ? -1 : 1;
  }
  return 0;
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

type SquareCatalogMinimizationState = {
  authorities: Set<string>;
};

function newCatalogMinimizationState(): SquareCatalogMinimizationState {
  return {
    authorities: new Set<string>()
  };
}

function rememberCatalogAuthority(
  state: SquareCatalogMinimizationState | undefined,
  authority: z.infer<typeof SquareCatalogAuthoritySchema>,
  field: string
) {
  if (!state) return;
  const identity = `${authority.providerEnvironment}:${authority.entityType}:${authority.providerId}`;
  if (state.authorities.has(identity)) {
    squareRejectResponse("square_duplicate_authority_identity", `${field}.id`);
  }
  state.authorities.add(identity);
}

function hasUnsafeCatalogTrustedText(value: string) {
  return (
    CONTROL_CHARACTER_PATTERN.test(value) ||
    BIDIRECTIONAL_CONTROL_PATTERN.test(value) ||
    HTML_OR_SCRIPT_PATTERN.test(value)
  );
}

class SquareCatalogUnsupportedObjectFailure extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string) {
    super("square_catalog_object_unsupported");
    this.name = "SquareCatalogUnsupportedObjectFailure";
    this.code = code;
    this.field = field;
  }
}
