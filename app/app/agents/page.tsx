import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { dismissRecommendationAction } from "@/app/app/accountability/actions";
import { runVaeroexAction, saveVaeroexOutputAction } from "@/app/app/agents/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { getVaeroexWorkflow, type VaeroexSaveTarget, type VaeroexWorkflowKey } from "@/lib/ai/vaeroex-workflows";
import { generatedOutputHref } from "@/lib/intelligence/generated-output";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Json } from "@/lib/supabase/types";
import { isSecurityResponseMessage, isSecurityResponseOutput } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type VaeroexHubPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

type JsonRecord = Record<string, unknown>;

const saveLabels: Record<VaeroexSaveTarget, string> = {
  sop: "SOP draft",
  report: "briefing draft"
};

const saveDestinations: Record<string, { label: string; href: Route }> = {
  sop: { label: "SOPs", href: "/app/sops" },
  report: { label: "Reports", href: "/app/reports" as Route }
};
const vaeroexRunEditFields: ManagedRecordEditField[] = [
  { name: "status", label: "Status", type: "select", options: ["queued", "running", "completed", "failed"] },
  { name: "error_message", label: "Error message", type: "textarea", rows: 4 }
];
const WORKFLOW_GROUPS: Array<{
  title: string;
  description: string;
  keys: VaeroexWorkflowKey[];
}> = [
  {
    title: "Leadership Reports",
    description: "Condensed intelligence for owners and managers deciding what deserves attention.",
    keys: ["ceo_mode", "focus_priorities", "risk_simulation", "weekly_management_meeting", "business_review_package"]
  },
  {
    title: "Operations Reviews",
    description: "Find bottlenecks, responsibility gaps, evidence, and executive review needs in the active workspace.",
    keys: ["operations_audit", "bottleneck_detector", "follow_up"]
  },
  {
    title: "Optional Outputs",
    description: "Turn workspace context into draft SOPs, briefings, forms, checklists, and source analysis for review.",
    keys: ["sop_generator", "weekly_report", "daily_summary", "form_builder", "checklist_builder", "file_analysis"]
  }
];
const WORKFLOW_CHOICES: Array<{
  label: string;
  description: string;
  workflowKey?: VaeroexWorkflowKey;
  href?: Route;
}> = [
  {
    label: "Executive Brief",
    description: "What should leadership know right now?",
    workflowKey: "ceo_mode"
  },
  {
    label: "Find Focus",
    description: "Top priorities with evidence and confidence.",
    workflowKey: "focus_priorities"
  },
  {
    label: "Simulate Risks",
    description: "Likely problems before they become normal.",
    workflowKey: "risk_simulation"
  },
  {
    label: "Prepare Meeting",
    description: "Weekly agenda, decisions, and review questions.",
    workflowKey: "weekly_management_meeting"
  },
  {
    label: "Review File",
    description: "Analyze uploaded source material.",
    href: "/app/sources"
  },
  {
    label: "Generate Briefing",
    description: "Generate a clean leadership briefing draft.",
    workflowKey: "weekly_report"
  },
  {
    label: "Generate Improvement Plan",
    description: "Turn loose concerns into a reviewable improvement plan.",
    workflowKey: "follow_up"
  },
  {
    label: "Ask Anything",
    description: "Ask a direct question with workspace context.",
    workflowKey: "ask_vaeroex"
  }
];
const vaeroexSubmitClass =
  "min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-900/10 hover:bg-blue-950/70 hover:text-white hover:ring-1 hover:ring-vaeroex-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 disabled:cursor-not-allowed disabled:opacity-70";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: Json | unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRunInput(run: { input_json?: Json }) {
  return asRecord(run.input_json);
}

function getRunExtraInputs(run: { input_json?: Json }) {
  return asRecord(getRunInput(run).extra_inputs);
}

function getWorkspaceSnapshotFromInput(input: JsonRecord) {
  return asRecord(input.workspace_snapshot);
}

function snapshotMetrics(input: JsonRecord) {
  return asRecord(getWorkspaceSnapshotFromInput(input).metrics);
}

function dataUsedSummary(input: JsonRecord) {
  const snapshot = getWorkspaceSnapshotFromInput(input);
  const metrics = snapshotMetrics(input);

  return [
    { label: "KPIs", value: numberValue(metrics.kpi_history_records) || asArray(snapshot.kpi_history).length },
    { label: "Reports", value: numberValue(metrics.reports) || asArray(snapshot.reports).length },
    { label: "Sources", value: numberValue(metrics.uploaded_files) || asArray(snapshot.files).length },
    { label: "Issues", value: numberValue(metrics.open_issues) || asArray(snapshot.recent_issues).length },
    { label: "Business Memory", value: asArray(snapshot.recent_vaeroex_results).length + asArray(snapshot.reports).length },
    { label: "Actions", value: numberValue(metrics.open_tasks) || asArray(snapshot.recent_tasks).length },
    { label: "Decisions", value: asArray(snapshot.business_decisions).length }
  ];
}

function dataUsedText(input: JsonRecord) {
  const items = dataUsedSummary(input);

  if (!items.some((item) => item.value > 0)) {
    return "No workspace records were available beyond basic workspace context.";
  }

  return items.map((item) => `${item.label}: ${item.value}`).join(" | ");
}

function parseStructuredText(value: unknown): JsonRecord | null {
  const text = str(value);

  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || text).trim();

  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStructuredText(value: unknown) {
  const text = str(value);

  return Boolean(text && (parseStructuredText(text) || text.trim().startsWith("{") || text.trim().startsWith("[")));
}

function displayOutput(output: JsonRecord) {
  const parsed = parseStructuredText(output.response_markdown) || parseStructuredText(output.summary);

  if (!parsed) {
    return output;
  }

  return {
    ...output,
    ...parsed,
    response_markdown:
      str(parsed.response_markdown) ||
      str(parsed.executive_summary) ||
      str(parsed.summary) ||
      str(output.executive_summary) ||
      str(output.summary)
  };
}

function isSecurityResponseRun(run: { title?: string | null; status?: string | null; error_message?: string | null; output_json?: Json }, output?: JsonRecord) {
  return (
    run.status === "blocked" ||
    isSecurityResponseMessage(run.title) ||
    isSecurityResponseMessage(run.error_message) ||
    isSecurityResponseOutput(output || asRecord(run.output_json))
  );
}

function vaeroexResultLabel(value: string) {
  return getVaeroexWorkflow(value).title;
}

function friendlyHubError(message?: string | null) {
  return message ? cleanVaeroexErrorMessage(message, "Vaeroex could not complete that request. Please try again.") : undefined;
}

function runDiagnosticsFromOutput(output?: Json) {
  return asRecord(asRecord(output).vaeroex_run_diagnostics);
}

function workflowDataUsed(key: VaeroexWorkflowKey) {
  if (key === "file_analysis") {
    return "Selected file content, prior imports, KPIs, reports";
  }

  if (key === "weekly_report" || key === "daily_summary" || key === "business_review_package") {
    return "KPIs, Business Signals, issues, customer activity evidence, reports, Vaeroex runs";
  }

  if (key === "sop_generator" || key === "form_builder" || key === "checklist_builder") {
    return "Existing SOPs, forms, checklists, issues, Business Signals";
  }

  if (key === "ceo_mode" || key === "focus_priorities" || key === "risk_simulation" || key === "weekly_management_meeting") {
    return "Workspace health, risks, KPIs, decisions, Business Signals, business memory";
  }

  return "Workspace records, Business Signals, issues, files, reports";
}

