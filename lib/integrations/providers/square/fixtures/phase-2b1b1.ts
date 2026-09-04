import {
  SQUARE_API_VERSION,
  SQUARE_PROVIDER_KEY,
  type SquareProviderEnvironmentKey
} from "@/lib/integrations/providers/square/contracts";
import type { SquareCatalogResponseOperation } from "@/lib/integrations/providers/square/catalog-responses";

export const SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR =
  "sq2b1b1CatalogCursor001==" as const;

export const SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES = {
  categoryDescription: "sq2b1b1-category-description-canary",
  categoryUrl: "https://example.test/sq2b1b1-category-url",
  itemDescription: "sq2b1b1-item-description-canary",
  itemHtmlDescription: "<p>sq2b1b1-item-html-description-canary</p>",
  itemUrl: "https://example.test/sq2b1b1-item-url",
  itemContact: "catalog-contact@example.test",
  itemAddress: "1 Synthetic Catalog Way",
  itemCoordinates: "sq2b1b1-catalog-coordinate-canary",
  itemSocial: "sq2b1b1-catalog-social-canary",
  variationDescription: "sq2b1b1-variation-description-canary",
  variationUrl: "https://example.test/sq2b1b1-variation-url",
  undocumentedField: "sq2b1b1-undocumented-field-canary"
} as const;

export type SquarePhase2B1B1InputOverrides = Readonly<{
  providerKey?: unknown;
  providerEnvironment?: unknown;
  apiVersion?: unknown;
  operation?: unknown;
}>;

export function squarePhase2B1B1ParserInput(
  response: unknown,
  operation: SquareCatalogResponseOperation = "list_catalog",
  overrides: SquarePhase2B1B1InputOverrides = {}
) {
  const hasProviderKeyOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "providerKey"
  );
  const hasProviderEnvironmentOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "providerEnvironment"
  );
  const hasApiVersionOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "apiVersion"
  );
  const hasOperationOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "operation"
  );

  return {
    providerKey: hasProviderKeyOverride
      ? overrides.providerKey
      : SQUARE_PROVIDER_KEY,
    providerEnvironment: hasProviderEnvironmentOverride
      ? overrides.providerEnvironment
      : "sandbox",
    apiVersion: hasApiVersionOverride ? overrides.apiVersion : SQUARE_API_VERSION,
    operation: hasOperationOverride ? overrides.operation : operation,
    response
  };
}

export function squarePhase2B1B1Category(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "CATEGORY",
    id: "SQ2B1B1CAT001",
    updated_at: "2026-08-19T15:00:00.000Z",
    version: 1_787_142_000_001,
    is_deleted: false,
    present_at_all_locations: true,
    category_data: {
      name: "Coffee & Tea",
      parent_category: {
        id: "SQ2B1B1CATROOT",
        ordinal: 0
      },
      is_top_level: false
    },
    ...overrides
  };
}

export function squarePhase2B1B1DeletedCategory(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "CATEGORY",
    id: "SQ2B1B1CATDEL001",
    updated_at: "2026-08-19T16:00:00.000Z",
    version: 1_787_145_600_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B1ItemVariation(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "ITEM_VARIATION",
    id: "SQ2B1B1VAR001",
    updated_at: "2026-08-19T15:05:00.000Z",
    version: 1_787_142_300_001,
    is_deleted: false,
    present_at_all_locations: false,
    present_at_location_ids: ["SQ2B1B1LOC002", "SQ2B1B1LOC001"],
    item_variation_data: {
      item_id: "SQ2B1B1ITEM001",
      name: "12 oz",
      sku: "TEA-12OZ",
      pricing_type: "FIXED_PRICING",
      price_money: {
        amount: 450,
        currency: "USD"
      },
      ordinal: 0,
      track_inventory: true,
      sellable: true,
      stockable: true
    },
    ...overrides
  };
}

export function squarePhase2B1B1VariablePriceVariation(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B1B1ItemVariation({
    id: "SQ2B1B1VAR002",
    updated_at: "2026-08-19T15:06:00.000Z",
    version: 1_787_142_360_001,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B1LOC004", "SQ2B1B1LOC003"],
    item_variation_data: {
      item_id: "SQ2B1B1ITEM001",
      name: "Custom amount",
      sku: "TEA-CUSTOM",
      pricing_type: "VARIABLE_PRICING",
      ordinal: 1,
      track_inventory: false,
      sellable: true,
      stockable: false
    },
    ...overrides
  });
}

