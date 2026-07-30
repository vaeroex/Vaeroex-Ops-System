const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

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

const {
  AI_TRUST_EVALUATION_PAGE_SIZE,
  aiTrustRangeStart,
  buildAiTrustDashboardSnapshot,
  parseAiTrustFilters,
  parseTrustEvaluation
} = require("../lib/admin/ai-trust-dashboard.ts");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const NOW = "2026-07-30T12:00:00.000Z";

function claim(index, type, outcomes = []) {
  return { claim_id: `claim-${index}`, section_id: `section-${index}`, claim_text_hash: HASH_A, claim_type: type, outcomes };
}

function trustTelemetry(overrides = {}) {
  const claims = overrides.claim_refs || [
    claim(1, "deterministic_fact"),
    claim(2, "recommendation", ["qualifier_required"]),
    claim(3, "recommendation", ["unresolved"]),
    claim(4, "limitation", ["would_omit"]),
    claim(5, "deterministic_fact", ["would_reject"])
  ];
  return {
    event: "trust_shadow_evaluation",
    mode: "shadow",
    workflow_id: "business_health_explanation_v1",
    contract_version: "trust_result_v1",
    ruleset_version: "business_health_trust_rules_v1",
    claim_extractor_version: "deterministic_claim_extractor_v1",
    output_contract_version: "business_health_explanation_v1",
    validator_version: "business_health_explanation_validator_v1",
    workspace_scope_ref: `workspace_scope_${HASH_A.slice(0, 24)}`,
    release_channel: "preview",
    snapshot_fingerprint: HASH_A,
    projection_fingerprint: HASH_B,
    manifest_identity: HASH_C,
    provider: "openai",
    model: "gpt-5.6-sol",
    provider_request_ref: `provider_request_${HASH_A.slice(0, 24)}`,
    generation_timestamp: NOW,
    repair_count: 0,
    additional_provider_calls: 0,
    response_hash: HASH_D,
    trust_fingerprint: HASH_A,
    total_claims: claims.length,
    claims_by_taxonomy: Object.fromEntries([...new Set(claims.map((item) => item.claim_type))].map((type) => [type, claims.filter((item) => item.claim_type === type).length])),
    outcomes: {},
    reason_frequencies: { recommendation_rationale_unresolved: 1 },
    unresolved_claims: 1,
    qualifier_required_claims: 1,
    would_omit_claims: 1,
    would_reject_claims: 1,
    shadow_status: "unresolved",
    save_eligibility_enforced: false,
    cache_state: "miss",
    fallback_used: false,
    stale: false,
    validation_latency_ms: 3,
    claim_refs: claims,
    ...overrides
  };
}

function usage(index, overrides = {}) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const trust = trustTelemetry(overrides.trust || {});
  return {
    id,
    agent_type: overrides.agent_type || "business_health_explanation_v1",
    status: overrides.status || "completed",
    model: overrides.model || trust.model,
    latency_ms: overrides.latency_ms ?? 1_200,
    metadata_json: {
      provider: overrides.provider || trust.provider,
      fallback_used: overrides.fallback_used ?? trust.fallback_used,
      provider_attempts: overrides.provider_attempts || [{ provider: trust.provider, runtime_model: trust.model, role: "primary", fallback: false, success: true, latency_ms: 1_100 }],
      trust_shadow: overrides.withoutTrust ? undefined : trust
    },
    created_at: overrides.created_at || `2026-07-${String(30 - (index % 20)).padStart(2, "0")}T12:00:00.000Z`
  };
}

function partialUsage(index, agentType, overrides = {}) {
  return usage(index, {
    agent_type: agentType,
    withoutTrust: true,
    ...overrides
  });
}

function run(index, agentType, status = "completed") {
  return { id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, agent_type: agentType, status, created_at: NOW };
}

function note(index, overrides = {}) {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    status: "approved",
    evidence_lifecycle_status: "active",
    extraction_confidence: 0.91,
    correction_count: 0,
    provider_name: "openai",
    model_used: "gpt-5.6-luna",
    fallback_used: false,
    provider_attempts_json: [{ provider: "openai", runtime_model: "gpt-5.6-luna", role: "primary", fallback: false, success: true, latency_ms: 900 }],
    release_channel: "preview",
    latency_ms: 900,
    extracted_at: NOW,
    approved_at: NOW,
    archived_at: null,
    deleted_at: null,
    created_at: NOW,
    ...overrides
  };
}

