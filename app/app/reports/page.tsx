import Link from "next/link";
import type { Route } from "next";
import { FileText } from "lucide-react";
import { currentSavedAnalysisReleaseChannel } from "@/app/app/reports/saved-analysis-actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SavedAnalysisList } from "@/components/reports/SavedAnalysisList";
import {
  parseSavedAnalysisEnvelope,
  savedAnalysisListItem
} from "@/lib/reports/saved-analysis";
import {
  normalizedReportType,
  reportDisplayTitle,
  reportPeriodLabel,
  reportTypeLabel,
  type ReportRow
} from "@/lib/reports/presentation";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const channel = await currentSavedAnalysisReleaseChannel();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  const saved = [] as ReturnType<typeof savedAnalysisListItem>[];
  const legacy = [] as ReportRow[];

  for (const row of (data || []) as ReportRow[]) {
    const envelope = parseSavedAnalysisEnvelope(row.source_data_json);
    if (envelope) {
      if (!row.archived_at && envelope.workspace_id === workspaceId && envelope.release_channel === channel) {
        saved.push(savedAnalysisListItem(row.id, envelope));
      }
    } else {
      legacy.push(row);
    }
  }

  return (
    <div className="space-y-8 text-slate-100">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Leadership reference</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Reports</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Save completed analyses you want leadership to revisit. Reports never regenerates or rewrites saved content.</p>
      </header>

      <ErrorNotice message={params?.error || error?.message} />
      {params?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{params.message}</div> : null}

      <SavedAnalysisList analyses={saved} />

      <section className="space-y-4 border-t border-white/10 pt-7" aria-labelledby="legacy-reports-heading">
        <div>
          <h2 id="legacy-reports-heading" className="text-lg font-semibold text-white">Legacy Reports</h2>
          <p className="mt-1 text-sm text-slate-400">These reports were created using the previous report-generation system. They remain unchanged and read-only.</p>
        </div>
        {legacy.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {legacy.map((report) => {
              const type = normalizedReportType(report);
              return (
                <article key={report.id} className="rounded-lg border border-white/8 bg-[#08111f]/65 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-500/30 bg-slate-950/45 px-2.5 py-1 text-[0.68rem] font-semibold text-slate-300">Legacy report</span>
                    <span className="text-xs text-slate-500">{reportTypeLabel(type)}</span>
                    {report.archived_at ? <span className="text-xs text-slate-500">Archived</span> : null}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold leading-6 text-white">{reportDisplayTitle(report)}</h3>
                  <p className="mt-1 text-xs text-slate-500">{reportPeriodLabel(report)} · Created {new Date(report.created_at).toLocaleString()}</p>
                  <Link href={`/app/reports/${report.id}` as Route} className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.05]">View legacy report</Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-[#08111f] p-6 text-center">
            <FileText aria-hidden="true" className="mx-auto h-7 w-7 text-slate-500" />
            <p className="mt-3 text-sm text-slate-400">No legacy reports are stored in this workspace.</p>
          </div>
        )}
      </section>
    </div>
  );
}
