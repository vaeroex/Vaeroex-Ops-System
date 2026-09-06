import type { SquareOrderResponseOperation } from "@/lib/integrations/providers/square/order-responses";
import {
  squarePhase2B2AOrder,
  squarePhase2B2AParserInput,
  squarePhase2B2ASecondOrder,
  type SquarePhase2B2AParserInputOverrides
} from "@/lib/integrations/providers/square/fixtures/phase-2b2a";

export const SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID =
  "SQ2B2B1LINE001" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_SECOND_LINE_ITEM_ID =
  "SQ2B2B1LINE002" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID =
  "SQ2B2B1MOD001" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_CHILD_MODIFIER_ID =
  "SQ2B2B1MOD002" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_GRANDCHILD_MODIFIER_ID =
  "SQ2B2B1MOD003" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_LINE_ITEM_ID =
  "SQ2B2B1CATVAR001" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_MODIFIER_ID =
  "SQ2B2B1CATMOD001" as const;
export const SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_MEASUREMENT_ID =
  "SQ2B2B1CATUNIT001" as const;

export const SQUARE_PHASE_2B2B1_SYNTHETIC_CANARIES = Object.freeze({
  note: "sq2b2b1-line-note-canary",
  metadata: "sq2b2b1-metadata-canary",
  appliedTax: "sq2b2b1-applied-tax-canary",
  appliedDiscount: "sq2b2b1-applied-discount-canary",
  appliedServiceCharge: "sq2b2b1-applied-service-charge-canary",
  pricingBlocklist: "sq2b2b1-pricing-blocklist-canary",
  modifierMetadata: "sq2b2b1-modifier-metadata-canary",
  futureUrl: "https://example.test/sq2b2b1-future-canary",
  futureCustomer: "SQ2B2B1CUSTOMER001",
  futureText: "sq2b2b1-future-provider-text-canary"
});

export function squarePhase2B2B1ParserInput(
  response: unknown,
  operation: SquareOrderResponseOperation = "retrieve_order",
  overrides: SquarePhase2B2AParserInputOverrides = {}
) {
  return squarePhase2B2AParserInput(response, operation, overrides);
}

export function squarePhase2B2B1CatalogLineItem(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const canary = SQUARE_PHASE_2B2B1_SYNTHETIC_CANARIES;
  return {
    uid: SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID,
    catalog_object_id: SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_LINE_ITEM_ID,
    catalog_version: 1_724_952_893_872,
    name: "Synthetic weighed produce",
    variation_name: "Bulk",
    item_type: "ITEM",
    quantity: "1.250",
    quantity_unit: {
      measurement_unit: {
        weight_unit: "METRIC_KILOGRAM",
        type: "TYPE_WEIGHT"
      },
      precision: 3,
      catalog_object_id:
        SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_MEASUREMENT_ID,
      catalog_version: 1_724_952_893_870
    },
    modifiers: [
      {
        uid: SQUARE_PHASE_2B2B1_SYNTHETIC_GRANDCHILD_MODIFIER_ID,
        catalog_object_id: SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_MODIFIER_ID,
        catalog_version: 1_724_952_893_873,
        name: "Synthetic nested override",
        quantity: "0",
        base_price_money: { amount: -5, currency: "USD" },
        total_price_money: { amount: 0, currency: "USD" },
        parent_modifier_uid:
          SQUARE_PHASE_2B2B1_SYNTHETIC_CHILD_MODIFIER_ID,
        metadata: { secret: canary.modifierMetadata }
      },
      {
        uid: SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID,
        catalog_object_id: SQUARE_PHASE_2B2B1_SYNTHETIC_CATALOG_MODIFIER_ID,
        catalog_version: 1_724_952_893_871,
        name: "Synthetic catalog modifier",
        quantity: "1",
        total_price_money: { amount: 25, currency: "USD" }
      },
      {
        uid: SQUARE_PHASE_2B2B1_SYNTHETIC_CHILD_MODIFIER_ID,
        name: "Synthetic ad hoc child",
        quantity: "2",
        base_price_money: { amount: 10, currency: "USD" },
        total_price_money: { amount: 25, currency: "USD" },
        parent_modifier_uid: SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID
      }
    ],
    base_price_money: { amount: 400, currency: "USD" },
    variation_total_price_money: { amount: 500, currency: "USD" },
    gross_sales_money: { amount: 550, currency: "USD" },
    total_tax_money: { amount: 44, currency: "USD" },
    total_discount_money: { amount: -50, currency: "USD" },
    total_service_charge_money: { amount: 20, currency: "USD" },
    total_money: { amount: 564, currency: "USD" },
    note: canary.note,
    metadata: { secret: canary.metadata },
    applied_taxes: [{ tax_uid: canary.appliedTax }],
    applied_discounts: [{ discount_uid: canary.appliedDiscount }],
    applied_service_charges: [
      { service_charge_uid: canary.appliedServiceCharge }
    ],
    pricing_blocklists: { blocked_taxes: [canary.pricingBlocklist] },
    future_url: canary.futureUrl,
    future_customer_id: canary.futureCustomer,
    future_field: canary.futureText,
    ...overrides
  };
}

