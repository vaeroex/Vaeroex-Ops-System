import Link from "next/link";
import type { Route } from "next";
import { Archive, FileText, Plus } from "lucide-react";
import { generateReportAction } from "@/app/app/reports/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { ReportLifecycleMenu } from "@/components/reports/ReportLifecycleMenu";
import { filterOriginalBusinessEvidence, independentOriginalEvidenceKeys } from "@/lib/intelligence/evidence-eligibility";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import {
  REPORT_FILTERS,
  isPrimaryReportType,
  normalizedReportType,
  reportDisplayTitle,
  reportEvidenceReadiness,
  reportPeriodLabel,
  reportSummary,
  reportTypeLabel,
  type NormalizedReportType,
  type ReportRow
} from "@/lib/reports/presentation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    type?: string;
    view?: string;
    q?: string;
  }>;
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function reportTypeTone(type: NormalizedReportType) {
  if (type === "board_report") return "border-cyan-300/35 bg-cyan-950/30 text-cyan-100";
  if (type === "improvement_plan") return "border-emerald-300/35 bg-emerald-950/25 text-emerald-100";
  if (type === "investigation_summary") return "border-amber-300/35 bg-amber-950/25 text-amber-100";
  return "border-blue-300/35 bg-blue-950/35 text-blue-100";
}

function readinessTone(value: string) {
  if (value === "Good") return "text-emerald-200";
  if (value === "Limited") return "text-amber-200";
  return "text-slate-400";
}

function filterHref(type: string, archived: boolean) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (archived) params.set("view", "archived");
  const query = params.toString();
  return (query ? `/app/reports?${query}` : "/app/reports") as Route;
}

function ReportCard({ report, archived }: { report: ReportRow; archived: boolean }) {
  const type = normalizedReportType(report) as NormalizedReportType;
  const title = reportDisplayTitle(report);
  const readiness = reportEvidenceReadiness(report);

  return (
    <article className={`relative rounded-lg border p-4 shadow-panel ${archived ? "border-white/8 bg-[#08111f]/65" : "border-white/10 bg-[#08111f]"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${reportTypeTone(type)}`}>{reportTypeLabel(type)}</span>
            {archived ? <span className="rounded-full border border-slate-500/30 bg-slate-950/45 px-2.5 py-1 text-[0.68rem] font-semibold text-slate-300">Archived</span> : null}
          </div>
          <h2 className="mt-3 text-lg font-semibold leading-6 text-white">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{reportPeriodLabel(report)} · Generated {new Date(report.created_at).toLocaleString()}</p>
        </div>
        <ReportLifecycleMenu reportId={report.id} reportTitle={title} archived={archived} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className={`text-xs font-semibold ${readinessTone(readiness)}`}>Evidence readiness: {readiness}</p>
        <Link href={`/app/reports/${report.id}` as Route} className="inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
          View report
        </Link>
      </div>
    </article>
  );
}

