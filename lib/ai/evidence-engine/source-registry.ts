import {
  SOURCE_REGISTRY_VERSION,
  type EvidenceCandidate,
  type SourceRegistry,
  type SourceRegistryEntry
} from "@/lib/ai/evidence-engine/contracts";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

type MutableSourceRegistryEntry = {
  -readonly [Key in keyof Omit<SourceRegistryEntry, "candidateIds">]: Omit<SourceRegistryEntry, "candidateIds">[Key];
} & { candidateIds: string[] };

function assertEligibleWorkspaceCandidates(workspaceId: string, candidates: readonly EvidenceCandidate[]) {
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error("Evidence candidate IDs must be unique within a retrieval result.");
    }
    candidateIds.add(candidate.candidateId);
    if (candidate.workspaceId !== workspaceId) {
      throw new Error("Evidence candidates must belong to the authorized workspace.");
    }
    if (!candidate.eligibility.eligible || candidate.eligibility.lifecycleState !== "active") {
      throw new Error("Only active eligible evidence candidates may enter the source registry.");
    }
  }
}

export function buildSourceRegistry({
  workspaceId,
  candidates
}: {
  workspaceId: string;
  candidates: readonly EvidenceCandidate[];
}): SourceRegistry {
  assertEligibleWorkspaceCandidates(workspaceId, candidates);

  const mutableEntries: MutableSourceRegistryEntry[] = [];
  const entryByKey = new Map<string, (typeof mutableEntries)[number]>();
  const candidateToSourceOrdinal: Record<string, string> = {};

  for (const candidate of candidates) {
    const key = candidate.source.canonicalSourceKey;
    let entry = entryByKey.get(key);
    if (!entry) {
      entry = {
        sourceOrdinal: `SRC${mutableEntries.length + 1}`,
        canonicalSourceKey: key,
        independentSourceKey: candidate.source.independentSourceKey,
        sourceType: candidate.source.sourceType,
        title: candidate.title,
        evidenceRole: candidate.evidenceRole,
        sourceId: candidate.source.sourceId,
        sourceFileId: candidate.source.sourceFileId,
        parentSourceId: candidate.source.parentSourceId,
        candidateIds: []
      };
      mutableEntries.push(entry);
      entryByKey.set(key, entry);
    } else {
      const incomingIndependentKey = candidate.evidenceRole === "original"
        ? candidate.source.independentSourceKey
        : null;
      if (entry.independentSourceKey && incomingIndependentKey && entry.independentSourceKey !== incomingIndependentKey) {
        throw new Error("A canonical source cannot resolve to multiple independent source identities.");
      }
      if (candidate.evidenceRole === "original") {
        if (entry.evidenceRole !== "original") {
          entry.sourceType = candidate.source.sourceType;
          entry.title = candidate.title;
          entry.sourceId = candidate.source.sourceId;
          entry.sourceFileId = candidate.source.sourceFileId;
          entry.parentSourceId = candidate.source.parentSourceId;
        }
        entry.evidenceRole = "original";
        entry.independentSourceKey = incomingIndependentKey || entry.independentSourceKey;
      }
    }
    entry.candidateIds.push(candidate.candidateId);
    candidateToSourceOrdinal[candidate.candidateId] = entry.sourceOrdinal;
  }

  const independentOriginalSourceCount = new Set(
    mutableEntries
      .filter((entry) => entry.evidenceRole === "original")
      .map((entry) => entry.independentSourceKey)
      .filter((key): key is string => Boolean(key))
  ).size;

  return deepFreeze({
    version: SOURCE_REGISTRY_VERSION,
    workspaceId,
    entries: mutableEntries,
    candidateToSourceOrdinal,
    independentOriginalSourceCount
  });
}