function resultTitle(output: JsonRecord, fallback: string) {
  return str(output.title, fallback);
}

function formatBusinessItem(item: unknown, fallback: string) {
  if (typeof item === "string") {
    return item;
  }

  const record = asRecord(item);
  const title =
    str(record.title) ||
    str(record.name) ||
    str(record.label) ||
    str(record.system) ||
    str(record.category) ||
    str(record.action) ||
    fallback;
  const detail =
    str(record.description) ||
    str(record.recommended_action) ||
    str(record.reason_this_matters) ||
    str(record.impact) ||
    str(record.evidence) ||
    str(record.root_cause) ||
    str(record.notes);
  const evidence = str(record.evidence) || str(record.reasoning);
  const confidence = str(record.recommendation_confidence) || str(record.confidence);
  const tail = unique([evidence ? `Evidence: ${evidence}` : "", confidence ? `Recommendation confidence: ${confidence}` : ""]).join(" - ");

  if (detail && detail !== title) {
    return tail ? `${title}: ${detail} (${tail})` : `${title}: ${detail}`;
  }

  return tail ? `${title} (${tail})` : title;
}

function collectItems(output: JsonRecord, keys: string[]) {
  return unique(
    keys.flatMap((key) =>
      asArray(output[key]).map((item, index) => formatBusinessItem(item, `${key.replace(/_/g, " ")} ${index + 1}`))
    )
  );
}

function businessSections(output: JsonRecord) {
  const executiveSummary =
    str(output.executive_summary) ||
    str(output.summary) ||
    (isStructuredText(output.response_markdown) ? "" : str(output.response_markdown)) ||
    "Vaeroex prepared a draft response for review.";
  const problems = collectItems(output, [
    "problems_identified",
    "current_operational_problems",
    "main_bottlenecks",
    "bottlenecks",
    "accountability_gaps",
    "responsibility_gaps",
    "risks"
  ]);
  const actions = collectItems(output, [
    "recommended_actions",
    "suggested_tasks",
    "tasks",
    "thirty_day_action_plan",
    "manager_actions"
  ]);
  const systems = collectItems(output, [
    "suggested_systems",
    "recommended_systems_to_build",
    "suggested_forms",
    "suggested_checklists",
    "suggested_sops",
    "forms",
    "checklists",
    "sops",
    "dashboard_metrics"
  ]);

  return {
    executiveSummary,
    problems: problems.length ? problems : ["No major problems were identified from the available workspace context."],
    actions: actions.length ? actions : ["Review the draft, choose the first executive recommendation, and decide what leadership should examine next."],
    systems: systems.length ? systems : ["Executive briefing", "Improvement plan", "Weekly leadership review"]
  };
}

function outputEvidenceItems(output: JsonRecord) {
  const items = collectItems(output, [
    "evidence",
    "evidence_used",
    "supporting_evidence",
    "data_used",
    "source_records",
    "signals_used"
  ]);

  if (items.length) {
    return items.slice(0, 6);
  }

  const sections = businessSections(output);
  return [...sections.problems, ...sections.actions].slice(0, 4);
}

function outputReasoning(output: JsonRecord) {
  return (
    str(output.reasoning) ||
    str(output.why_this_recommendation) ||
    str(output.why_vaeroex_surfaced_this) ||
    str(output.why_it_matters) ||
    "Vaeroex surfaced this because the available workspace context points to a practical visibility, responsibility, risk, or executive decision."
  );
}

type RecommendationConfidence = "High" | "Medium" | "Low" | "Insufficient";

function normalizeRecommendationConfidence(value: string): RecommendationConfidence | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "very high" || normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  if (normalized === "insufficient evidence" || normalized === "insufficient") return "Insufficient";

  return null;
}

function confidenceEvidenceText(output: JsonRecord) {
  return [
    str(output.response_markdown),
    str(output.answer),
    str(output.response),
    str(output.summary),
    str(output.executive_summary),
    str(output.confidence_reason),
    str(output.confidence_explanation),
    ...outputEvidenceItems(output),
    ...collectItems(output, ["limitations", "data_gaps", "missing_context", "confidence_factors"])
  ]
    .join(" ")
    .toLowerCase();
}

function evidenceIsInsufficient(text: string) {
  return /insufficient evidence|not enough evidence|not enough data|not enough historical data|no reliable forecast|cannot reliably|unable to determine|no workspace evidence|little or no/.test(
    text
  );
}

function evidenceIsLimited(text: string) {
  return /very limited evidence|limited evidence|limited historical|limited context|limited workspace context|thin evidence|only one source|only 1 source|single source|available evidence is limited/.test(
    text
  );
}

type QuestionCoverage = "strong" | "moderate" | "limited" | "insufficient";

function evidenceContextFromInput(input: JsonRecord) {
  return asRecord(asRecord(input.extra_inputs).evidence_context);
}

function askEvidenceDiagnostics(input: JsonRecord, output: JsonRecord) {
  const workspaceItems = dataUsedSummary(input).filter((item) => item.value > 0);
  const workspaceEvidenceTotal = workspaceItems.reduce((sum, item) => sum + item.value, 0);
  const evidenceContext = evidenceContextFromInput(input);
  const citations = asArray(evidenceContext.citations);
  const retrievedEvidenceCount = citations.length;
  const evidenceActuallyUsed = outputEvidenceItems(output).length;
  const retrievalConfidence = numberValue(evidenceContext.confidence_score);
  const hasEvidenceContext = Boolean(
    str(evidenceContext.retrieval_mode) ||
      retrievedEvidenceCount ||
      retrievalConfidence ||
      asArray(evidenceContext.limitations).length ||
      asArray(evidenceContext.data_gaps).length
  );
  const hasWorkspaceKnowledge = workspaceEvidenceTotal >= 4 || workspaceItems.length >= 2;
  const hasExtensiveWorkspaceKnowledge = workspaceEvidenceTotal >= 10 || workspaceItems.length >= 3;
  let questionCoverage: QuestionCoverage = "insufficient";

  if (!hasEvidenceContext) {
    if (evidenceActuallyUsed >= 3) questionCoverage = "moderate";
    else if (evidenceActuallyUsed > 0) questionCoverage = "limited";
  } else if (!retrievedEvidenceCount && !evidenceActuallyUsed) {
    questionCoverage = "insufficient";
  } else if (retrievalConfidence >= 66 && retrievedEvidenceCount >= 4 && evidenceActuallyUsed >= 3) {
    questionCoverage = "strong";
  } else if (retrievalConfidence >= 46 && (retrievedEvidenceCount >= 2 || evidenceActuallyUsed >= 2)) {
    questionCoverage = "moderate";
  } else {
    questionCoverage = "limited";
  }

  return {
    workspaceEvidenceTotal,
    retrievedEvidenceCount,
    evidenceActuallyUsed,
    questionCoverage,
    hasWorkspaceKnowledge,
    hasExtensiveWorkspaceKnowledge
  };
}