function filters(overrides = {}) {
  return {
    range: "7d", workflow: "all", releaseChannel: "", provider: "", model: "", ruleset: "", rule: "", outcome: "all", page: 1, evaluation: "", ...overrides
  };
}

function snapshot(overrides = {}) {
  return buildAiTrustDashboardSnapshot({
    filters: filters(),
    businessHealthUsage: [usage(1)],
    findingExplanationUsage: [partialUsage(101, "finding_explanation_v1")],
    fileAnalysisUsage: [partialUsage(201, "file_analysis")],
    findingExplanationRuns: [run(101, "finding_explanation_v1")],
    fileAnalysisRuns: [run(201, "file_analysis")],
    businessNotes: [note(1), note(2, { status: "review_required", approved_at: null, correction_count: 1 }), note(3, { status: "extraction_failed", extracted_at: NOW, approved_at: null, extraction_confidence: null })],
    savedFindingAnalyses: 2,
    generatedAt: NOW,
    ...overrides
  });
}

const parsed = parseTrustEvaluation(usage(1));
assert.equal(parsed.state, "valid");
assert.equal(parsed.evaluation.claimOutcomes.accepted, 1);
assert.equal(parsed.evaluation.claimOutcomes.qualifier_required, 1);
assert.equal(parsed.evaluation.claimOutcomes.unresolved, 1);
assert.equal(parsed.evaluation.claimOutcomes.would_omit, 1);
assert.equal(parsed.evaluation.claimOutcomes.would_reject, 1);

const aggregate = snapshot();
assert.equal(aggregate.platform.instrumentedRuns, 1);
assert.equal(aggregate.platform.totalClaims, 5);
assert.equal(aggregate.platform.accepted, 1);
assert.equal(aggregate.platform.additionalProviderCalls, 0);
assert.equal(aggregate.platform.additionalAiCostCents, 0);
assert.equal(aggregate.businessHealth.totalRuns, 1);
assert.equal(aggregate.businessHealth.solRuns, 1);
assert.equal(aggregate.businessHealth.sampleInsufficient, true);
assert.equal(aggregate.findingExplanation.completedArtifacts, 1);
assert.equal(aggregate.fileAnalysis.completedArtifacts, 1);
assert.equal(aggregate.workflows.find((item) => item.key === "finding_explanation").instrumentation, "Partially Instrumented");
assert.equal(aggregate.workflows.find((item) => item.key === "file_analysis").acceptedOrApproved, null);
assert.equal(aggregate.businessNotes.submitted, 3);
assert.equal(aggregate.businessNotes.successfulExtractions, 2);
assert.equal(aggregate.businessNotes.extractionFailures, 1);
assert.equal(aggregate.businessNotes.awaitingReview, 1);
assert.equal(aggregate.businessNotes.approved, 1);
assert.equal(aggregate.businessNotes.humanDisagreementCount, 0, "unapproved corrections must not count as approved human disagreement");
assert.equal(aggregate.businessNotes.activeContextRecords, 1, "only approved active notes may count as active contextual records");
assert.equal(aggregate.readiness.status, "Not Enough Data");
assert.equal(aggregate.readiness.suspectedFalsePositiveReviewCount, null);

const empty = snapshot({ businessHealthUsage: [], findingExplanationUsage: [], fileAnalysisUsage: [], findingExplanationRuns: [], fileAnalysisRuns: [], businessNotes: [], savedFindingAnalyses: 0 });
assert.equal(empty.platform.acceptedRate, null);
assert.equal(empty.businessNotes.approvalRate, null);
assert.equal(empty.businessNotes.fallbackRate, null);
assert.equal(empty.readiness.status, "Not Enough Data");

const unsafe = usage(2, { trust: { prompt: "raw prompt must never enter telemetry" } });
const unsafeSnapshot = snapshot({ businessHealthUsage: [unsafe] });
assert.equal(unsafeSnapshot.unsafeTelemetryRows, 1);
assert.equal(unsafeSnapshot.platform.instrumentedRuns, 0);
assert.equal(unsafeSnapshot.readiness.status, "Blocked");
assert.doesNotMatch(JSON.stringify(unsafeSnapshot), /raw prompt/);

