export const AI_TRUST_RANGE_OPTIONS = ["24h", "7d", "30d", "90d", "all"] as const;
export const AI_TRUST_WORKFLOW_FILTERS = ["all", "business_health", "finding_explanation", "file_analysis", "business_notes"] as const;
export const AI_TRUST_OUTCOME_FILTERS = ["all", "accepted", "qualifier_required", "unresolved", "would_omit", "would_reject"] as const;
export const AI_TRUST_EVALUATION_PAGE_SIZE = 20;

export type AiTrustRange = (typeof AI_TRUST_RANGE_OPTIONS)[number];
export type AiTrustWorkflowFilter = (typeof AI_TRUST_WORKFLOW_FILTERS)[number];
export type AiTrustOutcomeFilter = (typeof AI_TRUST_OUTCOME_FILTERS)[number];
export type ClaimOutcome = Exclude<AiTrustOutcomeFilter, "all">;

export type AiTrustFilters = Readonly<{
  range: AiTrustRange;
  workflow: AiTrustWorkflowFilter;
  releaseChannel: string;
  provider: string;
  model: string;
  ruleset: string;
  rule: string;
  outcome: AiTrustOutcomeFilter;
  page: number;
  evaluation: string;
}>;

export type AiTrustUsageRow = Readonly<{
  id: string;
  agent_type: string | null;
  status: string;
  model: string | null;
  latency_ms: number | null;
  metadata_json: unknown;
  created_at: string;
}>;

export type AiTrustAgentRunRow = Readonly<{
  id: string;
  agent_type: string;
  status: string;
  created_at: string;
}>;

export type AiTrustBusinessNoteRow = Readonly<{
  id: string;
  status: string;
  evidence_lifecycle_status: string;
  extraction_confidence: number | string | null;
  correction_count: number | string | null;
  provider_name: string | null;
  model_used: string | null;
  fallback_used: boolean;
  provider_attempts_json: unknown;
  release_channel: string;
  latency_ms: number | null;
  extracted_at: string | null;
  approved_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
}>;

type CountMap = Readonly<Record<string, number>>;

export type AiTrustClaimReference = Readonly<{
  claimId: string;
  sectionId: string;
  claimTextHash: string;
  claimType: string;
  outcomes: readonly ClaimOutcome[];
}>;

export type AiTrustEvaluation = Readonly<{
  id: string;
  createdAt: string;
  workflow: string;
  releaseChannel: string;
  provider: string;
  model: string;
  rulesetVersion: string;
  outputContractVersion: string;
  validatorVersion: string;
  claimCount: number;
  claimsByTaxonomy: CountMap;
  claimOutcomes: Readonly<Record<ClaimOutcome, number>>;
  reasonFrequencies: CountMap;
  validationLatencyMs: number;
  cacheState: string;
  fallbackUsed: boolean;
  stale: boolean;
  repairCount: number;
  additionalProviderCalls: number;
  shadowStatus: string;
  snapshotFingerprint: string | null;
  projectionFingerprint: string | null;
  manifestFingerprint: string;
  outputHash: string;
  trustFingerprint: string | null;
  providerRequestRef: string | null;
  claimRefs: readonly AiTrustClaimReference[];
  shadowOnly: true;
}>;

export type AiTrustPlatformPulse = Readonly<{
  instrumentedRuns: number;
  totalClaims: number;
  accepted: number;
  qualifierRequired: number;
  unresolved: number;
  wouldOmit: number;
  wouldReject: number;
  averageValidationLatencyMs: number | null;
  additionalProviderCalls: number;
  additionalAiCostCents: 0;
  acceptedRate: number | null;
  sampleInsufficient: boolean;
}>;

export type AiTrustWorkflowSummary = Readonly<{
  key: AiTrustWorkflowFilter;
  label: string;
  instrumentation: "Fully Instrumented" | "Partially Instrumented" | "Extraction Monitoring";
  runs: number;
  units: number;
  acceptedOrApproved: number | null;
  unresolvedOrNeedsReview: number | null;
  failures: number;
  failureRate: number | null;
  averageLatencyMs: number | null;
  fallbackRate: number | null;
  sampleSize: number;
  sampleInsufficient: boolean;
  note: string;
}>;

export type AiTrustReasonIssue = Readonly<{
  reasonCode: string;
  label: string;
  workflow: string;
  occurrences: number;
  occurrenceRate: number | null;
  severity: "info" | "warning" | "blocking";
  latestOccurrence: string;
  rulesetVersion: string;
  status: "expected" | "calibration candidate" | "enforcement blocker";
}>;

export type AiTrustProviderHealth = Readonly<{
  provider: string;
  model: string;
  workflow: string;
  attempts: number;
  successfulValidatedCompletions: number;
  fallbackCount: number;
  fallbackRate: number | null;
  averageProviderLatencyMs: number | null;
  averageTrustValidationLatencyMs: number | null;
  failureCategories: readonly Readonly<{ code: string; count: number }>[];
}>;

export type BusinessHealthTrustMetrics = Readonly<{
  totalRuns: number;
  totalClaims: number;
  accepted: number;
  qualifierRequired: number;
  unresolved: number;
  wouldOmit: number;
  wouldReject: number;
  averageValidationLatencyMs: number | null;
  p95ValidationLatencyMs: number | null;
  solRuns: number;
  terraFallbackRuns: number;
  fallbackRate: number | null;
  rulesetVersions: readonly string[];
  outputContractVersions: readonly string[];
  sampleInsufficient: boolean;
}>;

export type PartialReasoningMetrics = Readonly<{
  runs: number;
  completedArtifacts: number;
  failedArtifacts: number;
  failedValidationAttempts: number;
  fallbackRuns: number;
  fallbackRate: number | null;
  averageProviderLatencyMs: number | null;
  savedAnalyses: number | null;
}>;

