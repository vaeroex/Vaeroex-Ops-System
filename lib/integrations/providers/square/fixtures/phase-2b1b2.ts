import {
  SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES,
  squarePhase2B1B1Category,
  squarePhase2B1B1ParserInput,
  type SquarePhase2B1B1InputOverrides
} from "@/lib/integrations/providers/square/fixtures/phase-2b1b1";
import type { SquareCatalogResponseOperation } from "@/lib/integrations/providers/square/catalog-responses";

export const SQUARE_PHASE_2B1B2_SYNTHETIC_CURSOR =
  "sq2b1b2CatalogCursor001==" as const;

export const SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES = {
  modifierKitchenName: "sq2b1b2-modifier-kitchen-name-canary",
  modifierImageId: "SQ2B1B2IMAGE001",
  modifierHiddenOnline: "sq2b1b2-modifier-hidden-online-canary",
  modifierListInternalName: "sq2b1b2-modifier-list-internal-name-canary",
  modifierListImageId: "SQ2B1B2IMAGE002",
  discountLabelColor: "#bada55",
  discountPinRequired: "sq2b1b2-discount-pin-required-canary",
  taxProductSet: "SQ2B1B2PRODUCTSET001",
  description: "sq2b1b2-description-canary",
  url: "https://example.test/sq2b1b2-url-canary",
  contact: "catalog-2b1b2@example.test",
  address: "2 Synthetic Catalog Way",
  coordinates: "sq2b1b2-coordinate-canary",
  social: "sq2b1b2-social-canary",
  futureField: "sq2b1b2-future-extra-canary",
  ...SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES
} as const;

export function squarePhase2B1B2ParserInput(
  response: unknown,
  operation: SquareCatalogResponseOperation = "list_catalog",
  overrides: SquarePhase2B1B1InputOverrides = {}
) {
  return squarePhase2B1B1ParserInput(response, operation, overrides);
}