export function squarePhase2B2B1AdHocLineItem(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    uid: SQUARE_PHASE_2B2B1_SYNTHETIC_SECOND_LINE_ITEM_ID,
    name: "Synthetic ad hoc volume",
    variation_name: null,
    item_type: "CUSTOM_AMOUNT",
    quantity: ".50",
    quantity_unit: {
      measurement_unit: {
        custom_unit: { name: "Synthetic scoop", abbreviation: "scp" },
        type: "TYPE_CUSTOM"
      },
      precision: 2
    },
    modifiers: [
      {
        uid: "SQ2B2B1MOD004",
        name: "Synthetic zero-price ad hoc modifier",
        quantity: null,
        base_price_money: { amount: 0, currency: "USD" },
        total_price_money: { amount: 0, currency: "USD" }
      }
    ],
    base_price_money: {},
    variation_total_price_money: { amount: 500, currency: "USD" },
    gross_sales_money: { amount: 500, currency: "USD" },
    total_tax_money: { amount: 40, currency: "USD" },
    total_discount_money: { amount: 0, currency: "USD" },
    total_service_charge_money: null,
    total_money: { amount: 540, currency: "USD" },
    ...overrides
  };
}

export function squarePhase2B2B1Order(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2AOrder({
    line_items: [
      squarePhase2B2B1CatalogLineItem(),
      squarePhase2B2B1AdHocLineItem()
    ],
    ...overrides
  });
}

export function squarePhase2B2B1SecondOrder(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2ASecondOrder({
    line_items: [
      squarePhase2B2B1CatalogLineItem({
        uid: "SQ2B2B1LINE003",
        catalog_object_id: null,
        catalog_version: null,
        name: "Synthetic Canadian item",
        quantity: "2",
        quantity_unit: null,
        modifiers: [],
        base_price_money: { amount: 250, currency: "CAD" },
        variation_total_price_money: { amount: 500, currency: "CAD" },
        gross_sales_money: { amount: 500, currency: "CAD" },
        total_tax_money: { amount: 0, currency: "CAD" },
        total_discount_money: { amount: -25, currency: "CAD" },
        total_service_charge_money: { amount: 0, currency: "CAD" },
        total_money: { amount: -475, currency: "CAD" }
      })
    ],
    ...overrides
  });
}

function squarePhase2B2B1OrderWithoutLineItems() {
  const order: Record<string, unknown> = { ...squarePhase2B2AOrder() };
  delete order.line_items;
  return order;
}

export const SQUARE_PHASE_2B2B1_ORDER_FIXTURES = Object.freeze({
  retrieve: Object.freeze({ order: squarePhase2B2B1Order() }),
  batch: Object.freeze({
    orders: [squarePhase2B2B1SecondOrder(), squarePhase2B2B1Order()]
  }),
  search: Object.freeze({
    orders: [squarePhase2B2B1SecondOrder(), squarePhase2B2B1Order()],
    cursor: "sq2b2b1OrderCursor001=="
  }),
  emptyLineItems: Object.freeze({
    order: squarePhase2B2B1Order({ line_items: [] })
  }),
  missingLineItems: Object.freeze({
    order: squarePhase2B2B1OrderWithoutLineItems()
  }),
  nullLineItems: Object.freeze({
    order: squarePhase2B2B1Order({ line_items: null })
  })
});