export type BusinessNotesTrustMetrics = Readonly<{
  submitted: number;
  processed: number;
  successfulExtractions: number;
  extractionFailures: number;
  awaitingReview: number;
  approved: number;
  rejected: number;
  approvalRate: number | null;
  averageConfidence: number | null;
  medianConfidence: number | null;
  lowConfidenceCount: number;
  averageProcessingTimeMs: number | null;
  lunaRuns: number;
  terraFallbackRuns: number;
  fallbackRate: number | null;
  humanDisagreementCount: number;
  humanDisagreementRate: number | null;
  activeContextRecords: number;
  archivedContextRecords: number;
  issueCounts: readonly Readonly<{ label: string; count: number }>[];
}>;

export type AiTrustEnforcementReadiness = Readonly<{
  status: "Not Enough Data" | "Calibration Required" | "Candidate for Review" | "Blocked" | "Human Approved for Enforcement";
  sampleSize: number;
  acceptedRate: number | null;
  unresolvedRate: number | null;
  wouldOmitRate: number | null;
  wouldRejectRate: number | null;
  suspectedFalsePositiveReviewCount: null;
  stableRulesetDays: number | null;
  p95ValidationLatencyMs: number | null;
  privacyIncidents: number;
  crossWorkspaceFailures: number;
  additionalProviderCalls: number;
  latestRulesetVersion: string | null;
  note: string;
}>;

export type AiTrustDashboardSnapshot = Readonly<{
  generatedAt: string;
  platform: AiTrustPlatformPulse;
  workflows: readonly AiTrustWorkflowSummary[];
  businessHealth: BusinessHealthTrustMetrics;
  findingExplanation: PartialReasoningMetrics;
  fileAnalysis: PartialReasoningMetrics;
  businessNotes: BusinessNotesTrustMetrics;
  rules: readonly AiTrustReasonIssue[];
  providers: readonly AiTrustProviderHealth[];
  evaluations: readonly AiTrustEvaluation[];
  selectedEvaluation: AiTrustEvaluation | null;
  evaluationCount: number;
  totalEvaluationPages: number;
  readiness: AiTrustEnforcementReadiness;
  unsafeTelemetryRows: number;
  malformedTelemetryRows: number;
  truncated: boolean;
  sourceErrors: readonly Readonly<{ source: string; message: string }>[];
  availableFilters: Readonly<{
    providers: readonly string[];
    models: readonly string[];
    rulesets: readonly string[];
    rules: readonly string[];
    releaseChannels: readonly string[];
  }>;
}>;

export type AiTrustDashboardInput = Readonly<{
  filters: AiTrustFilters;
  businessHealthUsage: readonly AiTrustUsageRow[];
  findingExplanationUsage: readonly AiTrustUsageRow[];
  fileAnalysisUsage: readonly AiTrustUsageRow[];
  findingExplanationRuns: readonly AiTrustAgentRunRow[];
  fileAnalysisRuns: readonly AiTrustAgentRunRow[];
  businessNotes: readonly AiTrustBusinessNoteRow[];
  savedFindingAnalyses: number | null;
  sourceErrors?: readonly Readonly<{ source: string; message: string }>[];
  generatedAt?: string;
  truncated?: boolean;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILTER_TOKEN_PATTERN = /^[a-zA-Z0-9._:-]{1,100}$/;
const HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{16,128}$/i;
const SAFE_CODE_PATTERN = /^[a-zA-Z0-9._:-]{1,160}$/;
const CLAIM_OUTCOMES: readonly ClaimOutcome[] = ["accepted", "qualifier_required", "unresolved", "would_omit", "would_reject"];
const FORBIDDEN_TELEMETRY_KEYS = new Set([
  "workspace_id", "workspaceId", "user_id", "userId", "email", "prompt", "tokens", "raw",
  "claim_text", "generated_prose", "business_note", "evidence_excerpt", "source_content", "file_name"
]);
const REASON_LABELS: Record<string, string> = {
  recommendation_rationale_unresolved: "Recommendation rationale unresolved",
  claim_level_evidence_support_unresolved: "Claim-level evidence support unresolved",
  numeric_value_not_in_bounded_input: "Numeric value outside bounded input",
  numeric_value_bound_to_wrong_kpi: "Numeric value bound to the wrong KPI",
  date_or_reporting_period_not_in_bounded_input: "Date or reporting period outside bounded input",
  kpi_direction_or_semantic_meaning_reversed: "KPI identity or direction mismatch",
  actual_target_role_reversed: "Target and actual roles confused",
  confidence_language_exceeds_deterministic_ceiling: "Confidence language exceeds the deterministic ceiling",
  business_note_claim_not_attributed: "Business Note context is not attributed",
  causal_relationship_not_authorized: "Causal language is not supported",
  required_limitation_not_visible_in_generated_prose: "Required limitation is missing",
  projection_fingerprint_mismatch: "Projection fingerprint mismatch",
  workspace_scope_mismatch: "Workspace scope mismatch",
  trust_shadow_internal_failure: "Trust shadow internal failure"
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, maximum = 160) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function safeCode(value: unknown, maximum = 160) {
  const normalized = text(value, maximum);
  return normalized && SAFE_CODE_PATTERN.test(normalized) ? normalized : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function countMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, count]) => {
    const safeKey = safeCode(key);
    const safeCount = numberValue(count);
    return safeKey && safeCount >= 0 ? [[safeKey, Math.floor(safeCount)]] : [];
  }));
}

function hasForbiddenTelemetryKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenTelemetryKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => FORBIDDEN_TELEMETRY_KEYS.has(key) || hasForbiddenTelemetryKey(child));
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function average(values: readonly number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function p95(values: readonly number[]) {
  if (values.length < 20) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function safeDate(value: unknown) {
  const normalized = text(value, 40);
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : "";
}

function rawParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? "" : value || "";
}

export function parseAiTrustFilters(params: Record<string, string | string[] | undefined>): { filters: AiTrustFilters; error: string | null } {
  const range = rawParam(params.range) || "7d";
  const workflow = rawParam(params.workflow) || "all";
  const outcome = rawParam(params.outcome) || "all";
  const releaseChannel = rawParam(params.release_channel);
  const provider = rawParam(params.provider);
  const model = rawParam(params.model);
  const ruleset = rawParam(params.ruleset);
  const rule = rawParam(params.rule);
  const evaluation = rawParam(params.evaluation);
  const parsedPage = Number.parseInt(rawParam(params.page) || "1", 10);
  const invalid =
    Object.values(params).some(Array.isArray) ||
    !AI_TRUST_RANGE_OPTIONS.includes(range as AiTrustRange) ||
    !AI_TRUST_WORKFLOW_FILTERS.includes(workflow as AiTrustWorkflowFilter) ||
    !AI_TRUST_OUTCOME_FILTERS.includes(outcome as AiTrustOutcomeFilter) ||
    [releaseChannel, provider, model, ruleset, rule].some((value) => value && !FILTER_TOKEN_PATTERN.test(value)) ||
    (evaluation && !UUID_PATTERN.test(evaluation)) ||
    !Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > 250;
  return {
    filters: {
      range: AI_TRUST_RANGE_OPTIONS.includes(range as AiTrustRange) ? range as AiTrustRange : "7d",
      workflow: AI_TRUST_WORKFLOW_FILTERS.includes(workflow as AiTrustWorkflowFilter) ? workflow as AiTrustWorkflowFilter : "all",
      releaseChannel: FILTER_TOKEN_PATTERN.test(releaseChannel) ? releaseChannel : "",
      provider: FILTER_TOKEN_PATTERN.test(provider) ? provider : "",
      model: FILTER_TOKEN_PATTERN.test(model) ? model : "",
      ruleset: FILTER_TOKEN_PATTERN.test(ruleset) ? ruleset : "",
      rule: FILTER_TOKEN_PATTERN.test(rule) ? rule : "",
      outcome: AI_TRUST_OUTCOME_FILTERS.includes(outcome as AiTrustOutcomeFilter) ? outcome as AiTrustOutcomeFilter : "all",
      page: Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 250 ? parsedPage : 1,
      evaluation: UUID_PATTERN.test(evaluation) ? evaluation : ""
    },
    error: invalid ? "One or more AI Trust filters were invalid and were not applied." : null
  };
}

export function aiTrustRangeStart(range: AiTrustRange, now = new Date()) {
  if (range === "all") return null;
  const hours = range === "24h" ? 24 : range === "7d" ? 168 : range === "30d" ? 720 : 2160;
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function parseClaimRefs(value: unknown): AiTrustClaimReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const claim = record(candidate);
    const claimId = safeCode(claim.claim_id);
    const sectionId = safeCode(claim.section_id);
    const claimTextHash = text(claim.claim_text_hash, 160);
    const claimType = safeCode(claim.claim_type);
    const outcomes = Array.isArray(claim.outcomes)
      ? unique(claim.outcomes.flatMap((item) => CLAIM_OUTCOMES.includes(item as ClaimOutcome) ? [item as ClaimOutcome] : [])) as ClaimOutcome[]
      : [];
    if (!claimId || !sectionId || !HASH_PATTERN.test(claimTextHash) || !claimType) return [];
    return [{ claimId, sectionId, claimTextHash, claimType, outcomes }];
  });
}

function claimOutcomeCounts(claims: readonly AiTrustClaimReference[]) {
  const counts: Record<ClaimOutcome, number> = { accepted: 0, qualifier_required: 0, unresolved: 0, would_omit: 0, would_reject: 0 };
  for (const claim of claims) {
    const outcome: ClaimOutcome = claim.outcomes.includes("would_reject") ? "would_reject"
      : claim.outcomes.includes("would_omit") ? "would_omit"
        : claim.outcomes.includes("qualifier_required") ? "qualifier_required"
          : claim.outcomes.includes("unresolved") ? "unresolved" : "accepted";
    counts[outcome] += 1;
  }
  return counts;
}

export function parseTrustEvaluation(row: AiTrustUsageRow): { evaluation: AiTrustEvaluation | null; state: "missing" | "unsafe" | "malformed" | "valid" } {
  const raw = record(row.metadata_json).trust_shadow;
  if (!raw) return { evaluation: null, state: "missing" };
  if (hasForbiddenTelemetryKey(raw)) return { evaluation: null, state: "unsafe" };
  const telemetry = record(raw);
  const event = safeCode(telemetry.event);
  const workflow = safeCode(telemetry.workflow_id);
  const createdAt = safeDate(row.created_at);
  const provider = safeCode(telemetry.provider);
  const model = safeCode(telemetry.model);
  const releaseChannel = safeCode(telemetry.release_channel);
  const rulesetVersion = safeCode(telemetry.ruleset_version);
  const outputContractVersion = safeCode(telemetry.output_contract_version);
  const validatorVersion = safeCode(telemetry.validator_version);
  if (!UUID_PATTERN.test(row.id) || !createdAt || !workflow || !releaseChannel || !provider || !model || !rulesetVersion || !outputContractVersion || !validatorVersion || telemetry.mode !== "shadow" || !["trust_shadow_evaluation", "trust_shadow_internal_failure"].includes(event)) {
    return { evaluation: null, state: "malformed" };
  }
  const claimRefs = parseClaimRefs(telemetry.claim_refs);
  const declaredClaims = Math.max(0, Math.floor(numberValue(telemetry.total_claims)));
  if (event === "trust_shadow_evaluation" && declaredClaims !== claimRefs.length) return { evaluation: null, state: "malformed" };
  const snapshotFingerprint = telemetry.snapshot_fingerprint === null ? null : text(telemetry.snapshot_fingerprint, 160);
  const projectionFingerprint = telemetry.projection_fingerprint === null ? null : text(telemetry.projection_fingerprint, 160);
  const manifestFingerprint = text(telemetry.manifest_identity, 160);
  const outputHash = text(telemetry.response_hash, 160);
  const trustFingerprint = telemetry.trust_fingerprint === null ? null : text(telemetry.trust_fingerprint, 160);
  if ((snapshotFingerprint && !HASH_PATTERN.test(snapshotFingerprint)) || (projectionFingerprint && !HASH_PATTERN.test(projectionFingerprint)) || !HASH_PATTERN.test(manifestFingerprint) || !HASH_PATTERN.test(outputHash) || (trustFingerprint && !HASH_PATTERN.test(trustFingerprint))) {
    return { evaluation: null, state: "malformed" };
  }
  return {
    state: "valid",
    evaluation: {
      id: row.id, createdAt, workflow, releaseChannel, provider, model,
      rulesetVersion, outputContractVersion, validatorVersion, claimCount: declaredClaims,
      claimsByTaxonomy: countMap(telemetry.claims_by_taxonomy), claimOutcomes: claimOutcomeCounts(claimRefs),
      reasonFrequencies: countMap(telemetry.reason_frequencies),
      validationLatencyMs: Math.max(0, Math.floor(numberValue(telemetry.validation_latency_ms))),
      cacheState: safeCode(telemetry.cache_state) || "unknown", fallbackUsed: booleanValue(telemetry.fallback_used),
      stale: booleanValue(telemetry.stale), repairCount: Math.max(0, Math.floor(numberValue(telemetry.repair_count))),
      additionalProviderCalls: Math.max(0, Math.floor(numberValue(telemetry.additional_provider_calls))),
      shadowStatus: safeCode(telemetry.shadow_status) || "unknown", snapshotFingerprint, projectionFingerprint,
      manifestFingerprint, outputHash, trustFingerprint,
      providerRequestRef: telemetry.provider_request_ref === null ? null : safeCode(telemetry.provider_request_ref),
      claimRefs, shadowOnly: true
    }
  };
}

