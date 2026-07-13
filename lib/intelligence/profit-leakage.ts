export type LeakageLifecycle = "Candidate" | "Supported" | "Confirmed" | "Resolved" | "Archived";

export type LeakageCalculation = {
  id: string;
  category: "Subscription waste" | "Overdue receivables";
  sourceIds: string[];
  lifecycle: LeakageLifecycle;
  paidSeats?: number;
  activeSeats?: number;
  unitCost?: number;
  invoiceTotal?: number;
  paidAmount?: number;
  pastDue?: boolean;
  disputed?: boolean;
  period?: { start: string; end: string };
  confidence?: "High" | "Medium" | "Low";
  assumptions?: string[];
  exclusions?: string[];
};

export type LeakageFinding = LeakageCalculation & {
  amount: number | null;
  eligible: boolean;
  reason: string;
  formula: string;
};

export function calculateProfitLeakage(calculations: LeakageCalculation[], eligibleSourceIds: Set<string>) {
  const seen = new Set<string>();
  const findings: LeakageFinding[] = calculations.map((calculation) => {
    const sourceEligible = calculation.sourceIds.length > 0 && calculation.sourceIds.every((id) => eligibleSourceIds.has(id));
    const fingerprint = `${calculation.category}:${[...calculation.sourceIds].sort().join(",")}`;
    const duplicate = seen.has(fingerprint);
    seen.add(fingerprint);

    let amount: number | null = null;
    let formula = "Required structured values are not available.";
    if (calculation.category === "Subscription waste" && calculation.paidSeats !== undefined && calculation.activeSeats !== undefined && calculation.unitCost !== undefined) {
      amount = Math.max(0, calculation.paidSeats - calculation.activeSeats) * Math.max(0, calculation.unitCost);
      formula = `(paid seats ${calculation.paidSeats} - active seats ${calculation.activeSeats}) × unit cost ${calculation.unitCost}`;
    }
    if (calculation.category === "Overdue receivables" && calculation.invoiceTotal !== undefined && calculation.paidAmount !== undefined && calculation.pastDue && !calculation.disputed) {
      amount = Math.max(0, calculation.invoiceTotal - calculation.paidAmount);
      formula = `invoice total ${calculation.invoiceTotal} - paid amount ${calculation.paidAmount}`;
    }

    const eligible = sourceEligible && !duplicate && amount !== null && ["Supported", "Confirmed"].includes(calculation.lifecycle);
    return {
      ...calculation,
      amount: eligible ? amount : null,
      eligible,
      formula,
      reason: duplicate
        ? "Duplicate source calculation excluded."
        : !sourceEligible
          ? "Eligible original source evidence is required."
          : amount === null
            ? "Required structured values are missing."
            : !["Supported", "Confirmed"].includes(calculation.lifecycle)
              ? "Candidate findings are not included in totals."
              : "Supported by eligible original evidence."
    };
  });

  return {
    findings,
    supportedTotal: findings.filter((item) => item.eligible && item.lifecycle === "Supported").reduce((sum, item) => sum + (item.amount || 0), 0),
    confirmedTotal: findings.filter((item) => item.eligible && item.lifecycle === "Confirmed").reduce((sum, item) => sum + (item.amount || 0), 0)
  };
}
