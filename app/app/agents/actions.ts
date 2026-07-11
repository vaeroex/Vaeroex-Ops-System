"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { buildWorkspaceEvidenceContext, evidenceContextAsJson, type EvidenceContext } from "@/lib/ai/evidence-index";
import { buildBoundedWorkspaceContext, buildDeterministicBoundedAnswer } from "@/lib/ai/bounded-context";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { getOpenAIRetrySettings } from "@/lib/ai/openai-resilience";
import { classifyKpiOverviewIntent, runLightweightKpiOverview } from "@/lib/ai/kpi-overview";
import { resolveVaeroexModel } from "@/lib/ai/model-routing";
import { planVaeroexQuery, type VaeroexQueryPlan } from "@/lib/ai/query-depth-planner";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { getVaeroexWorkflow, type VaeroexSaveTarget } from "@/lib/ai/vaeroex-workflows";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { classifySecurityIntent, isSecurityResponseMessage, securityResponseMessage, securityResponseOutput, type SecurityIntentClassification } from "@/lib/security/security-response";
import { logSecurityAuditEvent, requireToolExecution, type RegisteredToolName } from "@/lib/security/tool-execution-gateway";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type JsonRecord = Record<string, unknown>;
const ASK_VAEROEX_MEMORY_RETRIEVAL_TIMEOUT_MS = 6_500;
const ASK_VAEROEX_OPENAI_TIMEOUT_MS = 20_000;
const ASK_VAEROEX_OPENAI_MAX_RETRIES = 1;
const ASK_VAEROEX_KPI_OVERVIEW_OPENAI_TIMEOUT_MS = 6_000;
const ASK_VAEROEX_TERMINAL_SAVE_TIMEOUT_MS = 4_000;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return [];
  }

  return [value];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function priority(value: unknown) {
  const candidate = str(value, "Medium");
  return ["Low", "Medium", "High", "Urgent"].includes(candidate) ? candidate : "Medium";
}

function dateOrNull(value: unknown) {
  const candidate = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function redirectWithError(message: string): never {
  redirect(`/app/agents?error=${encodeURIComponent(message)}`);
}

function logVaeroexRunEvent(event: string, details: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      level: "info",
      component: "ask-vaeroex-run",
      event,
      ...details
    })
  );
}

function logVaeroexRunError(event: string, details: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: "error",
      component: "ask-vaeroex-run",
      event,
      ...details
    })
  );
}

function timeoutError(stage: string, timeoutMs: number) {
  const error = new Error(`${stage} timed out after ${timeoutMs}ms.`);
  error.name = "TimeoutError";
  return error;
}

function isTimeoutLike(error: unknown) {
  return /timed out|timeout|aborterror|aborted/i.test(`${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`);
}

