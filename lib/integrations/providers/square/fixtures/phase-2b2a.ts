import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import type { SquareOrderResponseOperation } from "@/lib/integrations/providers/square/order-responses";

export const SQUARE_PHASE_2B2A_SYNTHETIC_CONNECTION_ID =
  "00000000-0000-4000-8000-000000002b2a" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_MERCHANT_ID =
  "SQ2B2AMERCHANT001" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID =
  "SQ2B2AORDER001" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID =
  "SQ2B2AORDER002" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID =
  "SQ2B2ALOC001" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID =
  "SQ2B2ALOC002" as const;
export const SQUARE_PHASE_2B2A_SYNTHETIC_CURSOR =
  "sq2b2aOrderCursor001==" as const;

export const SQUARE_PHASE_2B2A_SYNTHETIC_CANARIES = Object.freeze({
  customerId: "SQ2B2ACUSTOMER001",
  referenceId: "sq2b2a-reference-canary",
  ticketName: "sq2b2a-ticket-canary",
  metadata: "sq2b2a-metadata-canary",
  sourceName: "sq2b2a-source-canary",
  note: "sq2b2a-note-canary",
  lineItem: "sq2b2a-line-item-canary",
  tax: "sq2b2a-tax-canary",
  discount: "sq2b2a-discount-canary",
  serviceCharge: "sq2b2a-service-charge-canary",
  fulfillment: "sq2b2a-fulfillment-canary",
  recipient: "sq2b2a-recipient-canary",
  address: "2 Synthetic Order Way",
  returnDetail: "sq2b2a-return-canary",
  tender: "sq2b2a-tender-canary",
  refund: "sq2b2a-refund-canary",
  reward: "sq2b2a-reward-canary",
  payment: "SQ2B2APAYMENT001",
  url: "https://example.test/sq2b2a-order-canary",
  futureField: "sq2b2a-future-field-canary"
});

export type SquarePhase2B2AParserInputOverrides = Readonly<{
  providerKey?: unknown;
  providerEnvironment?: unknown;
  apiVersion?: unknown;
  connectionAuthority?: unknown;
  requestContext?: unknown;
}>;

export function squarePhase2B2AParserInput(
  response: unknown,
  operation: SquareOrderResponseOperation = "retrieve_order",
  overrides: SquarePhase2B2AParserInputOverrides = {}
) {
  return {
    providerKey: "square",
    providerEnvironment: "sandbox",
    apiVersion: SQUARE_API_VERSION,
    operation,
    connectionAuthority: squarePhase2B2AConnectionAuthority(),
    requestContext: squarePhase2B2ARequestContext(operation),
    response,
    ...overrides
  };
}

export function squarePhase2B2AConnectionAuthority(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    connectionId: SQUARE_PHASE_2B2A_SYNTHETIC_CONNECTION_ID,
    providerEntityType: "merchant",
    providerEntityId: SQUARE_PHASE_2B2A_SYNTHETIC_MERCHANT_ID,
    ...overrides
  };
}

export function squarePhase2B2ARequestContext(
  operation: SquareOrderResponseOperation,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const authorizedLocationIds = [
    SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
    SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID
  ];
  if (operation === "retrieve_order") {
    return {
      orderId: SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
      authorizedLocationIds,
      ...overrides
    };
  }
  if (operation === "orders_batch_retrieve") {
    return {
      orderIds: [
        SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
        SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID
      ],
      locationId: null,
      authorizedLocationIds,
      ...overrides
    };
  }
  return {
    locationIds: authorizedLocationIds,
    states: null,
    returnEntries: false,
    authorizedLocationIds,
    ...overrides
  };
}

