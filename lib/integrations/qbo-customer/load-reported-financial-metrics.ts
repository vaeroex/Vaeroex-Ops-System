import "server-only";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { retrieveFinancialEvidence } from "@/lib/vsi/financial-evidence";
import { reportedFinancialMetrics } from "./reported-financial-metrics";

export async function loadReportedFinancialMetrics() {
  const access = await requireWorkspaceAccess();
  if (access.membership.role !== "owner") return { groups: [], limitations: [] };
  const evidence = await retrieveFinancialEvidence(access, new Date().toISOString());
  return { groups: reportedFinancialMetrics(evidence.reports), limitations: evidence.limitations };
}
