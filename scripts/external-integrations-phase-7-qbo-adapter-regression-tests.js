const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const qbo = require("../lib/integrations/providers/qbo/index.ts");
const fixtures = require("../lib/integrations/providers/qbo/fixtures/v1.ts");
const registry = require("../lib/integrations/control-plane/provider-registry.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function notEqual(actual, expected, message) {
  assertionCount += 1;
  assert.notEqual(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
function doesNotMatch(value, matcher, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, matcher, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function keysDeep(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      keysDeep(child, keys);
    }
  }
  return keys;
}

function id(seed) {
  const hex = seed.toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

const provider = fixtures.QBO_SYNTHETIC_PROVIDER;

equal(qbo.QBO_MODEL_CALL_COUNT, 0, "Phase 7 QBO adapter makes zero model calls");
equal(qbo.QBO_PROVIDER_DESCRIPTOR.providerKey, "quickbooks_online", "QBO descriptor uses the approved provider key");
equal(qbo.QBO_PROVIDER_DESCRIPTOR.accessMode, "read_only", "QBO descriptor is read-only");
deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "only GET is allowed by descriptor");
equal(qbo.QBO_PROVIDER_DESCRIPTOR.authorizationMode, "oauth2_confidential", "OAuth mode is metadata only");
ok(qbo.QBO_PROVIDER_DESCRIPTOR.minimumScopes.includes("com.intuit.quickbooks.accounting"), "accounting scope metadata is present");
ok(qbo.QBO_PROVIDER_DESCRIPTOR.hostnameAllowlist.includes("quickbooks.api.intuit.com"), "production API hostname is declared");
ok(qbo.QBO_PROVIDER_DESCRIPTOR.hostnameAllowlist.includes("sandbox-quickbooks.api.intuit.com"), "sandbox API hostname is declared");
ok(qbo.QBO_PROVIDER_DESCRIPTOR.unsupportedCapabilities.includes("accounting_writes"), "accounting writes are explicitly unsupported");
ok(qbo.QBO_PROVIDER_DESCRIPTOR.unsupportedCapabilities.includes("kpi_promotion"), "KPI promotion is explicitly unsupported");
equal(qbo.QBO_PROVIDER_DESCRIPTOR.legalCommercialGateVersion, "qbo_production_read_only_v1", "QBO uses the Production read-only commercial gate");
for (const implemented of [
  "credential_storage",
  "kms_encryption",
  "cloud_tasks",
  "sync_worker",
  "webhook_route",
  "customer_ui"
]) {
  ok(!qbo.QBO_PROVIDER_DESCRIPTOR.unsupportedCapabilities.includes(implemented), `${implemented} is implemented by the Production boundary`);
}

const phase7Registry = registry.assertProviderDescriptorRegistry(qbo.QBO_PHASE_7_PROVIDER_REGISTRY);
equal(phase7Registry.registryVersion, "vaeroex_provider_descriptors_v1", "Phase 7 preserves registry version");
equal(phase7Registry.descriptors.length, 2, "Phase 7 registry composes synthetic and QBO descriptors");
const qboDescriptorEntry = phase7Registry.descriptors.find((entry) => entry.descriptor.providerKey === "quickbooks_online");
ok(qboDescriptorEntry, "QBO descriptor is registry-addressable");
ok(qboDescriptorEntry.descriptorFingerprint.startsWith("sha256:"), "QBO descriptor has canonical fingerprint");
notEqual(
  qboDescriptorEntry.descriptorFingerprint,
  phase7Registry.descriptors.find((entry) => entry.descriptor.providerKey === "synthetic").descriptorFingerprint,
  "QBO descriptor fingerprint is distinct from synthetic"
);

equal(qbo.QBO_DOCUMENTATION_CHECKED_DATE, "2026-08-22", "documentation register records the checked date");
for (const entry of qbo.QBO_DOCUMENTATION_REGISTER) {
  equal(entry.checkedDate, "2026-08-22", `documentation claim ${entry.claimKey} has checked date`);
  ok(entry.sourceUrl.startsWith("https://"), `documentation claim ${entry.claimKey} uses HTTPS source`);
  ok(entry.relevantContractVersion.endsWith("_v1"), `documentation claim ${entry.claimKey} is version-bound`);
}

for (const required of [
  "CompanyInfo",
  "Preferences",
  "Account",
  "Customer",
  "Vendor",
  "Item",
  "Invoice",
  "Payment",
  "CreditMemo",
  "SalesReceipt",
  "RefundReceipt",
  "Bill",
  "BillPayment",
  "VendorCredit",
  "Purchase",
  "Deposit",
  "Transfer",
  "JournalEntry",
  "ProfitAndLoss",
  "BalanceSheet",
  "CashFlow",
  "ARAgingSummary",
  "APAgingSummary",
  "TrialBalance"
]) {
  ok(qbo.QBO_V1_SUPPORTED_OBJECTS.includes(required), `${required} is explicitly supported in QBO V1`);
}
for (const deferred of ["Employee", "Payroll", "TimeActivity", "Estimate", "PurchaseOrder", "Budget", "GeneralLedger"]) {
  ok(qbo.QBO_V1_UNSUPPORTED_OR_DEFERRED_OBJECTS.includes(deferred), `${deferred} is explicitly unsupported or deferred`);
}

const prohibitedOutputKeys = new Set([
  "Email",
  "PrimaryEmailAddr",
  "PrimaryPhone",
  "BillAddr",
  "ShipAddr",
  "CompanyAddr",
  "TaxIdentifier",
  "Vendor1099",
  "BankAccountNumber",
  "AcctNum",
  "Description",
  "PurchaseDesc",
  "PrivateNote",
  "CustomerMemo",
  "CreditCardPayment",
  "CCAccountRef",
  "AttachableRef"
]);

const minimized = {};
for (const [recordType, raw] of Object.entries(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES)) {
  const result = qbo.minimizeQboSourceRecord({ recordType, raw, provider });
  minimized[recordType] = result;
  equal(result.trust, undefined, `${recordType} minimizer does not claim generic trust directly`);
  equal(result.provider.realmId, provider.realmId, `${recordType} preserves provider realm metadata`);
  equal(result.provider.providerKey, "quickbooks_online", `${recordType} binds provider metadata`);
  equal(result.minimizationVersion, "qbo_minimizer_v1", `${recordType} records minimizer version`);
  const outputKeys = new Set(keysDeep(result));
  for (const key of prohibitedOutputKeys) {
    ok(!outputKeys.has(key), `${recordType} minimization removes prohibited field ${key}`);
  }
}

equal(minimized.Preferences.accounting.basis, "accrual", "Preferences preserve accrual basis metadata");
equal(minimized.Invoice.accounting.sourceCurrency, "USD", "Invoice preserves source currency");
equal(minimized.Invoice.accounting.exchangeRate, "1", "Invoice preserves exchange-rate metadata without conversion");
equal(minimized.Invoice.temporal.postingDate, "2026-06-15", "Invoice preserves posting date");
equal(minimized.Payment.relationships.DepositToAccountRef.value, "41", "Payment preserves bounded deposit account ref");
equal(minimized.JournalEntry.lines[0].postingType, "debit", "JournalEntry preserves debit posting type");
equal(minimized.JournalEntry.lines[1].postingType, "credit", "JournalEntry preserves credit posting type");
equal(qbo.classifyQboRecordFamily("RefundReceipt"), "refund_or_credit", "RefundReceipt is classified as refund/credit family");
equal(qbo.classifyQboRecordFamily("VendorCredit"), "refund_or_credit", "VendorCredit is classified as refund/credit family");

const updatedInvoice = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
updatedInvoice.SyncToken = "8";
updatedInvoice.TotalAmt = "1260.00";
const correctedInvoice = qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: updatedInvoice, provider });
equal(
  qbo.classifyQboSourceChange({ previous: minimized.Invoice, current: correctedInvoice }),
  "corrected",
  "economic changes with a new source version are classified as corrected"
);
const voidedInvoice = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
voidedInvoice.Voided = true;
equal(
  qbo.classifyQboSourceChange({
    previous: minimized.Invoice,
    current: qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: voidedInvoice, provider })
  }),
  "voided",
  "voided transactions are classified distinctly"
);
const deletedInvoice = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
deletedInvoice.Deleted = true;
equal(
  qbo.classifyQboSourceChange({
    previous: minimized.Invoice,
    current: qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: deletedInvoice, provider })
  }),
  "deleted",
  "deleted provider records are classified distinctly"
);
equal(
  qbo.classifyQboSourceChange({ previous: minimized.Invoice, current: null }),
  "unchanged",
  "disappearance alone is not treated as deletion"
);

