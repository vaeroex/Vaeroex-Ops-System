import type { IntelligenceLifecycleCardV1 } from "@/lib/intelligence/card-lifecycle/contracts";

export function sortIntelligenceLifecycleCardsV1(cards: readonly IntelligenceLifecycleCardV1[]) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 } as const;
  const confidenceRank = { High: 3, Medium: 2, Low: 1 } as const;
  const stateRank = { active: 2, acknowledged: 1, dismissed: 0 } as const;
  return [...cards].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned)
    || stateRank[b.lifecycleState] - stateRank[a.lifecycleState]
    || priorityRank[b.snapshot.priority] - priorityRank[a.snapshot.priority]
    || confidenceRank[b.snapshot.confidence] - confidenceRank[a.snapshot.confidence]
    || b.snapshot.lastUpdated.localeCompare(a.snapshot.lastUpdated)
    || a.findingKeyHash.localeCompare(b.findingKeyHash)
  );
}
