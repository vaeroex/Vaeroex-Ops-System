import "server-only";

import type { IntelligenceInsight, IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import type { IntelligenceInboxProjectionV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { FindingSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

const canonicalFindingFields = (finding: FindingSnapshotV1 | IntelligenceInsight) => ({
  id: finding.id,
  fingerprint: finding.fingerprint,
  type: finding.type,
  priority: finding.priority,
  confidence: finding.confidence,
  title: finding.title,
  summary: finding.summary,
  why: finding.why,
  impact: finding.impact,
  recommendedAction: finding.recommendedAction,
  limitation: finding.limitation,
  affectedArea: finding.affectedArea,
  timePeriod: finding.timePeriod,
  lastUpdated: finding.lastUpdated
});

function expectedEvidenceReferenceIds(insight: IntelligenceInsight) {
  return insight.supportingRecords.map((record) => `intelligence-layer:${record.id}`).sort();
}

export function materializeFindingPresentationV1({
  finding,
  legacyInsight
}: {
  finding: FindingSnapshotV1;
  legacyInsight: IntelligenceInsight;
}): IntelligenceInsight {
  if (canonicalSnapshotJson(canonicalFindingFields(finding)) !== canonicalSnapshotJson(canonicalFindingFields(legacyInsight))) {
    throw new Error(`Finding ${finding.id} disagrees with its IntelligenceSnapshotV1 projection.`);
  }

  if (canonicalSnapshotJson([...finding.deterministicDependencies.evidenceReferenceIds].sort()) !== canonicalSnapshotJson(expectedEvidenceReferenceIds(legacyInsight))) {
    throw new Error(`Finding ${finding.id} evidence identity disagrees with its IntelligenceSnapshotV1 projection.`);
  }

  return {
    ...legacyInsight,
    id: finding.id,
    fingerprint: finding.fingerprint,
    type: finding.type,
    priority: finding.priority,
    confidence: finding.confidence,
    title: finding.title,
    summary: finding.summary,
    why: finding.why,
    impact: finding.impact,
    recommendedAction: finding.recommendedAction,
    limitation: finding.limitation,
    affectedArea: finding.affectedArea,
    timePeriod: finding.timePeriod,
    lastUpdated: finding.lastUpdated
  };
}

function expectedPriorities(intelligence: IntelligenceLayerResult) {
  return [
    intelligence.topRisk ? { role: "top_risk", rank: 1, findingId: intelligence.topRisk.id } : null,
    intelligence.topOpportunity ? { role: "top_opportunity", rank: 1, findingId: intelligence.topOpportunity.id } : null,
    intelligence.topRecommendation ? { role: "top_recommendation", rank: 1, findingId: intelligence.topRecommendation.id } : null,
    intelligence.topForecast ? { role: "top_forecast", rank: 1, findingId: intelligence.topForecast.id } : null
  ].filter(Boolean);
}

export type IntelligenceInboxSnapshotParityV1 = Readonly<{
  status: "exact" | "fallback";
  classification: "exact" | "ordering_only" | "adapter_defect";
}>;

export function buildIntelligenceInboxFromSnapshotV1({
  projection,
  intelligence
}: {
  projection: IntelligenceInboxProjectionV1;
  intelligence: IntelligenceLayerResult;
}) {
  const legacyById = new Map(intelligence.insights.map((insight) => [insight.id, insight]));
  const projectionById = new Map(projection.findings.map((finding) => [finding.id, finding]));
  if (legacyById.size !== intelligence.insights.length || projectionById.size !== projection.findings.length) {
    throw new Error("Duplicate finding identity prevents Intelligence inbox snapshot migration.");
  }
  if (canonicalSnapshotJson([...legacyById.keys()].sort()) !== canonicalSnapshotJson([...projectionById.keys()].sort())) {
    throw new Error("The Intelligence inbox finding set disagrees with IntelligenceSnapshotV1.");
  }
  if (canonicalSnapshotJson(expectedPriorities(intelligence)) !== canonicalSnapshotJson(projection.priorities)) {
    throw new Error("The Intelligence inbox priorities disagree with IntelligenceSnapshotV1.");
  }

  // Preserve the existing presentation order. V1 canonical ordering is stable but
  // can add tie-breakers that are intentionally not customer-facing in this PR.
  const insights = intelligence.insights.map((legacyInsight) => {
    const finding = projectionById.get(legacyInsight.id);
    if (!finding) throw new Error(`Finding ${legacyInsight.id} is missing from IntelligenceSnapshotV1.`);
    return materializeFindingPresentationV1({ finding, legacyInsight });
  });
  const projectionOrder = projection.findings.map((finding) => finding.id);
  const legacyOrder = intelligence.insights.map((insight) => insight.id);
  const classification = canonicalSnapshotJson(projectionOrder) === canonicalSnapshotJson(legacyOrder)
    ? "exact" as const
    : "ordering_only" as const;

  return {
    insights,
    parity: { status: "exact", classification } satisfies IntelligenceInboxSnapshotParityV1
  };
}