async function withStageTimeout<T>(stage: string, timeoutMs: number, promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(stage, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function runDiagnostics({
  requestId,
  status,
  finalStage,
  details = {}
}: {
  requestId: string;
  status: "running" | "completed" | "failed" | "blocked";
  finalStage: string;
  details?: Record<string, unknown>;
}): Json {
  return {
    request_id: requestId,
    status,
    final_stage: finalStage,
    recorded_at: new Date().toISOString(),
    ...details
  } as Json;
}

function failureOutput({
  requestId,
  workflowKey,
  message,
  finalStage,
  errorType
}: {
  requestId: string;
  workflowKey: string;
  message: string;
  finalStage: string;
  errorType: string;
}) {
  return {
    title: "Vaeroex request did not complete",
    summary: message,
    response_markdown: message,
    error: {
      type: errorType,
      message,
      final_stage: finalStage
    },
    vaeroex_run_diagnostics: runDiagnostics({
      requestId,
      status: "failed",
      finalStage,
      details: {
        workflow: workflowKey,
        error_type: errorType
      }
    })
  } satisfies Json;
}

function reducedEvidenceContext(reason: string): EvidenceContext {
  return {
    available: false,
    retrievalMode: "none",
    chunks: [],
    maxChunks: 0,
    confidenceScore: 12,
    confidenceLabel: "Very Limited",
    limitations: [
      reason,
      "Vaeroex continued with workspace context only because Business Memory evidence was unavailable for this request."
    ],
    dataGaps: [
      "Business Memory evidence was not available for this answer.",
      "Upload, analyze, or retry relevant source evidence to improve answer confidence."
    ],
    policy: [
      "Use only available workspace context and retrieved evidence.",
      "Do not invent numbers, dates, customers, revenue, costs, or operational facts that are not present in evidence.",
      "If evidence is thin, say not enough evidence and ask for the missing data."
    ]
  };
}

function structuredEvidenceContext(recordCount: number): EvidenceContext {
  const confidenceScore = Math.min(88, recordCount ? 35 + recordCount * 5 : 10);

  return {
    available: false,
    retrievalMode: "none",
    chunks: [],
    maxChunks: 0,
    confidenceScore,
    confidenceLabel: recordCount >= 6 ? "Good" : recordCount >= 2 ? "Partial" : "Very Limited",
    limitations: [],
    dataGaps: recordCount ? [] : ["No matching structured workspace records were available."],
    policy: [
      "This path intentionally used bounded structured records without semantic retrieval.",
      "Do not infer facts that are absent from those records."
    ]
  };
}

function askVaeroexOpenAISettings() {
  const base = getOpenAIRetrySettings();

  return {
    ...base,
    timeoutMs: Math.min(base.timeoutMs, ASK_VAEROEX_OPENAI_TIMEOUT_MS),
    maxRetries: Math.min(base.maxRetries, ASK_VAEROEX_OPENAI_MAX_RETRIES)
  };
}

function askKpiOverviewOpenAISettings() {
  const base = getOpenAIRetrySettings();

  return {
    ...base,
    timeoutMs: Math.min(base.timeoutMs, ASK_VAEROEX_KPI_OVERVIEW_OPENAI_TIMEOUT_MS),
    maxRetries: 0
  };
}

function executionPlanForWorkflow(workflowKey: string, query: string, workflowDescription: string) {
  const planningQuery = workflowKey === "ask_vaeroex" ? query : `${query}\n${workflowDescription}`;
  const plan = planVaeroexQuery({ query: planningQuery });

  if (workflowKey === "ask_vaeroex" || plan.requiresOpenAI || plan.classification === "security_sensitive") {
    return plan;
  }

  const crossDomain = plan.domains.length > 1;

  return {
    ...plan,
    classification: crossDomain ? "cross_business_reasoning" : "focused_explanation",
    tier: crossDomain ? 3 : 2,
    retrievalDepth: crossDomain ? "bounded_cross_domain" : "focused",
    maxEvidenceChunks: crossDomain ? 6 : 3,
    requiresOpenAI: true,
    modelTier: crossDomain ? "reasoning" : "focused",
    timeoutMs: crossDomain ? 18_000 : 10_000,
    contextTokenBudget: crossDomain ? 16_000 : 6_000,
    fallback: crossDomain ? "bounded_summary" : "focused_context",
    reason: `The ${workflowKey} workflow explicitly requests a generated output, but remains bounded to relevant domains.`
  } satisfies VaeroexQueryPlan;
}

function modelRouteForPlan(plan: VaeroexQueryPlan) {
  return plan.tier === 3 ? "cross_business_reasoning" as const : plan.tier === 2 ? "focused_explanation" as const : "default" as const;
}

function withRunDiagnostics(output: Json, diagnostics: Json) {
  return {
    ...(isRecord(output) ? output : { response_markdown: String(output || "") }),
    vaeroex_run_diagnostics: diagnostics
  } as Json;
}

async function requireWorkspace() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  if (!context.membership || context.membership.workspace_id !== context.activeWorkspace.id || context.membership.status !== "active") {
    redirect("/app/setup?error=Workspace access is required.");
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
    workspaceId: context.activeWorkspace.id,
    membership: context.membership
  };
}

function buildInputJson(workflowKey: string, userPrompt: string, extraInputs: Json, workspaceSnapshot: Json) {
  return {
    workflow: workflowKey,
    user_prompt: userPrompt,
    extra_inputs: extraInputs,
    workspace_snapshot: workspaceSnapshot
  } satisfies Json;
}

async function createRunningRun({
  supabase,
  workspaceId,
  userId,
  workflowKey,
  inputJson,
  requestId
}: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  workspaceId: string;
  userId: string;
  workflowKey: string;
  inputJson: Json;
  requestId: string;
}) {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: workflowKey,
      input_json: inputJson,
      output_json: {
        title: "Vaeroex request in progress",
        summary: "Vaeroex is preparing this request.",
        vaeroex_run_diagnostics: runDiagnostics({
          requestId,
          status: "running",
          finalStage: "run_created",
          details: { workflow: workflowKey }
        })
      } satisfies Json,
      status: "running",
      error_message: null,
      created_by: userId
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message || "Vaeroex could not create a run record.");
  }

  return data?.id ?? null;
}

async function updateRunRecord({
  supabase,
  workspaceId,
  runId,
  inputJson,
  outputJson,
  status,
  errorMessage
}: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  workspaceId: string;
  runId: string;
  inputJson: Json;
  outputJson: Json;
  status: string;
  errorMessage?: string | null;
}) {
  const { data, error } = await withStageTimeout(
    "Run save",
    ASK_VAEROEX_TERMINAL_SAVE_TIMEOUT_MS,
    Promise.resolve(
      supabase
        .from("ai_agent_runs")
        .update({
          input_json: inputJson,
          output_json: outputJson,
          status,
          error_message: errorMessage ?? null,
          updated_at: new Date().toISOString()
        })
        .eq("id", runId)
        .eq("workspace_id", workspaceId)
        .select("id")
        .maybeSingle()
    )
  );

  if (error || !data?.id) {
    throw new Error(error?.message || "Vaeroex run could not be saved.");
  }

  return data.id;
}

