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
  const selectedEvidence = manifest.evidence
    .filter((entry) => selectedCitationIds.has(entry.citationId))
    .sort((left, right) => left.citationId - right.citationId);
  const selectedCandidateIds = new Set(selectedEvidence.map((entry) => entry.candidateId));
  const selectedSourceOrdinals = new Set(selectedEvidence.map((entry) => entry.sourceOrdinal));
  const selectedSources = manifest.sourceRegistry.entries
    .filter((entry) => selectedSourceOrdinals.has(entry.sourceOrdinal))
    .map((entry) => ({
      ...entry,
      candidateIds: entry.candidateIds.filter((candidateId) => selectedCandidateIds.has(candidateId)).sort()
    }))
    .sort((left, right) => left.sourceOrdinal.localeCompare(right.sourceOrdinal));
  const scopedManifestIdentity = evidenceEngineHash({
    version: manifest.version,
    queryFingerprint: manifest.queryFingerprint,
    evidence: selectedEvidence,
    sources: selectedSources,
    componentVersions: manifest.componentVersions,
    policy: manifest.policy
  });

  return evidenceEngineHash({
    contractId,
    contractVersion,
    validatorVersion: CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION,
    scopedManifestIdentity,
    deterministicFacts: canonicalValue(deterministicFacts),
    relevantSettings: canonicalValue(relevantSettings)
  });
}
