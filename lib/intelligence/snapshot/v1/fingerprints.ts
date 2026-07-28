import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { IntelligenceSnapshotV1, SnapshotState } from "@/lib/intelligence/snapshot/v1/types";
import { INTELLIGENCE_SNAPSHOT_FINGERPRINT_VERSION } from "@/lib/intelligence/snapshot/v1/versions";

function stateFingerprint<T>(state: SnapshotState<T>, value: (input: T) => unknown = (input) => input) {
  return state.state === "available"
    ? { state: state.state, value: value(state.value) }
    : { state: state.state, reasonCode: state.reason.code };
}

export function semanticSnapshotFingerprintPayload(snapshot: IntelligenceSnapshotV1) {
  return {
    contract: snapshot.contract,
    scope: snapshot.scope,
    versions: snapshot.versions,
    businessHealth: stateFingerprint(snapshot.businessHealth, (health) => ({
      score: health.score,
      status: health.status,
      trajectory: health.trajectory,
      confidence: health.confidence,
      components: stateFingerprint(health.components)
    })),
    dataQuality: stateFingerprint(snapshot.dataQuality),
    readiness: {
      forecast: stateFingerprint(snapshot.readiness.forecast, (forecast) => ({
        state: forecast.state,
        ready: forecast.ready,
        directional: forecast.directional,
        currentKpiCount: forecast.currentKpiCount,
        totalMeasurementCount: forecast.totalMeasurementCount,
        readyKpiCount: forecast.readyKpiCount,
        directionalKpiCount: forecast.directionalKpiCount
      })),
      coverage: stateFingerprint(snapshot.readiness.coverage, (coverage) => ({
        overallCoverage: coverage.overallCoverage,
        overallConfidenceLabel: coverage.overallConfidenceLabel,
        categories: coverage.categories,
        evidenceSummary: coverage.evidenceSummary
      }))
    },
    kpis: snapshot.kpis.map((kpi) => ({
      id: kpi.id,
      identity: {
        canonicalName: kpi.identity.canonicalName,
        unit: kpi.identity.unit,
        scale: kpi.identity.scale,
        metricRole: kpi.identity.metricRole
      },
      semantics: stateFingerprint(kpi.semantics),
      manualTarget: stateFingerprint(kpi.manualTarget),
      configuredSemanticTarget: stateFingerprint(kpi.configuredSemanticTarget),
      effectiveAuthoritativeTarget: stateFingerprint(kpi.effectiveAuthoritativeTarget),
      recommendationAvailability: kpi.recommendationAvailability,
      recommendedNextTarget: stateFingerprint(kpi.recommendedNextTarget),
      observations: kpi.observations,
      performance: stateFingerprint(kpi.performance),
      freshness: stateFingerprint(kpi.freshness),
      evidenceReferenceIds: kpi.evidenceReferenceIds
    })),
    findings: snapshot.findings.map((finding) => ({
      id: finding.id,
      fingerprint: finding.fingerprint,
      origin: finding.origin,
      producerId: finding.producerId,
      producerVersion: finding.producerVersion,
      type: finding.type,
      priority: finding.priority,
      confidence: finding.confidence,
      affectedArea: finding.affectedArea,
      timePeriod: finding.timePeriod,
      lastUpdated: finding.lastUpdated,
      deterministicDependencies: finding.deterministicDependencies,
      citationIds: finding.citationIds
    })),
    findingIndex: snapshot.findingIndex,
    priorities: snapshot.priorities,
    evidence: snapshot.evidence,
    limitations: snapshot.limitations.map(({ code, scope, severity }) => ({ code, scope, severity })),
    provenance: snapshot.provenance.map(({ producerId, producerVersion, workspaceId, asOf, semanticInputFingerprint }) => ({
      producerId,
      producerVersion,
      workspaceId,
      asOf,
      semanticInputFingerprint
    }))
  };
}

export function semanticInputFingerprintPayload(snapshot: IntelligenceSnapshotV1) {
  return {
    contract: snapshot.contract,
    scope: snapshot.scope,
    versions: snapshot.versions,
    provenance: snapshot.provenance.map(({ producerId, producerVersion, workspaceId, asOf, semanticInputFingerprint }) => ({
      producerId,
      producerVersion,
      workspaceId,
      asOf,
      semanticInputFingerprint
    }))
  };
}

export function fingerprintSnapshotInputs(snapshot: IntelligenceSnapshotV1) {
  return snapshotHash({
    fingerprintVersion: INTELLIGENCE_SNAPSHOT_FINGERPRINT_VERSION,
    semanticInputs: semanticInputFingerprintPayload(snapshot)
  });
}

export function fingerprintSemanticSnapshot(snapshot: IntelligenceSnapshotV1) {
  return snapshotHash(semanticSnapshotFingerprintPayload(snapshot));
}