type ProviderAttempt = Readonly<{
  provider: string;
  model: string;
  success: boolean;
  fallback: boolean;
  latencyMs: number | null;
  failureCode: string;
}>;

function providerAttempts(metadataValue: unknown, row: Pick<AiTrustUsageRow, "model" | "status" | "latency_ms">): ProviderAttempt[] {
  const metadata = record(metadataValue);
  const attempts = Array.isArray(metadata.provider_attempts) ? metadata.provider_attempts : [];
  const parsed = attempts.flatMap((candidate) => {
    const attempt = record(candidate);
    const provider = safeCode(attempt.provider) || safeCode(metadata.provider) || "unknown";
    const model = safeCode(attempt.runtime_model) || safeCode(attempt.runtimeModel) || safeCode(attempt.model) || safeCode(attempt.requested_model) || safeCode(attempt.requestedModel);
    if (!model) return [];
    return [{
      provider,
      model,
      success: attempt.success === true,
      fallback: booleanValue(attempt.fallback) || safeCode(attempt.role) === "fallback",
      latencyMs: nullableNumber(attempt.latency_ms) ?? nullableNumber(attempt.latencyMs),
      failureCode: safeCode(attempt.validation_reason_code) || safeCode(attempt.validationReasonCode) || safeCode(attempt.failure_type) || safeCode(attempt.failureType)
    }];
  });
  if (parsed.length) return parsed;
  const model = safeCode(row.model);
  return model ? [{
    provider: safeCode(metadata.provider) || "unknown",
    model,
    success: row.status === "completed",
    fallback: booleanValue(metadata.fallback_used),
    latencyMs: nullableNumber(row.latency_ms),
    failureCode: row.status === "completed" ? "" : "provider_or_validation_failure"
  }] : [];
}

function usageMatchesProviderFilters(row: AiTrustUsageRow, filters: AiTrustFilters) {
  if (!filters.provider && !filters.model) return true;
  return providerAttempts(row.metadata_json, row).some((attempt) => (!filters.provider || attempt.provider === filters.provider) && (!filters.model || attempt.model === filters.model));
}

function evaluationMatchesFilters(evaluation: AiTrustEvaluation, filters: AiTrustFilters) {
  if (filters.workflow !== "all" && filters.workflow !== "business_health") return false;
  if (filters.releaseChannel && evaluation.releaseChannel !== filters.releaseChannel) return false;
  if (filters.provider && evaluation.provider !== filters.provider) return false;
  if (filters.model && evaluation.model !== filters.model) return false;
  if (filters.ruleset && evaluation.rulesetVersion !== filters.ruleset) return false;
  if (filters.rule && !evaluation.reasonFrequencies[filters.rule]) return false;
  if (filters.outcome !== "all" && evaluation.claimOutcomes[filters.outcome] === 0) return false;
  return true;
}

function platformPulse(evaluations: readonly AiTrustEvaluation[]): AiTrustPlatformPulse {
  const totalClaims = evaluations.reduce((sum, row) => sum + row.claimCount, 0);
  const accepted = evaluations.reduce((sum, row) => sum + row.claimOutcomes.accepted, 0);
  return {
    instrumentedRuns: evaluations.length,
    totalClaims,
    accepted,
    qualifierRequired: evaluations.reduce((sum, row) => sum + row.claimOutcomes.qualifier_required, 0),
    unresolved: evaluations.reduce((sum, row) => sum + row.claimOutcomes.unresolved, 0),
    wouldOmit: evaluations.reduce((sum, row) => sum + row.claimOutcomes.would_omit, 0),
    wouldReject: evaluations.reduce((sum, row) => sum + row.claimOutcomes.would_reject, 0),
    averageValidationLatencyMs: average(evaluations.map((row) => row.validationLatencyMs)),
    additionalProviderCalls: evaluations.reduce((sum, row) => sum + row.additionalProviderCalls, 0),
    additionalAiCostCents: 0,
    acceptedRate: percentage(accepted, totalClaims),
    sampleInsufficient: evaluations.length < 30
  };
}

