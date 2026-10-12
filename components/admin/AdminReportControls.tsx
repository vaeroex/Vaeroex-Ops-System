import type { ReactNode } from "react";

const ranges = [["month", "This month (UTC)"], ["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["all", "All recorded history"]] as const;

export function AdminReportControls({ action, range, workspace, workspaces, children, allowAll = true }: {
  action: string; range: string; workspace: string; workspaces: readonly { id: string; name: string }[]; children?: ReactNode; allowAll?: boolean;
}) {
  return <form action={action} method="get" className={`grid min-w-0 grid-cols-1 items-end gap-3 rounded-xl border border-line bg-white p-3 dark:bg-slate-950/30 sm:grid-cols-2 ${children ? "lg:grid-cols-4" : "lg:grid-cols-[1fr_2fr_auto]"}`} aria-label="Report filters">
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted">Period
      <select name="range" defaultValue={range} className="min-h-10 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-sm text-ink dark:bg-slate-950">{ranges.filter(([key]) => allowAll || key !== "all").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </label>
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted">Admin scope
      <select name="workspace" defaultValue={workspace} className="min-h-10 w-full min-w-0 max-w-full rounded-lg border border-line bg-white px-3 text-sm text-ink dark:bg-slate-950">
        <option value="">All workspaces · platform-wide</option>
        {workspace && !workspaces.some((item) => item.id === workspace) ? <option value={workspace}>Selected workspace · {workspace}</option> : null}
        {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {children}
    <button type="submit" className="min-h-10 rounded-lg bg-vaeroex-blue px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Apply filters</button>
  </form>;
}
