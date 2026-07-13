import { NextResponse } from "next/server";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { buildBoundedWorkspaceContext, buildDeterministicBoundedAnswer } from "@/lib/ai/bounded-context";
import { buildWorkspaceEvidenceContext, evidenceContextAsJson, filterEligibleMemoryRowsByLifecycle, type EvidenceContext } from "@/lib/ai/evidence-index";
import { buildDeterministicKpiOverviewOutput, classifyKpiOverviewIntent, loadKpiOverviewData, type KpiOverviewIntent, type KpiOverviewSummary } from "@/lib/ai/kpi-overview";
import { getOpenAIRetrySettings } from "@/lib/ai/openai-resilience";
import { resolveVaeroexModel } from "@/lib/ai/model-routing";
import { planVaeroexQuery, type VaeroexEvidenceDomain } from "@/lib/ai/query-depth-planner";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { classifySecurityIntent, isSecurityResponseMessage, securityResponseMessage } from "@/lib/security/security-response";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import type { GlobalSearchAnswer, GlobalSearchDestination, GlobalSearchGroup, GlobalSearchGroupLabel, GlobalSearchResult } from "@/lib/search/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type ChecklistRow = Database["public"]["Tables"]["checklists"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type DecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type MemoryChunkRow = Database["public"]["Tables"]["business_memory_chunks"]["Row"];

const GROUP_ORDER: GlobalSearchGroupLabel[] = [
  "KPIs",
  "Reports",
  "Files",
  "Issues",
  "Business Signals",
  "Review Signals",
  "Customer Evidence",
  "SOPs",
  "Checklists",
  "People",
  "Learned Knowledge",
  "Diagnostics"
];

function normalizeQuery(value: string | null) {
  return (value || "").replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeQuestion(value: unknown) {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, 600);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizedRecommendationConfidence(value: unknown, evidenceCount: number): GlobalSearchAnswer["recommendationConfidence"] {
  const candidate = stringValue(value);
  return ["High", "Medium", "Low", "Insufficient"].includes(candidate)
    ? candidate as GlobalSearchAnswer["recommendationConfidence"]
    : confidenceFromEvidence(evidenceCount);
}

function answerFromOutput(output: Json, evidenceCount: number, fallback: GlobalSearchAnswer): GlobalSearchAnswer {
  const record = isRecord(output) ? output : {};
  const directAnswer =
    stringValue(record.direct_answer) ||
    stringValue(record.direct_explanation) ||
    stringValue(record.response_markdown) ||
    stringValue(record.summary) ||
    fallback.directAnswer;
  const limitations = Array.isArray(record.limitations)
    ? record.limitations.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join(" ")
    : stringValue(record.limitations);
  const evidenceNote = stringValue(record.evidence_note) || fallback.evidenceNote || (limitations || undefined);

  return {
    kind: "business_answer",
    directAnswer,
    recommendationConfidence: normalizedRecommendationConfidence(record.recommendation_confidence || record.confidence, evidenceCount),
    evidenceNote,
    relevantDestinations: fallback.relevantDestinations
  };
}

function queryWords(query: string) {
  return Array.from(new Set(query.toLowerCase().split(" ").filter((word) => word.length >= 2))).slice(0, 5);
}

function orFilter(fields: string[], words: string[]) {
  return fields.flatMap((field) => words.map((word) => `${field}.ilike.%${word}%`)).join(",");
}

function compact(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" · ");
}

function truncate(value: string | null | undefined, length = 170) {
  const clean = (value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "No preview available.";
  return clean.length > length ? `${clean.slice(0, length - 1).trim()}...` : clean;
}

function hrefWithQuery(path: string, value: string) {
  return `${path}?q=${encodeURIComponent(value)}`;
}

function textFromJson(value: Json | undefined, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textFromJson(item, depth + 1)).filter(Boolean).slice(0, 8).join(" ");

  return Object.entries(value)
    .filter(([key]) => !["raw_data_json", "source_data_json", "metadata_json"].includes(key))
    .map(([, item]) => textFromJson(item, depth + 1))
    .filter(Boolean)
    .slice(0, 12)
    .join(" ");
}

function matchesWords(value: string, words: string[]) {
  const haystack = value.toLowerCase();
  return words.some((word) => haystack.includes(word));
}

function addGroup(groups: Map<GlobalSearchGroupLabel, GlobalSearchResult[]>, label: GlobalSearchGroupLabel, results: GlobalSearchResult[]) {
  if (!results.length) return;
  groups.set(label, [...(groups.get(label) || []), ...results].slice(0, 6));
}

async function safeResults<T>(request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await request;
  if (error) {
    console.warn("[global-search] skipped source:", error.message);
    return [];
  }

  return data || [];
}

async function scopedResults<T>(enabled: boolean, request: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  return enabled ? safeResults(request()) : [];
}

