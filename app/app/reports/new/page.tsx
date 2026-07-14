import Link from "next/link";
import type { Route } from "next";
import { saveGeneratedOutputToReportsAction } from "@/app/app/generated/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { buildGeneratedOutput, parseGeneratedOutputType, sourceFromSearchParams } from "@/lib/intelligence/generated-output";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type NewReportPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function paramsFromSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    const current = Array.isArray(value) ? value[0] : value;
    if (current) params.set(key, current);
  }

  return params;
}

function confidenceClass(confidence: string) {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function compactText(value: string, maxLength = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function outputSourceData({
  output,
  sourceId,
  sourceTitle
}: {
  output: ReturnType<typeof buildGeneratedOutput>;
  sourceId: string | null;
  sourceTitle: string;
}) {
  return JSON.stringify({
    generated_from: "intelligence_finding",
    derived_analysis: true,
    output_type: output.type,
    source_finding_id: sourceId,
    source_title: sourceTitle,
    source_href: sourceId ? `/app/intelligence?finding=${encodeURIComponent(sourceId)}` : output.sourceHref,
    evidence_count: output.evidenceCount,
    independent_source_count: output.independentSourceCount,
    source_record_ids: output.supportingRecordIds,
    evidence: output.evidence,
    source_types: output.sourceTypes,
    confidence: output.confidence,
    priority: output.priority,
    limitations: output.limitations,
    suggested_next_data: output.suggestedNextData
  });
}

function reportDecision(type: ReturnType<typeof parseGeneratedOutputType>) {
  if (type === "risk_brief") return "Decide whether this finding requires a focused leadership investigation now.";
  if (type === "action_plan") return "Decide whether leadership should adopt the proposed improvement direction.";
  return "Decide whether this draft accurately represents the finding and is ready to preserve as a report.";
}

export default async function NewReportPage({ searchParams }: NewReportPageProps) {
  const params = paramsFromSearchParams((await searchParams) || {});
  const error = params.get("error");
  const outputType = parseGeneratedOutputType(params.get("type"));
  const sourceId = params.get("source");

  if (isSecurityResponseMessage(error)) {
    return <div className="mx-auto max-w-3xl"><SecurityResponseNotice /></div>;
  }

  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [tasksResult, issuesResult, kpisResult, filesResult, crmResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false })
  ]);
  const errors = [tasksResult.error, issuesResult.error, kpisResult.error, filesResult.error, crmResult.error, importsResult.error, sopsResult.error, formsResult.error, submissionsResult.error, peopleResult.error, decisionsResult.error, outcomesResult.error].filter(Boolean);
  const intelligence = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: kpisResult.data || [],
    files: filesResult.data || [],
    reports: [],
    vaeroexRuns: [],
    crmLeads: crmResult.data || [],
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || []
  });
  const source = sourceFromSearchParams({ params, intelligence });
  const output = buildGeneratedOutput({ type: outputType, source, intelligence, workspaceName: context.activeWorkspace?.name });
  const canSave = errors.length === 0 && source.supportingRecords.length > 0;
  const sourceDataJson = outputSourceData({ output, sourceId, sourceTitle: source.title });
  const sourceHref = sourceId ? `/app/intelligence?finding=${encodeURIComponent(sourceId)}` : source.sourceHref;

  return (
    <div className="mx-auto max-w-5xl space-y-5 text-slate-100">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <Link href="/app/reports" className="font-semibold text-cyan-100 hover:text-white">Reports</Link>
        <span aria-hidden="true">/</span>
        <span>New {output.label}</span>
      </nav>

      <ErrorNotice message={error} />
      {errors.length ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-sm text-amber-100">
          Required evidence could not be loaded, so this draft cannot be saved.
        </div>
      ) : null}

      <header className="border-b border-white/10 pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">Draft · Not saved</span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(output.confidence)}`}>Confidence: {output.confidence}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">Priority: {output.priority}</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold leading-tight text-white sm:text-3xl">{source.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Generated from Intelligence finding: <Link href={sourceHref as Route} className="font-semibold text-cyan-100 hover:text-white">{source.title}</Link></p>
          </div>
          <Link href={sourceHref as Route} className="inline-flex min-h-10 shrink-0 items-center text-sm font-semibold text-cyan-100 hover:text-white">Back to finding</Link>
        </div>
      </header>

      <main className="space-y-5 rounded-lg border border-white/10 bg-[#08111f] p-4 shadow-panel sm:p-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Executive summary</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">{compactText(output.summary)}</p>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Evidence-backed facts</h2>
          {output.evidence.length ? (
            <ul className="mt-2 divide-y divide-white/10 border-y border-white/10 text-sm leading-6 text-slate-200">
              {output.evidence.map((item) => <li key={item} className="break-words py-2.5">{compactText(item, 280)}</li>)}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-400">Not enough evidence for a reliable conclusion.</p>}
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Decision required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200">{reportDecision(outputType)}</p>
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Recommended next step</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200">{compactText(output.recommendedRemedy, 300)}</p>
          </section>
        </div>

        <section className="border-l-2 border-amber-300/40 pl-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-100">Limitation</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{compactText(output.limitations, 300)}</p>
        </section>

        <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Link href={sourceHref as Route} className="inline-flex min-h-10 items-center text-sm font-semibold text-cyan-100 hover:text-white">Review evidence</Link>
          {canSave ? (
            <form action={saveGeneratedOutputToReportsAction}>
              <input type="hidden" name="title" value={output.title} />
              <input type="hidden" name="output_type" value={output.label} />
              <input type="hidden" name="source_data_json" value={sourceDataJson} />
              <textarea className="hidden" name="body_markdown" defaultValue={output.markdown} />
              <ConfirmSubmitButton message="Save this report?" pendingLabel="Saving report...">Save report</ConfirmSubmitButton>
            </form>
          ) : (
            <button type="button" disabled className="min-h-10 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 opacity-70">Save report</button>
          )}
        </div>
      </main>
    </div>
  );
}
