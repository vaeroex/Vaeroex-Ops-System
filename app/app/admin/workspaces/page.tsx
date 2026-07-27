import { AdminCompanyFilters } from "@/components/admin/AdminCompanyFilters";
import { AdminCompanyTable } from "@/components/admin/AdminCompanyTable";
import { AdminPagination } from "@/components/admin/AdminPagination";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { loadAdminCompanyPage, parseAdminCompanyFilters } from "@/lib/admin/company-directory";

type AdminWorkspacesPageProps = {
  searchParams?: Promise<Record<string, string | undefined>>;
};

export default async function AdminWorkspacesPage({ searchParams }: AdminWorkspacesPageProps) {
  const params = (await searchParams) || {};
  const filters = parseAdminCompanyFilters(params);
  const { admin } = await requireVaeroexAdmin("/app");
  const companyPage = await loadAdminCompanyPage(admin, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Workspaces"
        description="Review workspace access and lifecycle at a glance. Detailed access, archive, and restore controls live in each company record."
      />
      {params.message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</p> : null}
      <ErrorNotice message={params.error || (companyPage.error ? "The workspace index could not be loaded." : null)} />
      <AdminCompanyFilters basePath="/app/admin/workspaces" filters={filters} compact />

      <SectionCard title="Workspace lifecycle index" description="Archived workspaces are excluded by default and remain available through the Archived filter.">
        <AdminCompanyTable rows={companyPage.rows} emptyDescription="No workspaces match the current lifecycle search." />
        <AdminPagination basePath="/app/admin/workspaces" filters={filters} total={companyPage.count} />
      </SectionCard>
    </div>
  );
}
