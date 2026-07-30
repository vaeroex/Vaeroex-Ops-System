import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SavedAnalysisRenderer } from "@/components/reports/SavedAnalysisRenderer";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import { parseSavedAnalysisEnvelope } from "@/lib/reports/saved-analysis";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type ReportDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function ReportDetailPage({ params, searchParams }: ReportDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const channel = currentSavedAnalysisReleaseChannel();
  const { data, error } = await supabase
    .from("reports")
    .select("id,source_data_json")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .contains("source_data_json", { record_kind: "saved_analysis", release_channel: channel })
    .maybeSingle();

  const savedAnalysis = data ? parseSavedAnalysisEnvelope(data.source_data_json) : null;
  if (
    error ||
    !savedAnalysis ||
    savedAnalysis.workspace_id !== workspaceId ||
    savedAnalysis.release_channel !== channel
  ) {
    redirect("/app/reports");
  }

  return (
    <div className="space-y-6 text-slate-100">
      <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Saved Analyses
      </Link>
      <ErrorNotice message={query?.error} />
      {query?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{query.message}</div> : null}
      <SavedAnalysisRenderer envelope={savedAnalysis} />
    </div>
  );
}
