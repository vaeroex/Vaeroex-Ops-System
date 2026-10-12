import "server-only";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { decodeAdminUsageSnapshot, emptyAdminUsageSnapshot, type AdminUsageSnapshot, type AdminUsageInput } from "@/lib/admin/usage-metrics";
import { getWorkspaceTokenBudget } from "@/lib/ai/usage";
import { getVsiConfig } from "@/lib/vsi/config";

/** The guard runs here, not just in the page: no unguarded reusable admin reader. */
export async function getAdminUsageData(input: AdminUsageInput): Promise<AdminUsageSnapshot> {
  const access = await getVaeroexAdminAccess();
  if (!access.allowed || !access.admin) return emptyAdminUsageSnapshot(input, "Vaeroex admin access is required.");
  const start = new Date(input.start), end = new Date(input.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 93 * 86400000
    || (input.workspaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.workspaceId))) {
    return emptyAdminUsageSnapshot(input, "Choose a valid reporting period and workspace.");
  }
  try {
    // RPC returns only explicitly assembled scalar telemetry and bounded pages.
    // It never returns metadata_json, usage_json, transcript or provider payloads.
    const { data, error } = await access.admin.rpc("admin_usage_snapshot_v1", {
      p_start: start.toISOString(), p_end: end.toISOString(), p_workspace_id: input.workspaceId || null,
      p_page: Math.max(1, Math.min(100000, Math.trunc(input.page || 1))), p_page_size: 25, p_workspace_page: Math.max(1, Math.min(100000, Math.trunc(input.workspacePage || 1)))
    });
    if (error || !data) return emptyAdminUsageSnapshot(input, "Usage telemetry is unavailable. No zero-spend conclusion can be drawn.");
    return decodeAdminUsageSnapshot(data, input, { monthlyTokenBudget: getWorkspaceTokenBudget().monthlyTokens, monthlyVsiBudgetUsd: getVsiConfig().workspaceMonthlyBudgetUsd });
  } catch {
    return emptyAdminUsageSnapshot(input, "Usage telemetry is unavailable. No zero-spend conclusion can be drawn.");
  }
}
