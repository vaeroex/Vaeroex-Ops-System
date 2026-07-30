import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBusinessHealthDecisionContext } from "@/lib/ai/business-health-context";
import { buildKpiOverviewSummary, loadKpiOverviewData, type KpiOverviewSummary } from "@/lib/ai/kpi-overview";
import type { VaeroexEvidenceDomain, VaeroexQueryPlan } from "@/lib/ai/query-depth-planner";
import { estimateTokenCount } from "@/lib/ai/usage";
import type { WorkflowStageLogger } from "@/lib/ai/workflow-timing";
import {
  filterBusinessEvidence,
  filterOriginalBusinessEvidence,
  isOriginalBusinessEvidence,
  sanitizeBusinessEvidenceText
} from "@/lib/intelligence/evidence-eligibility";
import { filterBySourceParentEligibility, loadSourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";
import type { Database, Json } from "@/lib/supabase/types";

type JsonRecord = { [key: string]: Json | undefined };

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

async function timedContextStage<T>(stage: string, logger: WorkflowStageLogger | undefined, task: () => Promise<T>) {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    logger?.(stage, Date.now() - startedAt);
  }
}

async function sourceEligibleRows<T extends { source_file_id?: string | null; import_id?: string | null }>({
  supabase,
  workspaceId,
  rows,
  label,
  limitations
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  rows: T[];
  label: string;
  limitations: string[];
}) {
  try {
    const eligibility = await loadSourceParentEligibility({ supabase, workspaceId, rows });
    return filterBySourceParentEligibility(rows, eligibility);
  } catch {
    limitations.push(`${label} source lifecycle could not be verified, so source-linked records were excluded.`);
    return rows.filter((row) => !row.source_file_id && !row.import_id);
  }
}

function filterOriginalOrSourceBackedRows<T extends { source_file_id?: string | null; import_id?: string | null }>(rows: T[]) {
  return rows.filter((row) => Boolean(row.source_file_id || row.import_id) || isOriginalBusinessEvidence(row));
}