const invalidClaimCount = usage(3, { trust: { total_claims: 99 } });
assert.equal(parseTrustEvaluation(invalidClaimCount).state, "malformed");

const filtered = snapshot({
  filters: filters({ provider: "nvidia", model: "gpt-5.6-terra", releaseChannel: "preview" }),
  businessHealthUsage: [usage(4, { trust: { provider: "nvidia", model: "gpt-5.6-terra", fallback_used: true }, provider: "nvidia", model: "gpt-5.6-terra", fallback_used: true, provider_attempts: [{ provider: "nvidia", runtime_model: "gpt-5.6-terra", role: "fallback", fallback: true, success: true, latency_ms: 1_600 }] })],
  businessNotes: [note(4, { release_channel: "production" })]
});
assert.equal(filtered.businessHealth.totalRuns, 1);
assert.equal(filtered.businessHealth.terraFallbackRuns, 1);
assert.equal(filtered.businessNotes.submitted, 0, "release-channel filter must not mix Production Business Notes into Preview results");
assert.ok(filtered.providers.every((item) => item.provider === "nvidia" && item.model === "gpt-5.6-terra"));

const ruleFiltered = snapshot({ filters: filters({ rule: "recommendation_rationale_unresolved", outcome: "unresolved" }) });
assert.equal(ruleFiltered.businessHealth.totalRuns, 1);
assert.equal(ruleFiltered.findingExplanation.runs, 0, "Trust-only filters must not be applied to partially instrumented workflows");
assert.equal(ruleFiltered.businessNotes.processed, 0, "Trust outcomes must not be applied to Business Notes extraction metrics");

const many = Array.from({ length: AI_TRUST_EVALUATION_PAGE_SIZE + 5 }, (_, index) => usage(index + 10));
const pageTwo = snapshot({ filters: filters({ page: 2 }), businessHealthUsage: many });
assert.equal(pageTwo.evaluationCount, AI_TRUST_EVALUATION_PAGE_SIZE + 5);
assert.equal(pageTwo.evaluations.length, 5);
assert.equal(pageTwo.totalEvaluationPages, 2);

const selected = snapshot({ filters: filters({ evaluation: usage(1).id }) });
assert.equal(selected.selectedEvaluation.id, usage(1).id);
const serialized = JSON.stringify(selected);
for (const forbidden of ["workspace_id", "workspaceId", "user_id", "userId", "original_note_text", "claim_text", "evidence_excerpt", "source_file_id", "email", "prompt", "tokens"]) {
  assert.doesNotMatch(serialized, new RegExp(forbidden), `dashboard output must not contain ${forbidden}`);
}

const failedSource = snapshot({ sourceErrors: [{ source: "File Analysis telemetry", message: "File Analysis telemetry could not be loaded. Other available AI Trust metrics remain visible." }], fileAnalysisUsage: [], fileAnalysisRuns: [] });
assert.equal(failedSource.sourceErrors.length, 1);
assert.equal(failedSource.businessHealth.totalRuns, 1, "one source failure must not collapse other workflow metrics");

const invalidFilters = parseAiTrustFilters({ provider: ["openai", "nvidia"], page: "1;drop table", evaluation: "not-a-uuid" });
assert.ok(invalidFilters.error);
assert.equal(invalidFilters.filters.provider, "");
assert.equal(invalidFilters.filters.page, 1);
assert.equal(invalidFilters.filters.evaluation, "");
const sevenDays = aiTrustRangeStart("7d", new Date(NOW));
assert.equal(Date.parse(NOW) - Date.parse(sevenDays), 7 * 24 * 60 * 60 * 1_000);
assert.equal(aiTrustRangeStart("all", new Date(NOW)), null);

const route = read("app/app/admin/ai-trust/page.tsx");
const adminLayout = read("app/app/admin/layout.tsx");
const data = read("lib/admin/ai-trust-data.ts");
const dashboard = read("components/admin/AiTrustDashboard.tsx");
const appShell = read("components/app/AppShell.tsx");
const adminNav = read("components/admin/AdminNav.tsx");
const globalSearch = read("components/app/GlobalSearch.tsx");
const migration = read("supabase/migrations/202607300001_ai_trust_admin_dashboard.sql");

