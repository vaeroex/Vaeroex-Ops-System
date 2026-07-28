import type {
  CitationReferenceV1,
  CoverageCategorySnapshotV1,
  EvidenceReferenceV1,
  FindingSnapshotV1,
  KpiObservationPointV1,
  KpiSnapshotV1,
  PriorityRoleV1,
  PrioritySnapshotV1,
  ProducerReceiptV1,
  SnapshotLimitationV1
} from "@/lib/intelligence/snapshot/v1/types";

const priorityRank = { High: 3, Medium: 2, Low: 1 } as const;
const confidenceRank = { High: 3, Medium: 2, Low: 1 } as const;
const priorityRoleRank: Record<PriorityRoleV1, number> = {
  top_risk: 1,
  top_opportunity: 2,
  top_recommendation: 3,
  top_forecast: 4
};

export function canonicalKpiIdentity(kpi: Pick<KpiSnapshotV1, "identity">) {
  return [
    kpi.identity.canonicalName.trim().toLowerCase(),
    kpi.identity.metricRole,
    `${kpi.identity.scale}`,
    (kpi.identity.unit || "").trim().toLowerCase()
  ].join("|");
}

export function orderObservationPoints(values: readonly KpiObservationPointV1[]) {
  return [...values].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt) || left.observationId.localeCompare(right.observationId)
  );
}

export function orderKpis(values: readonly KpiSnapshotV1[]) {
  return [...values].map((kpi) => ({
    ...kpi,
    observations: {
      ...kpi.observations,
      selectedRange: {
        ...kpi.observations.selectedRange,
        boundedObservations: orderObservationPoints(kpi.observations.selectedRange.boundedObservations)
      }
    },
    evidenceReferenceIds: [...kpi.evidenceReferenceIds].sort()
  })).sort((left, right) => canonicalKpiIdentity(left).localeCompare(canonicalKpiIdentity(right)) || left.id.localeCompare(right.id));
}

export function compareFindings(left: FindingSnapshotV1, right: FindingSnapshotV1) {
  return priorityRank[right.priority] - priorityRank[left.priority]
    || confidenceRank[right.confidence] - confidenceRank[left.confidence]
    || right.lastUpdated.localeCompare(left.lastUpdated)
    || left.fingerprint.localeCompare(right.fingerprint)
    || left.id.localeCompare(right.id);
}

export function orderFindings(values: readonly FindingSnapshotV1[]) {
  return [...values].map((finding) => ({
    ...finding,
    deterministicDependencies: {
      kpiIds: [...finding.deterministicDependencies.kpiIds].sort(),
      evidenceReferenceIds: [...finding.deterministicDependencies.evidenceReferenceIds].sort()
    },
    citationIds: [...finding.citationIds].sort()
  })).sort(compareFindings);
}

export function orderPriorities(values: readonly PrioritySnapshotV1[]) {
  return [...values].sort((left, right) =>
    priorityRoleRank[left.role] - priorityRoleRank[right.role] || left.findingId.localeCompare(right.findingId)
  );
}

export function orderEvidenceReferences(values: readonly EvidenceReferenceV1[]) {
  return [...values].map((reference) => ({
    ...reference,
    sourceIds: [...reference.sourceIds].sort(),
    lineageIds: [...reference.lineageIds].sort()
  })).sort((left, right) =>
    left.sourceKeyHash.localeCompare(right.sourceKeyHash)
    || (left.recordedAt || "").localeCompare(right.recordedAt || "")
    || left.recordId.localeCompare(right.recordId)
    || left.id.localeCompare(right.id)
  );
}

export function orderCitations(values: readonly CitationReferenceV1[]) {
  return [...values].sort((left, right) =>
    left.manifestId.localeCompare(right.manifestId)
    || left.sourceOrdinal.localeCompare(right.sourceOrdinal)
    || left.id.localeCompare(right.id)
  );
}

export function orderCoverageCategories(values: readonly CoverageCategorySnapshotV1[]) {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

export function orderLimitations(values: readonly SnapshotLimitationV1[]) {
  return [...values].sort((left, right) =>
    left.code.localeCompare(right.code) || left.scope.localeCompare(right.scope) || left.message.localeCompare(right.message)
  );
}

export function orderProvenance(values: readonly ProducerReceiptV1[]) {
  return [...values].sort((left, right) =>
    left.producerId.localeCompare(right.producerId) || left.producerVersion.localeCompare(right.producerVersion)
  );
}
