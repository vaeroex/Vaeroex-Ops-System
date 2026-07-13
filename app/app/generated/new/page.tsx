import Link from "next/link";
import type { Route } from "next";
import { saveGeneratedOutputToReportsAction } from "@/app/app/generated/actions";
import { GeneratedOutputControls } from "@/components/generated/GeneratedOutputControls";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import {
  buildGeneratedOutput,
  parseGeneratedOutputType,
  sourceFromSearchParams
} from "@/lib/intelligence/generated-output";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type OutputsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function paramsFromSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      if (value[0]) params.set(key, value[0]);
    } else if (value) {
      params.set(key, value);
    }
  }

  return params;
}

function confidenceClass(confidence: string) {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function compactText(value: string, maxLength = 420) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function outputSourceData(output: ReturnType<typeof buildGeneratedOutput>) {
  return JSON.stringify({
    generated_from: "generated_output",
    derived_analysis: true,
    output_type: output.type,
    source_title: output.title,
    evidence_count: output.evidenceCount,
    evidence: output.evidence,
    source_types: output.sourceTypes,
    source_href: output.sourceHref,
    confidence: output.confidence,
    priority: output.priority,
    limitations: output.limitations,
    suggested_next_data: output.suggestedNextData
  });
}

export default async function NewGeneratedOutputPage({ searchParams }: OutputsPageProps) {
  const params = paramsFromSearchParams((await searchParams) || {});
  const error = params.get("error");
  const outputType = parseGeneratedOutputType(params.get("type"));

  if (isSecurityResponseMessage(error)) {
    return (
      <div className="mx-auto max-w-3xl print:hidden">
        <SecurityResponseNotice />
      </div>
    );
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
  const errors = [
    tasksResult.error,
    issuesResult.error,
    kpisResult.error,
    filesResult.error,
    crmResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    outcomesResult.error
  ].filter(Boolean);
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
  const output = buildGeneratedOutput({
    type: outputType,
    source,
    intelligence,
    workspaceName: context.activeWorkspace?.name
  });
  const sourceDataJson = outputSourceData(output);

  return (
    <div className="space-y-6 print:bg-white print:text-black">
      <PageHeader
        eyebrow={`Intelligence → ${output.label}`}
        title={output.label}
        description="Draft · Not saved. Review the brief, then save or export it when it is ready for leadership use."
        actions={
          <Link href="/app/intelligence" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30 print:hidden">
            Back to finding
          </Link>
        }
      />

      <div className="print:hidden">
        <ErrorNotice message={error} />
      </div>
      {errors.length ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-sm text-amber-100 print:hidden">
          {errors[0]?.message || "Some workspace context could not be loaded. This brief only uses the evidence that was available."}
        </div>
      ) : null}

      <section className="rounded-lg border border-cyan-300/20 bg-[#08111f] p-5 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent print:text-slate-600">{output.label}</p>
            <h1 className="mt-3 text-2xl font-semibold text-white print:text-black">{output.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 print:text-slate-700">{compactText(output.summary)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(output.confidence)}`}>
              Confidence: {output.confidence}
            </span>
            <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-100 print:border-slate-300 print:text-slate-700">
              Priority: {output.priority}
            </span>
          </div>
        </div>
        <div className="mt-5">
          <GeneratedOutputControls title={output.title} markdown={output.markdown} />
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 print:text-slate-600">What Vaeroex found</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200 print:text-slate-700">{compactText(output.whyMatters)}</p>
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 print:text-slate-600">Business impact</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200 print:text-slate-700">{compactText(source.impact)}</p>
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 print:text-slate-600">Recommended leadership response</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200 print:text-slate-700">{compactText(output.recommendedRemedy)}</p>
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 print:text-slate-600">What to verify</h2>
            <p className="mt-2 text-sm leading-6 text-slate-200 print:text-slate-700">{compactText(output.limitations)}</p>
          </section>
        </div>
        <details className="mt-5 rounded-lg border border-white/10 bg-slate-950/45 p-4 print:border-slate-300 print:bg-white" open={false}>
          <summary className="cursor-pointer text-sm font-semibold text-cyan-100 print:text-black">Supporting evidence ({output.evidenceCount})</summary>
          <div className="mt-4 space-y-4">
            <ul className="space-y-2 text-sm leading-6 text-slate-300 print:text-slate-700">
              {output.evidence.map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 print:bg-slate-500" /><span>{item}</span></li>)}
            </ul>
            <p className="text-xs leading-5 text-slate-400 print:text-slate-600">Source types: {output.sourceTypes.join(", ")}</p>
          </div>
        </details>
        <div className="mt-5 flex flex-wrap gap-2 print:hidden">
          <form action={saveGeneratedOutputToReportsAction}>
            <input type="hidden" name="title" value={output.title} />
            <input type="hidden" name="output_type" value={output.label} />
            <input type="hidden" name="source_data_json" value={sourceDataJson} />
            <textarea className="hidden" name="body_markdown" defaultValue={output.markdown} />
            <ConfirmSubmitButton message="Save this output to Reports?">
              Save to Reports
            </ConfirmSubmitButton>
          </form>
          <Link href={output.sourceHref as Route} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
            View source evidence
          </Link>
        </div>
      </section>

    </div>
  );
}