async function storeFailedRun({
  supabase,
  workspaceId,
  userId,
  workflowKey,
  inputJson,
  message,
  requestId,
  finalStage,
  errorType,
  runId
}: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  workspaceId: string;
  userId: string;
  workflowKey: string;
  inputJson: Json;
  message: string;
  requestId: string;
  finalStage: string;
  errorType: string;
  runId?: string | null;
}) {
  const outputJson = failureOutput({ requestId, workflowKey, message, finalStage, errorType });

  if (runId) {
    return updateRunRecord({
      supabase,
      workspaceId,
      runId,
      inputJson,
      outputJson,
      status: "failed",
      errorMessage: message
    });
  }

  const { data } = await supabase
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: workflowKey,
      input_json: inputJson,
      output_json: outputJson,
      status: "failed",
      error_message: message,
      created_by: userId
    })
    .select("id")
    .maybeSingle();

  return data?.id ?? null;
}

async function storeSecurityBlockedRun({
  supabase,
  workspaceId,
  userId,
  workflowKey,
  inputJson,
  requestId,
  runId,
  securityIntent
}: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  workspaceId: string;
  userId: string;
  workflowKey: string;
  inputJson: Json;
  requestId: string;
  runId?: string | null;
  securityIntent?: SecurityIntentClassification;
}) {
  await logSecurityAuditEvent({
    supabase,
    workspaceId,
    userId,
    actionName: "vaeroex.security_response",
    operationType: "SYSTEM",
    initiatedBy: "user",
    allowed: false,
    reasonBlocked: "User request was classified as security sensitive.",
    metadata: {
      workflow: workflowKey,
      source: "ask_vaeroex_preflight",
      classification_category: securityIntent?.category || "Security Sensitive",
      classification_confidence: securityIntent?.confidence || "Medium",
      classification_reasons: securityIntent?.reasons || []
    } satisfies Json
  });

  const outputJson = withRunDiagnostics(
    securityResponseOutput() satisfies Json,
    runDiagnostics({
      requestId,
      status: "blocked",
      finalStage: "security_blocked",
      details: {
        workflow: workflowKey,
        block_type: "security_preflight"
      }
    })
  );

  if (runId) {
    return updateRunRecord({
      supabase,
      workspaceId,
      runId,
      inputJson,
      outputJson,
      status: "blocked",
      errorMessage: securityResponseMessage()
    });
  }

  const { data } = await supabase
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: workflowKey,
      input_json: inputJson,
      output_json: outputJson,
      status: "blocked",
      error_message: securityResponseMessage(),
      created_by: userId
    })
    .select("id")
    .maybeSingle();

  return data?.id ?? null;
}

