require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const assert = require("node:assert/strict");
const square = require("../lib/integrations/providers/square/index.ts");
const mapping = require("../lib/integrations/providers/square/ingestion-mapping.ts");
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");
const scope = { workspaceId:"10000000-0000-4000-8000-000000000001",businessEntityId:"30000000-0000-4000-8000-000000000001",
  connectionId:"20000000-0000-4000-8000-000000000001",sellerId:"MERCHANT_SYNTHETIC_1",environment:"sandbox",
  authorizedLocationIds:["LOC_SYNTHETIC_1","LOC_SYNTHETIC_2","SQ2B2ALOC001","SQ2B2ALOC002"],generation:4 };
const context = { ...scope, authority:"active",asOf:"2026-09-11T16:00:00Z",freshness:"observed",scan:"partial" };
function mapped(stream, result, ordinal=1) {
  assert.equal(result.outcome,"accepted",JSON.stringify(result.diagnostics));
  return mapping.mapSquareParsedPage(scope,stream,result.value,"2026-09-11T15:00:00Z",false).sources.map(pending => {
    const sourceVersion = mapping.materializeSquarePendingSource(pending,ordinal,null);
    return { pending,sourceVersion,currentAuthority:{ scopeFingerprint:contractSha256(scope),resourceKey:pending.resourceKey,
      currentVersionKey:pending.versionKey,sourceFingerprint:sourceVersion.sourceFingerprint,ordering:"newer",admittedAt:context.asOf } };
  });
}
function payment(overrides={}) {
  return mapped("payments",square.parseSquarePaymentResponse(square.squarePaymentParserInput({payment:square.squarePaymentFixture(overrides)})))[0];
}
function refund(overrides={}) {
  return mapped("refunds",square.parseSquareRefundResponse(square.squareRefundParserInput({refund:square.squareRefundFixture(overrides)})))[0];
}
function catalog(overrides={}) {
  const v=square.squarePhase2B1B1ItemVariation({present_at_location_ids:["LOC_SYNTHETIC_1"],...overrides});
  const {squareCatalogValidationParserInput}=require("../lib/integrations/providers/square/fixtures/catalog-response-validation.ts");
  const {parseSquareCatalogValidatedResponse}=require("../lib/integrations/providers/square/catalog-response-validation.ts");
  return mapped("catalog",parseSquareCatalogValidatedResponse(squareCatalogValidationParserInput({objects:[v]},"list_catalog")))[0];
}
function order(overrides={}) {
  const o=square.squarePhase2B2B3Order({tenders:[],...overrides});
  return mapped("order_tenders",square.parseSquareOrderTenderResponse(square.squarePhase2B2B3ParserInput({order:o},"retrieve_order",{
    connectionAuthority:{connectionId:scope.connectionId,providerEntityType:"merchant",providerEntityId:scope.sellerId},
    requestContext:{orderId:o.id,authorizedLocationIds:scope.authorizedLocationIds}
  })))[0];
}
function inventory(kind="count",overrides={}) {
  const fixtures=require("../lib/integrations/providers/square/fixtures/inventory-responses.ts");
  const response=kind==="count"?{counts:[fixtures.squareInventoryCountFixture(overrides)]}:kind==="physical"?{count:fixtures.squareInventoryPhysicalCountFixture(overrides)}:{adjustment:fixtures.squareInventoryAdjustmentFixture(overrides)};
  const op=kind==="count"?"retrieve_inventory_count":kind==="physical"?"retrieve_inventory_physical_count":"retrieve_inventory_adjustment";
  return mapped("inventory",square.parseSquareInventoryResponse(fixtures.squareInventoryParserInput(response,op)))[0];
}
module.exports={square,mapping,contractSha256,scope,context,mapped,payment,refund,catalog,order,inventory};
