"use server";

import { buildWorkspaceEvidenceContext, evidenceContextAsJson } from "@/lib/ai/evidence-index";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { buildWorkspaceSnapshot } from "@/lib/ai/workspace-snapshot";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export type ContextualAskAnswer = {
  title: string;
  shortAnswer: string;
  why: string;
  dataUsed: string[];
  confidence: string;
  limitations: string;
  suggestedNextStep: string;
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
  const title = str(output.title, fallbackTitle || INITIAL_ANSWER_TITLE);
  const shortAnswer =
    str(output.short_answer) ||
    str(output.executive_summary) ||
    str(output.summary) ||
    str(output.response_markdown, "Vaeroex reviewed the current context and prepared a short explanation.");
  const why = str(output.why_vaeroex_thinks_this) || str(output.reasoning) || str(output.reason) || shortAnswer;
  const dataUsed = compactList(asStringArray(output.data_used).length ? asStringArray(output.data_used) : asStringArray(output.evidence_used));
  const confidence = str(output.confidence, "Limited");
  const limitations = str(output.limitations) || str(output.limitation) || "Confidence depends on the depth, quality, and recency of workspace data.";
  const suggestedNextStep =
    str(output.suggested_next_step) ||
    str(output.recommended_next_step) ||
    str(output.next_step) ||
    "Review the explanation, compare it with what you know, and decide whether to act or ask a follow-up.";
  const responseMarkdown = str(output.response_markdown);
  const normalizedDataUsed = dataUsed.length ? dataUsed : compactList([fallbackContext || "Current page context", "Current workspace snapshot"]);
  const copyText = [
    title,
    "",
    `Short answer: ${shortAnswer}`,
    "",
    `Why Vaeroex thinks this: ${why}`,
    "",
    "Data used:",
    ...normalizedDataUsed.map((item) => `- ${item}`),
    "",
    `Confidence / limitations: ${confidence}. ${limitations}`,
    "",
    `Suggested next step: ${suggestedNextStep}`,
    responseMarkdown ? `\nDetailed explanation:\n${responseMarkdown}` : ""
  ].join("\n");

  return {
    title,
    shortAnswer,
    why,
    dataUsed: normalizedDataUsed,
    confidence,
    limitations,
    suggestedNextStep,
    responseMarkdown,
    copyText
  };
}

export async function runContextualAskVaeroexAction(_previousState: ContextualAskState, formData: FormData): Promise<ContextualAskState> {
  const prompt = text(formData, "prompt");
  const followUp = text(formData, "follow_up");
  const contextType = text(formData, "context_type") || "contextual_explanation";
  const contextId = text(formData, "context_id");
  const sourceTitle = text(formData, "source_title");
  const sourceSummary = text(formData, "source_summary");
  const evidence = parseEvidence(text(formData, "evidence_json"));
  const question = followUp || prompt || "Explain this recommendation in plain language.";
  let workspaceSnapshot = {} as Json;
  const workflow = getVaeroexWorkflow("ask_vaeroex");

  try {
    const { supabase, user, workspaceId } = await requireWorkspaceForContextualAsk();
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

    workspaceSnapshot = (await buildWorkspaceSnapshot(supabase, workspaceId)) as Json;
    const evidenceContext = await buildWorkspaceEvidenceContext({
      supabase,
      workspaceId,
      query: `${question}\n${sourceTitle}\n${sourceSummary}\n${evidence.join("\n")}`
    });

    const contextualInput = {
      context_type: contextType,
      context_id: contextId || null,
      source_title: sourceTitle,
      source_summary: sourceSummary,
      evidence,
      retrieved_evidence: evidenceContextAsJson(evidenceContext),
      follow_up: followUp || null,
      answer_format: {
        title: "Short contextual title",
        short_answer: "One direct paragraph.",
        why_vaeroex_thinks_this: "Specific reason without chain-of-thought.",
        data_used: ["Specific records, counts, dates, or evidence used."],
        confidence: "Low | Medium | High | Limited",
        limitations: "What would improve confidence.",
        suggested_next_step: "One practical next step.",
        response_markdown: "Optional concise formatted explanation with requested headings when the prompt asks for sections."
      }
    } satisfies Json;

    const userPrompt = `
Answer inline on the current Vaeroex page. Do not write a long report.
Question: ${question}
Context type: ${contextType}
Source title: ${sourceTitle || "Current page item"}
Source summary: ${sourceSummary || "No source summary provided."}
Evidence:
${evidence.map((item) => `- ${item}`).join("\n") || "- Current workspace snapshot"}

Return concise JSON with title, short_answer, why_vaeroex_thinks_this, data_used, confidence, limitations, suggested_next_step, and response_markdown.
Be specific about the data used. Do not expose raw debug details or chain-of-thought.
`;

    const { outputJson, usage } = await runVaeroexCompletionWithUsage({
      workflow,
      userPrompt,
      workspaceSnapshot,
      extraInputs: {
        contextual_ask: contextualInput
      } satisfies Json
    });

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

    await recordVaeroexAiUsage({
      supabase,
      workspaceId,
      userId: user.id,
      agentType: workflow.key,
      usage: {
        ...usage,
        metadata: {
          context_type: contextType,
          context_id: contextId || null,
          evidence_retrieval_mode: evidenceContext.retrievalMode,
          evidence_chunks: evidenceContext.chunks.length,
          evidence_confidence_score: evidenceContext.confidenceScore
        }
      }
    });

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
