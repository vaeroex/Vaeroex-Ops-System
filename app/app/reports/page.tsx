import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SavedAnalysisList } from "@/components/reports/SavedAnalysisList";
import {
  parseSavedAnalysisEnvelope,
  savedAnalysisListItem
} from "@/lib/reports/saved-analysis";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

type ReportRow = Pick<Database["public"]["Tables"]["reports"]["Row"], "id" | "archived_at" | "source_data_json">;

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const channel = currentSavedAnalysisReleaseChannel();
  const { data, error } = await supabase
    .from("reports")
    .select("id,archived_at,source_data_json")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .is("archived_at", null)
    .contains("source_data_json", { record_kind: "saved_analysis", release_channel: channel })
    .order("created_at", { ascending: false })
    .limit(300);
  const saved = [] as ReturnType<typeof savedAnalysisListItem>[];

  for (const row of (data || []) as ReportRow[]) {
    const envelope = parseSavedAnalysisEnvelope(row.source_data_json);
    if (envelope && !row.archived_at && envelope.workspace_id === workspaceId && envelope.release_channel === channel) {
      saved.push(savedAnalysisListItem(row.id, envelope));
    }
  }

  return (
    <div className="space-y-8 text-slate-100">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Leadership reference</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Saved Analyses</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Save completed analyses you want leadership to revisit. Saved analyses never regenerate or rewrite their copied content.</p>
      </header>

      <ErrorNotice message={params?.error || error?.message} />
      {params?.message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-950/25 p-3 text-sm text-emerald-100">{params.message}</div> : null}

      <SavedAnalysisList analyses={saved} />
    </div>
  );
}
