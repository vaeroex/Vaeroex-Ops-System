import Link from "next/link";
import type { Route } from "next";
import type { AdminWorkspaceFilters as FilterValues, AdminWorkspaceView } from "@/lib/admin/company-directory";

const views: Array<{ value: AdminWorkspaceView; label: string }> = [
  { value: "attention", label: "Needs attention" },
  { value: "pending_activation", label: "Pending activation" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All workspaces" }
];

function viewHref(filters: FilterValues, view: AdminWorkspaceView) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (view !== "attention") params.set("view", view);
  if (filters.sort !== "updated_desc") params.set("sort", filters.sort);
  const query = params.toString();
  return `/app/admin/workspaces${query ? `?${query}` : ""}` as Route;
}

export function AdminWorkspaceFilters({ filters }: { filters: FilterValues }) {
  return (
    <div className="space-y-3">
      <nav aria-label="Workspace queue filters" className="vaeroex-mobile-safe-scroll flex gap-1 overflow-x-auto border-b border-line pb-px">
        {views.map((view) => {
          const active = filters.view === view.value;
          return (
            <Link
              key={view.value}
              href={viewHref(filters, view.value)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55 ${active ? "border-vaeroex-blue text-vaeroex-blue" : "border-transparent text-muted hover:border-vaeroex-accent/45 hover:text-ink"}`}
            >
              {view.label}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-panel lg:grid-cols-[minmax(240px,1fr)_minmax(180px,auto)_auto_auto] lg:items-end">
        <input type="hidden" name="view" value={filters.view} />
        <label className="text-sm font-medium text-ink">
          Workspace or contact
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Search workspace or email"
            className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2 outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-accent/20"
          />
        </label>
        <label className="text-sm font-medium text-ink">
          Sort
          <select name="sort" defaultValue={filters.sort} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
            <option value="updated_desc">Recently updated</option>
            <option value="created_desc">Recently created</option>
            <option value="company_asc">Workspace A-Z</option>
            <option value="company_desc">Workspace Z-A</option>
          </select>
        </label>
        <button className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
          Apply
        </button>
        <Link href="/app/admin/workspaces" className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
          Clear
        </Link>
      </form>
    </div>
  );
}
