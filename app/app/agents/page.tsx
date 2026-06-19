import Link from "next/link";
import type { Route } from "next";
import { dismissRecommendationAction } from "@/app/app/accountability/actions";
import { runVaeroexAction, saveVaeroexOutputAction } from "@/app/app/agents/actions";
import { AssignmentPanel, ShareRecordPanel, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { EmptyState } from "@/components/operations/EmptyState";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { VAEROEX_WORKFLOWS, getVaeroexWorkflow, type VaeroexSaveTarget } from "@/lib/ai/vaeroex-workflows";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type VaeroexHubPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type JsonRecord = Record<string, unknown>;

const saveLabels: Record<VaeroexSaveTarget, string> = {
  tasks: "suggested tasks",
  sop: "SOP draft",
  form: "form draft",
  checklist: "checklist draft",
  report: "report draft"
};

const saveDestinations: Record<string, { label: string; href: Route }> = {
  tasks: { label: "Tasks", href: "/app/tasks" },
  sop: { label: "SOPs", href: "/app/sops" },
  form: { label: "Forms", href: "/app/forms" },
  checklist: { label: "Checklists", href: "/app/checklists" },
  report: { label: "Reports", href: "/app/reports" }
};
const vaeroexRunEditFields: ManagedRecordEditField[] = [
  { name: "status", label: "Status", type: "select", options: ["queued", "running", "completed", "failed"] },
  { name: "error_message", label: "Error message", type: "textarea", rows: 4 }
];

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

function vaeroexResultLabel(value: string) {
  return getVaeroexWorkflow(value).title;
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
  const owner = str(record.owner) || str(record.assigned_role);
  const timing = str(record.timing) || str(record.due_date_recommendation) || str(record.frequency);
  const tail = unique([owner ? `Owner: ${owner}` : "", timing ? `Timing: ${timing}` : ""]).join(" - ");

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
    "risks"
  ]);
  const actions = collectItems(output, [
    "recommended_actions",
    "suggested_tasks",
    "follow_up_tasks",
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
    actions: actions.length ? actions : ["Review the draft, choose the first priority, and assign an owner."],
    systems: systems.length ? systems : ["Accountability dashboard", "Follow-up system", "Weekly management review"]
  };
}

function inferRelatedModule(text: string) {
  const normalized = text.toLowerCase();

  if (normalized.includes("kpi") || normalized.includes("metric") || normalized.includes("revenue")) return "KPIs";
  if (normalized.includes("crm") || normalized.includes("lead") || normalized.includes("customer follow")) return "CRM";
  if (normalized.includes("sop") || normalized.includes("procedure")) return "SOPs";
  if (normalized.includes("checklist")) return "Checklists";
  if (normalized.includes("report")) return "Reports";
  if (normalized.includes("file") || normalized.includes("spreadsheet")) return "Files";
  if (normalized.includes("issue") || normalized.includes("risk")) return "Issues";
  return "Tasks";
}

function moduleHref(moduleName: string): Route {
  const normalized = moduleName.toLowerCase();

  if (normalized.includes("kpi")) return "/app/kpis";
  if (normalized.includes("crm")) return "/app/crm";
  if (normalized.includes("sop")) return "/app/sops";
  if (normalized.includes("checklist")) return "/app/checklists";
  if (normalized.includes("report")) return "/app/reports";
  if (normalized.includes("file")) return "/app/files";
  if (normalized.includes("issue")) return "/app/issues";
  if (normalized.includes("form")) return "/app/forms";
  return "/app/tasks";
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
      "This recommendation can improve accountability, visibility, or follow-through.";
    const relatedModule = str(record.related_module) || str(record.module) || inferRelatedModule(`${title} ${why} ${str(record.category)}`);

    return {
      id: `${title}-${index}`,
      title,
      priority: str(record.priority, "Medium"),
      owner: str(record.suggested_owner) || str(record.owner) || str(record.assigned_role, "Manager"),
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
      title: str(record.title, typeof task === "string" ? task : `Recommended task ${index + 1}`),
      description:
        str(record.description) ||
        str(record.reason_this_matters) ||
        str(record.recommended_action) ||
        "Review this recommendation and assign an owner.",
      priority: str(record.priority, "Medium"),
      category: str(record.category, "Operations"),
      timing: str(record.due_date_recommendation) || str(record.recommended_due_date) || str(record.due_date)
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
      formType: str(record.form_type, "Operations"),
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
      department: str(record.department, "Operations"),
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
      type: str(record.report_type, "Operations Report"),
      body: str(record.body_markdown) || str(record.response_markdown) || str(record.summary)
    };
  });
}

