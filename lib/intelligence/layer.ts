import type { Database } from "@/lib/supabase/types";
import { buildKpiForecastEligibility, type KpiForecastEligibilitySummary } from "@/lib/kpis/forecast-eligibility";
import { filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildSourceParentEligibility, filterBySourceParentEligibility } from "@/lib/intelligence/source-parent-eligibility";
import { businessSignalMatchesEvidenceScope, isOpenBusinessSignal } from "@/lib/intelligence/business-signal-evidence";

export type IntelligenceInsightType = "Risk" | "Opportunity" | "Forecast" | "Bottleneck" | "Recommendation" | "Anomaly";
export type IntelligenceConfidence = "High" | "Medium" | "Low";

export type IntelligenceEvidenceRecord = {
  id: string;
  title: string;
  recordType: string;
  date: string;
  value: string;
  support: string;
  href: string;
  classification: "Original" | "Manual" | "Derived";
  sourceKey: string;
  groupHint?: string;
};

export type IntelligenceInsight = {
  id: string;
  type: IntelligenceInsightType;
  title: string;
  summary: string;
  why: string;
  impact: string;
  recommendedAction: string;
  confidence: IntelligenceConfidence;
  evidence: string[];
  evidenceCount: number;
  supportingRecords: IntelligenceEvidenceRecord[];
  independentSourceCount: number;
  contradictoryEvidence: string[];
  missingEvidence: string[];
  sourceTypes: string[];
  sourceHref: string;
  priority: "High" | "Medium" | "Low";
  lastUpdated: string;
  affectedArea: string;
  timePeriod: string;
  limitation: string;
  fingerprint: string;
  suggestedNextData?: string;
};