assert.match(route, /requireVaeroexAdmin\("\/app"\)[\s\S]+getAiTrustDashboardData/, "page must authorize before querying telemetry");
assert.match(adminLayout, /requireVaeroexAdmin\("\/app"\)/, "admin layout must independently authorize the route");
assert.match(data, /^import "server-only";/, "cross-workspace aggregation must remain server-only");
assert.match(data, /MAX_ROWS_PER_SOURCE = 5_000/);
assert.doesNotMatch(data, /original_note_text|reviewed_extraction_json|source_spans_json|workspace_id|author_user_id|user_id|source_file_id/, "query adapter must not select raw customer content or identifiers");
assert.doesNotMatch(data + route, /openai|generateText|generateObject|runVaeroexCompletion|createChatCompletion/, "dashboard rendering must make no LLM call");
assert.doesNotMatch(data + route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|"use server"/, "dashboard must expose no mutation or server action");
assert.equal(exists("app/api/admin/ai-trust/route.ts"), false, "no separate aggregation API should exist to attack directly");
assert.match(appShell, /isVaeroexAdmin \? \[\.\.\.baseNavSections, adminNavSection\] : baseNavSections/);
assert.match(appShell, /href: "\/app\/admin\/ai-trust", label: "AI Trust"/);
assert.match(adminNav, /href: "\/app\/admin\/ai-trust", label: "AI Trust"/);
assert.doesNotMatch(globalSearch, /\/app\/admin\/ai-trust|AI Trust/, "Global Search must not expose the admin dashboard");
assert.doesNotMatch(dashboard, /raw generated prose|enable enforcement|type="checkbox"|environment-variable|rollout control/i);
assert.doesNotMatch(dashboard, /customer name|workspace name|source filename/i);
assert.match(dashboard, /Shadow Mode/);
assert.match(dashboard, /Trust claim validation: Not yet instrumented/);
assert.match(dashboard, /Claim Trust: Not yet instrumented/);
assert.match(dashboard, /This dashboard cannot activate enforcement/);
assert.match(dashboard, /bg-slate-50\/80/, "metric grids must use the existing Pulsar and Light theme-aware surface token");
assert.doesNotMatch(dashboard, /bg-slate-50\/60/, "metric grids must not use an unsupported light-only surface token");
assert.match(migration, /create index if not exists ai_usage_agent_type_created_at_idx[\s\S]+on public\.ai_usage\(agent_type, created_at desc\)/, "cross-workspace Trust queries must use an indexed workflow/date path");
assert.match(migration, /create index if not exists ai_agent_runs_agent_type_created_at_idx[\s\S]+on public\.ai_agent_runs\(agent_type, created_at desc\)/, "cross-workspace artifact queries must use an indexed workflow/date path");
assert.match(migration, /create index if not exists business_notes_created_at_idx[\s\S]+on public\.business_notes\(created_at desc\)/, "bounded Business Notes monitoring must use an indexed date path");
assert.match(migration, /create index if not exists reports_saved_analysis_type_created_at_idx[\s\S]+source_data_json ->> 'record_kind' = 'saved_analysis'/, "Saved Analysis counts must use a bounded partial index");
assert.match(migration, /drop policy if exists "workspace members can insert ai usage"/);
assert.match(migration, /to authenticated[\s\S]+not \(coalesce\(metadata_json, '\{\}'::jsonb\) \? 'trust_shadow'\)/, "authenticated clients must not be able to forge Trust shadow telemetry");
assert.doesNotMatch(migration, /alter table[\s\S]+add column|create table|drop table|delete from|truncate/i, "security/index migration must not change telemetry shape or data");

const benchmarkInput = Array.from({ length: 1_000 }, (_, index) => usage(index + 1_000));
const benchmarkStarted = process.hrtime.bigint();
const benchmarkSnapshot = snapshot({ businessHealthUsage: benchmarkInput });
const benchmarkMs = Number(process.hrtime.bigint() - benchmarkStarted) / 1_000_000;
assert.equal(benchmarkSnapshot.businessHealth.totalRuns, 1_000);
assert.ok(benchmarkMs < 1_000, `1,000-row deterministic aggregation should remain bounded; measured ${benchmarkMs.toFixed(2)}ms`);

console.log(JSON.stringify({ message: "Admin AI Trust dashboard regression tests passed.", deterministicAggregation: { rows: 1_000, durationMs: Number(benchmarkMs.toFixed(2)), additionalProviderCalls: 0, additionalAiCostCents: 0 } }));
