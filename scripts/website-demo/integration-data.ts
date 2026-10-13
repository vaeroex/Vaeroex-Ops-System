// Coastal Kitchen provider-shaped inputs. Local capture only; no OAuth or credentials.
import { DirectViewSchema } from "@/lib/integrations/square-direct/contracts";
import { DirectPaymentBrowserSchema } from "@/lib/integrations/square-direct/payment-browse";
import { parseQboBrowser, parseQboBrowseQuery } from "@/lib/integrations/qbo-customer/contracts";
import { assertMapping, assertBusinessLabel } from "@/lib/integrations/google-sheets/contracts";
import { AS_OF, metrics } from "./data";
const connectionId = "00000000-0000-4000-8000-000000000201";
const entityId = "00000000-0000-4000-8000-000000000202";
export const reportingPeriod = { start: "2026-10-06", end: "2026-10-12" };
// Three Sunday dinner payments are a subset of the week's activity. Provider
// amounts include fictional 8% tax, no tips/refunds. They are NOT revenue totals.
export const squarePaymentInputs = [
  { id: "ck-payment-103", locationId: "ck-dining-room", status: "COMPLETED", createdAt: "2026-10-11T20:45:00Z", updatedAt: "2026-10-11T20:45:10Z", amountMinor: "16200", currency: "USD" },
  { id: "ck-payment-102", locationId: "ck-dining-room", status: "COMPLETED", createdAt: "2026-10-11T19:30:00Z", updatedAt: "2026-10-11T19:30:10Z", amountMinor: "8100", currency: "USD" },
  { id: "ck-payment-101", locationId: "ck-dining-room", status: "COMPLETED", createdAt: "2026-10-11T18:15:00Z", updatedAt: "2026-10-11T18:15:10Z", amountMinor: "10800", currency: "USD" },
];
const squareConnection = { connectionId, businessEntityId: entityId, state: "disconnected", sellerLabel: "Coastal Kitchen", locations: [], locationId: "ck-dining-room", lastSyncedAt: AS_OF, lastError: null, hasMore: false, revocationPending: false, recoveryRequired: false, payments: squarePaymentInputs };
export const squareView = DirectViewSchema.parse({ available: false, historyAvailable: true, businessEntities: [{ id: entityId, label: "Coastal Kitchen" }], connections: [squareConnection] });
export const squareBrowser = DirectPaymentBrowserSchema.parse({ connectionId, timeZone: "UTC", timeZoneFallback: false, currentConnection: null, page: 1, pageSize: 25, totalCount: 3, totalPages: 1,
  filters: { startDate: reportingPeriod.start, endDate: reportingPeriod.end, status: "COMPLETED" }, payments: squarePaymentInputs,
  connections: [{ connectionId, businessEntityId: entityId, businessEntityLabel: "Coastal Kitchen", sellerLabel: "Coastal Kitchen", locationLabel: "Dining room", state: "disconnected", timeZone: "UTC", timeZoneFallback: false, createdAt: "2026-10-01T18:00:00Z", paymentCount: 3, lastSyncedAt: AS_OF, checkpointAt: null, activeRead: null, lastCompletedRead: null }] });

