import Link from "next/link";
import type { Route } from "next";
import { saveGeneratedOutputToBriefingsAction } from "@/app/app/generated/actions";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { BusinessIntelligenceCoverageSummary } from "@/components/intelligence/BusinessIntelligenceCoverage";
import { GeneratedOutputControls } from "@/components/generated/GeneratedOutputControls";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import {
  buildGeneratedOutput,
  parseGeneratedOutputType,
  sourceFromSearchParams
} from "@/lib/intelligence/generated-output";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
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

function outputSourceData(output: ReturnType<typeof buildGeneratedOutput>) {
  return JSON.stringify({
    generated_from: "generated_output",
    output_type: output.type,
    source_title: output.title,
    evidence_count: output.evidenceCount,
    evidence: output.evidence,
    source_types: output.sourceTypes,
    source_href: output.sourceHref,
    confidence: output.confidence,
    limitations: output.limitations,
    suggested_next_data: output.suggestedNextData
  });
}

export default async function NewGeneratedOutputPage({ searchParams }: OutputsPageProps) {
  const params = paramsFromSearchParams((await searchParams) || {});
  const error = params.get("error");
  const outputType = parseGeneratedOutputType(params.get("type"));
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [tasksResult, issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, crmHistoryResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult, checklistsResult, checklistRunsResult, metricsResult, assetsResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("updated_at", { ascending: false })
  ]);
  const errors = [
    tasksResult.error,
    issuesResult.error,
    kpisResult.error,
    filesResult.error,
    reportsResult.error,
    runsResult.error,
    crmResult.error,
    crmHistoryResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    outcomesResult.error,
    checklistsResult.error,
    checklistRunsResult.error,
    metricsResult.error,
    assetsResult.error
  ].filter(Boolean);
  const intelligence = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: kpisResult.data || [],
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: runsResult.data || [],
    crmLeads: crmResult.data || [],
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || []
  });
  const businessIntelligenceCoverage = buildBusinessIntelligenceCoverage({
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: kpisResult.data || [],
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: runsResult.data || [],
    crmLeads: crmResult.data || [],
    crmHistory: crmHistoryResult.data || [],
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || [],
    checklists: checklistsResult.data || [],
    checklistRuns: checklistRunsResult.data || [],
    operationalMetrics: metricsResult.data || [],
    assets: assetsResult.data || []
  });
  const source = sourceFromSearchParams({ params, intelligence });
  const output = buildGeneratedOutput({
    type: outputType,
    source,
    intelligence,
    workspaceName: context.activeWorkspace?.name,
    coverage: businessIntelligenceCoverage
  });
  const askPrompt = `Review this Vaeroex generated output and answer with evidence, confidence, and the first practical step: ${output.title}`;
  const sourceDataJson = outputSourceData(output);

  return (
    <div className="space-y-6 print:bg-white print:text-black">
      <PageHeader
        eyebrow="Generated output"
        title={output.label}
        description="Review the draft. Nothing is assigned, tracked, or saved into workspace records unless you explicitly choose a next step."
        actions={
          <Link href="/app/intelligence" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30 print:hidden">
            Back to Intelligence
          </Link>
        }
      />

      <div className="print:hidden">
        <ErrorNotice message={error} />
      </div>
      {errors.length ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-sm text-amber-100 print:hidden">
          {errors[0]?.message || "Some workspace context could not be loaded. The output was generated from available evidence."}
        </div>
      ) : null}

      <section className="rounded-lg border border-cyan-300/20 bg-[#08111f] p-5 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent print:text-slate-600">{output.subtitle}</p>
            <h1 className="mt-3 text-2xl font-semibold text-white print:text-black">{output.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 print:text-slate-700">{output.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(output.confidence)}`}>
              {output.confidence} confidence
            </span>
            <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-100 print:border-slate-300 print:text-slate-700">
              {output.evidenceCount} Business Signal{output.evidenceCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="mt-5">
          <GeneratedOutputControls title={output.title} markdown={output.markdown} />
        </div>
      </section>

      <BusinessIntelligenceCoverageSummary coverage={businessIntelligenceCoverage} />

      <section className="grid gap-4 xl:grid-cols-[.75fr_1.25fr]">
        <div className="space-y-4">
          <article className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
            <h2 className="text-sm font-semibold text-white print:text-black">Why this matters</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300 print:text-slate-700">{output.whyMatters}</p>
          </article>

          <article className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
            <h2 className="text-sm font-semibold text-white print:text-black">Recommended remedy</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300 print:text-slate-700">{output.recommendedRemedy}</p>
          </article>

          <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black" open={false}>
            <summary className="cursor-pointer text-sm font-semibold text-cyan-100 print:text-black">Evidence used</summary>
            <div className="mt-4 space-y-4">
              <ul className="space-y-2 text-sm leading-6 text-slate-300 print:text-slate-700">
                {output.evidence.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 print:bg-slate-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300 print:border-slate-300 print:bg-white print:text-slate-700">
                <p><span className="font-semibold text-white print:text-black">Source types:</span> {output.sourceTypes.join(", ")}</p>
                <p><span className="font-semibold text-white print:text-black">Limitations:</span> {output.limitations}</p>
              </div>
            </div>
          </details>
        </div>

        <article className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel print:border-slate-300 print:bg-white print:text-black">
          <h2 className="text-base font-semibold text-white print:text-black">Generated output</h2>
          <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-white/10 bg-slate-950/70 p-4 font-sans text-sm leading-7 text-slate-100 print:border-slate-300 print:bg-white print:text-black">
            {output.markdown}
          </pre>
        </article>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel print:hidden">
        <h2 className="text-base font-semibold text-white">Optional next steps</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          This draft is portable. Save it, copy it, or ask Vaeroex to explain the evidence before leadership reviews it in your existing operating systems.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={saveGeneratedOutputToBriefingsAction}>
            <input type="hidden" name="title" value={output.title} />
            <input type="hidden" name="output_type" value={output.label} />
            <input type="hidden" name="source_data_json" value={sourceDataJson} />
            <textarea className="hidden" name="body_markdown" defaultValue={output.markdown} />
            <ConfirmSubmitButton message="Save this generated output to Briefings?">
              Save to Briefings
            </ConfirmSubmitButton>
          </form>
          <ContextualAskVaeroex
            label="Explain This"
            prompt={askPrompt}
            contextType="generated_output"
            contextId={`${output.type}-${output.sourceHref}`}
            sourceTitle={output.title}
            sourceSummary={`${output.summary} Executive recommendation: ${output.recommendedRemedy}`}
            evidence={[
              output.whyMatters,
              ...output.evidence,
              `Confidence: ${output.confidence}`,
              `Source types: ${output.sourceTypes.join(", ")}`,
              `Limitations: ${output.limitations}`,
              `Suggested next data: ${output.suggestedNextData}`
            ]}
            compact
          />
          <Link href="/app/intelligence" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
            Dismiss
          </Link>
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-slate-950/45 p-4">
          <p className="text-sm font-semibold text-slate-100">Source context</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Vaeroex produced this as decision support. Review the source context before using the output in Salesforce, HubSpot, Monday, ClickUp, Asana, ServiceTitan, Jobber, QuickBooks, NetSuite, or another system of record.
          </p>
          <Link href={output.sourceHref as Route} className="mt-4 inline-flex rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
            Open source record area
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 print:hidden">
        {[
          "Why did Vaeroex recommend this?",
          "What evidence supports this?",
          "What should I do first?",
          "What data would improve confidence?",
          "Make this more concise.",
          "Turn this into a checklist.",
          "Turn this into an SOP.",
          "Turn this into an executive briefing."
        ].map((question) => (
          <div
            key={question}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/35 hover:bg-cyan-950/30"
          >
            <ContextualAskVaeroex
              label={question}
              prompt={`${question} Context: ${output.title}`}
              contextType="generated_output_follow_up"
              contextId={`${output.type}-${output.sourceHref}`}
              sourceTitle={output.title}
              sourceSummary={`${output.summary} Recommended remedy: ${output.recommendedRemedy}`}
              evidence={[
                output.whyMatters,
                ...output.evidence,
                `Confidence: ${output.confidence}`,
                `Source types: ${output.sourceTypes.join(", ")}`,
                `Limitations: ${output.limitations}`
              ]}
              compact
            />
          </div>
        ))}
      </section>
    </div>
  );
}
