import { createHash } from "node:crypto";
import { z } from "zod";

import {
  ContractJsonValueSchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";
import {
  CanonicalBusinessFactVersionSchema,
  ExternalSourceRecordVersionSchema
} from "@/lib/integrations/contracts/source-facts";
import { BusinessStateDeltaV1Schema } from "@/lib/integrations/contracts/intelligence";
import { EXTERNAL_INTEGRATION_CONTRACT_VERSIONS } from "@/lib/integrations/contracts/versions";

export const IntegrationFingerprintPurposeSchema = z.enum([
  "external_source_record",
  "canonical_business_fact",
  "business_state_delta"
]);

export const IntegrationFingerprintEnvelopeSchema = z
  .object({
    fingerprintPurpose: IntegrationFingerprintPurposeSchema,
    fingerprintVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.fingerprint),
    payload: ContractJsonValueSchema
  })
  .strict();

export type IntegrationFingerprintEnvelope = Readonly<z.infer<typeof IntegrationFingerprintEnvelopeSchema>>;

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError("Canonical contract numbers must be non-negative-zero safe integers; use canonical decimal strings for decimals");
    }
    return value;
  }
  if (["undefined", "bigint", "function", "symbol"].includes(typeof value)) {
    throw new TypeError(`Unsupported canonical contract value: ${typeof value}`);
  }
  if (typeof value !== "object") throw new TypeError("Unsupported canonical contract value");
  if (ancestors.has(value)) throw new TypeError("Canonical contract values cannot contain cycles");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError("Canonical contract arrays cannot be sparse");
        }
      }
      if (Object.keys(value).some((key, index) => key !== String(index))) {
        throw new TypeError("Canonical contract arrays cannot have custom enumerable properties");
      }
      const allowedArrayKeys = new Set(["length", ...value.map((_, index) => String(index))]);
      if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowedArrayKeys.has(key))) {
        throw new TypeError("Canonical contract arrays cannot have custom properties");
      }
      return value.map((item) => canonicalize(item, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical contract values must use plain objects");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Canonical contract objects cannot have symbol keys");
    }

    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    const stringKeys = ownKeys as string[];
    for (const key of stringKeys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Canonical contract objects must contain enumerable data properties only");
      }
      ordered[key] = canonicalize(record[key], ancestors);
    }
    return ordered;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalContractJson(value: unknown) {
  return JSON.stringify(canonicalize(value, new Set<object>()));
}

export function contractSha256(value: unknown) {
  return Sha256FingerprintSchema.parse(
    `sha256:${createHash("sha256").update(canonicalContractJson(value), "utf8").digest("hex")}`
  );
}

