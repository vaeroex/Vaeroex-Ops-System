import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
  EXECUTIVE_KPI_ANALYSIS_JSON_SCHEMA,
  type ExecutiveKpiAnalysisArtifact,
  type ExecutiveKpiAnalysisModelOutput,
  type ExecutiveKpiAnalysisPackage
} from "@/lib/ai/executive-kpi-analysis/contracts";
import { validateExecutiveKpiAnalysisOutput } from "@/lib/ai/executive-kpi-analysis/validation";
import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { runStructuredAI, type AIProviderAttempt } from "@/lib/ai/providers/provider-manager";
import {
  BUSINESS_HEALTH_GPT56_TERRA_MODEL,
  resolveExecutiveKpiAnalysisGenerationPolicy
} from "@/lib/ai/providers/workflow-provider-policy";
import { assertWorkspaceTokenBudget, estimateTokenCount, type VaeroexTokenUsage } from "@/lib/ai/usage";
import type { Database, Json } from "@/lib/supabase/types";

export const EXECUTIVE_KPI_ANALYSIS_SYSTEM_PROMPT = `You are Vaeroex's fixed Executive KPI Analysis synthesizer.
Write like a thoughtful business analyst speaking to an owner or executive. Interpret only the supplied deterministic KPI package. The application controls every KPI name, value, percentage, trend, direction, period, freshness state, confidence value, relationship status, citation, and limitation.
Refer to every supplied metric in prose only as "KPI <ordinal>", such as "KPI 1". Never write, paraphrase, or rename a KPI name; application code restores the exact name after validation. Never create, calculate, or reinterpret a KPI or number. Never emit citation IDs, source IDs, internal IDs, markdown, hidden reasoning, or implementation language.

Distinguish three levels clearly:
1. A visible directional pattern may be described when supplied KPIs move together or in opposing directions.
2. Statistical correlation may be described only when the package explicitly supplies valid correlation support.
3. Causation may be described only when the package explicitly authorizes causation.

Lead with the useful business story. Visible patterns may be called "a visible pattern", "a pattern worth investigating", "movements that appear connected", or "timing that suggests a possible relationship". Do not repeat the same statistical or causation disclaimer in multiple sections; state the most important limitation once, naturally, after the interpretation.

Keep every section concise:
- executive_summary: two or three sentences covering the combined story, why it matters, and the appropriate confidence boundary.
- significant_trends: one or two grouped statements. Explain the combined pattern instead of listing every KPI separately when they form one story.
- potential_kpi_relationships: group two to four KPI ordinals when one visible pattern connects them. Use "Pattern worth investigating" or "Possible relationship" for directional patterns, correlation labels only when supported, and "No clear relationship detected" when the package establishes no useful pattern.
- possible_business_drivers: one or two bounded possible explanations tied to at least two KPI ordinals. Use conditional language such as "may", "might", "could", "suggests", or "worth investigating". Explain that the chart points to an area to investigate, not that one KPI caused another.
- leadership_considerations: identify what to investigate first, what to monitor next, and what future movement would strengthen or weaken the possible relationship. Do not merely tell leadership to update data unless staleness is the primary limitation.
- analysis_limitations: one concise statement or no more than three short statements in plain language.

Do not use phrases such as "penultimate observation", "immutable ordinal", "application-owned", "observed movement only", "contextual validation", "underlying driver is not established", or "correlation, significance, and causation are not established". Do not invent a fact, cause, quantified impact, urgency, forecast, recommendation, metric, department, or outside industry assumption. Return exactly one JSON object matching the supplied schema.`;

const KPI_ORDINAL_REFERENCE_PATTERN = /\bKPI\s+(\d+)\b/g;

function materializeStatement(statement: string, analysisPackage: ExecutiveKpiAnalysisPackage) {
  const metricNames = new Map(analysisPackage.facts.metrics.map((metric) => [metric.ordinal, metric.name]));
  return statement.replace(KPI_ORDINAL_REFERENCE_PATTERN, (reference, rawOrdinal: string) => (
    metricNames.get(Number(rawOrdinal)) || reference
  ));
}

export function materializeExecutiveKpiNames(
  output: ExecutiveKpiAnalysisModelOutput,
  analysisPackage: ExecutiveKpiAnalysisPackage
): ExecutiveKpiAnalysisModelOutput {
  const materialize = (statement: string) => materializeStatement(statement, analysisPackage);
  return {
    executive_summary: materialize(output.executive_summary),
    significant_trends: output.significant_trends.map((item) => ({
      ...item,
      statement: materialize(item.statement)
    })),
    potential_kpi_relationships: output.potential_kpi_relationships.map((item) => ({
      ...item,
      statement: materialize(item.statement)
    })),
    possible_business_drivers: output.possible_business_drivers.map((item) => ({
      ...item,
      statement: materialize(item.statement)
    })),
    leadership_considerations: output.leadership_considerations.map(materialize),
    analysis_limitations: output.analysis_limitations.map(materialize)
  };
}

export function executiveKpiProviderAttemptTelemetry(attempt: AIProviderAttempt) {
  return {
    provider: attempt.provider,
    requested_model: attempt.model,
    runtime_model: attempt.runtimeModel,
    attempt_ordinal: attempt.attemptOrdinal,
    role: attempt.role,
    fallback: attempt.fallback,
    success: attempt.success,
    latency_ms: attempt.latencyMs,
    input_tokens: attempt.inputTokens,
    output_tokens: attempt.outputTokens,
    reasoning_tokens: attempt.reasoningTokens,
    estimated_cost_cents: attempt.estimatedCostCents,
    finish_reason: attempt.finishReason,
    failure_type: attempt.failureType,
    fallback_reason: attempt.fallbackReason,
    validation_stage: attempt.validationDiagnostic?.stage || null,
    validation_reason_code: attempt.validationDiagnostic?.reasonCode || null,
    truncation_detected: attempt.truncationDetected
  };
}

