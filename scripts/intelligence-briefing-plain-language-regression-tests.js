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
const {
  composeIntelligenceBriefingExecutiveSummary,
  intelligenceBriefingEvidenceLimitsLabel,
  intelligenceBriefingPresentationLimitations
} = require("../lib/ai/intelligence-briefing/presentation.ts");

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

const presentationFixture = {
  analysis: {
    executive_summary: { text: "Revenue reached $1.04 million on July 27, 2026.", support_refs: ["K1"] },
    sections: [
      {
        section_id: "financial_performance",
        summary: "Revenue reached $1.04 million on July 27, 2026 and shows a favorable historical trend.",
        support_refs: ["K1"],
        claims: []
      },
      {
        section_id: "customers_market",
        summary: "The business recorded 37 one-star reviews on July 27, 2026, which was 14 above the maximum target of 23.",
        support_refs: ["K2"],
        claims: []
      }
    ],
    leadership_considerations: [{
      text: "Review why one-star reviews exceeded the maximum target using the available evidence.",
      support_refs: ["K2"]
    }],
    limitation_refs: ["L1", "L2", "L3"]
  },
  signals: [
    {
      ref: "K1",
      stableKey: "a".repeat(64),
      kind: "kpi",
      authority: "measured_evidence",
      sectionId: "financial_performance",
      label: "Revenue",
      fact: "Revenue reached $1.04 million on July 27, 2026 and shows a favorable historical trend.",
      confidence: "Medium",
      citationIds: [1],
      evidenceReferenceIds: ["revenue-evidence"],
      limitation: null,
      periodRelation: "continuing",
      periodContext: "historical_context",
      semanticState: { desiredDirection: "maximize", targetStatus: "moving_toward_target", performanceEffect: "favorable", metricRole: "primary" }
    },
    {
      ref: "K2",
      stableKey: "b".repeat(64),
      kind: "kpi",
      authority: "measured_evidence",
      sectionId: "customers_market",
      label: "One-star reviews",
      fact: "The business recorded 37 one-star reviews on July 27, 2026, which was 14 above the maximum target of 23.",
      confidence: "Medium",
      citationIds: [2],
      evidenceReferenceIds: ["review-evidence"],
      limitation: null,
      periodRelation: "new_or_changed",
      periodContext: "briefing_period",
      semanticState: { desiredDirection: "minimize", targetStatus: "above_acceptable_maximum", performanceEffect: "unfavorable", metricRole: "primary" }
    }
  ],
  eligibility: "limited",
  evidenceCoverage: {
    supportingRecordCount: 47,
    independentSourceCount: 1,
    freshness: "current",
    latestEvidenceAt: "2026-07-27T00:00:00.000Z",
    overallCoverage: 44,
    coverageLabel: "Limited",
    includedDomains: ["Financial Performance", "Customers & Market"],
    missingOrWeakDomains: ["Operations", "Workforce"]
  },
  limitations: [
    { ref: "L1", text: "Customers has limited evidence coverage." },
    { ref: "L2", text: "Financials has limited evidence coverage." },
    { ref: "L3", text: "Evidence coverage is limited." },
    { ref: "L4", text: "Business Updates provide context. They are not independently measured evidence." },
    { ref: "L5", text: "Business Notes are reported context, not independently measured proof." },
    { ref: "L6", text: "KPI history does not prove causation." },
    { ref: "L7", text: "The KPI history confirms favorable movement, not causation or future performance." }
  ],
  contextReferences: [{ ref: "N1" }]
};
const immutablePresentationInput = JSON.parse(JSON.stringify(presentationFixture));
const synthesizedSummary = composeIntelligenceBriefingExecutiveSummary(presentationFixture);
const summarySentences = synthesizedSummary.text.split(/(?<=[.!?])\s+/).filter(Boolean);
const summaryWords = synthesizedSummary.text.split(/\s+/).filter(Boolean).length;
assert.notEqual(synthesizedSummary.text, presentationFixture.analysis.executive_summary.text, "the executive summary cannot remain a single accepted observation");
assert.equal(summarySentences.length, 3, "the executive synthesis uses two facts and one bounded leadership sentence");
assert.ok(summaryWords >= 45 && summaryWords <= 80, `the executive synthesis must remain within the 45-80 word target, observed ${summaryWords}`);
assert.match(synthesizedSummary.text, /Revenue reached \$1\.04 million/);
assert.match(synthesizedSummary.text, /37 one-star reviews/);
assert.match(synthesizedSummary.text, /limited evidence/);
assert.deepEqual(new Set(synthesizedSummary.support_refs), new Set(["K1", "K2"]), "every summary fact retains its accepted support reference");
assert.doesNotMatch(synthesizedSummary.text, /Revenue.*(?:caused|drove|explained).*one-star reviews/i, "the synthesis must not connect independent facts");