function ReportGenerator({ canGenerate, canGenerateBoard, reason }: { canGenerate: boolean; canGenerateBoard: boolean; reason: string }) {
  const buttonClass = "min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <details className="group rounded-lg border border-cyan-300/20 bg-cyan-950/15">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
        <span className="flex items-center gap-2"><Plus className="h-4 w-4 text-cyan-200" aria-hidden="true" />Generate report</span>
        <span className="text-xs text-cyan-200 group-open:hidden">Open</span>
        <span className="hidden text-xs text-cyan-200 group-open:inline">Close</span>
      </summary>
      <div className="grid gap-4 border-t border-white/10 p-4 lg:grid-cols-2">
        <form action={generateReportAction} className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <input type="hidden" name="return_path" value="/app/reports" />
          <input type="hidden" name="report_type" value="Executive Brief" />
          <input type="hidden" name="category" value="All" />
          <input type="hidden" name="anchor_date" value={todayDate()} />
          <h3 className="text-base font-semibold text-white">Executive Brief</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">A concise leadership summary of the current state, meaningful changes, risks, opportunities, and recommended decisions.</p>
          <label className="mt-4 grid gap-1 text-sm font-semibold text-slate-200">
            Period
            <select name="report_period" defaultValue="Last 7 days" className="min-h-11 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-white">
              <option>Today</option>
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </label>
          <div className="mt-4">
            <PendingSubmitButton disabled={!canGenerate} pendingLabel="Generating brief..." className={buttonClass}>Generate brief</PendingSubmitButton>
          </div>
        </form>

        <form action={generateReportAction} className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <input type="hidden" name="return_path" value="/app/reports" />
          <input type="hidden" name="report_type" value="Board Report" />
          <input type="hidden" name="category" value="All" />
          <input type="hidden" name="anchor_date" value={todayDate()} />
          <h3 className="text-base font-semibold text-white">Board Report</h3>
          <p className="mt-1 text-sm leading-6 text-slate-400">A formal, higher-level report for owner, advisor, investor, or board review.</p>
          <label className="mt-4 grid gap-1 text-sm font-semibold text-slate-200">
            Period
            <select name="report_period" defaultValue="Monthly" className="min-h-11 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-white">
              <option>Monthly</option>
              <option>Quarterly</option>
            </select>
          </label>
          <div className="mt-4">
            <PendingSubmitButton disabled={!canGenerateBoard} pendingLabel="Generating board report..." className={buttonClass}>Generate board report</PendingSubmitButton>
          </div>
        </form>
        {!canGenerate || !canGenerateBoard ? <p className="text-xs leading-5 text-amber-200 lg:col-span-2">{reason}</p> : null}
      </div>
    </details>
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const archived = params?.view === "archived";
  const requestedType = REPORT_FILTERS.some((item) => item.value === params?.type) ? params?.type || "all" : "all";
  const queryText = (params?.q || "").trim().toLowerCase();

  let reportQuery = supabase
    .from("reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  reportQuery = archived ? reportQuery.not("archived_at", "is", null) : reportQuery.is("archived_at", null);

  const [reportResult, archivedCountResult, filesResult, kpisResult, signalsResult, issuesResult] = await Promise.all([
    reportQuery,
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).not("archived_at", "is", null).is("deleted_at", null),
    supabase.from("file_uploads").select("id,display_name,metadata_json,analysis_summary,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(100),
    supabase.from("kpis").select("id,name,source,notes,source_file_id,import_id,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(300),
    supabase.from("tasks").select("id,title,description,category,related_type,ai_generated,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(100),
    supabase.from("issues").select("id,title,description,root_cause,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(100)
  ]);

  const parentResult = await loadSourceParentEligibilityResult({ supabase, workspaceId, rows: kpisResult.data || [] });
  const evidenceErrors = [filesResult.error, kpisResult.error, signalsResult.error, issuesResult.error, parentResult.error].filter(Boolean);
  const files = filterOriginalBusinessEvidence(filesResult.data || []);
  const parentEligibility = parentResult.eligibility;
  const kpis = filterBySourceParentEligibility(filterOriginalBusinessEvidence(kpisResult.data || []), parentEligibility);
  const signals = filterOriginalBusinessEvidence(signalsResult.data || []);
  const issues = filterOriginalBusinessEvidence(issuesResult.data || []);
  const originalEvidenceCount = independentOriginalEvidenceKeys([
    { kind: "file", values: files },
    { kind: "kpi", values: kpis },
    { kind: "business_signal", values: signals },
    { kind: "issue", values: issues }
  ]).size;
  const canManage = ["owner", "admin", "manager"].includes(context.membership?.role || "");
  const canGenerate = canManage && !evidenceErrors.length && originalEvidenceCount >= 1;
  const canGenerateBoard = canManage && !evidenceErrors.length && originalEvidenceCount >= 3;
  const generationReason = !canManage
    ? "Workspace manager access is required to save reports."
    : evidenceErrors.length
      ? "Required evidence could not be loaded, so Vaeroex will not create a report."
      : originalEvidenceCount === 0
        ? "Add eligible original evidence before generating a leadership report."
        : "Board Reports require at least three eligible original evidence sources. Executive Briefs remain available.";

  const reports = ((reportResult.data || []) as ReportRow[])
    .map((report) => ({ report, type: normalizedReportType(report) }))
    .filter((item) => isPrimaryReportType(item.type))
    .filter((item) => requestedType === "all" || item.type === requestedType)
    .filter((item) => !queryText || `${reportDisplayTitle(item.report)} ${reportSummary(item.report.body_markdown)}`.toLowerCase().includes(queryText))
    .map((item) => item.report);

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Leadership outputs</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Reports</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Generate, review, download, and manage leadership-ready outputs created from eligible business evidence.</p>
        </div>
      </header>

      <ErrorNotice message={params?.error || reportResult.error?.message || evidenceErrors[0]?.message} />
      {params?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{params.message}</div> : null}

      <ReportGenerator canGenerate={canGenerate} canGenerateBoard={canGenerateBoard} reason={generationReason} />

      <section className="space-y-4" aria-labelledby="recent-reports-heading">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="recent-reports-heading" className="text-lg font-semibold text-white">{archived ? "Archived reports" : "Recent reports"}</h2>
            <p className="mt-1 text-sm text-slate-400">One library for Executive Briefs, Board Reports, Improvement Plans, and Investigation Summaries.</p>
          </div>
          <form method="get" className="flex min-w-0 gap-2">
            {archived ? <input type="hidden" name="view" value="archived" /> : null}
            {requestedType !== "all" ? <input type="hidden" name="type" value={requestedType} /> : null}
            <input name="q" defaultValue={params?.q || ""} placeholder="Search reports" aria-label="Search reports" className="min-h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/75 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none" />
            <button className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Search</button>
          </form>
        </div>

        <nav aria-label="Report filters" className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1">
          {REPORT_FILTERS.map((item) => (
            <Link key={item.value} href={filterHref(item.value, archived)} className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${requestedType === item.value ? "border-cyan-300/40 bg-cyan-950/35 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-cyan-950/25"}`}>
              {item.label}
            </Link>
          ))}
          {archived || (archivedCountResult.count || 0) > 0 ? <Link href={archived ? "/app/reports" : "/app/reports?view=archived"} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${archived ? "border-slate-400/35 bg-slate-900 text-white" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-slate-900"}`}>
            <Archive className="h-4 w-4" aria-hidden="true" />{archived ? "Active" : "Archived"}
          </Link> : null}
        </nav>

        {reports.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {reports.map((report) => <ReportCard key={report.id} report={report} archived={archived} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-[#08111f] p-6 text-center">
            <FileText className="mx-auto h-7 w-7 text-slate-500" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-white">{archived ? "No archived reports" : "No reports match this view"}</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{archived ? "Archived reports remain here until restored or soft-deleted." : "Generate an Executive Brief after adding eligible original evidence, or adjust the current filter."}</p>
          </div>
        )}
      </section>

    </div>
  );
}