function outputConfidence(output: JsonRecord, runStatus: string, input?: JsonRecord): RecommendationConfidence {
  const explicit = normalizeRecommendationConfidence(str(output.recommendation_confidence) || str(output.confidence));
  const evidence = outputEvidenceItems(output);
  const confidenceText = confidenceEvidenceText(output);
  const hasInsufficientEvidence = evidenceIsInsufficient(confidenceText);
  const hasLimitedEvidence = evidenceIsLimited(confidenceText);
  const diagnostics = input ? askEvidenceDiagnostics(input, output) : null;
  const availableEvidenceCount = evidence.length || diagnostics?.retrievedEvidenceCount || 0;

  if (runStatus === "failed" || hasInsufficientEvidence || diagnostics?.questionCoverage === "insufficient" || availableEvidenceCount === 0) {
    return "Insufficient";
  }

  if (explicit) {
    if ((hasLimitedEvidence || diagnostics?.questionCoverage === "limited") && (explicit === "High" || explicit === "Medium")) {
      return "Low";
    }

    if (diagnostics?.questionCoverage === "moderate" && explicit === "High") {
      return "Medium";
    }

    if (explicit === "High" && availableEvidenceCount < 3) {
      return availableEvidenceCount <= 1 ? "Low" : "Medium";
    }

    return explicit;
  }

  if (hasLimitedEvidence || diagnostics?.questionCoverage === "limited") {
    return "Low";
  }

  const hasFreshEvidence = /\b(current|recent|latest|last 7|last 30|today|this week|this month)\b/.test(confidenceText);
  const hasHistoricalDepth = /\b(history|historical|trend|trends|month|months|quarter|year|ytd|over time|weekly|daily)\b/.test(confidenceText);
  const hasEvidenceAgreement = evidence.length >= 2 && !/\b(conflict|conflicting|inconsistent|contradict|mismatch|unclear)\b/.test(confidenceText);
  const hasDataGaps = collectItems(output, ["limitations", "data_gaps", "missing_context"]).length > 0;

  let score = 0;
  if (availableEvidenceCount >= 6) score += 2;
  else if (availableEvidenceCount >= 3) score += 1;

  if (hasFreshEvidence) score += 1;
  if (hasHistoricalDepth) score += 1;
  if (hasEvidenceAgreement) score += 1;
  if (hasDataGaps) score -= 1;
  if (diagnostics?.questionCoverage === "strong") score += 1;
  if (diagnostics?.questionCoverage === "moderate") score = Math.min(score, 3);

  if (score >= 4) return "High";
  if (score >= 2) return "Medium";
  return "Low";
}

function confidenceDescription(confidence: RecommendationConfidence) {
  if (confidence === "High") return "Strong, current, consistent evidence supports this answer.";
  if (confidence === "Medium") return "Useful directional evidence supports this answer, with some limitations.";
  if (confidence === "Low") return "Limited or weak evidence supports this answer.";
  return "Vaeroex needs more evidence before making a confident recommendation.";
}

function confidenceClasses(confidence: string) {
  if (confidence === "High") return "border-emerald-400/40 bg-emerald-950/35 text-emerald-100";
  if (confidence === "Medium") return "border-amber-400/40 bg-amber-950/35 text-amber-100";
  if (confidence === "Low") return "border-slate-500/40 bg-slate-950/60 text-slate-200";
  return "border-slate-500/40 bg-slate-950/60 text-slate-200";
}

function inferRelatedModule(text: string) {
  const normalized = text.toLowerCase();

  if (normalized.includes("kpi") || normalized.includes("metric") || normalized.includes("revenue")) return "KPIs";
  if (normalized.includes("crm") || normalized.includes("lead") || normalized.includes("customer follow")) return "Customer Evidence";
  if (normalized.includes("sop") || normalized.includes("procedure")) return "SOPs";
  if (normalized.includes("checklist")) return "Checklists";
  if (normalized.includes("report") || normalized.includes("briefing")) return "Reports";
  if (normalized.includes("file") || normalized.includes("spreadsheet")) return "Sources";
  if (normalized.includes("issue") || normalized.includes("risk")) return "Issues";
  return "Executive Review";
}

function moduleHref(moduleName: string): Route {
  const normalized = moduleName.toLowerCase();

  if (normalized.includes("kpi")) return "/app/kpis";
  if (normalized.includes("crm")) return "/app/sources";
  if (normalized.includes("customer")) return "/app/sources";
  if (normalized.includes("sop")) return "/app/sops";
  if (normalized.includes("checklist")) return "/app/checklists";
  if (normalized.includes("report") || normalized.includes("briefing")) return "/app/reports" as Route;
  if (normalized.includes("file") || normalized.includes("source")) return "/app/sources";
  if (normalized.includes("issue")) return "/app/issues";
  if (normalized.includes("form")) return "/app/forms";
  return "/app/reports";
}

function getActionableRecommendations(output: JsonRecord) {
  const candidates = [
    ...asArray(output.recommendations),
    ...asArray(output.recommended_actions),
    ...asArray(output.suggested_tasks),
    ...asArray(output.follow_up_tasks),
    ...asArray(output.thirty_day_action_plan),
    ...asArray(output.manager_actions)
  ];

  return candidates.slice(0, 6).map((item, index) => {
    const record = asRecord(item);
    const title =
      str(record.title) ||
      str(record.action) ||
      str(record.name) ||
      (typeof item === "string" ? item : `Recommendation ${index + 1}`);
    const why =
      str(record.why_it_matters) ||
      str(record.reason_this_matters) ||
      str(record.impact) ||
      str(record.description) ||
      "This recommendation can improve visibility, decision quality, or leadership review.";
    const relatedModule = str(record.related_module) || str(record.module) || inferRelatedModule(`${title} ${why} ${str(record.category)}`);

    return {
      id: `${title}-${index}`,
      title,
      priority: str(record.priority, "Medium"),
      owner: str(record.suggested_owner) || str(record.owner) || str(record.assigned_role, "Responsible manager"),
      dueDate:
        str(record.suggested_due_date) ||
        str(record.recommended_due_date) ||
        str(record.due_date) ||
        str(record.due_date_recommendation, "Next management review"),
      why,
      relatedModule
    };
  });
}

function savedRecords(output: JsonRecord) {
  return asArray(output.saved_records).filter(isRecord);
}

function getTaskDrafts(output: JsonRecord) {
  return [...asArray(output.suggested_tasks), ...asArray(output.tasks), ...asArray(output.follow_up_tasks)].map((task, index) => {
    const record = asRecord(task);

    return {
      title: str(record.title, typeof task === "string" ? task : `Recommended review ${index + 1}`),
      description:
        str(record.description) ||
        str(record.reason_this_matters) ||
        str(record.recommended_action) ||
        "Review this recommendation as an executive intelligence signal.",
      priority: str(record.priority, "Medium"),
      category: str(record.category, "Executive review"),
      timing: str(record.timing) || str(record.review_cadence)
    };
  });
}

function getFormDrafts(output: JsonRecord) {
  return [...asArray(output.form), ...asArray(output.forms), ...asArray(output.suggested_forms)].map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name, typeof draft === "string" ? draft : `Recommended form ${index + 1}`);

    return {
      name,
      description: str(record.description) || str(record.purpose),
      formType: str(record.form_type, "Visibility"),
      fields: asArray(record.fields ?? record.recommended_fields ?? record.schema_json).map((field, fieldIndex) => {
        const fieldRecord = asRecord(field);
        return {
          label: str(fieldRecord.label, typeof field === "string" ? field : `Field ${fieldIndex + 1}`),
          type: str(fieldRecord.type, "text"),
          required: fieldRecord.required === true
        };
      })
    };
  });
}

function getChecklistDrafts(output: JsonRecord) {
  return [...asArray(output.checklist), ...asArray(output.checklists), ...asArray(output.suggested_checklists)].map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name) || str(record.checklist_name) || (typeof draft === "string" ? draft : `Recommended checklist ${index + 1}`);

    return {
      name,
      description: str(record.description) || str(record.purpose),
      frequency: str(record.frequency, "As needed"),
      owner: str(record.assigned_role) || str(record.owner_role, "Manager"),
      completionStandard: str(record.completion_standard),
      missedStandard: str(record.missed_standard),
      escalationRules: str(record.escalation_rules),
      items: asArray(record.items ?? record.checklist_items).map((item, itemIndex) =>
        typeof item === "string" ? item : formatBusinessItem(item, `Checklist item ${itemIndex + 1}`)
      )
    };
  });
}

