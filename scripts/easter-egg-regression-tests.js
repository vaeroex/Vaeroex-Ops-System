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

const { EASTER_EGG_SEARCH_PHRASES, isEasterEggDiscoveryQuery, normalizeEasterEggDiscoveryQuery } = require("../lib/easter-egg/discovery.ts");
const { validateEasterEggDisplayName } = require("../lib/easter-egg/display-name.ts");
const {
  EASTER_EGG_DIFFICULTY_TIERS,
  EASTER_EGG_HAZARD_TYPES,
  EASTER_EGG_PATTERN_CATALOG,
  allowedPatternsForTier,
  buildCoursePlan,
  buildCourseObjects,
  calculateEasterEggScore,
  difficultyTierAtTick,
  expectedRunProgress,
  patternGapDistanceAtTick,
  runDurationMs,
  runnerSpeedAtTick,
  safeExitDistanceForPatternObjects,
  travelledDistanceForTicks
} = require("../lib/easter-egg/rules.ts");
const { findPassablePatternTraversal, simulatePatternJumpSequence } = require("../lib/easter-egg/pattern-validation.ts");
const { validateEasterEggRun } = require("../lib/easter-egg/validation.ts");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

for (const query of EASTER_EGG_SEARCH_PHRASES) {
  assert.equal(isEasterEggDiscoveryQuery(query), true, `approved exact discovery phrase works: ${query}`);
}
assert.equal(isEasterEggDiscoveryQuery("  EASTER   EGG  "), true, "case and whitespace normalization are allowed");
assert.equal(isEasterEggDiscoveryQuery("ｅａｓｔｅｒ　ｅｇｇ"), true, "Unicode compatibility normalization is deterministic");
for (const query of [
  "game", "fun", "hidden", "secret", "easter eggs", "easter,egg", "secret games", "hidden game report",
  "play a mini game", "surprise me with revenue", "i am bored", "company easter egg policy", "egg"
]) {
  assert.equal(isEasterEggDiscoveryQuery(query), false, `legitimate search is not intercepted: ${query}`);
}
assert.equal(normalizeEasterEggDiscoveryQuery("Easter\nEgg"), "easter egg");

