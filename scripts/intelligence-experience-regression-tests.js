const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ES2022 },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { buildIntelligenceLayer, consolidateDuplicateInsights } = require("../lib/intelligence/layer.ts");
const { buildOperationalEvidenceInsights } = require("../lib/intelligence/operational-evidence.ts");
const { buildGeneratedOutput, fallbackGeneratedOutputSource } = require("../lib/intelligence/generated-output.ts");
const {
  buildEvidenceGroups,
  collapsedEvidenceGroupLimit,
  collapsedEvidenceRepresentativeLimit,
  representativesPerEvidenceGroup,
  selectCollapsedRepresentatives,
  supportingEvidenceHref
} = require("../lib/intelligence/evidence-groups.ts");

function kpi(overrides = {}) {
  return {
    id: "kpi-1", name: "Revenue", actual_value: 80, target: 100, metric_date: "2026-07-10", source: "Monthly report", created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z",
    ...overrides
  };
}

function issue(overrides = {}) {
  return {
    id: "issue-1", title: "Follow-up completion needs review", description: "Several follow-up records need review.", issue_type: "Operations", severity: "Medium", status: "Open", root_cause: null, recommended_fix: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z", archived_at: null, deleted_at: null,
    ...overrides
  };
}

const supported = buildIntelligenceLayer({ kpis: [kpi(), kpi({ id: "kpi-2", metric_date: "2026-06-10", actual_value: 85 }), kpi({ id: "kpi-3", metric_date: "2026-05-10", actual_value: 90 })] });
assert.equal(supported.topRisk?.title, "Revenue remained below target for 2 periods", "supported KPI findings state the observed duration directly");
assert.equal(supported.topRisk?.confidence, "Medium", "one manual KPI series cannot claim multiple independent sources");
assert.equal(supported.topRisk?.supportingRecords.length, 3, "KPI findings retain concrete supporting records");
assert.match(supported.topRisk?.supportingRecords[0]?.href || "", /\/app\/kpis\?metric=Revenue/, "KPI evidence links to the original KPI detail");

const sparse = buildIntelligenceLayer({ issues: [issue()] });
assert.equal(sparse.topRisk?.title, "Follow-up completion needs review", "specific issue evidence must retain its validated title");
assert.doesNotMatch(sparse.topRisk?.summary || "", /may indicate a pattern|customer response, conversion, service quality/i, "sparse evidence must not claim unsupported impacts");
assert.match(sparse.topRisk?.limitation || "", /root cause and measured business outcome/i, "weak evidence must state exactly what cannot be confirmed");

const setupOnly = buildIntelligenceLayer({ issues: [issue({ id: "setup-issue", title: "Starter checklist created during setup" })] });
assert.equal(setupOnly.topRisk, undefined, "setup/bootstrap records must not become finding evidence");
const archivedOnly = buildIntelligenceLayer({ issues: [issue({ id: "archived-issue", archived_at: "2026-07-11T00:00:00Z" })] });
assert.equal(archivedOnly.topRisk, undefined, "archived records must not become finding evidence");

