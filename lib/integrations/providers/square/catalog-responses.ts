import { z } from "zod";

import {
  IsoTimestampSchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";
import {
  SQUARE_ALLOWED_CATALOG_DISCOUNT_TAX_BASIS_TYPES,
  SQUARE_ALLOWED_CATALOG_DISCOUNT_TYPES,
  SQUARE_ALLOWED_CATALOG_MODIFIER_LIST_MODIFIER_TYPES,
  SQUARE_ALLOWED_CATALOG_MODIFIER_LIST_SELECTION_TYPES,
  SQUARE_ALLOWED_CATALOG_PRICING_TYPES,
  SQUARE_ALLOWED_CATALOG_TAX_CALCULATION_PHASES,
  SQUARE_ALLOWED_CATALOG_TAX_INCLUSION_TYPES,
  SQUARE_CATALOG_ENTITY_VERSION,
  SQUARE_CATALOG_OBJECT_TYPE_DATA_KEY_BY_TYPE,
  SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS,
  SQUARE_CATALOG_MINIMIZATION_VERSION,
  SQUARE_CATALOG_RESPONSE_CONTRACT_VERSION,
  SQUARE_CATALOG_RESPONSE_OPERATION_KEYS,
  SQUARE_PHASE_2B1B2_SUPPORTED_CATALOG_OBJECT_TYPES,
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
  squareOptionalNullableEnum,
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
  "catalog_item_variation",
  "catalog_modifier_list",
  "catalog_modifier",
  "catalog_discount",
  "catalog_tax"
]);

const SquareCatalogObjectTypeSchema = z.enum(
  SQUARE_PHASE_2B1B2_SUPPORTED_CATALOG_OBJECT_TYPES
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

const SquareCatalogScopedAvailabilitySchema = z.discriminatedUnion("mode", [
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

const SquareCatalogPercentageStringSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]?|100)(?:\.[0-9]*[1-9])?$/)
  .refine(
    (value) => {
      const [whole, fractional = ""] = value.split(".");
      return (
        fractional.length <= 6 &&
        (whole !== "100" || fractional === "")
      );
    },
    "Percentage must be a canonical decimal string"
  );

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

const SquareCatalogModifierListAuthoritySchema =
  SquareCatalogAuthoritySchema.extend({
    entityType: z.literal("catalog_modifier_list")
  }).strict();

export const SquareMinimizedCatalogModifierSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_modifier"),
    catalogObjectType: z.literal("MODIFIER"),
    availability: SquareCatalogScopedAvailabilitySchema,
    parentModifierListAuthority:
      SquareCatalogModifierListAuthoritySchema.nullable(),
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    price: SquareCatalogPriceSchema.nullable(),
    ordinal: SquareCatalogIntegerStringSchema.nullable(),
    onByDefault: z.boolean().nullable()
  }).strict();

export const SquareMinimizedCatalogModifierListSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_modifier_list"),
    catalogObjectType: z.literal("MODIFIER_LIST"),
    availability: SquareCatalogScopedAvailabilitySchema,
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    selectionType: z
      .enum(SQUARE_ALLOWED_CATALOG_MODIFIER_LIST_SELECTION_TYPES)
      .nullable(),
    ordinal: SquareCatalogIntegerStringSchema.nullable(),
    modifiers: z.array(SquareMinimizedCatalogModifierSchema).max(250),
    modifierCount: z.number().int().nonnegative().max(250).safe()
  }).strict();

export const SquareMinimizedCatalogDiscountSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_discount"),
    catalogObjectType: z.literal("DISCOUNT"),
    availability: SquareCatalogScopedAvailabilitySchema,
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    discountType: z.enum(SQUARE_ALLOWED_CATALOG_DISCOUNT_TYPES).nullable(),
    percentage: SquareCatalogPercentageStringSchema.nullable(),
    amount: SquareCatalogPriceSchema.nullable(),
    maximumAmount: SquareCatalogPriceSchema.nullable(),
    taxBasis: z
      .enum(SQUARE_ALLOWED_CATALOG_DISCOUNT_TAX_BASIS_TYPES)
      .nullable()
  }).strict();