const seed = 1_887_342_901;
const activeTickCount = 9_000;
const planA = buildCoursePlan(seed, activeTickCount);
const planB = buildCoursePlan(seed, activeTickCount);
assert.deepEqual(planA, planB, "fixed-tick course generation is deterministic");
assert.ok(planA.length > 20, "a long run has a meaningful deterministic pattern schedule");
assert.ok(planA.every((pattern, index) => index === 0 || pattern.spawnTick > planA[index - 1].spawnTick), "pattern order is fair and chronological");
assert.ok(planA.some((pattern) => pattern.objects.some((object) => object.kind === "platform")), "later tiers include deterministic safe platforms");
assert.ok(planA.flatMap((pattern) => pattern.objects).every((object) => object.objectId && object.patternId && object.typeId), "every course object has stable deterministic identity");
for (const pattern of planA.filter((entry) => entry.objects.some((object) => object.kind === "platform"))) {
  const leftEdge = Math.min(...pattern.objects.map((object) => object.xOffset - object.width / 2));
  const rightEdge = Math.max(...pattern.objects.map((object) => object.xOffset + object.width / 2));
  const actualExitDistance = travelledDistanceForTicks(pattern.spawnTick, pattern.nextSpawnTick) - (rightEdge - leftEdge);
  assert.ok(actualExitDistance >= safeExitDistanceForPatternObjects(pattern.objects), `${pattern.patternId} returns to baseline before the next bounded pattern`);
}
const progress = expectedRunProgress(seed, activeTickCount);
const score = calculateEasterEggScore(activeTickCount, progress.hazardCount);
const durationMs = runDurationMs(activeTickCount);
const valid = validateEasterEggRun({
  seed,
  contractVersion: "easter_egg_runner_v3",
  startedAtMs: 1_000_000,
  submittedAtMs: 1_000_000 + durationMs + 800,
  activeTickCount,
  ...progress,
  score
});
assert.deepEqual(valid, { valid: true, reason: "accepted", durationMs }, "a deterministic replay validates");
const validationBase = { seed, contractVersion: "easter_egg_runner_v3", startedAtMs: 1_000_000, submittedAtMs: 1_000_000 + durationMs, activeTickCount, ...progress, score };
assert.equal(validateEasterEggRun({ ...validationBase, hazardCount: progress.hazardCount + 1, score: calculateEasterEggScore(activeTickCount, progress.hazardCount + 1) }).reason, "impossible_obstacle_count", "impossible hazard claims fail closed");
assert.equal(validateEasterEggRun({ ...validationBase, platformCount: progress.platformCount + 1 }).reason, "impossible_platform_count", "impossible safe-platform claims fail closed");
assert.equal(validateEasterEggRun({ ...validationBase, difficultyTier: Math.max(1, progress.difficultyTier - 1) }).reason, "difficulty_tier_mismatch", "client tier claims must match deterministic progression");
assert.equal(validateEasterEggRun({ ...validationBase, courseFingerprint: "deadbeef" }).reason, "course_mismatch", "altered pattern identity fails closed");
assert.equal(validateEasterEggRun({ ...validationBase, courseFingerprint: "not-a-course" }).reason, "malformed", "malformed course data fails closed");
assert.equal(validateEasterEggRun({ ...validationBase, score: score + 1 }).reason, "score_mismatch", "tampered scores fail closed");
assert.equal(validateEasterEggRun({ ...validationBase, contractVersion: "future" }).reason, "contract_mismatch", "unknown rulesets fail closed");
assert.equal(validateEasterEggRun({ ...validationBase, contractVersion: "easter_egg_runner_v1" }).reason, "contract_mismatch", "old-contract pending runs fail closed rather than using V2 rules");
assert.equal(validateEasterEggRun({ ...validationBase, contractVersion: "easter_egg_runner_v2" }).reason, "contract_mismatch", "V2 pending runs fail closed rather than using V3 rules");
assert.equal(validateEasterEggRun({ ...validationBase, submittedAtMs: 1_001_000 }).reason, "duration_mismatch", "implausibly fast submissions fail closed");