const missingCurrency = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
delete missingCurrency.CurrencyRef;
throws(
  () => qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: missingCurrency, provider }),
  /CurrencyRef/,
  "missing required transaction currency fails closed"
);
const malformedDecimal = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
malformedDecimal.TotalAmt = "12.34.56";
throws(
  () => qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: malformedDecimal, provider }),
  /TotalAmt/,
  "malformed decimal fails closed"
);
const malformedTimestamp = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
malformedTimestamp.MetaData.LastUpdatedTime = 7;
throws(
  () => qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: malformedTimestamp, provider }),
  /LastUpdatedTime/,
  "malformed timestamp fails closed"
);
const additiveInvoice = clone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
additiveInvoice.NewProviderField = { nested: "ignored" };
doesNotMatch(
  JSON.stringify(qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: additiveInvoice, provider })),
  /NewProviderField/,
  "unknown additive provider fields are ignored safely"
);

for (const reportType of qbo.QBO_REPORT_TYPES) {
  const observation = qbo.parseQboReport({
    reportType,
    raw: fixtures.QBO_SYNTHETIC_REPORT_FIXTURES[reportType],
    provider
  });
  equal(observation.additive, false, `${reportType} is non-additive`);
  equal(observation.contributionFamily, "control_observation", `${reportType} preserves contribution family`);
  equal(observation.sourceCurrency, "USD", `${reportType} preserves report currency`);
  equal(observation.reportBasis, reportType === "CashFlow" ? "cash" : "accrual", `${reportType} preserves report basis`);
  ok(qbo.flattenQboReportRows(observation).some((row) => row.label === "Services Revenue"), `${reportType} parses hierarchy by row metadata`);
}
const reorderedReport = clone(fixtures.QBO_SYNTHETIC_REPORT_FIXTURES.ProfitAndLoss);
reorderedReport.Rows.Row.reverse();
const reorderedLabels = qbo.flattenQboReportRows(
  qbo.parseQboReport({ reportType: "ProfitAndLoss", raw: reorderedReport, provider })
).map((row) => row.label).filter(Boolean).sort();
ok(reorderedLabels.includes("Services Revenue"), "report row reordering does not remove semantic labels");
ok(reorderedLabels.includes("Service Expense"), "report row reordering does not depend on fixed row position");
const missingRowsReport = clone(fixtures.QBO_SYNTHETIC_REPORT_FIXTURES.ProfitAndLoss);
delete missingRowsReport.Rows;
throws(
  () => qbo.parseQboReport({ reportType: "ProfitAndLoss", raw: missingRowsReport, provider }),
  /Rows/,
  "missing required report hierarchy fails closed"
);