function getSopDrafts(output: JsonRecord) {
  return [...asArray(output.sop), ...asArray(output.sops), ...asArray(output.suggested_sops)].map((draft, index) => {
    const record = asRecord(draft);

    return {
      title: str(record.title, typeof draft === "string" ? draft : `Recommended SOP ${index + 1}`),
      department: str(record.department, "Execution"),
      category: str(record.category, "SOP draft"),
      body: str(record.body_markdown) || str(record.content_markdown) || str(record.markdown) || str(record.summary)
    };
  });
}

function getReportDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.report), ...asArray(output.reports)];

  if (!drafts.length && !isStructuredText(output.response_markdown) && (output.response_markdown || output.summary)) {
    drafts.push(output);
  }

  return drafts.map((draft, index) => {
    const record = asRecord(draft);

    return {
      title: str(record.title, index === 0 ? "Vaeroex report draft" : `Vaeroex report draft ${index + 1}`),
      type: str(record.report_type, "Intelligence Report"),
      body: str(record.body_markdown) || str(record.response_markdown) || str(record.summary)
    };
  });
}

function hasDraftForTarget(output: JsonRecord, target: VaeroexSaveTarget, workflowKey: string) {
  if (target === "sop") {
    return Boolean(getSopDrafts(output).length);
  }

  if (target === "report") {
    return Boolean(getReportDrafts(output).length || ["operations_audit", "weekly_report", "daily_summary", "bottleneck_detector"].includes(workflowKey));
  }

  return false;
}

function SaveButtons({ runId, workflowKey, output }: { runId: string; workflowKey: string; output: JsonRecord }) {
  const workflow = getVaeroexWorkflow(workflowKey);
  const targets = workflow.saveTargets.filter((target) => hasDraftForTarget(output, target, workflowKey));

  if (!targets.length) {
    return (
      <p className="rounded-lg border border-line bg-slate-50 p-3 text-sm text-muted">
        This Vaeroex result has no record drafts ready to save.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((target) => (
        <form key={target} action={saveVaeroexOutputAction}>
          <input type="hidden" name="run_id" value={runId} />
          <input type="hidden" name="save_target" value={target} />
          <ConfirmSubmitButton message={`Save this Vaeroex draft into ${saveLabels[target]} now?`}>
            Confirm and save {saveLabels[target]}
          </ConfirmSubmitButton>
        </form>
      ))}
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  runId,
  runTitle
}: {
  recommendation: ReturnType<typeof getActionableRecommendations>[number];
  runId: string;
  runTitle: string;
}) {
  const recommendationOutputType = recommendation.relatedModule.toLowerCase().includes("issue") || recommendation.relatedModule.toLowerCase().includes("risk") ? "risk_brief" : "action_plan";
  const outputHref = generatedOutputHref({
    type: recommendationOutputType,
    title: recommendation.title,
    summary: recommendation.why,
    remedy: recommendation.why,
    run: runId
  });

  return (
    <article className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-cyan-50">{recommendation.title}</p>
          <p className="mt-1 text-xs text-slate-400">{recommendation.relatedModule}</p>
        </div>
        <StatusBadge value={recommendation.priority} />
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-slate-100">Output path</dt>
          <dd className="mt-1">Generate and review first</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-100">Internal tracking</dt>
          <dd className="mt-1">Handled in your existing systems</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm leading-6 text-slate-200">{recommendation.why}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={outputHref} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70">
          {recommendationOutputType === "risk_brief" ? "Generate Investigation Summary" : "Generate Improvement Plan"}
        </Link>
        <Link href={generatedOutputHref({ type: "executive_briefing", title: recommendation.title, summary: recommendation.why, remedy: recommendation.why, run: runId })} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
          Generate Executive Briefing
        </Link>
        <Link href={generatedOutputHref({ type: "checklist", title: recommendation.title, summary: recommendation.why, remedy: recommendation.why, run: runId })} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
          Generate Checklist
        </Link>
        <form action={dismissRecommendationAction}>
          <input type="hidden" name="return_path" value={`/app/ask?run=${runId}`} />
          <input type="hidden" name="source_type" value="vaeroex_recommendation" />
          <input type="hidden" name="source_id" value={runId} />
          <input type="hidden" name="source_title" value={runTitle} />
          <input type="hidden" name="assignment_title" value={recommendation.title} />
          <button className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
            Dismiss
          </button>
        </form>
      </div>
      <Link href={moduleHref(recommendation.relatedModule)} className="mt-4 inline-flex w-fit rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
        Open related source context
      </Link>
    </article>
  );
}