function sourceHref(sourceType: string | null, title: string | null) {
  const normalized = (sourceType || "").toLowerCase();
  const query = title || "";

  if (normalized.includes("task") || normalized.includes("follow")) return hrefWithQuery("/app/tasks", query);
  if (normalized.includes("issue")) return hrefWithQuery("/app/issues", query);
  if (normalized.includes("report")) return hrefWithQuery("/app/reports", query);
  if (normalized.includes("kpi")) return hrefWithQuery("/app/kpis", query);
  if (normalized.includes("file")) return hrefWithQuery("/app/sources", query);
  if (normalized.includes("checklist")) return hrefWithQuery("/app/checklists", query);
  if (normalized.includes("sop")) return hrefWithQuery("/app/sops", query);
  if (normalized.includes("crm") || normalized.includes("lead") || normalized.includes("customer")) return hrefWithQuery("/app/sources", query);

  return "/app/notifications";
}

function shouldSearchDiagnostics(query: string, user: { email?: string | null; app_metadata?: Record<string, unknown> | null }) {
  return isVaeroexAdminUser(user) && /\b(diagnostic|diagnostics|execution|run|runs|failed ask|ask history|workflow history|old failed)\b/i.test(query);
}

function questionLike(query: string) {
  return /[?]$/.test(query) || /^(what|why|how|which|where|when|tell me|give me|summarize|show me|take me|find|open)\b/i.test(query);
}

function businessQuestionLike(query: string) {
  return (
    questionLike(query) &&
    /\b(kpi|metric|metrics|performance|business health|health|risk|opportunity|changed|change|week|priority|priorities|revenue|profit|margin|customer|department|briefing|report|forecast)\b/i.test(query)
  );
}

function destination(label: string, href: string, context?: string): GlobalSearchDestination {
  return { label, href, context };
}

function destinationsFromGroups(groups: GlobalSearchGroup[], limit = 4) {
  return groups
    .flatMap((group) =>
      group.results.map((result) =>
        destination(result.title, result.href, `${result.sourceType}${result.preview ? ` · ${truncate(result.preview, 72)}` : ""}`)
      )
    )
    .slice(0, limit);
}

function confidenceFromEvidence(count: number): GlobalSearchAnswer["recommendationConfidence"] {
  if (count >= 6) return "High";
  if (count >= 3) return "Medium";
  if (count >= 1) return "Low";
  return "Insufficient";
}

function latestDate(...values: Array<string | null | undefined>) {
  return values.find((value) => value && /^\d{4}-\d{2}-\d{2}/.test(value)) || null;
}

