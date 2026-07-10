import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { fetchWithOpenAIResilience, getOpenAIRetrySettings, type OpenAIRetrySettings } from "@/lib/ai/openai-resilience";
import { assertWorkspaceTokenBudget, estimateTokenCount, type VaeroexTokenUsage } from "@/lib/ai/usage";
import { applyKpiSettingsToRows, sortKpiRowsBySettings, type KpiSettingRow } from "@/lib/kpis/settings";
import type { Database, Json } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type JsonRecord = Record<string, unknown>;

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const KPI_OVERVIEW_OPENAI_TIMEOUT_MS = 6_000;
const KPI_OVERVIEW_MAX_ROWS = 160;
const KPI_OVERVIEW_MAX_METRICS = 12;
const KPI_OVERVIEW_HISTORY_PER_METRIC = 4;
const KPI_OVERVIEW_ROW_SELECT =
  "id,workspace_id,folder_id,name,category,target,actual_value,metric_date,owner,notes,source,source_file_id,import_id,import_row_id,raw_data_json,created_by,created_at,updated_at,archived_at,deleted_at";

export type KpiOverviewIntent = {
  matched: boolean;
  requiresRetrieval: boolean;
  reason: string;
};

export type KpiOverviewMetric = {
  name: string;
  category: string | null;
  latestValue: number | null;
  target: number | null;
  status: "on_track" | "near_target" | "needs_attention" | "missing_target" | "missing_value";
  trend: "improving" | "declining" | "steady" | "not_enough_history";
  reportingPeriod: string;
  lastUpdated: string;
  freshness: "current" | "stale" | "old";
  historyCount: number;
  history: Array<{
    metricDate: string;
    actualValue: number | null;
    target: number | null;
  }>;
};

export type KpiOverviewSummary = {
  totalRows: number;
  metricCount: number;
  metrics: KpiOverviewMetric[];
  counts: {
    onTrack: number;
    nearTarget: number;
    needsAttention: number;
    missingTargets: number;
    missingValues: number;
    stale: number;
    insufficientHistory: number;
  };
  recommendationConfidence: "High" | "Medium" | "Low" | "Insufficient";
  limitations: string[];
  evidenceUsed: string[];
};

export type KpiOverviewDiagnostics = {
  workflow_path: "lightweight_kpi_overview";
  intent_classification_ms: number;
  kpi_query_ms: number;
  retrieval_ms: number;
  prompt_construction_ms: number;
  openai_ms: number;
  total_ms: number;
  estimated_context_tokens: number;
  kpi_rows_loaded: number;
  kpi_rows_included: number;
  metrics_included: number;
  openai_attempted: boolean;
  openai_timed_out: boolean;
  fallback_used: boolean;
  fallback_reason: string | null;
};

type StageLogger = (event: string, details?: Record<string, unknown>) => void;

export type KpiOverviewDataLoad = {
  rows: KpiRow[];
  settings: KpiSettingRow[];
  summary: KpiOverviewSummary;
  queryMs: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateOnly(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}/.test(value || "") ? (value || "").slice(0, 10) : "";
}

