/* eslint-disable @typescript-eslint/no-require-imports -- Loads production TypeScript in an isolated synthetic evaluation. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function alias(request, parent, isMain, options) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const load = Module._load;
Module._load = function serverOnly(request, parent, isMain) { return request === "server-only" ? {} : load.call(this, request, parent, isMain); };
const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");
const { followsApprovedInvestigation } = require("../lib/ai/investigation-action-quality.ts");
const { planInvestigation } = require("../lib/intelligence/investigation-plan.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const asOf = "2026-07-15T00:00:00.000Z";
function kpi(name, date, actual, target, raw = {}) {
  return { id: `${name}-${date}`, workspace_id: workspaceId, name, actual_value: actual, target, metric_date: date,
    category: null, owner: null, notes: null, source: "Synthetic workbook", source_file_id: null, import_id: null, import_row_id: null,
    raw_data_json: raw, ai_generated: false, archived_at: null, deleted_at: null, created_at: `${date}T00:00:00Z`, updated_at: `${date}T00:00:00Z` };
}
function setting(name, direction, unit, definition, target) {
  return { kpi_name: name, canonical_name: name.toLowerCase().replace(/\W+/g, "_"), display_name: name, original_source_label: name,
    semantic_unit: unit, semantic_scale: 1, desired_direction: direction,
    target_behavior: direction === "minimize" ? "maximum_limit" : "minimum_goal", ideal_value: null, ideal_range_min: null, ideal_range_max: null,
    metric_role: "actual", classification_source: "user", classification_confidence: 1, classification_confirmed: true,
    classification_rationale: "Synthetic confirmed definition", target, definition, weight: 1, sort_order: 0, is_visible: true };
}
function metricCase(id, name, values, target, direction, unit, definition, raw = {}, observedAsOf = asOf) {
  const dates = ["2026-06-01", "2026-05-01", "2026-04-01"];
  const rows = values.map((value, index) => kpi(name, dates[index], value, target, raw));
  const insight = buildIntelligenceLayer({ asOf: observedAsOf, kpis: rows, kpiSettings: [setting(name, direction, unit, definition, target)] }).insights.find((item) => item.id.startsWith("kpi-"));
  assert.ok(insight, `${id} generated a finding`);
  return { id, type: insight.type, title: insight.title, action: insight.recommendedAction, impact: insight.impact, missing: insight.missingEvidence, evidence: insight.supportingRecords.map((r) => ({ title: r.title, date: r.date, fields: r.availableFields || [] })) };
}
function importedCase(id, type, title, records, missing, period, priority = "High", sourceAction = "") {
  const input = { id, type, title, summary: "Synthetic imported source shows a measured exception.", why: "The source rows contain the observed values.",
    impact: "An owner review is warranted.", recommendedAction: sourceAction || "Decide whether to investigate or monitor.", confidence: "Medium", evidence: [], evidenceCount: records.length,
    supportingRecords: records.map((r, index) => ({ id: `${id}-${index}`, title: r.title, recordType: r.type, date: r.date,
      value: r.value, support: "Original imported record.", href: "/app/sources/22222222-2222-4222-8222-222222222222",
      classification: "Original", sourceKey: r.source || "source-file:synthetic", availableFields: r.fields || [] })), independentSourceCount: 1,
    contradictoryEvidence: [], missingEvidence: missing, sourceTypes: ["Imported operational evidence"], sourceHref: "/app/sources", priority,
    lastUpdated: records[0].date, affectedArea: title, timePeriod: period, limitation: "The source does not establish cause.", fingerprint: id,
    ...(sourceAction ? { investigationContext: { kind: "records", sourceAction } } : {}) };
  const insight = buildIntelligenceLayer({ asOf, operationalInsights: [input] }).insights.find((item) => item.id === id);
  assert.ok(insight, `${id} generated a finding`);
  return { id, type: insight.type, title: insight.title, action: insight.recommendedAction, impact: insight.impact, missing: insight.missingEvidence,
    evidence: insight.supportingRecords.map((r) => ({ title: r.title, date: r.date, fields: r.availableFields || [] })) };
}
const cases = [
  metricCase("cold-chain-aggregate", "Cold-chain excursion rate", [8.2, 7.8, 7.4], 3, "minimize", "percent", "Share of shipments with a logged temperature excursion"),
  metricCase("delivery-rich", "On-time delivery rate", [82, 84, 86], 95, "maximize", "percent", "Deliveries completed by the promised date divided by completed deliveries", { Carrier: "Carrier A", Region: "West", Channel: "Wholesale" }),
  metricCase("services-opportunity", "Billable utilization", [84, 83, 82], 80, "maximize", "percent", "Billable hours divided by available consultant hours", { Team: "Implementation" }),
  metricCase("stale-stock-opportunity", "Stock count concordance", [97, 96, 95], 94, "maximize", "percent", "Share of stock items matching a physical count", {}, "2026-10-06T00:00:00.000Z"),
  metricCase("inventory-accuracy-live-shape", "Inventory Accuracy %", [97, 96, 96], 95, "maximize", "percent", "Share of stock items matching an audited physical count", {}, "2026-10-06T00:00:00.000Z"),
  metricCase("stale-equipment", "Equipment uptime", [72, 73, 74], 90, "maximize", "percent", "Available operating hours divided by scheduled hours", {}, "2026-11-01T00:00:00.000Z"),
  importedCase("warehouse-anomaly", "Anomaly", "Warehouse pick exceptions", [
    { title: "Pick log · row 14", type: "Imported operational record", date: "2026-06-10", value: "Exception recorded", fields: ["Site", "Shift", "Status"] },
    { title: "Pick log · row 21", type: "Imported operational record", date: "2026-06-11", value: "Exception recorded", fields: ["Site", "Shift", "Status"] }
  ], ["Pick event timestamps and reason codes"], "2026-06"),
  importedCase("customer-order-risk", "Risk", "Open wholesale order exceptions", [
    { title: "Orders · row 8", type: "Imported operational record", date: "2026-06-12", value: "Order O-8 unresolved", fields: ["Order", "Customer", "Status"] }
  ], ["Confirmed resolution and customer outcome"], "2026-06", "High", "Review fulfillment delays and unresolved customer cases, starting with the oldest records."),
  importedCase("customer-order-multirow", "Risk", "Open service exceptions", [
    { title: "Service cases · row 10", type: "Imported operational record", date: "2026-06-02", value: "Unresolved", fields: ["Customer", "Status"] },
    { title: "Service cases · row 11", type: "Imported operational record", date: "2026-07-15", value: "Unresolved", fields: ["Customer", "Status"] }
  ], ["Resolution age"], "2026-06 to 2026-07", "High", "Review unresolved customer cases, starting with the oldest records."),
  importedCase("separate-signal", "Opportunity", "Service backlog improved", [
    { title: "Service queue · row 4", type: "Imported operational record", date: "2026-05-01", value: "Backlog lower", fields: ["Team"] }
  ], ["Reason for change"], "2026-05", "Medium")
];
for (const item of cases) assert.ok(item.action.length <= 420, `${item.id} action fits approved boundary`);
if (!process.argv.includes("--baseline")) {
  for (const item of cases) {
    assert.ok(followsApprovedInvestigation(item.action, item.action, item.id === "stale-equipment" || item.id === "separate-signal"), `${item.id} retains a concrete approved action`);
    assert.equal(followsApprovedInvestigation("Decide whether to investigate now or continue monitoring.", item.action, false), false, `${item.id} rejects generic model advice`);
    assert.match(item.action, /\b(?:compare|check)\b/i, `${item.id} retains a supported comparison or record check`);
    assert.match(item.action, /assign an owner/i, `${item.id} retains a decision owner`);
  }
  assert.match(cases.find((item) => item.id === "cold-chain-aggregate").action, /shipment-level numerator and denominator/i);
  assert.match(cases.find((item) => item.id === "customer-order-risk").action, /oldest records/i, "specific existing source action is retained");
  assert.doesNotMatch(cases.find((item) => item.id === "customer-order-risk").action, /largest gap/i);
  assert.doesNotMatch(cases.find((item) => item.id === "separate-signal").action, /warehouse|order|customer/i, "unrelated signals stay separate");
  const longInput = { id: "long", type: "Risk", title: "Long source", affectedArea: "Operations", timePeriod: "2026-06", priority: "High",
    recommendedAction: "", investigationContext: { kind: "records", sourceAction: "Review the oldest unresolved service cases by owner and resolution age, then compare each documented handoff and assigned follow-up against the approved service process before deciding whether to escalate." },
    missingEvidence: ["Missing original measurement detail ".repeat(20)], supportingRecords: [
      { title: "A very long source title ".repeat(20), date: "2026-06-01", classification: "Original", availableFields: ["Supplier", "Site", "Shift"] },
      { title: "Another very long title ".repeat(20), date: "2026-06-02", classification: "Original", availableFields: ["Supplier", "Site", "Shift"] }
    ] };
  const longAction = planInvestigation(longInput, asOf);
  assert.ok(longAction.length <= 420, "long source metadata must not silently truncate the approved action");
  assert.match(longAction, /compare/i, "long metadata must not drop the comparison to meet the length bound");
  assert.match(longAction, /assign an owner/i, "long metadata must not drop the accountable follow-up");
  assert.match(longAction, /oldest unresolved service cases/i, "length pressure must retain the meaningful source-specific instruction");
  assert.match(cases.find((item) => item.id === "inventory-accuracy-live-shape").action, /minimum target and prior periods/i, "stale aggregate opportunity keeps its supported comparison");
}
if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
else console.log(`Executive advice general evaluation passed for ${cases.length} synthetic cases.`);