const apAging = qbo.parseQboReport({
  reportType: "APAgingSummary",
  raw: fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary,
  provider
});
equal(apAging.sourceCurrency, null, "documented optional A/P currency metadata is not fabricated");
equal(apAging.reportBasis, "unknown", "documented optional A/P report basis remains explicitly unknown");
equal(apAging.rows.length, 2, "A/P data and grand-total section hierarchy are preserved");
equal(new Set(apAging.columns.map((column) => column.columnKey)).size, 7, "repeated provider Money column types receive unique minimized identities");
doesNotMatch(
  JSON.stringify(apAging),
  /Option|MetaData|IgnoredProvider|href|not-retained/,
  "A/P minimization drops provider options, column metadata, links, and unknown envelope fields"
);
equal(
  qbo.qboReportProviderRecordId(apAging),
  "APAgingSummary:unknown:2026-08-01:2026-08-26:currency_unspecified",
  "missing optional currency has one explicit non-financial source identity marker"
);

const emptyApAgingFixture = clone(
  fixtures.QBO_SANITIZED_OPTIONAL_PERIOD_AGING_REPORT_FIXTURES.APAgingSummary
);
emptyApAgingFixture.Header.Option = [{ Name: "NoReportData", Value: "true" }];
emptyApAgingFixture.Rows.Row = [];
const emptyApAging = qbo.parseQboReport({
  reportType: "APAgingSummary",
  raw: emptyApAgingFixture,
  provider
});
equal(emptyApAging.rows.length, 0, "documented no-report-data aging envelopes retain an empty hierarchy");