function reasoningMetrics(usageRows: readonly AiTrustUsageRow[], runs: readonly AiTrustAgentRunRow[], savedAnalyses: number | null): PartialReasoningMetrics {
  const fallbackRuns = usageRows.filter((row) => booleanValue(record(row.metadata_json).fallback_used)).length;
  const attempts = usageRows.flatMap((row) => providerAttempts(row.metadata_json, row));
  return {
    runs: usageRows.length,
    completedArtifacts: runs.filter((run) => run.status === "completed").length,
    failedArtifacts: runs.filter((run) => run.status === "failed").length,
    failedValidationAttempts: attempts.filter((attempt) => !attempt.success && Boolean(attempt.failureCode)).length,
    fallbackRuns,
    fallbackRate: percentage(fallbackRuns, usageRows.length),
    averageProviderLatencyMs: average(usageRows.flatMap((row) => row.latency_ms === null ? [] : [row.latency_ms])),
    savedAnalyses
  };
}

function extractionConfidence(note: AiTrustBusinessNoteRow) {
  const value = typeof note.extraction_confidence === "string" ? Number(note.extraction_confidence) : note.extraction_confidence;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function correctionCount(note: AiTrustBusinessNoteRow) {
  const value = typeof note.correction_count === "string" ? Number(note.correction_count) : note.correction_count;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function businessNoteAttempts(note: AiTrustBusinessNoteRow): ProviderAttempt[] {
  return providerAttempts({ provider: note.provider_name, provider_attempts: note.provider_attempts_json }, {
    model: note.model_used,
    status: note.status === "extraction_failed" ? "failed" : "completed",
    latency_ms: note.latency_ms
  });
}

function businessNotesMetrics(notes: readonly AiTrustBusinessNoteRow[]): BusinessNotesTrustMetrics {
  const processed = notes.filter((note) => Boolean(note.extracted_at));
  const successful = processed.filter((note) => note.status !== "extraction_failed");
  const approved = notes.filter((note) => Boolean(note.approved_at));
  const rejected = notes.filter((note) => note.status === "rejected");
  const confidences = successful.flatMap((note) => {
    const confidence = extractionConfidence(note);
    return confidence === null ? [] : [confidence];
  });
  const attempts = processed.map((note) => businessNoteAttempts(note));
  const humanDisagreementCount = approved.filter((note) => correctionCount(note) > 0).length;
  const extractionFailures = processed.filter((note) => note.status === "extraction_failed").length;
  const awaitingReview = notes.filter((note) => note.status === "review_required").length;
  return {
    submitted: notes.length,
    processed: processed.length,
    successfulExtractions: successful.length,
    extractionFailures,
    awaitingReview,
    approved: approved.length,
    rejected: rejected.length,
    approvalRate: percentage(approved.length, approved.length + rejected.length),
    averageConfidence: confidences.length ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 1000) / 1000 : null,
    medianConfidence: confidences.length ? Math.round((median(confidences) || 0) * 1000) / 1000 : null,
    lowConfidenceCount: confidences.filter((value) => value < 0.7).length,
    averageProcessingTimeMs: average(processed.flatMap((note) => note.latency_ms === null ? [] : [note.latency_ms])),
    lunaRuns: attempts.filter((items) => items.some((attempt) => attempt.model.includes("gpt-5.6-luna"))).length,
    terraFallbackRuns: attempts.filter((items) => items.some((attempt) => attempt.fallback && attempt.model.includes("gpt-5.6-terra"))).length,
    fallbackRate: percentage(processed.filter((note) => note.fallback_used).length, processed.length),
    humanDisagreementCount,
    humanDisagreementRate: percentage(humanDisagreementCount, approved.length),
    activeContextRecords: notes.filter((note) => Boolean(note.approved_at) && note.evidence_lifecycle_status === "active" && !note.deleted_at).length,
    archivedContextRecords: notes.filter((note) => Boolean(note.approved_at) && (note.evidence_lifecycle_status === "archived" || Boolean(note.archived_at))).length,
    issueCounts: [
      { label: "Extraction failed", count: extractionFailures },
      { label: "Low-confidence extraction", count: confidences.filter((value) => value < 0.7).length },
      { label: "Awaiting human review", count: awaitingReview },
      { label: "Human correction recorded", count: humanDisagreementCount }
    ]
  };
}

function ruleStatus(reasonCode: string): Pick<AiTrustReasonIssue, "severity" | "status"> {
  if (reasonCode === "trust_shadow_internal_failure" || reasonCode.includes("workspace_scope") || reasonCode.includes("fingerprint_mismatch")) {
    return { severity: "blocking", status: "enforcement blocker" };
  }
  if (reasonCode.includes("unresolved")) return { severity: "warning", status: "calibration candidate" };
  return { severity: "info", status: "expected" };
}

function humanizeReason(reasonCode: string) {
  return REASON_LABELS[reasonCode] || reasonCode.split("_").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

function ruleHealth(evaluations: readonly AiTrustEvaluation[], filters: AiTrustFilters): AiTrustReasonIssue[] {
  const map = new Map<string, { count: number; affectedRuns: number; latest: string; ruleset: string }>();
  for (const evaluation of evaluations) {
    for (const [reasonCode, count] of Object.entries(evaluation.reasonFrequencies)) {
      if (filters.rule && filters.rule !== reasonCode) continue;
      const current = map.get(reasonCode);
      map.set(reasonCode, {
        count: (current?.count || 0) + count,
        affectedRuns: (current?.affectedRuns || 0) + 1,
        latest: !current || evaluation.createdAt > current.latest ? evaluation.createdAt : current.latest,
        ruleset: !current || evaluation.createdAt > current.latest ? evaluation.rulesetVersion : current.ruleset
      });
    }
  }
  return [...map.entries()].map(([reasonCode, value]) => ({
    reasonCode, label: humanizeReason(reasonCode), workflow: "Business Health", occurrences: value.count,
    occurrenceRate: percentage(value.affectedRuns, evaluations.length), latestOccurrence: value.latest,
    rulesetVersion: value.ruleset, ...ruleStatus(reasonCode)
  })).sort((a, b) => b.occurrences - a.occurrences || a.reasonCode.localeCompare(b.reasonCode));
}

type ProviderHealthEvent = ProviderAttempt & Readonly<{
  workflow: string;
  trustLatencyMs: number | null;
  trustUnresolvedClaims: number;
}>;

function providerEventsForUsage(workflow: string, rows: readonly AiTrustUsageRow[], evaluations: readonly AiTrustEvaluation[]) {
  const trustByUsageId = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  return rows.flatMap((row): ProviderHealthEvent[] => {
    const trust = trustByUsageId.get(row.id);
    return providerAttempts(row.metadata_json, row).map((attempt) => ({
      ...attempt,
      workflow,
      trustLatencyMs: trust?.validationLatencyMs ?? null,
      trustUnresolvedClaims: trust?.claimOutcomes.unresolved ?? 0
    }));
  });
}

function providerEventsForBusinessNotes(notes: readonly AiTrustBusinessNoteRow[]) {
  return notes.flatMap((note): ProviderHealthEvent[] => businessNoteAttempts(note).map((attempt) => ({
    ...attempt,
    workflow: "Business Notes",
    trustLatencyMs: null,
    trustUnresolvedClaims: 0
  })));
}

function providerHealth(events: readonly ProviderHealthEvent[], filters: AiTrustFilters): AiTrustProviderHealth[] {
  const grouped = new Map<string, ProviderHealthEvent[]>();
  for (const event of events) {
    if (filters.provider && event.provider !== filters.provider) continue;
    if (filters.model && event.model !== filters.model) continue;
    const key = `${event.workflow}\u0000${event.provider}\u0000${event.model}`;
    grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  return [...grouped.values()].map((items) => {
    const first = items[0];
    const failures = new Map<string, number>();
    for (const item of items) {
      if (item.failureCode) failures.set(item.failureCode, (failures.get(item.failureCode) || 0) + 1);
      if (item.trustUnresolvedClaims) failures.set("trust_unresolved_claim", (failures.get("trust_unresolved_claim") || 0) + item.trustUnresolvedClaims);
    }
    const fallbackCount = items.filter((item) => item.fallback).length;
    return {
      provider: first.provider,
      model: first.model,
      workflow: first.workflow,
      attempts: items.length,
      successfulValidatedCompletions: items.filter((item) => item.success).length,
      fallbackCount,
      fallbackRate: percentage(fallbackCount, items.length),
      averageProviderLatencyMs: average(items.flatMap((item) => item.latencyMs === null ? [] : [item.latencyMs])),
      averageTrustValidationLatencyMs: average(items.flatMap((item) => item.trustLatencyMs === null ? [] : [item.trustLatencyMs])),
      failureCategories: [...failures.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    };
  }).sort((a, b) => b.attempts - a.attempts || a.workflow.localeCompare(b.workflow) || a.model.localeCompare(b.model));
}

function businessHealthMetrics(evaluations: readonly AiTrustEvaluation[]): BusinessHealthTrustMetrics {
  const totalClaims = evaluations.reduce((sum, evaluation) => sum + evaluation.claimCount, 0);
  const fallbackRuns = evaluations.filter((evaluation) => evaluation.fallbackUsed).length;
  return {
    totalRuns: evaluations.length,
    totalClaims,
    accepted: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.accepted, 0),
    qualifierRequired: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.qualifier_required, 0),
    unresolved: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.unresolved, 0),
    wouldOmit: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.would_omit, 0),
    wouldReject: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.would_reject, 0),
    averageValidationLatencyMs: average(evaluations.map((evaluation) => evaluation.validationLatencyMs)),
    p95ValidationLatencyMs: p95(evaluations.map((evaluation) => evaluation.validationLatencyMs)),
    solRuns: evaluations.filter((evaluation) => evaluation.model.toLowerCase().includes("sol")).length,
    terraFallbackRuns: evaluations.filter((evaluation) => evaluation.fallbackUsed && evaluation.model.toLowerCase().includes("terra")).length,
    fallbackRate: percentage(fallbackRuns, evaluations.length),
    rulesetVersions: unique(evaluations.map((evaluation) => evaluation.rulesetVersion)),
    outputContractVersions: unique(evaluations.map((evaluation) => evaluation.outputContractVersion)),
    sampleInsufficient: evaluations.length < 30
  };
}

