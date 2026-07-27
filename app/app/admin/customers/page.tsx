import Link from "next/link";
import type { Route } from "next";
import { AdminCompanyFilters } from "@/components/admin/AdminCompanyFilters";
import { AdminCompanyTable } from "@/components/admin/AdminCompanyTable";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import {
  formatAdminDate,
  loadAdminCompanyPage,
  parseAdminCompanyFilters,
  quotedPostgrestValue,
  type AdminUnlinkedRecord
} from "@/lib/admin/company-directory";

type AdminCustomersPageProps = {
  searchParams?: Promise<Record<string, string | undefined>>;
};

export default async function AdminCustomersPage({ searchParams }: AdminCustomersPageProps) {
  const params = (await searchParams) || {};
  const filters = parseAdminCompanyFilters(params);
  const { admin } = await requireVaeroexAdmin("/app");
  const companyPage = await loadAdminCompanyPage(admin, filters);

  let unlinkedQuery = admin
    .from("admin_unlinked_customer_records_v1")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);

  if (filters.q) {
    const pattern = quotedPostgrestValue(`*${filters.q}*`);
    unlinkedQuery = unlinkedQuery.or(`display_name.ilike.${pattern},contact_email.ilike.${pattern}`);
  }

  const unlinked = await unlinkedQuery;
  const unlinkedRows = (unlinked.data || []) as AdminUnlinkedRecord[];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Customers"
        description="Manage one company per workspace, with contact, lifecycle, subscription, and agreement status in one directory."
      />
      <ErrorNotice message={params.error || (companyPage.error ? "The company directory could not be loaded." : null)} />
      <AdminCompanyFilters basePath="/app/admin/customers" filters={filters} />

      <SectionCard title="Company directory" description="Company names are the primary identity. Contact email remains supporting information.">
        <AdminCompanyTable rows={companyPage.rows} emptyDescription="No companies match the current search and filters." />
        <AdminPagination basePath="/app/admin/customers" filters={filters} total={companyPage.count} />
      </SectionCard>

      <SectionCard
        title="Unlinked customer records"
        description="Profiles, subscriptions, and activation requests not represented as separate company rows remain available for investigation."
      >
        {unlinked.error ? <ErrorNotice message="Unlinked customer records could not be loaded." /> : null}
        <div className="divide-y divide-line">
          {unlinkedRows.length ? unlinkedRows.map((record) => (
            <article key={`${record.record_type}:${record.record_id}`} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{record.display_name}</p>
                <p className="mt-1 break-all text-xs text-muted">{record.contact_email || "No email"} · {formatAdminDate(record.created_at)}</p>
              </div>
              <StatusBadge value={record.status} />
              {record.record_type === "activation_request" ? (
                <Link href="/app/admin/subscriptions" className="text-sm font-semibold text-vaeroex-blue hover:underline">Review activation</Link>
              ) : <span className="text-xs font-medium text-slate-500">{record.record_type.replace("_", " ")}</span>}
            </article>
          )) : <EmptyState title="No unlinked records" description="No unlinked customer records match the current search." />}
        </div>
      </SectionCard>
    </div>
  );
}
