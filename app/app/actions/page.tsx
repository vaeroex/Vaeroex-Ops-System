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
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];

type ActionItem = {
  id: string;
  title: string;
  source: string;
  status: string;
  priority: string;
  why: string;
  nextStep: string;
  href: Route;
  outputType: GeneratedOutputType;
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

function ActionQueue({ items }: { items: ActionItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-sm leading-6 text-slate-300">
        No active recommendation queue is visible yet. Review Intelligence or add source data so Vaeroex can generate useful decision outputs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.source}</p>
              <h3 className="mt-2 text-base font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{item.why}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
              <StatusBadge value={item.status} />
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(item.priority)}`}>{item.priority}</span>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">
            <span className="font-semibold text-white">Recommended remedy:</span> {item.nextStep}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={generatedOutputHref({ type: item.outputType, title: item.title, summary: item.why, remedy: item.nextStep })}
              className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white"
            >
              {item.outputType === "risk_brief" ? "Generate Risk Brief" : "Generate Improvement Plan"}
            </Link>
            <Link
              href={generatedOutputHref({ type: "checklist", title: item.title, summary: item.why, remedy: item.nextStep })}
              className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
            >
              Generate Checklist
            </Link>
            <Link href="/app/ask" className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
              Ask Vaeroex
            </Link>
          </div>
          <div className="mt-3">
            <Link href={item.href} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
              Open source record area
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function ActionSystemCard({
  title,
  count,
  detail,
  href,
  cta
}: {
  title: string;
  count: number;
  detail: string;
  href: Route;
  cta: string;
}) {
  return (
    <Link href={href} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/40 hover:bg-blue-950/25">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Supporting system</p>
      <h2 className="mt-2 text-base font-semibold text-white">{title}</h2>
      <p className="mt-3 text-3xl font-semibold text-white">{count}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p>
      <span className="mt-4 inline-flex rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100">{cta}</span>
    </Link>
  );
}

export default async function ActionsPage() {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [tasksResult, issuesResult, checklistsResult, runsResult, assignmentsResult, outcomesResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false })
  ]);

  const tasks = (tasksResult.data || []) as TaskRow[];
  const issues = (issuesResult.data || []) as IssueRow[];
  const checklists = (checklistsResult.data || []) as ChecklistRow[];
  const runs = (runsResult.data || []) as ChecklistRunRow[];
  const assignments = (assignmentsResult.data || []) as AssignmentRow[];
  const outcomes = (outcomesResult.data || []) as RecommendationOutcomeRow[];
  const errors = [tasksResult.error, issuesResult.error, checklistsResult.error, runsResult.error, assignmentsResult.error, outcomesResult.error].filter(Boolean);
  const openTasks = tasks.filter((task) => !isClosed(task.status));
  const overdueTasks = openTasks.filter((task) => isOverdue(task.due_date));
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const openAssignments = assignments.filter((assignment) => !isClosed(assignment.status));
  const overdueAssignments = openAssignments.filter((assignment) => isOverdue(assignment.due_date));
  const openRuns = runs.filter((run) => !isClosed(run.status));
  const acceptedRecommendations = outcomes.filter((outcome) => outcome.status === "assigned" || outcome.status === "accepted");
  const queue: ActionItem[] = [
    ...overdueTasks.slice(0, 4).map((task) => ({
      id: `task-${task.id}`,
      title: task.title,
      source: task.ai_generated ? "Vaeroex source signal" : "Source-system signal",
      status: task.status,
      priority: task.priority,
      why: task.description || "This source-system signal is overdue and needs leadership review.",
      nextStep: "Review whether this signal still matters and decide what leadership should review.",
      href: "/app/tasks" as Route,
      outputType: "action_plan" as const
    })),
    ...openIssues.slice(0, 4).map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue.title,
      source: "Issue / risk",
      status: issue.status,
      priority: issue.severity,
      why: issue.recommended_fix || issue.description || "This risk is open and should be reviewed before it becomes normal.",
      nextStep: issue.recommended_fix || "Generate a risk brief, review evidence, and decide whether leadership needs an improvement plan.",
      href: "/app/issues" as Route,
      outputType: "risk_brief" as const
    })),
    ...overdueAssignments.slice(0, 3).map((assignment) => ({
      id: `assignment-${assignment.id}`,
      title: assignment.title,
      source: assignment.source_title || "Assignment",
      status: assignment.status,
      priority: assignment.priority,
      why: assignment.description || "This source-system responsibility signal is overdue.",
      nextStep: "Generate an improvement plan to clarify what leadership should review.",
      href: "/app/people" as Route,
      outputType: "action_plan" as const
    })),
    ...acceptedRecommendations.slice(0, 3).map((outcome) => ({
      id: `outcome-${outcome.id}`,
      title: outcome.title,
      source: "Saved Vaeroex recommendation",
      status: outcome.status,
      priority: outcome.priority,
      why: outcome.evidence || "This recommendation was saved after review.",
      nextStep: outcome.outcome_summary || "Generate a brief and decide what leadership should review next.",
      href: "/app/tasks" as Route,
      outputType: "action_plan" as const
    }))
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Actions"
        title="Recommended Outputs"
        description="Turn Vaeroex recommendations into improvement plans, risk briefs, checklists, SOPs, meeting agendas, or executive briefings for leadership review."
        actions={
          <Link href="/app/intelligence" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Review Intelligence
          </Link>
        }
      />

      {errors.length ? (
        <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm text-red-100">
          {errors[0]?.message || "Some action data could not be loaded."}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence philosophy</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Actions are outputs, not the product surface.</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
          Vaeroex analyzes source-system signals and produces clear outputs for leadership. It does not replace Salesforce, HubSpot, Monday, ClickUp, Asana, ServiceTitan, Jobber, QuickBooks, NetSuite, or the systems your company already uses to execute.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <ActionSystemCard
          title="Source signals"
          count={openTasks.length}
          detail={`${overdueTasks.length} overdue source-system signal${overdueTasks.length === 1 ? "" : "s"} need review.`}
          href="/app/tasks"
          cta="Open source signals"
        />
        <ActionSystemCard
          title="Issues and risks"
          count={openIssues.length}
          detail="Risk records that may require leadership review or escalation."
          href="/app/issues"
          cta="Open issues"
        />
        <ActionSystemCard
          title="Checklist execution"
          count={openRuns.length || checklists.length}
          detail="Optional execution tools created from repeated recommendations or routines."
          href="/app/checklists"
          cta="Open checklists"
        />
        <ActionSystemCard
          title="Responsibility signals"
          count={openAssignments.length}
          detail={`${overdueAssignments.length} overdue responsibility signal${overdueAssignments.length === 1 ? "" : "s"} across the workspace.`}
          href="/app/people"
          cta="Open responsibility view"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_.65fr]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-100">Action queue</h2>
            <StatusBadge value={`${queue.length} item${queue.length === 1 ? "" : "s"}`} />
          </div>
          <ActionQueue items={queue} />
        </div>

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <h2 className="text-base font-semibold text-white">Generate optional outputs</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Use these to turn a recommendation into a portable document for leadership review.
          </p>
          <div className="mt-4 grid gap-2">
            <Link href={generatedOutputHref({ type: "action_plan" })} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Generate Improvement Plan</Link>
            <Link href={generatedOutputHref({ type: "risk_brief" })} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Generate Risk Brief</Link>
            <Link href={generatedOutputHref({ type: "checklist" })} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Generate Checklist</Link>
            <Link href={generatedOutputHref({ type: "executive_briefing" })} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Generate Executive Briefing</Link>
          </div>
          <details className="mt-4 rounded-lg border border-white/10 bg-slate-950/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-200">Advanced: source record areas</summary>
            <div className="mt-3 grid gap-2">
              <Link href="/app/tasks" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Open source signals</Link>
              <Link href="/app/issues" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Open issues</Link>
              <Link href="/app/checklists" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Open checklists</Link>
              <Link href="/app/briefings" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Open saved briefings</Link>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
