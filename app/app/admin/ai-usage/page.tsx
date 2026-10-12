import { AdminUsageDashboard } from "@/components/admin/AdminUsageDashboard";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { getAdminUsageData } from "@/lib/admin/usage-data";
import { adminReportPage, adminReportPeriod, adminWorkspaceFilter } from "@/lib/admin/report-period";

type Props = { searchParams?: Promise<{ range?: string; workspace?: string; page?: string; workspacePage?: string }> };

export default async function AdminAiUsagePage({ searchParams }: Props) {
  const params = await searchParams;
  const access = await getVaeroexAdminAccess();
  if (!access.allowed || !access.admin) return <ErrorNotice message="Vaeroex admin access is required." />;
  const workspace = adminWorkspaceFilter(params?.workspace);
  if (params?.workspace && !workspace) return <ErrorNotice message="Choose a valid workspace for this report." />;
  const period = adminReportPeriod(params?.range);
  const snapshot = await getAdminUsageData({ ...period, workspaceId: workspace || null, page: adminReportPage(params?.page), workspacePage: adminReportPage(params?.workspacePage) });
  return <AdminUsageDashboard snapshot={snapshot} range={period.range} workspace={workspace} />;
}