const arAging = qbo.parseQboReport({
  reportType: "ARAgingSummary",
  raw: fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.ARAgingSummary,
  provider
});
equal(arAging.sourceCurrency, "USD", "A/R preserves present valid currency metadata");
equal(arAging.reportBasis, "accrual", "A/R preserves present valid report basis metadata");
ok(
  qbo.flattenQboReportRows(arAging).some((row) => row.group === "DocumentedEmptySection" && row.rowType === "section"),
  "A/R preserves documented empty nested sections without inventing data rows"
);
ok(
  qbo.flattenQboReportRows(arAging).some((row) => row.rowType === "summary"),
  "A/R preserves nested summary rows as non-additive control hierarchy"
);

const pointInTimeApAging = qbo.parseQboReport({
  reportType: "APAgingSummary",
  raw: fixtures.QBO_SANITIZED_OPTIONAL_PERIOD_AGING_REPORT_FIXTURES.APAgingSummary,
  provider
});
equal(pointInTimeApAging.periodStart, null, "A/P accepts a documented omitted start period");
equal(pointInTimeApAging.periodEnd, "2026-08-26", "A/P preserves a present as-of end period");

const pointInTimeArAging = qbo.parseQboReport({
  reportType: "ARAgingSummary",
  raw: fixtures.QBO_SANITIZED_OPTIONAL_PERIOD_AGING_REPORT_FIXTURES.ARAgingSummary,
  provider
});
equal(pointInTimeArAging.periodStart, null, "A/R accepts a documented omitted start period");
equal(pointInTimeArAging.periodEnd, null, "A/R accepts a documented omitted end period");
ok(
  qbo.flattenQboReportRows(pointInTimeArAging).some((row) => row.group === "DocumentedEmptySection"),
  "optional-period A/R preserves nested and empty report sections"
);

const malformedOptionalPeriodAging = clone(
  fixtures.QBO_SANITIZED_OPTIONAL_PERIOD_AGING_REPORT_FIXTURES.APAgingSummary
);
malformedOptionalPeriodAging.Header.EndPeriod = { unsafe: true };
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedOptionalPeriodAging, provider }),
  (error) => error instanceof qbo.QboReportContractError &&
    error.diagnosticClass === "report_metadata_shape" &&
    error.field === "Header.EndPeriod" &&
    error.actualType === "object",
  "malformed optional aging period metadata still fails closed"
);

const malformedAgingMetadata = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
malformedAgingMetadata.Header.Currency = 7;
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedAgingMetadata, provider }),
  (error) => error instanceof qbo.QboReportContractError &&
    error.diagnosticClass === "report_metadata_shape" &&
    error.field === "Header.Currency" &&
    error.actualType === "number",
  "malformed aging metadata fails with bounded non-payload classification"
);

const malformedAgingColumns = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
malformedAgingColumns.Columns.Column = {};
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedAgingColumns, provider }),
  (error) => error instanceof qbo.QboReportContractError && error.diagnosticClass === "report_columns_shape",
  "malformed aging columns fail closed"
);