export function executiveKpiModelInput(analysisPackage: ExecutiveKpiAnalysisPackage) {
  return {
    contract: analysisPackage.contractId,
    period: {
      label: analysisPackage.facts.timeframe,
      start: analysisPackage.facts.startDate,
      end: analysisPackage.facts.endDate,
      comparison_mode: analysisPackage.facts.mode
    },
    confidence: {
      label: analysisPackage.facts.confidenceLabel,
      ceiling: analysisPackage.facts.confidenceScore
    },
    metrics: analysisPackage.facts.metrics.map((metric) => ({
      ordinal: metric.ordinal,
      name: metric.name,
      directionality: metric.directionality,
      trend_direction: metric.trendDirection,
      percentage_change: metric.percentageChange,
      observation_count: metric.observationCount,
      freshness: metric.freshness,
      latest_observed_at: metric.latestObservedAt,
      values: metric.values
    })),
    relationship_boundaries: analysisPackage.facts.relationships,
    limitations: analysisPackage.facts.limitations,
    source_lineage: analysisPackage.citations.map((citation) => ({
      source: citation.sourceLabel,
      source_type: citation.sourceType,
      metric_ordinals: citation.metricOrdinals,
      recorded_at: citation.recordedAt
    })),
    application_owned_controls: {
      provider_must_not_generate_citations: true,
      values_and_relationship_status_are_immutable: true,
      no_freeform_follow_up: true,
      causation_authorized: false
    }
  };
}

export async function generateExecutiveKpiAnalysis({
  supabase,
  workspaceId,
  analysisPackage,
  startedAtMs = Date.now()
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  analysisPackage: ExecutiveKpiAnalysisPackage;
  startedAtMs?: number;
}) {
  const generationPolicy = resolveExecutiveKpiAnalysisGenerationPolicy({
    startedAtMs,
    structuredOutput: {
      name: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
      strict: true,
      schema: EXECUTIVE_KPI_ANALYSIS_JSON_SCHEMA
    }
  });
  const policy = generationPolicy.providerPolicy;
  const primary = policy.steps[0];
  const content = JSON.stringify(executiveKpiModelInput(analysisPackage));
  const estimatedRequestTokens = estimateTokenCount(`${EXECUTIVE_KPI_ANALYSIS_SYSTEM_PROMPT}\n${content}`);
  await assertWorkspaceTokenBudget({ supabase, workspaceId, estimatedRequestTokens });
  const settings = getAIProviderRetrySettings(primary.provider);
  const generation = await runStructuredAI({
    primaryProvider: primary.provider,
    primaryModel: primary.model,
    fallbackModel: BUSINESS_HEALTH_GPT56_TERRA_MODEL,
    providerPolicy: policy,
    systemPrompt: EXECUTIVE_KPI_ANALYSIS_SYSTEM_PROMPT,
    userContent: [{ type: "text", text: content }],
    generationMode: "interactive_executive",
    maxOutputTokens: generationPolicy.requestMaxOutputTokens,
    settings: { ...settings, timeoutMs: Math.min(settings.timeoutMs, generationPolicy.requestTimeoutMs), maxRetries: 0 },
    executionBudget: generationPolicy.executionBudget,
    validate: (value) => validateExecutiveKpiAnalysisOutput(value, analysisPackage),
    logContext: {
      workflow: analysisPackage.contractId,
      modelRoute: "executive_kpi_analysis",
      executionPath: "fixed_kpi_comparison_synthesis",
      providerPolicyId: policy.id
    }
  });
  const materializedAnalysis = materializeExecutiveKpiNames(generation.output, analysisPackage);
  const artifact: ExecutiveKpiAnalysisArtifact = {
    contractId: analysisPackage.contractId,
    contractVersion: analysisPackage.contractVersion,
    validatorVersion: analysisPackage.validatorVersion,
    fingerprint: analysisPackage.fingerprint,
    generatedAt: new Date().toISOString(),
    analysis: materializedAnalysis,
    facts: analysisPackage.facts,
    citations: analysisPackage.citations,
    providerAttribution: {
      provider: generation.provider,
      model: generation.model,
      fallbackUsed: generation.fallbackUsed,
      providerPolicyId: generation.providerPolicyId
    }
  };
  const usage: VaeroexTokenUsage = {
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    totalTokens: generation.totalTokens,
    model: generation.model,
    requestId: generation.requestId,
    latencyMs: generation.latencyMs,
    status: "completed",
    metadata: {
      workflow: analysisPackage.contractId,
      contract_version: analysisPackage.contractVersion,
      validator_version: analysisPackage.validatorVersion,
      fingerprint: analysisPackage.fingerprint,
      provider: generation.provider,
      provider_policy_id: generation.providerPolicyId,
      fallback_used: generation.fallbackUsed,
      accepted_attempt_ordinal: generation.acceptedAttemptOrdinal,
      final_accepted_model: generation.model,
      reasoning_tokens: generation.reasoningTokens,
      estimated_cost_cents: generation.estimatedCostCents,
      provider_attempts: generation.attempts.map(executiveKpiProviderAttemptTelemetry),
      estimated_request_tokens: estimatedRequestTokens,
      metric_count: analysisPackage.facts.metrics.length,
      source_count: analysisPackage.citations.length
    } satisfies Json
  };
  return { artifact, usage };
}