function RecommendationActionCards({
  recommendations,
  runId,
  runTitle,
}: {
  recommendations: ReturnType<typeof getActionableRecommendations>;
  runId: string;
  runTitle: string;
}) {
  if (!recommendations.length) {
    return null;
  }

  const [primary, ...remaining] = recommendations;

  return (
    <div className="rounded-lg border border-white/10 bg-[#08111f] p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-white">Top Executive Recommendation</h4>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Generate a clear output first. Execution should stay in the systems your company already uses.
          </p>
        </div>
        <Link href="/app" className="text-xs font-semibold text-slate-400 underline hover:text-cyan-100">
          Back to workspace
        </Link>
      </div>
      <div className="mt-4">
        <RecommendationCard recommendation={primary} runId={runId} runTitle={runTitle} />
      </div>
      {remaining.length ? (
        <details className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">
            View remaining recommendations ({remaining.length})
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {remaining.map((recommendation) => (
              <RecommendationCard key={recommendation.id} recommendation={recommendation} runId={runId} runTitle={runTitle} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function cleanReadableText(value: unknown) {
  const text = str(value);

  if (!text || isStructuredText(text)) {
    return "";
  }

  return text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
}

function ReadableText({ value }: { value: unknown }) {
  const text = cleanReadableText(value);

  if (!text) {
    return null;
  }

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  return (
    <div className="space-y-3 text-sm leading-6 text-muted">
      {blocks.map((block) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));

        if (bulletLines.length && bulletLines.length === lines.length) {
          return (
            <ul key={block} className="space-y-2">
              {bulletLines.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
                  <span>{line.replace(/^[-*]\s+/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
          return (
            <h4 key={block} className="text-sm font-semibold text-foreground">
              {lines[0].replace(/^#{1,3}\s+/, "")}
            </h4>
          );
        }

        return (
          <p key={block} className="whitespace-pre-line">
            {block.replace(/^#{1,3}\s+/gm, "")}
          </p>
        );
      })}
    </div>
  );
}

function TaskDraftSection({ tasks }: { tasks: ReturnType<typeof getTaskDrafts> }) {
  if (!tasks.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">Review Drafts</h4>
      <div className="mt-3 space-y-3">
        {tasks.map((task) => (
          <article key={`${task.title}-${task.description}`} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold">{task.title}</p>
              <StatusBadge value={task.priority} />
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{task.description}</p>
            <p className="mt-2 text-xs text-muted">
              {task.category}
              {task.timing ? ` - ${task.timing}` : ""}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function FormDraftSection({ forms }: { forms: ReturnType<typeof getFormDrafts> }) {
  if (!forms.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">Form Drafts</h4>
      <div className="mt-3 space-y-4">
        {forms.map((form) => (
          <article key={form.name} className="space-y-3">
            <div>
              <p className="font-semibold">{form.name}</p>
              {form.description ? <p className="mt-1 text-sm leading-6 text-muted">{form.description}</p> : null}
              <p className="mt-1 text-xs text-muted">Type: {form.formType}</p>
            </div>
            {form.fields.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {form.fields.map((field) => (
                  <li key={`${form.name}-${field.label}`} className="rounded-md border border-line bg-slate-50 p-2 text-sm">
                    <span className="font-medium">{field.label}</span>
                    <span className="text-muted"> - {field.type}</span>
                    {field.required ? <span className="text-muted"> - required</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function ChecklistDraftSection({ checklists }: { checklists: ReturnType<typeof getChecklistDrafts> }) {
  if (!checklists.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">Checklist Drafts</h4>
      <div className="mt-3 space-y-4">
        {checklists.map((checklist) => (
          <article key={checklist.name}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{checklist.name}</p>
                {checklist.description ? <p className="mt-1 text-sm leading-6 text-muted">{checklist.description}</p> : null}
              </div>
              <StatusBadge value={checklist.frequency} />
            </div>
            <p className="mt-2 text-xs text-muted">Owner role: {checklist.owner}</p>
            {checklist.items.length ? (
              <ol className="mt-3 space-y-2 text-sm leading-6 text-muted">
                {checklist.items.map((item, index) => (
                  <li key={`${checklist.name}-${item}`} className="flex gap-2">
                    <span className="font-semibold text-vaeroex-blue">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {checklist.completionStandard || checklist.missedStandard || checklist.escalationRules ? (
              <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-muted">
                {checklist.completionStandard ? <p>Completion standard: {checklist.completionStandard}</p> : null}
                {checklist.missedStandard ? <p>Missed standard: {checklist.missedStandard}</p> : null}
                {checklist.escalationRules ? <p>Escalation: {checklist.escalationRules}</p> : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function SopDraftSection({ sops }: { sops: ReturnType<typeof getSopDrafts> }) {
  if (!sops.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">SOP Drafts</h4>
      <div className="mt-3 space-y-4">
        {sops.map((sop) => (
          <article key={sop.title}>
            <p className="font-semibold">{sop.title}</p>
            <p className="mt-1 text-xs text-muted">
              {sop.department} - {sop.category}
            </p>
            <div className="mt-3 rounded-md bg-slate-50 p-3">
              <ReadableText value={sop.body} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ReportDraftSection({ reports }: { reports: ReturnType<typeof getReportDrafts> }) {
  if (!reports.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">Report Draft</h4>
      <div className="mt-3 space-y-4">
        {reports.map((report) => (
          <article key={report.title}>
            <p className="font-semibold">{report.title}</p>
            <p className="mt-1 text-xs text-muted">{report.type}</p>
            <div className="mt-3 rounded-md bg-slate-50 p-3">
              <ReadableText value={report.body} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function BusinessResult({ output, runId, runTitle }: { output: JsonRecord; runId: string; runTitle: string }) {
  const visibleOutput = displayOutput(output);
  const sections = businessSections(visibleOutput);
  const tasks = getTaskDrafts(visibleOutput);
  const forms = getFormDrafts(visibleOutput);
  const checklists = getChecklistDrafts(visibleOutput);
  const sops = getSopDrafts(visibleOutput);
  const reports = getReportDrafts(visibleOutput);
  const recommendations = getActionableRecommendations(visibleOutput);
  const detail = cleanReadableText(visibleOutput.response_markdown);
  const topProblems = sections.problems.slice(0, 3);
  const topAction = recommendations[0]?.title || sections.actions[0];
  const topActionWhy = recommendations[0]?.why || outputReasoning(visibleOutput);
  const hasRecordDrafts = Boolean(tasks.length || checklists.length || forms.length || sops.length);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-4 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-100">Executive Summary</p>
        <p className="mt-2 text-sm leading-6 text-slate-100">{sections.executiveSummary}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_.7fr]">
        <ResultList title="Top Problems" items={topProblems} />
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <h4 className="text-sm font-semibold text-white">Top Executive Recommendation</h4>
          <p className="mt-3 text-sm font-semibold leading-6 text-cyan-100">{topAction}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{topActionWhy}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <h4 className="text-sm font-semibold text-white">Why Vaeroex Surfaced This</h4>
          <p className="mt-3 text-sm leading-6 text-slate-300">{outputReasoning(visibleOutput)}</p>
        </div>
      </div>

      <RecommendationActionCards recommendations={recommendations} runId={runId} runTitle={runTitle} />

      {hasRecordDrafts ? (
        <details className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">
            View suggested documents, SOPs, forms, or checklists
          </summary>
          <div className="mt-4 space-y-4">
            <TaskDraftSection tasks={tasks} />
            <ChecklistDraftSection checklists={checklists} />
            <FormDraftSection forms={forms} />
            <SopDraftSection sops={sops} />
          </div>
        </details>
      ) : null}

      {reports.length ? (
        <details className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">View full report draft</summary>
          <div className="mt-3">
            <ReportDraftSection reports={reports} />
          </div>
        </details>
      ) : null}

      {detail && detail !== sections.executiveSummary ? (
        <details className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">View additional notes</summary>
          <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <ReadableText value={detail} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function conversationAnswerText(output: JsonRecord) {
  const sections = businessSections(output);
  const candidates = [
    cleanReadableText(output.direct_answer),
    cleanReadableText(output.response_markdown),
    cleanReadableText(output.answer),
    cleanReadableText(output.response),
    cleanReadableText(output.summary),
    cleanReadableText(output.executive_summary),
    sections.executiveSummary
  ];

  return softenAskAnswerText(
    candidates.find(Boolean) || "Vaeroex completed the request, but the answer was limited by the available workspace context."
  );
}

function softenAskAnswerText(value: string) {
  const softened = value
    .replace(/^#{1,4}\s*(Executive Summary|Top Problems|Top Executive Recommendation|Why Vaeroex Surfaced This)\s*$/gim, "")
    .replace(/^(Based on (the )?(available|current|workspace) evidence,?\s*)/i, "")
    .replace(/^(From (the )?(available|current|workspace) evidence,?\s*)/i, "")
    .replace(/^(Given (the )?(available|current|workspace) evidence,?\s*)/i, "")
    .replace(/^(The available evidence suggests( that)?\s*)/i, "")
    .replace(/^(The current evidence suggests( that)?\s*)/i, "")
    .replace(/^(Evidence (indicates|suggests)( that)?\s*)/i, "")
    .replace(/^Executive summary:?\s*/i, "")
    .replace(/^Confidence[^.]*\.\s*/i, "")
    .replace(/^There is (currently )?(very )?limited (information|evidence|financial history|context)[^.]*\.\s*/i, "")
    .replace(/^There is not enough (workspace |question-specific )?evidence[^.]*\.\s*/i, "")
    .replace(/^Leadership should review\s+([^.\n]+)\.?/i, "$1 needs leadership attention.")
    .replace(/\bReview Customer\s+Pipeline\b/g, "Customer activity evidence needs leadership attention")
    .replace(/\bAddress Overdue Tasks\b/g, "Overdue activity needs leadership review")
    .replace(/\bEnhance Follow-Up\b/g, "Follow-up quality may need attention")
    .replace(/\bCreate\s+CRM follow-up task list\b/gi, "Review customer response evidence")
    .replace(/\bAssign owner\b/gi, "Review with the responsible leader")
    .replace(/\bCreate follow-up\b/gi, "Decide whether a leadership review is needed")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return softened ? `${softened.charAt(0).toUpperCase()}${softened.slice(1)}` : value.trim();
}

function evidenceSourceLabel(item: string) {
  const normalized = item.toLowerCase();

  if (/crm|pipeline|lead|customer|follow-up|follow up/.test(normalized)) return "Customer Evidence";
  if (/kpi|metric|revenue|target|trend|history|forecast|score/.test(normalized)) return "KPI History";
  if (/business signal|signal|business memory|memory/.test(normalized)) return "Business Signals";
  if (/report|brief|briefing|review/.test(normalized)) return "Reports";
  if (/file|source|upload|document|spreadsheet|csv|xlsx|pdf/.test(normalized)) return "Source Files";
  if (/sop|process|procedure|policy/.test(normalized)) return "Process Documents";

  return "Workspace Context";
}

function citationEvidenceItems(input: JsonRecord) {
  const citations = asArray(evidenceContextFromInput(input).citations);

  return unique(
    citations.map((item, index) => {
      const citation = asRecord(item);
      const title = str(citation.title, `Supporting evidence ${index + 1}`);
      const sourceType = str(citation.source_type);
      const excerpt = str(citation.summary) || str(citation.excerpt);
      const source = sourceType ? `${sourceType}: ${title}` : title;
      const preview = excerpt.length > 180 ? `${excerpt.slice(0, 177).trim()}...` : excerpt;

      return excerpt ? `${source} - ${preview}` : source;
    })
  );
}

function supportingEvidenceItems(output: JsonRecord, input: JsonRecord) {
  const evidence = outputEvidenceItems(output);
  return evidence.length ? evidence : citationEvidenceItems(input);
}

function evidenceUsedLabels(output: JsonRecord, input: JsonRecord) {
  const evidence = outputEvidenceItems(output);
  const citationEvidence = citationEvidenceItems(input);
  return unique((evidence.length ? evidence : citationEvidence.length ? citationEvidence : ["Workspace Context"]).map(evidenceSourceLabel)).slice(0, 6);
}

function inlineList(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function briefEvidenceNote(labels: string[], diagnostics: ReturnType<typeof askEvidenceDiagnostics>, confidence: RecommendationConfidence) {
  if (confidence === "Insufficient" || diagnostics.questionCoverage === "insufficient") {
    if (diagnostics.hasWorkspaceKnowledge) {
      return "Your workspace contains business information, but Vaeroex does not have enough question-specific evidence to answer this reliably yet.";
    }

    return "There is not enough workspace evidence to answer this reliably yet.";
  }

  if (confidence === "Low" || diagnostics.questionCoverage === "limited") {
    if (diagnostics.hasExtensiveWorkspaceKnowledge) {
      return "Your workspace contains meaningful business information, but only a limited portion directly supports this question, so this answer is directional.";
    }

    return "The evidence directly related to this question is limited, so this answer is directional rather than definitive.";
  }

  if (confidence === "Medium") {
    return `This recommendation is supported by ${inlineList(labels)}, with some question-specific limits.`;
  }

  return `This recommendation is based on ${inlineList(labels)}.`;
}

function ConversationResult({
  output,
  run
}: {
  output: JsonRecord;
  run: { id: string; agent_type: string; status: string; input_json?: Json };
}) {
  const visibleOutput = displayOutput(output);
  const input = getRunInput(run);
  const question = str(input.user_prompt, "Question not recorded.");
  const answer = conversationAnswerText(visibleOutput);
  const confidence = outputConfidence(visibleOutput, run.status, input);
  const diagnostics = askEvidenceDiagnostics(input, visibleOutput);
  const evidence = supportingEvidenceItems(visibleOutput, input);
  const evidenceLabels = evidenceUsedLabels(visibleOutput, input);
  const evidencePreview = evidence.length
    ? evidence.slice(0, 6)
    : diagnostics.hasWorkspaceKnowledge
      ? ["Vaeroex found workspace information, but not enough evidence directly related to this question."]
      : ["Limited workspace evidence was available for this answer."];
  const evidenceNote = briefEvidenceNote(evidenceLabels, diagnostics, confidence);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-[#071526] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">You asked</p>
        <p className="mt-2 text-sm leading-6 text-slate-100">{question}</p>
      </div>

      <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">Direct Answer</p>
        <div className="mt-4 max-w-4xl text-base leading-7 text-slate-50">
          <ReadableText value={answer} />
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100">
        <p className="text-sm font-semibold">Evidence Note</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{evidenceNote}</p>
        <ul className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-200">
          {evidenceLabels.map((item) => (
            <li key={item} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className={`rounded-lg border p-4 ${confidenceClasses(confidence)}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Recommendation Confidence</p>
        <p className="mt-2 text-2xl font-semibold">{confidence}</p>
        <p className="mt-2 text-xs leading-5 opacity-85">
          {confidenceDescription(confidence)}
        </p>
      </div>

      <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Show Supporting Evidence</summary>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
          {evidencePreview.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  const match = message.match(/^(\d+)\s+([a-z_]+)\s+saved$/i);
  const count = match?.[1];
  const target = match?.[2]?.toLowerCase();
  const destination = target ? saveDestinations[target] : null;
  const readableTarget = destination?.label || "workspace records";

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
      <p className="font-semibold">Saved successfully.</p>
      <p className="mt-1 leading-6">
        {count && destination
          ? `Vaeroex saved ${count} draft ${Number(count) === 1 ? "item" : "items"} into ${readableTarget}.`
          : message}
      </p>
      {destination ? (
        <Link href={destination.href} className="mt-3 inline-flex rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800">
          Open {destination.label}
        </Link>
      ) : null}
    </div>
  );
}

function AdminDebugOutput({ enabled, output }: { enabled: boolean; output: Json }) {
  if (!enabled) {
    return null;
  }

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-slate-100">
      <summary className="cursor-pointer text-sm font-semibold">Admin debug output</summary>
      <pre className="mt-3 max-h-80 overflow-auto text-xs leading-5">{JSON.stringify(output, null, 2)}</pre>
    </details>
  );
}

function DataUsedPanel({ input }: { input: JsonRecord }) {
  const items = dataUsedSummary(input);

  return (
    <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Data used</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Workspace context Vaeroex gathered before generating this result.</p>
        </div>
        <span className="w-fit rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2.5 py-1 text-[0.68rem] font-semibold text-cyan-100">
          Tenant-safe workspace data
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <p className="text-lg font-semibold text-white">{item.value}</p>
            <p className="mt-1 text-xs text-slate-400">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function failureReasons(input: JsonRecord, message?: string | null) {
  const reasons = [];
  const lowerMessage = (message || "").toLowerCase();
  const metrics = snapshotMetrics(input);
  const hasAnyData = dataUsedSummary(input).some((item) => item.value > 0);

  if (/temporarily unavailable|api key|openai|authentication|authorization/.test(lowerMessage)) {
    reasons.push("Vaeroex intelligence is temporarily unavailable or the OpenAI runtime rejected the request.");
  }

  if (!hasAnyData) {
    reasons.push("This workspace has little or no KPI, report, file, issue, source-signal, or business-memory context yet.");
  }

  if (!numberValue(metrics.kpi_history_records)) {
    reasons.push("No KPI history was available for trend-based analysis.");
  }

  if (!numberValue(metrics.reports)) {
    reasons.push("No saved reports were available for business memory.");
  }

  if (!reasons.length) {
    reasons.push("Vaeroex could not complete the request. Retry once, then review technical details if you are an admin.");
  }

  return unique(reasons).slice(0, 4);
}

function FailurePanel({
  run,
  canViewDebug
}: {
  run: { id: string; agent_type: string; status: string; error_message: string | null; input_json?: Json; output_json?: Json };
  canViewDebug: boolean;
}) {
  if (isSecurityResponseRun(run)) {
    return <SecurityResponseNotice />;
  }

  const input = getRunInput(run);
  const extraInputs = getRunExtraInputs(run);
  const reasons = failureReasons(input, run.error_message);
  const diagnostics = runDiagnosticsFromOutput(run.output_json);
  const finalStage = str(diagnostics.final_stage);
  const requestId = str(diagnostics.request_id);
  const errorType = str(diagnostics.error_type);

  return (
    <div className="space-y-4 rounded-lg border border-red-400/35 bg-red-950/25 p-4 text-red-50">
      <div>
        <p className="text-lg font-semibold">We couldn&apos;t generate this analysis.</p>
        <p className="mt-2 text-sm leading-6 text-red-100/85">Vaeroex saved the failed run so an admin can review it. No workspace records were created.</p>
      </div>
      <ul className="space-y-2 text-sm leading-6 text-red-100/85">
        {reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-300" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      <form
        action={runVaeroexAction}
        className="flex flex-wrap gap-2"
        data-vaeroex-skip-global-activity={run.agent_type === "ask_vaeroex" ? "true" : undefined}
      >
        <input type="hidden" name="workflow_key" value={run.agent_type} />
        <input type="hidden" name="user_prompt" value={str(input.user_prompt)} />
        <input type="hidden" name="date_range_start" value={str(extraInputs.date_range_start)} />
        <input type="hidden" name="date_range_end" value={str(extraInputs.date_range_end)} />
        <input type="hidden" name="subject" value={str(extraInputs.subject)} />
        <PendingSubmitButton className={vaeroexSubmitClass} pendingLabel="Retrying..." activityDisabled={run.agent_type === "ask_vaeroex"}>
          Retry
        </PendingSubmitButton>
        <Link href="/app?search=1" className="rounded-lg border border-red-300/35 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-50 hover:bg-red-400/20">
          Open Search or Ask
        </Link>
      </form>
      {canViewDebug ? (
        <details className="rounded-lg border border-red-300/20 bg-slate-950/80 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-red-50">View technical details</summary>
          <dl className="mt-3 grid gap-2 text-xs leading-5 text-red-100/80 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-red-50">Run ID</dt>
              <dd className="break-all">{run.id}</dd>
            </div>
            <div>
              <dt className="font-semibold text-red-50">Workflow</dt>
              <dd>{vaeroexResultLabel(run.agent_type)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold text-red-50">Error</dt>
              <dd>{friendlyHubError(run.error_message) || "No error message was recorded."}</dd>
            </div>
            {finalStage ? (
              <div>
                <dt className="font-semibold text-red-50">Final stage</dt>
                <dd>{finalStage}</dd>
              </div>
            ) : null}
            {errorType ? (
              <div>
                <dt className="font-semibold text-red-50">Error type</dt>
                <dd>{errorType}</dd>
              </div>
            ) : null}
            {requestId ? (
              <div className="sm:col-span-2">
                <dt className="font-semibold text-red-50">Request ID</dt>
                <dd className="break-all">{requestId}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function SelectedResult({
  run,
  output,
  canViewDebug,
  debugMode,
}: {
  run: { id: string; agent_type: string; status: string; created_at: string; error_message: string | null; input_json: Json; output_json: Json };
  output: JsonRecord;
  canViewDebug: boolean;
  debugMode: boolean;
}) {
  if (isSecurityResponseRun(run, output)) {
    return <SecurityResponseNotice />;
  }

  if (run.status === "failed") {
    return (
      <SectionCard title="Vaeroex request did not complete" description="The request was saved with a clear failure state so it can be reviewed or retried.">
        <FailurePanel run={run} canViewDebug={canViewDebug} />
      </SectionCard>
    );
  }

  if (run.status === "running") {
    return (
      <SectionCard title="Vaeroex is still generating" description="This request started successfully and has not reached a final state yet.">
        <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-4 text-sm text-cyan-50">
          <p className="font-semibold">Generation in progress</p>
          <p className="mt-1 text-cyan-100/80">
            Vaeroex created the run record and is still processing. If this remains here, retry the request or check admin diagnostics.
          </p>
        </div>
      </SectionCard>
    );
  }

  const display = displayOutput(output);
  const title = resultTitle(display, vaeroexResultLabel(run.agent_type));

  return (
    <SectionCard title="Vaeroex answer" description="A direct answer first. Evidence and optional outputs are available when you want to go deeper.">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted">
              {vaeroexResultLabel(run.agent_type)} - {new Date(run.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={run.status} />
          </div>
        </div>

        {run.error_message ? <ErrorNotice message={friendlyHubError(run.error_message)} /> : null}
        {run.status === "completed" ? (
          <ConversationResult output={output} run={run} />
        ) : null}

        {run.status === "completed" ? (
          <details className="rounded-lg border border-white/10 bg-slate-950/45 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced: save structured drafts into workspace records</summary>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Use this only after reviewing the Vaeroex output and deciding that a draft should become an internal record.
            </p>
            <div className="mt-4">
              <SaveButtons runId={run.id} workflowKey={run.agent_type} output={displayOutput(output)} />
            </div>
          </details>
        ) : null}

        {savedRecords(output).length ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">Confirmed save history</p>
            <p className="mt-1">
              {savedRecords(output).length} save event{savedRecords(output).length === 1 ? "" : "s"} recorded for this Vaeroex result.
            </p>
          </div>
        ) : null}

        {canViewDebug && !debugMode ? (
          <Link href={{ pathname: "/app/ask", query: { run: run.id, debug: "1" } }} className="inline-flex text-xs font-semibold text-muted underline">
            Open admin debug output
          </Link>
        ) : null}
        <AdminDebugOutput enabled={canViewDebug && debugMode} output={run.output_json} />
      </div>
    </SectionCard>
  );
}

function WorkflowCard({ workflowKey }: { workflowKey: VaeroexWorkflowKey }) {
  const workflow = getVaeroexWorkflow(workflowKey);

  return (
    <article className="rounded-lg border border-vaeroex-silver bg-white p-4 shadow-sm hover:border-vaeroex-accent">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold text-vaeroex-navy">{workflow.title}</h3>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[0.68rem] font-semibold text-emerald-800">
            Ready
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">{workflow.description}</p>
        <p className="mt-3 rounded-lg border border-line bg-slate-50 p-3 text-xs leading-5 text-muted">
          <span className="font-semibold text-ink">Data used:</span> {workflowDataUsed(workflow.key)}
        </p>
      </div>
      <WorkflowRunForm workflowKey={workflow.key} />
    </article>
  );
}

function WorkflowRunForm({
  workflowKey,
  defaultPrompt = "",
  compact = false
}: {
  workflowKey: VaeroexWorkflowKey;
  defaultPrompt?: string;
  compact?: boolean;
}) {
  const workflow = getVaeroexWorkflow(workflowKey);

  return (
    <form
      action={runVaeroexAction}
      className={compact ? "mt-4 space-y-4" : "mt-4 space-y-3"}
      data-vaeroex-skip-global-activity={workflow.key === "ask_vaeroex" ? "true" : undefined}
    >
      <input type="hidden" name="workflow_key" value={workflow.key} />
      <TextArea
        label={workflow.key === "ask_vaeroex" ? "Question" : "Context for Vaeroex"}
        name="user_prompt"
        required={workflow.key === "ask_vaeroex"}
        defaultValue={defaultPrompt}
        placeholder={workflow.promptPlaceholder}
        rows={compact ? 4 : 3}
      />
      {workflow.key === "weekly_report" || workflow.key === "daily_summary" || workflow.key === "business_review_package" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Start date" name="date_range_start" type="date" />
          <TextInput label="End date" name="date_range_end" type="date" />
        </div>
      ) : null}
      <PendingSubmitButton className={vaeroexSubmitClass} pendingLabel="Generating..." activityDisabled={workflow.key === "ask_vaeroex"}>
        {workflow.actionLabel}
      </PendingSubmitButton>
    </form>
  );
}

export default async function VaeroexHubPage({ searchParams }: VaeroexHubPageProps) {
  const params = await searchParams;

  if (!params?.run && !params?.error && !params?.saved && !params?.debug) {
    redirect("/app?search=1");
  }

  const { supabase, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [{ data: runs, error }, folderResult] = await Promise.all([
    supabase
      .from("ai_agent_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(30),
    getRecordFolders(supabase, workspaceId, "ai_agent_runs")
  ]);
  const runParam = typeof params?.run === "string" ? params.run : "";
  const selectedRun = runParam ? runs?.find((run) => run.id === runParam) ?? null : null;
  const selectedOutput = selectedRun ? asRecord(selectedRun.output_json) : {};
  const canViewDebug = isVaeroexAdminUser(user);
  const debugMode = params?.debug === "1";
  const promptDefault = typeof params?.prompt === "string" ? params.prompt : "";
  const requestedWorkflowKey = typeof params?.workflow === "string" ? params.workflow : "ask_vaeroex";
  const selectedWorkflow = requestedWorkflowKey ? getVaeroexWorkflow(requestedWorkflowKey) : null;
  const pageErrorMessage = friendlyHubError(
    (selectedRun ? undefined : (params?.error as string | undefined)) || error?.message || folderResult.error?.message
  );

  if ((selectedRun && isSecurityResponseRun(selectedRun, selectedOutput)) || isSecurityResponseMessage(pageErrorMessage)) {
    return (
      <div className="mx-auto max-w-3xl">
        <SecurityResponseNotice />
      </div>
    );
  }

  const managedRuns = (runs || []).map((run) => {
    const management = managedValues(run);
    const output = asRecord(run.output_json);
    const display = displayOutput(output);
    const sections = businessSections(display);

    return {
      id: run.id,
      title: resultTitle(display, vaeroexResultLabel(run.agent_type)),
      type: vaeroexResultLabel(run.agent_type),
      status: run.status,
      owner: run.created_by ? "Workspace" : "Vaeroex",
      category: run.agent_type,
      createdAt: run.created_at,
      updatedAt: management.updatedAt || run.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(sections.executiveSummary || run.error_message, "No output yet."),
      href: `/app/agents?run=${run.id}` as Route,
      meta: [
        { label: "Workflow", value: vaeroexResultLabel(run.agent_type) },
        { label: "Status", value: run.status }
      ],
      editFields: vaeroexRunEditFields,
      editValues: {
        status: run.status,
        error_message: run.error_message
      },
      children:
        isSecurityResponseRun(run, output) ? (
          <SecurityResponseNotice compact />
        ) : run.status === "completed" ? (
          <BusinessResult output={display} runId={run.id} runTitle={resultTitle(display, vaeroexResultLabel(run.agent_type))} />
        ) : (
          <ErrorNotice message={friendlyHubError(run.error_message) || "This run has not completed yet."} />
        )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vaeroex Results"
        title="Saved Vaeroex Result"
        description={canViewDebug ? "Review a saved Vaeroex answer or admin diagnostic record. New questions now start from global Search or Ask." : "Review this saved Vaeroex answer. New questions now start from global Search or Ask."}
      />

      <ErrorNotice message={pageErrorMessage} />
      <SuccessNotice message={params?.saved as string | undefined} />

      <section className="space-y-6">
        {!selectedRun ? (
        <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          {selectedWorkflow ? (
            <div className="rounded-lg border border-cyan-300/25 bg-[#071526] p-4 text-slate-100">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Question first</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">{selectedWorkflow.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300">{selectedWorkflow.description}</p>
                </div>
              </div>
              <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300">
                <span className="font-semibold text-white">Data used:</span> {workflowDataUsed(selectedWorkflow.key)}
              </p>
              <WorkflowRunForm workflowKey={selectedWorkflow.key} defaultPrompt={promptDefault} compact />
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">
              Choose one workflow. Vaeroex will show one focused input area, then return an answer with evidence available when you need it.
            </p>
          )}

          <details className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Change workflow</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {WORKFLOW_CHOICES.map((choice) => {
                const isActive = selectedWorkflow?.key === choice.workflowKey;
                const className = `rounded-lg border p-4 text-left transition ${
                  isActive
                    ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-50"
                    : "border-white/10 bg-[#08111f] text-slate-100 hover:border-cyan-300/45 hover:bg-blue-950/30"
                }`;

                if (choice.href) {
                  return (
                    <Link key={choice.label} href={choice.href} className={className}>
                      <span className="block text-sm font-semibold">{choice.label}</span>
                      <span className="mt-2 block text-xs leading-5 text-slate-400">{choice.description}</span>
                    </Link>
                  );
                }

                return (
                  <Link
                    key={choice.label}
                    href="/app?search=1"
                    className={className}
                  >
                    <span className="block text-sm font-semibold">{choice.label}</span>
                    <span className="mt-2 block text-xs leading-5 text-slate-400">{choice.description}</span>
                  </Link>
                );
              })}
            </div>
          </details>
        </section>
        ) : null}

        {selectedRun ? (
          <SelectedResult run={selectedRun} output={selectedOutput} canViewDebug={canViewDebug} debugMode={debugMode} />
        ) : null}

        {canViewDebug ? (
          <section className="space-y-4 rounded-lg border border-white/10 bg-[#08111f] p-4">
            <details open={Boolean(!selectedRun)} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">Admin result records</summary>
              <div className="mt-4">
                <ManagedRecordList
                  collection="ai_agent_runs"
                  records={managedRuns}
                  folders={folderResult.folders}
                  title="Vaeroex result records"
                  description="Admin-only execution history and diagnostics. Customer-facing business knowledge is managed in Sources → Learned Knowledge."
                  emptyTitle="No Vaeroex results yet"
                  emptyDescription="Use global Search or Ask, contextual explanations, or generated outputs to create saved Vaeroex results."
                  returnPath="/app/agents"
                  searchParams={params}
                />
              </div>
            </details>

            <details className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">Admin workflows</summary>
              <div className="mt-4 space-y-4">
                {WORKFLOW_GROUPS.map((group) => (
                  <details key={group.title} className="rounded-lg border border-white/10 bg-[#08111f]">
                    <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-semibold text-white">{group.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-slate-400">{group.description}</p>
                      </div>
                      <span className="w-fit rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                        {group.keys.length} tool{group.keys.length === 1 ? "" : "s"}
                      </span>
                    </summary>
                    <div className="grid gap-4 border-t border-white/10 p-4 lg:grid-cols-2">
                      {group.keys.map((workflowKey) => (
                        <WorkflowCard key={workflowKey} workflowKey={workflowKey} />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          </section>
        ) : null}
      </section>
    </div>
  );
}