function daysAgo(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

function recentRecordLabel(record: { title?: string | null; name?: string | null; display_name?: string | null; original_name?: string | null; updated_at?: string | null; created_at?: string | null; metric_date?: string | null }) {
  return {
    label: record.title || record.name || record.display_name || record.original_name || "Workspace record",
    date: latestDate(record.updated_at, record.created_at, record.metric_date)
  };
}

function shouldUseKpiOverviewAnswer(query: string, intent: KpiOverviewIntent) {
  if (intent.matched) {
    return true;
  }

  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  const clearKpiReference = /\b(kpi|kpis|metric|metrics|measurement|measurements|target|targets|performance indicators?)\b/.test(normalized);
  const asksForWeakOrAttention = /\b(weakest|worst|needs? attention|underperforming|below target|off target)\b/.test(normalized);

  return clearKpiReference && asksForWeakOrAttention;
}

function buildKpiGlobalAnswer(query: string, summary: KpiOverviewSummary, groups: GlobalSearchGroup[]): GlobalSearchAnswer {
  const deterministicOutput = buildDeterministicKpiOverviewOutput(summary);
  const directAnswer = typeof deterministicOutput.direct_answer === "string" ? deterministicOutput.direct_answer : "I do not see enough structured KPI data to answer that reliably.";
  const evidenceNote = typeof deterministicOutput.evidence_note === "string" ? deterministicOutput.evidence_note : "This used structured KPI records only.";
  const weakestMetric = summary.metrics.find((metric) => metric.status === "needs_attention") || summary.metrics.find((metric) => metric.status === "missing_value" || metric.status === "missing_target");
  const asksWeakest = /\b(weakest|worst|needs? attention|focus on first)\b/i.test(query);

  return {
    kind: asksWeakest ? "navigation_answer" : "business_answer",
    directAnswer:
      asksWeakest && weakestMetric
        ? `${weakestMetric.name} appears to need the most attention from the structured KPI records currently available.`
        : directAnswer,
    recommendationConfidence: summary.recommendationConfidence,
    evidenceNote,
    relevantDestinations: [
      weakestMetric ? destination(`Open ${weakestMetric.name}`, `/app/kpis?q=${encodeURIComponent(weakestMetric.name)}`, `${weakestMetric.status.replace(/_/g, " ")} · ${weakestMetric.trend.replace(/_/g, " ")}`) : null,
      destination("Open KPI overview", "/app/kpis", `${summary.metricCount} KPI${summary.metricCount === 1 ? "" : "s"} reviewed`),
      ...destinationsFromGroups(groups.filter((group) => group.label === "KPIs"), 2)
    ].filter(Boolean) as GlobalSearchDestination[]
  };
}

function buildRiskAnswer(issues: IssueRow[], recommendations: RecommendationRow[], groups: GlobalSearchGroup[]): GlobalSearchAnswer {
  const issue = issues.find((item) => /urgent|high|critical/i.test(`${item.severity} ${item.status}`)) || issues[0];
  const recommendation = recommendations.find((item) => /urgent|high/i.test(`${item.priority} ${item.status}`)) || recommendations[0];
  const top = issue?.title || recommendation?.title || "No high-priority risk is obvious from the bounded records this panel loaded.";
  const evidenceCount = [issue, recommendation, ...issues.slice(1, 3), ...recommendations.slice(1, 3)].filter(Boolean).length;

  return {
    kind: "business_answer",
    directAnswer: issue || recommendation ? `${top} is the clearest risk signal available in this quick workspace scan.` : top,
    recommendationConfidence: confidenceFromEvidence(evidenceCount),
    evidenceNote: issue || recommendation ? `This used bounded workspace records: issues, recommendations, and matching Learned Knowledge entries.` : "I did not find enough current risk evidence in the bounded search results.",
    relevantDestinations: [
      issue ? destination("Open risks and issues", `/app/issues?q=${encodeURIComponent(issue.title)}`, compact([issue.severity, issue.status])) : null,
      recommendation ? destination("Open supporting recommendation", sourceHref(recommendation.source_type, recommendation.source_title || recommendation.title), compact([recommendation.priority, recommendation.status])) : null,
      ...destinationsFromGroups(groups, 3)
    ].filter(Boolean) as GlobalSearchDestination[]
  };
}

function buildChangeAnswer({
  kpis,
  reports,
  files,
  tasks,
  groups
}: {
  kpis: KpiRow[];
  reports: ReportRow[];
  files: FileUploadRow[];
  tasks: TaskRow[];
  groups: GlobalSearchGroup[];
}): GlobalSearchAnswer {
  const recent = [
    ...kpis.map((item) => ({ ...recentRecordLabel(item), href: `/app/kpis?q=${encodeURIComponent(item.name)}`, type: "KPI" })),
    ...reports.map((item) => ({ ...recentRecordLabel(item), href: `/app/reports?q=${encodeURIComponent(item.title)}`, type: "Briefing" })),
    ...files.map((item) => ({ ...recentRecordLabel(item), href: `/app/files?file=${encodeURIComponent(item.id)}`, type: "Source" })),
    ...tasks.map((item) => ({ ...recentRecordLabel(item), href: `/app/tasks?q=${encodeURIComponent(item.title)}`, type: "Business Signal" }))
  ]
    .filter((item) => daysAgo(item.date) <= 14)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 4);

  return {
    kind: "business_answer",
    directAnswer: recent.length
      ? `The most visible recent movement is in ${recent.slice(0, 3).map((item) => item.label).join(", ")}.`
      : "I do not see enough recent workspace activity in this quick scan to say what changed this week.",
    recommendationConfidence: confidenceFromEvidence(recent.length),
    evidenceNote: recent.length
      ? "This quick answer used recently updated KPIs, source files, briefings, and Business Signals only."
      : "This quick answer did not run deep Learned Knowledge retrieval. Open a relevant area or ask a narrower question for deeper evidence.",
    relevantDestinations: recent.length
      ? recent.map((item) => destination(item.label, item.href, `${item.type}${item.date ? ` · ${item.date}` : ""}`))
      : destinationsFromGroups(groups, 4)
  };
}

