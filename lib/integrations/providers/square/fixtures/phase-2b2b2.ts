import type { SquareOrderResponseOperation } from "@/lib/integrations/providers/square/order-responses";
import {
  squarePhase2B2B1AdHocLineItem,
  squarePhase2B2B1CatalogLineItem,
  squarePhase2B2B1Order,
  squarePhase2B2B1ParserInput,
  squarePhase2B2B1SecondOrder
} from "@/lib/integrations/providers/square/fixtures/phase-2b2b1";
import type { SquarePhase2B2AParserInputOverrides } from "@/lib/integrations/providers/square/fixtures/phase-2b2a";

export const SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS = Object.freeze({
  order: "SQ2B2B2TAXORDER",
  line: "SQ2B2B2TAXLINE",
  other: "SQ2B2B2TAXOTHER",
  secondOrder: "SQ2B2B2TAXCAD"
} as const);

export const SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS = Object.freeze({
  orderPercentage: "SQ2B2B2DISCORDERP",
  lineAmount: "SQ2B2B2DISCLINEA",
  catalogPercentage: "SQ2B2B2DISCCATP",
  catalogAmount: "SQ2B2B2DISCCATA"
} as const);

export const SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS = Object.freeze({
  subtotal: "SQ2B2B2SCSUBTOTAL",
  total: "SQ2B2B2SCTOTAL",
  apportionedPercentage: "SQ2B2B2SCAPPPCT",
  apportionedAmount: "SQ2B2B2SCAPPAMT"
} as const);

export const SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES = Object.freeze({
  taxMetadata: "sq2b2b2-tax-metadata-canary",
  discountMetadata: "sq2b2b2-discount-metadata-canary",
  serviceChargeMetadata: "sq2b2b2-service-charge-metadata-canary",
  rewardId: "sq2b2b2-reward-canary",
  pricingRuleId: "sq2b2b2-pricing-rule-canary",
  providerText: "sq2b2b2-provider-text-canary",
  providerKey: "sq2b2b2-provider-key-canary"
} as const);

export function squarePhase2B2B2ParserInput(
  response: unknown,
  operation: SquareOrderResponseOperation = "retrieve_order",
  overrides: SquarePhase2B2AParserInputOverrides = {}
) {
  return squarePhase2B2B1ParserInput(response, operation, overrides);
}

export function squarePhase2B2B2Tax(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order,
    catalog_object_id: "SQ2B2B2CATTAX001",
    catalog_version: 1_724_952_893_881,
    name: "Synthetic order tax",
    type: "ADDITIVE",
    percentage: "8.2500",
    applied_money: { amount: 44, currency: "USD" },
    scope: "ORDER",
    auto_applied: true,
    metadata: { synthetic: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.taxMetadata },
    future_field: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.providerText,
    ...overrides
  };
}

export function squarePhase2B2B2Discount(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    uid: SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.orderPercentage,
    name: "Synthetic order percentage discount",
    type: "FIXED_PERCENTAGE",
    percentage: "12.500",
    applied_money: { amount: -50, currency: "USD" },
    scope: "ORDER",
    metadata: {
      synthetic: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.discountMetadata
    },
    reward_ids: [SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.rewardId],
    pricing_rule_id: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.pricingRuleId,
    future_field: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.providerText,
    ...overrides
  };
}

export function squarePhase2B2B2ServiceCharge(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    uid: SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.subtotal,
    name: "Synthetic subtotal service charge",
    catalog_object_id: "SQ2B2B2CATSVC001",
    catalog_version: 1_724_952_893_882,
    percentage: "1.5000",
    applied_money: { amount: 20, currency: "USD" },
    total_money: { amount: 22, currency: "USD" },
    total_tax_money: { amount: 2, currency: "USD" },
    calculation_phase: "SUBTOTAL_PHASE",
    taxable: true,
    type: "CUSTOM",
    treatment_type: "LINE_ITEM_TREATMENT",
    scope: "ORDER",
    applied_taxes: [
      {
        uid: "SQ2B2B2SCTAXAPP001",
        tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.line,
        applied_money: { amount: 2, currency: "USD" },
        auto_applied: false
      }
    ],
    metadata: {
      synthetic: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.serviceChargeMetadata
    },
    future_field: SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES.providerText,
    ...overrides
  };
}

