"use server";

import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import {
  FINDING_EXPLANATION_CONTRACT_ID,
  type FindingExplanationState
} from "@/lib/ai/finding-explanation/contracts";
import {
  findingExplanationProviderAttemptTelemetry,
  generateFindingExplanation
} from "@/lib/ai/finding-explanation/service";
import {
  findCurrentFindingExplanationArtifact,
  findingExplanationArtifactForView
} from "@/lib/ai/finding-explanation/storage";
import { openFindingExplanationPackage } from "@/lib/ai/finding-explanation/token";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import { isFindingExplanationPreviewEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

const SAFE_FAILURE_MESSAGE = "This finding could not be explained right now. The finding and its supporting evidence remain available.";

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
    model: lastAttempt?.runtimeModel || lastAttempt?.model || "finding-explanation-provider-unavailable",
    latencyMs,
    status: "failed" as const,
    metadata: {
      workflow: FINDING_EXPLANATION_CONTRACT_ID,
      provider_attempts: attempts.map(findingExplanationProviderAttemptTelemetry),
      fallback_used: attempts.some((attempt) => attempt.fallback),
      reasoning_tokens: totals.reasoningTokens,
      estimated_cost_cents: totals.estimatedCostCents,
      timeout: attempts.some((attempt) => attempt.fallbackReason === "timeout"),
      failure_stage: "provider_execution"
    } satisfies Json
  };
}
export async function explainFindingAction(requestToken: string): Promise<FindingExplanationState> {
  const startedAt = Date.now();
  if (!isFindingExplanationPreviewEnabled()) {
    return { status: "unavailable", artifact: null, message: "Finding explanations are not enabled in this environment." };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "unavailable", artifact: null, message: SAFE_FAILURE_MESSAGE };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "unavailable", artifact: null, message: "Sign in again to explain this finding." };
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return { status: "unavailable", artifact: null, message: "Workspace access is required." };
  }
  const workspaceId = context.activeWorkspace.id;
  const opened = openFindingExplanationPackage(requestToken, { workspaceId, userId: user.id });
  if (!opened.ok) {
    return {
      status: "unavailable",
      artifact: null,
      message: opened.reason === "expired"
        ? "This finding has changed. Refresh the page and try again."
        : "This finding could not be authorized. Refresh the page and try again."
    };
  }
  const analysisPackage = opened.analysisPackage;
  if (!analysisPackage.requiredCitationIds.length) {
    return { status: "insufficient_evidence", artifact: null, message: "More eligible original evidence is needed to explain this finding safely." };
  }
  const citationVerification = verifyEvidenceManifestCitations({
    manifest: analysisPackage.manifest,
    citationIds: analysisPackage.requiredCitationIds,
    requiredCitationIds: analysisPackage.requiredCitationIds
  });
  if (!citationVerification.valid || analysisPackage.manifest.workspaceId !== workspaceId) {
    return { status: "unavailable", artifact: null, message: "Supporting evidence could not be verified safely." };
  }

  const cached = await findCurrentFindingExplanationArtifact({ supabase, workspaceId, fingerprint: analysisPackage.fingerprint }).catch(() => null);
  if (cached) return { status: "current", artifact: cached, message: null };

  const usageLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });
  if (!usageLimit.subscription.allowed) return { status: "unavailable", artifact: null, message: "Subscription access is required for finding explanations." };
  if (usageLimit.reached) return { status: "unavailable", artifact: null, message: "This workspace has reached its monthly intelligence usage limit." };

  const claim = await enforceRateLimit({
    action: "finding_explanation.generate",
    limit: 1,
    windowSeconds: 60,
    workspaceId,
    identifiers: [analysisPackage.fingerprint],
    requestHeaders: new Headers({ "x-real-ip": "finding-explanation" }),
    metadata: { workflow: FINDING_EXPLANATION_CONTRACT_ID, contract_version: analysisPackage.contractVersion },
    strict: true
  }).catch(() => null);
  if (!claim?.allowed) {
    const completed = await findCurrentFindingExplanationArtifact({ supabase, workspaceId, fingerprint: analysisPackage.fingerprint }).catch(() => null);
    return completed
      ? { status: "current", artifact: completed, message: null }
      : { status: "unavailable", artifact: null, message: "This finding is already being explained. Try again shortly." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { status: "unavailable", artifact: null, message: SAFE_FAILURE_MESSAGE };
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: FINDING_EXPLANATION_CONTRACT_ID });
  } catch {
    return { status: "unavailable", artifact: null, message: "Finding explanation request limits could not be verified. Try again shortly." };
  }
  const inputJson = {
    workflow: FINDING_EXPLANATION_CONTRACT_ID,
    contract_id: analysisPackage.contractId,
    contract_version: analysisPackage.contractVersion,
    validator_version: analysisPackage.validatorVersion,
    fingerprint: analysisPackage.fingerprint,
    evidence_manifest_version: analysisPackage.manifest.version,
    evidence_count: analysisPackage.requiredCitationIds.length,
    independent_source_count: analysisPackage.facts.independentSourceCount,
    evidence_classification: "derived_analysis",
    original_evidence_eligible: false
  } satisfies Json;
  const { data: run, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: FINDING_EXPLANATION_CONTRACT_ID,
      input_json: inputJson,
      output_json: {},
      status: "processing",
      created_by: user.id
    })
    .select("id")
    .maybeSingle();
  if (insertError || !run) return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };

  try {
    const generated = await generateFindingExplanation({ supabase, workspaceId, analysisPackage, startedAtMs: startedAt });
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
    if (updateError) throw new Error("Finding explanation could not be saved.");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: FINDING_EXPLANATION_CONTRACT_ID,
      usage: generated.usage
    });
    return { status: "current", artifact: findingExplanationArtifactForView(generated.artifact), message: null };
  } catch (error) {
    await admin.from("ai_agent_runs").update({
      status: "failed",
      error_message: "Finding explanation generation failed.",
      updated_at: new Date().toISOString()
    }).eq("workspace_id", workspaceId).eq("id", run.id);
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: FINDING_EXPLANATION_CONTRACT_ID,
      usage: failedUsage(error, Date.now() - startedAt)
    });
    return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };
  }
}
