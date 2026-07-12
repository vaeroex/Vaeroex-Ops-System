import type { Database } from "@/lib/supabase/types";
import { buildKpiForecastEligibility, type KpiForecastReadinessState } from "@/lib/kpis/forecast-eligibility";
import {
  filterBusinessEvidence,
  filterOriginalBusinessEvidence,
  sanitizeBusinessEvidenceText
} from "@/lib/intelligence/evidence-eligibility";

type TableRow<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

export type BusinessIntelligenceCoverageCategoryId =
  | "revenue"
  | "financials"
  | "operations"
  | "customers"
  | "sales_pipeline"
  | "processes"
  | "staffing"
  | "issues_risks"
  | "historical_trends"
  | "business_memory";

export type BusinessIntelligenceConfidenceLabel =
  | "Very Limited"
  | "Learning"
  | "Partial"
  | "Good"
  | "Strong"
  | "High Confidence";

export type BusinessIntelligenceCoverageItem = {
  id: BusinessIntelligenceCoverageCategoryId;
  label: string;
  coverage: number;
  confidenceLabel: BusinessIntelligenceConfidenceLabel;
  sourceCount: number;
  lastUpdated: string | null;
  dataQualityLabel: string;
  recommendedNextUpload: string;
  reason: string;
  sourceTypes: string[];
  evidence: string[];
  historyMonths: number;
  structuredSourceCount: number;
  forecastReady: boolean;
};

export type BusinessIntelligenceCoverageResult = {
  overallCoverage: number;
  overallConfidenceLabel: BusinessIntelligenceConfidenceLabel;
  overallReason: string;
  categories: BusinessIntelligenceCoverageItem[];
  confidenceOverTime: Array<{
    label: string;
    value: number;
    sourceCount: number;
  }>;
  sourceMix: Array<{
    label: string;
    count: number;
    percentage: number;
  }>;
  evidenceSummary: {
    originalEvidenceCount: number;
    memoryItemCount: number;
    derivedFindingCount: number;
  };
  dataGaps: string[];
  recommendedNextUpload: string;
  forecastReadiness: {
    ready: boolean;
    directional: boolean;
    state: KpiForecastReadinessState;
    label: string;
    reason: string;
    currentKpiCount: number;
    totalMeasurementCount: number;
    readyKpiCount: number;
    directionalKpiCount: number;
    historicalDepthLabel: string;
    freshnessLabel: string;
  };
};

export type BusinessIntelligenceCoverageInput = {
  kpis?: TableRow<"kpis">[];
  tasks?: TableRow<"tasks">[];
  issues?: TableRow<"issues">[];
  checklists?: TableRow<"checklists">[];
  checklistRuns?: TableRow<"checklist_runs">[];
  files?: TableRow<"file_uploads">[];
  imports?: TableRow<"file_imports">[];
  sops?: TableRow<"sops">[];
  forms?: TableRow<"forms">[];
  submissions?: TableRow<"form_submissions">[];
  people?: TableRow<"people">[];
  crmLeads?: TableRow<"crm_leads">[];
  crmHistory?: TableRow<"crm_lead_history">[];
  reports?: TableRow<"reports">[];
  vaeroexRuns?: TableRow<"ai_agent_runs">[];
  operationalMetrics?: TableRow<"operational_metrics">[];
  assets?: TableRow<"assets">[];
  decisions?: TableRow<"business_decisions">[];
  recommendationOutcomes?: TableRow<"vaeroex_recommendation_outcomes">[];
  memoryChunks?: TableRow<"business_memory_chunks">[];
};

type EvidenceSource = {
  key: string;
  label: string;
  type: string;
  date: string | null;
  structured: boolean;
  quality: "strong" | "developing" | "limited";
  text: string;
};

const CATEGORY_LABELS: Record<BusinessIntelligenceCoverageCategoryId, string> = {
  revenue: "Revenue",
  financials: "Financials",
  operations: "Operations",
  customers: "Customers",
  sales_pipeline: "Customer Revenue Context",
  processes: "Processes / SOPs",
  staffing: "Staffing / People",
  issues_risks: "Issues / Risks",
  historical_trends: "Historical Trends",
  business_memory: "Business Memory"
};

