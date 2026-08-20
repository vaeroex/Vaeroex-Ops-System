const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const contractDirectory = path.join(root, "lib/integrations/contracts");
const contractFiles = fs.readdirSync(contractDirectory).filter((name) => name.endsWith(".ts")).sort();
const contractSource = contractFiles.map((name) => read(`lib/integrations/contracts/${name}`)).join("\n");
const adr = read("docs/architecture/adr-007-external-integrations-contract-foundation.md");
const packageJson = JSON.parse(read("package.json"));

let assertionCount = 0;
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function matches(value, pattern, message) {
  assertionCount += 1;
  assert.match(value, pattern, message);
}
function doesNotMatch(value, pattern, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
}

for (const requiredFile of [
  "canonical.ts",
  "control-plane.ts",
  "index.ts",
  "intelligence.ts",
  "primitives.ts",
  "provider-adapter.ts",
  "source-facts.ts",
  "versions.ts"
]) {
  ok(contractFiles.includes(requiredFile), `missing Phase 0 contract file: ${requiredFile}`);
}

doesNotMatch(
  contractSource,
  /QuickBooks|Intuit|Microsoft|Business Central|Oracle|NetSuite|SAP/i,
  "generic contracts must not contain provider-specific names"
);
doesNotMatch(
  contractSource,
  /\bfetch\s*\(|axios|node:https|node:http|process\.env|@supabase|supabase-js|openai|stripe/i,
  "Phase 0 contracts must not contain network, database, environment, model, or billing dependencies"
);
doesNotMatch(contractSource, /["']use server["']|server-only|app\//i, "Phase 0 contracts must remain pure and route-free");
doesNotMatch(contractSource, /credential|access_token|refresh_token|client_secret/i, "generic contracts must not carry credentials");
matches(contractSource, /untrusted_external_input/, "provider output must be explicitly untrusted");
doesNotMatch(contractSource, /authority:\s*z\.enum\([^\n]*model/i, "model authority must not exist");
matches(contractSource, /Unsafe freshness must fail closed/, "freshness must fail closed before analysis routing");
matches(contractSource, /"aging"/, "freshness must include the approved aging state");
matches(contractSource, /current_intelligence/, "freshness must carry explicit blocking levels");
matches(contractSource, /fromDeterministicWatermark/, "Business State Delta must carry deterministic before/after watermarks");
matches(contractSource, /luna_eligible/, "materiality must express selective model-tier eligibility");
matches(contractSource, /pending_authorization[\s\S]+"error"/, "the connection lifecycle must include explicit error recovery");
matches(contractSource, /CanonicalDecimalSchema/, "accounting decimals must use the canonical string contract");
matches(contractSource, /workspaceId/, "tenant identity must be explicit");
matches(contractSource, /businessEntityId/, "Business Entity identity must be explicit");

matches(adr, /random per-object AES-256-GCM DEK/, "ADR must record per-object payload envelope encryption");
matches(adr, /KMS wrapping of the small DEK/, "ADR must limit KMS to wrapping payload DEKs");
matches(adr, /Small per-connection OAuth credential envelopes use direct Google Cloud KMS encryption/, "ADR must preserve direct KMS for small credentials");
matches(adr, /uniform bucket-level access/, "ADR must record private object access posture");
matches(adr, /soft delete disabled/, "ADR must record exceptional temporary-bucket deletion posture");
matches(adr, /modernized Intuit Reports API response is the canonical target/, "ADR must record the modernized report direction");
matches(adr, /launch defaults subject to sandbox\/load evidence, not architectural constants/, "freshness values must remain versioned defaults");
matches(adr, /Long-lived security\/authorization\/deletion audit duration pending legal\/compliance review/, "audit retention must remain pending");
matches(adr, /Phase 0 defines this boundary only\. It does not implement encryption or object storage\./, "ADR must keep storage outside Phase 0");
matches(adr, /Phase 0 includes no:/, "ADR must make the negative boundary explicit");

equal(
  packageJson.scripts["test:external-integrations-contracts"],
  "node scripts/external-integrations-contract-regression-tests.js",
  "contract test script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-architecture"],
  "node scripts/external-integrations-architecture-regression-tests.js",
  "architecture test script must be registered"
);

const protectedDiff = childProcess.execFileSync(
  "git",
  ["diff", "--name-only", "origin/main", "--", "app", "components", "supabase", "lib/supabase", "services", "vercel.json"],
  { cwd: root, encoding: "utf8" }
).trim();
equal(protectedDiff, "", "Phase 0 must not change routes, UI, database, infrastructure, or deployment files");

const untrackedMigrations = childProcess.execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "supabase/migrations"],
  { cwd: root, encoding: "utf8" }
).trim();
equal(untrackedMigrations, "", "Phase 0 must not add an untracked migration");

console.log(`External integration Phase 0 architecture regressions: ${assertionCount} assertions passed.`);
