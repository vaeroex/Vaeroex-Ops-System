import { AdminWorkspaceFilters } from "@/components/admin/AdminWorkspaceFilters";
import { AdminWorkspacePagination } from "@/components/admin/AdminWorkspacePagination";
import { AdminWorkspaceQueueTable } from "@/components/admin/AdminWorkspaceQueueTable";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { loadAdminWorkspacePage, parseAdminWorkspaceFilters, type AdminWorkspaceView } from "@/lib/admin/company-directory";

type AdminWorkspacesPageProps = {
  searchParams?: Promise<Record<string, string | undefined>>;
};

export default async function AdminWorkspacesPage({ searchParams }: AdminWorkspacesPageProps) {
  const params = (await searchParams) || {};
  const filters = parseAdminWorkspaceFilters(params);
  const { admin } = await requireVaeroexAdmin("/app");
  const workspacePage = await loadAdminWorkspacePage(admin, filters);
  const sectionCopy: Record<AdminWorkspaceView, { title: string; description: string; emptyTitle: string; empty: string }> = {
    attention: {
      title: "Workspaces needing attention",
      description: "Activation, access, agreement, and lifecycle exceptions that require an operational decision.",
      emptyTitle: "No workspace exceptions",
      empty: "No current workspace requires operational attention."
    },
    pending_activation: {
      title: "Pending activation",
      description: "Workspaces waiting for an approved subscription or manual activation decision.",
      emptyTitle: "No pending activations",
      empty: "No workspace is waiting for activation."
    },
    inactive: {
      title: "Inactive workspaces",
      description: "Workspaces whose current access state does not permit normal use.",
      emptyTitle: "No inactive workspaces",
      empty: "No inactive workspace matches the current search."
    },
    archived: {
      title: "Archived workspaces",
      description: "Archived workspaces appear only in this intentional lifecycle view and may be restored from their company record.",
      emptyTitle: "No archived workspaces",
      empty: "No archived workspace matches the current search."
    },
    all: {
      title: "All workspaces",
      description: "The complete operational index, including active workspaces without exceptions and archived records.",
      emptyTitle: "No workspaces found",
      empty: "No workspace matches the current search."
    }
  };
  const section = sectionCopy[filters.view];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Workspaces"
        description="Resolve activation, access, agreement, and lifecycle exceptions. Normal active companies remain in Customers and appear here only through All workspaces."
      />
      {params.message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</p> : null}
      <ErrorNotice message={params.error || (workspacePage.error ? "The workspace index could not be loaded." : null)} />
      <AdminWorkspaceFilters filters={filters} />

      <SectionCard title={section.title} description={section.description}>
        <AdminWorkspaceQueueTable rows={workspacePage.rows} emptyTitle={section.emptyTitle} emptyDescription={section.empty} />
        <AdminWorkspacePagination filters={filters} total={workspacePage.count} />
      </SectionCard>
    </div>
  );
}
