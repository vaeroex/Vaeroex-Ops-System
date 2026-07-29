import "server-only";

import {
  buildBusinessHealthExplanationEvidenceContext,
  buildBusinessHealthExplanationPackage
} from "@/lib/ai/business-health-explanation/context";
import type { BusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/contracts";
import type { BusinessHealthSnapshotRow } from "@/lib/intelligence/business-health-history";
import type { BusinessIntelligenceCoverageResult } from "@/lib/intelligence/coverage";
import type { ExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import type { IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { buildIntelligenceSnapshotV1 } from "@/lib/intelligence/snapshot/v1/builder";
import { canonicalSnapshotJson, snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import { projectBusinessHealthExplanationV1 } from "@/lib/intelligence/snapshot/v1/projections";
import {
  COVERAGE_PRODUCER_ID,
  COVERAGE_PRODUCER_VERSION,
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  EVIDENCE_MANIFEST_PRODUCER_ID,
  EVIDENCE_MANIFEST_PRODUCER_VERSION,
  INTELLIGENCE_LAYER_PRODUCER_ID,
  INTELLIGENCE_LAYER_PRODUCER_VERSION
} from "@/lib/intelligence/snapshot/v1/versions";

export type BusinessHealthExplanationSnapshotParity = Readonly<{
  status: "exact" | "fallback";
  classification: "exact" | "adapter_defect";
  legacyFingerprint: string | null;
  snapshotFingerprint: string;
}>;

function intelligenceSemanticInput(intelligence: IntelligenceLayerResult) {
  return {
    businessHealth: intelligence.businessHealth,
    dataQuality: intelligence.dataQuality,
    forecastReadiness: intelligence.forecastReadiness,
    findings: intelligence.insights.map((insight) => ({
      id: insight.id,
      fingerprint: insight.fingerprint,
      type: insight.type,
      priority: insight.priority,
      confidence: insight.confidence,
      lastUpdated: insight.lastUpdated,
      supportingRecords: insight.supportingRecords.map((record) => ({
        id: record.id,
        recordType: record.recordType,
        date: record.date,
        classification: record.classification,
        sourceKey: record.sourceKey
      }))
    })),
    priorities: {
      topRisk: intelligence.topRisk?.id || null,
      topOpportunity: intelligence.topOpportunity?.id || null,
      topRecommendation: intelligence.topRecommendation?.id || null,
      topForecast: intelligence.topForecast?.id || null
    }
  };
}

function coverageSemanticInput(coverage: BusinessIntelligenceCoverageResult) {
  return {
    overallCoverage: coverage.overallCoverage,
    overallConfidenceLabel: coverage.overallConfidenceLabel,
    categories: coverage.categories.map((category) => ({
      id: category.id,
      coverage: category.coverage,
      confidenceLabel: category.confidenceLabel,
      sourceCount: category.sourceCount,
      lastUpdated: category.lastUpdated,
      historyMonths: category.historyMonths,
      structuredSourceCount: category.structuredSourceCount,
      forecastReady: category.forecastReady
    })),
    evidenceSummary: coverage.evidenceSummary
  };
}

function manifestSemanticInput(manifest: BusinessHealthExplanationPackage["manifest"]) {
  return {
    manifestId: manifest.manifestId,
    queryFingerprint: manifest.queryFingerprint,
    evidence: manifest.evidence.map((entry) => ({
      candidateId: entry.candidateId,
      sourceOrdinal: entry.sourceOrdinal,
      evidenceRole: entry.evidenceRole,
      originalEvidenceEligible: entry.originalEvidenceEligible,
      recordedAt: entry.recordedAt,
      indexedAt: entry.indexedAt,
      lineageVersion: entry.lineageVersion,
      eligibilityDecisionVersion: entry.eligibilityDecisionVersion
    })),
    sourceRegistry: manifest.sourceRegistry.entries.map((entry) => ({
      sourceOrdinal: entry.sourceOrdinal,
      canonicalSourceKey: entry.canonicalSourceKey,
      independentSourceKey: entry.independentSourceKey,
      evidenceRole: entry.evidenceRole,
      candidateIds: entry.candidateIds
    }))
  };
}

function packagesMatch(left: BusinessHealthExplanationPackage, right: BusinessHealthExplanationPackage) {
  return canonicalSnapshotJson(left) === canonicalSnapshotJson(right);
}

function projectionFallbackReason(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("projection evidence cannot resolve finding")) return "finding_evidence_mismatch";
  if (message.includes("missing authoritative explanation fields")) return "missing_authoritative_fields";
  if (message.includes("presentation disagrees")) return "presentation_disagreement";
  if (message.includes("missing evidence-manifest citations")) return "missing_manifest_citations";
  if (message.includes("evidence citations could not be verified")) return "citation_verification_failed";
  return "package_construction_failed";
}

export function buildBusinessHealthExplanationFromSnapshotV1({
  workspaceId,
  intelligence,
  homepage,
  snapshots,
  coverage,
  sourceLabelsByKey = {},
  asOf
}: {
  workspaceId: string;
  intelligence: IntelligenceLayerResult;
  homepage: ExecutiveHomepageModel;
  snapshots: readonly BusinessHealthSnapshotRow[];
  coverage: BusinessIntelligenceCoverageResult;
  sourceLabelsByKey?: Readonly<Record<string, string>>;
  asOf: string;
}) {
  const now = new Date(asOf);
  if (!Number.isFinite(now.getTime())) throw new Error("Business Health explanation asOf must be a valid timestamp.");
  const evidenceContext = buildBusinessHealthExplanationEvidenceContext({
    workspaceId,
    intelligence,
    sourceLabelsByKey,
    now
  });
  const manifest = evidenceContext.manifest;
  const build = buildIntelligenceSnapshotV1({
    workspaceId,
    asOf,
    evaluationDate: asOf.slice(0, 10),
    generatedAt: asOf,
    versions: DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
    intelligenceLayer: {
      producerId: INTELLIGENCE_LAYER_PRODUCER_ID,
      producerVersion: INTELLIGENCE_LAYER_PRODUCER_VERSION,
      workspaceId,
      asOf,
      semanticInputFingerprint: snapshotHash(intelligenceSemanticInput(intelligence)),
      output: intelligence
    },
    coverage: {
      producerId: COVERAGE_PRODUCER_ID,
      producerVersion: COVERAGE_PRODUCER_VERSION,
      workspaceId,
      asOf,
      semanticInputFingerprint: snapshotHash(coverageSemanticInput(coverage)),
      output: coverage
    },
    evidenceManifests: {
      producerId: EVIDENCE_MANIFEST_PRODUCER_ID,
      producerVersion: EVIDENCE_MANIFEST_PRODUCER_VERSION,
      workspaceId,
      asOf,
      semanticInputFingerprint: snapshotHash(manifestSemanticInput(manifest)),
      output: [manifest]
    }
  });
  const projection = projectBusinessHealthExplanationV1(build.snapshot);

  if (projection.businessHealth.state !== "available") {
    const legacyPackage = buildBusinessHealthExplanationPackage({
      workspaceId,
      intelligence,
      homepage,
      snapshots,
      sourceLabelsByKey,
      now,
      evidenceContext
    });
    return {
      analysisPackage: legacyPackage,
      snapshot: build.snapshot,
      projection,
      receipt: build.receipt,
      parity: {
        status: "fallback",
        classification: "adapter_defect",
        legacyFingerprint: legacyPackage.fingerprint,
        snapshotFingerprint: build.snapshot.fingerprints.snapshot
      } satisfies BusinessHealthExplanationSnapshotParity
    };
  }

  let analysisPackage: BusinessHealthExplanationPackage;
  try {
    analysisPackage = buildBusinessHealthExplanationPackage({
      workspaceId,
      intelligence,
      homepage,
      snapshots,
      sourceLabelsByKey,
      now,
      projection,
      evidenceContext
    });
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    const legacyPackage = buildBusinessHealthExplanationPackage({
      workspaceId,
      intelligence,
      homepage,
      snapshots,
      sourceLabelsByKey,
      now,
      evidenceContext
    });
    const parity = {
      status: "fallback",
      classification: "adapter_defect",
      legacyFingerprint: legacyPackage.fingerprint,
      snapshotFingerprint: build.snapshot.fingerprints.snapshot
    } satisfies BusinessHealthExplanationSnapshotParity;
    console.error(JSON.stringify({
      level: "error",
      component: "business-health-explanation",
      event: "snapshot_v1_projection_fallback",
      classification: parity.classification,
      reasonCode: projectionFallbackReason(error)
    }));
    return { analysisPackage: legacyPackage, snapshot: build.snapshot, projection, receipt: build.receipt, parity };
  }
  let parity: BusinessHealthExplanationSnapshotParity = {
    status: "exact",
    classification: "exact",
    legacyFingerprint: null,
    snapshotFingerprint: build.snapshot.fingerprints.snapshot
  };

  if (process.env.VERCEL_ENV === "preview") {
    const legacyPackage = buildBusinessHealthExplanationPackage({
      workspaceId,
      intelligence,
      homepage,
      snapshots,
      sourceLabelsByKey,
      now,
      evidenceContext
    });
    if (!packagesMatch(legacyPackage, analysisPackage)) {
      parity = {
        status: "fallback",
        classification: "adapter_defect",
        legacyFingerprint: legacyPackage.fingerprint,
        snapshotFingerprint: build.snapshot.fingerprints.snapshot
      };
      console.error(JSON.stringify({
        level: "error",
        component: "business-health-explanation",
        event: "snapshot_v1_parity_fallback",
        classification: parity.classification
      }));
      return { analysisPackage: legacyPackage, snapshot: build.snapshot, projection, receipt: build.receipt, parity };
    }
    parity = { ...parity, legacyFingerprint: legacyPackage.fingerprint };
  }

  return { analysisPackage, snapshot: build.snapshot, projection, receipt: build.receipt, parity };
}