export function squarePhase2B1B1DeletedVariation(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "ITEM_VARIATION",
    id: "SQ2B1B1VARDEL001",
    updated_at: "2026-08-19T16:05:00.000Z",
    version: 1_787_145_900_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B1Item(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "ITEM",
    id: "SQ2B1B1ITEM001",
    updated_at: "2026-08-19T15:04:00.000Z",
    version: 1_787_142_240_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B1LOC009"],
    item_data: {
      name: "Ceremonial Tea",
      categories: [
        {
          id: "SQ2B1B1CAT001",
          ordinal: 2
        },
        {
          id: "SQ2B1B1CATROOT",
          ordinal: 1
        }
      ],
      variations: [
        squarePhase2B1B1VariablePriceVariation(),
        squarePhase2B1B1ItemVariation()
      ]
    },
    ...overrides
  };
}

export function squarePhase2B1B1DeletedItem(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "ITEM",
    id: "SQ2B1B1ITEMDEL001",
    updated_at: "2026-08-19T16:04:00.000Z",
    version: 1_787_145_840_001,
    is_deleted: true,
    present_at_all_locations: false,
    present_at_location_ids: [],
    ...overrides
  };
}

export function squarePhase2B1B1ListEnvelope(
  objectOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [squarePhase2B1B1Category(), squarePhase2B1B1Item(objectOverrides)],
    cursor: SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR,
    ...envelopeOverrides
  };
}

export function squarePhase2B1B1SearchEnvelope(
  itemOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [squarePhase2B1B1Item(itemOverrides)],
    related_objects: [squarePhase2B1B1Category()],
    included_resources: {
      objects: [
        squarePhase2B1B1Category({
          id: "SQ2B1B1CATINC001",
          category_data: {
            name: "Seasonal",
            is_top_level: true
          }
        })
      ]
    },
    cursor: SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR,
    latest_time: "2026-08-19T15:10:00.000Z",
    ...envelopeOverrides
  };
}

export function squarePhase2B1B1RetrieveEnvelope(
  object: Readonly<Record<string, unknown>> = squarePhase2B1B1Item(),
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    object,
    related_objects: [
      squarePhase2B1B1Category({
        id: "SQ2B1B1CATREL001",
        category_data: {
          name: "Related Tea",
          is_top_level: true
        }
      })
    ],
    ...envelopeOverrides
  };
}

export function squarePhase2B1B1BatchEnvelope(
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [squarePhase2B1B1DeletedCategory(), squarePhase2B1B1DeletedItem()],
    related_objects: [squarePhase2B1B1DeletedVariation()],
    included_resources: {
      objects: [
        squarePhase2B1B1Category({
          id: "SQ2B1B1CATINC002",
          category_data: {
            name: "Archived",
            is_top_level: true
          }
        })
      ]
    },
    ...envelopeOverrides
  };
}

