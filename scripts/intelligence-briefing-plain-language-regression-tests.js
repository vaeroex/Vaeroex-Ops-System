const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  intelligenceBriefingCustomerCitation,
  intelligenceBriefingCustomerSourceLabel,
  intelligenceBriefingCustomerText,
  intelligenceBriefingDesiredDirectionSentence,
  intelligenceBriefingExplicitDate,
  intelligenceBriefingMetricValue,
  intelligenceBriefingMovementSentence,
  intelligenceBriefingPlainLanguageIssue,
  intelligenceBriefingPlainPeriodLabel,
  intelligenceBriefingReadingGrade,
  intelligenceBriefingTargetSentence
} = require("../lib/ai/intelligence-briefing/plain-language.ts");

const prohibited = /canonical KPI semantics|authoritative target|dated periods|performance effect indeterminate|movement insufficient_data|above_acceptable_maximum|below_acceptable_minimum|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

assert.equal(intelligenceBriefingExplicitDate("2026-07-27"), "July 27, 2026");
assert.equal(
  intelligenceBriefingPlainPeriodLabel({ start: "2026-07-20", end: "2026-08-18" }),
  "July 20, 2026 through August 18, 2026"
);
assert.equal(intelligenceBriefingMetricValue(1_040_000, "$", "Revenue"), "$1.04 million");
assert.equal(intelligenceBriefingMetricValue(38.5, "%", "Gross Margin"), "38.5%");
assert.equal(intelligenceBriefingMetricValue(37, "count", "One-Star Reviews"), "37");
assert.equal(intelligenceBriefingMetricValue(12.5, "%", "Sales conversion"), "12.5%");
assert.equal(intelligenceBriefingMetricValue(14, "count", "Sales orders"), "14");

const mappedExamples = intelligenceBriefingCustomerText([
  "No authoritative target is configured.",
  "Movement insufficient_data.",
  "Performance effect indeterminate."
].join(" "));
assert.equal(mappedExamples, "No target has been set for this metric. There is not enough recent data to determine whether this result is improving or declining. The available evidence does not show the business impact.");
assert.doesNotMatch(mappedExamples, prohibited);

const targetExample = intelligenceBriefingCustomerText("1-Star Reviews was 37 count on 2026-07-27. Target status is above_acceptable_maximum against the authoritative target of 23.");
assert.equal(targetExample, "The business recorded 37 one-star reviews on July 27, 2026. One-star reviews reached 37, which is 14 above the maximum target of 23.");
assert.doesNotMatch(targetExample, prohibited);

const arithmetic = intelligenceBriefingTargetSentence({
  metricName: "One-Star Reviews",
  latestValue: 37,
  unit: "count",
  target: { kind: "scalar", value: 23 },
  status: "above_acceptable_maximum"
});
assert.equal(arithmetic, "One-star reviews reached 37, which is 14 above the maximum target of 23.");
assert.equal(intelligenceBriefingTargetSentence({
  metricName: "Gross Margin",
  latestValue: 38.5,
  unit: "%",
  target: { kind: "range", min: 35, max: 38 },
  status: "above_acceptable_maximum"
}), "Gross Margin reached 38.5%, which is 0.5% above the maximum target of 38%.");

const duringPeriod = intelligenceBriefingMovementSentence({
  metricName: "Revenue",
  startValue: 820_000,
  endValue: 1_040_000,
  unit: "$",
  startDate: "2026-07-20",
  endDate: "2026-08-18",
  observationCount: 6,
  movement: "increased",
  fullyInsideBriefingPeriod: true
});
assert.equal(duringPeriod, "During this briefing period, Revenue increased from $820,000 on July 20, 2026 to $1.04 million on August 18, 2026 across six recorded dates.");
const historical = intelligenceBriefingMovementSentence({
  metricName: "Revenue",
  startValue: 820_000,
  endValue: 1_040_000,
  unit: "$",
  startDate: "2026-05-01",
  endDate: "2026-08-18",
  observationCount: 6,
  movement: "increased",
  fullyInsideBriefingPeriod: false
});
assert.equal(historical, "Historical context through August 18, 2026, Revenue was $1.04 million.");
assert.doesNotMatch(historical, /\$820,000|six recorded dates|during this briefing period/i, "historical wording must not imply that the full trend occurred inside the window");

