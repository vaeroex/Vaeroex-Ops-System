import "server-only";

import {
  EVIDENCE_MANIFEST_VERSION,
  SOURCE_REGISTRY_VERSION,
  type EvidenceManifest,
  type EvidenceManifestEntry,
  type SourceRegistry,
  type SourceRegistryEntry
} from "@/lib/ai/evidence-engine/contracts";
import { verifyEvidenceManifestCitations } from "@/lib/ai/evidence-engine/citation-verification";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import type {
  ContinuousIntelligenceEvidenceContext,
  ContinuousIntelligenceEvidenceSummary,
  ContinuousIntelligenceReasonCode
} from "@/lib/ai/continuous-intelligence/contracts";

export type ResolvedContinuousEvidence = Readonly<{
  valid: boolean;
  entries: readonly EvidenceManifestEntry[];
  sourceEntries: readonly SourceRegistryEntry[];
  evidence: ContinuousIntelligenceEvidenceSummary;
  reasonCodes: readonly ContinuousIntelligenceReasonCode[];
}>;

function uniqueCitationIds(citationIds: readonly number[]) {
  return Array.from(new Set(citationIds.filter((citationId) => Number.isInteger(citationId) && citationId > 0)))
    .sort((left, right) => left - right);
}

export function assertContinuousEvidenceContext(context: ContinuousIntelligenceEvidenceContext) {
  const { authorizedWorkspaceId, manifest, sourceRegistry } = context;
  if (manifest.version !== EVIDENCE_MANIFEST_VERSION) {
    throw new Error("Continuous Intelligence requires a supported EvidenceManifest version.");
  }
  if (sourceRegistry.version !== SOURCE_REGISTRY_VERSION) {
    throw new Error("Continuous Intelligence requires a supported SourceRegistry version.");
  }
  if (
    !authorizedWorkspaceId ||
    manifest.workspaceId !== authorizedWorkspaceId ||
    sourceRegistry.workspaceId !== authorizedWorkspaceId ||
    manifest.sourceRegistry.workspaceId !== authorizedWorkspaceId
  ) {
    throw new Error("Continuous Intelligence evidence must belong to the authorized workspace.");
  }
  if (evidenceEngineHash(sourceRegistry) !== evidenceEngineHash(manifest.sourceRegistry)) {
    throw new Error("Continuous Intelligence must consume the SourceRegistry embedded in its immutable EvidenceManifest.");
  }
  if (
    manifest.policy.citationsApplicationGenerated !== true ||
    manifest.policy.sourceIndependenceApplicationCalculated !== true ||
    manifest.policy.derivedOutputsExcludedFromOriginalEvidence !== true
  ) {
    throw new Error("Continuous Intelligence requires all Evidence Engine policy invariants.");
  }
}

function sourceEntriesForEvidence(registry: SourceRegistry, entries: readonly EvidenceManifestEntry[]) {
  const ordinals = new Set(entries.map((entry) => entry.sourceOrdinal));
  return registry.entries.filter((entry) => ordinals.has(entry.sourceOrdinal));
}

export function summarizeContinuousEvidence({
  manifest,
  entries
}: {
  manifest: EvidenceManifest;
  entries: readonly EvidenceManifestEntry[];
}): ContinuousIntelligenceEvidenceSummary {
  const sourceEntries = sourceEntriesForEvidence(manifest.sourceRegistry, entries);
  const independentSourceCount = new Set(
    sourceEntries
      .filter((entry) => entry.evidenceRole === "original")
      .map((entry) => entry.independentSourceKey)
      .filter((value): value is string => Boolean(value))
  ).size;

  return {
    manifestVersion: manifest.version,
    candidateCount: entries.length,
    sourceCount: sourceEntries.length,
    independentSourceCount,
    citationIds: entries.map((entry) => entry.citationId).sort((left, right) => left - right)
  };
}

export function resolveOriginalContinuousEvidence({
  context,
  citationIds
}: {
  context: ContinuousIntelligenceEvidenceContext;
  citationIds: readonly number[];
}): ResolvedContinuousEvidence {
  assertContinuousEvidenceContext(context);
  const normalizedCitationIds = uniqueCitationIds(citationIds);
  const verification = verifyEvidenceManifestCitations({
    manifest: context.manifest,
    citationIds: normalizedCitationIds,
    requiredCitationIds: normalizedCitationIds
  });
  const verified = new Set(verification.verifiedCitationIds);
  const verifiedEntries = context.manifest.evidence.filter((entry) => verified.has(entry.citationId));
  const originalEntries = verifiedEntries.filter((entry) =>
    entry.evidenceRole === "original" && entry.originalEvidenceEligible
  );
  const reasonCodes: ContinuousIntelligenceReasonCode[] = [];
  if (!verification.valid || verifiedEntries.length !== normalizedCitationIds.length) {
    reasonCodes.push("citation_verification_failed");
  }
  if (originalEntries.length !== verifiedEntries.length) {
    reasonCodes.push("derived_evidence_excluded");
  }
  const sourceEntries = sourceEntriesForEvidence(context.sourceRegistry, originalEntries);

  return {
    valid: reasonCodes.length === 0,
    entries: originalEntries,
    sourceEntries,
    evidence: summarizeContinuousEvidence({ manifest: context.manifest, entries: originalEntries }),
    reasonCodes
  };
}

export function verifyContinuousOutputCitations({
  context,
  citationIds
}: {
  context: ContinuousIntelligenceEvidenceContext;
  citationIds: readonly number[];
}) {
  const normalizedCitationIds = uniqueCitationIds(citationIds);
  const verification = verifyEvidenceManifestCitations({
    manifest: context.manifest,
    citationIds: normalizedCitationIds,
    requiredCitationIds: normalizedCitationIds
  });
  if (!verification.valid || verification.verifiedCitationIds.length !== normalizedCitationIds.length) return false;
  const entries = context.manifest.evidence.filter((entry) => normalizedCitationIds.includes(entry.citationId));
  return entries.length === normalizedCitationIds.length && entries.every((entry) =>
    entry.evidenceRole === "original" && entry.originalEvidenceEligible
  );
}