function hasDraftForTarget(output: JsonRecord, target: VaeroexSaveTarget, workflowKey: string) {
  if (target === "tasks") {
    return Boolean(getTaskDrafts(output).length);
  }

  if (target === "form") {
    return Boolean(getFormDrafts(output).length);
  }

  if (target === "checklist") {
    return Boolean(getChecklistDrafts(output).length);
  }

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
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
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

function RecommendationActionCards({
  recommendations,
  runId,
  runTitle,
  people
}: {
  recommendations: ReturnType<typeof getActionableRecommendations>;
  runId: string;
  runTitle: string;
  people: TeamPersonOption[];
}) {
  if (!recommendations.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h4 className="text-sm font-semibold">Actionable Recommendations</h4>
          <p className="mt-1 text-sm leading-6 text-muted">
            Vaeroex drafts are not saved until you confirm. Use these actions to turn insight into workspace records.
          </p>
        </div>
        <Link href="/app/agents" className="text-xs font-semibold text-muted underline">
          Dismiss for now
        </Link>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {recommendations.map((recommendation) => (
          <article key={recommendation.id} className="rounded-lg border border-line bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">{recommendation.title}</p>
                <p className="mt-1 text-xs text-muted">{recommendation.relatedModule}</p>
              </div>
              <StatusBadge value={recommendation.priority} />
            </div>
            <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink">Suggested owner</dt>
                <dd className="mt-1">{recommendation.owner}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Suggested due date</dt>
                <dd className="mt-1">{recommendation.dueDate}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm leading-6 text-slate-700">{recommendation.why}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/app/tasks" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">Create Task</Link>
              <Link href={moduleHref(recommendation.relatedModule)} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">
                Open {recommendation.relatedModule}
              </Link>
              <Link href="/app/reports" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">Add to Report</Link>
              <form action={dismissRecommendationAction}>
                <input type="hidden" name="return_path" value={`/app/agents?run=${runId}`} />
                <input type="hidden" name="source_type" value="vaeroex_recommendation" />
                <input type="hidden" name="source_id" value={runId} />
                <input type="hidden" name="source_title" value={runTitle} />
                <input type="hidden" name="assignment_title" value={recommendation.title} />
                <button className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold">Dismiss</button>
              </form>
            </div>
            <details className="mt-4 rounded-lg border border-line bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">Assign or share this recommendation</summary>
              <div className="mt-3 grid gap-3">
                <AssignmentPanel
                  sourceType="vaeroex_recommendation"
                  sourceId={runId}
                  sourceTitle={recommendation.title}
                  relatedModule={recommendation.relatedModule}
                  returnPath={`/app/agents?run=${runId}`}
                  actionHref={`/app/agents?run=${runId}`}
                  people={people}
                  defaultTitle={recommendation.title}
                  defaultDescription={recommendation.why}
                  defaultRole={recommendation.owner}
                  compact
                />
                <ShareRecordPanel
                  sourceType="vaeroex_recommendation"
                  sourceId={runId}
                  sourceTitle={recommendation.title}
                  relatedModule={recommendation.relatedModule}
                  returnPath={`/app/agents?run=${runId}`}
                  actionHref={`/app/agents?run=${runId}`}
                  people={people}
                />
              </div>
            </details>
          </article>
        ))}
      </div>
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
      <h4 className="text-sm font-semibold">Task Drafts</h4>
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

function BusinessResult({ output, runId, runTitle, people }: { output: JsonRecord; runId: string; runTitle: string; people: TeamPersonOption[] }) {
  const visibleOutput = displayOutput(output);
  const sections = businessSections(visibleOutput);
  const tasks = getTaskDrafts(visibleOutput);
  const forms = getFormDrafts(visibleOutput);
  const checklists = getChecklistDrafts(visibleOutput);
  const sops = getSopDrafts(visibleOutput);
  const reports = getReportDrafts(visibleOutput);
  const recommendations = getActionableRecommendations(visibleOutput);
  const detail = cleanReadableText(visibleOutput.response_markdown);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-vaeroex-soft p-4">
        <p className="text-sm font-semibold text-vaeroex-navy">Executive Summary</p>
        <p className="mt-2 text-sm leading-6 text-vaeroex-navy">{sections.executiveSummary}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ResultList title="Problems Identified" items={sections.problems} />
        <ResultList title="Recommended Actions" items={sections.actions} />
        <ResultList title="Suggested Systems" items={sections.systems} />
      </div>

      <RecommendationActionCards recommendations={recommendations} runId={runId} runTitle={runTitle} people={people} />

      <TaskDraftSection tasks={tasks} />
      <ChecklistDraftSection checklists={checklists} />
      <FormDraftSection forms={forms} />
      <SopDraftSection sops={sops} />
      <ReportDraftSection reports={reports} />

      {detail && detail !== sections.executiveSummary ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <h4 className="text-sm font-semibold">Additional Notes</h4>
          <div className="mt-3">
            <ReadableText value={detail} />
          </div>
        </div>
      ) : null}
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

function SelectedResult({
  run,
  output,
  canViewDebug,
  debugMode,
  people
}: {
  run: { id: string; agent_type: string; status: string; created_at: string; error_message: string | null; output_json: Json };
  output: JsonRecord;
  canViewDebug: boolean;
  debugMode: boolean;
  people: TeamPersonOption[];
}) {
  const display = displayOutput(output);
  const title = resultTitle(display, vaeroexResultLabel(run.agent_type));

  return (
    <SectionCard title="Vaeroex answer" description="Review the draft. Nothing is saved into operations modules until you confirm.">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted">
              {vaeroexResultLabel(run.agent_type)} - {new Date(run.created_at).toLocaleString()}
            </p>
          </div>
          <StatusBadge value={run.status} />
        </div>

        {run.error_message ? <ErrorNotice message={run.error_message} /> : null}
        {run.status === "completed" ? <BusinessResult output={output} runId={run.id} runTitle={title} people={people} /> : null}

        {run.status === "completed" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Manager confirmation required</p>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Review this Vaeroex draft before saving it into operations records.
            </p>
            <div className="mt-4">
              <SaveButtons runId={run.id} workflowKey={run.agent_type} output={displayOutput(output)} />
            </div>
          </div>
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
          <Link href={{ pathname: "/app/agents", query: { run: run.id, debug: "1" } }} className="inline-flex text-xs font-semibold text-muted underline">
            Open admin debug output
          </Link>
        ) : null}
        <AdminDebugOutput enabled={canViewDebug && debugMode} output={run.output_json} />
      </div>
    </SectionCard>
  );
}

function WorkflowCard({ workflowKey }: { workflowKey: string }) {
  const workflow = getVaeroexWorkflow(workflowKey);

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div>
        <h3 className="font-semibold">{workflow.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{workflow.description}</p>
      </div>
      <form action={runVaeroexAction} className="mt-4 space-y-3">
        <input type="hidden" name="workflow_key" value={workflow.key} />
        <TextArea label="Context for Vaeroex" name="user_prompt" placeholder={workflow.promptPlaceholder} rows={4} />
        {workflow.key === "weekly_report" || workflow.key === "daily_summary" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Start date" name="date_range_start" type="date" />
            <TextInput label="End date" name="date_range_end" type="date" />
          </div>
        ) : null}
        <PrimaryButton>{workflow.actionLabel}</PrimaryButton>
      </form>
    </article>
  );
}

export default async function VaeroexHubPage({ searchParams }: VaeroexHubPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [{ data: runs, error }, folderResult, peopleResult] = await Promise.all([
    supabase
      .from("ai_agent_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(30),
    getRecordFolders(supabase, workspaceId, "ai_agent_runs"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name")
  ]);
  const people = (peopleResult.data || []) as TeamPersonOption[];
  const selectedRun = runs?.find((run) => run.id === params?.run) ?? runs?.[0] ?? null;
  const selectedOutput = selectedRun ? asRecord(selectedRun.output_json) : {};
  const workflows = VAEROEX_WORKFLOWS.filter((workflow) => workflow.key !== "ask_vaeroex");
  const canViewDebug = isVaeroexAdminUser(user);
  const debugMode = params?.debug === "1";
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
        run.status === "completed" ? (
          <BusinessResult output={display} runId={run.id} runTitle={resultTitle(display, vaeroexResultLabel(run.agent_type))} people={people} />
        ) : (
          <ErrorNotice message={run.error_message || "This run has not completed yet."} />
        )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ask Vaeroex"
        title="Vaeroex Hub"
        description="Ask questions, generate operational drafts, review saved Vaeroex results, and confirm before anything is added to tasks, SOPs, forms, checklists, or reports."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message || peopleResult.error?.message} />
      <SuccessNotice message={params?.saved as string | undefined} />
      <ComplianceNotice />

      <section className="space-y-6">
        <SectionCard title="Ask Vaeroex" description="Use chat for a general operations question. The run is saved for review.">
          <form action={runVaeroexAction} className="space-y-4">
            <input type="hidden" name="workflow_key" value="ask_vaeroex" />
            <TextArea
              label="Question"
              name="user_prompt"
              required
              rows={5}
              placeholder="Ask about missed follow-ups, ownership gaps, handoffs, SOPs, forms, checklists, reporting, or next actions."
            />
            <PrimaryButton>Ask Vaeroex</PrimaryButton>
          </form>
        </SectionCard>

        {selectedRun ? (
          <SelectedResult run={selectedRun} output={selectedOutput} canViewDebug={canViewDebug} debugMode={debugMode} people={people} />
        ) : (
          <SectionCard title="Vaeroex answer" description="Your next Vaeroex response will appear here.">
            <EmptyState title="No Vaeroex answer yet" description="Ask Vaeroex a question above or run one of the tools below." />
          </SectionCard>
        )}

        <SectionCard
          title="Vaeroex workflows"
          description="Each workflow uses the active workspace context and saves the output as a draft result first."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {workflows.map((workflow) => (
              <WorkflowCard key={workflow.key} workflowKey={workflow.key} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Run history" description="Recent Vaeroex results for this workspace.">
          <ManagedRecordList
            collection="ai_agent_runs"
            records={managedRuns}
            folders={folderResult.folders}
            title="Vaeroex result records"
            description="Organize previous Vaeroex outputs without showing raw structured data to normal users."
            emptyTitle="No Vaeroex results yet"
            emptyDescription="Ask Vaeroex or run a workflow to create the first saved result."
            returnPath="/app/agents"
            searchParams={params}
          />
        </SectionCard>
      </section>
    </div>
  );
}
