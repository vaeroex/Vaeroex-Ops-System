import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { filterOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { calculateProfitLeakage } from "@/lib/intelligence/profit-leakage";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function ProfitLeakagePage() {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [filesResult, kpisResult, metricsResult] = await Promise.all([
    supabase.from("file_uploads").select("id,display_name,analysis_summary,metadata_json,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(200),
    supabase.from("kpis").select("id,name,source,notes,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(300),
    supabase.from("operational_metrics").select("id,metric_name,category,notes,created_at,archived_at,deleted_at").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).limit(300)
  ]);
  const files = filterOriginalBusinessEvidence(filesResult.data || []);
  const kpis = filterOriginalBusinessEvidence(kpisResult.data || []);
  const metrics = filterOriginalBusinessEvidence(metricsResult.data || []);
  const sources = [...files.map((row) => `file:${row.id}`), ...kpis.map((row) => `kpi:${row.id}`), ...metrics.map((row) => `metric:${row.id}`)];
  const result = calculateProfitLeakage([], new Set(sources));
  const error = filesResult.error || kpisResult.error || metricsResult.error;

  return (
    <div className="space-y-6 text-slate-100">
      <header className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Performance</p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Profit Leakage</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Identify supported cost or revenue leakage from original business evidence. Candidate patterns remain separate from confirmed amounts.</p>
      </header>
      <ModuleTabs tabs={[
        { label: "KPI Overview", href: "/app/kpis" },
        { label: "Compare", href: "/app/kpis?section=compare" },
        { label: "Business Health", href: "/app#business-health-heading" },
        { label: "Profit Leakage", href: "/app/kpis/profit-leakage" as Route, active: true },
        { label: "KPI Settings", href: "/app/kpis/settings" }
      ]} />
      <ErrorNotice message={error?.message} />
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-lg border border-white/10 bg-[#08111f] p-4"><p className="text-xs font-semibold text-slate-400">Confirmed leakage</p><p className="mt-2 text-2xl font-semibold text-white">{result.confirmedTotal ? `$${result.confirmedTotal.toLocaleString()}` : "Not established"}</p></article>
        <article className="rounded-lg border border-white/10 bg-[#08111f] p-4"><p className="text-xs font-semibold text-slate-400">Supported findings</p><p className="mt-2 text-2xl font-semibold text-white">{result.findings.filter((item) => item.eligible).length}</p></article>
        <article className="rounded-lg border border-white/10 bg-[#08111f] p-4"><p className="text-xs font-semibold text-slate-400">Eligible evidence records</p><p className="mt-2 text-2xl font-semibold text-white">{sources.length}</p></article>
      </section>
      <section className="rounded-lg border border-amber-300/25 bg-amber-950/20 p-5">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" /><div><h2 className="text-base font-semibold text-white">No defensible leakage amount yet</h2><p className="mt-2 text-sm leading-6 text-slate-300">Vaeroex does not currently have structured invoice, vendor expense, payroll, inventory, or software-seat records sufficient to calculate a supported amount. Uploaded evidence may help identify where to investigate, but it will not be converted into a dollar claim without the required values.</p></div></div>
      </section>
      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-cyan-200" aria-hidden="true" /><div><h2 className="text-base font-semibold text-white">Evidence rules</h2><p className="mt-2 text-sm leading-6 text-slate-400">Only active original evidence can support a finding. Candidate, duplicate, archived, deleted, disputed, or incomplete calculations are excluded from totals and Business Health.</p><Link href="/app/sources" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:text-white">Review evidence</Link></div></div>
      </section>
    </div>
  );
}
