"use server";

import { buildWorkspaceEvidenceContext, evidenceContextAsJson, rebuildEvidenceContext } from "@/lib/ai/evidence-index";
import { buildDeterministicFocusedExplanation, buildFocusedExplanationContext } from "@/lib/ai/bounded-context";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { resolveVaeroexModel } from "@/lib/ai/model-routing";
import { planVaeroexQuery } from "@/lib/ai/query-depth-planner";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import {
  filterBusinessEvidence,
  sanitizeBusinessEvidenceText
} from "@/lib/intelligence/evidence-eligibility";
import { isPremiumConversationalVaeroexEnabled } from "@/lib/product/conversational-vaeroex";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { contextualSecurityIntentInput, isSecurityResponseMessage, isSecuritySensitiveRequest, securityResponseMessage } from "@/lib/security/security-response";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export type ContextualAskAnswer = {
  title: string;
  directExplanation: string;
  whyItMatters: string;
  evidence: string[];
  confidence: string;
  limitations: string;
  responseMarkdown?: string;
  copyText: string;
};

export type ContextualAskState = {
  status: "idle" | "success" | "error";
  answer?: ContextualAskAnswer;
  error?: string;
  runId?: string;
};

type JsonRecord = Record<string, unknown>;

const INITIAL_ANSWER_TITLE = "Vaeroex explanation";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : JSON.stringify(item))).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split("\n")
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  return [];
}

function parseEvidence(value: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return asStringArray(parsed);
  } catch {
    return asStringArray(value);
  }
}

function compactList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, 8);
}

async function requireWorkspaceForContextualAsk() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Sign in again to ask Vaeroex about this.");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    throw new Error("Choose a workspace before asking Vaeroex.");
  }

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspaceId: context.activeWorkspace.id
  };
}

function outputToAnswer(outputJson: Json, fallbackTitle: string, fallbackContext: string): ContextualAskAnswer {
  const output = isRecord(outputJson) ? outputJson : {};
  const title = sanitizeBusinessEvidenceText(str(output.title)) || fallbackTitle || INITIAL_ANSWER_TITLE;
  const directExplanation =
    sanitizeBusinessEvidenceText(str(output.direct_explanation)) ||
    sanitizeBusinessEvidenceText(str(output.short_answer)) ||
    sanitizeBusinessEvidenceText(str(output.direct_answer)) ||
    sanitizeBusinessEvidenceText(str(output.executive_summary)) ||
    sanitizeBusinessEvidenceText(str(output.summary)) ||
    sanitizeBusinessEvidenceText(str(output.response_markdown)) ||
    "Vaeroex does not have active business evidence for this item yet.";
  const whyItMatters = sanitizeBusinessEvidenceText(str(output.why_it_matters) || str(output.why_vaeroex_thinks_this) || str(output.reasoning) || str(output.reason));
  const outputEvidence = asStringArray(output.evidence);
  const evidence = compactList(
    outputEvidence.length
      ? outputEvidence
      : asStringArray(output.data_used).length
        ? asStringArray(output.data_used)
        : asStringArray(output.evidence_used)
  ).map((item) => sanitizeBusinessEvidenceText(item)).filter(Boolean);
  const confidence = str(output.recommendation_confidence) || str(output.confidence, "Low");
  const limitationItems = asStringArray(output.limitations);
  const limitations = limitationItems.join(" ") || str(output.limitation);
  const responseMarkdown = sanitizeBusinessEvidenceText(str(output.response_markdown));
  const safeFallbackContext = sanitizeBusinessEvidenceText(fallbackContext);
  const normalizedEvidence = evidence.length ? evidence : compactList([safeFallbackContext]).filter(Boolean);
  const copyText = [
    title,
    "",
    directExplanation,
    whyItMatters ? `\nWhy it matters: ${whyItMatters}` : "",
    "\nEvidence:",
    ...normalizedEvidence.map((item) => `- ${item}`),
    `\nRecommendation Confidence: ${confidence}`,
    limitations ? `\nLimitations: ${limitations}` : "",
    responseMarkdown ? `\nDetailed explanation:\n${responseMarkdown}` : ""
  ].filter(Boolean).join("\n");

  return {
    title,
    directExplanation,
    whyItMatters,
    evidence: normalizedEvidence,
    confidence,
    limitations,
    responseMarkdown,
    copyText
  };
}

