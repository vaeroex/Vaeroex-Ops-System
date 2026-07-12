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

const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");
const { buildGeneratedOutput, fallbackGeneratedOutputSource } = require("../lib/intelligence/generated-output.ts");

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
assert.equal(supported.topRisk?.title, "Revenue is below target", "supported KPI findings retain a direct conclusion");
assert.equal(supported.topRisk?.confidence, "High", "historical KPI evidence supports high confidence");

const sparse = buildIntelligenceLayer({ tasks: [signal()] });
assert.equal(sparse.topRisk?.title, "Follow-up process requires review", "specific signal evidence must replace generic pattern titles");
assert.doesNotMatch(sparse.topRisk?.summary || "", /may indicate a pattern|customer response, conversion, service quality/i, "sparse signals must not claim unsupported impacts");
assert.match(sparse.topRisk?.impact || "", /not confirmed/i, "sparse signal impact must retain uncertainty");

const noDirectMetric = buildIntelligenceLayer({});
assert.equal(noDirectMetric.topRisk, undefined, "missing metrics must not create a fabricated risk");
const fallback = fallbackGeneratedOutputSource("executive_briefing", noDirectMetric);
assert.equal(fallback.confidence, "Low", "no-evidence brief fallback remains low confidence");

const brief = buildGeneratedOutput({ type: "executive_briefing", source: supported.topRisk, intelligence: supported, workspaceName: "Demo" });
assert.equal(brief.label, "Executive Brief", "brief label must avoid generated-output terminology");
assert.equal(brief.priority, "High", "brief preserves the finding priority");
assert.match(brief.markdown, /Priority: High/, "portable brief preserves priority");

const inboxSource = fs.readFileSync(path.join(root, "components/intelligence/IntelligenceSignalInbox.tsx"), "utf8");
const outputPageSource = fs.readFileSync(path.join(root, "app/app/generated/new/page.tsx"), "utf8");
const intelligencePageSource = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
assert.match(inboxSource, /Understand.*Evidence.*Executive Brief/s, "selected finding must expose exactly the three primary review modes");
assert.doesNotMatch(inboxSource, /Generate Investigation Summary|Generate Executive Briefing|Generate Improvement Plan|Explain This/, "normal finding review must not show competing generator actions");
assert.match(inboxSource, /Contradictory evidence has not been recorded/, "evidence view must state the absence of recorded contradictory evidence carefully");
assert.match(inboxSource, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(23rem,.82fr\)\]/, "desktop uses a master-detail layout while mobile stays single-column");
assert.doesNotMatch(outputPageSource, /<pre/, "printable brief must not render raw markdown syntax");
assert.match(outputPageSource, /Draft · Not saved/, "new briefs must disclose their unsaved state");
assert.match(outputPageSource, /Back to finding/, "brief route must return to the Intelligence context");
assert.doesNotMatch(intelligencePageSource, /Forecast Summary/, "weak forecast readiness is not promoted into the executive summary");

process.stdout.write("Intelligence experience regressions passed.\n");