export const SquareMinimizedCatalogTaxSchema =
  SquareCatalogBaseObjectSchema.extend({
    entityType: z.literal("catalog_tax"),
    catalogObjectType: z.literal("TAX"),
    availability: SquareCatalogScopedAvailabilitySchema,
    displayName: SquareCatalogTrustedTextSchema.nullable(),
    calculationPhase: z
      .enum(SQUARE_ALLOWED_CATALOG_TAX_CALCULATION_PHASES)
      .nullable(),
    inclusionType: z.enum(SQUARE_ALLOWED_CATALOG_TAX_INCLUSION_TYPES).nullable(),
    percentage: SquareCatalogPercentageStringSchema.nullable(),
    enabled: z.boolean().nullable(),
    appliesToCustomAmounts: z.boolean().nullable()
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
  SquareMinimizedCatalogItemVariationSchema,
  SquareMinimizedCatalogModifierListSchema,
  SquareMinimizedCatalogModifierSchema,
  SquareMinimizedCatalogDiscountSchema,
  SquareMinimizedCatalogTaxSchema
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
export type SquareMinimizedCatalogModifierList = Readonly<
  z.infer<typeof SquareMinimizedCatalogModifierListSchema>
>;
export type SquareMinimizedCatalogModifier = Readonly<
  z.infer<typeof SquareMinimizedCatalogModifierSchema>
>;
export type SquareMinimizedCatalogDiscount = Readonly<
  z.infer<typeof SquareMinimizedCatalogDiscountSchema>
>;
export type SquareMinimizedCatalogTax = Readonly<
  z.infer<typeof SquareMinimizedCatalogTaxSchema>
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

type CatalogRelationshipBucket = "primary" | "related" | "included";
type CatalogRelationshipParentBucket =
  | CatalogRelationshipBucket
  | "nested"
  | "nested_modifier";

type CatalogRelationshipContext =
  | Readonly<{
      bucket: CatalogRelationshipBucket;
    }>
  | Readonly<{
      bucket: "nested";
      parentBucket: CatalogRelationshipParentBucket;
      parentItemId: string;
    }>
  | Readonly<{
      bucket: "nested_modifier";
      parentBucket: CatalogRelationshipParentBucket;
      parentModifierListId: string;
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
    const items = sortCatalogObjects(
      rawObjects.items.map((item) =>
        minimizeSquareCatalogObject(item, provenance, primaryObjectField, {
          state: minimizationState,
          context: { bucket: "primary" }
        })
      )
    );
    const relatedItems = sortCatalogObjects(
      rawObjects.relatedItems.map((item) =>
        minimizeSquareCatalogObject(
          item,
          provenance,
          "$response.related_objects[]",
          { state: minimizationState, context: { bucket: "related" } }
        )
      )
    );
    const includedItems = sortCatalogObjects(
      rawObjects.includedItems.map((item) =>
        minimizeSquareCatalogObject(
          item,
          provenance,
          "$response.included_resources.objects[]",
          { state: minimizationState, context: { bucket: "included" } }
        )
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
    parentModifierListId?: string | null;
    inheritedAvailability?: z.infer<
      typeof SquareCatalogScopedAvailabilitySchema
    > | null;
    context?: CatalogRelationshipContext;
  }> = {}
): SquareMinimizedCatalogObject {
  const object = squareSafeJsonObject(input, field);
  const objectType = supportedCatalogObjectType(object, `${field}.type`);
  assertServerCatalogObjectId(object, "id", `${field}.id`);
  assertCatalogObjectDiscriminator(object, objectType, field);

  if (objectType === "CATEGORY") {
    return minimizeSquareCatalogCategory(object, provenance, field, options);
  }
  if (objectType === "ITEM") {
    return minimizeSquareCatalogItem(object, provenance, field, options);
  }
  if (objectType === "ITEM_VARIATION") {
    return minimizeSquareCatalogItemVariation(object, provenance, field, options);
  }
  if (objectType === "MODIFIER_LIST") {
    return minimizeSquareCatalogModifierList(object, provenance, field, options);
  }
  if (objectType === "MODIFIER") {
    return minimizeSquareCatalogModifier(object, provenance, field, options);
  }
  if (objectType === "DISCOUNT") {
    return minimizeSquareCatalogDiscount(object, provenance, field, options);
  }
  return minimizeSquareCatalogTax(object, provenance, field, options);
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
    context?: CatalogRelationshipContext;
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
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogItem(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    context?: CatalogRelationshipContext;
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
          base.id,
          options.context
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
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogItemVariation(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    parentItemId?: string | null;
    context?: CatalogRelationshipContext;
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
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogModifierList(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    context?: CatalogRelationshipContext;
  }>
): SquareMinimizedCatalogModifierList {
  const base = catalogBaseProjection(
    object,
    provenance,
    field,
    "catalog_modifier_list"
  );
  const availability = itemAvailability(object, field);
  const modifierListData = base.isDeleted
    ? null
    : squareRequiredObject(
        object,
        "modifier_list_data",
        `${field}.modifier_list_data`
      );
  const selectionType =
    modifierListData === null
      ? null
      : squareOptionalNullableEnum(
          modifierListData,
          "selection_type",
          `${field}.modifier_list_data.selection_type`,
          SQUARE_ALLOWED_CATALOG_MODIFIER_LIST_SELECTION_TYPES
        );
  const modifierType =
    modifierListData === null
      ? null
      : supportedModifierListType(modifierListData, field);
  if (modifierListData !== null) {
    assertSupportedModifierListSemantics(modifierListData, modifierType, field);
  }
  const modifiers =
    modifierListData === null
      ? []
      : catalogModifierListChildren(
          modifierListData,
          provenance,
          field,
          options.state,
          base.id,
          availability,
          modifierType,
          options.context
        );

  const item = SquareMinimizedCatalogModifierListSchema.parse({
    ...base,
    entityType: "catalog_modifier_list",
    catalogObjectType: "MODIFIER_LIST",
    availability,
    displayName:
      modifierListData === null
        ? null
        : optionalDisplayText(
            modifierListData,
            "name",
            `${field}.modifier_list_data.name`,
            255
          ),
    selectionType,
    ordinal:
      modifierListData === null
        ? null
        : optionalNullableIntegerString(
            modifierListData,
            "ordinal",
            `${field}.modifier_list_data.ordinal`,
            { minimum: 0, maximum: 2_147_483_647 }
          ),
    modifiers,
    modifierCount: modifiers.length
  });
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogModifier(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    parentModifierListId?: string | null;
    inheritedAvailability?: z.infer<
      typeof SquareCatalogScopedAvailabilitySchema
    > | null;
    context?: CatalogRelationshipContext;
  }>
): SquareMinimizedCatalogModifier {
  const base = catalogBaseProjection(
    object,
    provenance,
    field,
    "catalog_modifier"
  );
  const availability = modifierAvailability(
    object,
    field,
    options.inheritedAvailability
  );
  const modifierData = base.isDeleted
    ? null
    : squareRequiredObject(object, "modifier_data", `${field}.modifier_data`);
  if (modifierData !== null) {
    assertSupportedModifierSemantics(modifierData, field);
  }
  const parentModifierListId =
    modifierData === null
      ? null
      : squareRequiredIdentifier(
          modifierData,
          "modifier_list_id",
          `${field}.modifier_data.modifier_list_id`
        );
  if (
    parentModifierListId !== null &&
    options.parentModifierListId !== undefined &&
    options.parentModifierListId !== null &&
    parentModifierListId !== options.parentModifierListId
  ) {
    squareRejectResponse(
      "square_catalog_modifier_parent_mismatch",
      `${field}.modifier_data.modifier_list_id`
    );
  }
  const parentModifierListAuthority =
    parentModifierListId === null
      ? null
      : SquareCatalogModifierListAuthoritySchema.parse({
          providerKey: SQUARE_PROVIDER_KEY,
          providerEnvironment: provenance.providerEnvironment,
          entityType: "catalog_modifier_list",
          providerId: parentModifierListId
        });

  const item = SquareMinimizedCatalogModifierSchema.parse({
    ...base,
    entityType: "catalog_modifier",
    catalogObjectType: "MODIFIER",
    availability,
    parentModifierListAuthority,
    displayName:
      modifierData === null
        ? null
        : optionalDisplayText(
            modifierData,
            "name",
            `${field}.modifier_data.name`,
            255
          ),
    price:
      modifierData === null
        ? null
        : requiredCatalogMoney(
            modifierData,
            "price_money",
            `${field}.modifier_data.price_money`
          ),
    ordinal:
      modifierData === null
        ? null
        : optionalNullableIntegerString(
            modifierData,
            "ordinal",
            `${field}.modifier_data.ordinal`,
            { minimum: 0, maximum: 2_147_483_647 }
          ),
    onByDefault:
      modifierData === null
        ? null
        : optionalNullableBooleanValue(
            modifierData,
            "on_by_default",
            `${field}.modifier_data.on_by_default`
          )
  });
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogDiscount(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    context?: CatalogRelationshipContext;
  }>
): SquareMinimizedCatalogDiscount {
  const base = catalogBaseProjection(
    object,
    provenance,
    field,
    "catalog_discount"
  );
  const availability = itemAvailability(object, field);
  const discountData = base.isDeleted
    ? null
    : squareRequiredObject(object, "discount_data", `${field}.discount_data`);
  const discountType =
    discountData === null
      ? null
      : squareRequiredEnum(
          discountData,
          "discount_type",
          `${field}.discount_data.discount_type`,
          SQUARE_ALLOWED_CATALOG_DISCOUNT_TYPES
        );
  const discountFields =
    discountData === null || discountType === null
      ? {
          percentage: null,
          amount: null,
          maximumAmount: null,
          taxBasis: null
        }
      : catalogDiscountFields(discountData, discountType, field);

  const item = SquareMinimizedCatalogDiscountSchema.parse({
    ...base,
    entityType: "catalog_discount",
    catalogObjectType: "DISCOUNT",
    availability,
    displayName:
      discountData === null
        ? null
        : optionalDisplayText(
            discountData,
            "name",
            `${field}.discount_data.name`,
            255
          ),
    discountType,
    percentage: discountFields.percentage,
    amount: discountFields.amount,
    maximumAmount: discountFields.maximumAmount,
    taxBasis: discountFields.taxBasis
  });
  rememberCatalogAuthority(options.state, item, field, options.context);
  return item;
}

function minimizeSquareCatalogTax(
  object: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  options: Readonly<{
    state?: SquareCatalogMinimizationState;
    context?: CatalogRelationshipContext;
  }>
): SquareMinimizedCatalogTax {
  const base = catalogBaseProjection(object, provenance, field, "catalog_tax");
  const availability = itemAvailability(object, field);
  const taxData = base.isDeleted
    ? null
    : squareRequiredObject(object, "tax_data", `${field}.tax_data`);
  if (taxData !== null) {
    assertSupportedCatalogTaxSemantics(taxData, field);
  }

  const item = SquareMinimizedCatalogTaxSchema.parse({
    ...base,
    entityType: "catalog_tax",
    catalogObjectType: "TAX",
    availability,
    displayName:
      taxData === null
        ? null
        : optionalDisplayText(taxData, "name", `${field}.tax_data.name`, 255),
    calculationPhase:
      taxData === null
        ? null
        : squareRequiredEnum(
            taxData,
            "calculation_phase",
            `${field}.tax_data.calculation_phase`,
            SQUARE_ALLOWED_CATALOG_TAX_CALCULATION_PHASES
          ),
    inclusionType:
      taxData === null
        ? null
        : squareRequiredEnum(
            taxData,
            "inclusion_type",
            `${field}.tax_data.inclusion_type`,
            SQUARE_ALLOWED_CATALOG_TAX_INCLUSION_TYPES
          ),
    percentage:
      taxData === null
        ? null
        : requiredCatalogPercentageString(
            taxData,
            "percentage",
            `${field}.tax_data.percentage`
          ),
    enabled:
      taxData === null
        ? null
        : optionalNullableBooleanValue(
            taxData,
            "enabled",
            `${field}.tax_data.enabled`
          ),
    appliesToCustomAmounts:
      taxData === null
        ? null
        : optionalNullableBooleanValue(
            taxData,
            "applies_to_custom_amounts",
            `${field}.tax_data.applies_to_custom_amounts`
          )
  });
  rememberCatalogAuthority(options.state, item, field, options.context);
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

  const items = optionalCatalogObjectArray(
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
  entityType: z.infer<typeof SquareCatalogEntityTypeSchema>
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

function itemAvailability(
  object: SquareSafeJsonObject,
  field: string
): z.infer<typeof SquareCatalogScopedAvailabilitySchema> {
  const presentAtAllLocations =
    optionalNullableBoolean(
      object,
      "present_at_all_locations",
      `${field}.present_at_all_locations`
    ) ?? true;
  if (presentAtAllLocations) {
    return SquareCatalogScopedAvailabilitySchema.parse({
      mode: "all_locations_except",
      absentLocationIds: optionalIdentifierArray(
        object,
        "absent_at_location_ids",
        `${field}.absent_at_location_ids`,
        1_000
      )
    });
  }
  return SquareCatalogScopedAvailabilitySchema.parse({
    mode: "specific_locations",
    presentLocationIds: optionalIdentifierArray(
      object,
      "present_at_location_ids",
      `${field}.present_at_location_ids`,
      1_000
    )
  });
}

function modifierAvailability(
  object: SquareSafeJsonObject,
  field: string,
  inheritedAvailability:
    | z.infer<typeof SquareCatalogScopedAvailabilitySchema>
    | null
    | undefined
): z.infer<typeof SquareCatalogScopedAvailabilitySchema> {
  if (!inheritedAvailability) {
    return itemAvailability(object, field);
  }
  if (!catalogObjectHasLocationScope(object)) {
    return inheritedAvailability;
  }
  const explicitAvailability = itemAvailability(object, field);
  if (
    JSON.stringify(explicitAvailability) !== JSON.stringify(inheritedAvailability)
  ) {
    squareRejectResponse(
      "square_catalog_modifier_location_scope_invalid",
      `${field}.present_at_all_locations`
    );
  }
  return inheritedAvailability;
}

function catalogObjectHasLocationScope(object: SquareSafeJsonObject) {
  return (
    hasOwn(object, "present_at_all_locations") ||
    hasOwn(object, "present_at_location_ids") ||
    hasOwn(object, "absent_at_location_ids")
  );
}

function catalogItemVariationChildren(
  itemData: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  state: SquareCatalogMinimizationState | undefined,
  parentItemId: string,
  parentContext: CatalogRelationshipContext | undefined
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
      {
        state,
        parentItemId,
        context: {
          bucket: "nested",
          parentBucket: parentContext?.bucket ?? "primary",
          parentItemId
        }
      }
    )
  ).sort(compareCatalogObjectsByOrdinalThenId) as SquareMinimizedCatalogItemVariation[];
}

function catalogModifierListChildren(
  modifierListData: SquareSafeJsonObject,
  provenance: SquareResponseProvenance,
  field: string,
  state: SquareCatalogMinimizationState | undefined,
  parentModifierListId: string,
  inheritedAvailability: z.infer<typeof SquareCatalogScopedAvailabilitySchema>,
  modifierType: "LIST" | "TEXT" | null,
  parentContext: CatalogRelationshipContext | undefined
) {
  const hasModifiers = hasOwn(modifierListData, "modifiers");
  if (!hasModifiers) {
    if (modifierType === "LIST") {
      squareRejectResponse(
        "square_catalog_modifier_list_modifiers_missing",
        `${field}.modifier_list_data.modifiers`
      );
    }
    return [];
  }
  const raw = optionalNullableArray(
    modifierListData,
    "modifiers",
    `${field}.modifier_list_data.modifiers`,
    250
  );
  if (raw.length < 1) {
    squareRejectResponse(
      "square_catalog_modifier_list_modifiers_missing",
      `${field}.modifier_list_data.modifiers`
    );
  }
  return raw
    .map((item) => {
      const minimized = minimizeSquareCatalogObject(
        item,
        provenance,
        `${field}.modifier_list_data.modifiers[]`,
        {
          state,
          parentModifierListId,
          inheritedAvailability,
          context: {
            bucket: "nested_modifier",
            parentBucket: parentContext?.bucket ?? "primary",
            parentModifierListId
          }
        }
      );
      if (minimized.catalogObjectType !== "MODIFIER") {
        squareRejectResponse(
          "square_catalog_modifier_list_child_type_invalid",
          `${field}.modifier_list_data.modifiers[].type`
        );
      }
      return minimized;
    })
    .sort(compareCatalogObjectsByOrdinalThenId) as SquareMinimizedCatalogModifier[];
}

function supportedModifierListType(
  modifierListData: SquareSafeJsonObject,
  field: string
) {
  return squareOptionalNullableEnum(
    modifierListData,
    "modifier_type",
    `${field}.modifier_list_data.modifier_type`,
    SQUARE_ALLOWED_CATALOG_MODIFIER_LIST_MODIFIER_TYPES
  );
}

function assertSupportedModifierListSemantics(
  modifierListData: SquareSafeJsonObject,
  modifierType: "LIST" | "TEXT" | null,
  field: string
) {
  if (modifierType === "TEXT") {
    throw new SquareCatalogUnsupportedObjectFailure(
      "square_catalog_modifier_list_text_unsupported",
      `${field}.modifier_list_data.modifier_type`
    );
  }
  const allowQuantities = optionalNullableBooleanValue(
    modifierListData,
    "allow_quantities",
    `${field}.modifier_list_data.allow_quantities`
  );
  if (allowQuantities === true) {
    throw new SquareCatalogUnsupportedObjectFailure(
      "square_catalog_modifier_list_quantities_unsupported",
      `${field}.modifier_list_data.allow_quantities`
    );
  }
  for (const key of ["max_length", "text_required"] as const) {
    if (hasOwn(modifierListData, key)) {
      throw new SquareCatalogUnsupportedObjectFailure(
        "square_catalog_modifier_list_text_unsupported",
        `${field}.modifier_list_data.${key}`
      );
    }
  }
  for (const key of ["min_selected_modifiers", "max_selected_modifiers"] as const) {
    const selectionLimit = optionalNullableIntegerNumber(
      modifierListData,
      key,
      `${field}.modifier_list_data.${key}`,
      { minimum: -1, maximum: 250 }
    );
    if (selectionLimit !== null && selectionLimit > 0) {
      throw new SquareCatalogUnsupportedObjectFailure(
        "square_catalog_modifier_selection_bounds_unsupported",
        `${field}.modifier_list_data.${key}`
      );
    }
  }
}

function assertSupportedModifierSemantics(
  modifierData: SquareSafeJsonObject,
  field: string
) {
  const locationOverrides = optionalNullableArray(
    modifierData,
    "location_overrides",
    `${field}.modifier_data.location_overrides`,
    1_000
  );
  if (locationOverrides.length > 0) {
    throw new SquareCatalogUnsupportedObjectFailure(
      "square_catalog_modifier_location_overrides_unsupported",
      `${field}.modifier_data.location_overrides`
    );
  }
  const childModifierListIds = optionalNullableIdentifierArray(
    modifierData,
    "child_modifier_list_ids",
    `${field}.modifier_data.child_modifier_list_ids`,
    5
  );
  if (childModifierListIds.length > 0) {
    throw new SquareCatalogUnsupportedObjectFailure(
      "square_catalog_modifier_child_lists_unsupported",
      `${field}.modifier_data.child_modifier_list_ids`
    );
  }
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

function catalogDiscountFields(
  discountData: SquareSafeJsonObject,
  discountType: (typeof SQUARE_ALLOWED_CATALOG_DISCOUNT_TYPES)[number],
  field: string
) {
  const percentage = optionalCatalogPercentageString(
    discountData,
    "percentage",
    `${field}.discount_data.percentage`
  );
  const amount = hasPresentValue(discountData, "amount_money")
    ? requiredCatalogMoney(
        discountData,
        "amount_money",
        `${field}.discount_data.amount_money`
      )
    : null;
  const maximumAmount = hasPresentValue(discountData, "maximum_amount_money")
    ? requiredCatalogMoney(
        discountData,
        "maximum_amount_money",
        `${field}.discount_data.maximum_amount_money`
      )
    : null;
  const taxBasis = squareOptionalNullableEnum(
    discountData,
    "modify_tax_basis",
    `${field}.discount_data.modify_tax_basis`,
    SQUARE_ALLOWED_CATALOG_DISCOUNT_TAX_BASIS_TYPES
  );

  if (
    discountType === "FIXED_PERCENTAGE" ||
    discountType === "VARIABLE_PERCENTAGE"
  ) {
    if (percentage === null) {
      squareRejectResponse(
        "square_catalog_discount_percentage_missing",
        `${field}.discount_data.percentage`
      );
    }
    if (amount !== null) {
      squareRejectResponse(
        "square_catalog_discount_amount_conflict",
        `${field}.discount_data.amount_money`
      );
    }
    if (discountType === "VARIABLE_PERCENTAGE" && percentage !== "0") {
      squareRejectResponse(
        "square_catalog_discount_variable_percentage_invalid",
        `${field}.discount_data.percentage`
      );
    }
    return { percentage, amount: null, maximumAmount, taxBasis } as const;
  }

  if (percentage !== null) {
    squareRejectResponse(
      "square_catalog_discount_percentage_conflict",
      `${field}.discount_data.percentage`
    );
  }
  if (maximumAmount !== null) {
    squareRejectResponse(
      "square_catalog_discount_maximum_amount_conflict",
      `${field}.discount_data.maximum_amount_money`
    );
  }
  if (amount === null) {
    squareRejectResponse(
      "square_catalog_discount_amount_missing",
      `${field}.discount_data.amount_money`
    );
  }
  if (discountType === "VARIABLE_AMOUNT" && amount.amountMinor !== "0") {
    squareRejectResponse(
      "square_catalog_discount_variable_amount_invalid",
      `${field}.discount_data.amount_money.amount`
    );
  }
  return { percentage: null, amount, maximumAmount: null, taxBasis } as const;
}

function assertSupportedCatalogTaxSemantics(
  taxData: SquareSafeJsonObject,
  field: string
) {
  if (!hasPresentValue(taxData, "applies_to_product_set_id")) {
    return;
  }
  if (typeof taxData.applies_to_product_set_id !== "string") {
    squareRejectResponse(
      "square_identifier_invalid",
      `${field}.tax_data.applies_to_product_set_id`
    );
  }
  assertCatalogObjectId(
    squareRequiredIdentifier(
      taxData,
      "applies_to_product_set_id",
      `${field}.tax_data.applies_to_product_set_id`
    ),
    `${field}.tax_data.applies_to_product_set_id`
  );
  throw new SquareCatalogUnsupportedObjectFailure(
    "square_catalog_tax_product_set_unsupported",
    `${field}.tax_data.applies_to_product_set_id`
  );
}

function requiredCatalogMoney(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  const money = squareRequiredObject(record, key, field);
  return SquareCatalogPriceSchema.parse({
    amountMinor: requiredIntegerString(money, "amount", `${field}.amount`, {
      minimum: 0
    }),
    currency: squareRequiredCurrencyCode(money, "currency", `${field}.currency`)
  });
}

function requiredCatalogPercentageString(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  return catalogPercentageString(requiredField(record, key, field), field);
}

function optionalCatalogPercentageString(
  record: SquareSafeJsonObject,
  key: string,
  field: string
) {
  if (!hasPresentValue(record, key)) return null;
  return catalogPercentageString(record[key], field);
}

function catalogPercentageString(value: SquareSafeJsonValue, field: string) {
  if (typeof value !== "string") {
    squareRejectResponse("square_catalog_percentage_invalid", field);
  }
  if (!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/.test(value)) {
    squareRejectResponse("square_catalog_percentage_invalid", field);
  }
  const [whole, fractional = ""] = value.split(".");
  if (
    Number(whole) > 100 ||
    (whole === "100" && /[1-9]/.test(fractional))
  ) {
    squareRejectResponse("square_catalog_percentage_invalid", field);
  }
  const canonicalFractional = fractional.replace(/0+$/u, "");
  const canonical =
    canonicalFractional.length > 0 ? `${whole}.${canonicalFractional}` : whole;
  return SquareCatalogPercentageStringSchema.parse(canonical);
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

function assertCatalogObjectDiscriminator(
  object: SquareSafeJsonObject,
  objectType: z.infer<typeof SquareCatalogObjectTypeSchema>,
  field: string
) {
  const expectedDataKey = SQUARE_CATALOG_OBJECT_TYPE_DATA_KEY_BY_TYPE[objectType];
  const isDeleted = requiredBoolean(object, "is_deleted", `${field}.is_deleted`);
  const presentTypeDataKeys = SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS.filter((key) =>
    hasOwn(object, key)
  );

  for (const dataKey of presentTypeDataKeys) {
    if (dataKey !== expectedDataKey) {
      squareRejectResponse(
        "square_catalog_object_discriminator_conflict",
        `${field}.${dataKey}`
      );
    }
    squareSafeJsonObject(object[dataKey], `${field}.${dataKey}`);
  }

  if (!isDeleted && !hasOwn(object, expectedDataKey)) {
    squareRejectResponse(
      "square_catalog_object_discriminator_missing",
      `${field}.${expectedDataKey}`
    );
  }
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

function optionalNullableIdentifierArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
) {
  const raw = optionalNullableArray(record, key, field, maximumLength);
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

function optionalNullableArray(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  maximumLength: number
): SquareSafeJsonArray {
  if (!hasOwn(record, key) || record[key] === null) return [];
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

function optionalNullableBooleanValue(
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

function optionalNullableIntegerNumber(
  record: SquareSafeJsonObject,
  key: string,
  field: string,
  options: Readonly<{ minimum?: number; maximum?: number }> = {}
) {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (options.minimum !== undefined && value < options.minimum) ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    squareRejectResponse("square_integer_invalid", field);
  }
  return value;
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
  if (!SquareIdentifierSchema.safeParse(value).success) {
    squareRejectResponse("square_identifier_invalid", field);
  }
  return value;
}

function missingRequired(field: string): never {
  squareRejectResponse("square_required_field_missing", field);
}

function hasOwn(record: SquareSafeJsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasPresentValue(record: SquareSafeJsonObject, key: string) {
  return hasOwn(record, key) && record[key] !== null;
}

function sortCatalogObjects<T extends SquareMinimizedCatalogObject>(
  items: readonly T[]
): T[] {
  return [...items].sort(compareCatalogObjectsByEntityThenId);
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

function compareCatalogObjectsByEntityThenId(
  left: SquareMinimizedCatalogObject,
  right: SquareMinimizedCatalogObject
) {
  return compareStrings(left.entityType, right.entityType) ||
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

type SquareCatalogAuthorityOccurrence = {
  readonly fingerprint: string;
  readonly contexts: Set<string>;
};

type SquareCatalogMinimizationState = {
  authorities: Map<string, SquareCatalogAuthorityOccurrence>;
};

function newCatalogMinimizationState(): SquareCatalogMinimizationState {
  return {
    authorities: new Map<string, SquareCatalogAuthorityOccurrence>()
  };
}

function rememberCatalogAuthority(
  state: SquareCatalogMinimizationState | undefined,
  item: SquareMinimizedCatalogObject,
  field: string,
  context: CatalogRelationshipContext | undefined
) {
  if (!state) return;
  const authority = item.authority;
  const identity = `${authority.providerEnvironment}:${authority.entityType}:${authority.providerId}`;
  const contextKey = catalogRelationshipContextKey(context);
  const fingerprint = squareCatalogObjectFingerprint(item);
  const previous = state.authorities.get(identity);
  if (!previous) {
    state.authorities.set(identity, {
      fingerprint,
      contexts: new Set([contextKey])
    });
    return;
  }
  if (previous.contexts.has(contextKey)) {
    squareRejectResponse("square_duplicate_authority_identity", `${field}.id`);
  }
  if (previous.fingerprint !== fingerprint) {
    squareRejectResponse(
      "square_catalog_authority_identity_conflict",
      `${field}.id`
    );
  }
  previous.contexts.add(contextKey);
}

function catalogRelationshipContextKey(
  context: CatalogRelationshipContext | undefined
) {
  if (!context) return "standalone";
  if (context.bucket === "nested") {
    return `nested:${context.parentBucket}:${context.parentItemId}`;
  }
  if (context.bucket === "nested_modifier") {
    return `nested_modifier:${context.parentBucket}:${context.parentModifierListId}`;
  }
  return context.bucket;
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
