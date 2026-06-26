import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FormRow = Database["public"]["Tables"]["forms"]["Row"];
type FormSubmissionRow = Database["public"]["Tables"]["form_submissions"]["Row"];
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];

type SourceCardProps = {
  title: string;
  description: string;
  count: number;
  href: Route;
  examples: string[];
  status: string;
};

function sourceClass(status: string) {
  if (/ready|analyzed|active|available/i.test(status)) return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (/review|pending|developing/i.test(status)) return "border-amber-400/35 bg-amber-950/25 text-amber-100";
  return "border-slate-500/35 bg-slate-950/45 text-slate-200";
}

function SourceCard({ title, description, count, href, examples, status }: SourceCardProps) {
  return (
    <Link href={href} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/40 hover:bg-blue-950/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Source type</p>
          <h2 className="mt-2 text-base font-semibold text-white">{title}</h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceClass(status)}`}>{status}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
      <p className="mt-4 text-3xl font-semibold text-white">{count}</p>
      <ul className="mt-3 space-y-1 text-xs leading-5 text-slate-400">
        {examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ul>
    </Link>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function latestSources({
  files,
  reports,
  sops,
  forms
}: {
  files: FileUploadRow[];
  reports: ReportRow[];
  sops: SopRow[];
  forms: FormRow[];
}) {
  return [
    ...files.slice(0, 5).map((item) => ({
      id: `file-${item.id}`,
      title: item.display_name,
      type: "File",
      detail: item.analysis_summary || `${item.file_extension.toUpperCase()} · ${item.import_status}`,
      createdAt: item.created_at,
      href: "/app/files" as Route
    })),
    ...reports.slice(0, 5).map((item) => ({
      id: `report-${item.id}`,
      title: item.title,
      type: "Report",
      detail: item.report_type,
      createdAt: item.created_at,
      href: "/app/reports" as Route
    })),
    ...sops.slice(0, 4).map((item) => ({
      id: `sop-${item.id}`,
      title: item.title,
      type: "Process knowledge",
      detail: item.category || item.status,
      createdAt: item.created_at,
      href: "/app/sops" as Route
    })),
    ...forms.slice(0, 4).map((item) => ({
      id: `form-${item.id}`,
      title: item.name,
      type: "Intake form",
      detail: item.form_type || "Form",
      createdAt: item.created_at,
      href: "/app/forms" as Route
    }))
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
}

export default async function SourcesPage() {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [filesResult, importsResult, reportsResult, sopsResult, formsResult, submissionsResult, kpisResult, crmResult, issuesResult, runsResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false })
  ]);

  const files = (filesResult.data || []) as FileUploadRow[];
  const imports = (importsResult.data || []) as FileImportRow[];
  const reports = (reportsResult.data || []) as ReportRow[];
  const sops = (sopsResult.data || []) as SopRow[];
  const forms = (formsResult.data || []) as FormRow[];
  const submissions = (submissionsResult.data || []) as FormSubmissionRow[];
  const kpis = (kpisResult.data || []) as KpiRow[];
  const crmLeads = (crmResult.data || []) as CrmLeadRow[];
  const issues = (issuesResult.data || []) as IssueRow[];
  const runs = (runsResult.data || []) as VaeroexRunRow[];
  const errors = [filesResult.error, importsResult.error, reportsResult.error, sopsResult.error, formsResult.error, submissionsResult.error, kpisResult.error, crmResult.error, issuesResult.error, runsResult.error].filter(Boolean);
  const spreadsheetFiles = files.filter((file) => ["csv", "xlsx"].includes(file.file_extension.toLowerCase()));
  const documents = files.filter((file) => ["pdf", "docx", "png", "jpg", "jpeg"].includes(file.file_extension.toLowerCase()));
  const pendingImports = imports.filter((item) => item.status !== "completed");
  const completedRuns = runs.filter((run) => run.status === "completed");
  const foundItems = [
    kpis.length ? `${kpis.length} KPI record${kpis.length === 1 ? "" : "s"} available as signals` : "",
    issues.length ? `${issues.length} issue/risk record${issues.length === 1 ? "" : "s"} available as evidence` : "",
    crmLeads.length ? `${crmLeads.length} customer context record${crmLeads.length === 1 ? "" : "s"} available` : "",
    pendingImports.length ? `${pendingImports.length} import${pendingImports.length === 1 ? "" : "s"} waiting for review` : "",
    completedRuns.length ? `${completedRuns.length} saved Vaeroex result${completedRuns.length === 1 ? "" : "s"} in business memory` : ""
  ].filter(Boolean);
  const recentSources = latestSources({ files, reports, sops, forms });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources"
        title="Business Information Sources"
        description="Where information enters Vaeroex. Upload files, import spreadsheets, collect forms, save reports, and preserve process knowledge so Vaeroex can build workspace context."
        actions={
          <Link href="/app/files" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Upload Source
          </Link>
        }
      />

      {errors.length ? (
        <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm text-red-100">
          {errors[0]?.message || "Some source data could not be loaded."}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Upload / connect information</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Vaeroex turns source material into leadership intelligence.</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
          Sources are not the product. They are the evidence Vaeroex uses to understand what changed, what matters, what may happen next, and what action should be taken.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/app/files" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Upload file</Link>
          <Link href="/app/files?status=Imported" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Review imports</Link>
          <Link href="/app/intelligence" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Review intelligence</Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <SourceCard
          title="Structured data"
          description="Spreadsheets, imported KPIs, business metrics, and customer records."
          count={spreadsheetFiles.length + kpis.length + imports.length}
          href="/app/files"
          status={pendingImports.length ? "Needs review" : kpis.length ? "Ready" : "Developing"}
          examples={["KPI data", "Customer context", "Operational metrics"]}
        />
        <SourceCard
          title="Documents and reports"
          description="PDFs, DOCX files, saved reports, and analysis-ready business documents."
          count={documents.length + reports.length}
          href="/app/reports"
          status={reports.length || documents.length ? "Available" : "Developing"}
          examples={["Reports", "Briefings", "Uploaded documents"]}
        />
        <SourceCard
          title="Process knowledge"
          description="SOPs, checklists, forms, and submissions that explain how work actually happens."
          count={sops.length + forms.length + submissions.length}
          href="/app/sops"
          status={sops.length || forms.length ? "Available" : "Developing"}
          examples={["SOPs", "Forms", "Submissions"]}
        />
        <SourceCard
          title="Customer context"
          description="Lead and relationship records used as context, not a full CRM replacement."
          count={crmLeads.length}
          href="/app/crm"
          status={crmLeads.length ? "Active" : "Developing"}
          examples={["Leads", "Follow-up status", "Estimated value"]}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Vaeroex found</h2>
            <StatusBadge value={`${foundItems.length} finding${foundItems.length === 1 ? "" : "s"}`} />
          </div>
          {foundItems.length ? (
            <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
              {foundItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-300">Upload a file, import KPI history, add a report, or create customer context so Vaeroex has evidence to work from.</p>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Recent source material</h2>
            <Link href="/app/files" className="text-xs font-semibold text-vaeroex-accent hover:text-cyan-100">Manage files</Link>
          </div>
          {recentSources.length ? (
            <div className="mt-4 divide-y divide-white/10">
              {recentSources.map((item) => (
                <Link key={item.id} href={item.href} className="grid gap-2 py-3 text-sm transition hover:bg-cyan-950/20 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.type} · {item.detail}</p>
                  </div>
                  <span className="text-xs text-slate-500">{formatDate(item.createdAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-300">No source material has been added yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
