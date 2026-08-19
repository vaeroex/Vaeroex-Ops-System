const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { safeAuthRedirectPath } = require("../lib/auth/safe-redirect.ts");

for (const validPath of [
  "/app",
  "/app/intelligence?section=briefings#monthly",
  "/reset-password",
  "/app/kpis?section=compare",
  "/app/search?q=review%20status"
]) {
  assert.equal(safeAuthRedirectPath(validPath), validPath, `auth redirect must preserve ${validPath}`);
}

for (const unsafePath of [
  null,
  "",
  "app",
  " https://attacker.example",
  "https://attacker.example",
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "//attacker.example",
  "///attacker.example",
  "/\\attacker.example",
  "\\\\attacker.example",
  "%2f%2fattacker.example",
  "%252f%252fattacker.example",
  "/%5cattacker.example",
  "/%255cattacker.example",
  "/javascript:alert(1)",
  "/app%",
  "/app\u0000/unsafe"
]) {
  assert.equal(safeAuthRedirectPath(unsafePath), "/app", `auth redirect must reject ${String(unsafePath)}`);
}

const callback = read("app/auth/callback/route.ts");
assert.match(callback, /safeAuthRedirectPath\(requestUrl\.searchParams\.get\("next"\)\)/, "OAuth callback must normalize its destination before redirecting");
assert.doesNotMatch(callback, /new URL\(requestUrl\.searchParams\.get\("next"\)/, "OAuth callback must never construct a redirect from raw input");
assert.match(callback, /Authentication%20could%20not%20be%20completed/, "OAuth callback failures must remain generic and customer-safe");

const rateLimit = read("lib/security/rate-limit.ts");
assert.match(rateLimit, /strict: boolean;/, "every rate-limited operation must declare its failure policy explicitly");
assert.doesNotMatch(rateLimit, /strict\?: boolean;/, "rate-limit failure policy must not silently default to fail-open");

const rateLimitedSources = [
  "app/api/stripe/checkout/route.ts",
  "app/api/search/route.ts",
  "app/support/actions.ts",
  "app/api/public/forms/[slug]/submit/route.ts",
  "app/api/subscription/request-activation/route.ts",
  "lib/ai/provider-guardrails.ts",
  "app/app/finding-explanation/actions.ts",
  "app/app/intelligence/briefings/actions.ts",
  "app/app/easter-egg/actions.ts",
  "app/app/business-health-analysis/actions.ts",
  "app/app/sources/business-notes/actions.ts",
  "app/app/files/actions.ts"
].map(read).join("\n");

for (const action of [
  "stripe.checkout",
  "global.search",
  "global.answer",
  "support.create_request",
  "public_form.submit",
  "subscription.activation_request",
  "ai.provider.user",
  "ai.provider.workspace",
  "finding_explanation.generate",
  "intelligence_briefing.generate",
  "business_health_explanation.generate",
  "business_notes.extract",
  "file.upload",
  "file.import_stage",
  "file.import_approve",
  "file.analysis"
]) {
  const actionIndex = rateLimitedSources.indexOf(`action: "${action}"`);
  assert.notEqual(actionIndex, -1, `rate-limit action ${action} must remain present`);
  assert.match(rateLimitedSources.slice(actionIndex, actionIndex + 750), /strict: true/, `${action} must fail closed when quota verification is unavailable`);
}

const highMigration = read("supabase/migrations/20260819174100_security_high_findings_remediation.sql");
assert.match(highMigration, /on conflict on constraint request_rate_limits_unique_window[\s\S]{0,300}where rate_limit\.count < p_limit/, "quota consumption must remain one atomic conflict update");
assert.match(highMigration, /return query select false, p_limit/, "quota consumption must reject the first request beyond the boundary");

const nextConfig = read("next.config.mjs");
assert.match(nextConfig, /const enforcedBaselineCsp = \[/, "a low-risk CSP baseline must be enforced while full policy rollout remains staged");
assert.match(nextConfig, /Content-Security-Policy-Report-Only/, "the complete resource policy must remain observable before full enforcement");
assert.match(nextConfig, /process\.env\.NODE_ENV === "development" \? " 'unsafe-eval'" : ""/, "unsafe-eval must be limited to Next.js development diagnostics");
assert.match(nextConfig, /"base-uri 'self'"[\s\S]{0,200}"object-src 'none'"[\s\S]{0,200}"frame-ancestors 'none'"[\s\S]{0,200}"form-action 'self'/, "the enforced CSP baseline must protect navigation and embedding boundaries");
assert.match(nextConfig, /process\.env\.NODE_ENV === "production" \? \["upgrade-insecure-requests"\] : \[\]/, "local HTTP development must not be upgraded to unavailable HTTPS assets");

const workflow = read(".github/workflows/ci.yml");
assert.match(workflow, /^permissions:\n  contents: read/m, "CI token permissions must default to repository read-only");
assert.doesNotMatch(workflow, /uses: [^\s]+@v\d/m, "third-party actions must use immutable commit pins");
assert.match(workflow, /supabase test db supabase\/tests\/security_high_findings_remediation\.test\.sql/, "CI must execute two-workspace authorization behavior tests in an isolated local database");

const databaseSecurityTest = read("supabase/tests/security_high_findings_remediation.test.sql");
assert.match(databaseSecurityTest, /begin;[\s\S]+grant select \(id, name\) on table public\.workspaces to authenticated;[\s\S]+rollback;/, "the isolated suite must model Production workspace reachability only inside its rollback transaction");
assert.doesNotMatch(databaseSecurityTest, /grant\s+select\s+on\s+(?:table\s+)?public\.workspaces\s+to\s+authenticated/i, "the isolated suite must not add table-wide workspace read authority");
assert.doesNotMatch(databaseSecurityTest, /grant[\s\S]{0,120}public\.workspaces[\s\S]{0,80}to\s+(?:anon|public)\b/i, "the isolated suite must never expose workspaces to anonymous or public roles");
assert.match(databaseSecurityTest, /grant insert \(workspace_id, form_id, data_json\)[\s\S]{0,80}public\.form_submissions to authenticated;/, "Viewer mutation denial must be tested after the exact submission columns reach RLS");
assert.match(databaseSecurityTest, /grant update \(role\) on table public\.workspace_members to authenticated;/, "membership escalation tests must reach the role-restricted RLS policies");
assert.match(databaseSecurityTest, /dblink_connect\([\s\S]+host=%s port=%s dbname=%s user=postgres password=postgres[\s\S]+inet_server_addr\(\)[\s\S]+inet_server_port\(\)/, "concurrency sessions must authenticate through the disposable database's password-protected Docker address");
assert.doesNotMatch(databaseSecurityTest, /dblink_connect_u\(/, "the concurrency harness must not depend on the privileged unencrypted connector");
assert.match(databaseSecurityTest, /dblink_send_query[\s\S]+security\.concurrent-test/, "quota regression must issue genuinely concurrent database requests");
assert.match(databaseSecurityTest, /\$drain\$[\s\S]+dblink_get_result\(connection_name\)[\s\S]+\$drain\$;[\s\S]+all concurrent quota attempts return one authoritative result/, "the harness must drain every asynchronous result before cleanup");
assert.match(databaseSecurityTest, /count\(\*\)::integer from concurrent_rate_limit_results where allowed[\s\S]+\n  3,/, "concurrent quota regression must enforce the exact boundary");

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.scripts.lint, "eslint . --max-warnings=63", "ESLint must block errors and growth beyond the recorded legacy warning baseline");
for (const [name, version] of [
  ["@supabase/auth-js", "2.70.0"],
  ["nanoid", "3.3.18"],
  ["postcss", "8.5.23"]
]) {
  assert.equal(packageJson.pnpm.overrides[name], version, `${name} must remain pinned to its audited patched release`);
}

const launchHardening = read("supabase/migrations/202607080004_smb_launch_hardening.sql");
for (const helper of ["is_workspace_member", "workspace_member_role", "has_workspace_role", "can_manage_workspace", "can_edit_operations", "accept_workspace_invites_for_current_user"]) {
  assert.match(launchHardening, new RegExp(`revoke execute on function public\\.${helper}\\([\\s\\S]{0,80}from anon`), `${helper} must remain denied to anonymous callers`);
  assert.match(launchHardening, new RegExp(`grant execute on function public\\.${helper}\\([\\s\\S]{0,80}to authenticated`), `${helper} must remain limited to authenticated callers`);
}
assert.match(highMigration, /function public\.can_contribute_workspace[\s\S]{0,180}security definer[\s\S]{0,80}set search_path = ''/, "the contributor RLS helper must retain an empty search path");

async function assertCspHeaders() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnforcement = process.env.VAEROEX_ENFORCE_CSP;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.VAEROEX_ENFORCE_CSP;
    const reportOnlyConfig = (await import(`../next.config.mjs?security-default=${Date.now()}`)).default;
    const reportOnlyHeaders = (await reportOnlyConfig.headers())[0].headers;
    const baseline = reportOnlyHeaders.find((header) => header.key === "Content-Security-Policy");
    const reportOnly = reportOnlyHeaders.find((header) => header.key === "Content-Security-Policy-Report-Only");

    assert.ok(baseline, "the compatibility-safe CSP baseline must be enforced by default");
    assert.ok(reportOnly, "the complete resource policy must remain observable by default");
    assert.match(baseline.value, /base-uri 'self'/);
    assert.match(baseline.value, /frame-ancestors 'none'/);
    assert.doesNotMatch(reportOnly.value, /'unsafe-eval'/, "production CSP must not allow script evaluation");

    process.env.VAEROEX_ENFORCE_CSP = "true";
    const enforcedConfig = (await import(`../next.config.mjs?security-enforced=${Date.now()}`)).default;
    const enforcedHeaders = (await enforcedConfig.headers())[0].headers;
    assert.equal(enforcedHeaders.filter((header) => header.key === "Content-Security-Policy").length, 1);
    assert.equal(enforcedHeaders.filter((header) => header.key === "Content-Security-Policy-Report-Only").length, 0);

    process.env.NODE_ENV = "development";
    delete process.env.VAEROEX_ENFORCE_CSP;
    const developmentConfig = (await import(`../next.config.mjs?security-development=${Date.now()}`)).default;
    const developmentHeaders = (await developmentConfig.headers())[0].headers;
    const developmentBaseline = developmentHeaders.find((header) => header.key === "Content-Security-Policy");
    assert.doesNotMatch(developmentBaseline.value, /upgrade-insecure-requests/, "local HTTP assets must remain reachable in development");
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalEnforcement === undefined) delete process.env.VAEROEX_ENFORCE_CSP;
    else process.env.VAEROEX_ENFORCE_CSP = originalEnforcement;
  }
}

assertCspHeaders()
  .then(() => console.log("Security medium-hardening regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