export type IntelligenceLayerResult = {
  executiveSummary: string;
  businessHealth: {
    available: boolean;
    score: number;
    status: "Strong" | "Watch" | "At Risk" | "Insufficient Data";
    trend: "Improving" | "Holding steady" | "Declining" | "Not enough history";
  };
  dataQuality: {
    score: number;
    label: "Strong" | "Developing" | "Limited";
    confidence: IntelligenceConfidence;
    reason: string;
    suggestedNextData: string[];
  };
  forecastReadiness: Pick<
    KpiForecastEligibilitySummary,
    | "state"
    | "label"
    | "reason"
    | "ready"
    | "directional"
    | "currentKpiCount"
    | "totalMeasurementCount"
    | "readyKpiCount"
    | "directionalKpiCount"
    | "historicalDepthLabel"
    | "freshnessLabel"
  >;
  topRisk?: IntelligenceInsight;
  topOpportunity?: IntelligenceInsight;
  topRecommendation?: IntelligenceInsight;
  topForecast?: IntelligenceInsight;
  insights: IntelligenceInsight[];
  memorySummary: {
    profileSignals: number;
    sourceRecords: number;
    kpiHistoryRecords: number;
    reports: number;
    vaeroexRuns: number;
    decisions: number;
    recommendationOutcomes: number;
  };
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormSubmissionRow = Database["public"]["Tables"]["form_submissions"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type DecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];

export type IntelligenceLayerInput = {
  workspace?: {
    name?: string | null;
    industry?: string | null;
    size?: string | null;
  } | null;
  kpis?: KpiRow[];
  tasks?: TaskRow[];
  issues?: IssueRow[];
  files?: FileUploadRow[];
  reports?: ReportRow[];
  vaeroexRuns?: VaeroexRunRow[];
  crmLeads?: CrmLeadRow[];
  imports?: FileImportRow[];
  sops?: SopRow[];
  forms?: FormRow[];
  submissions?: FormSubmissionRow[];
  people?: PersonRow[];
  decisions?: DecisionRow[];
  recommendationOutcomes?: RecommendationOutcomeRow[];
};

const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function isClosed(value: string | null | undefined) {
  return ["closed", "done", "complete", "completed", "converted", "won", "dismissed"].includes(lower(value));
}

function isOverdue(date: string | null | undefined) {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

function priorityFrom(value: string | null | undefined): "High" | "Medium" | "Low" {
  const normalized = lower(value);

  if (normalized.includes("urgent") || normalized.includes("high")) return "High";
  if (normalized.includes("medium") || normalized.includes("review") || normalized.includes("waiting")) return "Medium";
  return "Low";
}

function formatMetric(value: number | null, name: string) {
  if (value === null) return "not set";
  return /revenue|cost|value|sales/i.test(name) ? currencyFormatter.format(value) : numberFormatter.format(value);
}

function latestKpisByName(kpis: KpiRow[]) {
  const map = new Map<string, KpiRow>();

  for (const kpi of [...kpis].sort((a, b) => b.metric_date.localeCompare(a.metric_date))) {
    if (!map.has(kpi.name)) {
      map.set(kpi.name, kpi);
    }
  }

  return Array.from(map.values());
}

function kpiHistoryCounts(kpis: KpiRow[]) {
  const map = new Map<string, number>();

  for (const kpi of kpis) {
    map.set(kpi.name, (map.get(kpi.name) || 0) + 1);
  }

  return map;
}

function kpiHistoryByName(kpis: KpiRow[]) {
  const map = new Map<string, KpiRow[]>();

  for (const kpi of [...kpis].sort((a, b) => b.metric_date.localeCompare(a.metric_date))) {
    map.set(kpi.name, [...(map.get(kpi.name) || []), kpi]);
  }

  return map;
}

function recordClassification(row: { source_file_id?: string | null; import_id?: string | null; ai_generated?: boolean | null }) {
  if (row.ai_generated) return "Derived" as const;
  if (row.source_file_id || row.import_id) return "Original" as const;
  return "Manual" as const;
}

function evidenceRecord({
  id,
  title,
  recordType,
  date,
  value,
  support,
  href,
  sourceKey,
  groupHint,
  classification = "Original"
}: IntelligenceEvidenceRecord) {
  return { id, title, recordType, date, value, support, href, sourceKey, classification, groupHint };
}

function kpiEvidenceRecord(kpi: KpiRow, support: string): IntelligenceEvidenceRecord {
  const sourceKey = kpi.source_file_id
    ? `source-file:${kpi.source_file_id}`
    : kpi.import_id
      ? `import:${kpi.import_id}`
      : `kpi:${kpi.id}`;

  return evidenceRecord({
    id: `kpi:${kpi.id}`,
    title: kpi.name,
    recordType: "KPI record",
    date: kpi.metric_date,
    value: `Actual ${formatMetric(kpi.actual_value, kpi.name)}${kpi.target === null ? "" : ` · Target ${formatMetric(kpi.target, kpi.name)}`}`,
    support,
    href: `/app/kpis?metric=${encodeURIComponent(kpi.name)}&section=detail`,
    classification: recordClassification(kpi),
    sourceKey,
    groupHint: kpi.category || kpi.name
  });
}

function canonicalTopic(value: string) {
  const normalized = lower(value);
  if (/checklist/.test(normalized)) return "checklist-completion";
  if (/response.?time/.test(normalized)) return "response-time";
  if (/follow.?up|overdue/.test(normalized)) return "customer-follow-up";
  if (/conversion/.test(normalized)) return "conversion";
  if (/revenue|sales/.test(normalized)) return "revenue";
  if (/handoff|handover/.test(normalized)) return "handoff";
  if (/sop|process knowledge/.test(normalized)) return "process-knowledge";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "general";
}

function canonicalCondition(value: string) {
  const normalized = lower(value);
  if (/below target|dropped|declin|fell|missed target/.test(normalized)) return "performance-gap";
  if (/unclear|missing|not documented|limited context/.test(normalized)) return "missing-context";
  if (/stale|older than/.test(normalized)) return "stale";
  if (/above target|meets|exceeds|improv/.test(normalized)) return "positive-performance";
  return "review";
}

function findingFingerprint(insight: Pick<IntelligenceInsight, "type" | "title" | "summary" | "affectedArea" | "timePeriod">) {
  const typeGroup = ["Risk", "Bottleneck", "Anomaly"].includes(insight.type) ? "risk" : insight.type.toLowerCase();
  const topic = canonicalTopic(`${insight.affectedArea} ${insight.title}`);
  const condition = canonicalCondition(`${insight.title} ${insight.summary}`);
  const normalizedPeriod = /^\d{4}-\d{2}/.test(insight.timePeriod) ? insight.timePeriod.slice(0, 7) : lower(insight.timePeriod) || "current";
  return `${typeGroup}:${topic}:${condition}:${normalizedPeriod}`;
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function consolidateDuplicateInsights(insights: IntelligenceInsight[]) {
  const grouped = new Map<string, IntelligenceInsight>();

  sortInsights(insights).forEach((insight) => {
    const fingerprint = insight.fingerprint || findingFingerprint(insight);
    const current = grouped.get(fingerprint);
    if (!current) {
      grouped.set(fingerprint, { ...insight, fingerprint });
      return;
    }

    const supportingRecords = uniqueBy([...current.supportingRecords, ...insight.supportingRecords], (record) => record.id);
    const independentSourceCount = new Set(supportingRecords.map((record) => record.sourceKey)).size;
    grouped.set(fingerprint, {
      ...current,
      evidence: uniqueBy([...current.evidence, ...insight.evidence], (item) => item),
      supportingRecords,
      evidenceCount: supportingRecords.length,
      independentSourceCount,
      contradictoryEvidence: uniqueBy([...current.contradictoryEvidence, ...insight.contradictoryEvidence], (item) => item),
      missingEvidence: uniqueBy([...current.missingEvidence, ...insight.missingEvidence], (item) => item),
      sourceTypes: uniqueBy([...current.sourceTypes, ...insight.sourceTypes], (item) => item),
      lastUpdated: [current.lastUpdated, insight.lastUpdated].sort().at(-1) || current.lastUpdated
    });
  });

  return sortInsights(Array.from(grouped.values()));
}

function confidenceFromEvidence(count: number, priority: "High" | "Medium" | "Low" = "Medium"): IntelligenceConfidence {
  if (count >= 4 || priority === "High") return "High";
  if (count >= 2 || priority === "Medium") return "Medium";
  return "Low";
}

function sortInsights(insights: IntelligenceInsight[]) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const confidenceRank = { High: 3, Medium: 2, Low: 1 };

  return [...insights].sort((a, b) => {
    const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
    if (priorityDelta) return priorityDelta;
    const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
    if (confidenceDelta) return confidenceDelta;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

function latestDate(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) || new Date().toISOString();
}

function businessSignalPatternTitle(signals: TaskRow[]) {
  const sourceText = signals
    .flatMap((signal) => [signal.title, signal.description, signal.category])
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (/follow.?up|response/.test(sourceText)) return "Customer follow-up ownership is unclear";
  if (/handoff|handover/.test(sourceText)) return "Repeated handoff gaps are visible";
  if (/process|procedure|sop/.test(sourceText)) return "Process records show inconsistent follow-through";
  return "Related operating signals need one leadership decision";
}

export function buildIntelligenceLayer(input: IntelligenceLayerInput): IntelligenceLayerResult {
  const workspace = input.workspace || null;
  const files = filterOriginalBusinessEvidence(input.files);
  const parentEligibility = buildSourceParentEligibility({ files, imports: input.imports || [] });
  const kpis = filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.kpis), parentEligibility);
  const tasks = filterOriginalBusinessEvidence(input.tasks);
  const issues = filterOriginalBusinessEvidence(input.issues);
  // Reports are derived outputs. They remain reviewable, but never become
  // original evidence for new health, coverage, risk, or recommendation logic.
  const reports: ReportRow[] = [];
  const vaeroexRuns: VaeroexRunRow[] = [];
  // Customer activity is evidence only when it is traceable to an import or file.
  const crmLeads = filterBySourceParentEligibility(filterOriginalBusinessEvidence(input.crmLeads), parentEligibility)
    .filter((lead) => Boolean(lead.source_file_id || lead.import_id));
  const imports = [] as FileImportRow[];
  const sops = filterOriginalBusinessEvidence(input.sops);
  const forms = filterOriginalBusinessEvidence(input.forms);
  const activeFormIds = new Set(forms.map((form) => form.id));
  const submissions = filterOriginalBusinessEvidence(input.submissions).filter((submission) => activeFormIds.has(submission.form_id));
  const people = filterOriginalBusinessEvidence(input.people);
  const decisions: DecisionRow[] = [];
  const recommendationOutcomes: RecommendationOutcomeRow[] = [];
  const openTasks = tasks.filter(isOpenBusinessSignal);
  const businessSignalsForReview = openTasks.filter((task) => businessSignalMatchesEvidenceScope(task, "related-signal-pattern"));
  const signalsWithLimitedContext = openTasks.filter((task) => businessSignalMatchesEvidenceScope(task, "limited-signal-context"));
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const historyCounts = kpiHistoryCounts(kpis);
  const historyByName = kpiHistoryByName(kpis);
  const forecastEligibility = buildKpiForecastEligibility(kpis);
  const belowTargetKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const improvingKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value >= kpi.target);
  const pendingImports = imports.filter((item) => ["extracted", "needs_review"].includes(lower(item.status)));
  const forecastReadyMetricNames = new Set(forecastEligibility.metrics.filter((metric) => metric.state === "ready").map((metric) => metric.name.toLowerCase()));
  const forecastReadyKpis = latestKpis.filter((kpi) => forecastReadyMetricNames.has(kpi.name.toLowerCase()));
  const staleSops = sops.filter((sop) => {
    const date = new Date(sop.updated_at || sop.created_at);
    const ageDays = (Date.now() - date.getTime()) / 86400000;
    return ageDays > 90;
  });
  const customerContextWithoutFollowup = crmLeads.filter((lead) => !isClosed(lead.status) && (!lead.last_activity_at || isOverdue(lead.last_activity_at)));
  const originalKpiSeries = new Set(kpis.map((kpi) => `${kpi.source_file_id || kpi.import_id || "manual"}:${kpi.name.toLowerCase()}`));
  const originalSourceRecords = originalKpiSeries.size + files.length + reports.length + sops.length + forms.length + submissions.length + tasks.length + issues.length + crmLeads.length + people.length;
  const originalSourceTypes = [
    originalKpiSeries.size > 0,
    files.length > 0,
    reports.length > 0,
    sops.length > 0,
    tasks.length > 0,
    issues.length > 0,
    crmLeads.length > 0,
    people.length > 0
  ].filter(Boolean).length;
  const hasHealthEvidence = originalSourceRecords >= 3 && originalSourceTypes >= 2 && (originalKpiSeries.size > 0 || files.length > 0 || reports.length > 0 || issues.length > 0);
  const suggestedNextData = [
    !kpis.length ? "Upload KPI history or connect one leadership-level KPI source." : "",
    !reports.length ? "Upload or generate prior management reports." : "",
    !files.length ? "Upload a recent spreadsheet, report, meeting note, or SOP." : "",
    !crmLeads.length ? "Add customer context or import a customer/lead list." : "",
    !people.length ? "Add leadership or area context so Vaeroex can interpret Business Signals." : ""
  ].filter(Boolean);
  const dataQualityScore = Math.min(
    100,
    Math.round(
      (workspace?.industry || workspace?.size ? 10 : 0) +
        (files.length ? 15 : 0) +
        (kpis.length ? 25 : 0) +
        (reports.length ? 15 : 0) +
        (crmLeads.length || issues.length || tasks.length ? 10 : 0) +
        (decisions.length || recommendationOutcomes.length ? 10 : 0)
    )
  );
  const dataQualityLabel = dataQualityScore >= 70 ? "Strong" : dataQualityScore >= 40 ? "Developing" : "Limited";
  const dataConfidence = dataQualityScore >= 70 ? "High" : dataQualityScore >= 40 ? "Medium" : "Low";
  const insights: IntelligenceInsight[] = [
    ...openIssues.slice(0, 4).map((issue) => {
      const priority = priorityFrom(issue.severity);
      const evidence = [`Issue status: ${issue.status}`, `Severity: ${issue.severity}`, issue.root_cause ? `Root cause: ${issue.root_cause}` : "Root cause not documented"];
      const supportingRecords = [evidenceRecord({
        id: `issue:${issue.id}`,
        title: issue.title,
        recordType: issue.issue_type || "Issue record",
        date: issue.updated_at || issue.created_at,
        value: `${issue.status} · ${issue.severity} severity`,
        support: issue.root_cause ? `The record documents this root cause: ${issue.root_cause}` : "The issue remains open, but its root cause is not documented.",
        href: `/app/issues?q=${encodeURIComponent(issue.title)}`,
        classification: "Manual",
        sourceKey: `issue:${issue.id}`,
        groupHint: issue.issue_type || "Issues"
      })];
      const limitation = issue.root_cause
        ? "The issue record does not establish whether the documented cause is the only contributing factor."
        : "The root cause and measured business outcome are not documented.";

      return {
        id: `issue-${issue.id}`,
        type: "Risk" as const,
        title: issue.title,
        summary: issue.description || issue.recommended_fix || `Issue is currently ${issue.status}.`,
        why: issue.root_cause ? `The record attributes the issue to ${issue.root_cause}` : `The issue remains ${lower(issue.status)} and no root cause is recorded.`,
        impact: issue.description || "The unresolved issue may continue to affect the business area described in the record.",
        recommendedAction: issue.recommended_fix || "Decide whether this issue requires an investigation and what evidence should be collected next.",
        confidence: confidenceFromEvidence(evidence.length, priority),
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: issue.root_cause ? ["Independent confirmation of the recorded root cause"] : ["Documented root cause", "Measured business outcome"],
        sourceTypes: ["Issues"],
        sourceHref: "/app/issues",
        priority,
        lastUpdated: issue.updated_at || issue.created_at,
        affectedArea: issue.issue_type || "Operations",
        timePeriod: (issue.updated_at || issue.created_at).slice(0, 7),
        limitation,
        fingerprint: ""
      };
    }),
    businessSignalsForReview.length
      ? (() => {
          const signalPriority = businessSignalsForReview.length >= 5 ? "High" : "Medium";
          const examples = businessSignalsForReview
            .slice(0, 3)
            .map((task) => task.title)
            .join(", ");
          const evidence = [`Business Signals in this pattern: ${businessSignalsForReview.length}`, examples ? `Examples: ${examples}` : "Examples: no titles available"];
          const supportingRecords = businessSignalsForReview.map((task) => evidenceRecord({
            id: `signal:${task.id}`,
            title: task.title,
            recordType: "Business Signal",
            date: task.due_date || task.updated_at || task.created_at,
            value: task.description || "No description recorded.",
            support: task.description
              ? `The "${task.title}" record provides direct ${task.category ? task.category.toLowerCase() : "operating"} context for this finding.`
              : "The title is the only recorded context available for this signal.",
            href: `/app/tasks?q=${encodeURIComponent(task.title)}#signal-${task.id}`,
            classification: recordClassification(task),
            sourceKey: task.related_id ? `${task.related_type || "record"}:${task.related_id}` : `signal:${task.id}`,
            groupHint: task.category || task.related_type || "Business Signals"
          }));
          const missingEvidence = [
            !businessSignalsForReview.some((task) => Boolean(task.assigned_to || task.assigned_person_id)) ? "A responsible party or accountable business role" : "",
            !businessSignalsForReview.some((task) => Boolean(task.due_date)) ? "Completion or event dates" : "",
            "A measured customer or operating outcome"
          ].filter(Boolean);
          const limitation = `${businessSignalsForReview.length} related record${businessSignalsForReview.length === 1 ? " was" : "s were"} found, but ${missingEvidence.join(", ").toLowerCase()} ${missingEvidence.length === 1 ? "is" : "are"} missing. Vaeroex cannot yet confirm whether this is one recurring process failure.`;

          return {
            id: "source-signal-review-pattern",
            type: "Risk" as const,
            title: businessSignalPatternTitle(businessSignalsForReview),
            summary: `${businessSignalsForReview.length} active Business Signals describe related follow-up, handoff, or process context.`,
            why: `The records share a common operating area and remain active; ${missingEvidence.length ? "the missing fields prevent a confirmed root cause" : "their combined evidence supports a recurring pattern"}.`,
            impact: "Inconsistent follow-through can delay decisions or customer response, but no measured outcome is attached to these records yet.",
            recommendedAction: "Decide whether leadership needs one accountable follow-up standard and which existing system should record the outcome.",
            confidence: supportingRecords.length >= 4 && missingEvidence.length <= 1 ? "High" : "Medium",
            evidence,
            evidenceCount: supportingRecords.length,
            supportingRecords,
            independentSourceCount: new Set(supportingRecords.map((record) => record.sourceKey)).size,
            contradictoryEvidence: [],
            missingEvidence,
            sourceTypes: ["Business Signals"],
            sourceHref: "/app/tasks",
            priority: signalPriority,
            lastUpdated: latestDate(businessSignalsForReview.map((task) => task.updated_at || task.created_at)),
            affectedArea: businessSignalsForReview[0]?.category || "Operations",
            timePeriod: latestDate(businessSignalsForReview.map((task) => task.updated_at || task.created_at)).slice(0, 7),
            limitation,
            fingerprint: ""
          };
        })()
      : null,
    signalsWithLimitedContext.length
      ? (() => {
          const supportingRecords = signalsWithLimitedContext.map((task) => evidenceRecord({
            id: `signal:${task.id}`,
            title: task.title,
            recordType: "Business Signal",
            date: task.due_date || task.updated_at || task.created_at,
            value: task.description || "No description recorded.",
            support: "The missing description or category prevents reliable interpretation.",
            href: `/app/tasks?q=${encodeURIComponent(task.title)}#signal-${task.id}`,
            classification: recordClassification(task),
            sourceKey: task.related_id ? `${task.related_type || "record"}:${task.related_id}` : `signal:${task.id}`,
            groupHint: task.category || task.related_type || "Business Signals"
          }));

          return {
          id: "unclear-source-signals",
          type: "Bottleneck" as const,
          title: `${signalsWithLimitedContext.length} Business Signal${signalsWithLimitedContext.length === 1 ? " lacks" : "s lack"} decision context`,
          summary: `${signalsWithLimitedContext.length} operating record${signalsWithLimitedContext.length === 1 ? " has" : "s have"} limited description or category information.`,
          why: "The records cannot be reliably connected to a specific process, outcome, or business impact with the available context.",
          impact: "This limits confidence in related operational conclusions rather than confirming a business problem.",
          recommendedAction: "Decide whether these signals should be completed with source context or excluded from leadership review.",
          confidence: signalsWithLimitedContext.length >= 5 ? "High" : "Medium",
          evidence: [`Business Signals with limited context: ${signalsWithLimitedContext.length}`, `Business Signals in memory: ${openTasks.length}`, signalsWithLimitedContext[0]?.title ? `Example: ${signalsWithLimitedContext[0].title}` : "No example available"],
          evidenceCount: supportingRecords.length,
          supportingRecords,
          independentSourceCount: new Set(supportingRecords.map((record) => record.sourceKey)).size,
          contradictoryEvidence: [],
          missingEvidence: ["Clear description", "Business area or category", "Source reference or outcome"],
          sourceTypes: ["Business Signals"],
          sourceHref: "/app/tasks",
          priority: signalsWithLimitedContext.length >= 5 ? "High" : "Medium",
          lastUpdated: latestDate(signalsWithLimitedContext.map((task) => task.updated_at || task.created_at)),
          affectedArea: "Business Signals",
          timePeriod: latestDate(signalsWithLimitedContext.map((task) => task.updated_at || task.created_at)).slice(0, 7),
          limitation: "These records are visible, but they do not contain enough context to support a business conclusion.",
          fingerprint: ""
        };
      })()
      : null,
    ...belowTargetKpis.slice(0, 4).map((kpi) => {
      const history = historyCounts.get(kpi.name) || 1;
      const belowTargetPeriods = (historyByName.get(kpi.name) || [kpi]).filter(
        (row) => row.target !== null && row.actual_value !== null && row.actual_value < row.target * 0.9
      ).length;
      const evidence = [`Actual: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `Historical records: ${history}`];
      const supportingRecords = (historyByName.get(kpi.name) || [kpi]).slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, index === 0 ? "The latest recorded value is below the current target." : "This prior value establishes the recent KPI history.")
      );
      const limitation = history < 3
        ? `Only ${history} historical record${history === 1 ? " is" : "s are"} available. Vaeroex cannot determine whether the gap is persistent.`
        : "The KPI history confirms the performance gap, but it does not establish the cause.";

      return {
        id: `kpi-risk-${kpi.id}`,
        type: "Risk" as const,
        title: belowTargetPeriods >= 2 ? `${kpi.name} remained below target for ${belowTargetPeriods} periods` : `${kpi.name} is below target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value is below the current target.",
        impact: "The gap needs context before it can be tied to a cause or business impact.",
        recommendedAction: "Decide whether leadership should investigate the cause now or continue monitoring the next reporting period.",
        confidence: history >= 3 ? "High" : "Medium",
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: new Set(supportingRecords.map((record) => record.sourceKey)).size,
        contradictoryEvidence: [],
        missingEvidence: history < 3 ? ["At least three comparable historical periods", "Evidence explaining the change"] : ["Evidence explaining the change"],
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "High" as const,
        lastUpdated: kpi.updated_at || kpi.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: kpi.metric_date,
        limitation,
        fingerprint: ""
      };
    }),
    ...customerContextWithoutFollowup.slice(0, 3).map((lead) => {
      const evidence = [
        lead.status ? `Customer activity status: ${lead.status}` : "Customer activity status is not recorded",
        lead.last_activity_at ? `Last activity: ${lead.last_activity_at}` : "No recent customer activity is recorded",
        "Customer activity evidence is available"
      ];
      const supportingRecords = [evidenceRecord({
        id: `customer:${lead.id}`,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        recordType: "Imported customer activity",
        date: lead.last_activity_at || lead.updated_at || lead.created_at,
        value: lead.status ? `Status: ${lead.status}` : "Status not recorded",
        support: lead.last_activity_at ? "The last recorded activity is overdue." : "No recent activity date is recorded.",
        href: lead.source_file_id ? `/app/sources?file=${lead.source_file_id}` : "/app/sources",
        classification: recordClassification(lead),
        sourceKey: lead.source_file_id ? `source-file:${lead.source_file_id}` : `import:${lead.import_id}`
      })];

      return {
        id: `customer-risk-${lead.id}`,
        type: "Opportunity" as const,
        title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
        summary: "Customer activity evidence exists, but recent activity context is limited.",
        why: "Recent customer activity is not fully documented in the available record.",
        impact: "The available record is insufficient to confirm a revenue or retention effect.",
        recommendedAction: "Decide whether the underlying customer activity should be reviewed in the external source system before drawing a revenue conclusion.",
        confidence: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        evidence,
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: ["Current activity outcome", "Confirmed revenue or retention impact"],
        sourceTypes: ["Customer Evidence"],
        sourceHref: "/app/sources",
        priority: lead.last_activity_at || lead.source_file_id || lead.import_id ? "Medium" : "Low",
        lastUpdated: lead.updated_at || lead.created_at,
        affectedArea: "Customer activity",
        timePeriod: (lead.updated_at || lead.created_at).slice(0, 7),
        limitation: "The customer activity record does not confirm a revenue, conversion, or retention outcome.",
        fingerprint: ""
      };
    }),
    ...improvingKpis.slice(0, 3).map((kpi) => {
      const history = historyCounts.get(kpi.name) || 1;
      const supportingRecords = (historyByName.get(kpi.name) || [kpi]).slice(0, 4).map((row, index) =>
        kpiEvidenceRecord(row, index === 0 ? "The latest value meets or exceeds the current target." : "This prior value establishes the recent KPI history.")
      );

      return {
        id: `kpi-opportunity-${kpi.id}`,
        type: "Opportunity" as const,
        title: `${kpi.name} is on or above target`,
        summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
        why: "The latest recorded value meets or exceeds the current target.",
        impact: "The result may be worth preserving, but the current records do not establish its cause.",
        recommendedAction: "Decide whether the practice behind this result is clear enough to preserve or requires a focused review.",
        confidence: history >= 3 ? "High" : "Medium",
        evidence: [`Metric date: ${kpi.metric_date}`, `Historical records: ${history}`, kpi.source ? `Source: ${kpi.source}` : "Source not recorded"],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: new Set(supportingRecords.map((record) => record.sourceKey)).size,
        contradictoryEvidence: [],
        missingEvidence: ["Evidence explaining what caused the result"],
        sourceTypes: ["KPIs"],
        sourceHref: "/app/kpis",
        priority: "Medium" as const,
        lastUpdated: kpi.updated_at || kpi.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: kpi.metric_date,
        limitation: history < 3 ? `Only ${history} historical record${history === 1 ? " is" : "s are"} available, so the result may not represent a durable trend.` : "The KPI history confirms the result, but not what caused it.",
        fingerprint: ""
      };
    }),
    ...forecastReadyKpis.slice(0, 3).map((kpi) => {
      const supportingRecords = (historyByName.get(kpi.name) || [kpi]).slice(0, 6).map((row, index) =>
        kpiEvidenceRecord(row, index === 0 ? "This is the latest point in the directional trend." : "This historical point contributes to the trend direction.")
      );

      return {
        id: `forecast-${kpi.id}`,
        type: "Forecast" as const,
        title: `${kpi.name} has enough history for trend review`,
        summary: `${historyCounts.get(kpi.name)} historical records are available for directional forecasting.`,
        why: "The metric has enough dated history for directional trend review.",
        impact: "The trend can inform a discussion, but it does not establish a forecasted outcome on its own.",
        recommendedAction: "Decide whether the directional trend is sufficient for planning or whether causal evidence is needed first.",
        confidence: "Medium" as const,
        evidence: [`Latest value: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `History count: ${historyCounts.get(kpi.name)}`],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: new Set(supportingRecords.map((record) => record.sourceKey)).size,
        contradictoryEvidence: [],
        missingEvidence: ["Causal evidence supporting the forecast direction"],
        sourceTypes: ["KPI history"],
        sourceHref: "/app/kpis",
        priority: "Medium" as const,
        lastUpdated: kpi.updated_at || kpi.created_at,
        affectedArea: kpi.category || kpi.name,
        timePeriod: "Historical",
        limitation: "Historical direction is available, but the records do not support a precise predicted outcome.",
        fingerprint: ""
      };
    }),
    ...pendingImports.slice(0, 3).map((item) => {
      const supportingRecords = [evidenceRecord({
        id: `import:${item.id}`,
        title: `${item.import_type.replace(/_/g, " ")} import`,
        recordType: "Structured import",
        date: item.imported_at || item.reviewed_at || item.created_at,
        value: `${item.rows_imported} of ${item.rows_total} rows imported`,
        support: "The import remains in its required review state and is not yet eligible for intelligence.",
        href: `/app/sources?file=${item.file_upload_id}&panel=import`,
        classification: "Derived",
        sourceKey: `source-file:${item.file_upload_id}`,
        groupHint: item.import_type.replace(/_/g, " ")
      })];

      return {
        id: `import-${item.id}`,
        type: "Recommendation" as const,
        title: `${item.import_type.replace(/_/g, " ")} import needs review`,
        summary: `${item.rows_imported} of ${item.rows_total} rows have been imported.`,
        why: "The import has not completed its required review step.",
        impact: "Current intelligence excludes the staged data until it is approved.",
        recommendedAction: "Decide whether the structured import is accurate enough to approve.",
        confidence: "Medium" as const,
        evidence: [`Status: ${item.status}`, `Rows staged: ${item.rows_total}`, item.extraction_summary || "No extraction summary recorded"],
        evidenceCount: supportingRecords.length,
        supportingRecords,
        independentSourceCount: 1,
        contradictoryEvidence: [],
        missingEvidence: ["Approved field mapping"],
        sourceTypes: ["Files", "Imports"],
        sourceHref: "/app/sources",
        priority: "Medium" as const,
        lastUpdated: item.imported_at || item.reviewed_at || item.created_at,
        affectedArea: "Structured imports",
        timePeriod: "Current",
        limitation: "Staged import rows are not eligible business evidence until the structured import is approved.",
        fingerprint: ""
      };
    }),
    staleSops.length
      ? (() => {
          const supportingRecords = staleSops.map((sop) => evidenceRecord({
            id: `sop:${sop.id}`,
            title: sop.title,
            recordType: "SOP",
            date: sop.updated_at || sop.created_at,
            value: `Last updated ${sop.updated_at || sop.created_at}`,
            support: "The document has not been updated in more than 90 days.",
            href: `/app/sops?q=${encodeURIComponent(sop.title)}`,
            classification: "Manual",
            sourceKey: `sop:${sop.id}`,
            groupHint: sop.category || sop.department || "Process knowledge"
          }));

          return {
          id: "stale-process-knowledge",
          type: "Recommendation" as const,
          title: "Process knowledge may be stale",
          summary: `${staleSops.length} SOP${staleSops.length === 1 ? " is" : "s are"} older than 90 days.`,
          why: "The process documents have not been updated in more than 90 days.",
          impact: "Older process documentation can limit confidence in process-related conclusions.",
          recommendedAction: "Decide which process documents still reflect current operations and retire or update the rest in the source system.",
          confidence: "Medium",
          evidence: [`Stale SOPs: ${staleSops.length}`, staleSops[0]?.title ? `Oldest example: ${staleSops[0].title}` : "No example available"],
          evidenceCount: supportingRecords.length,
          supportingRecords,
          independentSourceCount: supportingRecords.length,
          contradictoryEvidence: [],
          missingEvidence: ["Confirmation that each process document still reflects current operations"],
          sourceTypes: ["SOPs", "Process Knowledge"],
          sourceHref: "/app/sops",
          priority: "Medium",
          lastUpdated: latestDate(staleSops.map((sop) => sop.updated_at || sop.created_at)),
          affectedArea: "Process knowledge",
          timePeriod: "Older than 90 days",
          limitation: "Document age alone does not prove that the underlying process is outdated.",
          fingerprint: ""
        };
      })()
      : null
  ].filter(Boolean) as IntelligenceInsight[];
  const normalizedInsights = insights.map((insight) => ({
    ...insight,
    fingerprint: insight.fingerprint || findingFingerprint(insight)
  }));
  const sortedInsights = consolidateDuplicateInsights(normalizedInsights);
  const risks = sortedInsights.filter((insight) => insight.type === "Risk" || insight.type === "Bottleneck" || insight.type === "Anomaly");
  const opportunities = sortedInsights.filter((insight) => insight.type === "Opportunity");
  const recommendations = sortedInsights.filter((insight) => insight.type === "Recommendation" || insight.type === "Risk" || insight.type === "Bottleneck");
  const forecasts = sortedInsights.filter((insight) => insight.type === "Forecast");
  const riskPenalty = Math.min(45, risks.filter((risk) => risk.priority === "High").length * 12 + risks.filter((risk) => risk.priority === "Medium").length * 6);
  const healthScore = hasHealthEvidence ? Math.max(10, Math.min(100, dataQualityScore - riskPenalty + Math.min(15, opportunities.length * 4))) : 0;
  const healthStatus = !hasHealthEvidence || dataQualityScore < 25 ? "Insufficient Data" : healthScore >= 75 ? "Strong" : healthScore >= 50 ? "Watch" : "At Risk";
  const trend = !hasHealthEvidence ? "Not enough history" : risks.length > opportunities.length + 1 ? "Declining" : opportunities.length > risks.length ? "Improving" : dataQualityScore < 35 ? "Not enough history" : "Holding steady";
  const topRisk = risks[0];
  const topOpportunity = opportunities[0];
  const topRecommendation = recommendations[0];
  const topForecast = forecasts[0];
  const executiveSummary = topRisk
    ? `${topRisk.title}. ${topRisk.why}`
    : topOpportunity
      ? `${topOpportunity.title}. ${topOpportunity.why}`
      : dataQualityScore < 40
        ? "Vaeroex needs more source data before it can produce a confident leadership briefing."
        : "No major risk is visible right now. Continue adding source data and reviewing business memory.";

  return {
    executiveSummary,
    businessHealth: {
      available: hasHealthEvidence,
      score: healthScore,
      status: healthStatus,
      trend
    },
    dataQuality: {
      score: dataQualityScore,
      label: dataQualityLabel,
      confidence: dataConfidence,
      reason:
        dataConfidence === "High"
          ? "Based on multiple source types, historical records, and saved Vaeroex context."
          : dataConfidence === "Medium"
            ? "Based on available workspace records, but more history would improve confidence."
            : "Not enough workspace history exists for high-confidence intelligence yet.",
      suggestedNextData: suggestedNextData.length ? suggestedNextData : ["Keep adding current reports, outcomes, and KPI history."]
    },
    forecastReadiness: {
      state: forecastEligibility.state,
      label: forecastEligibility.label,
      reason: forecastEligibility.reason,
      ready: forecastEligibility.ready,
      directional: forecastEligibility.directional,
      currentKpiCount: forecastEligibility.currentKpiCount,
      totalMeasurementCount: forecastEligibility.totalMeasurementCount,
      readyKpiCount: forecastEligibility.readyKpiCount,
      directionalKpiCount: forecastEligibility.directionalKpiCount,
      historicalDepthLabel: forecastEligibility.historicalDepthLabel,
      freshnessLabel: forecastEligibility.freshnessLabel
    },
    topRisk,
    topOpportunity,
    topRecommendation,
    topForecast,
    insights: sortedInsights,
    memorySummary: {
      profileSignals: [workspace?.industry, workspace?.size].filter(Boolean).length,
      sourceRecords: originalSourceRecords,
      kpiHistoryRecords: kpis.length,
      reports: reports.length,
      vaeroexRuns: vaeroexRuns.length,
      decisions: decisions.length,
      recommendationOutcomes: recommendationOutcomes.length
    }
  };
}
