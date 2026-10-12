/** Content-free DTOs. Every decoded field is explicitly listed; never spread DB JSON. */
export type AdminUsageInput = { start: string; end: string; workspaceId?: string | null; page?: number; workspacePage?: number };
export const USAGE_METRIC_KEYS = ["estimatedSpendUsd", "uncertainEstimateUsd", "unknownCostCount", "usageRecords", "providerAttempts", "providerAttemptSamples", "inputTokens", "outputTokens", "cachedInputTokens", "webSearchCalls", "webOpenCalls", "webFindCalls", "researchToolUsd", "latencySamples", "latencyTotalMs", "vsiQuestions", "vsiSettledAttempts", "vsiRetryAttempts", "vsiProviderRetries", "vsiCompleted", "vsiFailed", "vsiPending", "artifactRuns", "savedAnalyses", "vsiTelemetrySamples", "vsiApplicationFailures", "vsiProviderFailures", "vsiTimeouts", "vsiOutputValidationFailures", "vsiCitationValidationFailures", "vsiBudgetBlocks", "vsiContextBlocks", "vsiEvidenceUnavailable", "vsiResearchCompleted", "vsiResearchPartial", "vsiResearchFailed", "vsiResearchNotRequired", "vsiCitationsValidated", "vsiCitationsNotRequired", "vsiEvidenceLimitations", "vsiNoteProposals"] as const;
export type UsageMetricKey = (typeof USAGE_METRIC_KEYS)[number];
export type UsageTotals = Record<UsageMetricKey, number>;
export type UsageFeature = UsageTotals & { feature: string };
export type UsageWorkspace = UsageTotals & { id: string; name: string; monthAiTokens: number; monthVsiSpendUsd: number; outstandingVsiReservedUsd: number; monthlyTokenBudget: number; monthlyVsiBudgetUsd: number };
export type UsageDetail = UsageTotals & { id: string; workspaceId: string | null; feature: string; source: string; status: string; createdAt: string; latencyMs: number | null };
export type AdminUsageSnapshot = {
  start: string; end: string; previousStart: string; page: number; pageSize: number; workspacePage: number; workspacePageSize: number;
  totals: UsageTotals; previous: UsageTotals; unassignedTotals: UsageTotals; outstandingReservedUsd: number;
  trend: { day: string; totals: UsageTotals }[]; features: UsageFeature[];
  workspaces: UsageWorkspace[]; workspaceCount: number; workspaceOptions: { id: string; name: string }[]; workspaceOptionsTruncated: boolean;
  details: UsageDetail[]; detailCount: number; budgetPeriodStart: string; budgetResetsAt: string; error: string | null;
};
function record(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
function rows(v: unknown): Record<string, unknown>[] { return Array.isArray(v) ? v.map(record) : []; }
function number(v: unknown) { return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0; }
function text(v: unknown) { return typeof v === "string" ? v : ""; }
function totals(v: unknown): UsageTotals { const source = record(v); return Object.fromEntries(USAGE_METRIC_KEYS.map(key => [key, number(source[key])])) as UsageTotals; }
export function emptyAdminUsageSnapshot(input: AdminUsageInput, error: string): AdminUsageSnapshot {
  return { start: input.start, end: input.end, previousStart: "", page: input.page || 1, pageSize: 25, workspacePage: input.workspacePage || 1, workspacePageSize: 25, totals: totals({}), previous: totals({}), unassignedTotals: totals({}), outstandingReservedUsd: 0, trend: [], features: [], workspaces: [], workspaceCount: 0, workspaceOptions: [], workspaceOptionsTruncated: false, details: [], detailCount: 0, budgetPeriodStart: "", budgetResetsAt: "", error };
}
export function decodeAdminUsageSnapshot(value: unknown, input: AdminUsageInput, budget: { monthlyTokenBudget: number; monthlyVsiBudgetUsd: number }): AdminUsageSnapshot {
  const source = record(value);
  const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const isDate = (v: unknown) => typeof v === "string" && Number.isFinite(new Date(v).getTime());
  const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const validTotals = (v: unknown) => USAGE_METRIC_KEYS.every(key => isNumber(record(v)[key]));
  const allRows = (v: unknown, check: (row: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every(row => row && typeof row === "object" && !Array.isArray(row) && check(row));
  const validFeatures = new Set(["vsi", "business_health_explanation_v1", "finding_explanation_v1", "file_analysis", "business_note_extraction_v1", "intelligence_briefing_v1", "global_search_or_ask", "saved_analysis", "other_recorded_workflow"]);
  const sources = new Set(["ai_usage", "vsi_cost_events", "vsi_requests", "ai_agent_runs", "reports"]);
  const statuses = new Set(["completed", "failed", "pending", "processing", "unknown", "saved"]);
  if (!validTotals(source.totals) || !validTotals(source.previous) || !validTotals(source.unassignedTotals) || !isNumber(source.outstandingReservedUsd)
    || ![source.start, source.end, source.previousStart, source.budgetPeriodStart, source.budgetResetsAt].every(isDate)
    || ![source.page, source.pageSize, source.workspacePage, source.workspacePageSize].every(v => isNumber(v) && Number.isInteger(v) && v > 0)
    || ![source.workspaceCount, source.detailCount].every(v => isNumber(v) && Number.isInteger(v))
    || !allRows(source.trend, row => isDate(row.day) && validTotals(row.totals))
    || !allRows(source.features, row => validFeatures.has(text(row.feature)) && validTotals(row))
    || !allRows(source.workspaces, row => isUuid(row.id) && typeof row.name === "string" && validTotals(row) && [row.monthAiTokens, row.monthVsiSpendUsd, row.outstandingVsiReservedUsd].every(isNumber))
    || !allRows(source.workspaceOptions, row => isUuid(row.id) && typeof row.name === "string")
    || !allRows(source.details, row => isUuid(row.id) && (row.workspaceId === null || isUuid(row.workspaceId)) && validFeatures.has(text(row.feature)) && sources.has(text(row.source)) && statuses.has(text(row.status)) && isDate(row.createdAt) && validTotals(row))) {
    return emptyAdminUsageSnapshot(input, "Usage telemetry returned an incomplete report. Spending is unavailable.");
  }
  return {
    start: text(source.start), end: text(source.end), previousStart: text(source.previousStart), page: number(source.page), pageSize: number(source.pageSize), workspacePage: number(source.workspacePage), workspacePageSize: number(source.workspacePageSize),
    totals: totals(source.totals), previous: totals(source.previous), unassignedTotals: totals(source.unassignedTotals), outstandingReservedUsd: number(source.outstandingReservedUsd),
    trend: rows(source.trend).map(row => ({ day: text(row.day), totals: totals(row.totals) })),
    features: rows(source.features).map(row => ({ feature: text(row.feature), ...totals(row) })),
    workspaces: rows(source.workspaces).map(row => ({ id: text(row.id), name: text(row.name), ...totals(row), monthAiTokens: number(row.monthAiTokens), monthVsiSpendUsd: number(row.monthVsiSpendUsd), outstandingVsiReservedUsd: number(row.outstandingVsiReservedUsd), monthlyTokenBudget: budget.monthlyTokenBudget, monthlyVsiBudgetUsd: budget.monthlyVsiBudgetUsd })),
    workspaceCount: number(source.workspaceCount), workspaceOptions: rows(source.workspaceOptions).slice(0, 1000).map(row => ({ id: text(row.id), name: text(row.name) })), workspaceOptionsTruncated: rows(source.workspaceOptions).length > 1000,
    details: rows(source.details).map(row => ({ id: text(row.id), workspaceId: typeof row.workspaceId === "string" ? row.workspaceId : null, feature: text(row.feature), source: text(row.source), status: text(row.status), createdAt: text(row.createdAt), ...totals(row), latencyMs: number(row.latencySamples) > 0 ? number(row.latencyTotalMs) / number(row.latencySamples) : null })),
    detailCount: number(source.detailCount), budgetPeriodStart: text(source.budgetPeriodStart), budgetResetsAt: text(source.budgetResetsAt), error: null
  };
}
export const USAGE_FEATURE_LABELS: Record<string, string> = {
  vsi: "VSI questions", business_health_explanation_v1: "Business Health explanations", finding_explanation_v1: "Finding explanations",
  file_analysis: "File analysis", business_note_extraction_v1: "Business Note extraction", intelligence_briefing_v1: "Weekly and monthly briefings",
  global_search_or_ask: "Search and Ask", kpi_semantic_classification_v1: "KPI semantic suggestions", evidence_retrieval_services: "Evidence embeddings and reranking", document_extraction_services: "Document extraction services", saved_analysis: "Saved analyses", other_recorded_workflow: "Other recorded workflows"
};
export const USAGE_COVERAGE = [
  { feature: "vsi", measurement: "Requests measure questions; cost events measure settled attempts, tokens and web tools. Request cumulative costs are excluded." },
  { feature: "intelligence_briefing_v1", measurement: "Weekly and monthly generation usage and artifacts are recorded. Cached briefing reads create no new provider usage." },
  { feature: "business_health_explanation_v1", measurement: "Recorded provider usage and generated artifacts; cached reads are not paid calls." },
  { feature: "finding_explanation_v1", measurement: "Recorded provider usage and generated artifacts; saved analyses are counted separately." },
  { feature: "file_analysis", measurement: "Recorded provider usage and generated artifacts." },
  { feature: "business_note_extraction_v1", measurement: "Recorded extraction provider usage. Confirming an explicit VSI note is not an extraction call." },
  { feature: "global_search_or_ask", measurement: "Recorded Search and Ask answer-generation usage. Deterministic search does not imply a provider call; separate retrieval services below are not metered here." },
  { feature: "kpi_semantic_classification_v1", measurement: "When enabled, semantic suggestions can call a provider. This path does not write an authoritative cost event to these ledgers; cost and attempt coverage are not measured here." },
  { feature: "evidence_retrieval_services", measurement: "When enabled, evidence indexing/query embeddings and optional reranking can incur provider charges. Their costs are not measured by these ledgers and are excluded from this report." },
  { feature: "document_extraction_services", measurement: "Document-extraction worker/OCR charges are outside these AI usage ledgers. File-analysis generation above does not include those processing costs." }
] as const;
