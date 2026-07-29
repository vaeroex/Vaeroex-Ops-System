import "server-only";

import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import type { BusinessIntelligenceCoverageResult } from "@/lib/intelligence/coverage";
import type { IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { buildIntelligenceSnapshotV1 } from "@/lib/intelligence/snapshot/v1/builder";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { ContextualEvidenceProducerOutputV1, KpiProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/types";
import {
  COVERAGE_PRODUCER_ID,
  COVERAGE_PRODUCER_VERSION,
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  EVIDENCE_MANIFEST_PRODUCER_ID,
  EVIDENCE_MANIFEST_PRODUCER_VERSION,
  CONTEXTUAL_EVIDENCE_PRODUCER_ID,
  CONTEXTUAL_EVIDENCE_PRODUCER_VERSION,
  INTELLIGENCE_LAYER_PRODUCER_ID,
  INTELLIGENCE_LAYER_PRODUCER_VERSION,
  KPI_DETERMINISTIC_PRODUCER_ID,
  KPI_DETERMINISTIC_PRODUCER_VERSION
} from "@/lib/intelligence/snapshot/v1/versions";

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

function manifestSemanticInput(manifest: EvidenceManifest) {
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

function kpiSemanticInput(kpis: KpiProducerOutputV1) {
  return kpis.map((metric) => ({
    id: metric.id,
    workspaceId: metric.workspaceId,
    semantics: metric.semantics,
    manualTarget: metric.manualTarget,
    configuredSemanticTarget: metric.configuredSemanticTarget,
    effectiveAuthoritativeTarget: metric.effectiveAuthoritativeTarget,
    evaluation: metric.evaluation,
    recommendation: metric.recommendation,
    observations: metric.observations,
    freshness: metric.freshness,
    evidenceReferenceIds: metric.evidenceReferenceIds
  }));
}

function contextualEvidenceSemanticInput(contextualEvidence: ContextualEvidenceProducerOutputV1) {
  return {
    releaseChannel: contextualEvidence.releaseChannel,
    records: [...contextualEvidence.records]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => ({
        ...record,
        departments: [...record.departments].sort(),
        topics: [...record.topics].sort(),
        entities: [...record.entities].sort((left, right) => left.id.localeCompare(right.id)),
        statements: [...record.statements].sort((left, right) => left.id.localeCompare(right.id)),
        userAddedContext: [...record.userAddedContext].sort((left, right) => left.field.localeCompare(right.field))
      }))
  };
}

export function buildIntelligenceSnapshotFromProducersV1({
  workspaceId,
  asOf,
  intelligence,
  coverage,
  evidenceManifests,
  contextualEvidence,
  kpis
}: {
  workspaceId: string;
  asOf: string;
  intelligence?: IntelligenceLayerResult;
  coverage?: BusinessIntelligenceCoverageResult;
  evidenceManifests?: readonly EvidenceManifest[];
  contextualEvidence?: ContextualEvidenceProducerOutputV1;
  kpis?: KpiProducerOutputV1;
}) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("IntelligenceSnapshotV1 asOf must be a valid timestamp.");

  return buildIntelligenceSnapshotV1({
    workspaceId,
    asOf,
    evaluationDate: asOf.slice(0, 10),
    generatedAt: asOf,
    versions: DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
    ...(intelligence ? {
      intelligenceLayer: {
        producerId: INTELLIGENCE_LAYER_PRODUCER_ID,
        producerVersion: INTELLIGENCE_LAYER_PRODUCER_VERSION,
        workspaceId,
        asOf,
        semanticInputFingerprint: snapshotHash(intelligenceSemanticInput(intelligence)),
        output: intelligence
      }
    } : {}),
    ...(coverage ? {
      coverage: {
        producerId: COVERAGE_PRODUCER_ID,
        producerVersion: COVERAGE_PRODUCER_VERSION,
        workspaceId,
        asOf,
        semanticInputFingerprint: snapshotHash(coverageSemanticInput(coverage)),
        output: coverage
      }
    } : {}),
    ...(evidenceManifests ? {
      evidenceManifests: {
        producerId: EVIDENCE_MANIFEST_PRODUCER_ID,
        producerVersion: EVIDENCE_MANIFEST_PRODUCER_VERSION,
        workspaceId,
        asOf,
        semanticInputFingerprint: snapshotHash(
          evidenceManifests.length === 1
            ? manifestSemanticInput(evidenceManifests[0])
            : evidenceManifests.map(manifestSemanticInput)
        ),
        output: evidenceManifests
      }
    } : {}),
    ...(contextualEvidence ? {
      contextualEvidence: {
        producerId: CONTEXTUAL_EVIDENCE_PRODUCER_ID,
        producerVersion: CONTEXTUAL_EVIDENCE_PRODUCER_VERSION,
        workspaceId,
        asOf,
        semanticInputFingerprint: snapshotHash(contextualEvidenceSemanticInput(contextualEvidence)),
        output: contextualEvidence
      }
    } : {}),
    ...(kpis ? {
      kpis: {
        producerId: KPI_DETERMINISTIC_PRODUCER_ID,
        producerVersion: KPI_DETERMINISTIC_PRODUCER_VERSION,
        workspaceId,
        asOf,
        semanticInputFingerprint: snapshotHash(kpiSemanticInput(kpis)),
        output: kpis
      }
    } : {})
  });
}
