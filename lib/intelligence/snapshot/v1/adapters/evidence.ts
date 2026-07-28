import {
  EVIDENCE_MANIFEST_VERSION,
  SOURCE_REGISTRY_VERSION,
  type EvidenceRole,
  type SourceRegistryEntry
} from "@/lib/ai/evidence-engine/contracts";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type {
  CitationReferenceV1,
  EvidenceAuthorityRoleV1,
  EvidenceManifestProducerOutputV1,
  EvidenceReferenceV1
} from "@/lib/intelligence/snapshot/v1/types";

function authorityRole(role: EvidenceRole): EvidenceAuthorityRoleV1 {
  if (role === "supporting") return "supporting_context";
  return role;
}

function sourceIds(source: SourceRegistryEntry) {
  return [source.sourceId, source.sourceFileId, source.parentSourceId]
    .filter((value): value is string => Boolean(value));
}

export function adaptEvidenceManifestProducerOutputV1(output: EvidenceManifestProducerOutputV1) {
  const references: EvidenceReferenceV1[] = [];
  const citations: CitationReferenceV1[] = [];
  const sourceRegistryVersions = new Set<typeof SOURCE_REGISTRY_VERSION>();

  for (const manifest of output) {
    if (manifest.version !== EVIDENCE_MANIFEST_VERSION) {
      throw new Error(`Evidence manifest ${manifest.manifestId} has an unsupported version.`);
    }
    if (manifest.sourceRegistry.version !== SOURCE_REGISTRY_VERSION) {
      throw new Error(`Evidence manifest ${manifest.manifestId} has an unsupported source registry version.`);
    }
    sourceRegistryVersions.add(manifest.sourceRegistry.version);
    const sourceByOrdinal = new Map(manifest.sourceRegistry.entries.map((entry) => [entry.sourceOrdinal, entry]));
    if (sourceByOrdinal.size !== manifest.sourceRegistry.entries.length) {
      throw new Error(`Evidence manifest ${manifest.manifestId} has duplicate source ordinals.`);
    }

    for (const entry of manifest.evidence) {
      const source = sourceByOrdinal.get(entry.sourceOrdinal);
      if (!source) {
        throw new Error(`Evidence manifest ${manifest.manifestId} does not resolve source ordinal ${entry.sourceOrdinal}.`);
      }
      if (source.evidenceRole !== entry.evidenceRole) {
        throw new Error(`Evidence manifest ${manifest.manifestId} has inconsistent evidence roles for ${entry.candidateId}.`);
      }
      if (!source.candidateIds.includes(entry.candidateId)) {
        throw new Error(`Evidence manifest ${manifest.manifestId} source ${entry.sourceOrdinal} does not contain candidate ${entry.candidateId}.`);
      }
      if (manifest.sourceRegistry.candidateToSourceOrdinal[entry.candidateId] !== entry.sourceOrdinal) {
        throw new Error(`Evidence manifest ${manifest.manifestId} has an inconsistent candidate-to-source mapping for ${entry.candidateId}.`);
      }
      const referenceId = `manifest:${manifest.manifestId}:${entry.candidateId}`;
      const sourceKey = source.canonicalSourceKey;

      references.push({
        id: referenceId,
        workspaceId: manifest.workspaceId,
        recordId: entry.candidateId,
        recordType: entry.domain,
        sourceType: source.sourceType,
        sourceKeyHash: snapshotHash(sourceKey),
        sourceIds: sourceIds(source),
        authorityRole: authorityRole(entry.evidenceRole),
        sourceEvidenceRole: entry.evidenceRole,
        lifecycle: "active",
        originalEvidenceEligible: entry.originalEvidenceEligible,
        recordedAt: entry.recordedAt,
        indexedAt: entry.indexedAt,
        lineageVersion: entry.lineageVersion,
        lineageIds: sourceIds(source),
        eligibilityPolicyVersion: entry.eligibilityDecisionVersion
      });
      citations.push({
        id: `manifest:${manifest.manifestId}:citation:${entry.citationId}`,
        evidenceReferenceId: referenceId,
        manifestId: manifest.manifestId,
        sourceOrdinal: entry.sourceOrdinal
      });
    }
  }

  return {
    references,
    citations,
    sourceRegistryVersions: [...sourceRegistryVersions]
  };
}
