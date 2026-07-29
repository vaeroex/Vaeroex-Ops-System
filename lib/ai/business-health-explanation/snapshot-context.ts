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
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { projectBusinessHealthExplanationV1 } from "@/lib/intelligence/snapshot/v1/projections";

export type BusinessHealthExplanationSnapshotParity = Readonly<{
  status: "exact" | "fallback";
  classification: "exact" | "adapter_defect";
  legacyFingerprint: string | null;
  snapshotFingerprint: string;
}>;

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
  const build = buildIntelligenceSnapshotFromProducersV1({
    workspaceId,
    asOf,
    intelligence,
    coverage,
    evidenceManifests: [manifest]
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
