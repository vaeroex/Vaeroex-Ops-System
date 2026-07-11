import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { loadKpiOverviewData } from "@/lib/ai/kpi-overview";
import type { VaeroexEvidenceDomain, VaeroexQueryPlan } from "@/lib/ai/query-depth-planner";
import { estimateTokenCount } from "@/lib/ai/usage";
import {
  filterBusinessEvidence,
  isBusinessEvidenceEligible,
  sanitizeBusinessEvidenceText
} from "@/lib/intelligence/evidence-eligibility";
import type { Database, Json } from "@/lib/supabase/types";

type JsonRecord = { [key: string]: Json | undefined };

export type FocusedContextInput = {
  contextType: string;
  contextId?: string | null;
  sourceTitle?: string;
  sourceSummary?: string;
  evidence?: string[];
};

export type FocusedExplanationContext = {
  workspaceSnapshot: Json;
  evidenceQuery: string;
  directEvidence: string[];
  verifiedRecordCount: number;
  limitations: string[];
  estimatedContextTokens: number;
  loadMs: number;
};

export type BoundedWorkspaceContext = {
  workspaceSnapshot: Json;
  evidenceQuery: string;
  loadedDomains: VaeroexEvidenceDomain[];
  structuredEvidenceCount: number;
  limitations: string[];
  estimatedContextTokens: number;
  loadMs: number;
};

function compactText(value: string | null | undefined, max = 900) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function compactEvidence(values: string[] = [], limit = 8) {
  return values.map((value) => sanitizeBusinessEvidenceText(compactText(value, 500))).filter(Boolean).slice(0, limit);
}

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function confidenceFromEvidence(count: number) {
  if (count >= 4) return "High";
  if (count >= 2) return "Medium";
  if (count >= 1) return "Low";
  return "Insufficient";
}

function safeJsonStringify(value: Json) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

async function safeRows<T>(
  label: string,
  request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  limitations: string[]
) {
  const { data, error } = await request;

  if (error) {
    limitations.push(`${label} could not be loaded for this answer.`);
    return [];
  }

  return data || [];
}

export function buildDeterministicFocusedExplanation({
  sourceTitle,
  sourceSummary,
  evidence,
  verifiedRecordCount,
  limitations = [],
  failureReason
}: {
  sourceTitle: string;
  sourceSummary: string;
  evidence: string[];
  verifiedRecordCount: number;
  limitations?: string[];
  failureReason?: string;
}) {
  const directEvidence = compactEvidence(evidence, 4);
  const directExplanation = sanitizeBusinessEvidenceText(compactText(sourceSummary, 700)) || `${sourceTitle || "This item"} does not yet include enough detail for a reliable explanation.`;
  const whyItMatters = directEvidence[0] && directEvidence[0] !== directExplanation ? directEvidence[0] : "";
  const evidenceLines = directEvidence.length
    ? directEvidence
    : verifiedRecordCount
      ? [`${verifiedRecordCount} workspace record${verifiedRecordCount === 1 ? "" : "s"} supported this explanation.`]
      : [];
  const meaningfulLimitations = [
    ...(failureReason ? [failureReason] : []),
    ...limitations,
    ...(!evidenceLines.length ? ["There is not enough source-backed detail to explain this item further without guessing."] : [])
  ].filter(Boolean);
  const confidence = confidenceFromEvidence(verifiedRecordCount + directEvidence.length);

  return {
    title: sourceTitle || "Vaeroex explanation",
    direct_explanation: directExplanation,
    why_it_matters: whyItMatters,
    evidence: evidenceLines,
    limitations: meaningfulLimitations,
    recommendation_confidence: confidence,
    response_markdown: [directExplanation, whyItMatters, evidenceLines[0], meaningfulLimitations[0]].filter(Boolean).join("\n\n")
  } satisfies Json;
}

