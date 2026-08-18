"use server";

import { revalidatePath } from "next/cache";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  isIntelligenceBriefingType,
  type IntelligenceBriefingState,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { claimIntelligenceBriefingGeneration } from "@/lib/ai/intelligence-briefing/generation-claim";
import { generateIntelligenceBriefing, intelligenceBriefingProviderAttemptTelemetry } from "@/lib/ai/intelligence-briefing/service";
import {
  briefingStateFromPackage,
  loadCurrentIntelligenceBriefing
} from "@/lib/ai/intelligence-briefing/storage";
import {
  intelligenceBriefingStateAllowsGeneration,
  intelligenceBriefingVerificationUnavailableState
} from "@/lib/ai/intelligence-briefing/state";
import { buildWorkspaceIntelligenceBriefingPackage } from "@/lib/ai/intelligence-briefing/workspace-context";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import { isIntelligenceBriefingEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

const SAFE_FAILURE_MESSAGE = "The latest eligible evidence remains available, but this briefing could not be prepared. Please try again.";

function unavailable(briefingType: IntelligenceBriefingType, message: string): IntelligenceBriefingState {
  return intelligenceBriefingVerificationUnavailableState({ briefingType, message });
}

function failedUsage(error: unknown, latencyMs: number, briefingType: IntelligenceBriefingType) {
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
    model: lastAttempt?.runtimeModel || lastAttempt?.model || "intelligence-briefing-provider-unavailable",
    latencyMs,
    status: "failed" as const,
    metadata: {
      workflow: INTELLIGENCE_BRIEFING_CONTRACT_ID,
      briefing_type: briefingType,
      provider_attempts: attempts.map(intelligenceBriefingProviderAttemptTelemetry),
      fallback_used: attempts.some((attempt) => attempt.fallback),
      reasoning_tokens: totals.reasoningTokens,
      estimated_cost_cents: totals.estimatedCostCents,
      failure_stage: "provider_execution"
    } satisfies Json
  };
}

