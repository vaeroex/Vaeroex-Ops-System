"use server";

import {
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
  type ExecutiveKpiAnalysisState
} from "@/lib/ai/executive-kpi-analysis/contracts";
import {
  executiveKpiProviderAttemptTelemetry,
  generateExecutiveKpiAnalysis
} from "@/lib/ai/executive-kpi-analysis/service";
import {
  executiveKpiAnalysisArtifactForView,
  findCurrentExecutiveKpiAnalysisArtifact
} from "@/lib/ai/executive-kpi-analysis/storage";
import { openExecutiveKpiAnalysisPackage } from "@/lib/ai/executive-kpi-analysis/token";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import {
  executiveKpiAnalysisReleaseChannel,
  isExecutiveKpiAnalysisEnabled
} from "@/lib/ai/providers/workflow-provider-policy";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

const SAFE_FAILURE_MESSAGE = "Executive analysis could not be prepared right now. The validated KPI facts remain available below.";

function failedUsage(error: unknown, latencyMs: number) {
  const attempts = error instanceof AIProviderExecutionError ? error.attempts : [];
  const totals = attempts.reduce((sum, attempt) => ({
    inputTokens: sum.inputTokens + attempt.inputTokens,
    outputTokens: sum.outputTokens + attempt.outputTokens,
    totalTokens: sum.totalTokens + attempt.totalTokens,
    reasoningTokens: sum.reasoningTokens + attempt.reasoningTokens,
    estimatedCostCents: sum.estimatedCostCents + attempt.estimatedCostCents
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0, estimatedCostCents: 0 });
  const lastAttempt = attempts.at(-1);
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    model: lastAttempt?.runtimeModel || lastAttempt?.model || "executive-kpi-analysis-provider-unavailable",
    latencyMs,
    status: "failed" as const,
    metadata: {
      workflow: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
      provider_attempts: attempts.map(executiveKpiProviderAttemptTelemetry),
      fallback_used: attempts.some((attempt) => attempt.fallback),
      reasoning_tokens: totals.reasoningTokens,
      estimated_cost_cents: totals.estimatedCostCents,
      timeout: attempts.some((attempt) => attempt.fallbackReason === "timeout"),
      failure_stage: "provider_execution"
    } satisfies Json
  };
}

export async function generateExecutiveKpiAnalysisAction(requestToken: string): Promise<ExecutiveKpiAnalysisState> {
  const startedAt = Date.now();
  if (!isExecutiveKpiAnalysisEnabled()) {
    return { status: "unavailable", artifact: null, message: "Executive KPI Analysis is not enabled in this environment." };
  }
  const releaseChannel = executiveKpiAnalysisReleaseChannel();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "unavailable", artifact: null, message: SAFE_FAILURE_MESSAGE };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "unavailable", artifact: null, message: "Sign in again to generate this analysis." };
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return { status: "unavailable", artifact: null, message: "Workspace access is required." };
  }
  const workspaceId = context.activeWorkspace.id;
  const opened = openExecutiveKpiAnalysisPackage(requestToken, { workspaceId, userId: user.id });
  if (!opened.ok) {
    return {
      status: "unavailable",
      artifact: null,
      message: opened.reason === "expired"
        ? "The selected KPI comparison has changed. Refresh the page and try again."
        : "This KPI comparison could not be authorized. Refresh the page and try again."
    };
  }
  const analysisPackage = opened.analysisPackage;
  const usableMetrics = analysisPackage.facts.metrics.filter((metric) => metric.observationCount >= 2);
  if (usableMetrics.length < 2) {
    return { status: "insufficient_evidence", artifact: null, message: "Select at least two KPIs with comparable history to generate an executive analysis." };
  }
  const cached = await findCurrentExecutiveKpiAnalysisArtifact({
    supabase,
    workspaceId,
    fingerprint: analysisPackage.fingerprint,
    releaseChannel
  }).catch(() => null);
  if (cached) return { status: "current", artifact: cached, message: null };

  const usageLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });
  if (!usageLimit.subscription.allowed) return { status: "unavailable", artifact: null, message: "Subscription access is required for Executive KPI Analysis." };
  if (usageLimit.reached) return { status: "unavailable", artifact: null, message: "This workspace has reached its monthly intelligence usage limit." };

  const claim = await enforceRateLimit({
    action: "executive_kpi_analysis.generate",
    limit: 1,
    windowSeconds: 60,
    workspaceId,
    identifiers: [analysisPackage.fingerprint],
    requestHeaders: new Headers({ "x-real-ip": "executive-kpi-analysis" }),
    metadata: { workflow: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID, contract_version: analysisPackage.contractVersion },
    strict: true
  }).catch(() => null);
  if (!claim?.allowed) {
    const completed = await findCurrentExecutiveKpiAnalysisArtifact({
      supabase,
      workspaceId,
      fingerprint: analysisPackage.fingerprint,
      releaseChannel
    }).catch(() => null);
    return completed
      ? { status: "current", artifact: completed, message: null }
      : { status: "unavailable", artifact: null, message: "This comparison is already being analyzed. Try again shortly." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { status: "unavailable", artifact: null, message: SAFE_FAILURE_MESSAGE };
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID });
  } catch {
    return { status: "unavailable", artifact: null, message: "Analysis request limits could not be verified. Try again shortly." };
  }
  const { data: run, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
      input_json: {
        workflow: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
        contract_version: analysisPackage.contractVersion,
        validator_version: analysisPackage.validatorVersion,
        fingerprint: analysisPackage.fingerprint,
        release_channel: releaseChannel,
        metric_count: analysisPackage.facts.metrics.length,
        source_count: analysisPackage.citations.length,
        evidence_classification: "derived_analysis",
        original_evidence_eligible: false
      } satisfies Json,
      output_json: {},
      status: "processing",
      created_by: user.id
    })
    .select("id")
    .maybeSingle();
  if (insertError || !run) return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };

  try {
    const generated = await generateExecutiveKpiAnalysis({ supabase, workspaceId, analysisPackage, startedAtMs: startedAt });
    const { error: updateError } = await admin
      .from("ai_agent_runs")
      .update({
        output_json: generated.artifact as unknown as Json,
        status: "completed",
        error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", workspaceId)
      .eq("id", run.id);
    if (updateError) throw new Error("Executive KPI Analysis could not be saved.");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
      usage: generated.usage
    });
    return { status: "current", artifact: executiveKpiAnalysisArtifactForView(generated.artifact), message: null };
  } catch (error) {
    await admin.from("ai_agent_runs").update({
      status: "failed",
      error_message: "Executive KPI Analysis generation failed.",
      updated_at: new Date().toISOString()
    }).eq("workspace_id", workspaceId).eq("id", run.id);
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
      usage: failedUsage(error, Date.now() - startedAt)
    });
    return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };
  }
}