const malformedAgingRows = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
malformedAgingRows.Rows.Row = {};
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedAgingRows, provider }),
  (error) => error instanceof qbo.QboReportContractError && error.diagnosticClass === "report_rows_shape",
  "malformed aging row containers fail closed"
);

const malformedAgingCell = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
malformedAgingCell.Rows.Row[0].ColData[1].value = { unsafe: true };
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedAgingCell, provider }),
  (error) => error instanceof qbo.QboReportContractError &&
    error.diagnosticClass === "report_cell_shape" &&
    error.actualType === "object",
  "malformed aging cells fail without retaining their value"
);

const malformedAgingSummary = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
malformedAgingSummary.Rows.Row[1].Summary.ColData = {};
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: malformedAgingSummary, provider }),
  (error) => error instanceof qbo.QboReportContractError && error.diagnosticClass === "report_summary_shape",
  "malformed aging summaries fail closed"
);

const unknownAgingRow = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.ARAgingSummary);
unknownAgingRow.Rows.Row[0].Rows.Row[0].type = "CallerControlled";
throws(
  () => qbo.parseQboReport({ reportType: "ARAgingSummary", raw: unknownAgingRow, provider }),
  (error) => error instanceof qbo.QboReportContractError &&
    error.diagnosticClass === "report_rows_shape" &&
    error.expectedType === "data_or_section",
  "unknown provider row branches fail closed"
);

const mixedAgingRow = clone(fixtures.QBO_SANITIZED_AGING_REPORT_FIXTURES.APAgingSummary);
mixedAgingRow.Rows.Row[0].Summary = { ColData: [{ value: "unexpected" }] };
throws(
  () => qbo.parseQboReport({ reportType: "APAgingSummary", raw: mixedAgingRow, provider }),
  (error) => error instanceof qbo.QboReportContractError &&
    error.diagnosticClass === "report_rows_shape" &&
    error.expectedType === "section_without_direct_coldata",
  "ambiguous mixed data-and-summary rows fail closed"
);

deepEqual(qbo.planQboQueryPages({ recordType: "Invoice", totalCount: 0 }), [], "0 records creates no pages");
equal(qbo.planQboQueryPages({ recordType: "Invoice", totalCount: 1 }).length, 1, "1 record creates one page");
equal(qbo.planQboQueryPages({ recordType: "Invoice", totalCount: 500 }).length, 1, "page-size boundary creates one page");
equal(qbo.planQboQueryPages({ recordType: "Invoice", totalCount: 501 }).length, 2, "page-size plus one creates two pages");
equal(qbo.normalizeQboQueryPageSize(1_200), 1_000, "page size is capped at documented maximum planning bound");
equal(qbo.planQboQueryPages({ recordType: "Invoice", totalCount: 2_001, pageSize: 1_000 }).length, 3, "multi-page plans are deterministic");
equal(
  qbo.nextQboQueryPageCursor({ recordType: "Invoice", previousStartPosition: 1, maxResults: 500, returnedCount: 500 }).startPosition,
  501,
  "page continuation advances by returned count"
);
equal(
  qbo.nextQboQueryPageCursor({ recordType: "Invoice", previousStartPosition: 501, maxResults: 500, returnedCount: 100 }).exhausted,
  true,
  "short page exhausts pagination"
);
throws(
  () => qbo.planQboQueryPages({ recordType: "GeneralLedger", totalCount: 1 }),
  /Invalid enum/,
  "GeneralLedger is not routine V1 pagination scope"
);

const historical = qbo.planQboHistoricalSync({
  anchorDate: "2026-08-21",
  recordTypes: ["Invoice", "Payment"],
  windowDays: 31
});
equal(historical.policyVersion, "qbo_historical_sync_policy_v1", "historical planner is versioned");
equal(historical.horizonMonths, 24, "historical planner defaults to 24 months");
ok(historical.windows.length > 24, "historical planner produces multi-period bounded windows");
ok(historical.windows.every((window) => window.recordType === "Invoice" || window.recordType === "Payment"), "historical windows are record-type scoped");

