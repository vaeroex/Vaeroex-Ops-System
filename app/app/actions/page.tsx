import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
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
        No active action queue is visible yet. Review Intelligence or add source data so Vaeroex can recommend accountable work.
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
            <span className="font-semibold text-white">Next step:</span> {item.nextStep}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={item.href} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
              Open action source
            </Link>
            <Link href="/app/ask" className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
              Ask Vaeroex
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
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Action system</p>
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
      source: task.ai_generated ? "Vaeroex follow-up" : "Follow-up",
      status: task.status,
      priority: task.priority,
      why: task.description || "This follow-up is overdue and needs ownership review.",
      nextStep: task.assigned_role || task.assigned_to ? "Confirm progress and close or reschedule the follow-up." : "Assign an owner before the next review.",
      href: "/app/tasks" as Route
    })),
    ...openIssues.slice(0, 4).map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue.title,
      source: "Issue / risk",
      status: issue.status,
      priority: issue.severity,
      why: issue.recommended_fix || issue.description || "This risk is open and should be reviewed before it becomes normal.",
      nextStep: issue.assigned_role || issue.assigned_to ? "Confirm owner and target resolution." : "Assign an owner and decide whether a follow-up is needed.",
      href: "/app/issues" as Route
    })),
    ...overdueAssignments.slice(0, 3).map((assignment) => ({
      id: `assignment-${assignment.id}`,
      title: assignment.title,
      source: assignment.source_title || "Assignment",
      status: assignment.status,
      priority: assignment.priority,
      why: assignment.description || "This assignment is overdue.",
      nextStep: "Review the assigned role, due date, and completion status.",
      href: "/app/people" as Route
    })),
    ...acceptedRecommendations.slice(0, 3).map((outcome) => ({
      id: `outcome-${outcome.id}`,
      title: outcome.title,
      source: "Accepted Vaeroex recommendation",
      status: outcome.status,
      priority: outcome.priority,
      why: outcome.evidence || "This recommendation was approved for action.",
      nextStep: outcome.outcome_summary || "Review whether the expected outcome happened.",
      href: "/app/tasks" as Route
    }))
  ].slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Actions"
        title="Accountable Work"
        description="Where reviewed intelligence becomes follow-up, ownership, issue resolution, and repeatable execution. Vaeroex should recommend actions; people approve them."
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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Action philosophy</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Actions are outputs, not the product surface.</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
          Vaeroex keeps follow-ups, issues, checklists, and assignments available, but the leadership flow starts with intelligence and evidence. Create or accept actions only after review.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <ActionSystemCard
          title="Follow-ups"
          count={openTasks.length}
          detail={`${overdueTasks.length} overdue follow-up${overdueTasks.length === 1 ? "" : "s"} need review.`}
          href="/app/tasks"
          cta="Open follow-ups"
        />
        <ActionSystemCard
          title="Issues and risks"
          count={openIssues.length}
          detail="Risk records that may require owner review or escalation."
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
          title="Ownership"
          count={openAssignments.length}
          detail={`${overdueAssignments.length} overdue assignment${overdueAssignments.length === 1 ? "" : "s"} across the workspace.`}
          href="/app/people"
          cta="Open ownership"
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
          <h2 className="text-base font-semibold text-white">Create after review</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Use these supporting systems when leadership has confirmed the recommendation and wants accountable follow-through.
          </p>
          <div className="mt-4 grid gap-2">
            <Link href="/app/tasks" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Create follow-up</Link>
            <Link href="/app/issues" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Log issue</Link>
            <Link href="/app/checklists" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Create checklist</Link>
            <Link href="/app/briefings" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">Generate briefing</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