assert.deepEqual(EASTER_EGG_DIFFICULTY_TIERS.map((tier) => difficultyTierAtTick(tier.startTick).id), [1, 2, 3, 4, 5], "difficulty tiers unlock at exact active-tick thresholds");
assert.ok(runnerSpeedAtTick(0) < runnerSpeedAtTick(900) && runnerSpeedAtTick(900) < runnerSpeedAtTick(4_500), "world speed increases deterministically");
assert.equal(runnerSpeedAtTick(216_000), 510, "world speed has a validated upper cap");
assert.ok(patternGapDistanceAtTick(0) > patternGapDistanceAtTick(2_400) && patternGapDistanceAtTick(2_400) > patternGapDistanceAtTick(7_200), "average pattern spacing tightens by tier");
assert.ok(allowedPatternsForTier(1).every((pattern) => !pattern.objects.some((object) => object.kind === "platform")), "the onboarding tier contains only basic ground hazards");
assert.deepEqual(allowedPatternsForTier(1).map((pattern) => pattern.id), ["single-basic"], "Normal teaches one small hazard with no sequence surprises");
assert.ok(allowedPatternsForTier(2).some((pattern) => pattern.id === "paired-small-interruptions"), "Busy adds a forgiving two-hazard sequence");
assert.ok(allowedPatternsForTier(2).every((pattern) => !pattern.objects.some((object) => object.kind === "platform")), "Busy remains ground-based and learnable");
assert.ok(allowedPatternsForTier(3).every((pattern) => !pattern.objects.some((object) => object.kind === "platform")), "Quarter End introduces deliberate ground timing before platforms");
assert.ok(allowedPatternsForTier(4).some((pattern) => pattern.id === "platform-boost"), "platform traversal unlocks at Executive Panic");
assert.ok(allowedPatternsForTier(5).some((pattern) => pattern.id === "late-mixed-sequence"), "the hardest bounded sequence unlocks only in the final tier");
assert.ok(EASTER_EGG_HAZARD_TYPES.filter((hazard) => hazard.minTier <= 5).length >= 10, "business-themed hazard variety is bounded and substantial");
const normalHazards = EASTER_EGG_HAZARD_TYPES.filter((hazard) => hazard.minTier === 1);
assert.ok(normalHazards.every((hazard) => hazard.collisionHeight <= 25 && hazard.collisionWidth <= 36), "Normal uses the smallest forgiving hitboxes");
const busyHazards = EASTER_EGG_HAZARD_TYPES.filter((hazard) => hazard.minTier <= 2);
assert.ok(busyHazards.every((hazard) => hazard.collisionHeight <= 35 && hazard.collisionWidth <= 40), "Busy stays small to medium rather than becoming tall");
assert.ok(patternGapDistanceAtTick(0) >= 430, "Normal provides a broad reaction window");
assert.ok(runnerSpeedAtTick(0) <= 215 && runnerSpeedAtTick(899) < 240, "Normal uses the slowest bounded speed band");
assert.ok(runnerSpeedAtTick(900) < 250 && runnerSpeedAtTick(2_399) <= 286, "Busy increases speed modestly");
assert.ok(runnerSpeedAtTick(4_500) >= 390 && runnerSpeedAtTick(7_200) >= 470, "later tiers carry the severe speed increase");
for (const hazard of EASTER_EGG_HAZARD_TYPES) {
  assert.ok(hazard.id && hazard.visualKind, `${hazard.id} has stable visual and obstacle identities`);
  assert.ok(hazard.collisionWidth <= hazard.visualWidth && hazard.collisionHeight <= hazard.visualHeight, `${hazard.id} collision remains inside its visual bounds`);
  assert.ok(hazard.collisionWidth / hazard.visualWidth >= 0.75 && hazard.collisionHeight / hazard.visualHeight >= 0.72, `${hazard.id} collision closely matches its visible solid object`);
}
assert.equal(new Set(EASTER_EGG_HAZARD_TYPES.map((hazard) => hazard.visualKind)).size, EASTER_EGG_HAZARD_TYPES.length, "each business hazard owns one deterministic visual definition");
const passabilityFailures = [];
for (const pattern of EASTER_EGG_PATTERN_CATALOG) {
  for (let tier = pattern.minTier; tier <= pattern.maxTier; tier += 1) {
    const traversal = findPassablePatternTraversal(pattern.id, tier);
    if (!traversal.passable) passabilityFailures.push(`${pattern.id}@${tier}:${traversal.speed}`);
    else if (!simulatePatternJumpSequence({ patternId: pattern.id, tier, jumpTicks: traversal.jumpTicks })) passabilityFailures.push(`${pattern.id}@${tier}:replay`);
    else if (traversal.jumpTicks.length > 0) {
      const hasReactionMargin = [-3, -2, -1, 1, 2, 3].some((offset) => simulatePatternJumpSequence({
        patternId: pattern.id,
        tier,
        jumpTicks: traversal.jumpTicks.map((tick) => Math.max(0, tick + offset))
      }));
      if (!hasReactionMargin) passabilityFailures.push(`${pattern.id}@${tier}:pixel-perfect`);
    }
  }
}
assert.deepEqual(passabilityFailures, [], `all allowlisted patterns remain passable at their maximum tier speed: ${passabilityFailures.join(", ")}`);
assert.deepEqual(buildCourseObjects(seed, activeTickCount), buildCourseObjects(seed, activeTickCount), "client and server course reconstruction uses one shared function");
const maximumCourseStartedAt = performance.now();
const maximumCourse = buildCourseObjects(seed, 216_000);
const maximumCourseBuildMs = performance.now() - maximumCourseStartedAt;
assert.ok(maximumCourse.length < 50_000, "the bounded one-hour course remains memory-safe");
assert.ok(maximumCourseBuildMs < 2_500, `the route-only maximum course builds within budget (${maximumCourseBuildMs.toFixed(1)}ms)`);

