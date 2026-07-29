import "server-only";

import { buildFindingExplanationPackage } from "@/lib/ai/finding-explanation/context";
import type { FindingExplanationPackage } from "@/lib/ai/finding-explanation/contracts";
import type { IntelligenceInsight } from "@/lib/intelligence/layer";
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import { materializeFindingPresentationV1 } from "@/lib/intelligence/snapshot/v1/consumers/intelligence-inbox";
import { projectFindingExplanationV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { IntelligenceSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

export type FindingExplanationSnapshotParityV1 = Readonly<{
  status: "exact" | "fallback";
  classification: "exact" | "adapter_defect";
  legacyFingerprint: string | null;
  snapshotFingerprint: string;
}>;

function packagesMatch(left: FindingExplanationPackage, right: FindingExplanationPackage) {
  return canonicalSnapshotJson(left) === canonicalSnapshotJson(right);
}

function legacyFallback({
  workspaceId,
  insight,
  now,
  snapshot,
  reason
}: {
  workspaceId: string;
  insight: IntelligenceInsight;
  now: Date;
  snapshot: IntelligenceSnapshotV1;
  reason: string;
}) {
  const analysisPackage = buildFindingExplanationPackage({ workspaceId, insight, now });
  const parity = {
    status: "fallback",
    classification: "adapter_defect",
    legacyFingerprint: analysisPackage.fingerprint,
    snapshotFingerprint: snapshot.fingerprints.snapshot
  } satisfies FindingExplanationSnapshotParityV1;
  console.error(JSON.stringify({
    level: "error",
    component: "finding-explanation",
    event: "snapshot_v1_projection_fallback",
    classification: parity.classification,
    reason
  }));
  return { analysisPackage, parity };
}

export function buildFindingExplanationFromSnapshotV1({
  workspaceId,
  insight,
  snapshot,
  now = new Date(snapshot.scope.asOf)
}: {
  workspaceId: string;
  insight: IntelligenceInsight;
  snapshot: IntelligenceSnapshotV1;
  now?: Date;
}) {
  if (snapshot.scope.workspaceId !== workspaceId) throw new Error("Finding explanation snapshot belongs to another workspace.");
  if (!Number.isFinite(now.getTime())) throw new Error("Finding explanation asOf must be a valid timestamp.");
  const projection = projectFindingExplanationV1(snapshot, insight.id);

  try {
    if (projection.finding.state !== "available") throw new Error("finding_not_available");
    const projectedInsight = materializeFindingPresentationV1({
      finding: projection.finding.value,
      legacyInsight: insight
    });
    const analysisPackage = buildFindingExplanationPackage({ workspaceId, insight: projectedInsight, now });
    let parity: FindingExplanationSnapshotParityV1 = {
      status: "exact",
      classification: "exact",
      legacyFingerprint: null,
      snapshotFingerprint: snapshot.fingerprints.snapshot
    };

    if (process.env.VERCEL_ENV === "preview") {
      const legacyPackage = buildFindingExplanationPackage({ workspaceId, insight, now });
      if (!packagesMatch(legacyPackage, analysisPackage)) {
        return {
          ...legacyFallback({ workspaceId, insight, now, snapshot, reason: "package_parity_mismatch" }),
          projection
        };
      }
      parity = { ...parity, legacyFingerprint: legacyPackage.fingerprint };
    }

    return { analysisPackage, projection, parity };
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    return {
      ...legacyFallback({
        workspaceId,
        insight,
        now,
        snapshot,
        reason: error instanceof Error ? error.message : "package_construction_failed"
      }),
      projection
    };
  }
}
