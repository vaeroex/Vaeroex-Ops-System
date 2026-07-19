import "server-only";

import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import {
  CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION,
  type ContinuousIntelligenceContractId
} from "@/lib/ai/continuous-intelligence/contracts";

function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.normalize("NFKC").trim();
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") return null;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)])
  );
}

function canonicalizeCitationReferences(
  value: unknown,
  evidenceIdentityByCitation: ReadonlyMap<number, string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeCitationReferences(item, evidenceIdentityByCitation));
  }
  if (!value || typeof value !== "object") return canonicalValue(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => {
        if (key === "citationIds" && Array.isArray(child)) {
          const identities = child
            .filter((citationId): citationId is number => Number.isInteger(citationId))
            .map((citationId) => evidenceIdentityByCitation.get(citationId))
            .filter((identity): identity is string => Boolean(identity));
          return [key, Array.from(new Set(identities)).sort()];
        }
        if (key === "citationId" && Number.isInteger(child)) {
          return [key, evidenceIdentityByCitation.get(child as number) || null];
        }
        return [key, canonicalizeCitationReferences(child, evidenceIdentityByCitation)];
      })
  );
}

export function buildContinuousIntelligenceFingerprint({
  contractId,
  contractVersion,
  manifest,
  citationIds,
  deterministicFacts,
  relevantSettings
}: {
  contractId: ContinuousIntelligenceContractId;
  contractVersion: 1;
  manifest: EvidenceManifest;
  citationIds: readonly number[];
  deterministicFacts: unknown;
  relevantSettings: unknown;
}) {
  const selectedCitationIds = new Set(citationIds);
  const sourceByOrdinal = new Map(
    manifest.sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry])
  );
  const selectedCandidateIds = new Set(
    manifest.evidence
      .filter((entry) => selectedCitationIds.has(entry.citationId))
      .map((entry) => entry.candidateId)
  );
  const evidenceIdentityByCitation = new Map<number, string>();
  const selectedEvidence = manifest.evidence
    .filter((entry) => selectedCitationIds.has(entry.citationId))
    .map((entry) => {
      const source = sourceByOrdinal.get(entry.sourceOrdinal);
      if (!source) throw new Error("Continuous Intelligence evidence must resolve through the Source Registry.");
      const stableEvidenceIdentity = evidenceEngineHash({
        candidateId: entry.candidateId,
        canonicalSourceKey: source.canonicalSourceKey
      });
      evidenceIdentityByCitation.set(entry.citationId, stableEvidenceIdentity);
      return {
        stableEvidenceIdentity,
        contentHash: evidenceEngineHash({
          candidateId: entry.candidateId,
          domain: entry.domain,
          title: entry.title,
          excerpt: entry.excerpt,
          summary: entry.summary,
          evidenceRole: entry.evidenceRole,
          originalEvidenceEligible: entry.originalEvidenceEligible,
          confidenceScore: entry.confidenceScore,
          indexedAt: entry.indexedAt,
          recordedAt: entry.recordedAt,
          lineageVersion: entry.lineageVersion,
          eligibilityDecisionVersion: entry.eligibilityDecisionVersion
        }),
        sourceLineageHash: evidenceEngineHash({
          canonicalSourceKey: source.canonicalSourceKey,
          independentSourceKey: source.independentSourceKey,
          sourceType: source.sourceType,
          evidenceRole: source.evidenceRole,
          sourceId: source.sourceId,
          sourceFileId: source.sourceFileId,
          parentSourceId: source.parentSourceId,
          candidateIds: source.candidateIds
            .filter((candidateId) => selectedCandidateIds.has(candidateId))
            .sort()
        }),
        eligibility: {
          active: true,
          evidenceRole: entry.evidenceRole,
          originalEvidenceEligible: entry.originalEvidenceEligible,
          decisionVersion: entry.eligibilityDecisionVersion
        }
      };
    })
    .sort((left, right) =>
      left.stableEvidenceIdentity.localeCompare(right.stableEvidenceIdentity) ||
      left.contentHash.localeCompare(right.contentHash)
    );
  const scopedManifestIdentity = evidenceEngineHash({
    version: manifest.version,
    sourceRegistryVersion: manifest.sourceRegistry.version,
    evidence: selectedEvidence
  });

  return evidenceEngineHash({
    contractId,
    contractVersion,
    validatorVersion: CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION,
    scopedManifestIdentity,
    deterministicFacts: canonicalizeCitationReferences(deterministicFacts, evidenceIdentityByCitation),
    relevantSettings: canonicalValue(relevantSettings)
  });
}
