const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const page = read("app/app/kpis/page.tsx");
const providerPolicy = read("lib/ai/providers/workflow-provider-policy.ts");
const providerManager = read("lib/ai/providers/provider-manager.ts");
const packageJson = read("package.json");
const customerSource = [page, providerPolicy, providerManager].join("\n");

assert.doesNotMatch(customerSource, /Executive KPI Analysis|Generate Executive Analysis/);
assert.doesNotMatch(page, /executive-kpi-analysis|ExecutiveKpiAnalysis|generateExecutiveKpiAnalysisAction/);
assert.doesNotMatch(providerPolicy, /ExecutiveKpiAnalysis|EXECUTIVE_KPI_ANALYSIS|executive_kpi_analysis/);
assert.doesNotMatch(providerManager, /\| "unknown_signal_id"/);

assert.equal(exists("app/app/kpis/executive-analysis/actions.ts"), false);
assert.equal(exists("components/intelligence/ExecutiveKpiAnalysis.tsx"), false);
for (const file of ["context.ts", "contracts.ts", "service.ts", "storage.ts", "token.ts", "validation.ts"]) {
  assert.equal(exists(`lib/ai/executive-kpi-analysis/${file}`), false);
}
assert.equal(exists("scripts/executive-kpi-analysis-regression-tests.js"), false);

assert.match(page, /<OverlayTrendChart trends=\{trends\} mode=\{mode\} \/>/);
assert.match(page, />Validated KPI facts</);
assert.match(page, /const notes = comparisonNotes\(trends\)/);
assert.match(page, /Directionality is not interpreted unless that KPI explicitly defines whether higher or lower is better/);
assert.match(page, /type ComparisonMode = "actual" \| "percent" \| "normalized"/);
assert.match(page, /value === "actual" \|\| value === "percent" \|\| value === "normalized"/);
assert.match(page, /params\?\.timeline/);
assert.match(page, /params\?\.metric/);
assert.match(page, /params\?\.mode/);
assert.match(page, /params\?\.section === "compare"/);
assert.match(page, /return Array\.from\(new Set\(selected\)\)/, "all unique selected KPI query values must remain supported");
assert.match(page, /Select at least two KPIs with two or more dated values to compare trend lines/);
assert.match(page, /aria-label="Multi-KPI comparison trend chart"/);

assert.doesNotMatch(packageJson, /test:executive-kpi-analysis"/);
assert.match(packageJson, /test:executive-kpi-analysis-retirement/);
assert.doesNotMatch(packageJson, /executive-kpi-analysis-regression-tests\.js/);

const repositoryText = [
  ...["app", "components", "lib"].flatMap((directory) => {
    const pending = [path.join(root, directory)];
    const files = [];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(absolute);
      }
    }
    return files;
  }).map((file) => fs.readFileSync(file, "utf8"))
].join("\n");

assert.doesNotMatch(repositoryText, /executive_kpi_analysis|executive-kpi-analysis|Executive KPI Analysis|Generate Executive Analysis/);

console.log("Executive KPI Analysis retirement regressions passed.");