export async function buildBoundedWorkspaceContext({
  supabase,
  workspaceId,
  query,
  plan,
  stageLogger
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  query: string;
  plan: VaeroexQueryPlan;
  stageLogger?: WorkflowStageLogger;
}): Promise<BoundedWorkspaceContext> {
  const startedAt = Date.now();
  const limitations: string[] = [];
  const domainSet = new Set(plan.domains);
  const context: JsonRecord = {};
  const loadedDomainSet = new Set<VaeroexEvidenceDomain>();
  let structuredEvidenceCount = 0;
  let kpiSummary: KpiOverviewSummary | null = null;
  let businessHealthRows: Json[] = [];

  const loaders: Array<Promise<void>> = [];

  if (domainSet.has("kpis") || domainSet.has("financials") || domainSet.has("business_health")) {
    loaders.push(timedContextStage("kpi_context_loading_ms", stageLogger, async () => {
      try {
        const kpiData = await loadKpiOverviewData({ supabase, workspaceId });
        const eligibleKpiRows = filterOriginalOrSourceBackedRows(kpiData.rows);
        kpiSummary = buildKpiOverviewSummary(eligibleKpiRows, kpiData.settings);
        context.kpi_summary = kpiSummary;
        context.kpi_records = eligibleKpiRows.slice(0, 16).map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          target: row.target,
          actual_value: row.actual_value,
          metric_date: row.metric_date,
          source_file_id: row.source_file_id,
          import_id: row.import_id,
          updated_at: row.updated_at,
          created_at: row.created_at
        }));
        structuredEvidenceCount += kpiSummary.metrics.length;
        loadedDomainSet.add("kpis");
      } catch {
        limitations.push("KPI context could not be loaded for this answer.");
      }
    }));
  }

  if (domainSet.has("business_health")) {
    loaders.push(
      timedContextStage("business_health_context_loading_ms", stageLogger, () => safeRows(
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
        businessHealthRows = eligibleRows as Json[];
        context.business_health = eligibleRows;
        structuredEvidenceCount += eligibleRows.length;
        loadedDomainSet.add("business_health");
      }))
    );
  }

  if (domainSet.has("risks") || domainSet.has("priorities") || domainSet.has("decisions")) {
    loaders.push(
      safeRows(
        "Risk records",
        supabase
          .from("issues")
          .select("id,title,description,issue_type,severity,status,root_cause,created_at,updated_at,archived_at,deleted_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(24),
        limitations
      ).then((issues) => {
        const eligibleIssues = filterOriginalBusinessEvidence(issues).slice(0, 8);
        context.risk_and_priority_evidence = { issues: eligibleIssues, recommendations: [] };
        structuredEvidenceCount += eligibleIssues.length;
        if (domainSet.has("risks")) loadedDomainSet.add("risks");
        if (domainSet.has("priorities")) loadedDomainSet.add("priorities");
        if (domainSet.has("decisions")) loadedDomainSet.add("decisions");
      })
    );
  }

  if (domainSet.has("files") || domainSet.has("data_quality")) {
    loaders.push(
      safeRows(
        "Source files",
        supabase
          .from("file_uploads")
          .select("id,display_name,file_extension,analysis_summary,processing_status,index_status,indexed_chunk_count,processed_at,indexed_at,created_at,updated_at,metadata_json")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then((rows) => {
        const eligibleRows = filterBusinessEvidence(rows);
        context.sources = eligibleRows.map((row) => ({
          id: row.id,
          display_name: row.display_name,
          file_extension: row.file_extension,
          analysis_summary: sanitizeBusinessEvidenceText(row.analysis_summary) || null,
          processing_status: row.processing_status,
          index_status: row.index_status,
          indexed_chunk_count: row.indexed_chunk_count,
          processed_at: row.processed_at,
          indexed_at: row.indexed_at,
          created_at: row.created_at,
          updated_at: row.updated_at
        }));
        structuredEvidenceCount += eligibleRows.length;
        if (domainSet.has("files")) loadedDomainSet.add("files");
        if (domainSet.has("data_quality")) loadedDomainSet.add("data_quality");
      })
    );
  }

  if (domainSet.has("financials") || domainSet.has("operations")) {
    loaders.push(
      safeRows(
        "Operational metrics",
        supabase
          .from("operational_metrics")
          .select("id,metric_name,category,value,metric_date,notes,source_file_id,import_id,raw_data_json,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("metric_date", { ascending: false })
          .limit(12),
        limitations
      ).then(async (rows) => {
        const sourceBackedRows = await sourceEligibleRows({ supabase, workspaceId, rows, label: "Operational metrics", limitations });
        const eligibleRows = filterOriginalOrSourceBackedRows(sourceBackedRows);
        context.operational_metrics = eligibleRows;
        structuredEvidenceCount += eligibleRows.length;
        if (domainSet.has("financials")) loadedDomainSet.add("financials");
        if (domainSet.has("operations")) loadedDomainSet.add("operations");
      })
    );
  }

  if (domainSet.has("customers")) {
    loaders.push(
      safeRows(
        "Historical customer activity",
        supabase
          .from("crm_leads")
          .select("id,status,last_activity_at,source_file_id,import_id,raw_data_json,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(8),
        limitations
      ).then(async (rows) => {
        const sourceBackedRows = await sourceEligibleRows({ supabase, workspaceId, rows, label: "Customer activity", limitations });
        const eligibleRows = filterOriginalOrSourceBackedRows(sourceBackedRows);
        context.historical_customer_activity = eligibleRows;
        structuredEvidenceCount += eligibleRows.length;
        loadedDomainSet.add("customers");
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
        loadedDomainSet.add("people");
      })
    );
  }

  if (domainSet.has("compliance")) {
    loaders.push(
      safeRows(
        "Process and policy context",
          supabase
            .from("sops")
          .select("id,title,department,category,status,version,ai_generated,updated_at,archived_at,deleted_at")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(24),
        limitations
      ).then((rows) => {
        const eligibleRows = filterOriginalBusinessEvidence(rows).slice(0, 8);
        context.process_and_policy_context = eligibleRows;
        structuredEvidenceCount += eligibleRows.length;
        loadedDomainSet.add("compliance");
      })
    );
  }

  await Promise.all(loaders);

  if (domainSet.has("business_health")) {
    const businessHealthStartedAt = Date.now();
    context.business_health_score_context = buildBusinessHealthDecisionContext({
      snapshots: businessHealthRows,
      kpiSummary
    });
    stageLogger?.("business_health_context_assembly_ms", Date.now() - businessHealthStartedAt);
  }

  const loadedDomains = plan.domains.filter((domain) => loadedDomainSet.has(domain));
  const orderedContext = Object.fromEntries([
    "kpi_summary",
    "kpi_records",
    "business_health",
    "business_health_score_context",
    "risk_and_priority_evidence",
    "sources",
    "operational_metrics",
    "historical_customer_activity",
    "people_context",
    "process_and_policy_context"
  ].flatMap((key) => context[key] === undefined ? [] : [[key, context[key]]])) as JsonRecord;

  const workspaceSnapshot = {
    scope: "bounded_cross_business_reasoning",
    query,
    requested_domains: plan.domains,
    loaded_domains: loadedDomains,
    structured_context: orderedContext,
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
    loadedDomains,
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
  const sources = Array.isArray(structured.sources) ? structured.sources : [];
  const firstIssue = jsonRecord(issues[0]);
  const firstRecommendation = jsonRecord(recommendations[0]);
  const latestHealth = jsonRecord(healthRows[0]);
  const firstSource = jsonRecord(sources[0]);
  const metrics = Array.isArray(kpiSummary.metrics) ? kpiSummary.metrics : [];
  const firstMetric = jsonRecord(metrics[0]);
  const observations = [
    typeof latestHealth.score === "number" ? `Business Health is ${latestHealth.score} out of 100${typeof latestHealth.trend === "string" ? ` with a ${latestHealth.trend.toLowerCase()} trend` : ""}.` : "",
    typeof firstIssue.title === "string" ? `The clearest current risk record is ${firstIssue.title}.` : "",
    typeof firstRecommendation.title === "string" ? `The leading saved recommendation is ${firstRecommendation.title}.` : "",
    typeof firstMetric.name === "string" ? `The current KPI information includes ${firstMetric.name}.` : ""
  ].filter(Boolean);
  const asksCount = /\b(how many|count|counts)\b/i.test(query);
  const countAnswer = asksCount
    ? [
        sources.length ? `${sources.length} active source file${sources.length === 1 ? "" : "s"}` : "",
        issues.length ? `${issues.length} current risk record${issues.length === 1 ? "" : "s"}` : "",
        Array.isArray(kpiSummary.metrics) && kpiSummary.metrics.length ? `${kpiSummary.metrics.length} current KPI${kpiSummary.metrics.length === 1 ? "" : "s"}` : ""
      ].filter(Boolean).join(", ")
    : "";
  const targetedObservation =
    /\b(file|source|document|upload)\b/i.test(query) && typeof firstSource.display_name === "string"
        ? `The latest relevant source is ${firstSource.display_name}.`
        : /\b(alert|risk|issue)\b/i.test(query) && typeof firstIssue.title === "string"
          ? `${firstIssue.title} is the clearest current risk record available for this question.`
          : /\b(priority|recommendation)\b/i.test(query) && typeof firstRecommendation.title === "string"
            ? `${firstRecommendation.title} is the leading current recommendation available for this question.`
            : "";
  const directAnswer = countAnswer
    ? `The current workspace information includes ${countAnswer}.`
    : targetedObservation || (observations.length
        ? observations.slice(0, 2).join(" ")
        : "The current workspace information is not sufficient for a reliable business conclusion.");
  const limitations = [
    ...(failureReason ? [failureReason] : []),
    ...context.limitations,
    ...(observations.length ? ["A deeper causal analysis was not completed."] : ["Add or identify evidence directly related to this question."])
  ];

  return {
    title: "Vaeroex answer",
    direct_answer: directAnswer,
    summary: directAnswer,
    response_markdown: directAnswer,
    evidence_note: `${context.structuredEvidenceCount} workspace record${context.structuredEvidenceCount === 1 ? "" : "s"} were considered across ${context.loadedDomains.join(", ") || "the requested business areas"}.`,
    recommendation_confidence: confidenceFromEvidence(context.structuredEvidenceCount),
    limitations,
    fallback_used: true,
    fallback_question: query
  } satisfies Json;
}
