import Link from "next/link";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type CrmPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readableDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleDateString();
}

function sourceLabel(entry: CrmLeadRow) {
  if (entry.source_file_id) return "Uploaded source";
  if (entry.import_id) return "Historical import";
  return "Legacy manual entry";
}

function historyForEntry(history: CrmLeadHistoryRow[], entryId: string) {
  return history.filter((item) => item.lead_id === entryId).slice(0, 3);
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.06] p-4 text-slate-100">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">{note}</p>
    </article>
  );
}

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [entryResult, historyResult] = await Promise.all([
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500)
  ]);
  const entries = ((entryResult.data || []) as CrmLeadRow[]).filter((entry) => !entry.deleted_at);
  const history = (historyResult.data || []) as CrmLeadHistoryRow[];
  const importedEntries = entries.filter((entry) => entry.source_file_id || entry.import_id);
  const archivedEntries = entries.filter((entry) => entry.archived_at);
  const latestEntryDate = entries.map((entry) => entry.last_activity_at || entry.updated_at || entry.created_at).filter(Boolean).sort().at(-1);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Legacy Evidence"
        title="Historical Customer Evidence"
        description="This compatibility view preserves older customer activity evidence for intelligence context. Vaeroex no longer provides customer-record management workflows."
      />

      <ErrorNotice message={param(params?.error) || entryResult.error?.message || historyResult.error?.message} />

      <section className="rounded-xl border border-amber-300/25 bg-amber-950/20 p-4 text-amber-50">
        <p className="text-sm font-semibold">Read-only compatibility view</p>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-amber-100/85">
          Existing rows remain available as historical evidence so reports, Business Memory, and Ask Vaeroex can understand past customer activity. New customer information should enter Vaeroex through Sources, uploaded files, reports, Business Memory, or future external system integrations.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
            Open Sources
          </Link>
          <Link href="/app/intelligence" className="rounded-lg border border-amber-200/30 px-3 py-2 text-sm font-semibold text-amber-50 hover:border-cyan-300/60">
            Open Intelligence
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Historical entries" value={entries.length} note="Stored for evidence only." />
        <MetricCard label="Uploaded or imported" value={importedEntries.length} note="Evidence from files or older imports." />
        <MetricCard label="Archived entries" value={archivedEntries.length} note="Preserved historical context." />
        <MetricCard label="Latest evidence" value={readableDate(latestEntryDate)} note="Most recent stored activity date." />
      </section>

      <section className="rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Historical evidence</p>
            <h2 className="mt-2 text-lg font-semibold text-white">Existing customer activity context</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              These evidence entries are not editable in Vaeroex. Review the source evidence here, then use Sources or Intelligence for new analysis.
            </p>
          </div>
          <span className="w-fit rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-200">Read only</span>
        </div>

        <div className="mt-4 space-y-3">
          {entries.length ? (
            entries.map((entry) => {
              const entryHistory = historyForEntry(history, entry.id);

              return (
                <article key={entry.id} className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{entry.lead_name}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-300">
                        {[entry.company, sourceLabel(entry), entry.status ? `Context: ${entry.status}` : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">{readableDate(entry.last_activity_at || entry.updated_at || entry.created_at)}</p>
                  </div>
                  {entry.notes ? <p className="mt-3 text-sm leading-6 text-slate-300">{entry.notes}</p> : null}
                  {entryHistory.length ? (
                    <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-100">View evidence history</summary>
                      <div className="mt-3 space-y-2">
                        {entryHistory.map((item) => (
                          <p key={item.id} className="text-xs leading-5 text-slate-300">
                            {readableDate(item.created_at)} · {item.event_type.replace(/_/g, " ")}
                            {item.status ? ` · ${item.status}` : ""}
                          </p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.04] p-4">
              <p className="text-sm font-semibold text-white">No historical customer evidence is stored.</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">Upload source files or connect external systems when customer activity evidence is needed for Operations Intelligence.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
