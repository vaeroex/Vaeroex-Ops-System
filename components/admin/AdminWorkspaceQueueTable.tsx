import Link from "next/link";
import type { Route } from "next";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { EmptyState } from "@/components/operations/EmptyState";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { companyAttentionReasons, formatAdminDate, type AdminCompanyRow } from "@/lib/admin/company-directory";

export function AdminWorkspaceQueueTable({
  rows,
  emptyTitle,
  emptyDescription
}: {
  rows: AdminCompanyRow[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!rows.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[900px] w-full divide-y divide-line text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-4 py-3 font-semibold">Workspace</th>
            <th className="px-4 py-3 font-semibold">Operational attention</th>
            <th className="px-4 py-3 font-semibold">Access state</th>
            <th className="px-4 py-3 font-semibold">Agreement</th>
            <th className="px-4 py-3 font-semibold">Last update</th>
            <th className="px-4 py-3 text-right font-semibold">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {rows.map((workspace) => {
            const attention = companyAttentionReasons(workspace);
            const detailHref = `/app/admin/customers/${workspace.workspace_id}?tab=workspace` as Route;

            return (
              <tr key={workspace.workspace_id} data-workspace-row={workspace.workspace_id} className="vaeroex-admin-data-row align-top">
                <td className="px-4 py-4">
                  <Link href={detailHref} className="font-semibold text-ink hover:text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
                    {workspace.company_name}
                  </Link>
                  <p className="mt-1 break-all text-xs text-muted">{workspace.primary_contact_email || "Contact email not set"}</p>
                </td>
                <td className="px-4 py-4">
                  {attention.length ? (
                    <ul className="space-y-1.5 text-xs font-medium text-ink">
                      {attention.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : <span className="text-xs text-muted">No active exception</span>}
                </td>
                <td className="space-y-2 px-4 py-4">
                  <AdminLifecycleBadge value={workspace.lifecycle_status} />
                  <div><StatusBadge value={workspace.subscription_status} /></div>
                </td>
                <td className="px-4 py-4">
                  {workspace.agreement_id ? (
                    <Link
                      href={`/app/admin/workspace-agreements/${workspace.agreement_id}` as Route}
                      className="font-semibold text-vaeroex-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55"
                    >
                      View agreement
                    </Link>
                  ) : <span className="font-medium text-slate-500">No agreement</span>}
                </td>
                <td className="px-4 py-4 text-xs leading-5 text-muted">{formatAdminDate(workspace.workspace_updated_at)}</td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={detailHref}
                    className="inline-flex min-h-10 items-center justify-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