export const SQUARE_PHASE_2B1B1_CATALOG_FIXTURES = {
  listCatalog: squarePhase2B1B1ListEnvelope(),
  searchCatalog: squarePhase2B1B1SearchEnvelope(),
  retrieveCatalogObject: squarePhase2B1B1RetrieveEnvelope(),
  batchRetrieveCatalogObjects: squarePhase2B1B1BatchEnvelope(),
  emptyList: { objects: [] },
  emptySearch: {
    objects: [],
    related_objects: [],
    included_resources: { objects: [] },
    errors: [],
    latest_time: "2026-08-19T15:10:00.000Z"
  },
  itemExcludedCanaries: squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [
        {
          id: "SQ2B1B1CATROOT",
          ordinal: 1
        },
        {
          id: "SQ2B1B1CAT001",
          ordinal: 2,
          ignored_note: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.undocumentedField
        }
      ],
      variations: [
        squarePhase2B1B1ItemVariation({
          item_variation_data: {
            item_id: "SQ2B1B1ITEM001",
            name: "12 oz",
            sku: "TEA-12OZ",
            pricing_type: "FIXED_PRICING",
            price_money: { amount: 450, currency: "USD" },
            ordinal: 0,
            track_inventory: true,
            sellable: true,
            stockable: true,
            description:
              SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.variationDescription,
            ecom_uri: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.variationUrl
          }
        }),
        squarePhase2B1B1VariablePriceVariation()
      ],
      description: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemDescription,
      description_html: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemHtmlDescription,
      ecom_uri: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemUrl,
      contact_email: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemContact,
      address: {
        address_line_1: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemAddress
      },
      coordinates: {
        canary: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemCoordinates
      },
      twitter_username: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.itemSocial,
      product_type: "REGULAR",
      reporting_category: {
        id: "SQ2B1B1CAT999",
        ordinal: 99
      },
      modifier_list_info: [{ modifier_list_id: "SQ2B1B1MODLIST001" }],
      tax_ids: ["SQ2B1B1TAX001"],
      skip_modifier_screen: true
    },
    custom_attribute_values: {
      canary: {
        string_value: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.undocumentedField
      }
    },
    present_at_location_ids: ["SQ2B1B1LOC777"]
  }),
  categoryExcludedCanaries: squarePhase2B1B1ListEnvelope(
    {},
    {
      objects: [
        squarePhase2B1B1Category({
          category_data: {
            name: "Coffee & Tea",
            parent_category: { id: "SQ2B1B1CATROOT", ordinal: 0 },
            is_top_level: false,
            description:
              SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.categoryDescription,
            ecom_uri: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.categoryUrl,
            path_to_root: [{ id: "SQ2B1B1CATROOT", ordinal: 0 }]
          },
          custom_attribute_values: {
            canary: SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.undocumentedField
          }
        })
      ]
    }
  ),
  hostileExcludedFields: squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [
        { id: "SQ2B1B1CATROOT", ordinal: 1 },
        { id: "SQ2B1B1CAT001", ordinal: 2 }
      ],
      variations: [
        squarePhase2B1B1VariablePriceVariation(),
        squarePhase2B1B1ItemVariation()
      ],
      description: "<script>alert('discarded')</script>\nordinary note",
      description_html: "<img src=x onerror=alert('discarded')>",
      ecom_uri: "javascript:alert('discarded')"
    }
  }),
  unsupportedModifierList: {
    objects: [
      {
        type: "MODIFIER_LIST",
        id: "SQ2B1B1MODLIST001",
        updated_at: "2026-08-19T15:11:00.000Z",
        version: 1_787_142_660_001,
        is_deleted: false,
        present_at_all_locations: true,
        modifier_list_data: { name: "Deferred modifiers" }
      }
    ]
  },
  duplicateTopLevelAuthority: {
    objects: [
      squarePhase2B1B1Category(),
      squarePhase2B1B1Category({
        category_data: { name: "Duplicate", is_top_level: true }
      })
    ]
  },
  duplicateNestedAuthority: squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [
        squarePhase2B1B1ItemVariation(),
        squarePhase2B1B1ItemVariation({
          item_variation_data: {
            item_id: "SQ2B1B1ITEM001",
            name: "Duplicate variation",
            sku: "TEA-DUPE",
            pricing_type: "FIXED_PRICING",
            price_money: { amount: 500, currency: "USD" },
            ordinal: 1
          }
        })
      ]
    }
  }),
  malformedProviderErrors: {
    errors: {},
    objects: [squarePhase2B1B1Category()]
  },
  mixedProviderErrors: {
    errors: [
      {
        category: "AUTHENTICATION_ERROR",
        detail: "SQ2B1B1ITEM001 synthetic detail"
      }
    ],
    objects: [squarePhase2B1B1Item()]
  }
} as const;

export function squarePhase2B1B1OversizedCatalogObjectArray() {
  return {
    objects: Array.from({ length: 1_001 }, (_, index) =>
      squarePhase2B1B1Category({
        id: `SQ2B1B1CAT${String(index).padStart(4, "0")}`,
        category_data: {
          name: `Category ${index}`,
          is_top_level: true
        }
      })
    )
  };
}

export function squarePhase2B1B1OversizedExcludedField() {
  return squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [squarePhase2B1B1ItemVariation()],
      description: "D".repeat(4_097)
    }
  });
}

export function squarePhase2B1B1EnvironmentInput(
  response: unknown,
  operation: SquareCatalogResponseOperation,
  providerEnvironment: SquareProviderEnvironmentKey
) {
  return squarePhase2B1B1ParserInput(response, operation, {
    providerEnvironment
  });
}