for (const fixture of [
  ["Sales", 125, "count", "maximize"],
  ["Gross Margin", 38.5, "%", "maximize"],
  ["Average Checkout Wait", 6.2, "minutes", "minimize"],
  ["One-Star Reviews", 37, "count", "minimize"],
  ["Employee Retention", 94, "%", "maximize"],
  ["Custom Throughput", 52, "units", "maximize"]
]) {
  const [name, value, unit, direction] = fixture;
  const sentence = `${name} was ${intelligenceBriefingMetricValue(value, unit, name)} on ${intelligenceBriefingExplicitDate("2026-08-18")}. ${intelligenceBriefingDesiredDirectionSentence(name, direction)}`;
  assert.match(sentence, new RegExp(name, "i"));
  assert.doesNotMatch(sentence, /\bthe KPI\b|\bthe metric\b|_/i);
}

const internalCitation = {
  citationId: 1,
  title: "Revenue",
  sourceLabel: "preview_fixture",
  sourceType: "intelligence_layer_source",
  excerpt: "Movement insufficient_data. Recorded on 2026-07-27.",
  recordedAt: "2026-07-27T00:00:00.000Z",
  href: "/app/kpis?metric=Revenue&section=detail"
};
const originalCitation = JSON.parse(JSON.stringify(internalCitation));
const customerCitation = intelligenceBriefingCustomerCitation(internalCitation);
assert.deepEqual(internalCitation, originalCitation, "customer presentation must not mutate stored citation lineage");
assert.equal(customerCitation.sourceLabel, "Revenue");
assert.equal(customerCitation.sourceType, "Business evidence");
assert.doesNotMatch(JSON.stringify({
  title: customerCitation.title,
  sourceLabel: customerCitation.sourceLabel,
  sourceType: customerCitation.sourceType,
  excerpt: customerCitation.excerpt
}), /preview_fixture|intelligence_layer_source|insufficient_data|2026-07-27/);
assert.equal(customerCitation.href, internalCitation.href, "the customer-safe view must preserve the exact supporting evidence route");
assert.equal(intelligenceBriefingCustomerSourceLabel("11111111-1111-4111-8111-111111111111", "Retail workbook"), "Retail workbook");

assert.equal(intelligenceBriefingPlainLanguageIssue("Movement insufficient_data.", { label: "Revenue" }), "internal_language");
assert.equal(intelligenceBriefingPlainLanguageIssue("The KPI improved during this period.", { label: "Revenue" }), "unnamed_metric");
assert.equal(intelligenceBriefingPlainLanguageIssue("Revenue moved the needle this month.", { label: "Revenue" }), "idiom");
assert.equal(intelligenceBriefingPlainLanguageIssue("Revenue increased on 2026-08-18.", { label: "Revenue" }), "ambiguous_date");
assert.equal(intelligenceBriefingPlainLanguageIssue("Revenue increased on August 18, 2026.", { label: "Revenue" }), null);
assert.ok(intelligenceBriefingReadingGrade("Revenue increased. Leaders can review the latest result.") <= 9.5);

const viewer = fs.readFileSync(path.join(root, "components/intelligence/IntelligenceBriefingViewer.tsx"), "utf8");
const savedRenderer = fs.readFileSync(path.join(root, "components/reports/SavedAnalysisRenderer.tsx"), "utf8");
const service = fs.readFileSync(path.join(root, "lib/ai/intelligence-briefing/service.ts"), "utf8");
const evidence = fs.readFileSync(path.join(root, "lib/ai/intelligence-briefing/evidence.ts"), "utf8");
assert.match(viewer, />Summary</);
assert.match(viewer, />Leadership Actions</);
assert.match(viewer, />Evidence Limits</);
assert.match(viewer, /artifact\.contextReferences\.length[\s\S]*business_updates_context/, "Business Updates require actual contextual updates");
assert.doesNotMatch(viewer, /Approved reported context|Evidence, confidence & limitations/);
assert.doesNotMatch(viewer, /This briefing synthesizes the information currently available/, "limitations must be consolidated under Evidence Limits");
assert.match(savedRenderer, /intelligenceBriefingCustomerCitation/, "immutable Saved Briefings receive the same customer-safe presentation mapping at render time");
assert.match(service, /seventh- to ninth-grade English reading level/);
assert.match(service, /temporal_lineage/);
assert.match(evidence, /safeAppHref\(record\.href/, "Open source must retain the route to the evidence that visibly supports a finding");

console.log("Intelligence Briefing plain-language regressions passed.");