const cdc = qbo.planQboCdcWindow({
  changedSince: "2026-07-01T00:00:00.000Z",
  until: "2026-08-21T00:00:00.000Z"
});
equal(cdc.changedSince, "2026-07-22T00:00:00.000Z", "CDC changedSince is clamped to 30-day lookback");
equal(cdc.responseObjectCap, 1_000, "CDC response cap is encoded for bisection planning");
equal(qbo.bisectQboCdcWindowIfDense({ window: cdc, observedObjectCount: 999 }).length, 1, "non-dense CDC window is not bisected");
equal(qbo.bisectQboCdcWindowIfDense({ window: cdc, observedObjectCount: 1_000 }).length, 2, "dense CDC window is bisected deterministically");
equal(
  qbo.resumeQboCdcCursor({
    lastCompletedUntil: "2026-08-20T00:00:00.000Z",
    restartUntil: "2026-08-21T00:00:00.000Z"
  }).overlapSeconds,
  300,
  "CDC resume applies short overlap"
);

const events = qbo.parseQboCloudEventsWebhook({
  raw: fixtures.QBO_SYNTHETIC_CLOUDEVENTS_FIXTURE,
  expectedProvider: provider
});
equal(events.length, 1, "CloudEvents parser returns bounded hints");
equal(events[0].recordType, "Invoice", "CloudEvents type maps to provider record");
equal(events[0].changeKind, "updated", "CloudEvents operation maps to bounded change kind");
equal(events[0].hintOnly, true, "CloudEvents output is hint-only");
throws(
  () => qbo.parseQboCloudEventsWebhook({ raw: [{ ...fixtures.QBO_SYNTHETIC_CLOUDEVENTS_FIXTURE[0], type: "qbo.employee.created.v1" }] }),
  /unsupported_entity/,
  "unsupported webhook entity fails closed"
);
throws(
  () => qbo.parseQboCloudEventsWebhook({ raw: [{ type: "legacy" }] }),
  /specversion/,
  "malformed webhook shape fails closed"
);

equal(qbo.parseQboRetryAfter("5"), 5_000, "Retry-After seconds are parsed");
equal(qbo.parseQboRetryAfter("not-a-date"), null, "malformed Retry-After is ignored safely");
equal(
  qbo.classifyQboProviderError({ httpStatus: 401 }).kind,
  "authentication",
  "401 maps to authentication"
);
equal(
  qbo.classifyQboProviderError({ httpStatus: 403 }).kind,
  "authorization_scope",
  "403 maps to authorization/scope"
);
equal(
  qbo.classifyQboProviderError({ httpStatus: 429, headers: { "Retry-After": "10" } }).retryAfterMs,
  10_000,
  "429 carries Retry-After"
);
equal(
  qbo.classifyQboProviderError({ httpStatus: 503 }).kind,
  "provider_5xx",
  "5xx maps to provider availability"
);
equal(
  qbo.classifyQboProviderError({ httpStatus: null, transportFailure: true }).kind,
  "transient_network",
  "transport failure maps to transient network"
);
doesNotMatch(
  qbo.classifyQboProviderError({
    httpStatus: 400,
    body: { IntuitResponse: { Fault: { type: "Validation", Error: [{ code: "6240", Detail: "raw provider body" }] } } }
  }).safeDetail,
  /raw provider body/,
  "raw provider error body is not exposed in safe detail"
);
equal(qbo.QBO_RATE_LIMIT_OBSERVATION_POLICY.noSleepOrQueueInPhase7, true, "rate-limit policy does not sleep or queue in Phase 7");