function buildGeneralBusinessAnswer(groups: GlobalSearchGroup[]): GlobalSearchAnswer | null {
  const destinations = destinationsFromGroups(groups, 4);

  if (!destinations.length) {
    return {
      kind: "business_answer",
      directAnswer: "I do not see enough matching workspace evidence in this quick panel to answer that reliably.",
      recommendationConfidence: "Insufficient",
      evidenceNote: "This panel uses bounded workspace search first. Add more specific terms or open the relevant module for contextual analysis.",
      relevantDestinations: [
        destination("Open Intelligence", "/app/intelligence", "Review current risks, opportunities, and forecasts"),
        destination("Open Sources", "/app/sources", "Upload or review business evidence")
      ]
    };
  }

  return {
    kind: "navigation_answer",
    directAnswer: `I found matching workspace evidence. The best place to start is ${destinations[0].label}.`,
    recommendationConfidence: confidenceFromEvidence(destinations.length),
    evidenceNote: "This used bounded workspace search results rather than broad Learned Knowledge retrieval.",
    relevantDestinations: destinations
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("q"));

  if (query.length < 2) {
    return NextResponse.json({ query, groups: [] });
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return NextResponse.json({ error: "Workspace access is required." }, { status: 403 });
  }

  const workspaceId = context.activeWorkspace.id;
  const subscriptionStatus = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId });

  if (!subscriptionStatus.allowed) {
    return NextResponse.json({ error: "Subscription access is required." }, { status: 402 });
  }

  const rateLimit = await enforceRateLimit({
    action: "global.search",
    limit: 80,
    windowSeconds: 60,
    requestHeaders: request.headers,
    userId: user.id,
    workspaceId,
    identifiers: [query],
    metadata: { source: "global_search" }
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit) }, { status: 429 });
  }

  const securityIntent = classifySecurityIntent(query);

  if (securityIntent.securitySensitive) {
    await logSecurityAuditEvent({
      supabase,
      workspaceId,
      userId: user.id,
      actionName: "global_search.security_response",
      operationType: "SYSTEM",
      initiatedBy: "user",
      allowed: false,
      reasonBlocked: "Global search request was classified as security sensitive.",
      metadata: {
        source: "global_search",
        classification_category: securityIntent.category,
        classification_confidence: securityIntent.confidence,
        classification_reasons: securityIntent.reasons
      } satisfies Json
    });

    return NextResponse.json({
      query,
      groups: [],
      answer: {
        kind: "security_response",
        directAnswer: securityResponseMessage()
      } satisfies GlobalSearchAnswer
    });
  }

  const words = queryWords(query);
  const groups = new Map<GlobalSearchGroupLabel, GlobalSearchResult[]>();

  if (!words.length) {
    return NextResponse.json({ query, groups: [] });
  }

  const kpiOverviewIntent = classifyKpiOverviewIntent(query);
  const useKpiOverviewAnswer = shouldUseKpiOverviewAnswer(query, kpiOverviewIntent);
  const queryPlan = planVaeroexQuery({ query });
  const plannedDomains = new Set<VaeroexEvidenceDomain>(queryPlan.domains);
  const searchAllDomains = queryPlan.domains.length === 0 || (!questionLike(query) && queryPlan.classification === "unsupported");
  const includesDomain = (...domains: VaeroexEvidenceDomain[]) => searchAllDomains || domains.some((domain) => plannedDomains.has(domain));
  const includeDiagnostics = shouldSearchDiagnostics(query, user);
  const shouldBuildAnswer =
    businessQuestionLike(query) ||
    useKpiOverviewAnswer ||
    queryPlan.classification === "structured_answer" ||
    queryPlan.classification === "cross_business_reasoning" ||
    /\b(weakest|worst|biggest risk|biggest opportunity|current priorities|what changed|changed this week|take me to)\b/i.test(query);

  const [
    rawKpis,
    reports,
    files,
    issues,
    tasks,
    assignments,
    rawCrmLeads,
    sops,
    checklists,
    people,
    decisions,
    recommendations,
    learnedKnowledgeCandidates,
    vaeroexRuns
  ] = await Promise.all([
    scopedResults<KpiRow>(
      includesDomain("kpis", "financials", "business_health"),
      () => supabase
        .from("kpis")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["name", "category", "notes", "source"], words))
        .order("metric_date", { ascending: false })
        .limit(6)
    ),
    scopedResults<ReportRow>(
      includesDomain("reports", "decisions"),
      () => supabase
        .from("reports")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "report_type", "body_markdown"], words))
        .order("created_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<FileUploadRow>(
      includesDomain("files", "data_quality"),
      () => supabase
        .from("file_uploads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["display_name", "original_name", "file_extension", "import_status", "processing_status", "analysis_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<IssueRow>(
      includesDomain("risks", "priorities", "operations"),
      () => supabase
        .from("issues")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "description", "issue_type", "severity", "status", "root_cause", "recommended_fix"], words))
        .order("updated_at", { ascending: false })
        .limit(24)
    ).then((rows) => filterOriginalBusinessEvidence<IssueRow>(rows as IssueRow[]).slice(0, 6)),
    scopedResults<TaskRow>(
      includesDomain("business_signals", "operations", "priorities"),
      () => supabase
        .from("tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "description", "status", "priority", "category", "assigned_role", "assigned_department"], words))
        .order("updated_at", { ascending: false })
        .limit(24)
    ).then((rows) => filterOriginalBusinessEvidence<TaskRow>(rows as TaskRow[]).slice(0, 6)),
    scopedResults<AssignmentRow>(
      includesDomain("operations", "priorities"),
      () => supabase
        .from("operational_assignments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "description", "status", "priority", "source_type", "source_title"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<CrmLeadRow>(
      includesDomain("customers"),
      () => supabase
        .from("crm_leads")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["lead_name", "company", "email", "status", "owner", "notes"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<SopRow>(
      includesDomain("compliance", "operations"),
      () => supabase
        .from("sops")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "department", "category", "body_markdown", "status"], words))
        .order("updated_at", { ascending: false })
        .limit(24)
    ).then((rows) => filterOriginalBusinessEvidence<SopRow>(rows as SopRow[]).slice(0, 6)),
    scopedResults<ChecklistRow>(
      includesDomain("compliance", "operations"),
      () => supabase
        .from("checklists")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["name", "description", "category", "frequency", "assigned_role"], words))
        .order("updated_at", { ascending: false })
        .limit(24)
    ).then((rows) => filterOriginalBusinessEvidence<ChecklistRow>(rows as ChecklistRow[]).slice(0, 6)),
    scopedResults<PersonRow>(
      includesDomain("people", "operations"),
      () => supabase
        .from("people")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["full_name", "email", "phone", "role_title", "department", "status", "notes"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<DecisionRow>(
      includesDomain("decisions", "priorities"),
      () => supabase
        .from("business_decisions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "reason", "expected_outcome", "related_kpi", "owner", "status", "outcome_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<RecommendationRow>(
      includesDomain("decisions", "priorities", "risks"),
      () => supabase
        .from("vaeroex_recommendation_outcomes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["title", "source_type", "source_title", "evidence", "related_module", "related_kpi", "expected_outcome", "owner", "priority", "status", "outcome_summary"], words))
        .order("updated_at", { ascending: false })
        .limit(6)
    ),
    scopedResults<MemoryChunkRow>(
      includesDomain("business_memory", "reports", "files", "risks", "financials", "customers", "operations"),
      () => supabase
        .from("business_memory_chunks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(orFilter(["source_title", "source_excerpt", "summary", "source_type"], words))
        .order("indexed_at", { ascending: false })
        .limit(24)
    ),
    includeDiagnostics
      ? safeResults<VaeroexRunRow>(
          supabase
            .from("ai_agent_runs")
            .select("*")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(80)
        )
      : Promise.resolve([])
  ]);
  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [...rawKpis, ...rawCrmLeads]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const kpis = filterBySourceParentEligibility(rawKpis, sourceParentEligibility);
  const crmLeads = filterBySourceParentEligibility(rawCrmLeads, sourceParentEligibility);
  let learnedKnowledgePage = learnedKnowledgeCandidates;
  let learnedKnowledge = await filterEligibleMemoryRowsByLifecycle({
    supabase,
    workspaceId,
    rows: learnedKnowledgePage
  }) as MemoryChunkRow[];
  let learnedKnowledgeOffset = learnedKnowledgePage.length;
  let learnedKnowledgePages = 1;

  while (learnedKnowledge.length < 6 && learnedKnowledgePage.length === 24 && learnedKnowledgePages < 10) {
    const { data: nextPage, error: nextPageError } = await supabase
      .from("business_memory_chunks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .or(orFilter(["source_title", "source_excerpt", "summary", "source_type"], words))
      .order("indexed_at", { ascending: false })
      .range(learnedKnowledgeOffset, learnedKnowledgeOffset + 23);

    if (nextPageError) break;
    learnedKnowledgePage = nextPage || [];
    learnedKnowledgeOffset += learnedKnowledgePage.length;
    learnedKnowledgePages += 1;
    const eligiblePage = await filterEligibleMemoryRowsByLifecycle({ supabase, workspaceId, rows: learnedKnowledgePage });
    learnedKnowledge = [...learnedKnowledge, ...eligiblePage];
  }

  learnedKnowledge = learnedKnowledge.slice(0, 6);

  let answerKpis = kpis;
  let answerReports: ReportRow[] = [];
  let answerFiles = files;
  let answerIssues = issues;
  let answerTasks = tasks;
  let answerRecommendations = recommendations;
  let answerKpiSummary: KpiOverviewSummary | null = null;

  if (useKpiOverviewAnswer) {
    const overviewData = await loadKpiOverviewData({ supabase, workspaceId });
    answerKpis = overviewData.rows;
    answerKpiSummary = overviewData.summary;
  } else if (shouldBuildAnswer) {
    const [recentKpis, recentFiles, recentIssues, recentTasks, recentRecommendations] = await Promise.all([
      scopedResults<KpiRow>(
        includesDomain("kpis", "financials", "business_health"),
        () => supabase
          .from("kpis")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("metric_date", { ascending: false })
          .limit(120)
      ),
      scopedResults<FileUploadRow>(
        includesDomain("files", "data_quality"),
        () => supabase
          .from("file_uploads")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(12)
      ),
      scopedResults<IssueRow>(
        includesDomain("risks", "priorities", "operations"),
        () => supabase
          .from("issues")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(36)
      ).then((rows) => filterOriginalBusinessEvidence<IssueRow>(rows as IssueRow[]).slice(0, 12)),
      scopedResults<TaskRow>(
        includesDomain("business_signals", "operations", "priorities"),
        () => supabase
          .from("tasks")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(36)
      ).then((rows) => filterOriginalBusinessEvidence<TaskRow>(rows as TaskRow[]).slice(0, 12)),
      scopedResults<RecommendationRow>(
        includesDomain("decisions", "priorities", "risks"),
        () => supabase
          .from("vaeroex_recommendation_outcomes")
          .select("*")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(12)
      )
    ]);

    answerKpis = recentKpis.length ? recentKpis : kpis;
    // Reports remain navigation results, but derived report activity is not
    // treated as a new business condition in Search or Ask answers.
    answerReports = [];
    answerFiles = recentFiles.length ? recentFiles : files;
    answerIssues = recentIssues.length ? recentIssues : issues;
    answerTasks = recentTasks.length ? recentTasks : tasks;
    answerRecommendations = recentRecommendations.length ? recentRecommendations : recommendations;
  }

  addGroup(
    groups,
    "KPIs",
    kpis.map((kpi) => ({
      id: kpi.id,
      title: kpi.name,
      sourceType: "KPI",
      preview: truncate(compact([kpi.category, kpi.notes, kpi.source])),
      href: hrefWithQuery("/app/kpis", kpi.name),
      meta: compact([kpi.metric_date, kpi.actual_value !== null ? `Actual ${kpi.actual_value}` : null, kpi.target !== null ? `Target ${kpi.target}` : null])
    }))
  );

  addGroup(
    groups,
    "Reports",
    reports.map((report) => ({
      id: report.id,
      title: report.title,
      sourceType: `Derived report · ${report.report_type}`,
      preview: "Saved derived analysis. Review its original evidence before using its conclusions.",
      href: hrefWithQuery("/app/reports", report.title),
      meta: report.created_at
    }))
  );

  addGroup(
    groups,
    "Files",
    files.map((file) => ({
      id: file.id,
      title: file.display_name || file.original_name,
      sourceType: "File",
      preview: truncate(file.analysis_summary || compact([file.file_extension, file.import_status, file.processing_status])),
      href: `/app/sources?file=${encodeURIComponent(file.id)}`,
      meta: compact([file.file_extension?.toUpperCase(), file.processing_status])
    }))
  );

  addGroup(
    groups,
    "Issues",
    issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      sourceType: "Issue",
      preview: truncate(issue.description || issue.root_cause || issue.recommended_fix),
      href: hrefWithQuery("/app/issues", issue.title),
      meta: compact([issue.severity, issue.status, issue.issue_type])
    }))
  );

  addGroup(
    groups,
    "Business Signals",
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      sourceType: "Business Signal",
      preview: truncate(task.description || compact([task.category, task.related_type, task.due_date])),
      href: hrefWithQuery("/app/tasks", task.title),
      meta: compact([task.category, task.related_type, task.due_date])
    }))
  );

  addGroup(
    groups,
    "Review Signals",
    assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      sourceType: "Review Signal",
      preview: truncate(assignment.description || assignment.source_title),
      href: sourceHref(assignment.source_type, assignment.source_title || assignment.title),
      meta: compact([assignment.status, assignment.priority, assignment.due_date])
    }))
  );

  addGroup(
    groups,
    "Customer Evidence",
    crmLeads.map((lead) => ({
      id: lead.id,
      title: lead.lead_name,
      sourceType: "Customer Evidence",
      preview: truncate(compact([lead.company, lead.email, lead.notes])),
      href: hrefWithQuery("/app/sources", lead.lead_name),
      meta: compact([lead.status, lead.owner ? `Context: ${lead.owner}` : null])
    }))
  );

  addGroup(
    groups,
    "SOPs",
    sops.map((sop) => ({
      id: sop.id,
      title: sop.title,
      sourceType: "SOP",
      preview: truncate(sop.body_markdown || compact([sop.department, sop.category])),
      href: hrefWithQuery("/app/sops", sop.title),
      meta: compact([sop.status, sop.department, sop.category])
    }))
  );

  addGroup(
    groups,
    "Checklists",
    checklists.map((checklist) => ({
      id: checklist.id,
      title: checklist.name,
      sourceType: "Checklist",
      preview: truncate(checklist.description || compact([checklist.category, checklist.frequency, checklist.assigned_role])),
      href: hrefWithQuery("/app/checklists", checklist.name),
      meta: compact([checklist.category, checklist.frequency])
    }))
  );

  addGroup(
    groups,
    "People",
    people.map((person) => ({
      id: person.id,
      title: person.full_name,
      sourceType: "Person",
      preview: truncate(compact([person.email, person.phone, person.notes])),
      href: hrefWithQuery("/app/people", person.full_name),
      meta: compact([person.role_title, person.department, person.status])
    }))
  );

  const runMatches = includeDiagnostics
    ? vaeroexRuns
        .map((run) => {
          const outputText = textFromJson(run.output_json);
          return {
            run,
            outputText,
            haystack: compact([run.agent_type, run.status, run.error_message, outputText])
          };
        })
        .filter((item) => matchesWords(item.haystack, words))
        .slice(0, 4)
    : [];

  addGroup(
    groups,
    "Learned Knowledge",
    [
      ...learnedKnowledge.map((chunk) => ({
        id: chunk.id,
        title: chunk.source_title || "Learned knowledge",
        sourceType: "Learned Knowledge",
        preview: truncate(chunk.summary || chunk.source_excerpt),
        href: chunk.source_file_id ? `/app/sources?file=${encodeURIComponent(chunk.source_file_id)}` : "/app/sources?tab=knowledge",
        meta: compact([chunk.source_type.replace(/_/g, " "), chunk.confidence_score ? `Confidence ${Math.round(chunk.confidence_score)}%` : null])
      })),
      ...decisions.map((decision) => ({
        id: decision.id,
        title: decision.title,
        sourceType: "Decision Journal",
        preview: truncate(decision.reason || decision.expected_outcome || decision.outcome_summary),
        href: "/app?view=Intelligence%20View",
        meta: compact([decision.status, decision.owner, decision.related_kpi])
      })),
      ...recommendations.map((recommendation) => ({
        id: recommendation.id,
        title: recommendation.title,
        sourceType: "Recommendation",
        preview: truncate(recommendation.evidence || recommendation.expected_outcome || recommendation.outcome_summary),
        href: sourceHref(recommendation.source_type, recommendation.source_title || recommendation.title),
        meta: compact([recommendation.status, recommendation.priority, recommendation.related_module])
      }))
    ].slice(0, 6)
  );

  addGroup(
    groups,
    "Diagnostics",
    runMatches.map(({ run, outputText }) => ({
        id: run.id,
        title: run.agent_type.replace(/_/g, " "),
        sourceType: "Diagnostic Run",
        preview: truncate(outputText || run.error_message || "Saved Vaeroex result."),
        href: `/app/agents?run=${encodeURIComponent(run.id)}`,
        meta: compact([run.status, run.created_at])
      }))
  );

  const responseGroups: GlobalSearchGroup[] = GROUP_ORDER.map((label) => ({
    label,
    results: groups.get(label) || []
  })).filter((group) => group.results.length);

  let answer: GlobalSearchAnswer | null = null;

  if (shouldBuildAnswer) {
    if (useKpiOverviewAnswer) {
      const summary = answerKpiSummary || (await loadKpiOverviewData({ supabase, workspaceId })).summary;
      answer = buildKpiGlobalAnswer(query, summary, responseGroups);
    } else if (/\b(risk|risks|attention|priority|priorities)\b/i.test(query)) {
      answer = buildRiskAnswer(answerIssues, answerRecommendations, responseGroups);
    } else if (/\b(changed|change|this week|recently|latest)\b/i.test(query)) {
      answer = buildChangeAnswer({
        kpis: answerKpis,
        reports: answerReports,
        files: answerFiles,
        tasks: answerTasks,
        groups: responseGroups
      });
    } else {
      answer = buildGeneralBusinessAnswer(responseGroups);
    }
  }

  return NextResponse.json({ query, groups: responseGroups, answer });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = normalizeQuestion(body.query);

  if (query.length < 2) {
    return NextResponse.json({ error: "Enter a question for Vaeroex." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Vaeroex is temporarily unavailable." }, { status: 503 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace || !context.membership || context.membership.status !== "active") {
    return NextResponse.json({ error: "Workspace access is required." }, { status: 403 });
  }

  const workspaceId = context.activeWorkspace.id;
  const subscriptionStatus = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId });

  if (!subscriptionStatus.allowed) {
    return NextResponse.json({ error: "Subscription access is required." }, { status: 402 });
  }

  const rateLimit = await enforceRateLimit({
    action: "global.answer",
    limit: 20,
    windowSeconds: 10 * 60,
    requestHeaders: request.headers,
    userId: user.id,
    workspaceId,
    identifiers: [query.slice(0, 120)],
    metadata: { source: "global_search_or_ask" }
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rateLimit) }, { status: 429 });
  }

  const securityIntent = classifySecurityIntent(query);

  if (securityIntent.securitySensitive) {
    await logSecurityAuditEvent({
      supabase,
      workspaceId,
      userId: user.id,
      actionName: "global_answer.security_response",
      operationType: "SYSTEM",
      initiatedBy: "user",
      allowed: false,
      reasonBlocked: "Global Search or Ask request was classified as security sensitive.",
      metadata: {
        source: "global_search_or_ask",
        classification_category: securityIntent.category,
        classification_confidence: securityIntent.confidence
      } satisfies Json
    });

    return NextResponse.json({
      query,
      groups: [],
      answer: { kind: "security_response", directAnswer: securityResponseMessage() } satisfies GlobalSearchAnswer
    });
  }

  const kpiIntent = classifyKpiOverviewIntent(query);
  if (shouldUseKpiOverviewAnswer(query, kpiIntent)) {
    const { summary } = await loadKpiOverviewData({ supabase, workspaceId });
    return NextResponse.json({ query, groups: [], answer: buildKpiGlobalAnswer(query, summary, []) });
  }

  const queryPlan = planVaeroexQuery({ query });

  if (queryPlan.classification === "search_navigation") {
    return NextResponse.json({
      query,
      groups: [],
      answer: {
        kind: "navigation_answer",
        directAnswer: "Matching workspace records are shown in the search results.",
        evidenceNote: "Navigation requests use workspace search and do not call OpenAI."
      } satisfies GlobalSearchAnswer
    });
  }

  const boundedContext = await buildBoundedWorkspaceContext({ supabase, workspaceId, query, plan: queryPlan });
  let evidenceContext: EvidenceContext = {
    available: false,
    retrievalMode: "none" as const,
    chunks: [],
    maxChunks: 0,
    confidenceScore: boundedContext.structuredEvidenceCount ? 45 : 10,
    confidenceLabel: boundedContext.structuredEvidenceCount ? "Partial" : "Very Limited",
    limitations: boundedContext.limitations,
    dataGaps: boundedContext.structuredEvidenceCount ? [] : ["No matching structured workspace evidence was available."],
    policy: ["Use only the bounded structured context supplied for this question."]
  };

  if (queryPlan.requiresOpenAI && queryPlan.maxEvidenceChunks > 0) {
    evidenceContext = await buildWorkspaceEvidenceContext({
      supabase,
      workspaceId,
      query: boundedContext.evidenceQuery,
      maxChunks: queryPlan.maxEvidenceChunks,
      retrievalStrategy: queryPlan.tier === 2 ? "keyword_only" : "auto",
      embeddingTimeoutMs: queryPlan.tier === 3 ? 4_000 : 3_000
    });
  }

  const fallbackOutput = buildDeterministicBoundedAnswer({ query, context: boundedContext });
  const evidenceCount = boundedContext.structuredEvidenceCount + evidenceContext.chunks.length;
  const fallbackAnswer = answerFromOutput(fallbackOutput, evidenceCount, {
    kind: "business_answer",
    directAnswer: "Vaeroex did not find enough relevant workspace evidence to answer without guessing.",
    recommendationConfidence: confidenceFromEvidence(evidenceCount),
    evidenceNote: evidenceCount
      ? `This used ${evidenceCount} bounded evidence item${evidenceCount === 1 ? "" : "s"}.`
      : "No relevant structured or Learned Knowledge evidence was available."
  });

  if (!queryPlan.requiresOpenAI) {
    return NextResponse.json({ query, groups: [], answer: fallbackAnswer });
  }

  const limit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });

  if (limit.reached) {
    return NextResponse.json({ error: "This workspace has reached its monthly Vaeroex usage limit." }, { status: 429 });
  }

  const workflow = getVaeroexWorkflow("ask_vaeroex");
  const baseSettings = getOpenAIRetrySettings();
  const modelRoute = queryPlan.tier === 3 ? "cross_business_reasoning" as const : "focused_explanation" as const;
  const generationStartedAt = Date.now();

  try {
    const generation = await runVaeroexCompletionWithUsage({
      workflow,
      userPrompt: `Answer this exact question directly: ${query}\n\nUse only the bounded workspace context and retrieved evidence. Do not add generic management advice, unrelated recommendations, fabricated facts, or report sections. Return JSON with direct_answer, evidence_note, recommendation_confidence, limitations, and response_markdown.`,
      workspaceSnapshot: boundedContext.workspaceSnapshot,
      extraInputs: {
        query_plan: {
          classification: queryPlan.classification,
          tier: queryPlan.tier,
          domains: queryPlan.domains,
          retrieval_depth: queryPlan.retrievalDepth,
          context_token_budget: queryPlan.contextTokenBudget
        },
        evidence_context: evidenceContextAsJson(evidenceContext)
      } satisfies Json,
      supabase,
      workspaceId,
      modelRoute,
      executionPath: queryPlan.classification,
      maxOutputTokens: queryPlan.tier === 3 ? 1_000 : 650,
      openAISettings: {
        ...baseSettings,
        timeoutMs: Math.min(baseSettings.timeoutMs, queryPlan.timeoutMs),
        maxRetries: queryPlan.tier === 3 ? Math.min(baseSettings.maxRetries, 1) : 0
      }
    });

    await recordVaeroexAiUsage({
      supabase,
      workspaceId,
      userId: user.id,
      agentType: "global_search_or_ask",
      usage: {
        ...generation.usage,
        metadata: {
          ...(isRecord(generation.usage.metadata) ? generation.usage.metadata : {}),
          execution_tier: queryPlan.tier,
          execution_path: queryPlan.classification,
          data_domains: queryPlan.domains,
          loaded_domains: boundedContext.loadedDomains,
          bounded_context_ms: boundedContext.loadMs,
          estimated_context_tokens: boundedContext.estimatedContextTokens,
          evidence_count: evidenceCount,
          fallback_used: false
        }
      }
    });

    return NextResponse.json({
      query,
      groups: [],
      answer: answerFromOutput(generation.outputJson, evidenceCount, fallbackAnswer)
    });
  } catch (error) {
    if (isSecurityResponseMessage(error instanceof Error ? error.message : "")) {
      return NextResponse.json({
        query,
        groups: [],
        answer: { kind: "security_response", directAnswer: securityResponseMessage() } satisfies GlobalSearchAnswer
      });
    }

    await recordVaeroexAiUsage({
      supabase,
      workspaceId,
      userId: user.id,
      agentType: "global_search_or_ask",
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
          evidence_count: evidenceCount,
          timeout: /timed out|timeout|abort/i.test(error instanceof Error ? error.message : ""),
          fallback_used: true
        }
      }
    });

    const fallbackWithReason = buildDeterministicBoundedAnswer({
      query,
      context: boundedContext,
      failureReason: "The deeper analysis was unavailable, so Vaeroex returned the bounded workspace evidence it could verify."
    });

    return NextResponse.json({
      query,
      groups: [],
      answer: answerFromOutput(fallbackWithReason, evidenceCount, fallbackAnswer)
    });
  }
}