export async function generateIntelligenceBriefingAction(input: {
  briefingType: IntelligenceBriefingType;
}): Promise<IntelligenceBriefingState> {
  const briefingType = input?.briefingType;
  if (!isIntelligenceBriefingType(briefingType)) return unavailable("weekly", "The briefing type is invalid.");
  const startedAt = Date.now();
  const supabase = await createSupabaseServerClient();
  if (!supabase) return unavailable(briefingType, "Intelligence Briefings are temporarily unavailable.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unavailable(briefingType, "Sign in again to generate an Intelligence Briefing.");
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return unavailable(briefingType, "Active workspace access is required.");
  }
  const workspaceId = context.activeWorkspace.id;
  const current = await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType }).catch(() => null);
  let briefingPackage;
  try {
    ({ briefingPackage } = await buildWorkspaceIntelligenceBriefingPackage({
      supabase,
      workspaceId,
      workspace: context.activeWorkspace,
      briefingType,
      previousBriefing: current ? {
        runId: current.runId,
        generatedAt: current.artifact.generatedAt,
        materialStateFingerprint: current.artifact.materialStateFingerprint
      } : null
    }));
  } catch {
    return { ...unavailable(briefingType, "Eligible evidence could not be verified safely."), artifact: current?.artifact || null };
  }
  const state = briefingStateFromPackage({ briefingPackage, current });
  if (!intelligenceBriefingStateAllowsGeneration(state)) return state;
  if (!isIntelligenceBriefingEnabled()) {
    return { ...state, status: "unavailable", message: "Intelligence Briefing generation is not enabled for this environment." };
  }
  const usageLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });
  if (!usageLimit.subscription.allowed) return { ...state, status: "unavailable", message: "Subscription access is required." };
  if (usageLimit.reached) return { ...state, status: "unavailable", message: "This workspace has reached its monthly intelligence usage limit." };
  const throttle = await enforceRateLimit({
    action: "intelligence_briefing.generate",
    limit: 1,
    windowSeconds: 45,
    workspaceId,
    identifiers: [briefingType, briefingPackage.generationKey],
    requestHeaders: new Headers({ "x-real-ip": "intelligence-briefing" }),
    metadata: { workflow: INTELLIGENCE_BRIEFING_CONTRACT_ID, briefing_type: briefingType },
    strict: true
  }).catch(() => null);
  if (!throttle?.allowed) {
    const completed = await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType }).catch(() => null);
    return completed?.artifact.generationKey === briefingPackage.generationKey
      ? { ...state, status: "current", artifact: completed.artifact, message: null }
      : { ...state, status: "generating", message: "This briefing is already being prepared. Refresh shortly to view it." };
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return { ...state, status: "unavailable", message: "Briefing storage is temporarily unavailable." };
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: INTELLIGENCE_BRIEFING_CONTRACT_ID });
  } catch {
    return { ...state, status: "unavailable", message: "Intelligence request limits could not be verified. Please try again shortly." };
  }
  const inputJson = {
    workflow: INTELLIGENCE_BRIEFING_CONTRACT_ID,
    briefing_type: briefingType,
    generation_key: briefingPackage.generationKey,
    material_state_fingerprint: briefingPackage.materialStateFingerprint,
    effective_evidence_fingerprint: briefingPackage.effectiveEvidenceFingerprint,
    evidence_fingerprint: briefingPackage.evidenceFingerprint,
    period_start: briefingPackage.period.start,
    period_end: briefingPackage.period.end,
    period_cutoff: briefingPackage.period.cutoff,
    schema_version: briefingPackage.schemaVersion,
    validator_version: briefingPackage.validatorVersion,
    prompt_version: briefingPackage.promptVersion,
    generation_policy_version: briefingPackage.generationPolicyVersion,
    evidence_classification: "derived_analysis",
    original_evidence_eligible: false
  } satisfies Json;
  const claim = await claimIntelligenceBriefingGeneration({
    admin,
    workspaceId,
    userId: user.id,
    briefingType,
    generationKey: briefingPackage.generationKey,
    inputJson
  }).catch(() => ({ status: "failed_closed" as const }));
  if (claim.status === "completed") return { ...state, status: "current", artifact: claim.current.artifact, message: null };
  if (claim.status === "processing") return { ...state, status: "generating", message: "This briefing is already being prepared. Refresh shortly to view it." };
  if (claim.status === "hidden_completed") return { ...state, status: "unavailable", message: "This exact briefing is retained as hidden historical data and cannot be regenerated." };
  if (claim.status !== "claimed") return { ...state, status: "failed", message: SAFE_FAILURE_MESSAGE };
  try {
    const generated = await generateIntelligenceBriefing({ supabase, workspaceId, briefingPackage, startedAtMs: startedAt });
    const { data: updated, error: updateError } = await admin
      .from("ai_agent_runs")
      .update({
        output_json: generated.artifact as unknown as Json,
        status: "completed",
        error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", workspaceId)
      .eq("id", claim.runId)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new Error("The completed briefing could not be persisted atomically.");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: INTELLIGENCE_BRIEFING_CONTRACT_ID,
      usage: generated.usage
    });
    revalidatePath("/app/intelligence/briefings");
    revalidatePath(`/app/intelligence/briefings/${briefingType}`);
    return { ...state, status: "current", artifact: generated.artifact, message: null };
  } catch (error) {
    await admin.from("ai_agent_runs").update({
      status: "failed",
      error_message: "Intelligence Briefing generation failed.",
      updated_at: new Date().toISOString()
    }).eq("workspace_id", workspaceId).eq("id", claim.runId).eq("status", "processing");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: INTELLIGENCE_BRIEFING_CONTRACT_ID,
      usage: failedUsage(error, Date.now() - startedAt, briefingType)
    });
    return { ...state, status: "failed", artifact: current?.artifact || null, message: SAFE_FAILURE_MESSAGE };
  }
}
