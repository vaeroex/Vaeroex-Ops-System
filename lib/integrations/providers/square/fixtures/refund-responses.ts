import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import type { SquareRefundResponseOperation } from "@/lib/integrations/providers/square/refund-responses";

export const SQUARE_REFUND_SYNTHETIC_CANARIES = Object.freeze({
  reason: "sqrefund-private-reason-7f31",
  teamMember: "sqrefund-private-team-member-6a82",
  contact: "sqrefund-private-contact@example.invalid",
  destination: "sqrefund-private-destination-42bd",
  recipient: "sqrefund-private-recipient-9081",
  metadata: "sqrefund-private-metadata-645e"
});

export function squareRefundFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "REFUND_SYNTHETIC_1", location_id: "LOC_SYNTHETIC_1",
    payment_id: "PAY_SYNTHETIC_1", order_id: "ORDER_SYNTHETIC_1", unlinked: false,
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:01:00Z",
    status: "COMPLETED", destination_type: "CARD",
    amount_money: { amount: 100, currency: "USD" },
    processing_fee: [
      { effective_at: "2026-09-01T12:02:00Z", type: "INITIAL", amount_money: { amount: -35, currency: "USD" } },
      { effective_at: "2026-09-01T12:03:00Z", type: "ADJUSTMENT", amount_money: { amount: 5, currency: "USD" } }
    ],
    ...overrides
  };
}

export function squareRefundParserInput(
  response: unknown,
  operation: SquareRefundResponseOperation = "retrieve_payment_refund",
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
    requestContext: operation === "retrieve_payment_refund"
      ? { refundId: "REFUND_SYNTHETIC_1", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"] }
      : { locationId: "LOC_SYNTHETIC_1", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"], query: { location_id: "LOC_SYNTHETIC_1", limit: "100" } },
    response, ...overrides
  };
}

export function squareRefundMaximumListEnvelope() {
  const refunds = Array.from({ length: 100 }, (_, index) => ({
    id: `REFUND_${index}`, amount_money: {}, payment_id: "PAY_REF", order_id: "ORDER_REF"
  } as Record<string, unknown>));
  let remaining = 9_744;
  for (let index = 0; remaining > 0; index += 1) {
    const length = Math.min(remaining, 1_000);
    refunds[index].processing_fee = Array.from({ length }, () => ({ amount_money: {} }));
    remaining -= length;
  }
  return { refunds };
}

export function squareRefundMaximumGetEnvelope() {
  const refund = {
    id: "REFUND_SYNTHETIC_1", amount_money: {}, payment_id: "PAY_REF", order_id: "ORDER_REF",
    processing_fee: Array.from({ length: 1_000 }, () => ({ amount_money: {} }))
  };
  // The projection maximum needs 2,007 raw values. One outer array, 18 inner
  // arrays and 17,974 discarded scalars bring this valid envelope to 20,000.
  const excluded: number[][] = [];
  let remaining = 17_974;
  while (remaining > 0) {
    const length = Math.min(remaining, 1_000);
    excluded.push(Array.from({ length }, () => 0));
    remaining -= length;
  }
  return { refund, future_provider_field: excluded };
}
