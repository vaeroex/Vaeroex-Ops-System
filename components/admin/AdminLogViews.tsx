import { EmptyState } from "@/components/operations/EmptyState";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";

export type AdminRunLog = {
  id: string;
  workspace_id: string | null;
  agent_type: string | null;
  status?: string | null;
  error_message?: string | null;
  created_at?: string | null;
};

type WorkspaceNames = Map<string, string>;

function formatDateTime(value?: string | null) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function runLabel(value?: string | null) {
  return value ? value.replace(/_/g, " ") : "Vaeroex run";
}

function workspaceLabel(workspaceNames: WorkspaceNames, workspaceId?: string | null) {
  if (!workspaceId) {
    return "No workspace";
  }

  return workspaceNames.get(workspaceId) || workspaceId;
}

function isNextRedirectMessage(message?: string | null) {
  const value = message || "";

  return value === "NEXT_REDIRECT" || value.includes("NEXT_REDIRECT;");
}

function normalizedErrorMessage(message?: string | null) {
  if (isNextRedirectMessage(message)) {
    return "NEXT_REDIRECT routing event";
  }

  return cleanVaeroexErrorMessage(message || undefined, "Vaeroex run failed.");
}

function shortMessage(message?: string | null, length = 150) {
  const value = normalizedErrorMessage(message).replace(/\s+/g, " ");

  return value.length > length ? `${value.slice(0, length).trim()}...` : value;
}

export function TruncatedLogMessage({
  message,
  tone = "error",
  lines = 2
}: {
  message?: string | null;
  tone?: "error" | "muted";
  lines?: 1 | 2 | 3;
}) {
  const value = normalizedErrorMessage(message);
  const isLong = value.length > 180 || value.includes("\n");
  const color = tone === "error" ? "text-red-700 dark:text-red-200" : "text-muted";
  const lineClamp = lines === 1 ? "line-clamp-1" : lines === 3 ? "line-clamp-3" : "line-clamp-2";

  if (!isLong) {
    return <p className={`text-xs leading-5 ${color}`}>{value}</p>;
  }

  return (
    <details className="group">
      <summary className={`cursor-pointer list-none text-xs leading-5 ${color}`}>
        <span className={lineClamp}>{shortMessage(value, 180)}</span>
        <span className="mt-1 inline-flex text-xs font-semibold text-vaeroex-blue group-open:hidden">View details</span>
        <span className="mt-1 hidden text-xs font-semibold text-vaeroex-blue group-open:inline-flex">Hide details</span>
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {value}
      </pre>
    </details>
  );
}

export function CompactRunTable({
  runs,
  workspaceNames,
  emptyTitle,
  emptyDescription,
  showStatus = true
}: {
  runs: AdminRunLog[];
  workspaceNames: WorkspaceNames;
  emptyTitle: string;
  emptyDescription: string;
  showStatus?: boolean;
}) {
  if (!runs.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-slate-50 dark:bg-slate-950/60">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">Workflow</th>
              <th className="px-3 py-2">Workspace</th>
              {showStatus ? <th className="px-3 py-2">Status</th> : null}
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white dark:bg-slate-950/20">
            {runs.map((run) => (
              <tr key={run.id} className="align-top hover:bg-blue-950/5 dark:hover:bg-blue-950/30">
                <td className="max-w-[180px] px-3 py-3 font-semibold capitalize text-ink">
                  <span className="line-clamp-1">{runLabel(run.agent_type)}</span>
                  <span className="mt-1 block font-mono text-[0.68rem] font-normal text-muted">{run.id.slice(0, 8)}</span>
                </td>
                <td className="max-w-[220px] px-3 py-3 text-muted">
                  <span className="line-clamp-1">{workspaceLabel(workspaceNames, run.workspace_id)}</span>
                </td>
                {showStatus ? (
                  <td className="px-3 py-3">
                    <StatusBadge value={run.status || "unknown"} />
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(run.created_at)}</td>
                <td className="min-w-[220px] px-3 py-3">
                  {run.error_message ? (
                    <TruncatedLogMessage message={run.error_message} />
                  ) : (
                    <span className="text-xs text-muted">No error details</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GroupedErrorRuns({
  runs,
  workspaceNames,
  emptyTitle,
  emptyDescription,
  defaultOpen = false
}: {
  runs: AdminRunLog[];
  workspaceNames: WorkspaceNames;
  emptyTitle: string;
  emptyDescription: string;
  defaultOpen?: boolean;
}) {
  if (!runs.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const groups = new Map<string, AdminRunLog[]>();

  for (const run of runs) {
    const key = normalizedErrorMessage(run.error_message).split("\n")[0].slice(0, 120);
    groups.set(key, [...(groups.get(key) || []), run]);
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([message, groupRuns], index) => {
        const latestRun = groupRuns[0];
        const isRedirectGroup = isNextRedirectMessage(latestRun?.error_message);

        return (
          <details
            key={`${message}-${index}`}
            open={defaultOpen && index === 0}
            className="rounded-lg border border-line bg-white p-3 dark:bg-slate-950/20"
          >
            <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{isRedirectGroup ? "Grouped NEXT_REDIRECT routing events" : shortMessage(message, 100)}</p>
                <p className="mt-1 text-xs text-muted">
                  {groupRuns.length} occurrence{groupRuns.length === 1 ? "" : "s"} · latest {formatDateTime(latestRun?.created_at)}
                </p>
              </div>
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">View details</span>
            </summary>
            <div className="mt-3">
              <CompactRunTable
                runs={groupRuns.slice(0, 8)}
                workspaceNames={workspaceNames}
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
                showStatus={false}
              />
              {groupRuns.length > 8 ? (
                <p className="mt-2 text-xs text-muted">Showing 8 of {groupRuns.length} matching errors in this group.</p>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}
