import type { ReactNode } from "react";
import { generateReportAction } from "@/app/app/reports/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Database, Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ReportsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    report_type?: string;
    category?: string;
    start?: string;
    end?: string;
    debug?: string;
    q?: string;
    folder?: string;
    status?: string;
    owner?: string;
    sort?: string;
    view?: string;
  }>;
};
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type JsonRecord = Record<string, unknown>;

const REPORT_PERIODS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const REPORT_TYPES = ["Operations Summary", "Accountability Review", "Bottleneck Review", "Readiness Snapshot", "Executive Summary"];
const BASE_CATEGORIES = [
  "All",
  "Tasks",
  "Checklists",
  "SOPs",
  "Issues",
  "Forms",
  "Assets",
  "KPIs",
  "Files",
  "CRM",
  "Operational metrics",
  "Vaeroex insights"
];
const reportEditFields: ManagedRecordEditField[] = [
  { name: "title", label: "Title", required: true },
  { name: "report_type", label: "Report type" },
  { name: "date_range_start", label: "Date range start", type: "date" },
  { name: "date_range_end", label: "Date range end", type: "date" },
  { name: "body_markdown", label: "Report body", type: "textarea", rows: 12 }
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFromSource(source: Json, key: string) {
  const record = asRecord(source);
  const current = asRecord(record.current);
  const counts = asRecord(current.counts);
  const value = counts[key];

  return typeof value === "number" ? value : 0;
}

function sourceCategory(source: Json) {
  return str(asRecord(source).category, "All");
}

function reportMatchesCategory(report: ReportRow, category: string) {
  if (!category || category === "All") {
    return true;
  }

  return sourceCategory(report.source_data_json).toLowerCase() === category.toLowerCase();
}

function reportDateLabel(report: ReportRow) {
  if (report.date_range_start && report.date_range_end) {
    return `${report.date_range_start} to ${report.date_range_end}`;
  }

  return "Date range not set";
}

function cleanLine(line: string) {
  return line.replace(/^-\s*/, "").trim();
}

function parseReportSections(body: string | null) {
  const lines = (body || "No report body yet.").split("\n");
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("# ")) {
      continue;
    }

    if (trimmed.startsWith("## ")) {
      current = { title: trimmed.replace(/^##\s*/, ""), lines: [] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { title: "Report Details", lines: [] };
      sections.push(current);
    }

    current.lines.push(trimmed);
  }

  return sections.length ? sections : [{ title: "Report Details", lines: ["No report body yet."] }];
}

function ReportBody({ body }: { body: string | null }) {
  const sections = parseReportSections(body);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <section
          key={section.title}
          className={section.title === "Executive Summary" ? "rounded-lg border border-blue-100 bg-blue-50/60 p-4 lg:col-span-2" : "rounded-lg border border-line bg-slate-50 p-4"}
        >
          <h4 className="text-sm font-semibold text-ink">{section.title}</h4>
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {section.lines.map((line, index) =>
              line.startsWith("- ") ? (
                <div key={`${line}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
                  <p>{cleanLine(line)}</p>
                </div>
              ) : (
                <p key={`${line}-${index}`}>{line}</p>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-muted">{note}</p> : null}
    </article>
  );
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
}

function AdminDebugData({ enabled, value }: { enabled: boolean; value: Json }) {
  if (!enabled) {
    return null;
  }

  return (
    <details className="mt-4 rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
      <summary className="cursor-pointer text-sm font-semibold">Admin debug source data</summary>
      <pre className="mt-4 max-h-80 overflow-auto text-xs leading-5">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function selectMarkup({
  label,
  name,
  options,
  defaultValue
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select
        name={name}
        defaultValue={defaultValue || ""}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => str(value)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const canViewDebug = isVaeroexAdminUser(user);
  const debugMode = params?.debug === "1";
  const filterReportType = params?.report_type || "All";
  const filterCategory = params?.category || "All";
  const filterStart = params?.start || "";
  const filterEnd = params?.end || "";

  let reportQuery = supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);

  if (filterReportType !== "All") {
    reportQuery = reportQuery.ilike("report_type", `%${filterReportType}%`);
  }

  if (filterStart) {
    reportQuery = reportQuery.gte("date_range_end", filterStart);
  }

  if (filterEnd) {
    reportQuery = reportQuery.lte("date_range_start", filterEnd);
  }

  const [
    { data: rawReports, error },
    openTaskCount,
    overdueTaskCount,
    openIssueCount,
    checklistCompletionCount,
    sopCount,
    taskCategories,
    issueCategories,
    checklistCategories,
    sopCategories,
    folderResult
  ] = await Promise.all([
    reportQuery,
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Done"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .lt("due_date", todayDate())
      .neq("status", "Done"),
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Closed"),
    supabase.from("checklist_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).not("completed_at", "is", null),
    supabase.from("sops").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("tasks").select("category").eq("workspace_id", workspaceId),
    supabase.from("issues").select("issue_type").eq("workspace_id", workspaceId),
    supabase.from("checklists").select("category").eq("workspace_id", workspaceId),
    supabase.from("sops").select("category").eq("workspace_id", workspaceId),
    getRecordFolders(supabase, workspaceId, "reports")
  ]);

  const dynamicCategories = uniqueOptions([
    ...(taskCategories.data || []).map((row) => row.category),
    ...(issueCategories.data || []).map((row) => row.issue_type),
    ...(checklistCategories.data || []).map((row) => row.category),
    ...(sopCategories.data || []).map((row) => row.category)
  ]);
  const categoryOptions = Array.from(new Set([...BASE_CATEGORIES, ...dynamicCategories]));
  const reports = ((rawReports || []) as ReportRow[]).filter((report) => reportMatchesCategory(report, filterCategory));
  const managedReports = reports.map((report) => {
    const management = managedValues(report);

    return {
      id: report.id,
      title: report.title,
      type: report.report_type,
      status: report.report_type,
      owner: report.created_by ? "Workspace" : "Vaeroex",
      category: sourceCategory(report.source_data_json),
      createdAt: report.created_at,
      updatedAt: management.updatedAt || report.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(report.body_markdown, "No report body yet."),
      meta: [
        { label: "Date range", value: reportDateLabel(report) },
        { label: "Completed tasks", value: numberFromSource(report.source_data_json, "completed_tasks") },
        { label: "Checklist completions", value: numberFromSource(report.source_data_json, "checklist_completions") },
        { label: "Open issues", value: numberFromSource(report.source_data_json, "open_issues") },
        { label: "Overdue tasks", value: numberFromSource(report.source_data_json, "overdue_tasks") }
      ],
      editFields: reportEditFields,
      editValues: {
        title: report.title,
        report_type: report.report_type,
        date_range_start: report.date_range_start,
        date_range_end: report.date_range_end,
        body_markdown: report.body_markdown
      },
      children: (
        <div className="space-y-4">
          <ReportBody body={report.body_markdown} />
          <AdminDebugData enabled={canViewDebug && debugMode} value={report.source_data_json} />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Operations reports"
        description="Generate daily, weekly, monthly, quarterly, yearly, and year-to-date summaries for the active workspace. Reports use the selected period, compare against the prior period where possible, and keep source data hidden unless admin debug mode is enabled."
      />

      <ErrorNotice message={params?.error || error?.message || folderResult.error?.message} />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open tasks" value={openTaskCount.count ?? 0} note="Current active follow-up work." />
        <MetricCard label="Overdue tasks" value={overdueTaskCount.count ?? 0} note="Tasks due before today." />
        <MetricCard label="Open issues" value={openIssueCount.count ?? 0} note="Unresolved risks and blockers." />
        <MetricCard label="Checklist completions" value={checklistCompletionCount.count ?? 0} note={`${sopCount.count ?? 0} SOPs available for reference.`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <SectionCard title="Generate report" description="Choose a reporting period and Vaeroex will summarize the matching workspace activity.">
            <form action={generateReportAction} className="space-y-4">
              <label className="block text-sm font-medium">
                Workspace
                <input
                  readOnly
                  value={context.activeWorkspace?.name || "Active workspace"}
                  className="mt-2 w-full rounded-lg border border-line bg-slate-50 px-3 py-2 text-muted"
                />
              </label>
              <SelectInput label="Report period" name="report_period" defaultValue="Weekly" options={REPORT_PERIODS} required />
              <TextInput label="Date in period" name="anchor_date" type="date" defaultValue={todayDate()} />
              <SelectInput label="Report type" name="report_type" defaultValue="Operations Summary" options={REPORT_TYPES} required />
              <SelectInput label="Category" name="category" defaultValue="All" options={categoryOptions} />
              <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
                Daily uses the selected day. Weekly uses the selected week. Monthly, quarterly, and yearly use the selected date to choose the matching period. Year to Date always runs January 1 through today.
              </p>
              <PrimaryButton>Generate report</PrimaryButton>
            </form>
          </SectionCard>

          <SectionCard title="Filter saved reports" description="Narrow report history without changing workspace access.">
            <form method="get" className="space-y-4">
              <label className="block text-sm font-medium">
                Workspace
                <input
                  readOnly
                  value={context.activeWorkspace?.name || "Active workspace"}
                  className="mt-2 w-full rounded-lg border border-line bg-slate-50 px-3 py-2 text-muted"
                />
              </label>
              {selectMarkup({
                label: "Report type",
                name: "report_type",
                options: ["All", ...REPORT_PERIODS, ...REPORT_TYPES],
                defaultValue: filterReportType
              })}
              {selectMarkup({ label: "Category", name: "category", options: categoryOptions, defaultValue: filterCategory })}
              <TextInput label="Date range start" name="start" type="date" defaultValue={filterStart} />
              <TextInput label="Date range end" name="end" type="date" defaultValue={filterEnd} />
              {debugMode ? <input type="hidden" name="debug" value="1" /> : null}
              <PrimaryButton>Apply filters</PrimaryButton>
            </form>
          </SectionCard>
        </div>

        <SectionCard title="Report history" description="Customer-ready summaries for the active workspace.">
          <ManagedRecordList
            collection="reports"
            records={managedReports}
            folders={folderResult.folders}
            title="Report records"
            description="Saved reports are collapsed by default and can be grouped, archived, duplicated, or edited."
            emptyTitle="No reports match these filters"
            emptyDescription="Generate a period report or adjust the filters to review saved summaries for this workspace."
            searchParams={params}
          />
        </SectionCard>
      </section>
    </div>
  );
}