function workflowSummaries(input: {
  evaluations: readonly AiTrustEvaluation[];
  finding: PartialReasoningMetrics;
  file: PartialReasoningMetrics;
  notes: BusinessNotesTrustMetrics;
  filters: AiTrustFilters;
}): AiTrustWorkflowSummary[] {
  const { evaluations, finding, file, notes, filters } = input;
  const businessHealthFailures = evaluations.filter((evaluation) => evaluation.shadowStatus === "internal_failure").length;
  const rows: AiTrustWorkflowSummary[] = [
    {
      key: "business_health",
      label: "Business Health",
      instrumentation: "Fully Instrumented",
      runs: evaluations.length,
      units: evaluations.reduce((sum, evaluation) => sum + evaluation.claimCount, 0),
      acceptedOrApproved: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.accepted, 0),
      unresolvedOrNeedsReview: evaluations.reduce((sum, evaluation) => sum + evaluation.claimOutcomes.unresolved, 0),
      failures: businessHealthFailures,
      failureRate: percentage(businessHealthFailures, evaluations.length),
      averageLatencyMs: average(evaluations.map((evaluation) => evaluation.validationLatencyMs)),
      fallbackRate: percentage(evaluations.filter((evaluation) => evaluation.fallbackUsed).length, evaluations.length),
      sampleSize: evaluations.length,
      sampleInsufficient: evaluations.length < 30,
      note: "Trust Layer V1 claim telemetry is available in shadow mode."
    },
    {
      key: "finding_explanation",
      label: "Explain Finding",
      instrumentation: "Partially Instrumented",
      runs: finding.runs,
      units: finding.completedArtifacts,
      acceptedOrApproved: null,
      unresolvedOrNeedsReview: null,
      failures: finding.failedArtifacts,
      failureRate: percentage(finding.failedArtifacts, finding.completedArtifacts + finding.failedArtifacts),
      averageLatencyMs: finding.averageProviderLatencyMs,
      fallbackRate: finding.fallbackRate,
      sampleSize: finding.runs,
      sampleInsufficient: finding.runs < 30,
      note: "Provider and artifact validation are available. Trust claim validation and release channel are not yet instrumented."
    },
    {
      key: "file_analysis",
      label: "File Analysis",
      instrumentation: "Partially Instrumented",
      runs: file.runs,
      units: file.completedArtifacts,
      acceptedOrApproved: null,
      unresolvedOrNeedsReview: null,
      failures: file.failedArtifacts,
      failureRate: percentage(file.failedArtifacts, file.completedArtifacts + file.failedArtifacts),
      averageLatencyMs: file.averageProviderLatencyMs,
      fallbackRate: file.fallbackRate,
      sampleSize: file.runs,
      sampleInsufficient: file.runs < 30,
      note: "Provider and schema diagnostics are available. Claim Trust and aggregate lineage coverage are not yet instrumented."
    },
    {
      key: "business_notes",
      label: "Business Notes",
      instrumentation: "Extraction Monitoring",
      runs: notes.processed,
      units: notes.successfulExtractions,
      acceptedOrApproved: notes.approved,
      unresolvedOrNeedsReview: notes.awaitingReview,
      failures: notes.extractionFailures,
      failureRate: percentage(notes.extractionFailures, notes.processed),
      averageLatencyMs: notes.averageProcessingTimeMs,
      fallbackRate: notes.fallbackRate,
      sampleSize: notes.processed,
      sampleInsufficient: notes.processed < 30,
      note: "Extraction, provider, confidence, and human review lifecycle metrics only; not reasoning-claim acceptance."
    }
  ];
  return rows.filter((row) => filters.workflow === "all" || row.key === filters.workflow);
}

