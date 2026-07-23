const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const semanticSource = read("lib/presentation/semantic-status.ts");
const styles = read("app/globals.css");
const homepage = read("components/intelligence/ExecutiveHomepage.tsx");
const inbox = read("components/intelligence/IntelligenceSignalInbox.tsx");
const healthPanel = read("components/intelligence/BusinessHealthAnalysisPanel.tsx");
const kpis = read("app/app/kpis/page.tsx");
const homepageModel = read("lib/intelligence/executive-homepage.ts");

function lightToken(name) {
  const match = styles.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(match, `${name} must define a light-theme color`);
  return match[1];
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const status of ["critical", "risk-high", "risk-medium", "positive", "opportunity", "anomaly", "neutral", "unavailable"]) {
  assert.match(semanticSource, new RegExp(`\\"${status}\\"`), `${status} must remain a centralized semantic status`);
  assert.match(styles, new RegExp(`vaeroex-semantic-${status}`), `${status} must have a theme-aware presentation token`);
  const ratio = contrast(lightToken(`--semantic-${status}-fg`), lightToken(`--semantic-${status}-bg`));
  assert.ok(ratio >= 4.5, `${status} light-theme text must meet a 4.5:1 contrast ratio; received ${ratio.toFixed(2)}:1`);
}

assert.match(semanticSource, /type === "Opportunity"\) return "opportunity"/, "opportunities must use the blue opportunity identity");
assert.match(semanticSource, /type === "Anomaly"\) return "anomaly"/, "anomalies must retain a category-specific purple identity");
assert.match(semanticSource, /priority === "High"\) return "risk-high"/, "priority must remain separate from category identity");
assert.match(semanticSource, /hasTarget: boolean[\s\S]*hasDirection: boolean/, "KPI semantics must distinguish missing targets and directions");

assert.match(homepage, /label: "Top Opportunity"/, "Overview must use the approved opportunity wording");
assert.doesNotMatch(homepage, /Positive Signal/, "Overview must not relabel an opportunity as a generic positive signal");
assert.match(homepage, /card\.tone === "risk"\) return "critical"/, "risk category identity must not inherit its priority color");
assert.match(homepage, /\{!card\.empty \? <span className=\{`vaeroex-semantic-badge/, "each non-empty executive priority must display urgency separately from category identity");
assert.match(homepage, /businessHealthStatus\(model\.health\.status\)/, "Business Health state must be rendered through the shared semantic layer");
assert.match(homepage, /intelligenceReadinessStatus\(model\.readiness\.label\)/, "Readiness state must be rendered through the shared semantic layer");
assert.match(inbox, /findingCategoryStatus\(insight\.type\)/, "finding category identity must be applied in the Intelligence list");
assert.match(inbox, /findingPriorityStatus\(insight\.priority\)/, "finding urgency must remain separate from category identity");
assert.match(healthPanel, /businessHealthStatus\(factsForDisplay\.status\)/, "Business Health analysis must use the shared state semantics without changing its content model");

assert.match(kpis, /function metricTone\(/, "KPI scoring classification must remain in its existing deterministic function");
assert.match(kpis, /actual === null \|\| target === null \|\| !direction/, "KPI status must remain neutral without an explicit target and direction");
assert.match(kpis, /kpiStatus\(\{[\s\S]*hasCurrentValue: kpi\.actual_value !== null[\s\S]*hasTarget: kpi\.target !== null[\s\S]*hasDirection: Boolean\(direction\)/, "KPI rendering must derive semantic treatment from the existing facts only");
assert.match(homepageModel, /priority: insight\.priority/, "Executive homepage priority must preserve the existing intelligence priority");
assert.doesNotMatch(homepageModel, /PositiveSignal/, "The homepage model must not create a new positive-signal classification");

console.log("Semantic visual-priority regressions passed.");