const NEXT_UPLOADS: Record<BusinessIntelligenceCoverageCategoryId, string> = {
  revenue: "Upload 6-12 months of revenue history to improve revenue confidence and avoid weak forecasting.",
  financials: "Upload recent P&L, expense, margin, cost, or cash-flow summaries to improve financial understanding.",
  operations: "Upload operating logs, checklist results, job volume, service activity, or recurring workflow data.",
  customers: "Upload customer complaint, support, retention, or account activity data to improve customer risk detection.",
  sales_pipeline: "Upload customer activity, conversion, revenue, win/loss, and response history.",
  processes: "Upload SOPs, process docs, checklists, or recurring procedures to improve process recommendations.",
  staffing: "Add people, role, department, schedule, utilization, staffing, or assignment context.",
  issues_risks: "Add issue logs, risk reviews, incident summaries, blockers, or unresolved problem history.",
  historical_trends: "Upload multiple months of KPI, revenue, sales, customer, or operating history.",
  business_memory: "Save briefings, decisions, outcomes, and source files so Vaeroex can compare what changed over time."
};

const HISTORY_REQUIRED = new Set<BusinessIntelligenceCoverageCategoryId>([
  "revenue",
  "financials",
  "customers",
  "sales_pipeline",
  "historical_trends",
  "business_memory"
]);

function activeRows<T>(rows: T[] = []) {
  return filterOriginalBusinessEvidence(rows as Array<T & { archived_at?: string | null; deleted_at?: string | null }>);
}

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function includesAny(value: string, keywords: string[]) {
  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}

function latestDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function monthKey(value: string | null | undefined) {
  const date = dateOnly(value);
  return date ? date.slice(0, 7) : null;
}

