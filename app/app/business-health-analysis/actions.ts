"use server";

import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import {
  BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
  type BusinessHealthAnalysisState
} from "@/lib/ai/business-health-explanation/contracts";
import {
  businessHealthProviderAttemptTelemetry,
  generateBusinessHealthExplanation
} from "@/lib/ai/business-health-explanation/service";
import {
  businessHealthArtifactForView,
  findCurrentBusinessHealthExplanationArtifact,
  loadBusinessHealthAnalysisState
} from "@/lib/ai/business-health-explanation/storage";
import { openBusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/token";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

const SAFE_FAILURE_MESSAGE = "Business Health facts are available, but the analysis could not be prepared. Please try again.";

function logBusinessHealthCacheEvent({
  event,
  fingerprint,
  contractVersion,
  validatorVersion,
  freshness
}: {
  event: "cache_hit" | "cache_miss" | "last_valid_preserved";
  fingerprint: string;
  contractVersion: string;
  validatorVersion: string;
  freshness: string;
}) {
  console.log(JSON.stringify({
    level: "info",
    component: "business-health-explanation",
    event,
    contractId: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
    contractVersion,
    validatorVersion,
    fingerprint,
    freshness
  }));
}

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
    model: lastAttempt?.runtimeModel || lastAttempt?.model || "business-health-provider-unavailable",
    latencyMs,
    status: "failed" as const,
    metadata: {
      workflow: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      provider_attempts: attempts.map(businessHealthProviderAttemptTelemetry),
      fallback_used: attempts.some((attempt) => attempt.fallback),
      reasoning_tokens: totals.reasoningTokens,
      estimated_cost_cents: totals.estimatedCostCents,
      timeout: attempts.some((attempt) => attempt.fallbackReason === "timeout"),
      failure_stage: "provider_execution"
    } satisfies Json
  };
}

export async function generateBusinessHealthExplanationAction(
  requestToken: string
): Promise<BusinessHealthAnalysisState> {
  const startedAt = Date.now();
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "unavailable", artifact: null, message: "Business Health analysis is temporarily unavailable." };
  }
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "unavailable", artifact: null, message: "Sign in again to view Business Health analysis." };
  }
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return { status: "unavailable", artifact: null, message: "Workspace access is required." };
  }
  const workspaceId = context.activeWorkspace.id;
  const opened = openBusinessHealthExplanationPackage(requestToken, { workspaceId, userId: user.id });
  if (!opened.ok) {
    return {
      status: "unavailable",
      artifact: null,
      message: opened.reason === "expired"
        ? "This Business Health view is no longer current. Refresh the page and try again."
        : "Business Health analysis could not be authorized. Refresh the page and try again."
    };
  }
  const analysisPackage = opened.analysisPackage;
  if (!analysisPackage.facts.available) {
    return {
      status: "insufficient_evidence",
      artifact: null,
      message: "More eligible original evidence is needed before Vaeroex can synthesize this score safely."
    };
  }
  const citationVerification = verifyEvidenceManifestCitations({
    manifest: analysisPackage.manifest,
    citationIds: analysisPackage.requiredCitationIds,
    requiredCitationIds: analysisPackage.requiredCitationIds
  });
  if (!citationVerification.valid || analysisPackage.manifest.workspaceId !== workspaceId) {
    return { status: "unavailable", artifact: null, message: "Supporting evidence could not be verified safely." };
  }

  const cached = await findCurrentBusinessHealthExplanationArtifact({
    supabase,
    workspaceId,
    fingerprint: analysisPackage.fingerprint
  }).catch(() => null);
  if (cached) {
    logBusinessHealthCacheEvent({
      event: "cache_hit",
      fingerprint: analysisPackage.fingerprint,
      contractVersion: analysisPackage.contractVersion,
      validatorVersion: analysisPackage.validatorVersion,
      freshness: analysisPackage.facts.freshness
    });
    return { status: "current", artifact: cached, message: null };
  }
  logBusinessHealthCacheEvent({
    event: "cache_miss",
    fingerprint: analysisPackage.fingerprint,
    contractVersion: analysisPackage.contractVersion,
    validatorVersion: analysisPackage.validatorVersion,
    freshness: analysisPackage.facts.freshness
  });

  const usageLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });
  if (!usageLimit.subscription.allowed) {
    return { status: "unavailable", artifact: null, message: "Subscription access is required for Business Health analysis." };
  }
  if (usageLimit.reached) {
    return { status: "unavailable", artifact: null, message: "This workspace has reached its monthly intelligence usage limit." };
  }

  // Durable atomic deduplication belongs to the future background-generation path; this Preview flow retains fingerprint rate limiting.
  const claim = await enforceRateLimit({
    action: "business_health_explanation.generate",
    limit: 1,
    windowSeconds: 60,
    workspaceId,
    identifiers: [analysisPackage.fingerprint],
    requestHeaders: new Headers({ "x-real-ip": "business-health-analysis" }),
    metadata: {
      workflow: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      contract_version: analysisPackage.contractVersion
    },
    strict: true
  }).catch(() => null);
  if (!claim?.allowed) {
    const completed = await findCurrentBusinessHealthExplanationArtifact({
      supabase,
      workspaceId,
      fingerprint: analysisPackage.fingerprint
    }).catch(() => null);
    return completed
      ? { status: "current", artifact: completed, message: null }
      : { status: "unavailable", artifact: null, message: "This analysis is already being prepared. Refresh shortly to view it." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { status: "unavailable", artifact: null, message: "Business Health analysis storage is temporarily unavailable." };
  }
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID });
  } catch {
    return { status: "unavailable", artifact: null, message: "Business Health analysis request limits could not be verified. Please try again shortly." };
  }
  const inputJson = {
    workflow: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
    contract_id: analysisPackage.contractId,
    contract_version: analysisPackage.contractVersion,
    validator_version: analysisPackage.validatorVersion,
    fingerprint: analysisPackage.fingerprint,
    evidence_manifest_version: analysisPackage.manifest.version,
    submode: analysisPackage.submode,
    evidence_count: analysisPackage.requiredCitationIds.length,
    driver_count: analysisPackage.facts.drivers.length,
    evidence_classification: "derived_analysis",
    original_evidence_eligible: false
  } satisfies Json;
  const { data: run, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      input_json: inputJson,
      output_json: {},
      status: "processing",
      created_by: user.id
    })
    .select("id")
    .maybeSingle();
  if (insertError || !run) {
    return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };
  }

  try {
    const generated = await generateBusinessHealthExplanation({
      supabase,
      workspaceId,
      analysisPackage,
      startedAtMs: startedAt
    });
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
    if (updateError) throw new Error("Business Health analysis could not be saved.");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      usage: generated.usage
    });
    return { status: "current", artifact: businessHealthArtifactForView(generated.artifact), message: null };
  } catch (error) {
    await admin
      .from("ai_agent_runs")
      .update({
        status: "failed",
        error_message: "Business Health analysis generation failed.",
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", workspaceId)
      .eq("id", run.id);
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID,
      usage: failedUsage(error, Date.now() - startedAt)
    });
    const preserved = await loadBusinessHealthAnalysisState({
      supabase,
      workspaceId,
      analysisPackage,
      requestTokenAvailable: true
    }).catch(() => null);
    if (preserved?.status === "stale") {
      logBusinessHealthCacheEvent({
        event: "last_valid_preserved",
        fingerprint: analysisPackage.fingerprint,
        contractVersion: analysisPackage.contractVersion,
        validatorVersion: analysisPackage.validatorVersion,
        freshness: analysisPackage.facts.freshness
      });
      return preserved;
    }
    return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };
  }
}
