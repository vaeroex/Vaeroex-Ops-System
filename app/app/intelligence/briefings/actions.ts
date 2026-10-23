"use server";
import { sealSharedGeneration, type SharedPrepared } from "@/lib/ai/shared-evidence/generation";
import { bindSharedBriefingCitationTarget } from "@/lib/ai/shared-evidence/briefing";

import { beginGoogleSheetsRead, bindGoogleSheetsRead, googleSheetsReadTicketFields } from "@/lib/integrations/google-sheets/read-authority";


import { revalidatePath } from "next/cache";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  isIntelligenceBriefingType,
  type IntelligenceBriefingState,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { verifiedBriefingSession, completeIntelligenceBriefingRun, failIntelligenceBriefingRun } from "@/lib/ai/intelligence-briefing/run-lifecycle";
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
  const sessionId = await verifiedBriefingSession(supabase, user.id);
  if (!sessionId) return unavailable(briefingType, "Sign in again to generate an Intelligence Briefing.");
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active"
    || context.membership.user_id !== user.id || context.membership.workspace_id !== context.activeWorkspace.id) {
    return unavailable(briefingType, "Active workspace access is required.");
  }
  const workspaceId = context.activeWorkspace.id;
  const readTicket = await beginGoogleSheetsRead(supabase, workspaceId, user.id).catch(() => null);
  if (!readTicket) return unavailable(briefingType, "Workspace data is being updated. Reload before requesting analysis.");
  const current = await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType }).catch(() => null);
  let briefingPackage;
  let sharedPrepared:SharedPrepared|undefined;
  try {
    ({ briefingPackage,sharedPrepared } = await buildWorkspaceIntelligenceBriefingPackage({
      readTicket,
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
    return unavailable(briefingType, "Eligible evidence could not be verified safely.");
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
    ...(sharedPrepared?{shared_evidence_contract:"shared_evidence_v1"}:{}),
    ...googleSheetsReadTicketFields(readTicket.ticketId),
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
    reader: supabase,
    admin,
    workspaceId,
    userId: user.id,
    sessionId,
    briefingType,
    generationKey: briefingPackage.generationKey,
    inputJson
  }).catch(() => ({ status: "failed_closed" as const }));
  if (claim.status === "completed") return { ...state, status: "current", artifact: claim.current.artifact, message: null };
  if (claim.status === "processing") return { ...state, status: "generating", message: "This briefing is already being prepared. Refresh shortly to view it." };
  if (claim.status === "hidden_completed") return { ...state, status: "unavailable", message: "This exact briefing is retained as hidden historical data and cannot be regenerated." };
  if (claim.status !== "claimed") return { ...state, status: "failed", message: SAFE_FAILURE_MESSAGE };
  const authority = { workspaceId, userId: user.id, sessionId, readTicketId: readTicket.ticketId };
  let sharedManifestId:string|undefined;
  let generated: Awaited<ReturnType<typeof generateIntelligenceBriefing>>;
  try {
    await bindGoogleSheetsRead(supabase, readTicket.ticketId, []);
    if(sharedPrepared) {
      sharedManifestId=await sealSharedGeneration(supabase,sharedPrepared,{kind:"briefing_run",id:claim.runId,attempt:1,ticketId:readTicket.ticketId});
      briefingPackage=bindSharedBriefingCitationTarget(briefingPackage,claim.runId);
    }
    generated = await generateIntelligenceBriefing({ sharedExecution: sharedPrepared&&sharedManifestId?{prepared:sharedPrepared,manifestId:sharedManifestId,runId:claim.runId}:undefined, supabase, workspaceId, briefingPackage, readTicketId: readTicket.ticketId, startedAtMs: startedAt });
  } catch (error) {
    const failed = await failIntelligenceBriefingRun(admin, authority, claim.runId);
    await recordVaeroexAiUsage({ supabase: admin, workspaceId, userId: user.id,
      agentType: INTELLIGENCE_BRIEFING_CONTRACT_ID, usage: failedUsage(error, Date.now() - startedAt, briefingType)
    }).catch(() => { console.warn("[intelligence-briefing-usage]", { status: "unconfirmed" }); });
    return { ...state, status: failed ? "failed" : "unavailable", artifact: null,
      message: failed ? SAFE_FAILURE_MESSAGE : "Briefing status could not be confirmed. Reload this page to check its status." };
  }
  const completion = await completeIntelligenceBriefingRun({ admin, reader: supabase, authority, runId: claim.runId, artifact: generated.artifact, sharedManifestId });
  // Provider spending is known even when artifact persistence fails. Do not turn
  // a storage error into a zero-usage provider failure or regenerate the answer.
  const usage = completion.status === "completed" ? generated.usage : {
    ...generated.usage, status: "failed" as const,
    metadata: { ...(generated.usage.metadata && typeof generated.usage.metadata === "object" && !Array.isArray(generated.usage.metadata) ? generated.usage.metadata : {}),
      failure_stage: "artifact_persistence", persistence_status: completion.status }
  };
  await recordVaeroexAiUsage({ supabase: admin, workspaceId, userId: user.id, agentType: INTELLIGENCE_BRIEFING_CONTRACT_ID, usage
  }).catch(() => { console.warn("[intelligence-briefing-usage]", { status: "unconfirmed" }); });
  if (completion.status !== "completed") return { ...state, status: completion.status, artifact: null,
    message: completion.status === "failed" ? SAFE_FAILURE_MESSAGE : "Briefing status could not be confirmed. Reload this page to check its status." };
  revalidatePath("/app/intelligence/briefings");
  revalidatePath(`/app/intelligence/briefings/${briefingType}`);
  return { ...state, status: "current", artifact: completion.artifact, message: null };
}
