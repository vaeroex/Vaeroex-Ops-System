import "server-only";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { retrieveFinancialEvidence } from "@/lib/vsi/financial-evidence";
import { reportedFinancialMetrics } from "./reported-financial-metrics";
import { loadQboJournalPeriod, type QboJournalPeriod } from "./journal-accounting";

export async function loadReportedFinancialMetrics() {
  const access = await requireWorkspaceAccess();
  if (access.membership.role !== "owner") return { groups: [], limitations: [] };
  const evidence = await retrieveFinancialEvidence(access, new Date().toISOString());
  const journals: QboJournalPeriod[] = [];
  for (const report of evidence.reports.slice(0, 4)) {
    if (!report.periodStart || !report.periodEnd) continue;
    const result = await loadQboJournalPeriod(access, { connectionId: report.connectionId,
      periodStart: report.periodStart, periodEnd: report.periodEnd }).catch(() => null);
    if (result?.state === "available" && !journals.some(p => p.receiptHash === result.data.receiptHash)) journals.push(result.data);
  }
  return { groups: reportedFinancialMetrics(evidence.reports), limitations: evidence.limitations, journals };
}
