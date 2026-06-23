import Link from "next/link";
import type { Route } from "next";
import { CompactRunTable, GroupedErrorRuns, type AdminRunLog } from "@/components/admin/AdminLogViews";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";

type AdminAiUsagePageProps = {
  searchParams?: Promise<{ filter?: string; limit?: string; usage?: string; error?: string }>;
};

const runFilters = [
  { key: "", label: "All runs" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "file_analysis", label: "File analysis" },
  { key: "ask_vaeroex", label: "Ask Vaeroex" },
  { key: "operations_audit", label: "Operations audit" }
];

function parseLimit(value: string | undefined, fallback: number, maximum = 50) {
  const parsed = Number.parseInt(value || "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, fallback), maximum);
}

function filterHref(filter: string, limit: number): Route {
  const params = new URLSearchParams();

  if (filter) {
    params.set("filter", filter);
  }

  if (limit !== 10) {
    params.set("limit", String(limit));
  }

  const query = params.toString();

  return `/app/admin/ai-usage${query ? `?${query}` : ""}` as Route;
}

function matchesRunFilter(run: AdminRunLog, filter: string) {
  const agentType = (run.agent_type || "").toLowerCase();
  const status = (run.status || "").toLowerCase();

  if (!filter) return true;
  if (filter === "completed") return status === "completed";
  if (filter === "failed") return status === "failed";
  if (filter === "file_analysis") return agentType.includes("file_analysis");
  if (filter === "ask_vaeroex") return agentType.includes("ask") || agentType.includes("chat") || agentType.includes("general");
  if (filter === "operations_audit") return agentType.includes("operations_audit") || agentType.includes("audit");

  return true;
}

export default async function AdminAiUsagePage({ searchParams }: AdminAiUsagePageProps) {
  const params = await searchParams;
  const activeFilter = params?.filter || "";
  const runLimit = parseLimit(params?.limit, 10);
  const showAllUsage = params?.usage === "all";
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: usage }, { data: runs }, { data: workspaces }, { data: failedRuns }] = await Promise.all([
    access.admin.from("ai_usage").select("*").gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }).limit(200),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,status,error_message,created_at").order("created_at", { ascending: false }).limit(100),
    access.admin.from("workspaces").select("id,name").limit(500),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(25)
  ]);

  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));
  const usageByWorkspace = new Map<string, { runs: number; tokens: number; cost: number }>();
  const allRuns = (runs || []) as AdminRunLog[];
  const allFailedRuns = (failedRuns || []).map((run) => ({ ...run, status: "failed" })) as AdminRunLog[];

  for (const row of usage || []) {
    const key = row.workspace_id || "No workspace";
    const current = usageByWorkspace.get(key) || { runs: 0, tokens: 0, cost: 0 };
    usageByWorkspace.set(key, {
      runs: current.runs + 1,
      tokens: current.tokens + row.tokens_used,
      cost: current.cost + row.estimated_cost_cents
    });
  }

  const usageRows = [...usageByWorkspace.entries()].sort((a, b) => b[1].runs - a[1].runs);
  const visibleUsageRows = showAllUsage ? usageRows : usageRows.slice(0, 10);
  const filteredRuns = allRuns.filter((run) => matchesRunFilter(run, activeFilter));
  const visibleRuns = filteredRuns.slice(0, runLimit);
  const completedCount = allRuns.filter((run) => run.status === "completed").length;
  const failedCount = allRuns.filter((run) => run.status === "failed").length;
  const fileAnalysisCount = allRuns.filter((run) => matchesRunFilter(run, "file_analysis")).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Vaeroex usage"
        description="Review monthly Vaeroex run usage, recent run history, and failed run errors."
      />
      <ErrorNotice message={params?.error} />

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Usage rows this month</p>
          <p className="mt-2 text-3xl font-semibold">{usage?.length || 0}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Completed runs</p>
          <p className="mt-2 text-3xl font-semibold">{completedCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Failed runs</p>
          <p className="mt-2 text-3xl font-semibold">{failedCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">File analyses</p>
          <p className="mt-2 text-3xl font-semibold">{fileAnalysisCount}</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <SectionCard title="Monthly usage by workspace" description="Top workspace usage this month. Expand only when you need the longer list.">
          {visibleUsageRows.length ? (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Workspace</th>
                    <th className="px-3 py-2">Runs</th>
                    <th className="px-3 py-2">Tokens</th>
                    <th className="px-3 py-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleUsageRows.map(([workspaceId, totals]) => (
                    <tr key={workspaceId} className="hover:bg-blue-950/5">
                      <td className="max-w-[240px] px-3 py-3">
                        <p className="line-clamp-1 font-semibold text-ink">{workspaceName.get(workspaceId) || workspaceId}</p>
                        <p className="mt-1 line-clamp-1 font-mono text-[0.68rem] text-muted">{workspaceId}</p>
                      </td>
                      <td className="px-3 py-3 text-muted">{totals.runs}</td>
                      <td className="px-3 py-3 text-muted">{totals.tokens.toLocaleString()}</td>
                      <td className="px-3 py-3 text-muted">${(totals.cost / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No usage this month" description="Vaeroex usage rows will appear after customers run workflows." />
          )}
          {usageRows.length > visibleUsageRows.length ? (
            <Link href="/app/admin/ai-usage?usage=all" className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
              Show all workspace usage
            </Link>
          ) : showAllUsage && usageRows.length > 10 ? (
            <Link href="/app/admin/ai-usage" className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
              Show fewer workspace rows
            </Link>
          ) : null}
        </SectionCard>

        <SectionCard title="Recent Vaeroex runs" description="Filtered, compact run history. Details stay collapsed until needed.">
          <div className="mb-4 flex flex-wrap gap-2">
            {runFilters.map((filter) => (
              <Link
                key={filter.key || "all"}
                href={filterHref(filter.key, 10)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  activeFilter === filter.key
                    ? "border-vaeroex-blue bg-vaeroex-blue text-white"
                    : "border-line bg-white text-slate-700 hover:border-vaeroex-accent hover:text-vaeroex-blue"
                }`}
              >
                {filter.label}
              </Link>
            ))}
          </div>
          <CompactRunTable
            runs={visibleRuns}
            workspaceNames={workspaceName}
            emptyTitle="No Vaeroex runs"
            emptyDescription="Recent runs matching this filter will appear here."
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <p>
              Showing {visibleRuns.length} of {filteredRuns.length} matching runs.
            </p>
            {filteredRuns.length > visibleRuns.length ? (
              <Link href={filterHref(activeFilter, Math.min(runLimit + 10, 50))} className="font-semibold text-vaeroex-blue">
                Show more
              </Link>
            ) : runLimit > 10 ? (
              <Link href={filterHref(activeFilter, 10)} className="font-semibold text-vaeroex-blue">
                Show fewer
              </Link>
            ) : null}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Recent failures" description="Failed runs are grouped by error so repeated routing noise does not dominate the page. Open a group only when investigating.">
        <GroupedErrorRuns
          runs={allFailedRuns}
          workspaceNames={workspaceName}
          emptyTitle="No failed runs"
          emptyDescription="Failed Vaeroex run details will appear here."
        />
      </SectionCard>
    </div>
  );
}
