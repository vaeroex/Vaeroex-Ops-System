import type { Route } from "next";
import type { ReactNode } from "react";
import { runReportSubscriptionNowAction, saveReportSubscriptionPreferenceAction } from "@/app/app/report-subscriptions/actions";
import { generateReportAction } from "@/app/app/reports/actions";
import { AssignmentPanel, ShareRecordPanel, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { ReportExportActions } from "@/components/reports/ReportExportActions";
import { createBusinessReviewPackageAction } from "@/app/app/intelligence/actions";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { buildPrestigeIntelligence } from "@/lib/intelligence/prestige";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import {
  REPORT_QUARTER_MONTH_OPTIONS,
  REPORT_SCHEDULE_DAY_KINDS,
  REPORT_SUBSCRIPTION_CATEGORIES,
  REPORT_SUBSCRIPTION_STATUSES,
  REPORT_WEEKDAY_OPTIONS,
  categoryLabel,
  defaultMonthInQuarter,
  defaultWeekdayForCategory,
  getNextScheduledRun,
  getScheduleDescription,
  isScheduledReportCategory,
  normalizeScheduleTime,
  reportScheduleDayKind
} from "@/lib/reports/subscriptions";
import type { Database, Json } from "@/lib/supabase/types";
import { OPERATIONAL_ROLES } from "@/lib/team/options";
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
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type ReportSubscriptionPreferenceRow = Database["public"]["Tables"]["report_subscription_preferences"]["Row"];
type ScheduledReportRunRow = Database["public"]["Tables"]["scheduled_report_runs"]["Row"];
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

function shareRecipient(share: ShareRow, peopleById: Map<string, string>) {
  if (share.share_scope === "person") return peopleById.get(share.person_id || "") || "Person";
  if (share.share_scope === "role") return share.role || "Role";
  if (share.share_scope === "department") return share.department || "Department";
  return "Entire workspace";
}

function scheduleLabel(value: string) {
  return value.replace(/_/g, " ");
}

function ShareHistory({ shares, peopleById }: { shares: ShareRow[]; peopleById: Map<string, string> }) {
  if (!shares.length) {
    return <p className="rounded-lg border border-dashed border-line bg-slate-50 p-3 text-sm text-muted">This report has not been shared yet.</p>;
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold text-ink">Distribution history</h4>
      <div className="mt-3 space-y-2">
        {shares.map((share) => (
          <div key={share.id} className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-[1fr_auto_auto]">
            <span className="font-medium">{shareRecipient(share, peopleById)}</span>
            <span className="text-muted capitalize">{scheduleLabel(share.distribution_schedule)}</span>
            <span className="text-muted">{share.last_shared_at ? new Date(share.last_shared_at).toLocaleDateString() : "Not sent"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function preferenceStatusLabel(preference?: ReportSubscriptionPreferenceRow) {
  if (!preference) return "disabled";
  if (preference.email_status === "paused" && preference.pause_until) return `paused until ${preference.pause_until}`;
  return preference.email_status;
}

function findWorkspacePreference(preferences: ReportSubscriptionPreferenceRow[], category: string) {
  return preferences.find((preference) => preference.category === category && preference.preference_scope === "workspace");
}

function recipientLabel(preference: ReportSubscriptionPreferenceRow, peopleById: Map<string, string>) {
  if (preference.preference_scope === "person") return peopleById.get(preference.person_id || "") || "Person";
  if (preference.preference_scope === "role") return preference.role || "Role";
  return "Workspace default";
}

function schedulePreference(category: string, preference?: ReportSubscriptionPreferenceRow | null) {
  return {
    category,
    schedule_day_of_week: preference?.schedule_day_of_week ?? defaultWeekdayForCategory(category),
    schedule_day_kind: reportScheduleDayKind(preference?.schedule_day_kind || "custom_day"),
    schedule_day_of_month: preference?.schedule_day_of_month ?? 1,
    schedule_month_in_quarter: preference?.schedule_month_in_quarter ?? defaultMonthInQuarter(category),
    schedule_time: normalizeScheduleTime(preference?.schedule_time)
  };
}

function nextRunLabel(preference: ReturnType<typeof schedulePreference>) {
  const nextRun = getNextScheduledRun(preference);

  if (!nextRun) {
    return "Triggered by activity";
  }

  return `${nextRun.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function dayKindLabel(value: string) {
  if (value === "first_business_day") return "First business day";
  if (value === "last_business_day") return "Last business day";
  return "Custom day";
}

function DayOfMonthSelect({ defaultValue }: { defaultValue?: number | null }) {
  return (
    <label className="block text-sm font-medium">
      Day of month
      <select
        name="schedule_day_of_month"
        defaultValue={defaultValue ?? 1}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
      >
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScheduleFields({
  category,
  preference,
  generic = false
}: {
  category?: string;
  preference?: ReportSubscriptionPreferenceRow | null;
  generic?: boolean;
}) {
  const activeCategory = category || "weekly_review";
  const schedule = schedulePreference(activeCategory, preference);
  const scheduled = generic || isScheduledReportCategory(activeCategory);

  if (!scheduled) {
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
        This category is triggered by workspace activity, so it does not need calendar scheduling.
      </p>
    );
  }

  const showWeekly = generic || activeCategory === "weekly_review" || activeCategory === "weekly_planning";
  const showMonthly = generic || activeCategory === "monthly_executive_summary" || activeCategory === "quarterly_business_review";
  const showQuarterly = generic || activeCategory === "quarterly_business_review";

  return (
    <div className="grid gap-3 rounded-lg border border-line bg-slate-50 p-3 md:grid-cols-2">
      {showWeekly ? (
        <label className="block text-sm font-medium">
          Day of week
          <select
            name="schedule_day_of_week"
            defaultValue={schedule.schedule_day_of_week ?? defaultWeekdayForCategory(activeCategory)}
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          >
            {REPORT_WEEKDAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showQuarterly ? (
        <label className="block text-sm font-medium">
          Month in quarter
          <select
            name="schedule_month_in_quarter"
            defaultValue={schedule.schedule_month_in_quarter ?? 1}
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          >
            {REPORT_QUARTER_MONTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showMonthly ? (
        <>
          <label className="block text-sm font-medium">
            Day option
            <select
              name="schedule_day_kind"
              defaultValue={schedule.schedule_day_kind}
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
            >
              {REPORT_SCHEDULE_DAY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {dayKindLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <DayOfMonthSelect defaultValue={schedule.schedule_day_of_month} />
        </>
      ) : null}

      <TextInput label="Time of day (UTC)" name="schedule_time" type="time" defaultValue={schedule.schedule_time} />
      <p className="text-xs leading-5 text-muted md:col-span-2">
        If the selected day does not exist, such as the 31st in February, Vaeroex sends on the last day of that month.
      </p>
    </div>
  );
}

function ScheduleSummary({ category, preference }: { category: string; preference?: ReportSubscriptionPreferenceRow | null }) {
  const schedule = schedulePreference(category, preference);

  return (
    <div className="mt-2 grid gap-1 text-xs text-muted">
      <span>Schedule: {getScheduleDescription(schedule)}</span>
      <span>Next run: {nextRunLabel(schedule)}</span>
    </div>
  );
}

function SubscriptionCategorySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block text-sm font-medium">
      Category
      <select
        name="category"
        required
        defaultValue={defaultValue || ""}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
      >
        <option value="">Choose...</option>
        {REPORT_SUBSCRIPTION_CATEGORIES.map((category) => (
          <option key={category.key} value={category.key}>
            {category.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubscriptionStatusSelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block text-sm font-medium">
      Status
      <select
        name="email_status"
        defaultValue={defaultValue || "disabled"}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 capitalize outline-none focus:border-vaeroex-blue"
      >
        {REPORT_SUBSCRIPTION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReportSubscriptionPreferences({
  preferences,
  people,
  scheduledRuns,
  canRunNow
}: {
  preferences: ReportSubscriptionPreferenceRow[];
  people: TeamPersonOption[];
  scheduledRuns: ScheduledReportRunRow[];
  canRunNow: boolean;
}) {
  const peopleById = new Map(people.map((person) => [person.id, person.full_name]));
  const roleOptions = Array.from(
    new Set([...OPERATIONAL_ROLES, ...people.map((person) => person.role_title).filter((role): role is string => Boolean(role))])
  ).sort();
  const nonWorkspacePreferences = preferences.filter((preference) => preference.preference_scope !== "workspace");

  return (
    <SectionCard
      title="Report subscription preferences"
      description="Control scheduled report and alert categories by workspace, role, or person. Email delivery is optional and never forced; Vaeroex always keeps in-app history available."
    >
      <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Workspace defaults</h3>
          {REPORT_SUBSCRIPTION_CATEGORIES.map((category) => {
            const preference = findWorkspacePreference(preferences, category.key);

            return (
              <div key={category.key} className="rounded-lg border border-line bg-white p-3">
                <form action={saveReportSubscriptionPreferenceAction} className="grid gap-3">
                  <input type="hidden" name="return_path" value="/app/reports" />
                  <input type="hidden" name="category" value={category.key} />
                  <input type="hidden" name="preference_scope" value="workspace" />
                  <div className="grid gap-3 md:grid-cols-[1.4fr_.7fr_.7fr_auto] md:items-end">
                    <div>
                      <p className="text-sm font-semibold text-ink">{category.label}</p>
                      <p className="mt-1 text-xs text-muted">Current: {preferenceStatusLabel(preference)}</p>
                      <ScheduleSummary category={category.key} preference={preference} />
                    </div>
                    <SubscriptionStatusSelect defaultValue={preference?.email_status || "disabled"} />
                    <TextInput label="Pause until" name="pause_until" type="date" defaultValue={preference?.pause_until || ""} />
                    <PrimaryButton>Save</PrimaryButton>
                  </div>
                  <ScheduleFields category={category.key} preference={preference} />
                </form>
                {canRunNow && isScheduledReportCategory(category.key) ? (
                  <form action={runReportSubscriptionNowAction} className="mt-3 flex justify-end">
                    <input type="hidden" name="return_path" value="/app/reports" />
                    <input type="hidden" name="category" value={category.key} />
                    <ConfirmSubmitButton
                      message={`Generate ${category.label} now for this workspace?`}
                      className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
                    >
                      Run Now
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-ink">Role default</h3>
            <form action={saveReportSubscriptionPreferenceAction} className="mt-3 grid gap-3">
              <input type="hidden" name="return_path" value="/app/reports" />
              <input type="hidden" name="preference_scope" value="role" />
              <SubscriptionCategorySelect />
              <SelectInput label="Role" name="role" options={roleOptions} required />
              <SubscriptionStatusSelect />
              <TextInput label="Pause until" name="pause_until" type="date" />
              <ScheduleFields generic />
              <PrimaryButton>Save role preference</PrimaryButton>
            </form>
          </div>

          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-ink">Person preference</h3>
            <form action={saveReportSubscriptionPreferenceAction} className="mt-3 grid gap-3">
              <input type="hidden" name="return_path" value="/app/reports" />
              <input type="hidden" name="preference_scope" value="person" />
              <SubscriptionCategorySelect />
              <label className="block text-sm font-medium">
                Person
                <select name="person_id" required className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue">
                  <option value="">Choose...</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <SubscriptionStatusSelect />
              <TextInput label="Pause until" name="pause_until" type="date" />
              <ScheduleFields generic />
              <PrimaryButton>Save person preference</PrimaryButton>
            </form>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Role and person overrides</h3>
          {nonWorkspacePreferences.length ? (
            <div className="mt-3 space-y-2">
              {nonWorkspacePreferences.slice(0, 12).map((preference) => (
                <div key={preference.id} className="grid gap-2 rounded-lg border border-line p-3 text-sm md:grid-cols-[1fr_auto_auto]">
                  <span>
                    <span className="font-semibold text-ink">{categoryLabel(preference.category)}</span>
                    <span className="mt-1 block text-xs text-muted">Next run: {nextRunLabel(schedulePreference(preference.category, preference))}</span>
                  </span>
                  <span className="text-muted">{recipientLabel(preference, peopleById)}</span>
                  <StatusBadge value={preferenceStatusLabel(preference)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-line bg-slate-50 p-3 text-sm text-muted">No role or person overrides yet.</p>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink">Scheduled report runs</h3>
          {scheduledRuns.length ? (
            <div className="mt-3 space-y-2">
              {scheduledRuns.slice(0, 8).map((run) => (
                <div key={run.id} className="grid gap-2 rounded-lg border border-line p-3 text-sm md:grid-cols-[1fr_auto_auto]">
                  <span className="font-semibold text-ink">{categoryLabel(run.category)}</span>
                  <span className="text-muted">{run.run_date}</span>
                  <StatusBadge value={run.status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-line bg-slate-50 p-3 text-sm text-muted">Scheduled report runs will appear after the production cron executes.</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const canViewDebug = isVaeroexAdminUser(user);
  const canRunScheduledReports = canViewDebug || ["owner", "admin"].includes(context.membership?.role || "");
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
    folderResult,
    peopleResult,
    shareResult,
    preferenceResult,
    scheduledRunResult,
    kpiResult,
    taskResult,
    issueResult,
    checklistRunResult,
    sopResult,
    fileResult,
    importResult,
    crmResult,
    vaeroexRunResult,
    notificationResult,
    assignmentResult,
    decisionResult,
    recommendationOutcomeResult
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
    getRecordFolders(supabase, workspaceId, "reports"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("record_shares").select("*").eq("workspace_id", workspaceId).eq("source_type", "report").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase
      .from("report_subscription_preferences")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("category")
      .order("preference_scope"),
    supabase
      .from("scheduled_report_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("run_date", { ascending: false })
      .limit(20),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(300),
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(100),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50),
    supabase.from("notifications").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
    supabase
      .from("vaeroex_recommendation_outcomes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40)
  ]);
  const people = (peopleResult.data || []) as TeamPersonOption[];
  const peopleById = new Map(people.map((person) => [person.id, person.full_name]));
  const shares = (shareResult.data || []) as ShareRow[];
  const preferences = (preferenceResult.data || []) as ReportSubscriptionPreferenceRow[];
  const scheduledRuns = (scheduledRunResult.data || []) as ScheduledReportRunRow[];
  const reportIntelligence = buildPrestigeIntelligence({
    workspaceName: context.activeWorkspace?.name || "Vaeroex workspace",
    isDemoWorkspace: false,
    periodLabel: "Reports",
    range: {
      startDate: filterStart || todayDate(),
      endDate: filterEnd || todayDate(),
      previousStartDate: filterStart || todayDate(),
      previousEndDate: filterEnd || todayDate()
    },
    kpis: kpiResult.data || [],
    tasks: taskResult.data || [],
    issues: issueResult.data || [],
    assets: [],
    checklists: [],
    checklistRuns: checklistRunResult.data || [],
    sops: sopResult.data || [],
    files: fileResult.data || [],
    imports: importResult.data || [],
    crmLeads: crmResult.data || [],
    reports: (rawReports || []) as ReportRow[],
    vaeroexRuns: vaeroexRunResult.data || [],
    operationalMetrics: [],
    notifications: notificationResult.data || [],
    assignments: assignmentResult.data || [],
    shares,
    people: [],
    decisions: decisionResult.data || [],
    recommendationOutcomes: recommendationOutcomeResult.data || []
  });

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
    const reportShares = shares.filter((share) => share.source_id === report.id);

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
        { label: "Overdue tasks", value: numberFromSource(report.source_data_json, "overdue_tasks") },
        { label: "Shared with", value: reportShares.length ? `${reportShares.length} recipient record${reportShares.length === 1 ? "" : "s"}` : "Not shared" }
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
          <ReportExportActions
            title={report.title}
            reportType={report.report_type}
            dateRange={reportDateLabel(report)}
            body={report.body_markdown || ""}
          />
          <ReportBody body={report.body_markdown} />
          <ShareRecordPanel
            sourceType="report"
            sourceId={report.id}
            sourceTitle={report.title}
            relatedModule="Reports"
            returnPath="/app/reports"
            actionHref="/app/reports"
            people={people}
          />
          <AssignmentPanel
            sourceType="report"
            sourceId={report.id}
            sourceTitle={report.title}
            relatedModule="Reports"
            defaultTitle={`Follow up: ${report.title}`}
            defaultRole="Manager"
            returnPath="/app/reports"
            actionHref="/app/reports"
            people={people}
          />
          <ShareHistory shares={reportShares} peopleById={peopleById} />
          <AdminDebugData enabled={canViewDebug && debugMode} value={report.source_data_json} />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        description="Generate daily, weekly, monthly, quarterly, yearly, and year-to-date summaries for the active workspace. Reports use the selected period, compare against the prior period where possible, and keep source data hidden unless admin debug mode is enabled."
      />
      <ModuleTabs
        tabs={[
          { label: "All Reports", href: "/app/reports", active: !params?.report_type },
          { label: "Daily", href: "/app/reports?report_type=Daily" as Route, active: params?.report_type === "Daily" },
          { label: "Weekly", href: "/app/reports?report_type=Weekly" as Route, active: params?.report_type === "Weekly" },
          { label: "Monthly", href: "/app/reports?report_type=Monthly" as Route, active: params?.report_type === "Monthly" },
          { label: "Quarterly", href: "/app/reports?report_type=Quarterly" as Route, active: params?.report_type === "Quarterly" },
          { label: "Yearly", href: "/app/reports?report_type=Yearly" as Route, active: params?.report_type === "Yearly" },
          { label: "YTD", href: "/app/reports?report_type=Year%20to%20Date" as Route, active: params?.report_type === "Year to Date" },
          { label: "File Reports", href: "/app/reports?report_type=File%20Review" as Route, active: params?.report_type === "File Review" },
          { label: "Vaeroex Reports", href: "/app/reports?category=Vaeroex%20insights" as Route, active: params?.category === "Vaeroex insights" }
        ]}
      />

      <ErrorNotice
        message={
          params?.error ||
          error?.message ||
          folderResult.error?.message ||
          peopleResult.error?.message ||
          shareResult.error?.message ||
          preferenceResult.error?.message ||
          scheduledRunResult.error?.message ||
          kpiResult.error?.message ||
          taskResult.error?.message ||
          issueResult.error?.message ||
          checklistRunResult.error?.message ||
          sopResult.error?.message ||
          fileResult.error?.message ||
          importResult.error?.message ||
          crmResult.error?.message ||
          vaeroexRunResult.error?.message ||
          notificationResult.error?.message ||
          assignmentResult.error?.message ||
          decisionResult.error?.message ||
          recommendationOutcomeResult.error?.message
        }
      />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open tasks" value={openTaskCount.count ?? 0} note="Current active follow-up work." />
        <MetricCard label="Overdue tasks" value={overdueTaskCount.count ?? 0} note="Tasks due before today." />
        <MetricCard label="Open issues" value={openIssueCount.count ?? 0} note="Unresolved risks and blockers." />
        <MetricCard label="Checklist completions" value={checklistCompletionCount.count ?? 0} note={`${sopCount.count ?? 0} SOPs available for reference.`} />
      </section>

      <ReportSubscriptionPreferences preferences={preferences} people={people} scheduledRuns={scheduledRuns} canRunNow={canRunScheduledReports} />

      <SectionCard title="Business Review Package" description="Prepare a board, owner, bank, investor, franchise, monthly, or quarterly review package from the same workspace data Vaeroex uses for reports.">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <div className="grid gap-3 md:grid-cols-2">
            {reportIntelligence.businessReviewPackage.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-line bg-white p-4">
                <p className="text-sm font-semibold text-ink">{section.title}</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                  {section.lines.slice(0, 3).map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Recommendation outcomes</p>
              <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
                {reportIntelligence.recommendationTracking.outcomeNotes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Decisions and outcomes</p>
              <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
                {reportIntelligence.decisions.outcomeNotes.length ? (
                  reportIntelligence.decisions.outcomeNotes.map((note) => <p key={note}>{note}</p>)
                ) : (
                  <p>No decisions logged yet.</p>
                )}
              </div>
            </div>
            <form action={createBusinessReviewPackageAction}>
              <input type="hidden" name="return_path" value="/app/reports" />
              <input type="hidden" name="title" value={reportIntelligence.businessReviewPackage.title} />
              <input type="hidden" name="body_markdown" value={reportIntelligence.businessReviewPackage.body} />
              <input type="hidden" name="date_range_start" value={filterStart || todayDate()} />
              <input type="hidden" name="date_range_end" value={filterEnd || todayDate()} />
              <ConfirmSubmitButton message="Save this Business Review Package to Reports?">Prepare Business Review Package</ConfirmSubmitButton>
            </form>
          </div>
        </div>
      </SectionCard>

      <section className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <CreateDrawer title="Generate report" description="Choose a reporting period and Vaeroex will summarize the matching workspace activity." triggerLabel="Generate Report">
            <form action={generateReportAction} className="grid gap-4">
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
          </CreateDrawer>

          <CreateDrawer title="Filter saved reports" description="Narrow report history without changing workspace access." triggerLabel="Open Filters">
            <form method="get" className="grid gap-4">
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
          </CreateDrawer>
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
