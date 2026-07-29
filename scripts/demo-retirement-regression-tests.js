const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

function walk(directory, extensions) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(relative, extensions);
    return extensions.includes(path.extname(entry.name)) ? [relative] : [];
  });
}

const deletedFiles = [
  "lib/demo/workspace-demo.ts",
  "app/app/demo/actions.ts",
  "lib/ai/provider-smoke-test.ts",
  "supabase/seed.sql",
  "scripts/demo-workspace-access-tests.js",
  "docs/security/demo-isolation-audit.md"
];

for (const file of deletedFiles) {
  assert.equal(exists(file), false, `${file} must remain retired`);
}

const retiredSymbols = [
  "createDemoWorkspaceAction",
  "openDemoWorkspaceAction",
  "exitDemoWorkspaceAction",
  "createFreshDemoWorkspaceAction",
  "resetDemoWorkspaceAction",
  "ensureDemoWorkspacePopulated",
  "getDemoWorkspaceCounts",
  "runAIProviderSmokeTest"
];
const runtimeFiles = [
  ...walk("app", [".ts", ".tsx"]),
  ...walk("components", [".ts", ".tsx"]),
  ...walk("lib", [".ts", ".tsx"])
];

for (const file of runtimeFiles) {
  const source = read(file);
  for (const symbol of retiredSymbols) {
    assert.doesNotMatch(source, new RegExp(`\\b${symbol}\\b`), `${file} must not retain retired ${symbol} runtime`);
  }
  assert.doesNotMatch(source, /@\/lib\/demo\/workspace-demo|@\/app\/app\/demo\/actions|@\/lib\/ai\/provider-smoke-test/, `${file} must not import a retired demo module`);
}

const dashboard = read("app/app/page.tsx");
assert.doesNotMatch(dashboard, /DemoWorkspaceBanner|DemoActionButton|Reset demo|DEMO WORKSPACE|Demo Dashboard Summary|demoStoryAlerts|demoWorkspaceCounts|demoCounts/);
assert.doesNotMatch(dashboard, /March performance dip detected|Current month has mixed signals/, "hard-coded demo alerts must not remain");
assert.doesNotMatch(read("components/intelligence/BusinessHealthTrendChart.tsx"), /isDemoWorkspace/);
assert.doesNotMatch(read("components/intelligence/LeadershipDecisionJournal.tsx"), /isDemoWorkspace|Demo Workspace decisions are previews/);