assert.deepEqual(validateEasterEggDisplayName("Northwind Labs"), { valid: true, value: "Northwind Labs" });
assert.equal(validateEasterEggDisplayName("Vaeroex Official").valid, false, "reserved identity terms require rejection");
assert.equal(validateEasterEggDisplayName("https://example.com").valid, false, "URLs cannot become public names");
assert.equal(validateEasterEggDisplayName("A").valid, false, "display names are bounded");

const migration = read("supabase/migrations/20260731213000_easter_egg_runner_v1.sql");
const v2Migration = read("supabase/migrations/20260731224500_easter_egg_runner_v2_contract.sql");
const v3Migration = read("supabase/migrations/20260731231500_easter_egg_runner_v3_contract.sql");
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
assert.match(v2Migration, /easter_egg_runner_v1', 'easter_egg_runner_v2/, "the compatibility migration preserves completed V1 rows while accepting V2 starts");
assert.match(v2Migration, /impossible_platform_count/, "V2 validation outcomes remain persistable");
assert.doesNotMatch(v2Migration, /drop table|drop column|truncate|delete from/i, "the V2 contract migration does not remove schema or data");
assert.match(v3Migration, /easter_egg_runner_v1'[\s\S]*easter_egg_runner_v2'[\s\S]*easter_egg_runner_v3'/, "the V3 migration preserves all historical contract rows");
assert.doesNotMatch(v3Migration, /drop table|drop column|truncate|delete from/i, "the V3 contract migration does not remove schema or data");

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
assert.match(runner, /scene\.pause\(\)/, "hidden-tab pause stops the fixed-tick scene rather than simulating elapsed time");
assert.match(runner, /this\.platforms/, "safe platforms have a collision group separate from hazards");
assert.match(runner, /checkCollision\.up = true/, "safe platforms expose a top landing surface");
assert.match(runner, /SAFE STEP/, "safe platforms are unambiguously labeled in the game");
for (const visualKind of EASTER_EGG_HAZARD_TYPES.map((hazard) => hazard.visualKind)) {
  assert.match(runner, new RegExp(`case \\\"${visualKind}\\\"`), `${visualKind} has local Phaser artwork`);
}
assert.match(runner, /plan\.kind === "platform" \? plan\.fill : 0xffffff[\s\S]*0\.001/, "hazard physics use a separate fixed collision body rather than decorative empty space");
assert.match(runner, /difficultyTierAtTick\(this\.tick\)/, "visible difficulty uses the shared active-tick progression");
assert.doesNotMatch(runner, /setInterval|setTimeout/, "difficulty and stages do not advance on fake wall-clock timing");
assert.match(runner, /aria-live="polite"/, "meaningful game status changes are announced");
assert.match(runner, /focus-visible:ring/, "keyboard focus remains visible");
assert.match(gameUi, /motion-reduce:animate-none/, "nonessential loading animation honors reduced-motion preferences");
assert.match(gameUi, /Public participation is off by default/, "opt-in privacy is explained at the point of control");
assert.match(gameUi, /Personal identity is never displayed/, "public privacy is explicit");

const gameRuntime = [actions, adminActions, gamePage, gameUi, runner, adminPage, read("lib/easter-egg/data.ts"), read("lib/easter-egg/rules.ts")].join("\n");
assert.doesNotMatch(gameRuntime, /openai|nvidia|provider-manager|runVaeroex|generateText|BusinessMemory|business_memory|IntelligenceSnapshot|saved_analysis|trust_evaluation/i, "game runtime has zero provider and intelligence dependencies");
assert.doesNotMatch(searchRoute.slice(searchRoute.indexOf("if (isEasterEggDiscoveryQuery(rawQuery))"), searchRoute.indexOf("const securityIntent")), /supabase\.from|runVaeroex|buildWorkspaceEvidenceContext/, "exact discovery performs no business-data or provider query");
assert.doesNotMatch(gameRuntime, /https?:\/\//, "gameplay uses no remote assets or trackers");

console.log("Easter Egg security, privacy, replay, anti-cheat, discovery, and accessibility regressions passed.");