export async function runVaeroexAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const workflow = getVaeroexWorkflow(text(formData, "workflow_key"));
  const userPrompt = text(formData, "user_prompt");
  const requestId = randomUUID();
  const startedAt = Date.now();
  const logDetails = (details: Record<string, unknown> = {}) => ({
    requestId,
    workspaceId,
    userId: user.id,
    workflow: workflow.key,
    elapsedMs: Date.now() - startedAt,
    ...details
  });
  const extraInputs = {
    date_range_start: text(formData, "date_range_start"),
    date_range_end: text(formData, "date_range_end"),
    subject: text(formData, "subject")
  } satisfies Json;
  let workspaceSnapshot = {} as Json;
  let inputJson = buildInputJson(workflow.key, userPrompt, extraInputs, workspaceSnapshot);
  let destination = "/app/agents";
  let outcome: "success" | "security" | "error" = "success";
  let currentStage = "request_started";
  let runId: string | null = null;

  logVaeroexRunEvent("request_started", logDetails({ promptLength: userPrompt.length }));

  try {
    currentStage = "run_create";
    logVaeroexRunEvent("run_create_started", logDetails());
    runId = await createRunningRun({
      supabase,
      workspaceId,
      userId: user.id,
      workflowKey: workflow.key,
      inputJson,
      requestId
    });
    logVaeroexRunEvent("run_created", logDetails({ runId, status: "running" }));

    currentStage = "preflight";
    logVaeroexRunEvent("preflight_started", logDetails());
    logVaeroexRunEvent("rate_limit_started", logDetails());
    const rateLimit = await enforceRateLimit({
      action: "vaeroex.run",
      limit: 12,
      windowSeconds: 10 * 60,
      userId: user.id,
      workspaceId,
      identifiers: [workflow.key],
      metadata: { source: "ask_vaeroex", workflow: workflow.key }
    });

    if (!rateLimit.allowed) {
      throw new Error(rateLimitMessage(rateLimit));
    }
    logVaeroexRunEvent("rate_limit_finished", logDetails({ allowed: true }));
    logVaeroexRunEvent("preflight_finished", logDetails({ allowed: true }));

    const securityIntent = classifySecurityIntent(`${workflow.title}\n${userPrompt}\n${extraInputs.subject || ""}`);
    logVaeroexRunEvent("security_intent_classified", logDetails({
      category: securityIntent.category,
      securitySensitive: securityIntent.securitySensitive,
      confidence: securityIntent.confidence
    }));

    if (securityIntent.securitySensitive) {
      currentStage = "security_blocked";
      logVaeroexRunEvent("security_blocked", logDetails({
        reason: "intent_classifier",
        category: securityIntent.category,
        confidence: securityIntent.confidence
      }));
      const blockedRunId = await storeSecurityBlockedRun({
        supabase,
        workspaceId,
        userId: user.id,
        workflowKey: workflow.key,
        inputJson,
        requestId,
        runId,
        securityIntent
      });
      logVaeroexRunEvent("run_saved", logDetails({ status: "blocked", runId: blockedRunId }));
      revalidatePath("/app/agents");
      outcome = "security";
      destination = `/app/agents${blockedRunId ? `?run=${blockedRunId}` : `?error=${encodeURIComponent(securityResponseMessage())}`}`;
    } else {
      currentStage = "usage_limit";
      logVaeroexRunEvent("usage_limit_started", logDetails());
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
      logVaeroexRunEvent("usage_limit_finished", logDetails({ allowed: true }));

      currentStage = "intent_detection";
      logVaeroexRunEvent("intent_detection_started", logDetails());
      const intentStartedAt = Date.now();
      const kpiOverviewIntent = workflow.key === "ask_vaeroex" ? classifyKpiOverviewIntent(userPrompt) : { matched: false, requiresRetrieval: false, reason: "non_ask_workflow" };
      const intentClassificationMs = Date.now() - intentStartedAt;
      logVaeroexRunEvent("intent_detection_finished", logDetails({
        durationMs: intentClassificationMs,
        kpiOverviewMatched: kpiOverviewIntent.matched,
        requiresRetrieval: kpiOverviewIntent.requiresRetrieval,
        reason: kpiOverviewIntent.reason
      }));

      if (kpiOverviewIntent.matched) {
        currentStage = "lightweight_kpi_overview";
        logVaeroexRunEvent("lightweight_kpi_overview_started", logDetails({
          reason: kpiOverviewIntent.reason
        }));
        const kpiOverview = await runLightweightKpiOverview({
          supabase,
          workspaceId,
          userPrompt,
          intentClassificationMs,
          openAISettings: askKpiOverviewOpenAISettings(),
          stageLogger: (event, details = {}) => logVaeroexRunEvent(event, logDetails(details))
        });
        workspaceSnapshot = kpiOverview.workspaceSnapshot;
        const kpiOverviewInputs = {
          ...extraInputs,
          ...kpiOverview.extraInputs
        } satisfies Json;
        inputJson = buildInputJson(workflow.key, userPrompt, kpiOverviewInputs, workspaceSnapshot);

        currentStage = "run_save";
        logVaeroexRunEvent("run_save_started", logDetails({
          workflowPath: "lightweight_kpi_overview",
          fallbackUsed: kpiOverview.diagnostics.fallback_used,
          totalDurationMs: kpiOverview.diagnostics.total_ms
        }));
        if (!runId) {
          throw new Error("Vaeroex run record was not available for saving.");
        }
        const completedOutputJson = withRunDiagnostics(
          {
            ...(isRecord(kpiOverview.outputJson) ? kpiOverview.outputJson : { response_markdown: String(kpiOverview.outputJson || "") }),
            vaeroex_run_diagnostics: kpiOverview.diagnostics
          } as Json,
          runDiagnostics({
            requestId,
            status: "completed",
            finalStage: "completed",
            details: {
              workflow: workflow.key,
              workflow_path: "lightweight_kpi_overview",
              intent_classification_ms: kpiOverview.diagnostics.intent_classification_ms,
              kpi_query_ms: kpiOverview.diagnostics.kpi_query_ms,
              retrieval_ms: kpiOverview.diagnostics.retrieval_ms,
              prompt_construction_ms: kpiOverview.diagnostics.prompt_construction_ms,
              openai_ms: kpiOverview.diagnostics.openai_ms,
              total_ms: kpiOverview.diagnostics.total_ms,
              estimated_context_tokens: kpiOverview.diagnostics.estimated_context_tokens,
              openai_attempted: kpiOverview.diagnostics.openai_attempted,
              fallback_used: kpiOverview.diagnostics.fallback_used,
              fallback_reason: kpiOverview.diagnostics.fallback_reason
            }
          })
        );
        const savedRunId = await updateRunRecord({
          supabase,
          workspaceId,
          runId,
          inputJson,
          outputJson: completedOutputJson,
          status: "completed",
          errorMessage: null
        });
        logVaeroexRunEvent("run_saved", logDetails({ status: "completed", runId: savedRunId, workflowPath: "lightweight_kpi_overview" }));

        if (kpiOverview.usage) {
          currentStage = "usage_record";
          logVaeroexRunEvent("usage_record_started", logDetails({ runId: savedRunId, workflowPath: "lightweight_kpi_overview" }));
          await recordVaeroexAiUsage({
            supabase,
            workspaceId,
            userId: user.id,
            agentType: workflow.key,
            usage: {
              ...kpiOverview.usage,
              metadata: {
                ...(isRecord(kpiOverview.usage.metadata) ? kpiOverview.usage.metadata : {}),
                workflow_path: "lightweight_kpi_overview",
                fallback_used: kpiOverview.diagnostics.fallback_used,
                estimated_context_tokens: kpiOverview.diagnostics.estimated_context_tokens
              }
            }
          });
          logVaeroexRunEvent("usage_record_finished", logDetails({ runId: savedRunId, workflowPath: "lightweight_kpi_overview" }));
        }

        currentStage = "redirect";
        revalidatePath("/app/agents");
        destination = `/app/agents?run=${savedRunId}`;
      } else {
        const queryPlan = executionPlanForWorkflow(workflow.key, userPrompt, workflow.description);
        logVaeroexRunEvent("query_plan_created", logDetails({
          classification: queryPlan.classification,
          tier: queryPlan.tier,
          domains: queryPlan.domains,
          retrievalDepth: queryPlan.retrievalDepth,
          requiresOpenAI: queryPlan.requiresOpenAI,
          maxEvidenceChunks: queryPlan.maxEvidenceChunks,
          contextTokenBudget: queryPlan.contextTokenBudget,
          fallback: queryPlan.fallback
        }));

        currentStage = "bounded_context";
        logVaeroexRunEvent("bounded_context_started", logDetails({ domains: queryPlan.domains }));
        const boundedContext = await buildBoundedWorkspaceContext({
          supabase,
          workspaceId,
          query: userPrompt || workflow.title,
          plan: queryPlan
        });
        workspaceSnapshot = boundedContext.workspaceSnapshot;
        logVaeroexRunEvent("bounded_context_finished", logDetails({
          durationMs: boundedContext.loadMs,
          loadedDomains: boundedContext.loadedDomains,
          structuredEvidenceCount: boundedContext.structuredEvidenceCount,
          estimatedContextTokens: boundedContext.estimatedContextTokens
        }));

        let evidenceContext = structuredEvidenceContext(boundedContext.structuredEvidenceCount);

        if (queryPlan.requiresOpenAI && queryPlan.maxEvidenceChunks > 0) {
          currentStage = "business_memory";
          logVaeroexRunEvent("memory_retrieval_started", logDetails({
            maxEvidenceChunks: queryPlan.maxEvidenceChunks,
            retrievalStrategy: queryPlan.tier === 2 ? "keyword_only" : "auto"
          }));

          try {
            evidenceContext = await withStageTimeout(
              "Business Memory retrieval",
              Math.min(ASK_VAEROEX_MEMORY_RETRIEVAL_TIMEOUT_MS, queryPlan.timeoutMs),
              buildWorkspaceEvidenceContext({
                supabase,
                workspaceId,
                query: boundedContext.evidenceQuery,
                maxChunks: queryPlan.maxEvidenceChunks,
                retrievalStrategy: queryPlan.tier === 2 ? "keyword_only" : "auto",
                embeddingTimeoutMs: queryPlan.tier === 3 ? 4_000 : 3_000,
                stageLogger: (event, details = {}) => logVaeroexRunEvent(`memory_${event}`, logDetails(details))
              })
            );
          } catch (error) {
            const reason = isTimeoutLike(error)
              ? "Business Memory retrieval took too long for this request."
              : cleanVaeroexErrorMessage(error instanceof Error ? error.message : undefined, "Business Memory retrieval failed.");
            logVaeroexRunError(isTimeoutLike(error) ? "memory_retrieval_timeout" : "memory_retrieval_failed", logDetails({
              errorName: error instanceof Error ? error.name : "UnknownError",
              message: reason,
              continuingWithReducedContext: true
            }));
            evidenceContext = reducedEvidenceContext(reason);
          }

          logVaeroexRunEvent("memory_retrieval_finished", logDetails({
            retrievalMode: evidenceContext.retrievalMode,
            evidenceChunks: evidenceContext.chunks.length,
            evidenceConfidenceScore: evidenceContext.confidenceScore,
            reducedContext: !evidenceContext.available
          }));
        } else {
          logVaeroexRunEvent("memory_retrieval_skipped", logDetails({ reason: queryPlan.classification }));
        }

        const evidenceAwareInputs = {
          ...extraInputs,
          query_plan: {
            classification: queryPlan.classification,
            tier: queryPlan.tier,
            domains: queryPlan.domains,
            retrieval_depth: queryPlan.retrievalDepth,
            max_evidence_chunks: queryPlan.maxEvidenceChunks,
            context_token_budget: queryPlan.contextTokenBudget,
            fallback: queryPlan.fallback
          },
          evidence_context: evidenceContextAsJson(evidenceContext)
        } satisfies Json;
        inputJson = buildInputJson(workflow.key, userPrompt, evidenceAwareInputs, workspaceSnapshot);

        let outputJson: Json = buildDeterministicBoundedAnswer({ query: userPrompt, context: boundedContext });
        let usage: Awaited<ReturnType<typeof runVaeroexCompletionWithUsage>>["usage"] | null = null;
        let fallbackUsed = false;

        if (queryPlan.requiresOpenAI) {
          currentStage = "openai";
          logVaeroexRunEvent("openai_started", logDetails({
            modelRoute: modelRouteForPlan(queryPlan),
            executionPath: queryPlan.classification
          }));
          const baseSettings = askVaeroexOpenAISettings();
          const modelRoute = modelRouteForPlan(queryPlan);
          const generationStartedAt = Date.now();

          try {
            const generation = await runVaeroexCompletionWithUsage({
              workflow,
              userPrompt,
              workspaceSnapshot,
              extraInputs: evidenceAwareInputs,
              supabase,
              workspaceId,
              modelRoute,
              executionPath: queryPlan.classification,
              maxOutputTokens: queryPlan.tier === 3 ? 1_200 : 700,
              openAISettings: {
                ...baseSettings,
                timeoutMs: Math.min(baseSettings.timeoutMs, queryPlan.timeoutMs),
                maxRetries: queryPlan.tier === 3 ? Math.min(baseSettings.maxRetries, 1) : 0
              }
            });
            outputJson = generation.outputJson;
            usage = generation.usage;
            logVaeroexRunEvent("openai_finished", logDetails({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              latencyMs: usage.latencyMs ?? null
            }));
          } catch (generationError) {
            const rawMessage = generationError instanceof Error ? generationError.message : "";

            if (isSecurityResponseMessage(rawMessage)) {
              throw generationError;
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
                model: resolveVaeroexModel(modelRoute),
                latencyMs: Date.now() - generationStartedAt,
                status: "failed",
                metadata: {
                  execution_tier: queryPlan.tier,
                  execution_path: queryPlan.classification,
                  data_domains: queryPlan.domains,
                  evidence_count: boundedContext.structuredEvidenceCount + evidenceContext.chunks.length,
                  timeout: isTimeoutLike(generationError),
                  fallback_used: true
                }
              }
            });
            outputJson = buildDeterministicBoundedAnswer({
              query: userPrompt,
              context: boundedContext,
              failureReason: isTimeoutLike(generationError)
                ? "The deeper analysis reached its time limit."
                : "The deeper analysis was temporarily unavailable."
            });
            logVaeroexRunError(isTimeoutLike(generationError) ? "openai_timeout_fallback" : "openai_fallback", logDetails({
              finalStage: currentStage,
              fallback: queryPlan.fallback,
              errorName: generationError instanceof Error ? generationError.name : "UnknownError"
            }));
          }
        } else {
          logVaeroexRunEvent("openai_skipped", logDetails({ classification: queryPlan.classification }));
        }

        currentStage = "run_save";
        logVaeroexRunEvent("run_save_started", logDetails({ fallbackUsed }));
        if (!runId) {
          throw new Error("Vaeroex run record was not available for saving.");
        }
        const completedOutputJson = withRunDiagnostics(
          outputJson,
          runDiagnostics({
            requestId,
            status: "completed",
            finalStage: "completed",
            details: {
              workflow: workflow.key,
              execution_tier: queryPlan.tier,
              execution_path: queryPlan.classification,
              data_domains: queryPlan.domains,
              loaded_domains: boundedContext.loadedDomains,
              bounded_context_ms: boundedContext.loadMs,
              estimated_context_tokens: boundedContext.estimatedContextTokens,
              structured_evidence_count: boundedContext.structuredEvidenceCount,
              evidence_retrieval_mode: evidenceContext.retrievalMode,
              evidence_chunks: evidenceContext.chunks.length,
              reduced_context: !evidenceContext.available,
              fallback_used: fallbackUsed
            }
          })
        );
        const savedRunId = await updateRunRecord({
          supabase,
          workspaceId,
          runId,
          inputJson,
          outputJson: completedOutputJson,
          status: "completed",
          errorMessage: null
        });
        logVaeroexRunEvent("run_saved", logDetails({ status: "completed", runId: savedRunId, fallbackUsed }));

        if (usage) {
          currentStage = "usage_record";
          logVaeroexRunEvent("usage_record_started", logDetails({ runId: savedRunId }));
          await recordVaeroexAiUsage({
            supabase,
            workspaceId,
            userId: user.id,
            agentType: workflow.key,
            usage: {
              ...usage,
              metadata: {
                ...(isRecord(usage.metadata) ? usage.metadata : {}),
                execution_tier: queryPlan.tier,
                execution_path: queryPlan.classification,
                data_domains: queryPlan.domains,
                loaded_domains: boundedContext.loadedDomains,
                estimated_context_tokens: boundedContext.estimatedContextTokens,
                evidence_retrieval_mode: evidenceContext.retrievalMode,
                evidence_chunks: evidenceContext.chunks.length,
                evidence_confidence_score: evidenceContext.confidenceScore,
                fallback_used: fallbackUsed
              }
            }
          });
          logVaeroexRunEvent("usage_record_finished", logDetails({ runId: savedRunId }));
        }

        currentStage = "redirect";
        revalidatePath("/app/agents");
        destination = `/app/agents?run=${savedRunId}`;
      }
    }
  } catch (error) {
    const message = cleanVaeroexErrorMessage(error instanceof Error ? error.message : undefined);
    const rawMessage = error instanceof Error ? error.message : "";
    const isTimeout = isTimeoutLike(error);
    const errorType = isTimeout ? "timeout" : /token budget|usage budget|monthly.*token/i.test(rawMessage) ? "token_budget" : /circuit|temporarily unavailable/i.test(rawMessage) ? "circuit_or_provider" : "unexpected_error";
    outcome = "error";
    logVaeroexRunError(isTimeout ? "timeout" : "error_thrown", logDetails({
      errorName: error instanceof Error ? error.name : "UnknownError",
      message,
      finalStage: currentStage,
      runId
    }));
    let failedRunId: string | null = null;

    try {
      failedRunId = await storeFailedRun({
        supabase,
        workspaceId,
        userId: user.id,
        workflowKey: workflow.key,
        inputJson,
        message,
        requestId,
        finalStage: currentStage,
        errorType,
        runId
      });
      logVaeroexRunEvent("run_saved", logDetails({ status: "failed", runId: failedRunId }));
    } catch (saveError) {
      logVaeroexRunError("failed_run_save_failed", logDetails({
        originalFinalStage: currentStage,
        errorName: saveError instanceof Error ? saveError.name : "UnknownError",
        message: cleanVaeroexErrorMessage(saveError instanceof Error ? saveError.message : undefined, "Vaeroex could not save the failed run.")
      }));
    }

    currentStage = "redirect";
    revalidatePath("/app/agents");
    destination = `/app/agents${failedRunId ? `?run=${failedRunId}&` : "?"}error=${encodeURIComponent(message)}`;
  }

  logVaeroexRunEvent("response_returned", logDetails({ outcome, destination }));
  redirect(destination as Route);
}

