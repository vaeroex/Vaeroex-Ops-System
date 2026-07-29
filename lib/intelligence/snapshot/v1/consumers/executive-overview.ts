import "server-only";

import type { BusinessHealthSnapshotRow } from "@/lib/intelligence/business-health-history";
import type { BusinessIntelligenceCoverageResult } from "@/lib/intelligence/coverage";
import {
  buildExecutiveHomepageModel,
  type ExecutiveHomepageModel
} from "@/lib/intelligence/executive-homepage";
import type { IntelligenceInsight, IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import { materializeFindingPresentationV1 } from "@/lib/intelligence/snapshot/v1/consumers/intelligence-inbox";
import type { ExecutiveOverviewProjectionV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { FindingSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

type KpiTrendInput = { name: string; changePercent: number | null };

export type ExecutiveOverviewSnapshotParityV1 = Readonly<{
  status: "exact" | "fallback";
  classification: "exact" | "adapter_defect";
}>;

function materializePriorityFinding({
  finding,
  legacyInsight,
  role
}: {
  finding: FindingSnapshotV1 | null;
  legacyInsight: IntelligenceInsight | undefined;
  role: string;
}) {
  if (!finding && !legacyInsight) return undefined;
  if (!finding || !legacyInsight || finding.id !== legacyInsight.id) {
    throw new Error(`Executive Overview ${role} disagrees with IntelligenceSnapshotV1.`);
  }
  return materializeFindingPresentationV1({ finding, legacyInsight });
}

function materializeIntelligence({
  projection,
  intelligence
}: {
  projection: ExecutiveOverviewProjectionV1;
  intelligence: IntelligenceLayerResult;
}): IntelligenceLayerResult {
  let businessHealth = intelligence.businessHealth;
  if (projection.businessHealth.state === "available") {
    const projected = projection.businessHealth.value;
    const legacy = intelligence.businessHealth;
    if (!legacy.available || legacy.status === "Insufficient Data") {
      throw new Error("Executive Overview Business Health availability disagrees with IntelligenceSnapshotV1.");
    }
    if (canonicalSnapshotJson({
      score: legacy.score,
      status: legacy.status,
      trajectory: legacy.trend,
      confidence: intelligence.dataQuality.confidence,
      components: legacy.components
    }) !== canonicalSnapshotJson({
      score: projected.score,
      status: projected.status,
      trajectory: projected.trajectory,
      confidence: projected.confidence,
      components: projected.components.state === "available" ? projected.components.value : null
    })) {
      throw new Error("Executive Overview Business Health disagrees with IntelligenceSnapshotV1.");
    }
    businessHealth = {
      ...legacy,
      available: true,
      score: projected.score,
      status: projected.status,
      trend: projected.trajectory,
      components: projected.components.state === "available"
        ? { ...projected.components.value, driverImpacts: projected.components.value.driverImpacts.map((impact) => ({ ...impact })) }
        : legacy.components
    };
  } else if (intelligence.businessHealth.available && intelligence.businessHealth.status !== "Insufficient Data") {
    throw new Error("Executive Overview Business Health is missing from IntelligenceSnapshotV1.");
  }

  let dataQuality = intelligence.dataQuality;
  if (projection.dataQuality.state === "available") {
    const projected = projection.dataQuality.value;
    if (canonicalSnapshotJson({
      score: intelligence.dataQuality.score,
      label: intelligence.dataQuality.label,
      confidence: intelligence.dataQuality.confidence
    }) !== canonicalSnapshotJson(projected)) {
      throw new Error("Executive Overview data quality disagrees with IntelligenceSnapshotV1.");
    }
    dataQuality = { ...intelligence.dataQuality, ...projected };
  } else {
    throw new Error("Executive Overview data quality is missing from IntelligenceSnapshotV1.");
  }

  return {
    ...intelligence,
    businessHealth,
    dataQuality,
    topRisk: materializePriorityFinding({ finding: projection.topRisk, legacyInsight: intelligence.topRisk, role: "top risk" }),
    topOpportunity: materializePriorityFinding({ finding: projection.topOpportunity, legacyInsight: intelligence.topOpportunity, role: "top opportunity" }),
    topRecommendation: materializePriorityFinding({ finding: projection.topRecommendation, legacyInsight: intelligence.topRecommendation, role: "top recommendation" })
  };
}

function materializeCoverage({
  projection,
  coverage
}: {
  projection: ExecutiveOverviewProjectionV1;
  coverage: BusinessIntelligenceCoverageResult;
}): BusinessIntelligenceCoverageResult {
  if (projection.coverage.state !== "available") {
    throw new Error("Executive Overview coverage is missing from IntelligenceSnapshotV1.");
  }
  const projected = projection.coverage.value;
  const projectedById = new Map(projected.categories.map((category) => [category.id, category]));
  if (projectedById.size !== coverage.categories.length) {
    throw new Error("Executive Overview coverage categories disagree with IntelligenceSnapshotV1.");
  }
  const categories = coverage.categories.map((legacy) => {
    const category = projectedById.get(legacy.id);
    if (!category) throw new Error(`Coverage category ${legacy.id} is missing from IntelligenceSnapshotV1.`);
    const legacyCanonical = {
      id: legacy.id,
      coverage: legacy.coverage,
      confidenceLabel: legacy.confidenceLabel,
      sourceCount: legacy.sourceCount,
      lastUpdated: legacy.lastUpdated,
      historyMonths: legacy.historyMonths,
      structuredSourceCount: legacy.structuredSourceCount,
      forecastReady: legacy.forecastReady
    };
    if (canonicalSnapshotJson(legacyCanonical) !== canonicalSnapshotJson(category)) {
      throw new Error(`Coverage category ${legacy.id} disagrees with IntelligenceSnapshotV1.`);
    }
    return { ...legacy, ...category };
  });
  if (canonicalSnapshotJson({
    overallCoverage: coverage.overallCoverage,
    overallConfidenceLabel: coverage.overallConfidenceLabel,
    evidenceSummary: coverage.evidenceSummary
  }) !== canonicalSnapshotJson({
    overallCoverage: projected.overallCoverage,
    overallConfidenceLabel: projected.overallConfidenceLabel,
    evidenceSummary: projected.evidenceSummary
  })) {
    throw new Error("Executive Overview coverage summary disagrees with IntelligenceSnapshotV1.");
  }
  return {
    ...coverage,
    overallCoverage: projected.overallCoverage,
    overallConfidenceLabel: projected.overallConfidenceLabel,
    categories,
    evidenceSummary: projected.evidenceSummary
  };
}

function modelsMatch(left: ExecutiveHomepageModel, right: ExecutiveHomepageModel) {
  return canonicalSnapshotJson(left) === canonicalSnapshotJson(right);
}

export function buildExecutiveHomepageFromSnapshotV1({
  projection,
  intelligence,
  coverage,
  snapshots,
  kpiTrends,
  sourceDataAvailable
}: {
  projection: ExecutiveOverviewProjectionV1;
  intelligence: IntelligenceLayerResult;
  coverage: BusinessIntelligenceCoverageResult;
  snapshots: BusinessHealthSnapshotRow[];
  kpiTrends: KpiTrendInput[];
  sourceDataAvailable: boolean;
}) {
  const legacyModel = buildExecutiveHomepageModel({ intelligence, coverage, snapshots, kpiTrends, sourceDataAvailable });
  try {
    const model = buildExecutiveHomepageModel({
      intelligence: materializeIntelligence({ projection, intelligence }),
      coverage: materializeCoverage({ projection, coverage }),
      snapshots,
      kpiTrends,
      sourceDataAvailable
    });
    if (!modelsMatch(legacyModel, model)) throw new Error("Executive Overview rendered model parity failed.");
    return {
      model,
      parity: { status: "exact", classification: "exact" } satisfies ExecutiveOverviewSnapshotParityV1
    };
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    console.error(JSON.stringify({
      level: "error",
      component: "executive-overview",
      event: "snapshot_v1_projection_fallback",
      classification: "adapter_defect",
      reason: error instanceof Error ? error.message : "model_construction_failed"
    }));
    return {
      model: legacyModel,
      parity: { status: "fallback", classification: "adapter_defect" } satisfies ExecutiveOverviewSnapshotParityV1
    };
  }
}
