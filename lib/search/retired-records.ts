import type { GlobalSearchGroup } from "./types";

// Exact source identities, never customer title/content matching. Retained rows
// and derived indexes stay intact; retired records cannot become search results.
export function isRetiredSearchSource(source: string | null | undefined) {
  const normalized = (source || "").toLowerCase().trim().replace(/[ -]+/g, "_");
  return ["decision", "decisions", "decision_journal", "business_decision", "business_decisions",
    "assignment", "assignments", "operational_assignment", "operational_assignments", "review_signal",
    "record_share", "record_shares", "internal_share_records"].includes(normalized);
}

// Also reject responses from an older deployment/cache at the command palette
// boundary. Only explicit retired identities/anchors are removed.
export function visibleSearchGroups(groups: GlobalSearchGroup[]): GlobalSearchGroup[] {
  return groups.filter(group => (group.label as string) !== "Review Signals").map(group => ({
    ...group,
    results: group.results.filter(result => !isRetiredSearchSource(result.sourceType)
      && !/#(?:decision-journal|leadership-decisions)(?:$|[?&])/.test(result.href))
  })).filter(group => group.results.length > 0);
}