const sales = metrics[0].values.at(-1)!;
const cogs = Math.round(sales * (100 - metrics[1].values.at(-1)!) ) / 100;
const labor = Math.round(sales * metrics[2].values.at(-1)!) / 100;
export const accountingAmounts = { sales, cogs, grossProfit: sales-cogs, labor, otherExpenses: 2400, netIncome: sales-cogs-labor-2400 };
const sourceId = "00000000-0000-4000-8000-000000000203";
const qboConnectionId = "00000000-0000-4000-8000-000000000204";
const source = { sourceId, recordType: "ProfitAndLoss", providerRecordId: null, lifecycle: "active", validation: "valid", validationWork: "valid", changeKind: "created", mappingStatus: "active", temporalBasis: "period", postingDate: null, periodStart: reportingPeriod.start, periodEnd: reportingPeriod.end, effectiveAt: AS_OF, sourceTimeZone: "UTC", accountingBasis: "accrual", currency: "USD", observedAt: AS_OF, synchronizedAt: AS_OF };
const rows = [["Net sales", sales], ["Food and beverage cost", cogs], ["Gross profit", sales-cogs], ["Labor expense", labor], ["Other operating expenses", 2400], ["Net income", accountingAmounts.netIncome]] as const;
export const qboReport = { kind: "report", reportType: "ProfitAndLoss", reportBasis: "accrual", sourceCurrency: "USD", periodStart: reportingPeriod.start, periodEnd: reportingPeriod.end,
  columns: [{ columnKey: "account", title: "Account" }, { columnKey: "amount", title: "USD" }],
  rows: rows.map(([label, amount]) => ({ depth: 0, rowType: label === "Gross profit" || label === "Net income" ? "summary" : "data", cells: [{ columnKey: "account", value: label }, { columnKey: "amount", value: amount.toFixed(2) }] })), truncated: false };
export const qboBrowser = parseQboBrowser({ contractVersion: "qbo_customer_source_browse_v1", provider: "quickbooks_online", environment: "production", additive: false, coverage: "unknown", readAt: AS_OF,
  connectionId: qboConnectionId, kind: "reports", pageSize: 25, nextAfter: null, connections: [{ connectionId: qboConnectionId, label: "Coastal Kitchen", entityLabel: "Coastal Kitchen", state: "disconnected" }], sources: [source],
  metrics: { scope: "selected_connection_and_category_current_sources", currentSources: "1", reportObservations: "1", transactionRecords: "0", validation: { pending:"0",valid:"1",invalid:"0",quarantined:"0" }, validationWork:{absent:"0",pending:"0",claimed:"0",valid:"1",quarantined:"0",superseded:"0",conflict:"0"}, lifecycle:{active:"1",voided:"0",deleted:"0",unavailable:"0"}, missingCurrency:"0",unknownAccountingBasis:"0",missingSourceTimeZone:"0",missingTransactionPostingDate:"0", earliestPostingDate:null,latestPostingDate:null,earliestObservedAt:AS_OF,latestObservedAt:AS_OF,latestSynchronizedAt:AS_OF,byType:[{recordType:"ProfitAndLoss",count:"1"}] }, detail:{source,preview:{state:"available",value:qboReport}} });
export const qboQuery = parseQboBrowseQuery({ connectionId:qboConnectionId, sourceId, kind:"reports" });

export const sheetsConnectionId = "00000000-0000-4000-8000-000000000205";
export const sheetsHeaders = ["ID", "Week", "Guest score (%)"];
export const sheetsMapping = assertMapping(sheetsHeaders, { rowKeyColumn:0,dateColumn:1,dateFormat:"iso",locationColumn:null,metrics:[{column:2,name:"Guest satisfaction",unit:"percent",category:"Customers",target:90}] });
export const sheetsRows = metrics[4].values.slice(-3).map((value,index)=>[`W${26+index}`, ["2026-09-28","2026-10-05","2026-10-12"][index],String(value)]);
// Mirrors the supported preview response shape. Returns cells only; it cannot
// authorize Google, save a mapping, import data or make a network request.
export function sheetsPreview(body: unknown) {
  if (!(body instanceof URLSearchParams) || body.get("connectionId") !== sheetsConnectionId) throw Error("Unknown synthetic spreadsheet preview");
  const mapping = assertMapping(sheetsHeaders,JSON.parse(body.get("fieldMapping") || "null"));
  const selected = [mapping.rowKeyColumn,mapping.dateColumn,...(mapping.locationColumn===null?[]:[mapping.locationColumn]),...mapping.metrics.map(metric=>metric.column)];
  return {ok:true,headers:selected.map(column=>sheetsHeaders[column]),rows:sheetsRows.map(row=>selected.map(column=>assertBusinessLabel(row[column]))),sampleSize:sheetsRows.length,truncated:false};
}
