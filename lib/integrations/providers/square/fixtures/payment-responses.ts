import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import type { SquarePaymentResponseOperation } from "@/lib/integrations/providers/square/payment-responses";

export const SQUARE_PAYMENT_SYNTHETIC_CANARIES = Object.freeze({
  customer: "sqpay-private-customer-7f31",
  employee: "sqpay-private-employee-6a82",
  contact: "sqpay-private-contact@example.invalid",
  instrument: "sqpay-private-instrument-42bd",
  receipt: "https://example.invalid/sqpay-private-receipt",
  note: "sqpay-private-free-text-9081",
  metadata: "sqpay-private-metadata-645e"
});

export function squarePaymentFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "PAY_SYNTHETIC_1", location_id: "LOC_SYNTHETIC_1", order_id: "ORDER_SYNTHETIC_1",
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:01:00Z",
    status: "COMPLETED", source_type: "CARD",
    amount_money: { amount: 1_000, currency: "USD" },
    tip_money: { amount: 200, currency: "USD" },
    total_money: { amount: 1_200, currency: "USD" },
    refunded_money: { amount: 100, currency: "USD" },
    processing_fee: [
      { effective_at: "2026-09-01T12:02:00Z", type: "INITIAL", amount_money: { amount: 35, currency: "USD" } },
      { effective_at: "2026-09-01T12:03:00Z", type: "ADJUSTMENT", amount_money: { amount: -5, currency: "USD" } }
    ],
    ...overrides
  };
}

export function squarePaymentParserInput(
  response: unknown,
  operation: SquarePaymentResponseOperation = "retrieve_payment",
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return {
    providerKey: "square", providerEnvironment: "sandbox", apiVersion: SQUARE_API_VERSION,
    operation,
    connectionAuthority: {
      workspaceId: "10000000-0000-4000-8000-000000000001",
      connectionId: "20000000-0000-4000-8000-000000000001",
      providerEntityType: "merchant", providerEntityId: "MERCHANT_SYNTHETIC_1"
    },
    requestContext: operation === "retrieve_payment"
      ? { paymentId: "PAY_SYNTHETIC_1", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"] }
      : { locationId: "LOC_SYNTHETIC_1", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"], query: { location_id: "LOC_SYNTHETIC_1", limit: "100" } },
    response, ...overrides
  };
}

export function squarePaymentMaximumListEnvelope() {
  const payments = Array.from({ length: 100 }, () => ({
    amount_money: {}, tip_money: {}, total_money: {}, refunded_money: {}, order_id: "ORDER_REF"
  } as Record<string, unknown>));
  let remaining = 9_694;
  for (let index = 0; remaining > 0; index += 1) {
    const length = Math.min(remaining, 1_000);
    payments[index].processing_fee = Array.from({ length }, () => ({ amount_money: {} }));
    remaining -= length;
  }
  return { payments };
}

export function squarePaymentMaximumGetEnvelope() {
  const payment = {
    id: "PAY_SYNTHETIC_1", order_id: "ORDER_REF",
    amount_money: {}, tip_money: {}, total_money: {}, refunded_money: {},
    processing_fee: Array.from({ length: 1_000 }, () => ({ amount_money: {} }))
  };
  // Projection maximum uses 2,009 raw values. Fill the remaining 17,991 with
  // discarded values: one outer array, 18 inner arrays, and 17,972 scalars.
  const excluded: number[][] = [];
  let remaining = 17_972;
  while (remaining > 0) {
    const length = Math.min(remaining, 1_000);
    excluded.push(Array.from({ length }, () => 0));
    remaining -= length;
  }
  return { payment, future_provider_field: excluded };
}