ok(qbo.assertQboReadOnlyOperation({ method: "GET", path: "/v3/company/fictional-realm-12345/query", queryText: "select * from Invoice" }).readOnly, "GET query is allowed");
throws(
  () => qbo.assertQboReadOnlyOperation({ method: "POST", path: "/v3/company/fictional-realm-12345/query" }),
  /method/,
  "POST query is denied by adapter read-only policy"
);
throws(
  () => qbo.assertQboReadOnlyOperation({ method: "DELETE", path: "/v3/company/fictional-realm-12345/invoice/501" }),
  /method/,
  "DELETE is denied by adapter read-only policy"
);
throws(
  () => qbo.assertQboReadOnlyOperation({ method: "GET", path: "/v3/company/fictional-realm-12345/query", queryText: "update Invoice set TotalAmt = 1" }),
  /query/,
  "write-shaped query text is denied"
);
throws(
  () => qbo.assertQboReadOnlyOperation({ method: "GET", path: "/v3/company/fictional-realm-12345/batch" }),
  /path/,
  "Batch endpoint is denied"
);

const context = {
  workspaceId: id(1),
  businessEntityId: id(2),
  connectionId: id(3),
  providerKey: "quickbooks_online",
  providerEnvironment: "sandbox",
  providerTenantReferenceFingerprint: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  connectionConfigurationVersion: 1,
  mappingVersion: 1
};
const sourceVersion = qbo.qboMinimizedRecordToExternalSourceVersion({
  context,
  record: minimized.Invoice,
  id: id(4),
  immutableVersion: 1,
  priorVersionId: null,
  previousRecord: null,
  observedAt: "2026-06-20T12:00:00.000Z",
  synchronizedAt: "2026-06-20T12:00:01.000Z",
  ingestedAt: "2026-06-20T12:00:02.000Z",
  receivedAt: "2026-06-20T12:00:03.000Z"
});
equal(sourceVersion.workspaceId, context.workspaceId, "source envelope workspace comes from adapter context");
equal(sourceVersion.businessEntityId, context.businessEntityId, "source envelope Business Entity comes from adapter context");
equal(sourceVersion.source.providerKey, "quickbooks_online", "source envelope provider is QBO");
equal(sourceVersion.trust, "untrusted_external_input", "source envelope remains untrusted external input");
equal(sourceVersion.validation.state, "pending", "QBO parsing does not validate canonical truth");
equal(sourceVersion.normalizedProjection.provider.realmId, provider.realmId, "realm identity is retained as provider metadata");
notEqual(sourceVersion.workspaceId, sourceVersion.normalizedProjection.provider.realmId, "realm ID cannot overwrite tenant authority");

const pointInTimeArSource = qbo.qboReportToExternalSourceVersion({
  context,
  report: pointInTimeArAging,
  id: id(6),
  immutableVersion: 1,
  priorVersionId: null,
  observedAt: "2026-06-20T12:00:00.000Z",
  synchronizedAt: "2026-06-20T12:00:01.000Z",
  ingestedAt: "2026-06-20T12:00:02.000Z",
  receivedAt: "2026-06-20T12:00:03.000Z"
});
equal(pointInTimeArSource.temporal.basis, "point_in_time", "open A/R aging minimizes as a point-in-time source");
equal(pointInTimeArSource.temporal.effectiveAt, null, "open A/R aging does not fabricate an as-of date");
equal(pointInTimeArSource.temporal.periodStart, null, "point-in-time A/R has no fabricated period start");
equal(pointInTimeArSource.temporal.periodEnd, null, "point-in-time A/R has no fabricated period end");
equal(pointInTimeArSource.validation.state, "pending", "point-in-time A/R remains untrusted pending input");
doesNotMatch(
  JSON.stringify(pointInTimeArSource.normalizedProjection),
  /Option|MetaData|IgnoredProvider|href|not-retained/,
  "point-in-time A/R source minimization excludes unnecessary provider fields"
);