export async function runContextualAskVaeroexAction(_previousState: ContextualAskState, formData: FormData): Promise<ContextualAskState> {
  if (!isPremiumConversationalVaeroexEnabled()) {
    return {
      status: "error",
      error: "Conversational analysis is not available in this product version."
    };
  }

  const prompt = text(formData, "prompt");
  const followUp = text(formData, "follow_up");
  const contextType = text(formData, "context_type") || "contextual_explanation";
  const contextId = text(formData, "context_id");
  const sourceTitle = sanitizeBusinessEvidenceText(text(formData, "source_title"));
  const sourceSummary = sanitizeBusinessEvidenceText(text(formData, "source_summary"));
  const evidence = parseEvidence(text(formData, "evidence_json"))
    .map((item) => sanitizeBusinessEvidenceText(item))
    .filter(Boolean);
  const question = followUp || prompt || "Explain this recommendation in plain language.";
  let workspaceSnapshot = {} as Json;
  const workflow = getVaeroexWorkflow("ask_vaeroex");

  try {
    const { supabase, user, workspaceId } = await requireWorkspaceForContextualAsk();

    const securityIntentInput = contextualSecurityIntentInput({ prompt, followUp });

    if (securityIntentInput && isSecuritySensitiveRequest(securityIntentInput)) {
      await logSecurityAuditEvent({
        supabase,
        workspaceId,
        userId: user.id,
        actionName: "vaeroex.contextual_security_response",
        operationType: "SYSTEM",
        initiatedBy: "user",
        allowed: false,
        reasonBlocked: "Contextual request matched security-response preflight.",
        metadata: {
          source: "contextual_ask_preflight",
          context_type: contextType,
          context_id: contextId || null,
          classified_input: followUp ? "follow_up" : "prompt"
        } satisfies Json
      });

      return {
        status: "error",
        error: securityResponseMessage()
      };
    }

    const rateLimit = await enforceRateLimit({
      action: "vaeroex.contextual_ask",
      limit: 20,
      windowSeconds: 10 * 60,
      userId: user.id,
      workspaceId,
      identifiers: [contextType, contextId || sourceTitle],
      metadata: { source: "contextual_ask", context_type: contextType }
    });

    if (!rateLimit.allowed) {
      throw new Error(rateLimitMessage(rateLimit));
    }

    const limit = await isUsageLimitReached({
      supabase,
      userId: user.id,
      email: user.email,
      workspaceId,
      limit: "ai_runs_this_month"
    });

    if (limit.reached) {
      throw new Error("You’ve reached the monthly Vaeroex usage limit for this workspace.");
    }

    const queryPlan = planVaeroexQuery({
      query: question,
      contextType,
      hasSelectedContext: Boolean(contextId || sourceTitle)
    });
    const focusedContext = await buildFocusedExplanationContext({
      supabase,
      workspaceId,
      input: {
        contextType,
        contextId,
        sourceTitle,
        sourceSummary,
        evidence
      }
    });
    workspaceSnapshot = focusedContext.workspaceSnapshot;
    const evidenceContext = await buildWorkspaceEvidenceContext({
      supabase,
      workspaceId,
      query: focusedContext.evidenceQuery || question,
      maxChunks: queryPlan.maxEvidenceChunks,
      retrievalStrategy: "keyword_only"
    });
    const eligibleEvidenceChunks = filterBusinessEvidence(evidenceContext.chunks, { sourceKind: "business_memory" });
    const sanitizedEvidenceChunks = eligibleEvidenceChunks
      .map((chunk) => ({
        ...chunk,
        title: sanitizeBusinessEvidenceText(chunk.title) || "Workspace evidence",
        excerpt: sanitizeBusinessEvidenceText(chunk.excerpt),
        summary: sanitizeBusinessEvidenceText(chunk.summary)
      }))
      .filter((chunk) => Boolean(chunk.excerpt || chunk.summary));
    const safeEvidenceContext = rebuildEvidenceContext(evidenceContext, sanitizedEvidenceChunks);

    const contextualInput = {
      context_type: contextType,
      context_id: contextId || null,
      source_title: sourceTitle,
      source_summary: sourceSummary,
      evidence,
      retrieved_evidence: evidenceContextAsJson(safeEvidenceContext),
      follow_up: followUp || null,
      query_plan: {
        classification: queryPlan.classification,
        tier: queryPlan.tier,
        domains: queryPlan.domains,
        retrieval_depth: queryPlan.retrievalDepth,
        max_evidence_chunks: queryPlan.maxEvidenceChunks,
        context_token_budget: queryPlan.contextTokenBudget
      },
      answer_format: {
        title: "Short contextual title",
        direct_explanation: "One concise answer that explains the selected item in its first sentence.",
        why_it_matters: "One short paragraph only when the evidence supports why it matters.",
        evidence: ["Specific source-backed records, values, dates, or observations used."],
        recommendation_confidence: "High | Medium | Low | Insufficient",
        limitations: ["Only meaningful missing, stale, or conflicting evidence."],
        response_markdown: "The same concise explanation in plain business language."
      }
    } satisfies Json;

    const userPrompt = `
Explain the selected item inline on the current Vaeroex page.
Question: ${question}
Context type: ${contextType}
Source title: ${sourceTitle || "Current page item"}
Source summary: ${sourceSummary || "No source summary provided."}
Evidence:
${evidence.map((item) => `- ${item}`).join("\n") || "- No direct page evidence was supplied."}

Return concise JSON with title, direct_explanation, why_it_matters, evidence, recommendation_confidence, limitations, and response_markdown.
The first sentence must explain this selected item directly. Stay within this item and its related evidence. Interpret the evidence instead of repeating it. Do not add generic advice, unrelated recommendations, report sections, action cards, or fabricated facts. Do not expose raw debug details or chain-of-thought.
`;

    const fallbackOutput = buildDeterministicFocusedExplanation({
      sourceTitle: sourceTitle || INITIAL_ANSWER_TITLE,
      sourceSummary,
      evidence: [
        ...focusedContext.directEvidence,
        ...safeEvidenceContext.chunks.map((chunk) => `${chunk.title}: ${chunk.summary || chunk.excerpt}`)
      ],
      verifiedRecordCount: focusedContext.verifiedRecordCount,
      limitations: [...focusedContext.limitations, ...safeEvidenceContext.limitations]
    });
    let generation: Awaited<ReturnType<typeof runVaeroexCompletionWithUsage>> | null = null;
    let outputJson: Json = fallbackOutput;
    let fallbackUsed = false;
    const generationStartedAt = Date.now();

    try {
      const baseSettings = getAIProviderRetrySettings();
      generation = await runVaeroexCompletionWithUsage({
        workflow,
        userPrompt,
        workspaceSnapshot,
        extraInputs: {
          contextual_ask: contextualInput
        } satisfies Json,
        supabase,
        workspaceId,
        userId: user.id,
        modelRoute: "focused_explanation",
        executionPath: queryPlan.classification,
        maxOutputTokens: 700,
        providerSettings: {
          ...baseSettings,
          timeoutMs: Math.min(baseSettings.timeoutMs, queryPlan.timeoutMs),
          maxRetries: 0
        }
      });
      outputJson = generation.outputJson;
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : "";

      if (isSecurityResponseMessage(message)) {
        return { status: "error", error: securityResponseMessage() };
      }

      fallbackUsed = true;
      await recordVaeroexAiUsage({
        supabase,
        workspaceId,
        userId: user.id,
        agentType: workflow.key,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          model: resolveVaeroexModel("focused_explanation"),
          latencyMs: Date.now() - generationStartedAt,
          status: "failed",
          metadata: {
            execution_tier: queryPlan.tier,
            execution_path: queryPlan.classification,
            context_type: contextType,
            evidence_count: focusedContext.directEvidence.length + evidenceContext.chunks.length,
            timeout: /timed out|timeout|abort/i.test(message),
            fallback_used: true
          }
        }
      });
      outputJson = buildDeterministicFocusedExplanation({
        sourceTitle: sourceTitle || INITIAL_ANSWER_TITLE,
        sourceSummary,
        evidence: [
          ...focusedContext.directEvidence,
          ...safeEvidenceContext.chunks.map((chunk) => `${chunk.title}: ${chunk.summary || chunk.excerpt}`)
        ],
        verifiedRecordCount: focusedContext.verifiedRecordCount,
        limitations: [...focusedContext.limitations, ...safeEvidenceContext.limitations],
        failureReason: "The generated explanation was unavailable, so Vaeroex used the selected item and its bounded evidence instead."
      });
    }

    const inputJson = {
      workflow: workflow.key,
      user_prompt: userPrompt,
      extra_inputs: { contextual_ask: contextualInput },
      workspace_snapshot: workspaceSnapshot
    } satisfies Json;

    const { data, error } = await supabase
      .from("ai_agent_runs")
      .insert({
        workspace_id: workspaceId,
        agent_type: workflow.key,
        input_json: inputJson,
        output_json: outputJson,
        status: "completed",
        created_by: user.id
      })
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (generation) {
      await recordVaeroexAiUsage({
        supabase,
        workspaceId,
        userId: user.id,
        agentType: workflow.key,
        usage: {
          ...generation.usage,
          metadata: {
            ...(isRecord(generation.usage.metadata) ? generation.usage.metadata : {}),
            execution_tier: queryPlan.tier,
            execution_path: queryPlan.classification,
            context_type: contextType,
            context_id: contextId || null,
            selected_records: focusedContext.verifiedRecordCount,
            estimated_context_tokens: focusedContext.estimatedContextTokens,
            context_load_ms: focusedContext.loadMs,
            evidence_retrieval_mode: safeEvidenceContext.retrievalMode,
            evidence_chunks: safeEvidenceContext.chunks.length,
            evidence_confidence_score: safeEvidenceContext.confidenceScore,
            fallback_used: fallbackUsed
          }
        }
      });
    }

    return {
      status: "success",
      runId: data?.id,
      answer: outputToAnswer(outputJson, sourceTitle || INITIAL_ANSWER_TITLE, sourceSummary || evidence[0] || "")
    };
  } catch (error) {
    return {
      status: "error",
      error: cleanVaeroexErrorMessage(error instanceof Error ? error.message : undefined, "Vaeroex couldn’t explain this yet.")
    };
  }
}