const retailFile = {
  id: "retail-file", display_name: "Retail workbook.xlsx", original_name: "Retail workbook.xlsx", created_at: "2026-07-14T00:00:00Z", updated_at: "2026-07-14T00:00:00Z", archived_at: null, deleted_at: null, metadata_json: {}
};
const retailImport = { id: "retail-import", file_upload_id: retailFile.id, created_at: "2026-07-14T00:00:00Z", archived_at: null, deleted_at: null };
const months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];
function importedKpi(name, values, options = {}) {
  return values.map((actual_value, index) => ({
    id: `${name}-${index}`,
    name,
    actual_value,
    target: options.target ?? null,
    metric_date: months[index],
    source: "Uploaded workbook",
    source_file_id: retailFile.id,
    import_id: retailImport.id,
    import_row_id: `${name}-row-${index}`,
    raw_data_json: {
      "Vaeroex worksheet": "Monthly Sales",
      "Vaeroex source row": index + 2,
      "Vaeroex source file ID": retailFile.id
    },
    created_at: `2026-07-14T00:00:0${index}Z`,
    updated_at: `2026-07-14T00:00:0${index}Z`,
    archived_at: null,
    deleted_at: null
  }));
}
let operationalIndex = 0;
function operationalRow(worksheet, rowNumber, raw, overrides = {}) {
  operationalIndex += 1;
  return {
    id: `operational-${operationalIndex}`,
    source_file_id: retailFile.id,
    import_id: retailImport.id,
    import_row_id: `import-row-${operationalIndex}`,
    metric_name: overrides.metric_name || String(raw.SKU || raw.Order || raw.Customer || raw.Invoice || raw.Store || `Metric ${operationalIndex}`),
    category: overrides.category || worksheet,
    value: overrides.value ?? null,
    metric_date: overrides.metric_date || "2026-06-01",
    owner: null,
    notes: null,
    raw_data_json: { ...raw, "Vaeroex worksheet": worksheet, "Vaeroex source row": rowNumber, "Vaeroex source file ID": retailFile.id },
    created_at: `2026-07-14T00:${String(operationalIndex).padStart(2, "0")}:00Z`,
    updated_at: `2026-07-14T00:${String(operationalIndex).padStart(2, "0")}:00Z`,
    archived_at: null,
    deleted_at: null,
    ...overrides
  };
}
function memoryChunk(worksheet, index) {
  return {
    id: `chunk-${index}`,
    source_type: "file",
    source_id: retailFile.id,
    source_file_id: retailFile.id,
    source_title: `Retail workbook · ${worksheet}`,
    source_excerpt: `${worksheet} indexed evidence excerpt`,
    summary: `${worksheet} summary`,
    chunk_index: index,
    content_hash: `hash-${index}`,
    source_metadata: { worksheet_name: worksheet, evidence_classification: "business_evidence", evidence_lifecycle: "active" },
    source_quality: "high",
    confidence_score: 90,
    token_estimate: 20,
    indexed_at: "2026-07-14T01:00:00Z",
    created_at: "2026-07-14T01:00:00Z",
    updated_at: "2026-07-14T01:00:00Z",
    archived_at: null,
    deleted_at: null
  };
}
const retailKpis = [
  ...importedKpi("Revenue", [1185000, 1170000, 1150000, 1130000, 1110000, 1095000], { target: 1200000 }),
  ...importedKpi("Transactions", [18420, 18100, 17800, 17500, 17200, 16920]),
  ...importedKpi("Gross Margin %", [48.2, 47.4, 46.5, 45.6, 44.7, 43.7]),
  ...importedKpi("Returns %", [4.1, 4.6, 5.1, 5.7, 6.4, 7.1]),
  ...importedKpi("Inventory Value", [2100000, 2200000, 2300000, 2400000, 2500000, 2700000]),
  ...importedKpi("Online Sales", [42000, 44000, 46500, 49000, 52000, 54500])
];
const retailMetrics = [
  ...Array.from({ length: 6 }, (_, index) => operationalRow("Inventory", index + 2, { SKU: `SKU-${index + 1}`, Status: "Critical", "On Hand": 10 + index, "Reorder Point": 30 + index })),
  ...Array.from({ length: 12 }, (_, index) => operationalRow("Orders", index + 2, { Order: `ORD-${index + 1}`, Status: "Delayed", "Customer Complaint": index < 6 ? "Yes" : "No" })),
  ...Array.from({ length: 16 }, (_, index) => operationalRow("Customer Feedback", index + 2, { Customer: `CUST-${index + 1}`, Rating: 2, Resolved: index < 13 ? "No" : "Yes" })),
  ...Array.from({ length: 10 }, (_, index) => operationalRow("Supplier Invoices", index + 2, { Invoice: `INV-${index + 1}`, Amount: 1000 + index * 100, Status: "Overdue" })),
  ...[28.8, 31.2, 34.5, 37.1, 39.4, 42.0, 44.3, 46.2].map((margin, index) => operationalRow("Store Performance", index + 2, { Store: `Store ${index + 1}`, "Gross Margin %": margin, "Overtime Hours": 20 + index * 10 }))
];
const retailChunks = ["Monthly Sales", "Inventory", "Orders", "Customer Feedback", "Supplier Invoices", "Store Performance"].map(memoryChunk);
const retailInsights = buildOperationalEvidenceInsights({ kpis: retailKpis, operationalMetrics: retailMetrics, memoryChunks: retailChunks, files: [retailFile], imports: [retailImport] });
assert.equal(retailInsights.length, 6, "retail evidence is capped at six prioritized findings");
for (const title of [
  "Margin and returns are moving in the wrong direction",
  "Inventory increased while sales activity declined",
  "Customer and order exceptions require attention",
  "Store performance varies materially",
  "Supplier invoices include overdue obligations",
  "Online sales are increasing"
]) assert.ok(retailInsights.some((insight) => insight.title === title), `${title} must be generated deterministically`);
const customerExceptions = retailInsights.find((insight) => insight.title === "Customer and order exceptions require attention");
assert.match(customerExceptions.summary, /12 delayed orders/);
assert.match(customerExceptions.summary, /6 orders with customer complaints/);
assert.match(customerExceptions.summary, /16 feedback ratings of two or lower/);
assert.match(customerExceptions.summary, /13 unresolved feedback records/);
const inventoryFinding = retailInsights.find((insight) => insight.title === "Inventory increased while sales activity declined");
assert.match(inventoryFinding.summary, /6 inventory items .*below reorder level/);
assert.match(inventoryFinding.limitation, /do not prove|does not prove/i, "cross-metric language must reject causation");
const onlineFinding = retailInsights.find((insight) => insight.title === "Online sales are increasing");
assert.equal(onlineFinding.confidence, "Medium", "one workbook caps finding confidence at Medium");
assert.equal(onlineFinding.independentSourceCount, 1, "chunks and KPI points from one workbook remain one independent source");
assert.ok(onlineFinding.supportingRecords.some((record) => record.recordType === "Business Memory citation"), "eligible memory supports an existing finding");
assert.equal(buildOperationalEvidenceInsights({ memoryChunks: retailChunks, files: [retailFile], imports: [retailImport] }).length, 0, "memory chunks cannot independently create findings");
const withInactiveMetric = buildOperationalEvidenceInsights({
  kpis: retailKpis,
  operationalMetrics: [
    ...retailMetrics,
    operationalRow("Orders", 99, { Order: "ARCHIVED", Status: "Delayed" }, { archived_at: "2026-07-14T02:00:00Z" }),
    operationalRow("Orders", 100, { Order: "SETUP", Status: "Delayed", setup_bootstrap: true })
  ],
  memoryChunks: retailChunks,
  files: [retailFile],
  imports: [retailImport]
});
assert.match(withInactiveMetric.find((insight) => insight.title === "Customer and order exceptions require attention").summary, /12 delayed orders/, "inactive operational rows are excluded before counting");
assert.equal(buildOperationalEvidenceInsights({ kpis: retailKpis, operationalMetrics: retailMetrics, files: [{ ...retailFile, archived_at: "2026-07-14T02:00:00Z" }], imports: [retailImport] }).length, 0, "parent-ineligible operational evidence is excluded");
const returnsOnly = buildOperationalEvidenceInsights({ kpis: importedKpi("Returns %", [4.1, 4.6, 5.1, 5.7, 6.4, 7.1]), files: [retailFile], imports: [retailImport] });
assert.equal(returnsOnly[0]?.title, "Returns increased across the available periods", "an approved returns direction creates a bounded adverse trend without another metric");
const marginOnly = buildOperationalEvidenceInsights({ kpis: importedKpi("Gross Margin %", [48.2, 47.4, 46.5, 45.6, 44.7, 43.7]), files: [retailFile], imports: [retailImport] });
assert.equal(marginOnly[0]?.title, "Gross margin declined across the available periods", "an approved margin direction creates a bounded adverse trend without another metric");
const unfamiliarOnly = buildOperationalEvidenceInsights({ kpis: importedKpi("Mystery Index", [10, 20, 30, 40, 50, 60]), files: [retailFile], imports: [retailImport] });
assert.equal(unfamiliarOnly.length, 0, "unfamiliar metrics do not receive invented direction or targets");
const belowTargetOnly = buildIntelligenceLayer({ kpis: importedKpi("Revenue", [1185000, 1170000, 1150000, 1130000, 1110000, 1095000], { target: 1200000 }), files: [retailFile], imports: [retailImport] });
assert.equal(belowTargetOnly.topRisk, undefined, "8.75% below target does not cross the existing 10% risk threshold");
assert.equal(belowTargetOnly.insights.some((insight) => insight.type === "Forecast"), false, "forecast readiness does not create generic finding cards");
const deterministicLatest = buildIntelligenceLayer({
  kpis: [
    kpi({ id: "older", name: "Revenue", actual_value: 80, target: 100, metric_date: "2026-07-10", updated_at: "2026-07-10T01:00:00Z" }),
    kpi({ id: "newer", name: "revenue", actual_value: 120, target: 100, metric_date: "2026-07-10", updated_at: "2026-07-10T02:00:00Z" })
  ]
});
assert.equal(deterministicLatest.topOpportunity?.supportingRecords[0]?.id, "kpi:newer", "normalized KPI identity uses the deterministic latest-row tie-breaker");

