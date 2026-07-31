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

const { buildIntelligenceCardIdentityV1, buildIntelligenceCardSnapshotV1 } = require("../lib/intelligence/card-lifecycle/identity.ts");
const { buildIntelligenceCardLifecycleOverlayV1, effectiveLifecycleStateV1 } = require("../lib/intelligence/card-lifecycle/overlay.ts");
const { sortIntelligenceLifecycleCardsV1 } = require("../lib/intelligence/card-lifecycle/presentation.ts");

function insight(overrides = {}) {
  return {
    id: "finding-1",
    type: "Risk",
    title: "Average Checkout Wait remains above target",
    summary: "Average Checkout Wait is 6.2 against a target of 5.",
    why: "The current value remains outside target.",
    impact: "The delay can constrain service throughput.",
    recommendedAction: "Review the checkout workflow.",
    confidence: "High",
    evidence: ["KPI measurement"],
    evidenceCount: 1,
    supportingRecords: [{ id: "kpi-1", title: "Average Checkout Wait", recordType: "KPI", date: "2026-07-30", value: "6.2", support: "Measured value", href: "/app/kpis", classification: "Original", sourceKey: "kpi-1" }],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: [],
    sourceTypes: ["KPI"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-30T00:00:00.000Z",
    affectedArea: "Operations",
    timePeriod: "Current",
    limitation: "The KPI does not identify a root cause.",
    fingerprint: "risk:operations:average-checkout-wait:2026-07",
    ...overrides
  };
}

function findingProjection(source, overrides = {}) {
  return {
    ...source,
    origin: "deterministic",
    producerId: "intelligence_layer",
    producerVersion: "v1",
    deterministicDependencies: { kpiIds: ["kpi-setting-1"], evidenceReferenceIds: ["intelligence-layer:kpi-1"] },
    citationIds: [],
    ...overrides
  };
}

function lifecycleRecord(identity, overrides = {}) {
  return {
    id: "lifecycle-1",
    workspace_id: "workspace-a",
    finding_key_hash: identity.findingKeyHash,
    finding_fingerprint: "risk:operations:average-checkout-wait:2026-07",
    lifecycle_state: "dismissed",
    state_material_signature: identity.materialSignature,
    last_material_signature: identity.materialSignature,
    last_finding_id: "finding-1",
    reason_code: "temporary",
    reason_text: null,
    recheck_after: "2026-08-30T00:00:00.000Z",
    pinned: false,
    pinned_by: null,
    pinned_at: null,
    card_snapshot_json: buildIntelligenceCardSnapshotV1(insight()),
    last_mutated_by: "manager-a",
    last_mutated_at: "2026-07-30T00:00:00.000Z",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    ...overrides
  };
}

const baseInsight = insight();
const baseFinding = findingProjection(baseInsight);
const identityA = buildIntelligenceCardIdentityV1({ insight: baseInsight, finding: baseFinding });
const identityARepeat = buildIntelligenceCardIdentityV1({ insight: { ...baseInsight, title: "Presentation wording changed" }, finding: { ...baseFinding, title: "Presentation wording changed" } });
assert.equal(identityA.findingKeyHash, identityARepeat.findingKeyHash, "finding identity is stable across presentation wording when the authoritative fingerprint is unchanged");
assert.equal(identityA.materialSignature, identityARepeat.materialSignature, "material signature excludes volatile prose");

const changedPriority = buildIntelligenceCardIdentityV1({ insight: { ...baseInsight, priority: "Medium" }, finding: { ...baseFinding, priority: "Medium" } });
assert.notEqual(changedPriority.materialSignature, identityA.materialSignature, "priority changes reopen the lifecycle card");
const changedDependency = buildIntelligenceCardIdentityV1({ insight: baseInsight, finding: findingProjection(baseInsight, { deterministicDependencies: { kpiIds: ["kpi-setting-2"], evidenceReferenceIds: ["intelligence-layer:kpi-1"] } }) });
assert.notEqual(changedDependency.materialSignature, identityA.materialSignature, "deterministic dependency changes reopen the lifecycle card");
assert.equal(buildIntelligenceCardIdentityV1({ insight: baseInsight, finding: findingProjection(baseInsight, { deterministicDependencies: { kpiIds: ["kpi-setting-1"], evidenceReferenceIds: ["intelligence-layer:kpi-1"] } }) }).materialSignature, identityA.materialSignature, "sorted canonical dependencies preserve signature stability");

const dismissed = lifecycleRecord(identityA);
assert.deepEqual(effectiveLifecycleStateV1({ record: dismissed, materialSignature: identityA.materialSignature, nowMs: Date.parse("2026-07-31T00:00:00Z") }), { state: "dismissed", reopenReason: null, reopenedFrom: null }, "same key and same signature preserve dismissal");
assert.deepEqual(effectiveLifecycleStateV1({ record: dismissed, materialSignature: changedPriority.materialSignature, nowMs: Date.parse("2026-07-31T00:00:00Z") }), { state: "active", reopenReason: "material_change", reopenedFrom: "dismissed" }, "material change returns a dismissed finding to Current");
assert.deepEqual(effectiveLifecycleStateV1({ record: { ...dismissed, recheck_after: "2026-07-30T00:00:00Z" }, materialSignature: identityA.materialSignature, nowMs: Date.parse("2026-07-31T00:00:00Z") }), { state: "active", reopenReason: "recheck_due", reopenedFrom: "dismissed" }, "expired recheck returns a dismissed finding to Current");

const activeOverlay = buildIntelligenceCardLifecycleOverlayV1({
  insights: [baseInsight],
  identities: { [baseInsight.id]: identityA },
  lifecycleRecords: [{ ...dismissed, lifecycle_state: "acknowledged", state_material_signature: identityA.materialSignature, recheck_after: null }],
  lifecycleTokens: { [baseInsight.id]: "sealed-token" },
  nowMs: Date.parse("2026-07-31T00:00:00Z")
});
assert.equal(activeOverlay.current.length, 1, "acknowledged cards remain in Current");
assert.equal(activeOverlay.current[0].lifecycleState, "acknowledged");
assert.equal(activeOverlay.current[0].lifecycleToken, "sealed-token", "authorized mutations remain bound to the current authoritative finding");

const dismissedOverlay = buildIntelligenceCardLifecycleOverlayV1({
  insights: [baseInsight],
  identities: { [baseInsight.id]: identityA },
  lifecycleRecords: [dismissed],
  nowMs: Date.parse("2026-07-31T00:00:00Z")
});
assert.equal(dismissedOverlay.current.length, 0, "dismissed cards leave Current");
assert.equal(dismissedOverlay.history.length, 1, "dismissed cards move to History");
assert.equal(dismissedOverlay.history[0].findingId, baseInsight.id, "direct links retain the finding identity in History");

const missingOverlay = buildIntelligenceCardLifecycleOverlayV1({
  insights: [],
  identities: {},
  lifecycleRecords: [dismissed],
  nowMs: Date.parse("2026-07-31T00:00:00Z")
});
assert.equal(missingOverlay.history[0].currentFeedStatus, "not_currently_surfaced", "bounded-feed absence is retained without inferring resolution");
assert.equal(missingOverlay.history[0].insight, null, "historical snapshots do not masquerade as current deterministic findings");

const opportunity = insight({ id: "finding-2", fingerprint: "opportunity:sales:revenue:2026-07", type: "Opportunity", priority: "Medium", confidence: "Medium", title: "Revenue opportunity", lastUpdated: "2026-07-31T00:00:00Z" });
const opportunityIdentity = buildIntelligenceCardIdentityV1({ insight: opportunity, finding: findingProjection(opportunity, { type: "Opportunity", priority: "Medium", confidence: "Medium", deterministicDependencies: { kpiIds: ["revenue"], evidenceReferenceIds: [] } }) });
const sorted = sortIntelligenceLifecycleCardsV1([
  activeOverlay.current[0],
  {
    ...buildIntelligenceCardLifecycleOverlayV1({ insights: [opportunity], identities: { [opportunity.id]: opportunityIdentity }, lifecycleRecords: [] }).current[0],
    pinned: true
  },
  { ...activeOverlay.current[0], findingKeyHash: "f".repeat(64), lifecycleState: "active" }
]);
assert.equal(sorted[0].pinned, true, "pinned cards sort first");
assert.equal(sorted[1].lifecycleState, "active", "active cards sort before acknowledged cards at equal priority");

const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260731092011_intelligence_card_lifecycle.sql"), "utf8");
const page = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
const component = fs.readFileSync(path.join(root, "components/intelligence/IntelligenceSignalInbox.tsx"), "utf8");
const action = fs.readFileSync(path.join(root, "app/app/intelligence/lifecycle-actions.ts"), "utf8");
assert.match(migration, /unique \(workspace_id, finding_key_hash\)/i, "workspace and finding key are unique");
assert.match(migration, /pg_advisory_xact_lock/i, "concurrent lifecycle mutations serialize per workspace finding");
assert.match(migration, /for update/i, "concurrent lifecycle updates lock the canonical row");
assert.match(migration, /role in \('owner', 'admin', 'manager'\)/i, "only leadership roles can mutate");
assert.match(migration, /workspace members can read intelligence card lifecycle/i, "all workspace members may read lifecycle state");
assert.match(migration, /revoke all privileges.*authenticated, service_role/is, "direct authenticated writes are revoked");
assert.match(migration, /grant select.*intelligence_card_lifecycle.*authenticated/is, "authenticated members receive read-only table grants");
assert.match(migration, /grant select, insert on table public\.intelligence_card_lifecycle_events to service_role/i, "events are append-only for the trusted service role");
assert.doesNotMatch(migration, /grant[^;]*(update|delete|truncate)[^;]*intelligence_card_lifecycle_events/i, "events cannot be updated, deleted, or truncated by the application role");
assert.match(migration, /p_workspace_id.*p_actor_id.*p_action/is, "transactional mutation verifies workspace and actor inputs");
assert.match(migration, /jsonb_build_object\('changed', v_changed, 'idempotent', not v_changed\)/i, "same-state lifecycle mutations are idempotent");
assert.match(component, /No active issues require attention\./, "healthy state is explicit");
assert.match(component, /No undismissed issues are in the current feed\. Dismissed findings remain in History\./, "dismissed-only state is explicit");
assert.match(component, /What could improve the business further/, "deterministic improvements remain visible in healthy states");
assert.match(component, /requestedCard\?\.view \|\| "current"/, "direct links to dismissed cards open History");
assert.match(action, /requireWorkspaceRole\(\["owner", "admin", "manager"\]\)/, "server action independently enforces leadership roles");
assert.match(action, /createSupabaseAdminClient/, "writes use the trusted server path");
assert.doesNotMatch([migration, page, component, action].join("\n"), /generateText|openai|nvidia|provider request/i, "lifecycle construction and mutation introduce zero provider calls");
assert.doesNotMatch(page, /buildIntelligenceSnapshotFromProducersV1\([^)]*lifecycle/is, "lifecycle state is not an IntelligenceSnapshotV1 input");

console.log("Intelligence card lifecycle regression tests passed.");