function primaryTaxes() {
  return [
    squarePhase2B2B2Tax(),
    squarePhase2B2B2Tax({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.line,
      catalog_object_id: null,
      catalog_version: null,
      name: "Synthetic inclusive line tax",
      type: "INCLUSIVE",
      percentage: "-0.1250",
      applied_money: { amount: -1, currency: "USD" },
      scope: "LINE_ITEM",
      auto_applied: false
    }),
    squarePhase2B2B2Tax({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.other,
      catalog_object_id: null,
      catalog_version: null,
      name: null,
      type: "UNKNOWN_TAX",
      percentage: "0.00000001",
      applied_money: {},
      scope: "OTHER_TAX_SCOPE",
      auto_applied: null
    })
  ];
}

function primaryDiscounts() {
  return [
    squarePhase2B2B2Discount(),
    squarePhase2B2B2Discount({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.lineAmount,
      name: "Synthetic line amount discount",
      type: "FIXED_AMOUNT",
      percentage: null,
      amount_money: { amount: -25, currency: "USD" },
      applied_money: { amount: -25, currency: "USD" },
      scope: "LINE_ITEM"
    }),
    squarePhase2B2B2Discount({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.catalogPercentage,
      catalog_object_id: "SQ2B2B2CATDISC001",
      catalog_version: 1_724_952_893_883,
      name: "Synthetic catalog variable percentage discount",
      type: "VARIABLE_PERCENTAGE",
      percentage: "2.7500",
      amount_money: null,
      applied_money: { amount: -11, currency: "USD" },
      scope: "OTHER_DISCOUNT_SCOPE"
    }),
    squarePhase2B2B2Discount({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.catalogAmount,
      catalog_object_id: "SQ2B2B2CATDISC002",
      catalog_version: 1_724_952_893_884,
      name: "Synthetic catalog variable amount discount",
      type: "VARIABLE_AMOUNT",
      percentage: null,
      amount_money: { amount: -9, currency: "USD" },
      applied_money: { amount: -9, currency: "USD" },
      scope: "ORDER"
    })
  ];
}

function primaryServiceCharges() {
  return [
    squarePhase2B2B2ServiceCharge(),
    squarePhase2B2B2ServiceCharge({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.total,
      name: null,
      catalog_object_id: null,
      catalog_version: null,
      percentage: null,
      amount_money: { amount: -3, currency: "USD" },
      applied_money: { amount: -3, currency: "USD" },
      total_money: { amount: -3, currency: "USD" },
      total_tax_money: {},
      calculation_phase: "TOTAL_PHASE",
      taxable: false,
      applied_taxes: null,
      type: "AUTO_GRATUITY",
      treatment_type: "LINE_ITEM_TREATMENT",
      scope: "ORDER"
    }),
    squarePhase2B2B2ServiceCharge({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS
        .apportionedPercentage,
      catalog_object_id: null,
      catalog_version: null,
      name: "Synthetic apportioned percentage charge",
      percentage: "3.1250",
      amount_money: null,
      applied_money: { amount: 15, currency: "USD" },
      total_money: { amount: 15, currency: "USD" },
      total_tax_money: null,
      calculation_phase: "APPORTIONED_PERCENTAGE_PHASE",
      taxable: true,
      applied_taxes: [],
      type: "CUSTOM",
      treatment_type: "APPORTIONED_TREATMENT",
      scope: "LINE_ITEM"
    }),
    squarePhase2B2B2ServiceCharge({
      uid: SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.apportionedAmount,
      catalog_object_id: null,
      catalog_version: null,
      name: "Synthetic apportioned amount charge",
      percentage: null,
      amount_money: { amount: 7, currency: "USD" },
      applied_money: { amount: 7, currency: "USD" },
      total_money: { amount: 7, currency: "USD" },
      total_tax_money: { amount: 0, currency: "USD" },
      calculation_phase: "APPORTIONED_AMOUNT_PHASE",
      taxable: null,
      applied_taxes: [
        {
          uid: "SQ2B2B2SCTAXAPP002",
          tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.other,
          applied_money: { amount: 0, currency: "USD" },
          auto_applied: null
        }
      ],
      type: "CUSTOM",
      treatment_type: "APPORTIONED_TREATMENT",
      scope: "OTHER_SERVICE_CHARGE_SCOPE"
    })
  ];
}