export async function buildFocusedExplanationContext({
  supabase,
  workspaceId,
  input
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  input: FocusedContextInput;
}): Promise<FocusedExplanationContext> {
  const startedAt = Date.now();
  const contextType = input.contextType.toLowerCase();
  const directEvidence = compactEvidence(input.evidence);
  const verifiedRecords: JsonRecord[] = [];
  const limitations: string[] = [];
  const contextId = input.contextId || "";

  if (isUuid(contextId) && contextType.includes("kpi")) {
    const { data, error } = await supabase
      .from("kpis")
      .select("id,name,category,target,actual_value,metric_date,source,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) limitations.push("The selected KPI record could not be verified.");
    if (data) {
      const [{ data: history }, { data: settings }] = await Promise.all([
        supabase
          .from("kpis")
          .select("id,name,target,actual_value,metric_date,source,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("name", data.name)
          .is("deleted_at", null)
          .order("metric_date", { ascending: false })
          .limit(6),
        supabase
          .from("kpi_settings")
          .select("kpi_name,target,weight,definition,is_visible,unit_type,display_unit")
          .eq("workspace_id", workspaceId)
          .eq("kpi_name", data.name)
          .limit(1)
      ]);
      verifiedRecords.push({ selected_kpi: data, recent_history: history || [], settings: settings || [] });
    }
  } else if (isUuid(contextId) && (contextType.includes("briefing") || contextType.includes("report"))) {
    const { data, error } = await supabase
      .from("reports")
      .select("id,title,report_type,date_range_start,date_range_end,body_markdown,source_data_json,created_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();

    if (error) limitations.push("The selected briefing or report could not be verified.");
    if (data && isBusinessEvidenceEligible(data)) verifiedRecords.push({ ...data, body_markdown: compactText(data.body_markdown, 1_500) });
  } else if (isUuid(contextId) && contextType.includes("file_analysis")) {
    const { data, error } = await supabase
      .from("ai_agent_runs")
      .select("id,agent_type,input_json,output_json,status,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();

    if (error) limitations.push("The selected file analysis could not be verified.");
    if (data && isBusinessEvidenceEligible(data, { sourceKind: "platform_run" })) {
      verifiedRecords.push({ ...data, output_json: jsonRecord(data.output_json) });
    } else if (data) {
      limitations.push("That analysis did not produce active business evidence, so Vaeroex left its platform diagnostics out.");
    }
  } else if (isUuid(contextId) && (contextType === "file" || contextType.includes("source"))) {
    const { data, error } = await supabase
      .from("file_uploads")
      .select("id,display_name,file_extension,analysis_summary,processing_status,index_status,indexed_chunk_count,processed_at,indexed_at,updated_at,metadata_json,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();

    if (error) limitations.push("The selected source file could not be verified.");
    if (data && isBusinessEvidenceEligible(data)) verifiedRecords.push(data);
  } else if (isUuid(contextId) && (contextType.includes("memory") || contextType.includes("knowledge"))) {
    const { data, error } = await supabase
      .from("business_memory_chunks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();

    if (error) limitations.push("The selected Learned Knowledge record could not be verified.");
    if (data) {
      const [eligibleMemory] = await filterEligibleMemoryRowsByLifecycle({ supabase, workspaceId, rows: [data] });
      if (eligibleMemory) {
        verifiedRecords.push({ ...eligibleMemory, source_excerpt: compactText(eligibleMemory.source_excerpt, 1_200) });
      } else {
        limitations.push("That Learned Knowledge record is inactive or its source lineage is no longer eligible.");
      }
    }
  } else if (isUuid(contextId) && (contextType.includes("risk") || contextType.includes("opportunity") || contextType.includes("intelligence"))) {
    const [{ data: issue }, { data: recommendation }] = await Promise.all([
      supabase
        .from("issues")
        .select("id,title,description,issue_type,severity,status,root_cause,recommended_fix,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", contextId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("vaeroex_recommendation_outcomes")
        .select("id,title,source_type,source_id,source_title,evidence,related_module,related_kpi,expected_outcome,priority,status,outcome_summary,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .eq("id", contextId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle()
    ]);

    if (issue) verifiedRecords.push(issue);
    if (recommendation) verifiedRecords.push(recommendation);
  }

  const workspaceSnapshot = {
    scope: "focused_explanation",
    selected_context: {
      context_type: input.contextType,
      context_id: input.contextId || null,
      source_title: compactText(input.sourceTitle, 180),
      source_summary: sanitizeBusinessEvidenceText(compactText(input.sourceSummary, 1_200)),
      page_evidence: directEvidence
    },
    verified_workspace_records: verifiedRecords,
    scope_policy: {
      selected_item_only: true,
      unrelated_workspace_records_excluded: true,
      no_full_workspace_snapshot: true,
      page_context_is_untrusted_until_supported: true
    }
  } satisfies Json;
  const serialized = safeJsonStringify(workspaceSnapshot);

  return {
    workspaceSnapshot,
    evidenceQuery: [input.sourceTitle, input.sourceSummary, ...directEvidence].filter(Boolean).join("\n").slice(0, 4_000),
    directEvidence,
    verifiedRecordCount: verifiedRecords.length,
    limitations,
    estimatedContextTokens: estimateTokenCount(serialized),
    loadMs: Date.now() - startedAt
  };
}

export async function buildBoundedWorkspaceContext({
  supabase,
  workspaceId,
  query,
  plan
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  query: string;
  plan: VaeroexQueryPlan;
}): Promise<BoundedWorkspaceContext> {
  const startedAt = Date.now();
  const limitations: string[] = [];
  const domainSet = new Set(plan.domains);
  const context: JsonRecord = {};
  const loadedDomains: VaeroexEvidenceDomain[] = [];
  let structuredEvidenceCount = 0;

  if (domainSet.has("kpis") || domainSet.has("financials") || domainSet.has("business_health")) {
    try {
      const kpiData = await loadKpiOverviewData({ supabase, workspaceId });
      context.kpi_summary = kpiData.summary;
      structuredEvidenceCount += kpiData.summary.metrics.length;
      loadedDomains.push("kpis");
    } catch {
      limitations.push("KPI context could not be loaded for this answer.");
    }
  }

  const loaders: Array<Promise<void>> = [];

  if (domainSet.has("business_health")) {
    loaders.push(
      safeRows(
        "Business Health history",
        supabase
          .from("business_health_snapshots")
          .select("id,snapshot_date,score,status,trend,data_confidence,data_quality_score,memory_signal_count,source_summary")
          .eq("workspace_id", workspaceId)
          .order("snapshot_date", { ascending: false })
          .limit(12),
        limitations
      ).then((rows) => {
        const eligibleRows = filterBusinessEvidence(rows);
        context.business_health = eligibleRows;
        structuredEvidenceCount += eligibleRows.length;
        loadedDomains.push("business_health");
      })
    );
  }

  if (domainSet.has("risks") || domainSet.has("priorities") || domainSet.has("decisions")) {
    loaders.push(
      Promise.all([
        safeRows(
          "Risk records",
          supabase
            .from("issues")
            .select("id,title,description,issue_type,severity,status,root_cause,created_at,updated_at")
            .eq("workspace_id", workspaceId)
            .order("updated_at", { ascending: false })
            .limit(8),
          limitations
        ),
        safeRows(
          "Recommendation records",
          supabase
            .from("vaeroex_recommendation_outcomes")
            .select("id,title,source_type,source_id,source_title,evidence,related_module,related_kpi,expected_outcome,priority,status,outcome_summary,created_at,updated_at")
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null)
            .is("archived_at", null)
            .order("updated_at", { ascending: false })
            .limit(8),
          limitations
        )
      ]).then(([issues, recommendations]) => {
        context.risk_and_priority_evidence = { issues, recommendations };
        structuredEvidenceCount += issues.length + recommendations.length;
        if (domainSet.has("risks")) loadedDomains.push("risks");
        if (domainSet.has("priorities")) loadedDomains.push("priorities");
        if (domainSet.has("decisions")) loadedDomains.push("decisions");
      })
    );
  }

  if (domainSet.has("reports")) {
    loaders.push(
      safeRows(
        "Briefings and reports",
        supabase
          .from("reports")
          .select("id,title,report_type,date_range_start,date_range_end,body_markdown,source_data_json,created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(6),
        limitations
      ).then((rows) => {
        const eligibleRows = filterBusinessEvidence(rows);
        context.reports = eligibleRows.map((row) => ({ ...row, body_markdown: compactText(row.body_markdown, 1_000) }));
        structuredEvidenceCount += eligibleRows.length;
        loadedDomains.push("reports");
      })
    );
  }

  if (domainSet.has("files") || domainSet.has("data_quality")) {
    loaders.push(
      safeRows(
        "Source files",
        supabase
          .from("file_uploads")
          .select("id,display_name,file_extension,analysis_summary,processing_status,index_status,indexed_chunk_count,processed_at,indexed_at,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        const eligibleRows = filterBusinessEvidence(rows);
        context.sources = eligibleRows.map((row) => ({
          ...row,
          analysis_summary: sanitizeBusinessEvidenceText(row.analysis_summary) || null
        }));
        structuredEvidenceCount += eligibleRows.length;
        if (domainSet.has("files")) loadedDomains.push("files");
        if (domainSet.has("data_quality")) loadedDomains.push("data_quality");
      })
    );
  }

  if (domainSet.has("business_signals") || domainSet.has("operations")) {
    loaders.push(
      safeRows(
        "Business Signals",
        supabase
          .from("tasks")
          .select("id,title,description,category,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        context.business_signals = rows;
        structuredEvidenceCount += rows.length;
        if (domainSet.has("business_signals")) loadedDomains.push("business_signals");
        if (domainSet.has("operations")) loadedDomains.push("operations");
      })
    );
  }

  if (domainSet.has("financials") || domainSet.has("operations")) {
    loaders.push(
      safeRows(
        "Operational metrics",
        supabase
          .from("operational_metrics")
          .select("id,metric_name,category,value,metric_date,notes,source_file_id,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("metric_date", { ascending: false })
          .limit(12),
        limitations
      ).then((rows) => {
        context.operational_metrics = rows;
        structuredEvidenceCount += rows.length;
        if (domainSet.has("financials")) loadedDomains.push("financials");
        if (domainSet.has("operations")) loadedDomains.push("operations");
      })
    );
  }

  if (domainSet.has("customers")) {
    loaders.push(
      safeRows(
        "Historical customer activity",
        supabase
          .from("crm_leads")
          .select("id,status,last_activity_at,source_file_id,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        context.historical_customer_activity = rows;
        structuredEvidenceCount += rows.length;
        loadedDomains.push("customers");
      })
    );
  }

  if (domainSet.has("people")) {
    loaders.push(
      safeRows(
        "People context",
        supabase
          .from("people")
          .select("id,role_title,department,status,start_date,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        context.people_context = rows;
        structuredEvidenceCount += rows.length;
        loadedDomains.push("people");
      })
    );
  }

  if (domainSet.has("compliance")) {
    loaders.push(
      safeRows(
        "Process and policy context",
        supabase
          .from("sops")
          .select("id,title,department,category,status,version,updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        context.process_and_policy_context = rows;
        structuredEvidenceCount += rows.length;
        loadedDomains.push("compliance");
      })
    );
  }

  await Promise.all(loaders);

  const workspaceSnapshot = {
    scope: "bounded_cross_business_reasoning",
    query,
    requested_domains: plan.domains,
    loaded_domains: Array.from(new Set(loadedDomains)),
    structured_context: context,
    scope_policy: {
      full_workspace_snapshot_excluded: true,
      unrelated_domains_excluded: true,
      maximum_evidence_chunks: plan.maxEvidenceChunks,
      context_token_budget: plan.contextTokenBudget
    }
  } satisfies Json;
  const serialized = safeJsonStringify(workspaceSnapshot);
  const estimatedContextTokens = estimateTokenCount(serialized);

  if (estimatedContextTokens > plan.contextTokenBudget) {
    limitations.push("Some lower-priority context was omitted to stay within the answer budget.");
  }

  return {
    workspaceSnapshot,
    evidenceQuery: query.slice(0, 4_000),
    loadedDomains: Array.from(new Set(loadedDomains)),
    structuredEvidenceCount,
    limitations,
    estimatedContextTokens,
    loadMs: Date.now() - startedAt
  };
}

export function buildDeterministicBoundedAnswer({
  query,
  context,
  failureReason
}: {
  query: string;
  context: BoundedWorkspaceContext;
  failureReason?: string;
}) {
  const snapshot = jsonRecord(context.workspaceSnapshot);
  const structured = jsonRecord(snapshot.structured_context);
  const kpiSummary = jsonRecord(structured.kpi_summary);
  const riskContext = jsonRecord(structured.risk_and_priority_evidence);
  const issues = Array.isArray(riskContext.issues) ? riskContext.issues : [];
  const recommendations = Array.isArray(riskContext.recommendations) ? riskContext.recommendations : [];
  const healthRows = Array.isArray(structured.business_health) ? structured.business_health : [];
  const reports = Array.isArray(structured.reports) ? structured.reports : [];
  const sources = Array.isArray(structured.sources) ? structured.sources : [];
  const signals = Array.isArray(structured.business_signals) ? structured.business_signals : [];
  const firstIssue = jsonRecord(issues[0]);
  const firstRecommendation = jsonRecord(recommendations[0]);
  const latestHealth = jsonRecord(healthRows[0]);
  const firstReport = jsonRecord(reports[0]);
  const firstSource = jsonRecord(sources[0]);
  const firstSignal = jsonRecord(signals[0]);
  const metrics = Array.isArray(kpiSummary.metrics) ? kpiSummary.metrics : [];
  const firstMetric = jsonRecord(metrics[0]);
  const observations = [
    typeof latestHealth.score === "number" ? `Business Health is ${latestHealth.score} out of 100${typeof latestHealth.trend === "string" ? ` with a ${latestHealth.trend.toLowerCase()} trend` : ""}.` : "",
    typeof firstIssue.title === "string" ? `The clearest current risk record is ${firstIssue.title}.` : "",
    typeof firstRecommendation.title === "string" ? `The leading saved recommendation is ${firstRecommendation.title}.` : "",
    typeof firstMetric.name === "string" ? `${firstMetric.name} is the first relevant KPI in the bounded summary.` : ""
  ].filter(Boolean);
  const asksCount = /\b(how many|count|counts)\b/i.test(query);
  const countAnswer = asksCount
    ? [
        reports.length ? `${reports.length} recent report${reports.length === 1 ? "" : "s"}` : "",
        sources.length ? `${sources.length} active source file${sources.length === 1 ? "" : "s"}` : "",
        issues.length ? `${issues.length} current risk record${issues.length === 1 ? "" : "s"}` : "",
        signals.length ? `${signals.length} recent Business Signal${signals.length === 1 ? "" : "s"}` : "",
        Array.isArray(kpiSummary.metrics) && kpiSummary.metrics.length ? `${kpiSummary.metrics.length} current KPI${kpiSummary.metrics.length === 1 ? "" : "s"}` : ""
      ].filter(Boolean).join(", ")
    : "";
  const targetedObservation =
    /\b(report|briefing)\b/i.test(query) && typeof firstReport.title === "string"
      ? `The latest relevant report is ${firstReport.title}.`
      : /\b(file|source|document|upload)\b/i.test(query) && typeof firstSource.display_name === "string"
        ? `The latest relevant source is ${firstSource.display_name}.`
        : /\b(alert|risk|issue)\b/i.test(query) && typeof firstIssue.title === "string"
          ? `${firstIssue.title} is the clearest current risk record in this bounded view.`
          : /\b(priority|recommendation)\b/i.test(query) && typeof firstRecommendation.title === "string"
            ? `${firstRecommendation.title} is the leading current recommendation in this bounded view.`
            : /\b(signal|observation|event)\b/i.test(query) && typeof firstSignal.title === "string"
              ? `${firstSignal.title} is the latest relevant Business Signal in this bounded view.`
              : "";
  const directAnswer = countAnswer
    ? `This bounded view found ${countAnswer}.`
    : targetedObservation || (observations.length
        ? observations.slice(0, 2).join(" ")
        : "Vaeroex did not find enough bounded workspace evidence to answer this question without guessing.");
  const limitations = [
    ...(failureReason ? [failureReason] : []),
    ...context.limitations,
    ...(observations.length ? ["This is a shorter bounded answer; deeper causal analysis was not completed."] : ["Add or identify evidence directly related to this question."])
  ];

  return {
    title: "Vaeroex answer",
    direct_answer: directAnswer,
    summary: directAnswer,
    response_markdown: directAnswer,
    evidence_note: `${context.structuredEvidenceCount} bounded workspace record${context.structuredEvidenceCount === 1 ? "" : "s"} were considered across ${context.loadedDomains.join(", ") || "the requested scope"}.`,
    recommendation_confidence: confidenceFromEvidence(context.structuredEvidenceCount),
    limitations,
    fallback_used: true,
    fallback_question: query
  } satisfies Json;
}
