/** Bounded discovery only. A selected date range does not establish coverage or
 * authorize a comparison; admission and source-specific semantics still apply. */
export function vsiEvidenceWindow(question: string, now = new Date()): { start: string; end: string } {
  const end = now.toISOString().slice(0, 10);
  const priorThirtyComparison = /\blast\s+30\s+days\b/i.test(question)
    && /\b(?:preceding|prior|previous)\s+30\s+days\b/i.test(question)
    && /\b(?:compare|comparison|versus|vs)\b/i.test(question);
  const dayCount = priorThirtyComparison ? 60 : 30;
  return { start: new Date(Date.parse(end) - (dayCount - 1) * 86400000).toISOString().slice(0, 10), end };
}
