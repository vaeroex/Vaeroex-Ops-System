import { adaptCoverageProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/coverage";
import { adaptEvidenceManifestProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/evidence";
import { adaptIntelligenceLayerProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/intelligence-layer";
import { adaptKpiProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/kpis";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import {
  orderCitations,
  orderCoverageCategories,
  orderEvidenceReferences,
  orderKpis,
  orderPriorities
} from "@/lib/intelligence/snapshot/v1/ordering";
import type {
  CoverageProducerOutputV1,
  EvidenceManifestProducerOutputV1,
  IntelligenceLayerProducerOutputV1,
  IntelligenceSnapshotV1,
  KpiProducerOutputV1
} from "@/lib/intelligence/snapshot/v1/types";
import { SHADOW_PARITY_VERSION } from "@/lib/intelligence/snapshot/v1/versions";

export type ShadowParityClassificationV1 =
  | "exact_match"
  | "presentation_only"
  | "ordering_only"
  | "missing_producer_field"
  | "adapter_defect"
  | "legacy_duplicate"
  | "genuine_deterministic_disagreement"
  | "unavailable_for_comparison";

export type ShadowParityDifferenceV1 = Readonly<{
  path: string;
  classification: ShadowParityClassificationV1;
  severity: "fatal" | "blocking" | "warning" | "information";
  expectedDigest: string | null;
  actualDigest: string | null;
}>;

export type ShadowParityReportV1 = Readonly<{
  id: string;
  version: typeof SHADOW_PARITY_VERSION;
  workspaceId: string;
  snapshotFingerprint: string;
  generatedAt: string;
  status: "exact" | "differences" | "blocked";
  differences: readonly ShadowParityDifferenceV1[];
  counts: Readonly<Record<ShadowParityClassificationV1, number>>;
}>;

type LegacyDuplicateComparison = Readonly<{ path: string; authoritative: unknown; legacy: unknown }>;

function digest(value: unknown) {
  return value === undefined ? null : snapshotHash(value);
}

function difference(
  path: string,
  classification: ShadowParityClassificationV1,
  severity: ShadowParityDifferenceV1["severity"],
  expected: unknown,
  actual: unknown
): ShadowParityDifferenceV1 {
  return { path, classification, severity, expectedDigest: digest(expected), actualDigest: digest(actual) };
}

function same(left: unknown, right: unknown) {
  return digest(left) === digest(right);
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  return same([...left].sort(), [...right].sort());
}

export function compareIntelligenceSnapshotV1({
  snapshot,
  intelligenceLayer,
  kpis,
  coverage,
  evidenceManifests,
  generatedAt,
  legacyDuplicates = []
}: {
  snapshot: IntelligenceSnapshotV1;
  intelligenceLayer?: IntelligenceLayerProducerOutputV1;
  kpis?: KpiProducerOutputV1;
  coverage?: CoverageProducerOutputV1;
  evidenceManifests?: EvidenceManifestProducerOutputV1;
  generatedAt: string;
  legacyDuplicates?: readonly LegacyDuplicateComparison[];
}): ShadowParityReportV1 {
  const differences: ShadowParityDifferenceV1[] = [];

  if (!intelligenceLayer) {
    differences.push(difference("intelligenceLayer", "unavailable_for_comparison", "information", undefined, snapshot.businessHealth));
  } else {
    const adaptedLayer = adaptIntelligenceLayerProducerOutputV1({
      workspaceId: snapshot.scope.workspaceId,
      producerVersion: snapshot.versions.calculations.intelligenceLayer,
      evidenceEligibilityPolicyVersion: snapshot.versions.policies.evidenceEligibility,
      lineageVersion: snapshot.versions.policies.lineage,
      output: intelligenceLayer
    });
    const expectedHealth = intelligenceLayer.businessHealth.available && intelligenceLayer.businessHealth.status !== "Insufficient Data"
      ? {
        score: intelligenceLayer.businessHealth.score,
        status: intelligenceLayer.businessHealth.status,
        trajectory: intelligenceLayer.businessHealth.trend,
        confidence: intelligenceLayer.dataQuality.confidence
      }
      : null;
    const actualHealth = snapshot.businessHealth.state === "available"
      ? {
        score: snapshot.businessHealth.value.score,
        status: snapshot.businessHealth.value.status,
        trajectory: snapshot.businessHealth.value.trajectory,
        confidence: snapshot.businessHealth.value.confidence
      }
      : null;
    if (!same(expectedHealth, actualHealth)) {
      differences.push(difference("businessHealth", "genuine_deterministic_disagreement", "blocking", expectedHealth, actualHealth));
    }
    differences.push(difference(
      "businessHealth.components",
      "missing_producer_field",
      "warning",
      undefined,
      snapshot.businessHealth.state === "available" ? snapshot.businessHealth.value.components : undefined
    ));

    if (!same(adaptedLayer.dataQuality, snapshot.dataQuality)) {
      differences.push(difference(
        "dataQuality",
        "genuine_deterministic_disagreement",
        "blocking",
        adaptedLayer.dataQuality,
        snapshot.dataQuality
      ));
    }
    if (!same(adaptedLayer.forecastReadiness, snapshot.readiness.forecast)) {
      differences.push(difference(
        "readiness.forecast",
        "genuine_deterministic_disagreement",
        "blocking",
        adaptedLayer.forecastReadiness,
        snapshot.readiness.forecast
      ));
    }
    const expectedPriorities = orderPriorities(adaptedLayer.priorities);
    if (!same(expectedPriorities, snapshot.priorities)) {
      differences.push(difference(
        "priorities",
        "genuine_deterministic_disagreement",
        "blocking",
        expectedPriorities,
        snapshot.priorities
      ));
    }

    const expectedFindingIds = intelligenceLayer.insights.map((finding) => finding.id);
    const actualFindingIds = snapshot.findings.map((finding) => finding.id);
    if (!same(expectedFindingIds, actualFindingIds)) {
      differences.push(sameMembers(expectedFindingIds, actualFindingIds)
        ? difference("findings.order", "ordering_only", "warning", expectedFindingIds, actualFindingIds)
        : difference("findings.identities", "adapter_defect", "blocking", expectedFindingIds, actualFindingIds));
    }
    for (const expected of intelligenceLayer.insights) {
      const actual = snapshot.findings.find((finding) => finding.id === expected.id);
      if (!actual) continue;
      const expectedSemantic = {
        id: expected.id,
        fingerprint: expected.fingerprint,
        type: expected.type,
        priority: expected.priority,
        confidence: expected.confidence,
        lastUpdated: expected.lastUpdated
      };
      const actualSemantic = {
        id: actual.id,
        fingerprint: actual.fingerprint,
        type: actual.type,
        priority: actual.priority,
        confidence: actual.confidence,
        lastUpdated: actual.lastUpdated
      };
      if (!same(expectedSemantic, actualSemantic)) {
        differences.push(difference(`findings.${expected.id}`, "genuine_deterministic_disagreement", "blocking", expectedSemantic, actualSemantic));
      } else {
        const expectedPresentation = {
          title: expected.title,
          summary: expected.summary,
          why: expected.why,
          impact: expected.impact,
          recommendedAction: expected.recommendedAction,
          limitation: expected.limitation
        };
        const actualPresentation = {
          title: actual.title,
          summary: actual.summary,
          why: actual.why,
          impact: actual.impact,
          recommendedAction: actual.recommendedAction,
          limitation: actual.limitation
        };
        if (!same(expectedPresentation, actualPresentation)) {
          differences.push(difference(`findings.${expected.id}.presentation`, "presentation_only", "warning", expectedPresentation, actualPresentation));
        }
      }
    }
  }

  if (!kpis) {
    differences.push(difference("kpis", "unavailable_for_comparison", "information", undefined, snapshot.kpis));
  } else {
    const expectedKpis = orderKpis(adaptKpiProducerOutputV1(kpis)).map((kpi) => ({
      id: kpi.id,
      semantics: kpi.semantics,
      manualTarget: kpi.manualTarget,
      configuredSemanticTarget: kpi.configuredSemanticTarget,
      effectiveAuthoritativeTarget: kpi.effectiveAuthoritativeTarget,
      recommendedNextTarget: kpi.recommendedNextTarget,
      performance: kpi.performance
    }));
    const actualKpis = snapshot.kpis.map((kpi) => ({
      id: kpi.id,
      semantics: kpi.semantics,
      manualTarget: kpi.manualTarget,
      configuredSemanticTarget: kpi.configuredSemanticTarget,
      effectiveAuthoritativeTarget: kpi.effectiveAuthoritativeTarget,
      recommendedNextTarget: kpi.recommendedNextTarget,
      performance: kpi.performance
    }));
    if (!same(expectedKpis, actualKpis)) {
      differences.push(difference("kpis.semantic_outputs", "adapter_defect", "blocking", expectedKpis, actualKpis));
    }
  }

  if (!coverage) {
    differences.push(difference("readiness.coverage", "unavailable_for_comparison", "information", undefined, snapshot.readiness.coverage));
  } else {
    const adaptedCoverage = adaptCoverageProducerOutputV1(coverage);
    const expectedCoverage = adaptedCoverage.state === "available"
      ? {
        state: "available" as const,
        value: { ...adaptedCoverage.value, categories: orderCoverageCategories(adaptedCoverage.value.categories) }
      }
      : adaptedCoverage;
    if (!same(expectedCoverage, snapshot.readiness.coverage)) {
      differences.push(difference(
        "readiness.coverage",
        "adapter_defect",
        "blocking",
        expectedCoverage,
        snapshot.readiness.coverage
      ));
    }
  }

  if (!evidenceManifests || !intelligenceLayer) {
    differences.push(difference("evidence", "unavailable_for_comparison", "information", undefined, snapshot.evidence));
  } else {
    const adaptedLayer = adaptIntelligenceLayerProducerOutputV1({
      workspaceId: snapshot.scope.workspaceId,
      producerVersion: snapshot.versions.calculations.intelligenceLayer,
      evidenceEligibilityPolicyVersion: snapshot.versions.policies.evidenceEligibility,
      lineageVersion: snapshot.versions.policies.lineage,
      output: intelligenceLayer
    });
    const adaptedEvidence = adaptEvidenceManifestProducerOutputV1(evidenceManifests);
    const expectedEvidence = {
      references: orderEvidenceReferences([...adaptedLayer.evidenceReferences, ...adaptedEvidence.references]),
      citations: orderCitations(adaptedEvidence.citations),
      sourceRegistryVersions: [...adaptedEvidence.sourceRegistryVersions].sort()
    };
    if (!same(expectedEvidence, snapshot.evidence)) {
      differences.push(difference("evidence", "adapter_defect", "blocking", expectedEvidence, snapshot.evidence));
    }
  }

  for (const item of legacyDuplicates) {
    if (!same(item.authoritative, item.legacy)) {
      differences.push(difference(item.path, "legacy_duplicate", "warning", item.authoritative, item.legacy));
    }
  }

  if (!differences.length) {
    differences.push(difference("snapshot", "exact_match", "information", snapshot.fingerprints.snapshot, snapshot.fingerprints.snapshot));
  }
  const classifications: ShadowParityClassificationV1[] = [
    "exact_match",
    "presentation_only",
    "ordering_only",
    "missing_producer_field",
    "adapter_defect",
    "legacy_duplicate",
    "genuine_deterministic_disagreement",
    "unavailable_for_comparison"
  ];
  const counts = Object.fromEntries(classifications.map((classification) => [
    classification,
    differences.filter((item) => item.classification === classification).length
  ])) as Record<ShadowParityClassificationV1, number>;
  const blocked = differences.some((item) => item.severity === "blocking" || item.severity === "fatal");
  const status: ShadowParityReportV1["status"] = blocked
    ? "blocked"
    : differences.every((item) => item.classification === "exact_match")
      ? "exact"
      : "differences";
  const reportWithoutId = {
    version: SHADOW_PARITY_VERSION,
    workspaceId: snapshot.scope.workspaceId,
    snapshotFingerprint: snapshot.fingerprints.snapshot,
    generatedAt,
    status,
    differences,
    counts
  };

  return { id: snapshotHash(reportWithoutId), ...reportWithoutId };
}
