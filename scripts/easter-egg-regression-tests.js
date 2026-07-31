const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename
  }).outputText;
  module._compile(output, filename);
};

const { isEasterEggDiscoveryQuery, normalizeEasterEggDiscoveryQuery } = require("../lib/easter-egg/discovery.ts");
const { validateEasterEggDisplayName } = require("../lib/easter-egg/display-name.ts");
const { buildObstaclePlan, calculateEasterEggScore, clearedObstacleCount, runDurationMs } = require("../lib/easter-egg/rules.ts");
const { validateEasterEggRun } = require("../lib/easter-egg/validation.ts");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

assert.equal(isEasterEggDiscoveryQuery("easter egg"), true, "the exact normalized search phrase discovers the game");
assert.equal(isEasterEggDiscoveryQuery("  EASTER   EGG  "), true, "case and whitespace normalization are allowed");
assert.equal(isEasterEggDiscoveryQuery("ｅａｓｔｅｒ　ｅｇｇ"), true, "Unicode compatibility normalization is deterministic");
for (const query of ["easter eggs", "easter,egg", "secret game", "easter egg report", "company easter egg policy", "egg"]) {
  assert.equal(isEasterEggDiscoveryQuery(query), false, `legitimate search is not intercepted: ${query}`);
}
assert.equal(normalizeEasterEggDiscoveryQuery("Easter\nEgg"), "easter egg");

const seed = 1_887_342_901;
const activeTickCount = 3_600;
const planA = buildObstaclePlan(seed, activeTickCount);
const planB = buildObstaclePlan(seed, activeTickCount);
assert.deepEqual(planA, planB, "fixed-tick obstacle generation is deterministic");
assert.ok(planA.length > 10, "a one-minute run has a meaningful obstacle schedule");
assert.ok(planA.every((obstacle, index) => index === 0 || obstacle.spawnTick > planA[index - 1].spawnTick), "obstacle order is fair and chronological");
const obstacleCount = clearedObstacleCount(seed, activeTickCount);
const score = calculateEasterEggScore(activeTickCount, obstacleCount);
const durationMs = runDurationMs(activeTickCount);
const valid = validateEasterEggRun({
  seed,
  contractVersion: "easter_egg_runner_v1",
  startedAtMs: 1_000_000,
  submittedAtMs: 1_000_000 + durationMs + 800,
  activeTickCount,
  obstacleCount,
  score
});
assert.deepEqual(valid, { valid: true, reason: "accepted", durationMs }, "a deterministic replay validates");
assert.equal(validateEasterEggRun({ seed, contractVersion: "easter_egg_runner_v1", startedAtMs: 1_000_000, submittedAtMs: 1_000_000 + durationMs, activeTickCount, obstacleCount: obstacleCount + 1, score: calculateEasterEggScore(activeTickCount, obstacleCount + 1) }).reason, "impossible_obstacle_count", "impossible obstacle claims fail closed");
assert.equal(validateEasterEggRun({ seed, contractVersion: "easter_egg_runner_v1", startedAtMs: 1_000_000, submittedAtMs: 1_000_000 + durationMs, activeTickCount, obstacleCount, score: score + 1 }).reason, "score_mismatch", "tampered scores fail closed");
assert.equal(validateEasterEggRun({ seed, contractVersion: "future", startedAtMs: 1_000_000, submittedAtMs: 1_000_000 + durationMs, activeTickCount, obstacleCount, score }).reason, "contract_mismatch", "unknown rulesets fail closed");
assert.equal(validateEasterEggRun({ seed, contractVersion: "easter_egg_runner_v1", startedAtMs: 1_000_000, submittedAtMs: 1_001_000, activeTickCount, obstacleCount, score }).reason, "duration_mismatch", "implausibly fast submissions fail closed");

assert.deepEqual(validateEasterEggDisplayName("Northwind Labs"), { valid: true, value: "Northwind Labs" });
assert.equal(validateEasterEggDisplayName("Vaeroex Official").valid, false, "reserved identity terms require rejection");
assert.equal(validateEasterEggDisplayName("https://example.com").valid, false, "URLs cannot become public names");
assert.equal(validateEasterEggDisplayName("A").valid, false, "display names are bounded");

const migration = read("supabase/migrations/20260731213000_easter_egg_runner_v1.sql");
const actions = read("app/app/easter-egg/actions.ts");
const adminActions = read("app/app/admin/easter-egg/actions.ts");
const gamePage = read("app/app/easter-egg/page.tsx");
const gameUi = read("components/easter-egg/EasterEggExperience.tsx");
const runner = read("components/easter-egg/EndlessRunnerGame.tsx");
const adminPage = read("app/app/admin/easter-egg/page.tsx");
const searchRoute = read("app/api/search/route.ts");
const appShell = read("components/app/AppShell.tsx");
const adminNav = read("components/admin/AdminNav.tsx");
const sitemap = read("app/sitemap.ts");