async function getRun(runId: string) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const { data: run, error } = await supabase
    .from("ai_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !run) {
    redirectWithError(error?.message || "Vaeroex result not found.");
  }

  return { supabase, user, workspaceId, membership, run, output: asRecord(run.output_json) };
}

function taskDrafts(output: JsonRecord) {
  return [
    ...asArray(output.suggested_tasks),
    ...asArray(output.tasks),
    ...asArray(output.follow_up_tasks)
  ].map((task, index) => {
    const record = asRecord(task);
    const title = str(record.title, typeof task === "string" ? task : `Vaeroex review ${index + 1}`);
    const description =
      str(record.description) ||
      str(record.reason_this_matters) ||
      str(record.recommended_action) ||
      "Review this Vaeroex recommendation as an executive intelligence signal.";

    return {
      title,
      description,
      priority: priority(record.priority),
      category: str(record.category, "Vaeroex review"),
      due_date: dateOrNull(record.due_date) ?? dateOrNull(record.recommended_due_date)
    };
  });
}

function fieldSchema(fields: unknown, formName: string): Json {
  const values = asArray(fields).length ? asArray(fields) : ["Submitted by", "Business details", "Priority", "Manager notes"];

  return values.map((field, index) => {
    const record = asRecord(field);
    const label = str(record.label, typeof field === "string" ? field : `Field ${index + 1}`);
    return {
      key: slugify(str(record.key, `${formName}-${label}`)) || `field-${index + 1}`,
      label,
      type: str(record.type, label.toLowerCase().includes("priority") ? "priority" : "text"),
      required: typeof record.required === "boolean" ? record.required : index < 2
    };
  }) as Json;
}

function formDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.form), ...asArray(output.forms), ...asArray(output.suggested_forms)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name, typeof draft === "string" ? draft : `Vaeroex form ${index + 1}`);
    return {
      name,
      description: str(record.description, str(record.purpose, "Draft generated by Vaeroex for manager review.")),
      form_type: str(record.form_type, "operations"),
      schema_json: fieldSchema(record.fields ?? record.recommended_fields, name)
    };
  });
}

function checklistDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.checklist), ...asArray(output.checklists), ...asArray(output.suggested_checklists)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name, str(record.checklist_name, typeof draft === "string" ? draft : `Vaeroex checklist ${index + 1}`));
    const items = asArray(record.items ?? record.checklist_items).map((item) =>
      typeof item === "string" ? item : str(asRecord(item).label, str(asRecord(item).title, "Checklist item"))
    );

    return {
      name,
      description: str(record.description, str(record.purpose, "Draft generated by Vaeroex for manager review.")),
      category: str(record.category, "Operations"),
      frequency: str(record.frequency, "As needed"),
      assigned_role: str(record.assigned_role, str(record.owner_role, "Manager")),
      items_json: (items.length ? items : ["Review evidence", "Document decision", "Identify source-system implications", "Prepare leadership review"]) as Json
    };
  });
}

function sopDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.sop), ...asArray(output.sops), ...asArray(output.suggested_sops)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const title = str(record.title, typeof draft === "string" ? draft : `Vaeroex SOP ${index + 1}`);
    return {
      title,
      department: str(record.department, "Operations"),
      category: str(record.category, "Vaeroex draft"),
      body_markdown:
        str(record.body_markdown) ||
        str(record.content_markdown) ||
        str(record.markdown) ||
        `# ${title}\n\nDraft generated by Vaeroex for manager review.`,
      version: Number(record.version || 1)
    };
  });
}

function reportDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.report), ...asArray(output.reports)];

  if (!drafts.length && (output.response_markdown || output.summary)) {
    drafts.push(output);
  }

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const title = str(record.title, index === 0 ? "Operations Report - Generated by Vaeroex" : `Operations Report ${index + 1} - Generated by Vaeroex`);
    return {
      title: title.includes("Vaeroex") ? title : `${title} - Generated by Vaeroex`,
      report_type: str(record.report_type, "Operations Report"),
      date_range_start: dateOrNull(record.date_range_start),
      date_range_end: dateOrNull(record.date_range_end),
      body_markdown:
        str(record.body_markdown) ||
        str(record.response_markdown) ||
        str(output.response_markdown) ||
        `# ${title}\n\nGenerated by Vaeroex.\n\n${str(record.summary, str(output.summary, "Summary pending manager review."))}`
    };
  });
}

async function appendSavedRecord(runId: string, target: VaeroexSaveTarget, output: JsonRecord, ids: string[]) {
  const { supabase, workspaceId } = await requireWorkspace();
  const savedRecords = asArray(output.saved_records).filter(isRecord);
  const nextOutput = {
    ...output,
    saved_records: [
      ...savedRecords,
      {
        target,
        ids,
        count: ids.length,
        saved_at: new Date().toISOString()
      }
    ]
  } as Json;

  await supabase
    .from("ai_agent_runs")
    .update({ output_json: nextOutput })
    .eq("id", runId)
    .eq("workspace_id", workspaceId);
}