const presentationLimitations = intelligenceBriefingPresentationLimitations(presentationFixture);
assert.equal(presentationLimitations.filter((value) => /limited eligible evidence/i.test(value)).length, 1);
assert.equal(presentationLimitations.filter((value) => /Business Updates provide context/i.test(value)).length, 1);
assert.equal(presentationLimitations.filter((value) => /caused a change/i.test(value)).length, 1);
assert.doesNotMatch(presentationLimitations.join(" "), /Customers has limited|Financials has limited/);
assert.doesNotMatch(presentationLimitations.join(" "), /not causation or future performance/, "semantically equivalent historical-causation limitations are consolidated");
assert.equal(intelligenceBriefingEvidenceLimitsLabel(presentationFixture), "Evidence limits · 47 records from 1 source · Limited");
assert.deepEqual(presentationFixture, immutablePresentationInput, "presentation projection must not rewrite an immutable current or Saved Briefing artifact");

const viewer = fs.readFileSync(path.join(root, "components/intelligence/IntelligenceBriefingViewer.tsx"), "utf8");
const savedRenderer = fs.readFileSync(path.join(root, "components/reports/SavedAnalysisRenderer.tsx"), "utf8");
const evidenceLimits = fs.readFileSync(path.join(root, "components/intelligence/BriefingEvidenceLimits.tsx"), "utf8");
const service = fs.readFileSync(path.join(root, "lib/ai/intelligence-briefing/service.ts"), "utf8");
const evidence = fs.readFileSync(path.join(root, "lib/ai/intelligence-briefing/evidence.ts"), "utf8");
assert.match(viewer, />Summary</);
assert.match(viewer, />Leadership Actions</);
assert.match(viewer, /BriefingEvidenceLimits/);
assert.match(viewer, /artifact\.contextReferences\.length[\s\S]*business_updates_context/, "Business Updates require actual contextual updates");
assert.doesNotMatch(viewer, /Approved reported context|Evidence, confidence & limitations/);
assert.doesNotMatch(viewer, /This briefing synthesizes the information currently available/, "limitations must be consolidated under Evidence Limits");
assert.match(savedRenderer, /intelligenceBriefingCustomerCitation/, "immutable Saved Briefings receive the same customer-safe presentation mapping at render time");
assert.match(savedRenderer, /BriefingEvidenceLimits/, "Saved Briefings use the same collapsed evidence presentation without changing storage");
assert.match(savedRenderer, /briefingSummary\.support_refs\.flatMap/, "Saved Briefing summary citations come from accepted claim support references");
assert.match(savedRenderer, /saved-briefing-citation-/, "Saved Briefing summary citations link to the immutable evidence list");
assert.match(evidenceLimits, /<details className=/, "Evidence Limits uses a native accessible disclosure");
assert.doesNotMatch(evidenceLimits, /<details[^>]*\sopen(?:=|\s|>)/, "Evidence Limits is collapsed initially");
assert.match(evidenceLimits, /<summary className=/, "the disclosure has a keyboard-operable native summary");
assert.match(evidenceLimits, /focus-visible:ring/, "the disclosure retains visible keyboard focus");
assert.match(evidenceLimits, /Missing or weak coverage:/, "weak areas are presented once as a grouped line");
assert.match(service, /seventh- to ninth-grade English reading level/);
assert.match(service, /temporal_lineage/);
assert.match(evidence, /safeAppHref\(record\.href/, "Open source must retain the route to the evidence that visibly supports a finding");

console.log("Intelligence Briefing plain-language regressions passed.");