function monthsBetween(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const startDate = new Date(`${start.slice(0, 10)}T12:00:00.000Z`);
  const endDate = new Date(`${end.slice(0, 10)}T12:00:00.000Z`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;

  return Math.max(
    1,
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      endDate.getUTCMonth() -
      startDate.getUTCMonth() +
      1
  );
}

function recencyScore(dates: Array<string | null>) {
  const latest = latestDate(dates);
  if (!latest) return 0;

  const ageDays = (Date.now() - new Date(`${latest}T12:00:00.000Z`).getTime()) / 86400000;
  if (ageDays <= 45) return 10;
  if (ageDays <= 120) return 6;
  if (ageDays <= 365) return 3;
  return 0;
}

function confidenceLabel(score: number): BusinessIntelligenceConfidenceLabel {
  if (score <= 25) return "Very Limited";
  if (score <= 45) return "Learning";
  if (score <= 65) return "Partial";
  if (score <= 80) return "Good";
  if (score <= 90) return "Strong";
  return "High Confidence";
}

function qualityLabel(score: number, sourceCount: number, historyMonths: number, sourceTypeCount: number) {
  if (!sourceCount) return "No source data yet";
  if (sourceCount === 1) return "Single source only";
  if (historyMonths <= 1) return "Needs more history";
  if (score <= 45) return "Learning from limited data";
  if (score <= 65) return "Partial source coverage";
  if (sourceTypeCount < 3) return "Good, but narrow source mix";
  if (historyMonths >= 6) return "Good historical coverage";
  return "Recent source coverage";
}

function evidence(key: string, label: string, type: string, date: string | null | undefined, structured: boolean, quality: EvidenceSource["quality"], text = ""): EvidenceSource {
  return {
    key,
    label,
    type,
    date: dateOnly(date),
    structured,
    quality,
    text: lower(`${label} ${type} ${text}`)
  };
}

function uniqueSources(sources: EvidenceSource[]) {
  const unique = new Map<string, EvidenceSource>();
  for (const source of sources) {
    const current = unique.get(source.key);
    if (!current || (source.date || "") > (current.date || "")) unique.set(source.key, source);
  }
  return [...unique.values()];
}

function historyStats(sources: EvidenceSource[]) {
  const months = Array.from(new Set(sources.map((source) => monthKey(source.date)).filter((value): value is string => Boolean(value)))).sort();
  const spanMonths = monthsBetween(months[0] ? `${months[0]}-01` : null, months.at(-1) ? `${months.at(-1)}-01` : null);

  return {
    distinctMonths: months.length,
    spanMonths: Math.max(months.length, spanMonths)
  };
}

function scoreCoverage(id: BusinessIntelligenceCoverageCategoryId, sources: EvidenceSource[], outcomes = 0) {
  const sourceCount = sources.length;
  const sourceTypes = Array.from(new Set(sources.map((source) => source.type))).sort();
  const structuredCount = sources.filter((source) => source.structured).length;
  const dates = sources.map((source) => source.date);
  const { spanMonths } = historyStats(sources);
  const strongQualityCount = sources.filter((source) => source.quality === "strong").length;
  const sourceScore = sourceCount === 0 ? 0 : sourceCount === 1 ? 14 : sourceCount === 2 ? 21 : sourceCount <= 5 ? 29 : 36;
  const diversityScore = Math.min(20, Math.max(0, sourceTypes.length - 1) * 7);
  const structuredScore = sourceCount ? Math.round((structuredCount / sourceCount) * 14) : 0;
  const historyScore = spanMonths >= 12 ? 24 : spanMonths >= 6 ? 18 : spanMonths >= 3 ? 12 : spanMonths >= 2 ? 7 : 0;
  const qualityScore = sourceCount ? Math.min(10, Math.round((strongQualityCount / sourceCount) * 10)) : 0;
  const outcomeScore = Math.min(8, outcomes * 2);
  const raw = sourceScore + diversityScore + structuredScore + historyScore + recencyScore(dates) + qualityScore + outcomeScore;
  let cap = 100;

  if (sourceCount === 0) cap = 18;
  else if (sourceCount === 1) cap = 45;
  else if (sourceCount === 2) cap = 58;
  else if (sourceTypes.length < 2) cap = 68;

  if (HISTORY_REQUIRED.has(id) && spanMonths < 3) cap = Math.min(cap, sourceCount <= 2 ? 50 : 64);
  if (id === "historical_trends" && spanMonths < 6) cap = Math.min(cap, 45);
  if (id === "business_memory" && sourceTypes.length < 4) cap = Math.min(cap, 72);
  if (spanMonths < 6) cap = Math.min(cap, 88);
  if (sourceCount < 10 || sourceTypes.length < 3 || (HISTORY_REQUIRED.has(id) && spanMonths < 12)) cap = Math.min(cap, 90);

  return Math.max(0, Math.min(100, cap, raw));
}

function buildItem({
  id,
  sources,
  outcomes = 0,
  recommendedNextUpload = NEXT_UPLOADS[id]
}: {
  id: BusinessIntelligenceCoverageCategoryId;
  sources: EvidenceSource[];
  outcomes?: number;
  recommendedNextUpload?: string;
}): BusinessIntelligenceCoverageItem {
  sources = uniqueSources(sources);
  const coverage = scoreCoverage(id, sources, outcomes);
  const sourceTypes = Array.from(new Set(sources.map((source) => source.type))).sort();
  const { spanMonths } = historyStats(sources);
  const structuredSourceCount = sources.filter((source) => source.structured).length;
  const lastUpdated = latestDate(sources.map((source) => source.date));
  const lowReason = sources.length
    ? `${sources.length} source${sources.length === 1 ? "" : "s"}, ${sourceTypes.length} source type${sourceTypes.length === 1 ? "" : "s"}, and ${spanMonths} month${spanMonths === 1 ? "" : "s"} of history are available.`
    : "No reliable source data is available for this category yet.";
  const historyCaution =
    HISTORY_REQUIRED.has(id) && spanMonths < 6
      ? " Confidence is limited because Vaeroex needs more historical depth before forecasting responsibly."
      : "";

  return {
    id,
    label: CATEGORY_LABELS[id],
    coverage,
    confidenceLabel: confidenceLabel(coverage),
    sourceCount: sources.length,
    lastUpdated,
    dataQualityLabel: qualityLabel(coverage, sources.length, spanMonths, sourceTypes.length),
    recommendedNextUpload,
    reason: `${lowReason}${historyCaution}`,
    sourceTypes,
    evidence: sources
      .slice(0, 5)
      .map((source) => `${source.label}${source.date ? ` (${source.date})` : ""}`),
    historyMonths: spanMonths,
    structuredSourceCount,
    forecastReady: sources.length >= 6 && spanMonths >= 6 && structuredSourceCount >= 4
  };
}

function sourceText(...values: Array<string | null | undefined>) {
  return lower(values.filter(Boolean).join(" "));
}

function kpiSources(kpis: TableRow<"kpis">[], keywords: string[], fallbackType = "KPIs") {
  return activeRows(kpis)
    .filter((kpi) => includesAny(sourceText(kpi.name, kpi.category, kpi.source, kpi.notes), keywords))
    .map((kpi) =>
      evidence(`kpi:${kpi.source_file_id || kpi.import_id || "manual"}:${lower(kpi.name)}`, `${kpi.name} KPI`, fallbackType, kpi.metric_date || kpi.updated_at || kpi.created_at, Boolean(kpi.actual_value !== null || kpi.target !== null), kpi.source_file_id || kpi.import_id ? "strong" : "developing", sourceText(kpi.category, kpi.source, kpi.notes))
    );
}

function operationalMetricSources(metrics: TableRow<"operational_metrics">[], keywords: string[], type = "Operational Metrics") {
  return activeRows(metrics)
    .filter((metric) => includesAny(sourceText(metric.metric_name, metric.category, metric.notes), keywords))
    .map((metric) =>
      evidence(`metric:${metric.source_file_id || metric.import_id || "manual"}:${lower(metric.metric_name)}`, `${metric.metric_name} metric`, type, metric.metric_date || metric.updated_at || metric.created_at, true, metric.source_file_id || metric.import_id ? "strong" : "developing", sourceText(metric.category, metric.notes))
    );
}

function fileSources(files: TableRow<"file_uploads">[], keywords: string[], type = "Files") {
  return activeRows(files)
    .filter((file) => includesAny(sourceText(file.display_name, file.original_name, file.import_type, sanitizeBusinessEvidenceText(file.analysis_summary), file.file_extension), keywords))
    .map((file) =>
      evidence(`file:${file.id}`, file.display_name, type, file.processed_at || file.updated_at || file.created_at, ["csv", "xlsx"].includes(lower(file.file_extension)) || file.imported_rows > 0, file.imported_rows > 0 || file.processing_status === "ready" ? "strong" : "developing", sourceText(file.import_type, sanitizeBusinessEvidenceText(file.analysis_summary), file.file_extension))
    );
}

function reportSources(reports: TableRow<"reports">[], keywords: string[], type = "Reports") {
  return activeRows(reports)
    .filter((report) => includesAny(sourceText(report.title, report.report_type, report.body_markdown), keywords))
    .map((report) => evidence(`report:${report.id}`, report.title, type, report.date_range_end || report.created_at, false, report.body_markdown ? "developing" : "limited", sourceText(report.report_type, report.body_markdown)));
}

function makeSourceMix(input: BusinessIntelligenceCoverageInput) {
  const kpiSeries = uniqueSources((input.kpis || []).map((kpi) => evidence(`kpi:${kpi.source_file_id || kpi.import_id || "manual"}:${lower(kpi.name)}`, kpi.name, "KPI series", kpi.metric_date || kpi.created_at, true, kpi.source_file_id || kpi.import_id ? "strong" : "developing")));
  const rows = [
    { label: "KPI series", count: kpiSeries.length },
    { label: "Files", count: activeRows(input.files || []).length },
    { label: "Reports", count: activeRows(input.reports || []).length },
    { label: "SOPs", count: activeRows(input.sops || []).length },
    { label: "Business Signals", count: activeRows(input.tasks || []).length },
    { label: "Financials", count: activeRows(input.operationalMetrics || []).filter((metric) => includesAny(sourceText(metric.metric_name, metric.category), ["revenue", "cost", "expense", "profit", "margin", "cash", "financial"])).length },
    { label: "Issues", count: activeRows(input.issues || []).length },
    { label: "People context", count: activeRows(input.people || []).length }
  ].filter((row) => row.count > 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;

  return rows.map((row) => ({
    ...row,
    percentage: Math.round((row.count / total) * 100)
  }));
}

function makeConfidenceOverTime(input: BusinessIntelligenceCoverageInput) {
  const events: Array<{ date: string; type: string; structured: boolean }> = [
    ...activeRows(input.kpis || []).map((row) => ({ date: row.metric_date || row.created_at, type: "KPI", structured: true })),
    ...activeRows(input.files || []).map((row) => ({ date: row.created_at, type: "File", structured: row.imported_rows > 0 || ["csv", "xlsx"].includes(lower(row.file_extension)) })),
    ...activeRows(input.reports || []).map((row) => ({ date: row.created_at, type: "Report", structured: false })),
    ...activeRows(input.sops || []).map((row) => ({ date: row.updated_at || row.created_at, type: "SOP", structured: false })),
    ...activeRows(input.operationalMetrics || []).map((row) => ({ date: row.metric_date || row.created_at, type: "Metric", structured: true })),
    ...activeRows(input.issues || []).map((row) => ({ date: row.updated_at || row.created_at, type: "Issue", structured: true }))
  ].filter((event) => Boolean(event.date));
  const byMonth = new Map<string, { sourceCount: number; structured: number; types: Set<string> }>();

  for (const event of events) {
    const key = monthKey(event.date);
    if (!key) continue;
    const current = byMonth.get(key) || { sourceCount: 0, structured: 0, types: new Set<string>() };
    current.sourceCount += 1;
    current.structured += event.structured ? 1 : 0;
    current.types.add(event.type);
    byMonth.set(key, current);
  }

  let cumulativeSources = 0;
  let cumulativeStructured = 0;
  const cumulativeTypes = new Set<string>();
  const points = Array.from(byMonth.entries()).sort().map(([label, item], index) => {
    cumulativeSources += item.sourceCount;
    cumulativeStructured += item.structured;
    item.types.forEach((type) => cumulativeTypes.add(type));
    const historyBonus = Math.min(24, (index + 1) * 4);
    const value = Math.min(
      100,
      Math.round(Math.min(38, cumulativeSources * 3) + Math.min(20, cumulativeTypes.size * 5) + Math.min(18, cumulativeStructured * 2) + historyBonus)
    );

    return {
      label,
      value: cumulativeSources <= 1 ? Math.min(value, 35) : cumulativeSources <= 2 ? Math.min(value, 45) : value,
      sourceCount: cumulativeSources
    };
  });

  return points.slice(-8);
}

export function buildBusinessIntelligenceCoverage(input: BusinessIntelligenceCoverageInput): BusinessIntelligenceCoverageResult {
  const derivedFindingCount =
    filterBusinessEvidence(input.vaeroexRuns || [], { sourceKind: "platform_run" }).length +
    filterBusinessEvidence(input.decisions || []).length +
    filterBusinessEvidence(input.recommendationOutcomes || []).length;
  input = {
    ...input,
    kpis: activeRows(input.kpis || []),
    tasks: activeRows(input.tasks || []),
    issues: activeRows(input.issues || []),
    checklists: activeRows(input.checklists || []),
    checklistRuns: activeRows(input.checklistRuns || []),
    files: activeRows(input.files || []),
    imports: activeRows(input.imports || []),
    sops: activeRows(input.sops || []),
    forms: activeRows(input.forms || []),
    submissions: activeRows(input.submissions || []),
    people: activeRows(input.people || []),
    crmLeads: activeRows(input.crmLeads || []),
    crmHistory: activeRows(input.crmHistory || []),
    reports: activeRows(input.reports || []),
    vaeroexRuns: [],
    operationalMetrics: activeRows(input.operationalMetrics || []),
    assets: activeRows(input.assets || []),
    decisions: [],
    recommendationOutcomes: []
  };
  const revenueKeywords = ["revenue", "sales", "income", "booking", "invoice", "receivable", "arpu", "arr", "mrr"];
  const financialKeywords = ["financial", "expense", "cost", "profit", "margin", "cash", "payroll", "budget", "p&l", "loss", "invoice", "revenue"];
  const operationsKeywords = ["operation", "job", "work order", "checklist", "task", "service", "volume", "utilization", "dispatch", "route", "inspection", "asset"];
  const customerKeywords = ["customer", "client", "complaint", "support", "service", "retention", "satisfaction", "csat", "nps", "account"];
  const salesKeywords = ["lead", "pipeline", "conversion", "proposal", "quote", "estimate", "won", "lost", "sales"];
  const processKeywords = ["sop", "process", "procedure", "checklist", "workflow", "standard", "policy"];
  const staffingKeywords = ["staff", "employee", "people", "person", "role", "department", "labor", "utilization", "schedule", "capacity"];
  const riskKeywords = ["risk", "issue", "incident", "blocker", "failure", "complaint", "overdue", "missed", "critical", "problem"];

  const revenueSources = [
    ...kpiSources(input.kpis || [], revenueKeywords),
    ...operationalMetricSources(input.operationalMetrics || [], revenueKeywords, "Financial Metrics"),
    ...fileSources(input.files || [], revenueKeywords),
    ...reportSources(input.reports || [], revenueKeywords)
  ];
  const financialSources = [
    ...kpiSources(input.kpis || [], financialKeywords),
    ...operationalMetricSources(input.operationalMetrics || [], financialKeywords, "Financial Metrics"),
    ...fileSources(input.files || [], financialKeywords),
    ...reportSources(input.reports || [], financialKeywords)
  ];
  const operationsSources = [
    ...kpiSources(input.kpis || [], operationsKeywords),
    ...operationalMetricSources(input.operationalMetrics || [], operationsKeywords),
    ...activeRows(input.tasks || []).slice(0, 80).map((task) => evidence(`signal:${task.id}`, task.title, "Business Signals", task.updated_at || task.created_at, true, "developing", sourceText(task.description, task.category))),
    ...fileSources(input.files || [], operationsKeywords),
    ...reportSources(input.reports || [], operationsKeywords)
  ];
  const customerSources = [
    ...activeRows(input.crmLeads || []).filter((lead) => Boolean(lead.source_file_id || lead.import_id)).map((lead) => evidence(`customer:${lead.source_file_id || lead.import_id}`, lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name, "Imported customer activity", lead.last_activity_at || lead.updated_at || lead.created_at, true, "strong", sourceText(lead.status, lead.notes))),
    ...kpiSources(input.kpis || [], customerKeywords, "Customer KPIs"),
    ...fileSources(input.files || [], customerKeywords),
    ...reportSources(input.reports || [], customerKeywords)
  ];
  const salesSources = [
    ...activeRows(input.crmLeads || []).filter((lead) => Boolean(lead.source_file_id || lead.import_id)).map((lead) => evidence(`customer:${lead.source_file_id || lead.import_id}`, lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name, "Imported customer activity", lead.last_activity_at || lead.updated_at || lead.created_at, true, "strong", sourceText(lead.status, lead.notes))),
    ...kpiSources(input.kpis || [], salesKeywords, "Sales KPIs"),
    ...fileSources(input.files || [], salesKeywords),
    ...reportSources(input.reports || [], salesKeywords)
  ];
  const processSources = [
    ...(input.sops || []).map((sop) => evidence(`sop:${sop.id}`, sop.title, "SOPs", sop.updated_at || sop.created_at, false, sop.body_markdown ? "developing" : "limited", sourceText(sop.department, sop.category, sop.body_markdown))),
    ...fileSources(input.files || [], processKeywords, "Process Files"),
    ...reportSources(input.reports || [], processKeywords, "Process Reports")
  ];
  const staffingSources = [
    ...activeRows(input.people || []).map((person) => evidence(`person:${person.id}`, person.full_name, "People", person.updated_at || person.created_at, true, person.role_title || person.department ? "strong" : "developing", sourceText(person.role_title, person.department, person.status))),
    ...operationalMetricSources(input.operationalMetrics || [], staffingKeywords, "Staffing Metrics"),
    ...fileSources(input.files || [], staffingKeywords, "Staffing Files"),
    ...reportSources(input.reports || [], staffingKeywords, "Staffing Reports")
  ];
  const riskSources = [
    ...(input.issues || []).map((issue) => evidence(`issue:${issue.id}`, issue.title, "Issues", issue.updated_at || issue.created_at, true, issue.root_cause || issue.recommended_fix ? "strong" : "developing", sourceText(issue.description, issue.issue_type, issue.severity, issue.root_cause, issue.recommended_fix))),
    ...activeRows(input.tasks || []).filter((task) => includesAny(sourceText(task.title, task.description, task.category, task.status), riskKeywords)).map((task) => evidence(`signal:${task.id}`, task.title, "Risk Business Signals", task.updated_at || task.created_at, true, "developing", sourceText(task.description, task.category, task.status))),
    ...fileSources(input.files || [], riskKeywords, "Risk Files"),
    ...reportSources(input.reports || [], riskKeywords, "Risk Reports"),
  ];
  const historicalSources = [
    ...activeRows(input.kpis || []).map((kpi) => evidence(`kpi:${kpi.source_file_id || kpi.import_id || "manual"}:${lower(kpi.name)}`, `${kpi.name} history`, "KPI History", kpi.metric_date || kpi.created_at, true, kpi.source_file_id || kpi.import_id ? "strong" : "developing", sourceText(kpi.category, kpi.source))),
    ...activeRows(input.operationalMetrics || []).map((metric) => evidence(`metric:${metric.source_file_id || metric.import_id || "manual"}:${lower(metric.metric_name)}`, `${metric.metric_name} history`, "Metric History", metric.metric_date || metric.created_at, true, metric.source_file_id || metric.import_id ? "strong" : "developing", sourceText(metric.category))),
    ...(input.reports || []).filter((report) => report.date_range_start || report.date_range_end).map((report) => evidence(`report:${report.id}`, report.title, "Period Reports", report.date_range_end || report.created_at, false, "developing", sourceText(report.report_type)))
  ];
  const businessMemorySources = [
    ...revenueSources.slice(0, 25),
    ...financialSources.slice(0, 25),
    ...operationsSources.slice(0, 40),
    ...customerSources.slice(0, 40),
    ...processSources.slice(0, 30),
    ...riskSources.slice(0, 40),
    ...uniqueSources([...revenueSources, ...financialSources, ...operationsSources, ...customerSources, ...processSources, ...riskSources])
  ];

  const categories = [
    buildItem({ id: "revenue", sources: revenueSources }),
    buildItem({ id: "financials", sources: financialSources }),
    buildItem({ id: "operations", sources: operationsSources }),
    buildItem({ id: "customers", sources: customerSources }),
    buildItem({ id: "sales_pipeline", sources: salesSources }),
    buildItem({ id: "processes", sources: processSources }),
    buildItem({ id: "staffing", sources: staffingSources }),
    buildItem({ id: "issues_risks", sources: riskSources }),
    buildItem({ id: "historical_trends", sources: historicalSources }),
    buildItem({ id: "business_memory", sources: businessMemorySources, outcomes: activeRows(input.decisions || []).length + activeRows(input.recommendationOutcomes || []).length })
  ];
  const overallCoverage = Math.round(categories.reduce((sum, item) => sum + item.coverage, 0) / categories.length);
  const allOriginalEvidence = uniqueSources([
    ...activeRows(input.kpis || []).map((kpi) => evidence(`kpi:${kpi.source_file_id || kpi.import_id || "manual"}:${lower(kpi.name)}`, kpi.name, "KPI series", kpi.metric_date || kpi.created_at, true, kpi.source_file_id || kpi.import_id ? "strong" : "developing")),
    ...activeRows(input.files || []).map((file) => evidence(`file:${file.id}`, file.display_name, "Files", file.processed_at || file.created_at, true, "strong")),
    ...activeRows(input.reports || []).map((report) => evidence(`report:${report.id}`, report.title, "Reports", report.date_range_end || report.created_at, false, "developing")),
    ...activeRows(input.sops || []).map((sop) => evidence(`sop:${sop.id}`, sop.title, "SOPs", sop.updated_at || sop.created_at, false, "developing")),
    ...activeRows(input.tasks || []).map((task) => evidence(`signal:${task.id}`, task.title, "Business Signals", task.updated_at || task.created_at, true, "developing")),
    ...activeRows(input.issues || []).map((issue) => evidence(`issue:${issue.id}`, issue.title, "Issues", issue.updated_at || issue.created_at, true, "developing")),
    ...activeRows(input.operationalMetrics || []).map((metric) => evidence(`metric:${metric.source_file_id || metric.import_id || "manual"}:${lower(metric.metric_name)}`, metric.metric_name, "Operational metrics", metric.metric_date || metric.created_at, true, metric.source_file_id || metric.import_id ? "strong" : "developing"))
  ]);
  const activeSignalIds = new Set(activeRows(input.tasks || []).map((signal) => signal.id));
  const activeFileIds = new Set(activeRows(input.files || []).map((file) => file.id));
  const memoryItemCount = filterBusinessEvidence(input.memoryChunks || []).filter((chunk) => {
    const sourceType = lower(chunk.source_type);
    if (sourceType.includes("signal") || sourceType === "task") return Boolean(chunk.source_id && activeSignalIds.has(chunk.source_id));
    if (chunk.source_file_id) return activeFileIds.has(chunk.source_file_id);
    return sourceType !== "platform_run" && sourceType !== "ai_agent_run";
  }).length;
  const weakestCategories = categories.filter((item) => item.coverage < 46).sort((a, b) => a.coverage - b.coverage).slice(0, 5);
  const dataGaps = weakestCategories.map((item) => `${item.label}: ${item.reason}`);
  const nextCategory = weakestCategories[0] || categories.sort((a, b) => a.coverage - b.coverage)[0];
  const forecastEligibility = buildKpiForecastEligibility(activeRows(input.kpis || []));

  return {
    overallCoverage,
    overallConfidenceLabel: confidenceLabel(overallCoverage),
    overallReason:
      overallCoverage <= 45
        ? "Vaeroex is still learning. Current confidence is intentionally limited until more reliable source data and history are available."
        : overallCoverage <= 65
          ? "Vaeroex has partial understanding, but several categories still need broader or older source data."
          : "Vaeroex has useful coverage, but recommendations should still be reviewed against source evidence.",
    categories,
    confidenceOverTime: makeConfidenceOverTime(input),
    sourceMix: makeSourceMix(input),
    evidenceSummary: {
      originalEvidenceCount: allOriginalEvidence.length,
      memoryItemCount,
      derivedFindingCount
    },
    dataGaps: dataGaps.length ? dataGaps : ["No major coverage gap is visible, but Vaeroex still benefits from updated source data and outcome history."],
    recommendedNextUpload: nextCategory?.recommendedNextUpload || NEXT_UPLOADS.business_memory,
    forecastReadiness: {
      ready: forecastEligibility.ready,
      directional: forecastEligibility.directional,
      state: forecastEligibility.state,
      label: forecastEligibility.label,
      reason: forecastEligibility.reason,
      currentKpiCount: forecastEligibility.currentKpiCount,
      totalMeasurementCount: forecastEligibility.totalMeasurementCount,
      readyKpiCount: forecastEligibility.readyKpiCount,
      directionalKpiCount: forecastEligibility.directionalKpiCount,
      historicalDepthLabel: forecastEligibility.historicalDepthLabel,
      freshnessLabel: forecastEligibility.freshnessLabel
    }
  };
}
