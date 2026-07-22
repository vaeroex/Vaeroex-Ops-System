"use server";

import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import {
  EXECUTIVE_BRIEF_CONTRACT_ID,
  type ExecutiveBriefState
} from "@/lib/ai/executive-brief/contracts";
import {
  executiveBriefProviderAttemptTelemetry,
  generateExecutiveBrief
} from "@/lib/ai/executive-brief/service";
import {
  executiveBriefArtifactForView,
  findCurrentExecutiveBriefArtifact,
  loadExecutiveBriefState,
  resolveExecutiveBriefReleaseChannel
} from "@/lib/ai/executive-brief/storage";
import { openExecutiveBriefPackage } from "@/lib/ai/executive-brief/token";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import { isExecutiveBriefPreviewEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

const SAFE_FAILURE_MESSAGE = "Executive facts are available, but the brief could not be prepared. Please try again.";

function logExecutiveBriefCacheEvent({
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
    component: "executive-brief",
    event,
    contractId: EXECUTIVE_BRIEF_CONTRACT_ID,
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
    model: lastAttempt?.runtimeModel || lastAttempt?.model || "executive-brief-provider-unavailable",
    latencyMs,
    status: "failed" as const,
    metadata: {
      workflow: EXECUTIVE_BRIEF_CONTRACT_ID,
      provider_attempts: attempts.map(executiveBriefProviderAttemptTelemetry),
      fallback_used: attempts.some((attempt) => attempt.fallback),
      reasoning_tokens: totals.reasoningTokens,
      estimated_cost_cents: totals.estimatedCostCents,
      timeout: attempts.some((attempt) => attempt.fallbackReason === "timeout"),
      failure_stage: "provider_execution"
    } satisfies Json
  };
}

export async function generateExecutiveBriefAction(requestToken: string): Promise<ExecutiveBriefState> {
  const startedAt = Date.now();
  if (!isExecutiveBriefPreviewEnabled()) {
    return { status: "unavailable", artifact: null, message: "Executive Brief synthesis is not enabled in this environment." };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "unavailable", artifact: null, message: "Executive Brief is temporarily unavailable." };
  }
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "unavailable", artifact: null, message: "Sign in again to view the Executive Brief." };
  }
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return { status: "unavailable", artifact: null, message: "Workspace access is required." };
  }
  const workspaceId = context.activeWorkspace.id;
  const releaseChannel = resolveExecutiveBriefReleaseChannel();
  const opened = openExecutiveBriefPackage(requestToken, { workspaceId, userId: user.id });
  if (!opened.ok) {
    return {
      status: "unavailable",
      artifact: null,
      message: opened.reason === "expired"
        ? "This Executive Overview is no longer current. Refresh the page and try again."
        : "Executive Brief could not be authorized. Refresh the page and try again."
    };
  }
  const analysisPackage = opened.analysisPackage;
  if (!analysisPackage.facts.available) {
    return {
      status: "insufficient_evidence",
      artifact: null,
      message: "More eligible original evidence is needed before Vaeroex can prepare an Executive Brief safely."
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

  const cached = await findCurrentExecutiveBriefArtifact({
    supabase,
    workspaceId,
    fingerprint: analysisPackage.fingerprint,
    releaseChannel
  }).catch(() => null);
  if (cached) {
    logExecutiveBriefCacheEvent({
      event: "cache_hit",
      fingerprint: analysisPackage.fingerprint,
      contractVersion: analysisPackage.contractVersion,
      validatorVersion: analysisPackage.validatorVersion,
      freshness: analysisPackage.facts.freshness
    });
    return { status: "current", artifact: cached, message: null };
  }
  logExecutiveBriefCacheEvent({
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
    return { status: "unavailable", artifact: null, message: "Subscription access is required for Executive Brief synthesis." };
  }
  if (usageLimit.reached) {
    return { status: "unavailable", artifact: null, message: "This workspace has reached its monthly intelligence usage limit." };
  }

  const claim = await enforceRateLimit({
    action: "executive_brief.generate",
    limit: 1,
    windowSeconds: 60,
    workspaceId,
    identifiers: [analysisPackage.fingerprint],
    requestHeaders: new Headers({ "x-real-ip": "executive-brief-analysis" }),
    metadata: {
      workflow: EXECUTIVE_BRIEF_CONTRACT_ID,
      contract_version: analysisPackage.contractVersion
    },
    strict: true
  }).catch(() => null);
  if (!claim?.allowed) {
    const completed = await findCurrentExecutiveBriefArtifact({
      supabase,
      workspaceId,
      fingerprint: analysisPackage.fingerprint,
      releaseChannel
    }).catch(() => null);
    return completed
      ? { status: "current", artifact: completed, message: null }
      : { status: "unavailable", artifact: null, message: "This brief is already being prepared. Refresh shortly to view it." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { status: "unavailable", artifact: null, message: "Executive Brief storage is temporarily unavailable." };
  }
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: EXECUTIVE_BRIEF_CONTRACT_ID });
  } catch {
    return { status: "unavailable", artifact: null, message: "Executive Brief request limits could not be verified. Please try again shortly." };
  }
  const inputJson = {
    workflow: EXECUTIVE_BRIEF_CONTRACT_ID,
    contract_id: analysisPackage.contractId,
    contract_version: analysisPackage.contractVersion,
    validator_version: analysisPackage.validatorVersion,
    fingerprint: analysisPackage.fingerprint,
    evidence_manifest_version: analysisPackage.manifest.version,
    submode: analysisPackage.submode,
    evidence_count: analysisPackage.requiredCitationIds.length,
    signal_count: analysisPackage.signals.length,
    independent_source_count: analysisPackage.facts.independentSourceCount,
    release_channel: releaseChannel,
    evidence_classification: "derived_analysis",
    original_evidence_eligible: false
  } satisfies Json;
  const { data: run, error: insertError } = await admin
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: EXECUTIVE_BRIEF_CONTRACT_ID,
      input_json: inputJson,
      output_json: {},
      status: "processing",
      created_by: user.id
    })
    .select("id")
    .maybeSingle();
  if (insertError || !run) return { status: "failed", artifact: null, message: SAFE_FAILURE_MESSAGE };

  try {
    const generated = await generateExecutiveBrief({
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
    if (updateError) throw new Error("Executive Brief could not be saved.");
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: EXECUTIVE_BRIEF_CONTRACT_ID,
      usage: generated.usage
    });
    return { status: "current", artifact: executiveBriefArtifactForView(generated.artifact), message: null };
  } catch (error) {
    await admin
      .from("ai_agent_runs")
      .update({
        status: "failed",
        error_message: "Executive Brief generation failed.",
        updated_at: new Date().toISOString()
      })
      .eq("workspace_id", workspaceId)
      .eq("id", run.id);
    await recordVaeroexAiUsage({
      supabase: admin,
      workspaceId,
      userId: user.id,
      agentType: EXECUTIVE_BRIEF_CONTRACT_ID,
      usage: failedUsage(error, Date.now() - startedAt)
    });
    const preserved = await loadExecutiveBriefState({
      supabase,
      workspaceId,
      analysisPackage,
      requestTokenAvailable: true,
      releaseChannel
    }).catch(() => null);
    if (preserved?.status === "stale") {
      logExecutiveBriefCacheEvent({
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