function daysSince(date: string, now = new Date()) {
  if (!date) return Number.POSITIVE_INFINITY;
  const parsed = new Date(`${date}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - parsed) / 86_400_000);
}

function isTimeoutLike(error: unknown) {
  return /timed out|timeout|aborterror|aborted/i.test(`${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`);
}

function isLowerBetterMetric(name: string) {
  return /response|reply|resolution|time|duration|cost|expense|spend|burn|churn|complaint|defect|error|incident|issue|backlog|overdue|late|risk|downtime|waste/i.test(
    name
  );
}

function formatMetricValue(value: number | null, metricName = "") {
  if (value === null) return "not recorded";
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0
  });
  const formatted = formatter.format(value);

  if (/rate|percent|percentage|conversion|margin|satisfaction|completion|retention/i.test(metricName)) {
    return `${formatted}%`;
  }

  return formatted;
}

function statusForMetric(metricName: string, actual: number | null, target: number | null): KpiOverviewMetric["status"] {
  if (actual === null) return "missing_value";
  if (target === null) return "missing_target";

  const lowerBetter = isLowerBetterMetric(metricName);
  const onTrack = lowerBetter ? actual <= target : actual >= target;
  const nearTarget = lowerBetter ? actual <= target * 1.1 : actual >= target * 0.9;

  if (onTrack) return "on_track";
  if (nearTarget) return "near_target";
  return "needs_attention";
}

function trendForRows(metricName: string, rows: KpiRow[]): KpiOverviewMetric["trend"] {
  const values = rows.filter((row) => row.actual_value !== null);
  const latest = values[0]?.actual_value;
  const previous = values[1]?.actual_value;

  if (latest === null || latest === undefined || previous === null || previous === undefined) {
    return "not_enough_history";
  }

  const lowerBetter = isLowerBetterMetric(metricName);
  const rawDelta = lowerBetter ? previous - latest : latest - previous;
  const ratio = previous !== 0 ? rawDelta / Math.abs(previous) : rawDelta;

  if (Math.abs(ratio) < 0.03) return "steady";
  return ratio > 0 ? "improving" : "declining";
}

function freshnessForDate(metricDate: string): KpiOverviewMetric["freshness"] {
  const ageDays = daysSince(metricDate);
  if (ageDays <= 45) return "current";
  if (ageDays <= 120) return "stale";
  return "old";
}

function confidenceForSummary(summary: Omit<KpiOverviewSummary, "recommendationConfidence">): KpiOverviewSummary["recommendationConfidence"] {
  if (!summary.metricCount || !summary.totalRows) return "Insufficient";
  if (summary.totalRows < 2 || summary.metrics.every((metric) => metric.latestValue === null)) return "Low";
  if (summary.counts.stale > Math.max(1, Math.floor(summary.metricCount / 2))) return "Low";
  if (summary.counts.missingTargets >= Math.max(2, Math.ceil(summary.metricCount / 2))) return "Low";
  if (summary.totalRows >= 8 && summary.metricCount >= 3 && summary.counts.insufficientHistory < summary.metricCount) return "High";
  return "Medium";
}

export function classifyKpiOverviewIntent(prompt: string): KpiOverviewIntent {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();

  if (!normalized) {
    return { matched: false, requiresRetrieval: false, reason: "empty_prompt" };
  }

  const mentionsKpi = /\b(kpi|kpis|metric|metrics|performance|business performance)\b/.test(normalized);
  const mentionsMetricEvidence =
    mentionsKpi ||
    /\b(revenue|sales|conversion|margin|profit|cost|expense|leads|response time|reply time|satisfaction|retention|churn|backlog|complaints?)\b/.test(
      normalized
    );
  const asksForWhyOrEvidence =
    /\b(why|cause|caused|causing|changed|change|declined|declining|dropped|increased|decreased|supporting evidence|show me the evidence|prove|source|sources|forecast|predict|prediction|what happened)\b/.test(
      normalized
    );

  if (mentionsMetricEvidence && asksForWhyOrEvidence) {
    return { matched: false, requiresRetrieval: true, reason: "kpi_question_requires_evidence_or_cause_analysis" };
  }

  const asksForOverview =
    /\b(how|overview|summarize|summary|doing|attention|status|looking|current|health|snapshot|picture|weakest|worst|underperforming)\b/.test(normalized) ||
    /which kpis? need attention/.test(normalized);

  if (mentionsKpi && asksForOverview) {
    return { matched: true, requiresRetrieval: false, reason: "structured_kpi_overview" };
  }

  return { matched: false, requiresRetrieval: false, reason: "not_kpi_overview" };
}

export function buildKpiOverviewSummary(rows: KpiRow[], settings: KpiSettingRow[] = []): KpiOverviewSummary {
  const activeRows = rows.filter((row) => !row.deleted_at && !row.archived_at);
  const adjustedRows = sortKpiRowsBySettings(applyKpiSettingsToRows(activeRows, settings), settings) as KpiRow[];
  const groups = new Map<string, KpiRow[]>();

  for (const row of adjustedRows) {
    const name = row.name.trim();
    if (!name) continue;
    const existing = groups.get(name) || [];
    existing.push(row);
    groups.set(name, existing);
  }

  const metrics = Array.from(groups.entries())
    .map(([name, metricRows]) => {
      const rowsByDate = [...metricRows].sort((a, b) => `${b.metric_date}-${b.created_at}`.localeCompare(`${a.metric_date}-${a.created_at}`));
      const latest = rowsByDate[0];
      const metricDate = dateOnly(latest?.metric_date);
      const target = latest?.target ?? null;
      const latestValue = latest?.actual_value ?? null;
      const history = rowsByDate.slice(0, KPI_OVERVIEW_HISTORY_PER_METRIC).map((row) => ({
        metricDate: dateOnly(row.metric_date),
        actualValue: row.actual_value,
        target: row.target
      }));

      return {
        name,
        category: latest?.category ?? null,
        latestValue,
        target,
        status: statusForMetric(name, latestValue, target),
        trend: trendForRows(name, rowsByDate),
        reportingPeriod: metricDate || "Not dated",
        lastUpdated: dateOnly(latest?.updated_at) || metricDate || dateOnly(latest?.created_at) || "Not recorded",
        freshness: freshnessForDate(metricDate),
        historyCount: rowsByDate.length,
        history
      } satisfies KpiOverviewMetric;
    })
    .slice(0, KPI_OVERVIEW_MAX_METRICS);

  const counts = {
    onTrack: metrics.filter((metric) => metric.status === "on_track").length,
    nearTarget: metrics.filter((metric) => metric.status === "near_target").length,
    needsAttention: metrics.filter((metric) => metric.status === "needs_attention").length,
    missingTargets: metrics.filter((metric) => metric.status === "missing_target").length,
    missingValues: metrics.filter((metric) => metric.status === "missing_value").length,
    stale: metrics.filter((metric) => metric.freshness !== "current").length,
    insufficientHistory: metrics.filter((metric) => metric.trend === "not_enough_history").length
  };
  const limitations = [
    !metrics.length ? "No structured KPI records were found." : "",
    counts.missingTargets ? `${counts.missingTargets} KPI${counts.missingTargets === 1 ? "" : "s"} do not have targets.` : "",
    counts.insufficientHistory ? `${counts.insufficientHistory} KPI${counts.insufficientHistory === 1 ? "" : "s"} need more dated history for trend confidence.` : "",
    counts.stale ? `${counts.stale} KPI${counts.stale === 1 ? " has" : "s have"} stale or old reporting periods.` : ""
  ].filter(Boolean);
  const evidenceUsed = [
    metrics.length ? `Structured KPI records: ${activeRows.length}` : "",
    metrics.length ? `Current KPI names reviewed: ${metrics.length}` : "",
    ...metrics.slice(0, 6).map((metric) => {
      const target = metric.target === null ? "no target" : `target ${formatMetricValue(metric.target, metric.name)}`;
      return `${metric.name}: ${formatMetricValue(metric.latestValue, metric.name)} vs ${target}; ${metric.status.replace(/_/g, " ")}; ${metric.trend.replace(/_/g, " ")}; ${metric.reportingPeriod}`;
    })
  ].filter(Boolean);
  const partialSummary = {
    totalRows: activeRows.length,
    metricCount: metrics.length,
    metrics,
    counts,
    limitations,
    evidenceUsed
  };

  return {
    ...partialSummary,
    recommendationConfidence: confidenceForSummary(partialSummary)
  };
}

export async function loadKpiOverviewData({
  supabase,
  workspaceId
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
}): Promise<KpiOverviewDataLoad> {
  const queryStartedAt = Date.now();
  const [kpiResult, settingsResult] = await Promise.all([
    supabase
      .from("kpis")
      .select(KPI_OVERVIEW_ROW_SELECT)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("metric_date", { ascending: false })
      .limit(KPI_OVERVIEW_MAX_ROWS),
    supabase
      .from("kpi_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("sort_order", { ascending: true })
      .order("weight", { ascending: false })
  ]);
  const queryMs = Date.now() - queryStartedAt;

  if (kpiResult.error) {
    throw new Error(kpiResult.error.message || "Vaeroex could not load KPI records.");
  }

  if (settingsResult.error) {
    throw new Error(settingsResult.error.message || "Vaeroex could not load KPI settings.");
  }

  const rows = (kpiResult.data || []) as KpiRow[];
  const settings = (settingsResult.data || []) as KpiSettingRow[];

  return {
    rows,
    settings,
    summary: buildKpiOverviewSummary(rows, settings),
    queryMs
  };
}

function metricNames(metrics: KpiOverviewMetric[]) {
  return metrics.map((metric) => metric.name).filter(Boolean);
}

function compactMetricList(metrics: KpiOverviewMetric[], fallback = "none") {
  const names = metricNames(metrics);
  if (!names.length) return fallback;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function buildDeterministicKpiOverviewOutput(
  summary: KpiOverviewSummary,
  options: { fallbackReason?: string | null } = {}
) {
  const attentionMetrics = summary.metrics.filter((metric) => metric.status === "needs_attention" || metric.status === "missing_value");
  const positiveMetrics = summary.metrics.filter((metric) => metric.status === "on_track" || metric.status === "near_target");
  const trendGaps = summary.metrics.filter((metric) => metric.trend === "not_enough_history");
  const fallbackPrefix = options.fallbackReason
    ? "I found your current KPI results, but the deeper analysis took longer than expected. "
    : "";
  let directAnswer = "";

  if (!summary.metricCount) {
    directAnswer = "I do not see KPI records yet, so I cannot assess performance from structured metrics.";
  } else if (attentionMetrics.length && positiveMetrics.length) {
    directAnswer = `Your KPIs are mixed: ${positiveMetrics.length} look on or near target, and ${attentionMetrics.length} need attention, led by ${compactMetricList(attentionMetrics.slice(0, 3))}.`;
  } else if (attentionMetrics.length) {
    directAnswer = `The KPI picture needs attention: ${attentionMetrics.length} visible metric${attentionMetrics.length === 1 ? "" : "s"} are below target or missing usable values.`;
  } else if (summary.counts.missingTargets) {
    directAnswer = `Your KPI values are visible, but missing targets make the performance read directional rather than definitive.`;
  } else {
    directAnswer = `Your KPIs look stable overall: ${positiveMetrics.length || summary.metricCount} visible metric${(positiveMetrics.length || summary.metricCount) === 1 ? "" : "s"} are on or near target.`;
  }

  const uncertainty = [
    trendGaps.length ? `${trendGaps.length} KPI${trendGaps.length === 1 ? " has" : "s have"} limited history.` : "",
    summary.counts.stale ? `${summary.counts.stale} KPI${summary.counts.stale === 1 ? " is" : "s are"} stale.` : "",
    summary.counts.missingTargets ? `${summary.counts.missingTargets} KPI${summary.counts.missingTargets === 1 ? " is" : "s are"} missing targets.` : ""
  ].filter(Boolean);
  const nextReview = attentionMetrics[0]
    ? `Leadership should look first at ${attentionMetrics[0].name} and confirm whether the target, latest value, and reporting period still reflect the business reality.`
    : summary.counts.missingTargets
      ? "Leadership should confirm targets for the visible KPIs before treating the performance read as definitive."
      : "Leadership should keep adding dated KPI values so trend confidence continues improving.";
  const responseMarkdown = [
    `${fallbackPrefix}${directAnswer}`,
    positiveMetrics.length ? `What is going well: ${compactMetricList(positiveMetrics.slice(0, 3))}.` : "",
    attentionMetrics.length ? `What needs attention: ${compactMetricList(attentionMetrics.slice(0, 3))}.` : "",
    uncertainty.length ? `What is uncertain: ${uncertainty.join(" ")}` : "",
    nextReview
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    title: "KPI overview",
    direct_answer: `${fallbackPrefix}${directAnswer}`,
    summary: directAnswer,
    response_markdown: responseMarkdown,
    recommendation_confidence: summary.recommendationConfidence,
    evidence_note: "This overview used structured KPI records only. Vaeroex did not run broad Business Memory or document retrieval for this question.",
    evidence_used: summary.evidenceUsed,
    supporting_evidence: summary.evidenceUsed,
    limitations: summary.limitations,
    data_gaps: summary.limitations,
    kpi_overview: {
      metrics: summary.metrics,
      counts: summary.counts,
      total_rows: summary.totalRows
    },
    workflow_path: "lightweight_kpi_overview",
    fallback_used: Boolean(options.fallbackReason),
    fallback_reason: options.fallbackReason || null
  } satisfies Json;
}

function compactPromptContext(summary: KpiOverviewSummary) {
  return {
    metric_count: summary.metricCount,
    total_rows: summary.totalRows,
    counts: summary.counts,
    limitations: summary.limitations,
    kpis: summary.metrics.map((metric) => ({
      name: metric.name,
      latest_value: metric.latestValue,
      target: metric.target,
      status: metric.status,
      trend: metric.trend,
      reporting_period: metric.reportingPeriod,
      freshness: metric.freshness,
      history_count: metric.historyCount,
      recent_values: metric.history
    }))
  };
}

function parseOpenAIJson(content: string) {
  try {
    return JSON.parse(content) as JsonRecord;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]) as JsonRecord;
    } catch {
      return null;
    }
  }
}

function extractResponsesContent(payload: JsonRecord) {
  const outputText = str(payload.output_text);
  if (outputText) return outputText;

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = isRecord(item) && Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
        return part.text;
      }
    }
  }

  return "";
}

function normalizeModelOutput(value: JsonRecord | null, fallback: Json) {
  const fallbackRecord = isRecord(fallback) ? fallback : {};
  const confidence = str(value?.recommendation_confidence);
  const fallbackConfidence = str(fallbackRecord.recommendation_confidence, "Low");
  const confidenceRank: Record<string, number> = { Insufficient: 0, Low: 1, Medium: 2, High: 3 };
  const modelConfidence = ["High", "Medium", "Low", "Insufficient"].includes(confidence) ? confidence : fallbackConfidence;
  const normalizedConfidence =
    (confidenceRank[modelConfidence] ?? 1) > (confidenceRank[fallbackConfidence] ?? 1) ? fallbackConfidence : modelConfidence;
  const directAnswer = str(value?.direct_answer) || str(fallbackRecord.direct_answer);
  const responseMarkdown = str(value?.response_markdown) || str(value?.answer) || str(fallbackRecord.response_markdown) || directAnswer;
  const evidenceNote = str(value?.evidence_note) || str(fallbackRecord.evidence_note);

  return {
    ...fallbackRecord,
    title: str(value?.title, str(fallbackRecord.title, "KPI overview")),
    direct_answer: directAnswer,
    summary: str(value?.summary, directAnswer),
    response_markdown: responseMarkdown,
    recommendation_confidence: normalizedConfidence,
    evidence_note: evidenceNote
  } satisfies Json;
}

async function runCompactOpenAIKpiAnswer({
  supabase,
  workspaceId,
  userPrompt,
  summary,
  openAISettings
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userPrompt: string;
  summary: KpiOverviewSummary;
  openAISettings?: OpenAIRetrySettings;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const requestBody = {
    model,
    temperature: 0.15,
    text: { format: { type: "json_object" } },
    input: [
      {
        role: "system",
        content:
          "You are Vaeroex, an Operations Intelligence advisor. Answer KPI overview questions directly and conversationally. Use only the provided structured KPI context. Do not invent numbers. Do not recommend task management, owner assignment, CRM work, or workflow execution. Return JSON only with title, direct_answer, summary, response_markdown, recommendation_confidence, and evidence_note."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            user_question: userPrompt,
            kpi_context: compactPromptContext(summary),
            answer_rules: [
              "First sentence directly answers the question.",
              "Briefly mention what is going well, what needs attention, and what is uncertain only when supported by KPI context.",
              "Do not estimate financial impact.",
              "Keep the answer short.",
              "Use Recommendation Confidence: High, Medium, Low, or Insufficient."
            ]
          },
          null,
          2
        )
      }
    ]
  };
  const requestBodyJson = JSON.stringify(requestBody);
  const estimatedRequestTokens = estimateTokenCount(requestBodyJson);
  await assertWorkspaceTokenBudget({ supabase, workspaceId, estimatedRequestTokens });
  const settings = {
    ...getOpenAIRetrySettings(),
    ...openAISettings,
    timeoutMs: Math.min(openAISettings?.timeoutMs ?? getOpenAIRetrySettings().timeoutMs, KPI_OVERVIEW_OPENAI_TIMEOUT_MS),
    maxRetries: 0
  };
  const startedAt = Date.now();
  const response = await fetchWithOpenAIResilience(
    OPENAI_RESPONSES_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: requestBodyJson
    },
    settings
  );
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(cleanVaeroexErrorMessage(str(isRecord(payload.error) ? payload.error.message : ""), "Vaeroex KPI analysis took longer than expected."));
  }

  const content = extractResponsesContent(payload);
  if (!content) {
    throw new Error("Vaeroex returned an empty KPI overview.");
  }

  const inputTokens = numberValue(isRecord(payload.usage) ? payload.usage.input_tokens : null) || estimatedRequestTokens;
  const outputTokens = numberValue(isRecord(payload.usage) ? payload.usage.output_tokens : null) || estimateTokenCount(content);
  const totalTokens = numberValue(isRecord(payload.usage) ? payload.usage.total_tokens : null) || inputTokens + outputTokens;

  return {
    output: parseOpenAIJson(content),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      requestId: response.headers.get("x-request-id") || response.headers.get("openai-request-id"),
      latencyMs,
      status: "completed",
      metadata: {
        workflow_path: "lightweight_kpi_overview",
        estimated_request_tokens: estimatedRequestTokens,
        request_body_bytes: Buffer.byteLength(requestBodyJson, "utf8")
      } satisfies Json
    } satisfies VaeroexTokenUsage,
    estimatedRequestTokens
  };
}

export async function runLightweightKpiOverview({
  supabase,
  workspaceId,
  userPrompt,
  intentClassificationMs,
  openAISettings,
  stageLogger
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  userPrompt: string;
  intentClassificationMs: number;
  openAISettings?: OpenAIRetrySettings;
  stageLogger?: StageLogger;
}) {
  const startedAt = Date.now();
  const diagnostics: KpiOverviewDiagnostics = {
    workflow_path: "lightweight_kpi_overview",
    intent_classification_ms: intentClassificationMs,
    kpi_query_ms: 0,
    retrieval_ms: 0,
    prompt_construction_ms: 0,
    openai_ms: 0,
    total_ms: 0,
    estimated_context_tokens: 0,
    kpi_rows_loaded: 0,
    kpi_rows_included: 0,
    metrics_included: 0,
    openai_attempted: false,
    openai_timed_out: false,
    fallback_used: false,
    fallback_reason: null
  };

  stageLogger?.("kpi_query_started");
  const overviewData = await loadKpiOverviewData({ supabase, workspaceId });
  diagnostics.kpi_query_ms = overviewData.queryMs;

  const promptStartedAt = Date.now();
  const { rows, summary } = overviewData;
  const promptContext = compactPromptContext(summary);
  diagnostics.prompt_construction_ms = Date.now() - promptStartedAt;
  diagnostics.kpi_rows_loaded = rows.length;
  diagnostics.kpi_rows_included = summary.totalRows;
  diagnostics.metrics_included = summary.metricCount;
  diagnostics.estimated_context_tokens = estimateTokenCount(JSON.stringify(promptContext));
  stageLogger?.("kpi_query_finished", {
    durationMs: diagnostics.kpi_query_ms,
    kpiRows: rows.length,
    metrics: summary.metricCount,
    estimatedContextTokens: diagnostics.estimated_context_tokens
  });

  const fallbackOutput = buildDeterministicKpiOverviewOutput(summary);
  let outputJson: Json = fallbackOutput;
  let usage: VaeroexTokenUsage | null = null;

  if (summary.metricCount) {
    diagnostics.openai_attempted = true;
    stageLogger?.("kpi_openai_started", {
      estimatedContextTokens: diagnostics.estimated_context_tokens
    });
    const openAIStartedAt = Date.now();

    try {
      const modelResult = await runCompactOpenAIKpiAnswer({
        supabase,
        workspaceId,
        userPrompt,
        summary,
        openAISettings
      });
      diagnostics.openai_ms = Date.now() - openAIStartedAt;
      outputJson = normalizeModelOutput(modelResult.output, fallbackOutput);
      usage = modelResult.usage;
      stageLogger?.("kpi_openai_finished", {
        durationMs: diagnostics.openai_ms,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens
      });
    } catch (error) {
      diagnostics.openai_ms = Date.now() - openAIStartedAt;
      diagnostics.fallback_used = true;
      diagnostics.openai_timed_out = isTimeoutLike(error);
      diagnostics.fallback_reason = diagnostics.openai_timed_out ? "openai_timeout" : "openai_unavailable";
      outputJson = buildDeterministicKpiOverviewOutput(summary, {
        fallbackReason: diagnostics.openai_timed_out ? "OpenAI timeout" : "OpenAI unavailable"
      });
      stageLogger?.("kpi_openai_fallback", {
        durationMs: diagnostics.openai_ms,
        timeout: diagnostics.openai_timed_out,
        message: cleanVaeroexErrorMessage(error instanceof Error ? error.message : undefined, "KPI overview fallback used.")
      });
    }
  } else {
    diagnostics.fallback_used = true;
    diagnostics.fallback_reason = "no_kpi_records";
  }

  diagnostics.total_ms = Date.now() - startedAt;

  return {
    outputJson,
    usage,
    summary,
    diagnostics,
    workspaceSnapshot: {
      metrics: {
        kpi_history_records: summary.totalRows,
        current_kpis: summary.metricCount,
        reports: 0,
        uploaded_files: 0,
        open_issues: 0,
        open_tasks: 0
      },
      kpi_overview: promptContext,
      kpi_history: summary.metrics.map((metric) => ({
        name: metric.name,
        actual_value: metric.latestValue,
        target: metric.target,
        metric_date: metric.reportingPeriod,
        status: metric.status,
        trend: metric.trend
      }))
    } satisfies Json,
    extraInputs: {
      lightweight_kpi_overview: true,
      workspace_knowledge_scope: "structured_kpis_only",
      retrieval_used: false,
      evidence_scope_note: "Workspace Knowledge and Retrieved Evidence are intentionally distinct. This answer used structured KPI records only.",
      kpi_overview_context: promptContext,
      kpi_overview_diagnostics: diagnostics
    } satisfies Json
  };
}