function stableRulesetDays(evaluations: readonly AiTrustEvaluation[]) {
  if (!evaluations.length) return null;
  const sorted = [...evaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = sorted[0].rulesetVersion;
  const matching = sorted.filter((evaluation) => evaluation.rulesetVersion === current);
  const earliest = matching.reduce((value, evaluation) => evaluation.createdAt < value ? evaluation.createdAt : value, matching[0].createdAt);
  return Math.max(0, Math.floor((Date.parse(sorted[0].createdAt) - Date.parse(earliest)) / 86_400_000));
}

function enforcementReadiness(evaluations: readonly AiTrustEvaluation[], unsafeTelemetryRows: number): AiTrustEnforcementReadiness {
  const pulse = platformPulse(evaluations);
  const unresolvedRate = percentage(pulse.unresolved, pulse.totalClaims);
  const wouldOmitRate = percentage(pulse.wouldOmit, pulse.totalClaims);
  const wouldRejectRate = percentage(pulse.wouldReject, pulse.totalClaims);
  const crossWorkspaceFailures = evaluations.reduce((sum, evaluation) => sum + Object.entries(evaluation.reasonFrequencies)
    .filter(([reason]) => reason.includes("workspace_scope"))
    .reduce((reasonSum, [, count]) => reasonSum + count, 0), 0);
  const blocked = unsafeTelemetryRows > 0 || crossWorkspaceFailures > 0 || pulse.additionalProviderCalls > 0;
  const needsCalibration = (unresolvedRate || 0) > 5 || pulse.wouldOmit > 0 || pulse.wouldReject > 0 || pulse.qualifierRequired > 0;
  const status: AiTrustEnforcementReadiness["status"] = blocked
    ? "Blocked"
    : evaluations.length < 30
      ? "Not Enough Data"
      : needsCalibration
        ? "Calibration Required"
        : "Candidate for Review";
  return {
    status,
    sampleSize: evaluations.length,
    acceptedRate: pulse.acceptedRate,
    unresolvedRate,
    wouldOmitRate,
    wouldRejectRate,
    suspectedFalsePositiveReviewCount: null,
    stableRulesetDays: stableRulesetDays(evaluations),
    p95ValidationLatencyMs: p95(evaluations.map((evaluation) => evaluation.validationLatencyMs)),
    privacyIncidents: unsafeTelemetryRows,
    crossWorkspaceFailures,
    additionalProviderCalls: pulse.additionalProviderCalls,
    latestRulesetVersion: [...evaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.rulesetVersion || null,
    note: status === "Candidate for Review"
      ? "Measured prerequisites are within the current review thresholds. A separate human-reviewed change is still required before enforcement."
      : status === "Not Enough Data"
        ? "At least 30 instrumented Business Health runs are required before readiness can be assessed."
        : status === "Blocked"
          ? "Privacy, workspace-scope, or provider-call invariants require investigation before enforcement review."
          : "Shadow outcomes require calibration review before enforcement can be considered."
  };
}

function workflowSelected(filters: AiTrustFilters, workflow: Exclude<AiTrustWorkflowFilter, "all">) {
  return filters.workflow === "all" || filters.workflow === workflow;
}

function trustOnlyFilterSelected(filters: AiTrustFilters) {
  return Boolean(filters.ruleset || filters.rule || filters.outcome !== "all");
}

function businessNoteMatchesFilters(note: AiTrustBusinessNoteRow, filters: AiTrustFilters) {
  if (filters.releaseChannel && note.release_channel !== filters.releaseChannel) return false;
  if (!filters.provider && !filters.model) return true;
  return businessNoteAttempts(note).some((attempt) =>
    (!filters.provider || attempt.provider === filters.provider) && (!filters.model || attempt.model === filters.model));
}

function filterOptions(input: AiTrustDashboardInput, evaluations: readonly AiTrustEvaluation[]) {
  const usageAttempts = [
    ...input.businessHealthUsage,
    ...input.findingExplanationUsage,
    ...input.fileAnalysisUsage
  ].flatMap((row) => providerAttempts(row.metadata_json, row));
  const noteAttempts = input.businessNotes.flatMap((note) => businessNoteAttempts(note));
  return {
    providers: unique([...evaluations.map((evaluation) => evaluation.provider), ...usageAttempts.map((attempt) => attempt.provider), ...noteAttempts.map((attempt) => attempt.provider)]),
    models: unique([...evaluations.map((evaluation) => evaluation.model), ...usageAttempts.map((attempt) => attempt.model), ...noteAttempts.map((attempt) => attempt.model)]),
    rulesets: unique(evaluations.map((evaluation) => evaluation.rulesetVersion)),
    rules: unique(evaluations.flatMap((evaluation) => Object.keys(evaluation.reasonFrequencies))),
    releaseChannels: unique([...evaluations.map((evaluation) => evaluation.releaseChannel), ...input.businessNotes.map((note) => safeCode(note.release_channel))])
  };
}

export function buildAiTrustDashboardSnapshot(input: AiTrustDashboardInput): AiTrustDashboardSnapshot {
  const parsed = input.businessHealthUsage.map(parseTrustEvaluation);
  const allEvaluations = parsed.flatMap((result) => result.evaluation ? [result.evaluation] : []);
  const includeBusinessHealth = workflowSelected(input.filters, "business_health");
  const filteredEvaluations = includeBusinessHealth
    ? allEvaluations.filter((evaluation) => evaluationMatchesFilters(evaluation, input.filters))
    : [];
  const selectedEvaluationIds = new Set(filteredEvaluations.map((evaluation) => evaluation.id));
  const hasTrustOnlyFilter = trustOnlyFilterSelected(input.filters);
  const allowPartialReasoning = !hasTrustOnlyFilter && !input.filters.releaseChannel;

  const businessHealthUsage = includeBusinessHealth
    ? input.businessHealthUsage.filter((row) => usageMatchesProviderFilters(row, input.filters))
      .filter((row) => hasTrustOnlyFilter || input.filters.releaseChannel ? selectedEvaluationIds.has(row.id) : true)
    : [];
  const findingUsage = workflowSelected(input.filters, "finding_explanation") && allowPartialReasoning
    ? input.findingExplanationUsage.filter((row) => usageMatchesProviderFilters(row, input.filters))
    : [];
  const findingRuns = input.filters.provider || input.filters.model
    ? findingUsage.map((row) => ({ id: row.id, agent_type: "finding_explanation_v1", status: row.status, created_at: row.created_at }))
    : workflowSelected(input.filters, "finding_explanation") && allowPartialReasoning ? input.findingExplanationRuns : [];
  const fileUsage = workflowSelected(input.filters, "file_analysis") && allowPartialReasoning
    ? input.fileAnalysisUsage.filter((row) => usageMatchesProviderFilters(row, input.filters))
    : [];
  const fileRuns = input.filters.provider || input.filters.model
    ? fileUsage.map((row) => ({ id: row.id, agent_type: "file_analysis", status: row.status, created_at: row.created_at }))
    : workflowSelected(input.filters, "file_analysis") && allowPartialReasoning ? input.fileAnalysisRuns : [];
  const notes = workflowSelected(input.filters, "business_notes") && !hasTrustOnlyFilter
    ? input.businessNotes.filter((note) => businessNoteMatchesFilters(note, input.filters))
    : [];

  const finding = reasoningMetrics(
    findingUsage,
    findingRuns,
    input.filters.provider || input.filters.model || input.filters.releaseChannel ? null : input.savedFindingAnalyses
  );
  const file = reasoningMetrics(fileUsage, fileRuns, null);
  const noteMetrics = businessNotesMetrics(notes);
  const privacyUnsafeRows = includeBusinessHealth ? parsed.filter((result) => result.state === "unsafe").length : 0;
  const malformedTelemetryRows = includeBusinessHealth ? parsed.filter((result) => result.state === "malformed").length : 0;
  const providerEvents = [
    ...providerEventsForUsage("Business Health", businessHealthUsage, filteredEvaluations),
    ...providerEventsForUsage("Explain Finding", findingUsage, []),
    ...providerEventsForUsage("File Analysis", fileUsage, []),
    ...providerEventsForBusinessNotes(notes)
  ];
  const sortedEvaluations = [...filteredEvaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const evaluationCount = sortedEvaluations.length;
  const totalEvaluationPages = Math.max(1, Math.ceil(evaluationCount / AI_TRUST_EVALUATION_PAGE_SIZE));
  const safePage = Math.min(input.filters.page, totalEvaluationPages);
  const pageStart = (safePage - 1) * AI_TRUST_EVALUATION_PAGE_SIZE;
  const selectedEvaluation = input.filters.evaluation
    ? sortedEvaluations.find((evaluation) => evaluation.id === input.filters.evaluation) || null
    : null;
  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    platform: platformPulse(filteredEvaluations),
    workflows: workflowSummaries({ evaluations: filteredEvaluations, finding, file, notes: noteMetrics, filters: input.filters }),
    businessHealth: businessHealthMetrics(filteredEvaluations),
    findingExplanation: finding,
    fileAnalysis: file,
    businessNotes: noteMetrics,
    rules: ruleHealth(filteredEvaluations, input.filters),
    providers: providerHealth(providerEvents, input.filters),
    evaluations: sortedEvaluations.slice(pageStart, pageStart + AI_TRUST_EVALUATION_PAGE_SIZE),
    selectedEvaluation,
    evaluationCount,
    totalEvaluationPages,
    readiness: enforcementReadiness(filteredEvaluations, privacyUnsafeRows),
    unsafeTelemetryRows: privacyUnsafeRows,
    malformedTelemetryRows,
    truncated: Boolean(input.truncated),
    sourceErrors: input.sourceErrors || [],
    availableFilters: filterOptions(input, allEvaluations)
  };
}

export function shortFingerprint(value: string | null) {
  if (!value) return "Not recorded";
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}