function primaryLineItems() {
  return [
    squarePhase2B2B1CatalogLineItem({
      applied_taxes: [
        {
          uid: "SQ2B2B2LTAXAPP001",
          tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order,
          applied_money: { amount: 44, currency: "USD" },
          auto_applied: true
        },
        {
          uid: "SQ2B2B2LTAXAPP002",
          tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.line,
          applied_money: { amount: -1, currency: "USD" },
          auto_applied: false
        }
      ],
      applied_discounts: [
        {
          uid: "SQ2B2B2LDISCAPP001",
          discount_uid:
            SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.orderPercentage,
          applied_money: { amount: -35, currency: "USD" }
        },
        {
          uid: null,
          discount_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.lineAmount,
          applied_money: { amount: -25, currency: "USD" }
        }
      ],
      applied_service_charges: [
        {
          uid: "SQ2B2B2LSVCAPP001",
          service_charge_uid:
            SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.subtotal,
          applied_money: { amount: 20, currency: "USD" }
        },
        {
          uid: "SQ2B2B2LSVCAPP002",
          service_charge_uid:
            SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS
              .apportionedPercentage,
          applied_money: { amount: 10, currency: "USD" }
        }
      ]
    }),
    squarePhase2B2B1AdHocLineItem({
      applied_taxes: [
        {
          uid: "SQ2B2B2LTAXAPP003",
          tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.other,
          applied_money: {}
        }
      ],
      applied_discounts: [
        {
          uid: "SQ2B2B2LDISCAPP002",
          discount_uid:
            SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.catalogPercentage,
          applied_money: { amount: -11, currency: "USD" }
        }
      ],
      applied_service_charges: [
        {
          uid: "SQ2B2B2LSVCAPP003",
          service_charge_uid:
            SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.apportionedAmount,
          applied_money: { amount: 7, currency: "USD" }
        }
      ]
    })
  ];
}

export function squarePhase2B2B2Order(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2B1Order({
    line_items: primaryLineItems(),
    taxes: primaryTaxes(),
    discounts: primaryDiscounts(),
    service_charges: primaryServiceCharges(),
    ...overrides
  });
}

export function squarePhase2B2B2SecondOrder(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const base = squarePhase2B2B1SecondOrder();
  const lineItems = (base.line_items as Readonly<Record<string, unknown>>[]).map(
    (lineItem) => ({
      ...lineItem,
      applied_taxes: [
        {
          uid: "SQ2B2B2CADTAXAPP001",
          tax_uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.secondOrder,
          applied_money: { amount: 0, currency: "CAD" }
        }
      ],
      applied_discounts: [],
      applied_service_charges: []
    })
  );
  return {
    ...base,
    line_items: lineItems,
    taxes: [
      squarePhase2B2B2Tax({
        uid: SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.secondOrder,
        catalog_object_id: null,
        catalog_version: null,
        name: "Synthetic Canadian tax",
        type: "ADDITIVE",
        percentage: "0",
        applied_money: { amount: 0, currency: "CAD" },
        scope: "ORDER",
        auto_applied: false
      })
    ],
    discounts: [],
    service_charges: [],
    ...overrides
  };
}

function emptyAdjustmentOrder(value: null | readonly unknown[]) {
  return squarePhase2B2B1Order({
    line_items: [
      squarePhase2B2B1CatalogLineItem({
        applied_taxes: value,
        applied_discounts: value,
        applied_service_charges: value
      })
    ],
    taxes: value,
    discounts: value,
    service_charges: value
  });
}

function missingAdjustmentOrder() {
  const order: Record<string, unknown> = {
    ...emptyAdjustmentOrder([])
  };
  delete order.taxes;
  delete order.discounts;
  delete order.service_charges;
  const lineItems = order.line_items as Record<string, unknown>[];
  for (const lineItem of lineItems) {
    delete lineItem.applied_taxes;
    delete lineItem.applied_discounts;
    delete lineItem.applied_service_charges;
  }
  return order;
}

export const SQUARE_PHASE_2B2B2_ORDER_FIXTURES = Object.freeze({
  retrieve: Object.freeze({ order: squarePhase2B2B2Order() }),
  batch: Object.freeze({
    orders: [squarePhase2B2B2SecondOrder(), squarePhase2B2B2Order()]
  }),
  search: Object.freeze({
    orders: [squarePhase2B2B2SecondOrder(), squarePhase2B2B2Order()],
    cursor: "sq2b2b2OrderCursor001=="
  }),
  emptyCollections: Object.freeze({ order: emptyAdjustmentOrder([]) }),
  nullCollections: Object.freeze({ order: emptyAdjustmentOrder(null) }),
  missingCollections: Object.freeze({ order: missingAdjustmentOrder() })
});
