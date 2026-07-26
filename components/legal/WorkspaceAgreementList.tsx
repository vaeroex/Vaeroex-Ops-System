import Link from "next/link";
import type { Route } from "next";
import { Download, FileCheck2, ShieldCheck } from "lucide-react";
import type { Database } from "@/lib/supabase/types";

type AgreementRow = Database["public"]["Tables"]["workspace_agreements"]["Row"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function WorkspaceAgreementList({ agreements }: { agreements: AgreementRow[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Legal &amp; Agreements</p>
          <h2 className="mt-1 text-base font-semibold text-white">Workspace legal records</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Read-only agreements retained for the workspace. These records are not business evidence and never participate in Vaeroex intelligence or retrieval.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-950/30 px-3 py-1 text-xs font-semibold text-emerald-100">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Private legal records
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {agreements.map((agreement) => (
          <article key={agreement.id} className="flex flex-col gap-4 rounded-lg border border-white/10 bg-slate-950/55 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-950/30 text-cyan-200">
                <FileCheck2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-white">Vaeroex Workspace Agreement</h3>
                <p className="mt-1 text-sm text-slate-300">{agreement.organization_name}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Signed {formatDate(agreement.signed_at)} · Agreement {agreement.id}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/app/legal/agreements/${agreement.id}` as Route} className="inline-flex min-h-11 items-center justify-center rounded-md bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">View agreement</Link>
              <a href={`/api/legal/workspace-agreements/${agreement.id}/pdf?disposition=attachment`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/15 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </a>
            </div>
          </article>
        ))}
        {!agreements.length ? (
          <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-7 text-center">
            <h3 className="font-semibold text-white">No Workspace Agreement is available.</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Legacy workspaces created before signed Workspace Agreements will not display a generated legal record.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