function redirectSaved(runId: string, count: number, target: VaeroexSaveTarget): never {
  redirect(`/app/agents?run=${runId}&saved=${encodeURIComponent(`${count} ${target} saved`)}`);
}

export async function saveVaeroexOutputAction(formData: FormData) {
  const runId = text(formData, "run_id");
  const target = text(formData, "save_target") as VaeroexSaveTarget;

  if (!runId || !["sop", "report"].includes(target)) {
    redirectWithError("Choose a Vaeroex result and save target.");
  }

  const { supabase, user, workspaceId, membership, run, output } = await getRun(runId);
  const toolByTarget: Record<VaeroexSaveTarget, RegisteredToolName> = {
    sop: "save_vaeroex_output_sop",
    report: "save_vaeroex_output_report"
  };
  try {
    await requireToolExecution<{ runId: string }>(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: toolByTarget[target],
        args: { runId },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: run.id,
        metadata: {
          save_target: target,
          agent_type: run.agent_type
        } satisfies Json
      }
    );
  } catch (error) {
    redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error instanceof Error ? error.message : "This request cannot be performed because it conflicts with platform security requirements.")}`);
  }

  const createdIds: string[] = [];

  if (target === "sop") {
    const drafts = sopDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no SOP draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("sops")
      .insert(
        drafts.map((sop) => ({
          workspace_id: workspaceId,
          title: sop.title,
          department: sop.department,
          category: sop.category,
          body_markdown: sop.body_markdown,
          status: "Draft",
          version: sop.version,
          created_by: user.id,
          ai_generated: true
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/sops");
  }

  if (target === "report") {
    const drafts = reportDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no report draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("reports")
      .insert(
        drafts.map((report) => ({
          workspace_id: workspaceId,
          report_type: report.report_type,
          title: report.title,
          date_range_start: report.date_range_start,
          date_range_end: report.date_range_end,
          body_markdown: report.body_markdown,
          source_data_json: {
            vaeroex_run_id: run.id,
            workflow: run.agent_type,
            saved_at: new Date().toISOString()
          } satisfies Json,
          created_by: user.id
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/reports");
  }

  if (!createdIds.length) {
    redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("No records were saved from this Vaeroex result.")}`);
  }

  await appendSavedRecord(run.id, target, output, createdIds);
  revalidatePath("/app/agents");
  revalidatePath("/app");
  redirectSaved(run.id, createdIds.length, target);
}