export function squarePhase2B1B2Modifier(
  overrides: Readonly<Record<string, unknown>> = {},
  modifierDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "MODIFIER",
    id: "SQ2B1B2MOD001",
    updated_at: "2026-08-19T17:01:00.000Z",
    version: 1_787_149_260_001,
    is_deleted: false,
    present_at_all_locations: false,
    present_at_location_ids: ["SQ2B1B2LOC002", "SQ2B1B2LOC001"],
    modifier_data: {
      name: "Oat milk",
      price_money: {
        amount: 75,
        currency: "USD"
      },
      on_by_default: false,
      ordinal: 0,
      modifier_list_id: "SQ2B1B2MODLIST001",
      ...modifierDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2SecondModifier(
  overrides: Readonly<Record<string, unknown>> = {},
  modifierDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B1B2Modifier(
    {
      id: "SQ2B1B2MOD002",
      updated_at: "2026-08-19T17:02:00.000Z",
      version: 1_787_149_320_001,
      ...overrides
    },
    {
      name: "Almond milk",
      price_money: {
        amount: 100,
        currency: "USD"
      },
      on_by_default: true,
      ordinal: 1,
      modifier_list_id: "SQ2B1B2MODLIST001",
      ...modifierDataOverrides
    }
  );
}

export function squarePhase2B1B2DeletedModifier(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "MODIFIER",
    id: "SQ2B1B2MODDEL001",
    updated_at: "2026-08-19T18:01:00.000Z",
    version: 1_787_152_860_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B2ModifierList(
  overrides: Readonly<Record<string, unknown>> = {},
  modifierListDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "MODIFIER_LIST",
    id: "SQ2B1B2MODLIST001",
    updated_at: "2026-08-19T17:00:00.000Z",
    version: 1_787_149_200_001,
    is_deleted: false,
    present_at_all_locations: false,
    present_at_location_ids: ["SQ2B1B2LOC002", "SQ2B1B2LOC001"],
    modifier_list_data: {
      name: "Milk options",
      ordinal: 3,
      selection_type: "MULTIPLE",
      modifier_type: "LIST",
      modifiers: [
        squarePhase2B1B2SecondModifier(),
        squarePhase2B1B2Modifier()
      ],
      ...modifierListDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2SingleModifierList(
  overrides: Readonly<Record<string, unknown>> = {},
  modifierListDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "MODIFIER_LIST",
    id: "SQ2B1B2MODLIST002",
    updated_at: "2026-08-19T17:03:00.000Z",
    version: 1_787_149_380_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B2LOC009"],
    modifier_list_data: {
      name: "Temperature",
      ordinal: 4,
      selection_type: "SINGLE",
      modifiers: [
        {
          type: "MODIFIER",
          id: "SQ2B1B2MOD003",
          updated_at: "2026-08-19T17:04:00.000Z",
          version: 1_787_149_440_001,
          is_deleted: false,
          present_at_all_locations: true,
          absent_at_location_ids: ["SQ2B1B2LOC009"],
          modifier_data: {
            name: "Iced",
            price_money: { amount: 0, currency: "USD" },
            ordinal: 0,
            modifier_list_id: "SQ2B1B2MODLIST002"
          }
        }
      ],
      ...modifierListDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2DeletedModifierList(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "MODIFIER_LIST",
    id: "SQ2B1B2MODLISTDEL001",
    updated_at: "2026-08-19T18:00:00.000Z",
    version: 1_787_152_800_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B2FixedPercentageDiscount(
  overrides: Readonly<Record<string, unknown>> = {},
  discountDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "DISCOUNT",
    id: "SQ2B1B2DISC001",
    updated_at: "2026-08-19T17:10:00.000Z",
    version: 1_787_149_800_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B2LOC010"],
    discount_data: {
      name: "Neighborhood discount",
      discount_type: "FIXED_PERCENTAGE",
      percentage: "7.5000",
      maximum_amount_money: {
        amount: 2000,
        currency: "USD"
      },
      modify_tax_basis: "MODIFY_TAX_BASIS",
      ...discountDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2FixedAmountDiscount(
  overrides: Readonly<Record<string, unknown>> = {},
  discountDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "DISCOUNT",
    id: "SQ2B1B2DISC002",
    updated_at: "2026-08-19T17:11:00.000Z",
    version: 1_787_149_860_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B2LOC010"],
    discount_data: {
      name: "Five dollars off",
      discount_type: "FIXED_AMOUNT",
      amount_money: {
        amount: 500,
        currency: "USD"
      },
      modify_tax_basis: "DO_NOT_MODIFY_TAX_BASIS",
      ...discountDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2VariablePercentageDiscount(
  overrides: Readonly<Record<string, unknown>> = {},
  discountDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B1B2FixedPercentageDiscount(
    {
      id: "SQ2B1B2DISC003",
      updated_at: "2026-08-19T17:12:00.000Z",
      version: 1_787_149_920_001,
      ...overrides
    },
    {
      name: "Open percentage",
      discount_type: "VARIABLE_PERCENTAGE",
      percentage: "0.0",
      maximum_amount_money: {
        amount: 1500,
        currency: "USD"
      },
      ...discountDataOverrides
    }
  );
}

export function squarePhase2B1B2VariableAmountDiscount(
  overrides: Readonly<Record<string, unknown>> = {},
  discountDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "DISCOUNT",
    id: "SQ2B1B2DISC004",
    updated_at: "2026-08-19T17:13:00.000Z",
    version: 1_787_149_980_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B2LOC010"],
    discount_data: {
      name: "Open amount",
      discount_type: "VARIABLE_AMOUNT",
      amount_money: {
        amount: 0,
        currency: "USD"
      },
      ...discountDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2DeletedDiscount(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "DISCOUNT",
    id: "SQ2B1B2DISCDEL001",
    updated_at: "2026-08-19T18:10:00.000Z",
    version: 1_787_153_400_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B2Tax(
  overrides: Readonly<Record<string, unknown>> = {},
  taxDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "TAX",
    id: "SQ2B1B2TAX001",
    updated_at: "2026-08-19T17:20:00.000Z",
    version: 1_787_150_400_001,
    is_deleted: false,
    present_at_all_locations: false,
    present_at_location_ids: ["SQ2B1B2LOC001", "SQ2B1B2LOC002"],
    tax_data: {
      name: "Local sales tax",
      calculation_phase: "TAX_SUBTOTAL_PHASE",
      inclusion_type: "ADDITIVE",
      percentage: "8.2500",
      applies_to_custom_amounts: true,
      enabled: true,
      ...taxDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2InclusiveTax(
  overrides: Readonly<Record<string, unknown>> = {},
  taxDataOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "TAX",
    id: "SQ2B1B2TAX002",
    updated_at: "2026-08-19T17:21:00.000Z",
    version: 1_787_150_460_001,
    is_deleted: false,
    present_at_all_locations: true,
    absent_at_location_ids: ["SQ2B1B2LOC011"],
    tax_data: {
      name: "Inclusive city tax",
      calculation_phase: "TAX_TOTAL_PHASE",
      inclusion_type: "INCLUSIVE",
      percentage: "5.125000",
      applies_to_custom_amounts: false,
      enabled: false,
      ...taxDataOverrides
    },
    ...overrides
  };
}

export function squarePhase2B1B2DeletedTax(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    type: "TAX",
    id: "SQ2B1B2TAXDEL001",
    updated_at: "2026-08-19T18:20:00.000Z",
    version: 1_787_154_000_001,
    is_deleted: true,
    present_at_all_locations: true,
    ...overrides
  };
}

export function squarePhase2B1B2ListEnvelope(
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [
      squarePhase2B1B2ModifierList(),
      squarePhase2B1B2FixedPercentageDiscount(),
      squarePhase2B1B2Tax()
    ],
    cursor: SQUARE_PHASE_2B1B2_SYNTHETIC_CURSOR,
    ...envelopeOverrides
  };
}

export function squarePhase2B1B2SearchEnvelope(
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [
      squarePhase2B1B2SingleModifierList(),
      squarePhase2B1B2FixedAmountDiscount(),
      squarePhase2B1B2VariablePercentageDiscount(),
      squarePhase2B1B2VariableAmountDiscount(),
      squarePhase2B1B2InclusiveTax()
    ],
    related_objects: [squarePhase2B1B1Category()],
    included_resources: {
      objects: [
        squarePhase2B1B2FixedPercentageDiscount({
          id: "SQ2B1B2DISCINC001",
          discount_data: {
            name: "Included discount",
            discount_type: "FIXED_PERCENTAGE",
            percentage: "2.25"
          }
        })
      ]
    },
    cursor: SQUARE_PHASE_2B1B2_SYNTHETIC_CURSOR,
    latest_time: "2026-08-19T17:30:00.000Z",
    ...envelopeOverrides
  };
}

export function squarePhase2B1B2RetrieveEnvelope(
  object: Readonly<Record<string, unknown>> = squarePhase2B1B2ModifierList(),
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    object,
    related_objects: [
      squarePhase2B1B2FixedPercentageDiscount({
        id: "SQ2B1B2DISCREL001",
        discount_data: {
          name: "Related discount",
          discount_type: "FIXED_PERCENTAGE",
          percentage: "1.5"
        }
      })
    ],
    ...envelopeOverrides
  };
}

export function squarePhase2B1B2BatchEnvelope(
  envelopeOverrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    objects: [
      squarePhase2B1B2DeletedModifierList(),
      squarePhase2B1B2DeletedModifier(),
      squarePhase2B1B2DeletedDiscount(),
      squarePhase2B1B2DeletedTax()
    ],
    related_objects: [],
    included_resources: {
      objects: []
    },
    ...envelopeOverrides
  };
}

export const SQUARE_PHASE_2B1B2_CATALOG_FIXTURES = {
  listCatalog: squarePhase2B1B2ListEnvelope(),
  searchCatalog: squarePhase2B1B2SearchEnvelope(),
  retrieveCatalogObject: squarePhase2B1B2RetrieveEnvelope(),
  batchRetrieveCatalogObjects: squarePhase2B1B2BatchEnvelope(),
  excludedCanaries: squarePhase2B1B2ListEnvelope({
    objects: [
      squarePhase2B1B2ModifierList(
        {},
        {
          image_ids: [SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierListImageId],
          internal_name:
            SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierListInternalName,
          hidden_from_customer: true,
          is_conversational: true,
          description: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.description,
          ecom_uri: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.url,
          contact_email: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.contact,
          social: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.social
        }
      ),
      squarePhase2B1B2FixedPercentageDiscount(
        {},
        {
          pin_required: true,
          label_color: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.discountLabelColor,
          description: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.description,
          ecom_uri: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.url,
          address: {
            address_line_1: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.address
          },
          coordinates: {
            canary: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.coordinates
          }
        }
      ),
      squarePhase2B1B2Tax(
        {},
        {
          description: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.description,
          website_url: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.url,
          future_extra: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.futureField
        }
      )
    ]
  }),
  hostileExcludedFields: squarePhase2B1B2ListEnvelope({
    objects: [
      squarePhase2B1B2ModifierList(
        {},
        {
          internal_name: "<script>alert('discarded')</script>\nordinary note",
          modifiers: [
            squarePhase2B1B2Modifier(
              {},
              {
                kitchen_name: "https://example.test/discarded\nordinary",
                image_id: SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierImageId,
                hidden_online: true
              }
            )
          ]
        }
      )
    ]
  }),
  mixedProviderErrors: {
    errors: [
      {
        category: "AUTHENTICATION_ERROR",
        detail: "SQ2B1B2MOD001 synthetic detail"
      }
    ],
    objects: [squarePhase2B1B2ModifierList()]
  },
  malformedProviderErrors: {
    errors: "not-an-array",
    objects: [squarePhase2B1B2ModifierList()]
  },
  duplicateNestedModifiers: {
    objects: [
      squarePhase2B1B2ModifierList(
        {},
        {
          modifiers: [
            squarePhase2B1B2Modifier(),
            squarePhase2B1B2Modifier()
          ]
        }
      )
    ]
  },
  textModifierList: {
    objects: [
      squarePhase2B1B2ModifierList(
        {},
        {
          modifier_type: "TEXT",
          modifiers: null,
          max_length: 20,
          text_required: true
        }
      )
    ]
  },
  modifierWithLocationOverrides: {
    objects: [
      squarePhase2B1B2Modifier(
        {},
        {
          location_overrides: [
            {
              location_id: "SQ2B1B2LOC001",
              price_money: { amount: 125, currency: "USD" }
            }
          ]
        }
      )
    ]
  },
  modifierWithChildLists: {
    objects: [
      squarePhase2B1B2Modifier(
        {},
        {
          child_modifier_list_ids: ["SQ2B1B2MODLISTCHILD001"]
        }
      )
    ]
  },
  taxWithProductSet: {
    objects: [
      squarePhase2B1B2Tax(
        {},
        {
          applies_to_product_set_id:
            SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.taxProductSet
        }
      )
    ]
  }
} as const;
