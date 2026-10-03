import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import type { SquareInventoryResponseOperation } from "@/lib/integrations/providers/square/inventory-responses";

export const SQUARE_INVENTORY_SYNTHETIC_CANARIES = Object.freeze([
  "sqinventory-private-team-913d", "sqinventory-private-reference-a937",
  "sqinventory-private-source-219b", "sqinventory-contact@example.invalid"
]);
export function squareInventoryCountFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    catalog_object_id: "CATALOG_SYNTHETIC_1", catalog_object_type: "ITEM_VARIATION",
    state: "IN_STOCK", location_id: "LOC_SYNTHETIC_1", quantity: "0012.34000",
    calculated_at: "2026-09-01T12:00:00Z", is_estimated: false, ...overrides
  };
}
export function squareInventoryAdjustmentFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "ADJUSTMENT_SYNTHETIC_1", catalog_object_id: "CATALOG_SYNTHETIC_1", catalog_object_type: "ITEM_VARIATION",
    from_state: "IN_STOCK", to_state: "SOLD", from_location_id: "LOC_SYNTHETIC_1", to_location_id: "LOC_SYNTHETIC_1",
    quantity: "1.25000", total_price_money: { amount: 999, currency: "USD" }, cost_money: {},
    occurred_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:00:01Z",
    transaction_id: "LEGACY_TRANSACTION_1", refund_id: "LEGACY_REFUND_1",
    purchase_order_id: "PURCHASE_ORDER_1", goods_receipt_id: "GOODS_RECEIPT_1", physical_count_id: "PHYSICAL_1",
    adjustment_group: { id: "GROUP_1", root_adjustment_id: "ROOT_ADJUSTMENT_1", from_state: "NONE", to_state: "IN_STOCK" },
    reason_id: { type: "CUSTOM", custom_reason_id: "REASON_1" }, ...overrides
  };
}
export function squareInventoryPhysicalCountFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "PHYSICAL_SYNTHETIC_1", catalog_object_id: "CATALOG_SYNTHETIC_1", catalog_object_type: "ITEM_VARIATION",
    state: "IN_STOCK", location_id: "LOC_SYNTHETIC_1", quantity: "12.34000",
    occurred_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:00:01Z", adjustment_id: "ADJUSTMENT_1", ...overrides
  };
}
export function squareInventoryChangeFixture(type: "ADJUSTMENT" | "PHYSICAL_COUNT" = "ADJUSTMENT") {
  return {
    type, ...(type === "ADJUSTMENT" ? { adjustment: squareInventoryAdjustmentFixture() } : { physical_count: squareInventoryPhysicalCountFixture() }),
    measurement_unit_id: "UNIT_1",
    measurement_unit: { precision: 5, measurement_unit: { type: "TYPE_CUSTOM", custom_unit: { name: "case", abbreviation: "cs" } } }
  };
}
export function squareInventoryParserInput(
  response: unknown, operation: SquareInventoryResponseOperation = "retrieve_inventory_adjustment",
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const authorizedLocationIds = ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2"];
  return {
    providerKey: "square", providerEnvironment: "sandbox", apiVersion: SQUARE_API_VERSION, operation,
    connectionAuthority: {
      workspaceId: "10000000-0000-4000-8000-000000000001",
      connectionId: "20000000-0000-4000-8000-000000000001", providerEntityType: "merchant", providerEntityId: "MERCHANT_SYNTHETIC_1"
    },
    requestContext: operation.startsWith("inventory_")
      ? { authorizedLocationIds, body: { limit: 1000 } }
      : operation === "retrieve_inventory_count"
        ? { authorizedLocationIds, catalogObjectId: "CATALOG_SYNTHETIC_1", query: {} }
        : { authorizedLocationIds, id: operation === "retrieve_inventory_adjustment" ? "ADJUSTMENT_SYNTHETIC_1" : "PHYSICAL_SYNTHETIC_1" },
    response, ...overrides
  };
}

// Deterministic productive allocation, not a claim that the conservative guard
// cap is attainable under the independent raw budget. Every record starts with
// all 1:1 productive references/Money/group branches and CUSTOM reason. Upgrade
// measurement branches only while their expanded raw cost fits. No alias discount.
export function squareInventoryProductiveChangesEnvelope(mixed = false) {
  const changes: Record<string, unknown>[] = Array.from({ length: 1000 }, (_, index) => {
    const physical = mixed && index % 2 === 0;
    const detail = physical
      ? { id: "PHYSICAL_" + index, catalog_object_id: "CATALOG", adjustment_id: "ADJUSTMENT" }
      : {
        id: "ADJUSTMENT_" + index, catalog_object_id: "CATALOG", transaction_id: "TRANSACTION", refund_id: "REFUND",
        purchase_order_id: "PURCHASE", goods_receipt_id: "GOODS", physical_count_id: "PHYSICAL",
        total_price_money: {}, cost_money: {}, adjustment_group: { root_adjustment_id: "ROOT" },
        reason_id: { type: "CUSTOM", custom_reason_id: "REASON" }
      };
    return {
      type: physical ? "PHYSICAL_COUNT" : "ADJUSTMENT",
      [physical ? "physical_count" : "adjustment"]: detail,
      measurement_unit: {}, measurement_unit_id: "UNIT"
    };
  });
  const envelope = { changes };
  let remaining = 20_000 - squareInventoryFixtureValueCount(envelope);
  for (const change of changes) {
    if (remaining < 2) break;
    if (remaining >= 4) {
      change.measurement_unit = { measurement_unit: { custom_unit: { name: "case", abbreviation: "cs" } } };
      remaining -= 4;
    } else {
      change.measurement_unit = { measurement_unit: { generic_unit: "UNIT" } };
      remaining -= 2;
    }
  }
  return squareInventoryPadRawBoundary(envelope);
}
export function squareInventoryFixtureValueCount(value: unknown): number {
  if (value === null || typeof value !== "object") return 1;
  return 1 + Object.values(value).reduce<number>((sum, child) => sum + squareInventoryFixtureValueCount(child), 0);
}
export function squareInventoryPadRawBoundary<T extends Record<string, unknown>>(source: T): T & Record<string, unknown> {
  const envelope: T & Record<string, unknown> = { ...source };
  let remaining = 20_000 - squareInventoryFixtureValueCount(envelope);
  if (remaining < 0) throw new Error("fixture exceeds raw budget");
  if (remaining === 0) return envelope;
  if (remaining === 1) return { ...envelope, excluded_provider_field: null };
  const padding: unknown[] = [];
  remaining -= 1;
  while (remaining > 0) {
    if (remaining === 1) { padding.push(null); remaining--; }
    else {
      const length = Math.min(remaining - 1, 1_000);
      padding.push(Array.from({ length }, () => null));
      remaining -= length + 1;
    }
  }
  return { ...envelope, excluded_provider_field: padding };
}