assert.match(migration, /create table public\.easter_egg_runs/i, "run storage is additive");
assert.match(migration, /create table public\.easter_egg_workspace_settings/i, "workspace opt-in storage is additive");
assert.match(migration, /enable row level security/g, "both tables enable RLS");
assert.match(migration, /revoke all privileges on table public\.easter_egg_runs from anon, authenticated, service_role/i, "direct game-run table privileges are revoked");
assert.match(migration, /revoke all privileges on table public\.easter_egg_workspace_settings from anon, authenticated, service_role/i, "direct settings table privileges are revoked");
assert.doesNotMatch(migration, /grant[^;]*(anon|authenticated)/i, "no direct anonymous or authenticated grants are introduced");
assert.match(migration, /unique \(workspace_id, actor_user_id, idempotency_key\)/i, "run starts are idempotent per workspace actor");
assert.match(migration, /public_participation_requested boolean not null default false/i, "public participation defaults off");
assert.match(migration, /dense_rank\(\) over \(order by score desc\)/i, "leaderboard ties share a rank");
assert.match(migration, /row_number\(\) over \(order by score desc, achieved_at asc, workspace_id asc\)/i, "leaderboard tie ordering is deterministic");
assert.doesNotMatch(migration, /drop table|drop column|truncate/i, "migration contains no destructive schema operations");

assert.match(actions, /requireWorkspaceAccess\(\)/, "start and submit actions independently require workspace access");
assert.match(actions, /requireWorkspaceRole\(\["owner", "admin"\]\)/, "only owners and admins mutate workspace leaderboard settings");
assert.match(actions, /easter_egg\.run\.start[\s\S]*strict: true|strict: true[\s\S]*easter_egg\.run\.start/, "run starts use strict server rate limiting");
assert.match(actions, /easter_egg\.run\.submit/, "score submissions use a separate rate-limit action");
assert.match(actions, /\.eq\("workspace_id", access\.workspaceId\)/, "all run reads and writes are workspace scoped");
assert.match(actions, /\.eq\("actor_user_id", access\.user\.id\)/, "run ownership is checked server-side");
assert.match(actions, /\.eq\("validation_status", "pending"\)/, "a run can be finalized only once");
assert.match(actions, /validateEasterEggRun/, "server submission uses the shared deterministic validator");
assert.match(adminActions, /requireVaeroexAdmin/, "moderation is Vaeroex-admin authorized server-side");
assert.match(adminPage, /unrelated to AI Trust/i, "admin activity is explicitly separated from AI telemetry");

assert.match(searchRoute, /isEasterEggDiscoveryQuery\(rawQuery\)/, "discovery uses the dedicated exact-query normalizer");
assert.match(searchRoute, /href: "\/app\/easter-egg"/, "exact discovery returns the hidden route");
assert.ok(searchRoute.indexOf("isEasterEggDiscoveryQuery(rawQuery)") > searchRoute.indexOf("enforceRateLimit"), "hidden discovery remains behind auth and rate limiting");
assert.doesNotMatch(appShell, /\/app\/easter-egg/, "the route is absent from normal navigation");
assert.doesNotMatch(adminNav, /\/app\/admin\/easter-egg/, "game activity is not mixed into persistent admin navigation");
assert.doesNotMatch(sitemap, /easter-egg/i, "the hidden route is absent from the sitemap");
assert.match(gamePage, /requireWorkspaceAccess/, "the hidden route requires authenticated workspace access");
assert.match(gameUi, /dynamic\(\(\) => import\("@\/components\/easter-egg\/EndlessRunnerGame"\)/, "the game bundle is route-only");
assert.match(runner, /import\("phaser"\)/, "Phaser loads only inside the route-only game component");
assert.match(runner, /keydown-SPACE/, "keyboard jump is supported");
assert.match(runner, /pointerdown/, "pointer and tap jumps are supported");
assert.match(runner, /visibilitychange/, "hidden tabs pause the run");
assert.match(runner, /aria-live="polite"/, "meaningful game status changes are announced");
assert.match(runner, /focus-visible:ring/, "keyboard focus remains visible");
assert.match(gameUi, /motion-reduce:animate-none/, "nonessential loading animation honors reduced-motion preferences");
assert.match(gameUi, /Public participation is off by default/, "opt-in privacy is explained at the point of control");
assert.match(gameUi, /Personal identity is never displayed/, "public privacy is explicit");

const gameRuntime = [actions, adminActions, gamePage, gameUi, runner, adminPage, read("lib/easter-egg/data.ts"), read("lib/easter-egg/rules.ts")].join("\n");
assert.doesNotMatch(gameRuntime, /openai|nvidia|provider-manager|runVaeroex|generateText|BusinessMemory|business_memory|IntelligenceSnapshot|saved_analysis|trust_evaluation/i, "game runtime has zero provider and intelligence dependencies");
assert.doesNotMatch(searchRoute.slice(searchRoute.indexOf("if (isEasterEggDiscoveryQuery(rawQuery))"), searchRoute.indexOf("const securityIntent")), /supabase\.from|runVaeroex|buildWorkspaceEvidenceContext/, "exact discovery performs no business-data or provider query");

console.log("Easter Egg security, privacy, replay, anti-cheat, discovery, and accessibility regressions passed.");