function sortSemanticSet<T>(values: readonly T[]) {
  return [...values].sort((left, right) => {
    const leftJson = canonicalContractJson(left);
    const rightJson = canonicalContractJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function fingerprintEnvelope(
  fingerprintPurpose: z.infer<typeof IntegrationFingerprintPurposeSchema>,
  payload: unknown
) {
  return IntegrationFingerprintEnvelopeSchema.parse({
    fingerprintPurpose,
    fingerprintVersion: EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.fingerprint,
    payload
  });
}

export function externalSourceFingerprintInput(input: unknown): IntegrationFingerprintEnvelope {
  const source = ExternalSourceRecordVersionSchema.parse(input);
  return fingerprintEnvelope("external_source_record", {
    contractVersion: source.contractVersion,
    workspaceId: source.workspaceId,
    businessEntityId: source.businessEntityId,
    connectionId: source.connectionId,
    recordKind: source.recordKind,
    source: source.source,
    temporal: {
      basis: source.temporal.basis,
      providerCreatedAt: source.temporal.providerCreatedAt,
      providerUpdatedAt: source.temporal.providerUpdatedAt,
      observedAt: source.temporal.observedAt,
      effectiveAt: source.temporal.effectiveAt,
      postingDate: source.temporal.postingDate,
      periodStart: source.temporal.periodStart,
      periodEnd: source.temporal.periodEnd,
      sourceTimeZone: source.temporal.sourceTimeZone
    },
    accounting: source.accounting,
    normalizedSchemaVersion: source.normalizedSchemaVersion,
    changeKind: source.changeKind,
    normalizedProjection: source.normalizedProjection,
    trust: source.trust
  });
}

export function externalSourceFingerprint(input: unknown) {
  return contractSha256(externalSourceFingerprintInput(input));
}

export function canonicalFactFingerprintInput(input: unknown): IntegrationFingerprintEnvelope {
  const fact = CanonicalBusinessFactVersionSchema.parse(input);
  return fingerprintEnvelope("canonical_business_fact", {
    contractVersion: fact.contractVersion,
    workspaceId: fact.workspaceId,
    businessEntityId: fact.businessEntityId,
    factKind: fact.factKind,
    factKey: fact.factKey,
    dimensions: sortSemanticSet(fact.dimensions),
    temporal: fact.temporal,
    accounting: fact.accounting,
    value: fact.value,
    reconciliationState: fact.reconciliationState,
    validationState: fact.validationState,
    sources: sortSemanticSet(fact.sources),
    normalizationVersion: fact.normalizationVersion,
    transformationVersion: fact.transformationVersion,
    sourceObservedAt: fact.sourceObservedAt,
    decision: {
      authority: fact.decision.authority,
      policyVersion: fact.decision.policyVersion,
      actorId: fact.decision.actorId,
      reasonCodes: sortSemanticSet(fact.decision.reasonCodes)
    }
  });
}

export function canonicalFactFingerprint(input: unknown) {
  return contractSha256(canonicalFactFingerprintInput(input));
}

export function businessStateDeltaFingerprintInput(input: unknown): IntegrationFingerprintEnvelope {
  const delta = BusinessStateDeltaV1Schema.parse(input);
  return fingerprintEnvelope("business_state_delta", {
    contractVersion: delta.contractVersion,
    workspaceId: delta.workspaceId,
    businessEntityId: delta.businessEntityId,
    changeSetId: delta.changeSetId,
    fromDeterministicWatermark: delta.fromDeterministicWatermark,
    toDeterministicWatermark: delta.toDeterministicWatermark,
    fromStateFingerprint: delta.fromStateFingerprint,
    toStateFingerprint: delta.toStateFingerprint,
    window: delta.window,
    sourceWatermarks: sortSemanticSet(delta.sourceWatermarks),
    freshness: sortSemanticSet(
      delta.freshness.map((state) => ({
        connectionId: state.connectionId,
        mappingId: state.mappingId,
        domain: state.domain,
        scopeKey: state.scopeKey,
        providerWatermarkAt: state.providerWatermarkAt,
        policyVersion: state.policyVersion,
        status: state.status,
        blockingLevel: state.blockingLevel,
        reasonCode: state.reasonCode,
        currentMaxAgeSeconds: state.currentMaxAgeSeconds,
        staleAfterSeconds: state.staleAfterSeconds
      }))
    ),
    changes: sortSemanticSet(
      delta.changes.map((change) => ({
        ...change,
        evidence: sortSemanticSet(
          change.evidence.map((reference) => ({
            ...reference,
            sourceFingerprints: sortSemanticSet(reference.sourceFingerprints)
          }))
        )
      }))
    ),
    correlatedGroups: sortSemanticSet(
      delta.correlatedGroups.map((group) => ({
        ...group,
        memberChangeKeys: sortSemanticSet(group.memberChangeKeys)
      }))
    ),
    deterministicRisks: sortSemanticSet(
      delta.deterministicRisks.map((risk) => ({
        ...risk,
        evidenceFactFingerprints: sortSemanticSet(risk.evidenceFactFingerprints)
      }))
    ),
    deterministicOpportunities: sortSemanticSet(
      delta.deterministicOpportunities.map((opportunity) => ({
        ...opportunity,
        evidenceFactFingerprints: sortSemanticSet(opportunity.evidenceFactFingerprints)
      }))
    ),
    materiality: {
      ...delta.materiality,
      reasons: sortSemanticSet(delta.materiality.reasons)
    },
    limitations: sortSemanticSet(delta.limitations),
    eligibleRoutes: sortSemanticSet(delta.eligibleRoutes)
  });
}

export function businessStateDeltaFingerprint(input: unknown) {
  return contractSha256(businessStateDeltaFingerprintInput(input));
}
