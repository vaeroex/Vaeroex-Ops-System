import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";
import { adaptCoverageProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/coverage";
import { adaptEvidenceManifestProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/evidence";
import { adaptIntelligenceLayerProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/intelligence-layer";
import { adaptKpiProducerOutputV1 } from "@/lib/intelligence/snapshot/v1/adapters/kpis";
import { canonicalSnapshotJson, snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import { fingerprintSemanticSnapshot, fingerprintSnapshotInputs } from "@/lib/intelligence/snapshot/v1/fingerprints";
import { assertIntelligenceSnapshotV1Invariants } from "@/lib/intelligence/snapshot/v1/invariants";
import {
  orderCitations,
  orderCoverageCategories,
  orderEvidenceReferences,
  orderFindings,
  orderKpis,
  orderLimitations,
  orderPriorities,
  orderProvenance
} from "@/lib/intelligence/snapshot/v1/ordering";
import {
  intelligenceSnapshotBuildReceiptV1Schema,
  intelligenceSnapshotV1Schema
} from "@/lib/intelligence/snapshot/v1/schema";
import { unavailable } from "@/lib/intelligence/snapshot/v1/state";
import type {
  CoverageProducerOutputV1,
  EvidenceManifestProducerOutputV1,
  IntelligenceLayerProducerOutputV1,
  IntelligenceProducerEnvelopeV1,
  IntelligenceSnapshotBuildResultV1,
  IntelligenceSnapshotV1,
  IntelligenceSnapshotVersionsV1,
  CoverageSnapshotV1,
  KpiProducerOutputV1,
  ProducerReceiptV1,
  SnapshotLimitationV1,
  SnapshotState
} from "@/lib/intelligence/snapshot/v1/types";
import {
  INTELLIGENCE_LAYER_PRODUCER_ID,
  KPI_DETERMINISTIC_PRODUCER_ID,
  COVERAGE_PRODUCER_ID,
  EVIDENCE_MANIFEST_PRODUCER_ID,
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  INTELLIGENCE_SNAPSHOT_BUILDER_VERSION,
  INTELLIGENCE_SNAPSHOT_CONTRACT_ID,
  INTELLIGENCE_SNAPSHOT_CONTRACT_VERSION,
  INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_PRODUCER_VERSIONS,
  type SupportedProducerId
} from "@/lib/intelligence/snapshot/v1/versions";

const EMPTY_FINGERPRINT = `sha256:${"0".repeat(64)}`;

export type BuildIntelligenceSnapshotV1Input = Readonly<{
  workspaceId: string;
  asOf: string;
  evaluationDate: string;
  generatedAt: string;
  versions: IntelligenceSnapshotVersionsV1;
  intelligenceLayer: IntelligenceProducerEnvelopeV1<IntelligenceLayerProducerOutputV1>;
  kpis?: IntelligenceProducerEnvelopeV1<KpiProducerOutputV1>;
  coverage?: IntelligenceProducerEnvelopeV1<CoverageProducerOutputV1>;
  evidenceManifests?: IntelligenceProducerEnvelopeV1<EvidenceManifestProducerOutputV1>;
}>;

function nowMs() {
  return globalThis.performance?.now?.() ?? 0;
}

function assertEnvelope<T>({
  envelope,
  expectedProducerId,
  workspaceId,
  asOf
}: {
  envelope: IntelligenceProducerEnvelopeV1<T>;
  expectedProducerId: SupportedProducerId;
  workspaceId: string;
  asOf: string;
}) {
  if (envelope.producerId !== expectedProducerId) {
    throw new Error(`Expected ${expectedProducerId}, received ${envelope.producerId}.`);
  }
  if (envelope.producerVersion !== SUPPORTED_PRODUCER_VERSIONS[expectedProducerId]) {
    throw new Error(`Unsupported ${expectedProducerId} producer version ${envelope.producerVersion}.`);
  }
  if (envelope.workspaceId !== workspaceId) {
    throw new Error(`Producer ${expectedProducerId} belongs to a different workspace.`);
  }
  if (envelope.asOf !== asOf) {
    throw new Error(`Producer ${expectedProducerId} used a different asOf cutoff.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(envelope.semanticInputFingerprint)) {
    throw new Error(`Producer ${expectedProducerId} did not provide a valid semantic input fingerprint.`);
  }
}

function producerReceipt<T>(envelope: IntelligenceProducerEnvelopeV1<T>): ProducerReceiptV1 {
  return {
    producerId: envelope.producerId,
    producerVersion: envelope.producerVersion,
    workspaceId: envelope.workspaceId,
    asOf: envelope.asOf,
    semanticInputFingerprint: envelope.semanticInputFingerprint
  };
}

export function buildIntelligenceSnapshotV1(input: BuildIntelligenceSnapshotV1Input): IntelligenceSnapshotBuildResultV1 {
  const totalStartedAt = nowMs();
  if (!input.workspaceId.trim()) throw new Error("workspaceId is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.evaluationDate)) throw new Error("evaluationDate must use YYYY-MM-DD.");
  if (canonicalSnapshotJson(input.versions) !== canonicalSnapshotJson(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1)) {
    throw new Error("Unsupported IntelligenceSnapshotV1 calculation, policy, ordering, or adapter version map.");
  }

  assertEnvelope({
    envelope: input.intelligenceLayer,
    expectedProducerId: INTELLIGENCE_LAYER_PRODUCER_ID,
    workspaceId: input.workspaceId,
    asOf: input.asOf
  });
  if (input.kpis) {
    for (const metric of input.kpis.output) {
      if (metric.workspaceId !== input.workspaceId) throw new Error(`KPI ${metric.id} belongs to another workspace.`);
    }
    assertEnvelope({
      envelope: input.kpis,
      expectedProducerId: KPI_DETERMINISTIC_PRODUCER_ID,
      workspaceId: input.workspaceId,
      asOf: input.asOf
    });
  }
  if (input.coverage) {
    assertEnvelope({ envelope: input.coverage, expectedProducerId: COVERAGE_PRODUCER_ID, workspaceId: input.workspaceId, asOf: input.asOf });
  }
  if (input.evidenceManifests) {
    assertEnvelope({
      envelope: input.evidenceManifests,
      expectedProducerId: EVIDENCE_MANIFEST_PRODUCER_ID,
      workspaceId: input.workspaceId,
      asOf: input.asOf
    });
    for (const manifest of input.evidenceManifests.output) {
      if (manifest.workspaceId !== input.workspaceId) throw new Error(`Evidence manifest ${manifest.manifestId} belongs to another workspace.`);
      if (manifest.sourceRegistry.workspaceId !== input.workspaceId) {
        throw new Error(`Evidence manifest ${manifest.manifestId} has a foreign source registry.`);
      }
    }
  }

  const adapterStartedAt = nowMs();
  const layer = adaptIntelligenceLayerProducerOutputV1({
    workspaceId: input.workspaceId,
    producerVersion: input.intelligenceLayer.producerVersion,
    evidenceEligibilityPolicyVersion: input.versions.policies.evidenceEligibility,
    lineageVersion: input.versions.policies.lineage,
    output: input.intelligenceLayer.output
  });
  const kpis = input.kpis ? adaptKpiProducerOutputV1(input.kpis.output) : [];
  const coverage: SnapshotState<CoverageSnapshotV1> = input.coverage
    ? adaptCoverageProducerOutputV1(input.coverage.output)
    : unavailable("unavailable", "missing_producer");
  const manifestEvidence = input.evidenceManifests
    ? adaptEvidenceManifestProducerOutputV1(input.evidenceManifests.output)
    : { references: [], citations: [], sourceRegistryVersions: [] };
  const adapterMs = nowMs() - adapterStartedAt;

  const limitations: SnapshotLimitationV1[] = [
    ...layer.limitations,
    ...(!input.kpis ? [{
      code: "kpi_producer_not_supplied",
      scope: "kpi" as const,
      severity: "information" as const,
      message: "KPI producer output was not required by this scoped snapshot consumer."
    }] : []),
    ...(!input.coverage ? [{
      code: "coverage_producer_not_supplied",
      scope: "coverage" as const,
      severity: "information" as const,
      message: "Coverage was not supplied to this snapshot build."
    }] : [])
  ];
  const provenance = [
    producerReceipt(input.intelligenceLayer),
    ...(input.kpis ? [producerReceipt(input.kpis)] : []),
    ...(input.coverage ? [producerReceipt(input.coverage)] : []),
    ...(input.evidenceManifests ? [producerReceipt(input.evidenceManifests)] : [])
  ];

  const orderingStartedAt = nowMs();
  const orderedFindings = orderFindings(layer.findings);
  const orderedKpis = orderKpis(kpis);
  const orderedCoverage = coverage.state === "available"
    ? { state: "available" as const, value: { ...coverage.value, categories: orderCoverageCategories(coverage.value.categories) } }
    : coverage;
  const orderedEvidence = orderEvidenceReferences([...layer.evidenceReferences, ...manifestEvidence.references]);
  const orderedCitations = orderCitations(manifestEvidence.citations);
  const findingIndex = {
    riskFindingIds: orderedFindings.filter((finding) => ["Risk", "Bottleneck", "Anomaly"].includes(finding.type)).map((finding) => finding.id),
    opportunityFindingIds: orderedFindings.filter((finding) => finding.type === "Opportunity").map((finding) => finding.id),
    recommendationFindingIds: orderedFindings.filter((finding) => finding.type === "Recommendation").map((finding) => finding.id),
    forecastFindingIds: orderedFindings.filter((finding) => finding.type === "Forecast").map((finding) => finding.id)
  };
  const orderingMs = nowMs() - orderingStartedAt;

  let snapshot: IntelligenceSnapshotV1 = {
    contract: {
      id: INTELLIGENCE_SNAPSHOT_CONTRACT_ID,
      version: INTELLIGENCE_SNAPSHOT_CONTRACT_VERSION,
      schemaVersion: INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION
    },
    scope: {
      workspaceId: input.workspaceId,
      asOf: input.asOf,
      evaluationDate: input.evaluationDate
    },
    versions: input.versions,
    fingerprints: { input: EMPTY_FINGERPRINT, snapshot: EMPTY_FINGERPRINT },
    businessHealth: layer.businessHealth,
    dataQuality: layer.dataQuality,
    readiness: {
      forecast: layer.forecastReadiness,
      coverage: orderedCoverage
    },
    kpis: orderedKpis,
    findings: orderedFindings,
    findingIndex,
    priorities: orderPriorities(layer.priorities),
    evidence: {
      references: orderedEvidence,
      citations: orderedCitations,
      sourceRegistryVersions: [...manifestEvidence.sourceRegistryVersions].sort()
    },
    limitations: orderLimitations(limitations),
    provenance: orderProvenance(provenance)
  };

  const hashingStartedAt = nowMs();
  const inputFingerprint = fingerprintSnapshotInputs(snapshot);
  snapshot = { ...snapshot, fingerprints: { input: inputFingerprint, snapshot: EMPTY_FINGERPRINT } };
  const snapshotFingerprint = fingerprintSemanticSnapshot(snapshot);
  snapshot = { ...snapshot, fingerprints: { input: inputFingerprint, snapshot: snapshotFingerprint } };
  const hashingMs = nowMs() - hashingStartedAt;

  const validationStartedAt = nowMs();
  const parsedSnapshot = intelligenceSnapshotV1Schema.parse(snapshot);
  const invariantCount = assertIntelligenceSnapshotV1Invariants(parsedSnapshot);
  const validationMs = nowMs() - validationStartedAt;

  const serializationStartedAt = nowMs();
  const serialized = canonicalSnapshotJson(parsedSnapshot);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;
  const serializationMs = nowMs() - serializationStartedAt;
  const totalMs = nowMs() - totalStartedAt;
  const receipt = intelligenceSnapshotBuildReceiptV1Schema.parse({
    id: snapshotHash({
      builderVersion: INTELLIGENCE_SNAPSHOT_BUILDER_VERSION,
      generatedAt: input.generatedAt,
      snapshotFingerprint
    }),
    snapshotFingerprint,
    workspaceId: input.workspaceId,
    generatedAt: input.generatedAt,
    builderVersion: INTELLIGENCE_SNAPSHOT_BUILDER_VERSION,
    validation: { status: "passed", invariantCount },
    adapterVersions: input.versions.adapters,
    performance: { totalMs, adapterMs, orderingMs, validationMs, hashingMs, serializationMs },
    fixtureSizes: {
      kpis: parsedSnapshot.kpis.length,
      findings: parsedSnapshot.findings.length,
      evidenceReferences: parsedSnapshot.evidence.references.length,
      citations: parsedSnapshot.evidence.citations.length,
      serializedBytes
    }
  });

  return deepFreeze({ snapshot: parsedSnapshot, receipt });
}
