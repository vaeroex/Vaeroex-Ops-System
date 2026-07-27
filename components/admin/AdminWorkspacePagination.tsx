import Link from "next/link";
import type { Route } from "next";
import { ADMIN_COMPANY_PAGE_SIZE, companyPageCount, type AdminWorkspaceFilters } from "@/lib/admin/company-directory";

function pageHref(filters: AdminWorkspaceFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.view !== "attention") params.set("view", filters.view);
  if (filters.sort !== "updated_desc") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/app/admin/workspaces${query ? `?${query}` : ""}` as Route;
}

export function AdminWorkspacePagination({ filters, total }: { filters: AdminWorkspaceFilters; total: number }) {
  const totalPages = companyPageCount(total);
  const currentPage = Math.min(filters.page, totalPages);
  const first = total ? (currentPage - 1) * ADMIN_COMPANY_PAGE_SIZE + 1 : 0;
  const last = Math.min(currentPage * ADMIN_COMPANY_PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted">Showing {first}-{last} of {total}</p>
      <div className="flex items-center gap-2">
        {currentPage > 1 ? (
          <Link href={pageHref(filters, currentPage - 1)} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
            Previous
          </Link>
        ) : <span className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-slate-400">Previous</span>}
        <span className="px-2 font-medium">Page {currentPage} of {totalPages}</span>
        {currentPage < totalPages ? (
          <Link href={pageHref(filters, currentPage + 1)} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
            Next
          </Link>
        ) : <span className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 text-slate-400">Next</span>}
      </div>
    </div>
  );
}
