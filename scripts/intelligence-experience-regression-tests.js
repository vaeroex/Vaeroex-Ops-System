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

function signal(overrides = {}) {
  return {
    id: "signal-1", title: "Follow-up completion needs review", description: "Several follow-up records need review.", category: "Operations", status: "open", related_type: null, due_date: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z",
    ...overrides
  };
}

const supported = buildIntelligenceLayer({ kpis: [kpi(), kpi({ id: "kpi-2", metric_date: "2026-06-10", actual_value: 85 }), kpi({ id: "kpi-3", metric_date: "2026-05-10", actual_value: 90 })] });
assert.equal(supported.topRisk?.title, "Revenue remained below target for 2 periods", "supported KPI findings state the observed duration directly");
assert.equal(supported.topRisk?.confidence, "High", "historical KPI evidence supports high confidence");
assert.equal(supported.topRisk?.supportingRecords.length, 3, "KPI findings retain concrete supporting records");
assert.match(supported.topRisk?.supportingRecords[0]?.href || "", /\/app\/kpis\?metric=Revenue/, "KPI evidence links to the original KPI detail");

const sparse = buildIntelligenceLayer({ tasks: [signal()] });
assert.equal(sparse.topRisk?.title, "Customer follow-up ownership is unclear", "specific signal evidence must replace generic pattern titles");
assert.doesNotMatch(sparse.topRisk?.summary || "", /may indicate a pattern|customer response, conversion, service quality/i, "sparse signals must not claim unsupported impacts");
assert.match(sparse.topRisk?.impact || "", /no measured outcome/i, "sparse signal impact must retain uncertainty");
assert.match(sparse.topRisk?.limitation || "", /one recurring process failure/i, "weak evidence must state exactly what cannot be confirmed");

const setupOnly = buildIntelligenceLayer({ tasks: [signal({ id: "setup-signal", title: "Starter checklist created during setup" })] });
assert.equal(setupOnly.topRisk, undefined, "setup/bootstrap records must not become finding evidence");
const archivedOnly = buildIntelligenceLayer({ tasks: [signal({ id: "archived-signal", archived_at: "2026-07-11T00:00:00Z" })] });
assert.equal(archivedOnly.topRisk, undefined, "archived records must not become finding evidence");

const evidenceFixture = Array.from({ length: 120 }, (_, index) => ({
  id: `signal:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `Evidence record ${index % 17}`,
  recordType: "Business Signal",
  date: `2026-${String((index % 6) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
  value: `Observed condition ${index % 17}`,
  support: `The saved description documents the ${["Operations", "Customer", "Finance", "Sales", "Strategy", "Vendor"][index % 6].toLowerCase()} condition summarized by this finding.`,
  href: `/app/tasks#signal-${index}`,
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
  supportingRecords: evidenceFixture.slice(0, 6)
});
assert.match(filteredEvidenceHref, /^\/app\/tasks\?/, "Business Signal findings must open the existing Business Signals view");
assert.match(filteredEvidenceHref, /finding=finding-123/, "view-all links retain the finding fingerprint");
assert.match(filteredEvidenceHref, /evidence_ids=/, "view-all links retain the exact supporting record IDs");
const scalableEvidenceHref = supportingEvidenceHref({
  ...sparse.topRisk,
  id: "source-signal-review-pattern",
  supportingRecords: evidenceFixture
});
assert.match(scalableEvidenceHref, /evidence_scope=related-signal-pattern/, "large evidence sets use a bounded deterministic filter instead of an oversized ID list");
assert.doesNotMatch(scalableEvidenceHref, /evidence_ids=/, "large evidence destinations must not create unbounded URLs");
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
const saveActionSource = fs.readFileSync(path.join(root, "app/app/generated/actions.ts"), "utf8");
const intelligencePageSource = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
const appNavigationSource = fs.readFileSync(path.join(root, "components/app/AppNavigation.tsx"), "utf8");
const businessSignalsSource = fs.readFileSync(path.join(root, "app/app/tasks/page.tsx"), "utf8");
assert.match(inboxSource, /label: "Summary".*label: "Evidence"/s, "selected finding must expose Summary and Evidence only");
assert.doesNotMatch(inboxSource, /label: "Understand"|label: "Executive Brief"/, "overlapping finding tabs must be removed");
assert.match(inboxSource, /Create Investigation Summary/, "risk findings expose one normalized report action");
assert.doesNotMatch(inboxSource, /Generate Executive Briefing|Generate Improvement Plan|Explain This/, "normal finding review must not show competing generator actions");
assert.match(inboxSource, /buildEvidenceGroups\(insight\.supportingRecords\)/, "evidence view must group supporting records deterministically");
assert.match(inboxSource, /signalTypes\.filter\(\(type\) => counts\[type\] > 0\)/, "zero-count finding categories must be hidden");
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
assert.match(businessSignalsSource, /\.eq\("workspace_id", workspaceId\)/, "supporting-record destinations remain workspace scoped");
assert.match(businessSignalsSource, /showArchived = param\(params\?\.view\) === "archived" && !evidenceFilterRequested/, "supporting-record destinations must remain active-only even if the view parameter is altered");
assert.match(businessSignalsSource, /archived_at \|\| signal\.deleted_at.*evidenceFilterRequested/s, "lifecycle eligibility must be applied before evidence-ID filtering");
assert.match(businessSignalsSource, /evidence_ids/, "Business Signals must honor exact supporting-record filters");
assert.doesNotMatch(outputPageSource, /<pre/, "report draft must not render raw markdown syntax");
assert.match(outputPageSource, /Draft · Not saved/, "new briefs must disclose their unsaved state");
assert.match(outputPageSource, /Back to finding/, "brief route must return to the Intelligence context");
for (const heading of ["Executive summary", "Evidence-backed facts", "Decision required", "Recommended next step", "Limitation"]) assert.match(outputPageSource, new RegExp(heading));
assert.match(outputPageSource, /Review evidence/);
assert.match(outputPageSource, /Save report/);
assert.match(outputPageSource, /source_title: sourceTitle/, "saved report metadata must retain the original finding title without a repeated report-type prefix");
assert.doesNotMatch(outputPageSource, /GeneratedOutputControls|Download Markdown|Print \/ Save PDF|Copy/, "unsaved drafts must expose only review and save actions");
assert.match(legacyOutputPageSource, /permanentRedirect\(`\/app\/reports\/new/, "legacy generated route must permanently redirect to Reports");
assert.match(saveActionSource, /\.select\("id"\)\s*\.single\(\)/s, "saving a draft must select its saved report ID");
assert.match(saveActionSource, /redirect\(`\/app\/reports\/\$\{report\.id\}/, "saving a draft must redirect to the saved report detail");
assert.match(savedReportSource, /Generated from Intelligence finding/, "saved reports preserve a route to the origin finding");
assert.match(appNavigationSource, /pathname\.startsWith\(`\$\{href\}\//, "nested Intelligence and Reports routes must keep their sidebar section active");
assert.doesNotMatch(intelligencePageSource, /Forecast Summary/, "weak forecast readiness is not promoted into the executive summary");

process.stdout.write("Intelligence experience regressions passed.\n");
