import {
  CITATION_VERIFICATION_VERSION,
  EVIDENCE_MANIFEST_VERSION,
  SOURCE_REGISTRY_VERSION,
  type EvidenceCandidate,
  type EvidenceManifest,
  type SourceRegistry
} from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export function buildEvidenceManifest({
  workspaceId,
  queryText,
  candidates,
  sourceRegistry,
  generatedAt,
  candidateRetrieverVersion,
  embeddingVersion,
  rerankerVersion,
  signalPlannerVersion
}: {
  workspaceId: string;
  queryText: string;
  candidates: readonly EvidenceCandidate[];
  sourceRegistry: SourceRegistry;
  generatedAt: string;
  candidateRetrieverVersion: string;
  embeddingVersion: string | null;
  rerankerVersion: string;
  signalPlannerVersion: string;
}): EvidenceManifest {
  if (sourceRegistry.workspaceId !== workspaceId) {
    throw new Error("The source registry must belong to the authorized workspace.");
  }

  const evidence = candidates.map((candidate, index) => {
    if (candidate.workspaceId !== workspaceId || !candidate.eligibility.eligible) {
      throw new Error("Only authorized eligible candidates may enter an evidence manifest.");
    }
    const sourceOrdinal = sourceRegistry.candidateToSourceOrdinal[candidate.candidateId];
    if (!sourceOrdinal) throw new Error("Every manifest candidate must exist in the source registry.");

    return {
      citationId: index + 1,
      candidateId: candidate.candidateId,
      sourceOrdinal,
      domain: candidate.domain,
      title: candidate.title,
      excerpt: candidate.excerpt,
      summary: candidate.summary,
      evidenceRole: candidate.evidenceRole,
      originalEvidenceEligible: candidate.eligibility.originalEvidenceEligible,
      confidenceScore: candidate.confidenceScore,
      indexedAt: candidate.provenance.indexedAt,
      recordedAt: candidate.provenance.recordedAt,
      lineageVersion: candidate.provenance.lineageVersion,
      eligibilityDecisionVersion: candidate.eligibility.decisionVersion
    };
  });
  const queryFingerprint = evidenceEngineHash({ workspaceId, queryText });
  const componentVersions = {
    candidateRetriever: candidateRetrieverVersion,
    embedding: embeddingVersion,
    reranker: rerankerVersion,
    sourceRegistry: SOURCE_REGISTRY_VERSION,
    signalPlanner: signalPlannerVersion,
    citationVerifier: CITATION_VERIFICATION_VERSION
  } as const;
  const manifestId = evidenceEngineHash({
    version: EVIDENCE_MANIFEST_VERSION,
    workspaceId,
    queryFingerprint,
    evidence,
    sourceRegistry,
    componentVersions
  });

  return deepFreeze({
    version: EVIDENCE_MANIFEST_VERSION,
    manifestId,
    workspaceId,
    queryFingerprint,
    generatedAt,
    evidence,
    sourceRegistry,
    componentVersions,
    policy: {
      derivedOutputsExcludedFromOriginalEvidence: true,
      citationsApplicationGenerated: true,
      sourceIndependenceApplicationCalculated: true
    }
  });
}
