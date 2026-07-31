import Link from "next/link";
import { AdminEasterEggModeration } from "@/components/easter-egg/AdminEasterEggActivity";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { loadEasterEggAdminState } from "@/lib/easter-egg/data";

export const dynamic = "force-dynamic";

export default async function AdminEasterEggPage() {
  await requireVaeroexAdmin("/app");
  const state = await loadEasterEggAdminState();
  const cards = state.metrics ? [
    ["Participating workspaces", state.metrics.participatingWorkspaces],
    ["Valid runs", state.metrics.validRuns],
    ["Rejected submissions", state.metrics.rejectedRuns],
    ["Highest score", state.metrics.highestScore]
  ] as const : [];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Internal product activity" title="Easter Egg Activity" description="Casual game activity and public workspace-name moderation. This is unrelated to AI Trust, provider health, and business intelligence." actions={<Link href="/app/admin" className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue">Back to Admin</Link>} />
      {state.error ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{state.error}</p> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-lg border border-line bg-white p-4 shadow-panel"><p className="text-sm font-medium text-muted">{label}</p><p className="mt-1 text-3xl font-semibold text-ink">{value.toLocaleString()}</p></div>)}
      </section>
      <SectionCard title="Public display-name moderation" description="A workspace appears publicly only after its owner opts in and Vaeroex approves the selected display name.">
        <AdminEasterEggModeration pending={state.pending} />
      </SectionCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Current public top 10" description="Highest valid score per opted-in workspace. Public output contains no account identifiers.">
          <div className="divide-y divide-line">
            {state.leaderboard.length ? state.leaderboard.map((entry) => <div key={`${entry.leaderboard_position}-${entry.public_display_name}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-3 py-3 text-sm"><span className="font-mono font-semibold">#{entry.score_rank}</span><span className="truncate font-semibold text-ink">{entry.public_display_name}</span><span className="font-mono text-muted">{entry.score.toLocaleString()}</span></div>) : <p className="py-6 text-sm text-muted">No approved public scores.</p>}
          </div>
        </SectionCard>
        <SectionCard title="Recent valid runs" description="Internal operational history. Actor identity is retained in storage but is not displayed here.">
          <div className="divide-y divide-line">
            {state.recent.length ? state.recent.map((run) => <div key={run.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 text-sm"><div><p className="font-semibold text-ink">Score {run.score?.toLocaleString()}</p><p className="mt-1 text-xs text-muted">{run.obstacle_count} obstacles · {Math.round((run.run_duration_ms || 0) / 1000)} seconds</p></div><time className="text-xs text-muted">{run.completed_at ? new Date(run.completed_at).toLocaleString() : "Pending"}</time></div>) : <p className="py-6 text-sm text-muted">No valid game runs.</p>}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
