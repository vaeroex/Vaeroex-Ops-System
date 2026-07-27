import Link from "next/link";
import type { Route } from "next";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { EmptyState } from "@/components/operations/EmptyState";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { companyAttentionReasons, formatAdminDate, type AdminCompanyRow } from "@/lib/admin/company-directory";
import { displayPlanName } from "@/lib/billing/plans";

export function AdminCompanyTable({ rows, emptyDescription }: { rows: AdminCompanyRow[]; emptyDescription: string }) {
  if (!rows.length) {
    return <EmptyState title="No companies found" description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1120px] w-full divide-y divide-line text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-4 py-3 font-semibold">Company</th>
            <th className="px-4 py-3 font-semibold">Primary contact</th>
            <th className="px-4 py-3 font-semibold">Lifecycle</th>
            <th className="px-4 py-3 font-semibold">Subscription</th>
            <th className="px-4 py-3 font-semibold">Agreement</th>
            <th className="px-4 py-3 font-semibold">Last workspace update</th>
            <th className="px-4 py-3 font-semibold">Attention</th>
            <th className="px-4 py-3 text-right font-semibold">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {rows.map((company) => {
            const attention = companyAttentionReasons(company);
            const detailHref = `/app/admin/customers/${company.workspace_id}` as Route;

            return (
              <tr key={company.workspace_id} data-company-row={company.workspace_id} className="vaeroex-admin-data-row align-top">
                <td className="px-4 py-4">
                  <Link href={detailHref} className="font-semibold text-ink hover:text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">{company.company_name}</Link>
                  <p className="mt-1 text-xs text-muted">{company.industry || "Industry not set"}</p>
                  {company.legacy_access_kind ? <p className="mt-2 text-xs font-medium text-slate-500">Legacy {company.legacy_access_kind} compatibility</p> : null}
                </td>
                <td className="px-4 py-4">
                  <p className="text-ink">{company.primary_contact_name || "Name not set"}</p>
                  <p className="mt-1 break-all text-xs text-muted">{company.primary_contact_email || "Email not set"}</p>
                </td>
                <td className="px-4 py-4"><AdminLifecycleBadge value={company.lifecycle_status} /></td>
                <td className="px-4 py-4">
                  <StatusBadge value={company.subscription_status} />
                  <p className="mt-2 text-xs text-muted">{displayPlanName(company.subscription_plan_slug)}{company.billing_provider ? ` · ${company.billing_provider}` : ""}</p>
                </td>
                <td className="px-4 py-4">
                  {company.agreement_id ? (
                    <Link href={`/app/admin/workspace-agreements/${company.agreement_id}` as Route} className="font-semibold text-vaeroex-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">View agreement</Link>
                  ) : <span className="font-medium text-slate-500">No agreement</span>}
                </td>
                <td className="px-4 py-4 text-xs leading-5 text-muted">{formatAdminDate(company.workspace_updated_at)}</td>
                <td className="px-4 py-4">
                  {attention.length ? (
                    <ul className="space-y-1 text-xs text-amber-900">
                      {attention.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : <span className="text-xs text-slate-500">None</span>}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link href={detailHref} className="inline-flex min-h-10 items-center justify-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">
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
