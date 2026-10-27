/** Bounded discovery only. A selected date range does not establish coverage or
 * authorize a comparison; admission and source-specific semantics still apply. */
export function vsiEvidenceWindowSelection(question: string, now = new Date()): {
  start: string; end: string; mode: "last_30_days" | "last_and_prior_30_days"; limitation: string;
} {
  const end = now.toISOString().slice(0, 10);
  const priorThirtyComparison = /\blast\s+30\s+days\b/i.test(question)
    && /\b(?:preceding|prior|previous)\s+30\s+days\b/i.test(question)
    && /\b(?:compare|comparison|versus|vs)\b/i.test(question);
  const dayCount = priorThirtyComparison ? 60 : 30;
  const start = new Date(Date.parse(end) - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  return { start, end, mode: priorThirtyComparison ? "last_and_prior_30_days" : "last_30_days",
    limitation: `Stored-source discovery used ${dayCount} UTC calendar days, ${start} through ${end}. Supported selections are the last 30 days, or 60 days for an explicit comparison of the last 30 days with the prior 30 days. Other requested ranges are not searched as stated. This selection window is not a source reporting period, complete history, or proof that source periods align.` };
}

/** Retain the date-only interface for non-runtime callers. The engine also
 * carries the explicit supported-window disclosure into its source context. */
export function vsiEvidenceWindow(question: string, now = new Date()): { start: string; end: string } {
  const { start, end } = vsiEvidenceWindowSelection(question, now);
  return { start, end };
}
