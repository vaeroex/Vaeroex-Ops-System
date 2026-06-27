import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { generatedOutputHref, type GeneratedOutputType } from "@/lib/intelligence/generated-output";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type ChecklistRow = Database["public"]["Tables"]["checklists"]["Row"];
type ChecklistRunRow = Database["public"]["Tables"]["checklist_runs"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];

type OutputCandidate = {
  id: string;
  title: string;
  source: string;
  status: string;
  priority: string;
  evidence: string;
  reviewFocus: string;
  href: Route;
  outputType: GeneratedOutputType;
  label: string;
};

function isClosed(value: string | null | undefined) {
  return ["closed", "done", "complete", "completed", "dismissed"].includes((value || "").toLowerCase());
}

function isOverdue(date: string | null | undefined) {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

function priorityClass(priority: string) {
  const normalized = priority.toLowerCase();

  if (normalized.includes("urgent") || normalized.includes("high")) return "border-red-400/35 bg-red-950/30 text-red-100";
  if (normalized.includes("medium")) return "border-amber-400/35 bg-amber-950/25 text-amber-100";
  return "border-slate-500/35 bg-slate-950/45 text-slate-200";
}

function OutputCandidateList({ items }: { items: OutputCandidate[] }) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-sm leading-6 text-slate-300">
        No strong output candidate is visible yet. Add source records, imports, reports, or KPI history so Vaeroex can generate useful executive documents.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-lg border border-white/10 bg-[#08111f] p-3 text-slate-100 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.source}</p>
              <h3 className="mt-1 text-base font-semibold text-white">{item.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                <span className="font-semibold text-slate-100">Evidence:</span> {item.evidence}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                <span className="font-semibold text-slate-100">Leadership review:</span> {item.reviewFocus}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
              <StatusBadge value={item.status} />
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(item.priority)}`}>{item.priority}</span>
              <Link
                href={generatedOutputHref({ type: item.outputType, title: item.title, summary: item.evidence, remedy: item.reviewFocus })}
                className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy"
              >
                {item.label}
              </Link>
              <Link href={item.href} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
                Review evidence
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutputTypeCard({
  title,
  description,
  type
}: {
  title: string;
  description: string;
  type: GeneratedOutputType;
}) {
  return (
    <Link href={generatedOutputHref({ type, title })} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/40 hover:bg-blue-950/25">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Generated output</p>
      <h2 className="mt-2 text-base font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
      <span className="mt-4 inline-flex rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100">
        Start draft
      </span>
    </Link>
  );
}

function OutputLibrary() {
  const outputTypes = [
    {
      title: "Executive Report",
      description: "A polished leadership document with what happened, evidence, impact, confidence, and review focus.",
      type: "executive_briefing" as const
    },
    {
      title: "Executive Brief",
      description: "A concise brief for a single risk, opportunity, trend, or leadership decision.",
      type: "executive_briefing" as const
    },
    {
      title: "Improvement Plan",
      description: "A reviewable plan that explains the situation, likely cause, business impact, and success measures.",
      type: "action_plan" as const
    },
    {
      title: "SOP",
      description: "A draft procedure your organization can review and adopt inside its existing systems.",
      type: "sop" as const
    },
    {
      title: "Meeting Agenda",
      description: "A leadership agenda focused on what changed, what is at risk, evidence, and decisions needed.",
      type: "executive_briefing" as const
    },
    {
      title: "Investigation Summary",
      description: "A risk-focused summary of evidence, likely causes, limitations, and what leadership should review.",
      type: "risk_brief" as const
    },
    {
      title: "Board Summary",
      description: "A concise executive summary for owner, board, investor, or advisor conversations.",
      type: "executive_briefing" as const
    }
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {outputTypes.map((output) => (
        <OutputTypeCard key={output.title} {...output} />
      ))}
    </section>
  );
}

function SourceContextSummary({
  openSignals,
  openIssues,
  openRuns,
  savedRecommendations
}: {
  openSignals: number;
  openIssues: number;
  openRuns: number;
  savedRecommendations: number;
}) {
  const items = [
    ["Source signals", openSignals],
    ["Open issues", openIssues],
    ["Checklist evidence", openRuns],
    ["Saved recommendations", savedRecommendations]
  ];

  return (
    <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Evidence available</p>
          <h2 className="mt-2 text-base font-semibold text-white">Use Vaeroex to generate documents from intelligence, not to manage execution.</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-center">
              <p className="text-lg font-semibold text-white">{value}</p>
              <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SourceLinks() {
  return (
    <details className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-slate-200">Advanced: source evidence areas</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/app/tasks" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Source signals</Link>
        <Link href="/app/issues" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Issues</Link>
        <Link href="/app/checklists" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Checklists</Link>
        <Link href="/app/briefings" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Saved briefings</Link>
      </div>
    </details>
  );
}

export default async function ActionsPage() {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [tasksResult, issuesResult, checklistsResult, runsResult, outcomesResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false })
  ]);

  const tasks = (tasksResult.data || []) as TaskRow[];
  const issues = (issuesResult.data || []) as IssueRow[];
  const checklists = (checklistsResult.data || []) as ChecklistRow[];
  const runs = (runsResult.data || []) as ChecklistRunRow[];
  const outcomes = (outcomesResult.data || []) as RecommendationOutcomeRow[];
  const errors = [tasksResult.error, issuesResult.error, checklistsResult.error, runsResult.error, outcomesResult.error].filter(Boolean);
  const openSignals = tasks.filter((task) => !isClosed(task.status));
  const overdueSignals = openSignals.filter((task) => isOverdue(task.due_date));
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const openRuns = runs.filter((run) => !isClosed(run.status));
  const savedRecommendations = outcomes.filter((outcome) => outcome.status === "accepted" || outcome.status === "reviewed" || outcome.status === "assigned");
  const candidates: OutputCandidate[] = [
    ...overdueSignals.slice(0, 4).map((signal) => ({
      id: `signal-${signal.id}`,
      title: signal.title,
      source: signal.ai_generated ? "Vaeroex source signal" : "Source-system signal",
      status: signal.status,
      priority: signal.priority,
      evidence: signal.description || `This source-system signal remains incomplete${signal.due_date ? ` since ${signal.due_date}` : ""}.`,
      reviewFocus: "Leadership should review whether the underlying workflow is still producing missed response, handoff, or service signals.",
      href: "/app/tasks" as Route,
      outputType: "action_plan" as const,
      label: "Generate Improvement Plan"
    })),
    ...openIssues.slice(0, 4).map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue.title,
      source: "Issue / risk",
      status: issue.status,
      priority: issue.severity,
      evidence: issue.description || issue.root_cause || "This risk is still open in the source records.",
      reviewFocus: issue.recommended_fix || "Leadership should review severity, evidence, business impact, and whether an investigation summary is needed.",
      href: "/app/issues" as Route,
      outputType: "risk_brief" as const,
      label: "Generate Investigation Summary"
    })),
    ...savedRecommendations.slice(0, 3).map((outcome) => ({
      id: `outcome-${outcome.id}`,
      title: outcome.title,
      source: "Saved Vaeroex recommendation",
      status: outcome.status,
      priority: outcome.priority,
      evidence: outcome.evidence || "This recommendation was saved after review.",
      reviewFocus: outcome.outcome_summary || "Leadership should decide whether this needs an executive brief, meeting agenda, or improvement plan.",
      href: "/app/briefings" as Route,
      outputType: "executive_briefing" as const,
      label: "Generate Executive Brief"
    }))
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Generated Outputs"
        title="Generated Outputs"
        description="Create reviewable executive documents from Vaeroex intelligence. Vaeroex analyzes source systems; it does not replace the systems your company uses to execute work."
        actions={
          <Link href="/app/intelligence" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Review Intelligence
          </Link>
        }
      />

      {errors.length ? (
        <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm text-red-100">
          {errors[0]?.message || "Some output source data could not be loaded."}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Executive intelligence principle</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Vaeroex produces intelligence and documents, not execution tracking.</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
          Use this page to generate executive reports, briefs, improvement plans, SOP drafts, meeting agendas, investigation summaries, and board summaries. Salesforce, HubSpot, Monday, ClickUp, Asana, ServiceTitan, Jobber, QuickBooks, NetSuite, and your other systems remain the places where work is executed.
        </p>
      </section>

      <OutputLibrary />

      <SourceContextSummary
        openSignals={openSignals.length}
        openIssues={openIssues.length}
        openRuns={openRuns.length || checklists.length}
        savedRecommendations={savedRecommendations.length}
      />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">Signals ready for documentation</h2>
          <StatusBadge value={`${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`} />
        </div>
        <OutputCandidateList items={candidates} />
      </section>

      <SourceLinks />
    </div>
  );
}