export function squarePhase2B2AOrder(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    id: SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
    location_id: SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
    state: "COMPLETED",
    version: 17,
    created_at: "2026-08-19T09:10:11.123456-07:00",
    updated_at: "2026-08-19T16:20:21.987654Z",
    closed_at: "2026-08-19T09:20:21.987654-07:00",
    total_money: { amount: 1_234, currency: "USD" },
    total_tax_money: { amount: 84, currency: "USD" },
    total_discount_money: { amount: 100, currency: "USD" },
    total_tip_money: { amount: 150, currency: "USD" },
    total_service_charge_money: { amount: 50, currency: "USD" },
    net_amount_due_money: { amount: 0, currency: "USD" },
    ...squarePhase2B2ADiscardedDetails(),
    ...overrides
  };
}

export function squarePhase2B2ASecondOrder(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2AOrder({
    id: SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID,
    location_id: SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID,
    state: "CANCELED",
    version: 3,
    created_at: "2026-08-18T21:00:00Z",
    updated_at: "2026-08-18T21:15:00.5Z",
    closed_at: "2026-08-18T21:15:00.5Z",
    total_money: { amount: -500, currency: "CAD" },
    total_tax_money: { amount: 0, currency: "CAD" },
    total_discount_money: { amount: -25, currency: "CAD" },
    total_tip_money: null,
    total_service_charge_money: { amount: 0, currency: "CAD" },
    net_amount_due_money: { amount: -475, currency: "CAD" },
    ...overrides
  });
}

export function squarePhase2B2ADiscardedDetails(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const canary = SQUARE_PHASE_2B2A_SYNTHETIC_CANARIES;
  return {
    customer_id: canary.customerId,
    reference_id: canary.referenceId,
    ticket_name: canary.ticketName,
    metadata: { synthetic: canary.metadata },
    source: { name: canary.sourceName },
    line_items: [
      {
        uid: "SQ2B2ALINE001",
        name: canary.lineItem,
        quantity: "1",
        note: canary.note
      }
    ],
    taxes: [{ uid: "SQ2B2ATAX001", name: canary.tax }],
    discounts: [{ uid: "SQ2B2ADISCOUNT001", name: canary.discount }],
    service_charges: [
      { uid: "SQ2B2ASERVICE001", name: canary.serviceCharge }
    ],
    fulfillments: [
      {
        uid: "SQ2B2AFULFILL001",
        type: "SHIPMENT",
        shipment_details: {
          recipient: {
            display_name: canary.recipient,
            address: { address_line_1: canary.address }
          }
        }
      }
    ],
    returns: [{ uid: "SQ2B2ARETURN001", source_order_id: canary.returnDetail }],
    tenders: [{ id: "SQ2B2ATENDER001", note: canary.tender }],
    refunds: [{ id: "SQ2B2AREFUND001", reason: canary.refund }],
    rewards: [{ id: "SQ2B2AREWARD001", reward_tier_name: canary.reward }],
    pricing_options: { auto_apply_discounts: true },
    rounding_adjustment: {
      uid: "SQ2B2AROUND001",
      name: "Synthetic rounding",
      amount_money: { amount: 0, currency: "USD" }
    },
    payment_ids: [canary.payment],
    future_url: canary.url,
    future_field: canary.futureField,
    ...overrides
  };
}

export const SQUARE_PHASE_2B2A_ORDER_FIXTURES = Object.freeze({
  retrieve: Object.freeze({ order: squarePhase2B2AOrder() }),
  batch: Object.freeze({
    orders: [squarePhase2B2ASecondOrder(), squarePhase2B2AOrder()]
  }),
  search: Object.freeze({
    orders: [squarePhase2B2ASecondOrder(), squarePhase2B2AOrder()],
    cursor: SQUARE_PHASE_2B2A_SYNTHETIC_CURSOR
  }),
  emptyBatch: Object.freeze({ orders: [] }),
  emptySearch: Object.freeze({ orders: [] }),
  nullableRetrieve: Object.freeze({ order: null, errors: null }),
  nullableBatch: Object.freeze({ orders: null, errors: null }),
  nullableSearch: Object.freeze({
    orders: null,
    order_entries: null,
    cursor: null,
    errors: null
  })
});
