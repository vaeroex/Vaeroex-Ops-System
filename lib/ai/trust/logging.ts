import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type { ClaimTypeV1, TrustResultV1, ValidationOutcomeV1 } from "@/lib/ai/trust/contracts";

type CountMap = Readonly<Record<string, number>>;
export type TrustShadowTelemetryV1 = Readonly<{
  event: "trust_shadow_evaluation" | "trust_shadow_internal_failure";
  mode: "shadow";
  workflow_id: string;
  contract_version: string;
  ruleset_version: string;
  claim_extractor_version: string;
  output_contract_version: string;
  validator_version: string;
  workspace_scope_ref: string;
  release_channel: "production" | "preview" | "development";
  snapshot_fingerprint: string | null;
  projection_fingerprint: string | null;
  manifest_identity: string;
  provider: string;
  model: string;
  provider_request_ref: string | null;
  generation_timestamp: string;
  repair_count: 0;
  additional_provider_calls: 0;
  response_hash: string;
  trust_fingerprint: string | null;
  total_claims: number;
  claims_by_taxonomy: CountMap;
  outcomes: CountMap;
  reason_frequencies: CountMap;
  unresolved_claims: number;
  qualifier_required_claims: number;
  would_omit_claims: number;
  would_reject_claims: number;
  shadow_status: ValidationOutcomeV1 | "internal_failure";
  save_eligibility_enforced: false;
  cache_state: "hit" | "miss" | "not_applicable";
  fallback_used: boolean;
  stale: boolean;
  validation_latency_ms: number;
  claim_refs: readonly Readonly<{ claim_id: string; section_id: string; claim_text_hash: string; claim_type: ClaimTypeV1; outcomes: readonly ValidationOutcomeV1[] }>[];
}>;

function counts(values: readonly string[]) {
  return Object.fromEntries(Array.from(new Set(values)).sort().map((value) => [value, values.filter((candidate) => candidate === value).length]));
}

export function trustShadowTelemetryV1({ result, cacheState, fallbackUsed, stale, validationLatencyMs }: { result: TrustResultV1; cacheState: "hit" | "miss" | "not_applicable"; fallbackUsed: boolean; stale: boolean; validationLatencyMs: number }): TrustShadowTelemetryV1 {
  return {
    event: "trust_shadow_evaluation", mode: "shadow", workflow_id: result.workflowId, contract_version: result.contractVersion,
    ruleset_version: result.rulesetVersion, claim_extractor_version: result.claimExtractorVersion,
    output_contract_version: result.outputContractVersion, validator_version: result.validatorVersion,
    workspace_scope_ref: result.workspaceScopeRef, release_channel: result.releaseChannel,
    snapshot_fingerprint: result.snapshotFingerprint, projection_fingerprint: result.projectionFingerprint,
    manifest_identity: result.manifestIdentity, provider: result.provider, model: result.model,
    provider_request_ref: result.requestId ? `provider_request_${evidenceEngineHash(result.requestId).slice(0, 24)}` : null,
    generation_timestamp: result.generationTimestamp, repair_count: 0, additional_provider_calls: 0,
    response_hash: result.responseHash, trust_fingerprint: result.trustFingerprint, total_claims: result.claims.length,
    claims_by_taxonomy: counts(result.claims.map((claim) => claim.claimType)),
    outcomes: counts(result.rules.map((rule) => rule.outcome)),
    reason_frequencies: counts(result.rules.flatMap((rule) => rule.reasonCodes)),
    unresolved_claims: result.claims.filter((claim) => claim.ruleOutcomes.includes("unresolved")).length,
    qualifier_required_claims: result.claims.filter((claim) => claim.ruleOutcomes.includes("qualifier_required")).length,
    would_omit_claims: result.claims.filter((claim) => claim.ruleOutcomes.includes("would_omit")).length,
    would_reject_claims: result.claims.filter((claim) => claim.ruleOutcomes.includes("would_reject")).length,
    shadow_status: result.overallShadowStatus, save_eligibility_enforced: false, cache_state: cacheState,
    fallback_used: fallbackUsed, stale, validation_latency_ms: Math.max(0, validationLatencyMs),
    claim_refs: result.claims.map((claim) => ({ claim_id: claim.claimId, section_id: claim.sectionId, claim_text_hash: claim.textHash, claim_type: claim.claimType, outcomes: claim.ruleOutcomes }))
  };
}

export function trustShadowFailureTelemetryV1(input: {
  workflowId: string; outputContractVersion: string; validatorVersion: string; workspaceId: string;
  releaseChannel: "production" | "preview" | "development"; snapshotFingerprint: string | null;
  projectionFingerprint: string | null; manifestIdentity: string; provider: string; model: string;
  requestId: string | null; generationTimestamp: string; responseHash: string;
  cacheState: "hit" | "miss" | "not_applicable"; fallbackUsed: boolean; stale: boolean; validationLatencyMs: number;
}): TrustShadowTelemetryV1 {
  return {
    event: "trust_shadow_internal_failure", mode: "shadow", workflow_id: input.workflowId,
    contract_version: "trust_result_v1", ruleset_version: "business_health_trust_rules_v1",
    claim_extractor_version: "deterministic_claim_extractor_v1", output_contract_version: input.outputContractVersion,
    validator_version: input.validatorVersion,
    workspace_scope_ref: `workspace_scope_${evidenceEngineHash({ workflowId: input.workflowId, workspaceId: input.workspaceId }).slice(0, 24)}`,
    release_channel: input.releaseChannel, snapshot_fingerprint: input.snapshotFingerprint,
    projection_fingerprint: input.projectionFingerprint, manifest_identity: input.manifestIdentity,
    provider: input.provider, model: input.model,
    provider_request_ref: input.requestId ? `provider_request_${evidenceEngineHash(input.requestId).slice(0, 24)}` : null,
    generation_timestamp: input.generationTimestamp, repair_count: 0, additional_provider_calls: 0,
    response_hash: input.responseHash, trust_fingerprint: null, total_claims: 0, claims_by_taxonomy: {}, outcomes: {},
    reason_frequencies: { trust_shadow_internal_failure: 1 }, unresolved_claims: 0, qualifier_required_claims: 0,
    would_omit_claims: 0, would_reject_claims: 0, shadow_status: "internal_failure", save_eligibility_enforced: false,
    cache_state: input.cacheState, fallback_used: input.fallbackUsed, stale: input.stale,
    validation_latency_ms: Math.max(0, input.validationLatencyMs), claim_refs: []
  };
}

export function logTrustShadowTelemetryV1(telemetry: TrustShadowTelemetryV1) {
  const log = telemetry.event === "trust_shadow_internal_failure" ? console.warn : console.info;
  log(JSON.stringify({ level: telemetry.event === "trust_shadow_internal_failure" ? "warn" : "info", component: "trust-layer-v1", ...telemetry }));
}
