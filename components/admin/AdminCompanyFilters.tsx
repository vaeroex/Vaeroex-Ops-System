import Link from "next/link";
import type { Route } from "next";
import type { AdminCompanyFilters as FilterValues } from "@/lib/admin/company-directory";

export function AdminCompanyFilters({
  basePath,
  filters,
  compact = false
}: {
  basePath: Route;
  filters: FilterValues;
  compact?: boolean;
}) {
  return (
    <form method="get" className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-panel lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(145px,auto))_minmax(150px,auto)_auto_auto] lg:items-end">
      <label className="text-sm font-medium text-ink">
        Company or contact
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Search company or email"
          className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2 outline-none focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-accent/20"
        />
      </label>
      <label className="text-sm font-medium text-ink">
        Lifecycle
        <select name="lifecycle" defaultValue={filters.lifecycle} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          <option value="current">Current companies</option>
          <option value="active">Active</option>
          <option value="pending_activation">Pending activation</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      {!compact ? (
        <label className="text-sm font-medium text-ink">
          Subscription
          <select name="subscription" defaultValue={filters.subscription} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="all">All subscriptions</option>
            <option value="active">Active</option>
            <option value="manual_review">Manual review</option>
            <option value="past_due">Past due</option>
            <option value="unpaid">Unpaid</option>
            <option value="incomplete">Incomplete</option>
            <option value="canceled">Canceled</option>
            <option value="expired">Expired</option>
          </select>
        </label>
      ) : <input type="hidden" name="subscription" value={filters.subscription} />}
      {!compact ? (
        <label className="text-sm font-medium text-ink">
          Agreement
          <select name="agreement" defaultValue={filters.agreement} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="all">All agreements</option>
            <option value="signed">Signed</option>
            <option value="missing">Missing</option>
          </select>
        </label>
      ) : <input type="hidden" name="agreement" value={filters.agreement} />}
      <label className="text-sm font-medium text-ink">
        Sort
        <select name="sort" defaultValue={filters.sort} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          <option value="company_asc">Company A-Z</option>
          <option value="company_desc">Company Z-A</option>
          <option value="updated_desc">Recently updated</option>
          <option value="created_desc">Recently created</option>
        </select>
      </label>
      <button className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
        Apply
      </button>
      <Link href={basePath} className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue">
        Clear
      </Link>
    </form>
  );
}
