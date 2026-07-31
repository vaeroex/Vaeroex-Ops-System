import { createHash } from "node:crypto";
import type { IntelligenceInsight } from "@/lib/intelligence/layer";
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import type { FindingSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";
import {
  INTELLIGENCE_CARD_LIFECYCLE_VERSION,
  type IntelligenceCardIdentityV1,
  type IntelligenceCardSnapshotV1
} from "@/lib/intelligence/card-lifecycle/contracts";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildIntelligenceCardIdentityV1({
  insight,
  finding
}: {
  insight: IntelligenceInsight;
  finding?: FindingSnapshotV1 | null;
}): IntelligenceCardIdentityV1 {
  const deterministicDependencyIds = finding
    ? [...finding.deterministicDependencies.kpiIds, ...finding.deterministicDependencies.evidenceReferenceIds].sort()
    : insight.supportingRecords.map((record) => `intelligence-layer:${record.id}`).sort();
  const materialSignatureInput = canonicalSnapshotJson({
    type: insight.type,
    priority: insight.priority,
    confidence: insight.confidence,
    affectedArea: insight.affectedArea,
    deterministicDependencyIds
  });

  return {
    findingKeyHash: sha256(insight.fingerprint),
    materialSignature: sha256(materialSignatureInput),
    deterministicDependencyIds
  };
}

function bounded(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function buildIntelligenceCardSnapshotV1(insight: IntelligenceInsight): IntelligenceCardSnapshotV1 {
  return {
    version: INTELLIGENCE_CARD_LIFECYCLE_VERSION,
    findingId: bounded(insight.id, 500),
    type: insight.type,
    title: bounded(insight.title, 200),
    summary: bounded(insight.summary, 600),
    priority: insight.priority,
    confidence: insight.confidence,
    affectedArea: bounded(insight.affectedArea, 160),
    lastUpdated: insight.lastUpdated
  };
}