const subscriptionActions = read("app/app/admin/subscriptions/actions.ts");
const workspaceActions = read("app/app/admin/workspaces/actions.ts");
const subscriptionAuthIndex = subscriptionActions.indexOf("await requireSubscriptionAdmin(returnTo)");
const subscriptionStatusGuardIndex = subscriptionActions.indexOf("!assignableSubscriptionStatuses.has(status)");
const workspaceAuthIndex = workspaceActions.indexOf("await requireVaeroexAdmin(returnTo)");
const workspaceStatusGuardIndex = workspaceActions.indexOf("!assignableWorkspaceStatuses.has(status)");
assert.ok(subscriptionAuthIndex >= 0 && subscriptionStatusGuardIndex > subscriptionAuthIndex, "subscription mutations must authorize before rejecting forged statuses");
assert.ok(workspaceAuthIndex >= 0 && workspaceStatusGuardIndex > workspaceAuthIndex, "workspace mutations must authorize before rejecting forged statuses");
assert.doesNotMatch(subscriptionActions, /assignableSubscriptionStatuses[\s\S]*?"demo"/, "subscription mutations must not assign demo status");
assert.doesNotMatch(workspaceActions, /assignableWorkspaceStatuses[\s\S]*?"demo"/, "workspace mutations must not assign demo status");
assert.doesNotMatch(read("components/admin/AdminManualActivationForm.tsx"), /"demo"/);
assert.doesNotMatch(read("components/admin/AdminSubscriptionEditor.tsx"), /"demo"/);
assert.doesNotMatch(read("components/admin/AdminWorkspaceAccessForm.tsx"), /"demo"/);
assert.match(subscriptionActions, /\.update\(payload\)|\.update\(\{[\s\S]*?status,[\s\S]*?plan_slug:/, "an existing historical subscription can be changed to an assignable status");
assert.match(workspaceActions, /subscription_status:\s*status/, "an existing historical workspace can be changed to an assignable status");

const compatibilityPath = path.join(root, "lib/workspaces/demo-compatibility.ts");
const compatibilitySource = fs.readFileSync(compatibilityPath, "utf8");
const compatibilityModule = { exports: {} };
compatibilityModule._compile = function compile(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: compatibilityPath
  });
  Function("module", "exports", output.outputText)(compatibilityModule, compatibilityModule.exports);
};
compatibilityModule._compile(compatibilitySource);
const { isDemoWorkspaceRecord } = compatibilityModule.exports;
assert.equal(isDemoWorkspaceRecord({ subscription_status: "demo", name: "Historical workspace" }), true);
assert.equal(isDemoWorkspaceRecord({ subscription_status: "active", name: "Vaeroex Demo Workspace 2026" }), true);
assert.equal(isDemoWorkspaceRecord({ subscription_status: "active", name: "Customer workspace" }), false);
assert.doesNotMatch(compatibilitySource, /from\(|delete|update|insert|createSupabase/, "historical classification must remain pure and non-mutating");

const workspaceContext = read("lib/workspaces/current.ts");
const workspaceSwitching = read("lib/workspaces/actions.ts");
assert.match(workspaceContext, /canAccessDemoWorkspace[\s\S]*!isDemoWorkspaceRecord\(workspace\)/, "historical visibility must preserve the existing internal-user boundary");
assert.match(workspaceSwitching, /isDemoWorkspaceRecord\(workspace\) && !isVaeroexAdminUser\(user\)/, "direct historical workspace switching must preserve authorization");
assert.match(read("components/app/AppShell.tsx"), /Sample Business Environment|Demo Workspace/, "historical demo labeling must remain visible to authorized users");
assert.match(read("lib/billing/get-subscription-status.ts"), /subscription_status === "demo"/, "historical demo billing access must remain compatible");
assert.match(read("lib/intelligence/evidence-eligibility.ts"), /"demo"/, "demo-tagged evidence must remain excluded");
assert.match(read("lib/intelligence/operational-evidence.ts"), /"demo"/, "demo-tagged operational evidence must remain excluded");
assert.match(read("app/app/intelligence/actions.ts"), /requireLiveWorkspace[\s\S]*isDemoWorkspaceRecord/, "Decision Journal writes must remain blocked in the historical demo workspace");

const providerHealth = read("app/api/health/openai/route.ts");
assert.match(providerHealth, /export async function GET\(\)/, "provider-health GET must remain active");
assert.doesNotMatch(providerHealth, /export async function POST|runAIProviderSmokeTest|workspaceId/, "the retired demo provider POST must remain absent");
assert.match(read("app/api/internal/nvidia-qualification/route.ts"), /VAEROEX_AI_SMOKE_TEST_ENABLED/, "the shared NVIDIA qualification gate must remain active");

assert.equal(exists("app/demo/page.tsx"), true, "the public demo request route must remain active");
assert.match(read("app/sitemap.ts"), /"\/demo"/, "the public demo route must remain in the sitemap");
assert.equal(exists("components/motion/OperationsIntelligenceEngineDemo.tsx"), true, "the public product visualization must remain active");
assert.match(read("components/motion/OperationsIntelligenceEngineDemo.tsx"), /operations-intelligence-demo-tab/);

if (exists(".next")) {
  const compiledFiles = walk(".next/server", [".js", ".json"])
    .concat(walk(".next/static", [".js", ".json"]));
  for (const file of compiledFiles) {
    const compiled = read(file);
    for (const symbol of retiredSymbols) {
      assert.doesNotMatch(compiled, new RegExp(`\\b${symbol}\\b`), `${file} must not compile retired ${symbol}`);
    }
  }
}

console.log("Internal seeded-demo retirement regressions passed.");
