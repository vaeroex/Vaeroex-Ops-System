import {
  CITATION_VERIFICATION_VERSION,
  type CitationVerificationResult,
  type EvidenceManifest
} from "@/lib/ai/evidence-engine/contracts";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export function verifyEvidenceManifestCitations({
  manifest,
  citationIds,
  requiredCitationIds = []
}: {
  manifest: EvidenceManifest;
  citationIds: readonly number[];
  requiredCitationIds?: readonly number[];
}): CitationVerificationResult {
  const evidenceByCitation = new Map(manifest.evidence.map((entry) => [entry.citationId, entry]));
  const sourceEntries = new Map(manifest.sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
  const seen = new Set<number>();
  const verifiedCitationIds: number[] = [];
  const rejected: CitationVerificationResult["rejected"][number][] = [];

  for (const citationId of citationIds) {
    if (seen.has(citationId)) {
      rejected.push({ citationId, reason: "duplicate_citation" });
      continue;
    }
    seen.add(citationId);
    const evidence = evidenceByCitation.get(citationId);
    if (!evidence) {
      rejected.push({ citationId, reason: "unknown_citation" });
      continue;
    }
    const sourceEntry = sourceEntries.get(evidence.sourceOrdinal);
    if (
      manifest.sourceRegistry.workspaceId !== manifest.workspaceId ||
      !sourceEntry ||
      !sourceEntry.candidateIds.includes(evidence.candidateId) ||
      manifest.sourceRegistry.candidateToSourceOrdinal[evidence.candidateId] !== evidence.sourceOrdinal
    ) {
      rejected.push({ citationId, reason: "source_registry_mismatch" });
      continue;
    }
    if (evidence.evidenceRole === "derived" && evidence.originalEvidenceEligible) {
      rejected.push({ citationId, reason: "ineligible_evidence" });
      continue;
    }
    verifiedCitationIds.push(citationId);
  }

  for (const requiredCitationId of new Set(requiredCitationIds)) {
    if (!seen.has(requiredCitationId)) {
      rejected.push({ citationId: requiredCitationId, reason: "missing_required_citation" });
    }
  }

  return deepFreeze({
    version: CITATION_VERIFICATION_VERSION,
    verifierVersion: CITATION_VERIFICATION_VERSION,
    valid: rejected.length === 0,
    verifiedCitationIds,
    rejected,
    expectedCount: new Set(requiredCitationIds).size,
    observedCount: citationIds.length
  });
}
