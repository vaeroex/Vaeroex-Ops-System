import { calculateFinancials, type FinancialReport } from "@/lib/vsi/financial-calculations";

/** Read-only reported measurements. Never canonical transaction contributions,
 * independent original sources, performance targets or a Business Health input. */
export function reportedFinancialMetrics(reports: readonly FinancialReport[]) {
  const groups = new Map<string, FinancialReport[]>();
  for (const report of reports) {
    const key = JSON.stringify([report.connectionId, report.entity, report.currency, report.basis]);
    groups.set(key, [...(groups.get(key) || []), report]);
  }
  return [...groups.values()].map(group => ({
    authority: "reported_nonadditive" as const,
    reports: group,
    calculations: calculateFinancials(group),
    originalEvidenceEligible: false as const,
    coverage: "unknown" as const
  }));
}
