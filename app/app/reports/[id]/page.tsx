import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { currentSavedAnalysisReleaseChannel } from "@/app/app/reports/saved-analysis-actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { ReportExportActions } from "@/components/reports/ReportExportActions";
import { SavedAnalysisRenderer } from "@/components/reports/SavedAnalysisRenderer";
import { parseSavedAnalysisEnvelope } from "@/lib/reports/saved-analysis";
import {
  normalizedReportType,
  parseReportSections,
  reportDisplayTitle,
  reportEvidenceReadiness,
  reportPeriodLabel,
  reportSourceCount,
  reportTypeLabel,
  type ReportRow
} from "@/lib/reports/presentation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type ReportDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; message?: string }>;
};

function cleanLine(value: string) {
  return value.replace(/^[-*]\s*/, "").replace(/\*\*/g, "").trim();
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function ReportDetailPage({ params, searchParams }: ReportDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) notFound();

  const report = data as ReportRow;
  const savedAnalysis = parseSavedAnalysisEnvelope(report.source_data_json);

  if (savedAnalysis) {
    const channel = await currentSavedAnalysisReleaseChannel();
    if (savedAnalysis.workspace_id !== workspaceId || savedAnalysis.release_channel !== channel) notFound();
    return (
      <div className="space-y-6 text-slate-100">
        <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Reports
        </Link>
        <ErrorNotice message={query?.error} />
        {query?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{query.message}</div> : null}
        <SavedAnalysisRenderer envelope={savedAnalysis} />
      </div>
    );
  }

  const title = reportDisplayTitle(report);
  const type = normalizedReportType(report);
  const readiness = reportEvidenceReadiness(report);
  const sourceCount = reportSourceCount(report);
  const sections = parseReportSections(report.body_markdown);
  const sourceData = asRecord(report.source_data_json);
  const sourceFindingId = typeof sourceData.source_finding_id === "string" ? sourceData.source_finding_id : "";
  const sourceHref = sourceFindingId ? `/app/intelligence?finding=${encodeURIComponent(sourceFindingId)}` : "";
  const sourceTitle = typeof sourceData.source_title === "string" ? sourceData.source_title : "Intelligence finding";

  return (
    <div className="space-y-6 text-slate-100 print:bg-white print:text-black">
      <div className="print:hidden">
        <ErrorNotice message={query?.error} />
        {query?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{query.message}</div> : null}
      </div>

      <header className="border-b border-white/10 pb-5">
        <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white print:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to reports
        </Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">{reportTypeLabel(type)} · Legacy generated report</p>
              <span className="rounded-full border border-slate-400/25 bg-slate-500/10 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-200">Read-only</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold leading-tight text-white sm:text-3xl print:text-black">{title}</h1>
            <p className="mt-2 text-sm text-slate-400 print:text-slate-600">{reportPeriodLabel(report)} · Generated {new Date(report.created_at).toLocaleString()}</p>
            {sourceHref ? <p className="mt-2 text-sm text-slate-400 print:hidden">Generated from Intelligence finding: <Link href={sourceHref as Route} className="font-semibold text-cyan-100 hover:text-white">{sourceTitle}</Link></p> : null}
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <ReportExportActions title={title} reportType={reportTypeLabel(type)} dateRange={reportPeriodLabel(report)} body={report.body_markdown || ""} />
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 print:border-slate-300 print:bg-white">
          <p className="text-xs font-semibold text-slate-400">Evidence readiness</p>
          <p className="mt-2 text-lg font-semibold text-white print:text-black">{readiness}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 print:border-slate-300 print:bg-white">
          <p className="text-xs font-semibold text-slate-400">Source references</p>
          <p className="mt-2 text-lg font-semibold text-white print:text-black">{sourceCount || "Not recorded"}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 print:border-slate-300 print:bg-white">
          <p className="text-xs font-semibold text-slate-400">Lifecycle</p>
          <p className="mt-2 text-lg font-semibold text-white print:text-black">{report.archived_at ? "Archived" : "Active"}</p>
        </div>
      </section>

      <section className="space-y-3" aria-label="Report content">
        {sections.map((section, sectionIndex) => (
          <article key={`${section.title}-${sectionIndex}`} className={`rounded-lg border p-5 ${sectionIndex === 0 ? "border-cyan-300/25 bg-cyan-950/15" : "border-white/10 bg-[#08111f]"} print:border-slate-300 print:bg-white`}>
            <h2 className="text-base font-semibold text-white print:text-black">{section.title}</h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300 print:text-slate-700">
              {section.lines.map((line, index) =>
                /^[-*]\s/.test(line) ? (
                  <div key={`${line}-${index}`} className="flex gap-2">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 print:bg-slate-500" aria-hidden="true" />
                    <p>{cleanLine(line)}</p>
                  </div>
                ) : <p key={`${line}-${index}`}>{cleanLine(line)}</p>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-lg border border-amber-300/20 bg-amber-950/15 p-4 print:border-slate-300 print:bg-white">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-200 print:text-slate-700" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-white print:text-black">Evidence limitation</h2>
            <p className="mt-1 text-sm leading-6 text-slate-300 print:text-slate-700">
              {readiness === "Good"
                ? "This report retains source references, but leadership should still confirm that the underlying evidence remains current before acting."
                : "Source coverage for this report is limited or unavailable in its saved metadata. Treat conclusions as directional and review the original evidence before acting."}
            </p>
            <Link href="/app/sources" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:text-white print:hidden">Review original evidence</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
