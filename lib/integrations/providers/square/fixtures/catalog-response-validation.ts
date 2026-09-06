import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import type { SquareCatalogResponseOperation } from "@/lib/integrations/providers/square/catalog-responses";
import { squarePhase2B1B1Category } from "@/lib/integrations/providers/square/fixtures/phase-2b1b1";

export const SQUARE_CATALOG_VALIDATION_CANARY = "catalog-validation-private-metadata-canary";
export function squareCatalogValidationFixture(overrides: Readonly<Record<string, unknown>> = {}) {
  return squarePhase2B1B1Category(overrides);
}
export function squareCatalogValidationParserInput(
  response: unknown,
  operation: SquareCatalogResponseOperation = "retrieve_catalog_object",
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const requestContext = operation === "retrieve_catalog_object" ? { objectId: "SQ2B1B1CAT001", query: {} }
    : operation === "list_catalog" ? { query: { types: "CATEGORY,ITEM,ITEM_VARIATION,MODIFIER_LIST,MODIFIER,DISCOUNT,TAX" } }
      : operation === "catalog_search" ? { body: { object_types: ["CATEGORY", "ITEM", "ITEM_VARIATION", "MODIFIER_LIST", "MODIFIER", "DISCOUNT", "TAX"], limit: 1_000 } }
        : { body: { object_ids: ["SQ2B1B1CAT001"] } };
  return {
    providerKey: "square", providerEnvironment: "sandbox", apiVersion: SQUARE_API_VERSION, operation,
    connectionAuthority: { workspaceId: "10000000-0000-4000-8000-000000000001", connectionId: "20000000-0000-4000-8000-000000000001", providerEntityType: "merchant", providerEntityId: "MERCHANT_SYNTHETIC_1" },
    requestContext, response, ...overrides
  };
}

// Structural/raw-budget witnesses, not a claim the conservative cap is attained.
// Every bucket/cardinality used is supported; tail is intentionally discarded.
export function squareCatalogValidationMaximumEnvelope() {
  const tombstone = (type: string, id: string) => ({ type, id, version: 1, updated_at: "2026-08-19T00:00:00Z", is_deleted: true });
  return {
    objects: Array.from({ length: 1_000 }, (_, i) => tombstone("ITEM", `ITEM_${i}`)),
    related_objects: Array.from({ length: 1_000 }, (_, i) => tombstone("ITEM", `RELATED_${i}`)),
    included_resources: { nested_modifiers: Array.from({ length: 1_000 }, (_, i) => tombstone("MODIFIER_LIST", `LIST_${i}`)) },
    // 18,005 productive raw values plus 1,995 discarded values.
    future: [Array(996).fill(0), Array(996).fill(0)]
  };
}