const pointInTimeApSource = qbo.qboReportToExternalSourceVersion({
  context,
  report: pointInTimeApAging,
  id: id(7),
  immutableVersion: 1,
  priorVersionId: null,
  observedAt: "2026-06-20T12:00:00.000Z",
  synchronizedAt: "2026-06-20T12:00:01.000Z",
  ingestedAt: "2026-06-20T12:00:02.000Z",
  receivedAt: "2026-06-20T12:00:03.000Z"
});
equal(pointInTimeApSource.temporal.basis, "point_in_time", "end-only A/P aging minimizes as a point-in-time source");
equal(
  pointInTimeApSource.temporal.effectiveAt,
  "2026-08-26T00:00:00.000Z",
  "A/P aging binds a present as-of date without inventing a period"
);
equal(pointInTimeApSource.temporal.periodStart, null, "point-in-time A/P has no period start");
equal(pointInTimeApSource.temporal.periodEnd, null, "point-in-time A/P has no period end");
equal(
  qbo.qboReportProviderRecordId(pointInTimeApAging),
  qbo.qboReportProviderRecordId(
    qbo.parseQboReport({
      reportType: "APAgingSummary",
      raw: clone(fixtures.QBO_SANITIZED_OPTIONAL_PERIOD_AGING_REPORT_FIXTURES.APAgingSummary),
      provider
    })
  ),
  "optional-period aging source identity is deterministic"
);
throws(
  () => qbo.qboMinimizedRecordToExternalSourceVersion({ ...{
    context: { ...context, providerKey: "synthetic" },
    record: minimized.Invoice,
    id: id(5),
    immutableVersion: 1,
    priorVersionId: null,
    previousRecord: null,
    observedAt: "2026-06-20T12:00:00.000Z",
    synchronizedAt: "2026-06-20T12:00:01.000Z",
    ingestedAt: "2026-06-20T12:00:02.000Z",
    receivedAt: "2026-06-20T12:00:03.000Z"
  } }),
  /provider_mismatch/,
  "cross-provider adapter context fails closed"
);

const qboSourceFiles = childProcess.execFileSync(
  "find",
  ["lib/integrations/providers/qbo", "-type", "f", "-name", "*.ts"],
  { cwd: root, encoding: "utf8" }
).trim().split("\n").filter(Boolean);
const qboSource = qboSourceFiles.map((file) => read(file)).join("\n");
doesNotMatch(qboSource, /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|openai|chat\.completions|responses\.create/i, "QBO Phase 7 package has no network, Supabase, or AI runtime dependency");
doesNotMatch(qboSource, /process\.env|client_secret|clientSecret|access_token|refresh_token|authorization_code|@google-cloud\/kms|@google-cloud\/tasks|SecretManagerServiceClient|CloudTasksClient/i, "QBO Phase 7 package has no credential, KMS, or queue dependency");
doesNotMatch(qboSource, /createInvoice|updateInvoice|deleteInvoice|createPayment|updatePayment|deletePayment|AddEntity|service\.Add|service\.Update|service\.Delete|method:\s*["']POST["']|method:\s*["']DELETE["']/i, "QBO adapter source contains no accounting write operation implementation");
doesNotMatch(
  qboSource,
  /@\/lib\/integrations\/(?:persistence|credentials|runtime)|(?:\.\.\/)+(?:persistence|credentials|runtime)(?:\/|["'])/i,
  "pure QBO package imports no persistence, credential authority, or Phase 6 runtime module"
);
doesNotMatch(
  qboSource,
  /@\/(?:app|components|services)(?:\/|["'])|(?:\.\.\/)+(?:app|components|services)(?:\/|["'])/i,
  "pure QBO package imports no customer UI, route, or service module"
);
doesNotMatch(
  qboSource,
  /promotionAuthorized\s*[:=]\s*true/i,
  "pure QBO package cannot authorize direct KPI promotion"
);

const packageJson = JSON.parse(read("package.json"));
equal(
  packageJson.scripts["test:external-integrations-phase-7"],
  "node scripts/external-integrations-phase-7-qbo-adapter-regression-tests.js",
  "Phase 7 deterministic regression suite is registered"
);

console.log(
  `External integration Phase 7 QBO adapter regressions: ${assertionCount} assertions passed. Descriptor ${qboDescriptorEntry.descriptorFingerprint}; registry ${phase7Registry.registryFingerprint}.`
);