const evidenceFixture = Array.from({ length: 120 }, (_, index) => ({
  id: `signal:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `Evidence record ${index % 17}`,
  recordType: "Source Evidence",
  date: `2026-${String((index % 6) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
  value: `Observed condition ${index % 17}`,
  support: `The saved description documents the ${["Operations", "Customer", "Finance", "Sales", "Strategy", "Vendor"][index % 6].toLowerCase()} condition summarized by this finding.`,
  href: `/app/sources#source-${index}`,
  classification: "Manual",
  sourceKey: `signal-source:${index}`,
  groupHint: ["Operations", "Customer", "Finance", "Sales", "Strategy", "Vendor"][index % 6]
}));
const evidenceGroups = buildEvidenceGroups(evidenceFixture);
assert.equal(evidenceGroups.length, 6, "six related evidence areas must produce six deterministic groups");
assert.equal(evidenceGroups.reduce((count, group) => count + group.records.length, 0), 120, "grouping must retain every eligible supporting record");
assert.equal(evidenceGroups.slice(0, collapsedEvidenceGroupLimit).length, 5, "large evidence sets expose at most five groups before disclosure");
const collapsedRepresentatives = selectCollapsedRepresentatives(evidenceGroups);
const selectedRepresentatives = Object.values(collapsedRepresentatives).flat();
assert.ok(selectedRepresentatives.length <= collapsedEvidenceRepresentativeLimit, "collapsed evidence must render no more than five representative records overall");
assert.ok(Object.values(collapsedRepresentatives).every((records) => records.length <= representativesPerEvidenceGroup), "collapsed evidence must render no more than two representatives per group");
assert.equal(new Set(selectedRepresentatives.map((record) => record.id)).size, selectedRepresentatives.length, "representative records must not repeat");
const filteredEvidenceHref = supportingEvidenceHref({
  ...sparse.topRisk,
  id: "finding-123",
  sourceHref: "/app/sources",
  supportingRecords: evidenceFixture.slice(0, 6)
});
assert.match(filteredEvidenceHref, /^\/app\/sources\?/, "source-backed findings must open the existing Evidence view");
assert.match(filteredEvidenceHref, /finding=finding-123/, "view-all links retain the finding fingerprint");
const scalableEvidenceHref = supportingEvidenceHref({
  ...sparse.topRisk,
  id: "source-signal-review-pattern",
  sourceHref: "/app/sources",
  supportingRecords: evidenceFixture
});
assert.match(scalableEvidenceHref, /^\/app\/sources\?finding=/, "large evidence sets use the bounded Evidence destination");
assert.match(supportingEvidenceHref(supported.topRisk), /\/app\/kpis\?metric=Revenue/, "single-metric evidence destinations preserve the KPI filter");

const duplicate = {
  ...supported.topRisk,
  id: "duplicate-risk",
  lastUpdated: "2026-07-11T00:00:00Z",
  supportingRecords: supported.topRisk.supportingRecords.map((record, index) => ({ ...record, id: `${record.id}-duplicate-${index}`, sourceKey: `${record.sourceKey}-duplicate-${index}` })),
  fingerprint: ""
};
const consolidated = consolidateDuplicateInsights([supported.topRisk, duplicate]);
assert.equal(consolidated.length, 1, "visually identical findings in the same reporting period must consolidate");
assert.equal(consolidated[0].supportingRecords.length, 6, "consolidation preserves all distinct supporting records");

const noDirectMetric = buildIntelligenceLayer({});
assert.equal(noDirectMetric.topRisk, undefined, "missing metrics must not create a fabricated risk");
const fallback = fallbackGeneratedOutputSource("executive_briefing", noDirectMetric);
assert.equal(fallback.confidence, "Low", "no-evidence brief fallback remains low confidence");

const brief = buildGeneratedOutput({ type: "executive_briefing", source: supported.topRisk, intelligence: supported, workspaceName: "Demo" });
assert.equal(brief.label, "Executive Brief", "brief label must avoid generated-output terminology");
assert.equal(brief.priority, "High", "brief preserves the finding priority");
assert.match(brief.markdown, /Priority: High/, "portable brief preserves priority");
const authoritativeSource = require("../lib/intelligence/generated-output.ts").sourceFromSearchParams({
  params: new URLSearchParams({ source: supported.topRisk.id, title: "Unsupported replacement title" }),
  intelligence: supported
});
assert.equal(authoritativeSource.title, supported.topRisk.title, "matched finding text cannot be replaced through query parameters");

const inboxSource = fs.readFileSync(path.join(root, "components/intelligence/IntelligenceSignalInbox.tsx"), "utf8");
const outputPageSource = fs.readFileSync(path.join(root, "app/app/reports/new/page.tsx"), "utf8");
const legacyOutputPageSource = fs.readFileSync(path.join(root, "app/app/generated/new/page.tsx"), "utf8");
const savedReportSource = fs.readFileSync(path.join(root, "app/app/reports/[id]/page.tsx"), "utf8");
const saveActionSource = fs.readFileSync(path.join(root, "app/app/reports/saved-analysis-actions.ts"), "utf8");
const intelligencePageSource = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
const appNavigationSource = fs.readFileSync(path.join(root, "components/app/AppNavigation.tsx"), "utf8");
const sourcesPageSource = fs.readFileSync(path.join(root, "app/app/sources/page.tsx"), "utf8");
assert.match(inboxSource, /label: "Summary".*label: "Evidence".*label: "Analysis"/s, "selected findings may expose one bounded analysis view when authorized");
assert.doesNotMatch(inboxSource, /label: "Understand"|label: "Executive Brief"/, "overlapping finding tabs must be removed");
assert.match(inboxSource, /Explain Finding/, "risk findings expose one bounded investigation action");
assert.doesNotMatch(inboxSource, /Create Investigation Summary/, "the retired summary label must not remain in the Intelligence experience");
assert.doesNotMatch(inboxSource, /Generate Executive Briefing|Generate Improvement Plan|Explain This/, "normal finding review must not show competing generator actions");
assert.match(inboxSource, /explainFindingAction\(requestToken\)/, "Explain Finding must use the fixed server-side generation action");
assert.match(inboxSource, /buildEvidenceGroups\(insight\.supportingRecords\)/, "evidence view must group supporting records deterministically");
assert.match(inboxSource, /signalTypes\.filter\(\(type\) => counts\[type\] > 0\)/, "zero-count finding categories must be hidden");
assert.match(inboxSource, /useState<SignalView>\("All"\)/, "All findings is the default executive view");
assert.match(inboxSource, /Positive signals/, "opportunities use plain executive language");
assert.match(inboxSource, /Vaeroex found related records, but the available information does not identify an owner, completed outcome, or measurable business effect\./, "weak findings must use a concise specificity fallback");
assert.match(inboxSource, /More information needed: owner, completion status, and outcome\./, "weak findings must state the missing fields directly");
assert.match(inboxSource, /selectCollapsedRepresentatives\(groups\)/, "evidence view must use bounded representative records");
assert.match(inboxSource, /expandedGroupKey.*showAllGroups.*expandedRecordLimit/s, "evidence groups must support one-at-a-time expansion, collapse, and explicit pagination");
assert.match(inboxSource, /View all supporting records/, "evidence view must link to the existing filtered record surface");
assert.match(inboxSource, /Independent sources/, "evidence view must disclose independent-source count");
assert.match(inboxSource, /insight\.contradictoryEvidence\.length \? \(/, "contradictory evidence must render only when it exists");
assert.match(inboxSource, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(23rem,.82fr\)\]/, "desktop uses a master-detail layout while mobile stays single-column");
assert.match(inboxSource, /grid gap-4 xl:grid-cols/, "finding layout remains single-column before the desktop breakpoint");
assert.match(inboxSource, /xl:max-h-\[calc\(100dvh-8rem\)\].*xl:overflow-y-auto/, "desktop detail panel scrolls independently");
assert.doesNotMatch(inboxSource, /(?<!xl:)max-h-\[calc\(100dvh|(?<!xl:)overflow-y-auto/, "mobile evidence flow must not create a nested viewport scroller");
assert.match(sourcesPageSource, /\.eq\("workspace_id", workspaceId\)/, "supporting Evidence destinations remain workspace scoped");
assert.match(sourcesPageSource, /filterEligibleMemoryRowsByLifecycle/, "supporting Evidence destinations must validate lifecycle lineage");
assert.match(outputPageSource, /permanentRedirect\("\/app\/reports"\)/, "retired report-draft routes must redirect to Reports");
assert.match(legacyOutputPageSource, /permanentRedirect\("\/app\/reports"\)/, "legacy generated routes must redirect to Reports");
assert.match(inboxSource, /SaveAnalysisButton analysisType="finding_explanation"/, "completed finding explanations must expose explicit Save Analysis");
assert.match(saveActionSource, /artifact: completed\.artifact/, "saved analyses must copy the exact validated artifact");
assert.match(saveActionSource, /source_data_json: envelope/, "saved analyses must persist the versioned copied envelope");
assert.match(savedReportSource, /SavedAnalysisRenderer/, "saved analyses must reopen through the read-only renderer");
assert.match(appNavigationSource, /pathname\.startsWith\(`\$\{href\}\//, "nested Intelligence and Reports routes must keep their sidebar section active");
assert.doesNotMatch(intelligencePageSource, /Forecast Summary/, "weak forecast readiness is not promoted into the executive summary");
assert.match(intelligencePageSource, /from\("operational_metrics"\)/, "Intelligence loads bounded operational evidence");
assert.match(intelligencePageSource, /filterEligibleMemoryRowsByLifecycle/, "Intelligence validates memory parent lifecycle before citation use");

process.stdout.write("Intelligence experience regressions passed.\n");
