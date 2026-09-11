import "server-only";

import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, Sha256FingerprintSchema } from "@/lib/integrations/contracts/primitives";
import { prepareCanonicalFactVersionCommit, prepareExternalSourceVersionCommit } from "@/lib/integrations/persistence/serializers";
import { assertSquarePendingSource, materializeSquarePendingSource, SQUARE_SOURCE_MAPPING_VERSION } from "@/lib/integrations/providers/square/ingestion-mapping";
import type { SquarePendingSource } from "@/lib/integrations/providers/square/ingestion-contracts";

export const SQUARE_OBSERVATION_ADMISSION_POLICY = "square_sandbox_observation_admission_v1" as const;
export const SQUARE_OBSERVATION_RECORD_TYPES = ["square_payment", "square_refund", "square_order_tenders",
  "square_catalog_primary_item_variation", "square_inventory_count_snapshot", "square_inventory_physical_count",
  "square_inventory_adjustment"] as const;
export const SQUARE_OBSERVATION_POLICY_FINGERPRINT = contractSha256({ policyVersion: SQUARE_OBSERVATION_ADMISSION_POLICY,
  recordTypes: [...SQUARE_OBSERVATION_RECORD_TYPES].sort(), classification: "verified_provider_observation",
  economic: "blocked", historical: "unknown" });

// Supplied only by the transactionally checked repository, never browser claims.
// This pure function does not authenticate the caller or replace database locks.
const AuthoritySchema = z.object({ scopeFingerprint: Sha256FingerprintSchema, resourceKey: Sha256FingerprintSchema,
  currentVersionKey: Sha256FingerprintSchema, sourceFingerprint: Sha256FingerprintSchema,
  admittedAt: IsoTimestampSchema,
  ordering: z.enum(["same", "newer", "older", "conflict", "unordered"]) }).strict();
export type SquareObservationAuthority = z.infer<typeof AuthoritySchema>;
function invalid(): never { throw new Error("square_observation_admission_invalid"); }
function uuid(hash: string) { const h = hash.slice(7); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

/** Read-only derivation. The source stays pending; this is NOT economic admission. */
export function prepareSquareObservationAdmission(input: {
  pending: SquarePendingSource; sourceVersion: unknown; currentAuthority: SquareObservationAuthority;
}) {
  const pending = assertSquarePendingSource(input.pending);
  const authority = AuthoritySchema.parse(input.currentAuthority);
  const source = prepareExternalSourceVersionCommit(input.sourceVersion).version;
  const expected = materializeSquarePendingSource(pending, source.immutableVersion, source.priorVersionId);
  if (contractSha256(source) !== contractSha256(expected) || authority.sourceFingerprint !== source.sourceFingerprint ||
    authority.resourceKey !== pending.resourceKey || authority.scopeFingerprint !== contractSha256(pending.scope)) invalid();
  if (pending.scope.environment !== "sandbox") return { outcome: "excluded", reason: "environment" } as const;
  if (authority.ordering === "conflict" || authority.ordering === "unordered") return { outcome: "excluded", reason: "conflict" } as const;
  if (authority.currentVersionKey !== pending.versionKey || authority.ordering === "older") return { outcome: "excluded", reason: "stale" } as const;
  if (pending.deleted) return { outcome: "excluded", reason: "deleted" } as const;
  if (!(SQUARE_OBSERVATION_RECORD_TYPES as readonly string[]).includes(pending.providerRecordType)) return { outcome: "excluded", reason: "unsupported" } as const;
  const policyVersion = SQUARE_OBSERVATION_ADMISSION_POLICY;
  const factKey = contractSha256({ purpose: "square_observation_fact_identity_v1", policyVersion, resourceKey: pending.resourceKey });
  const id = uuid(contractSha256({ purpose: "square_observation_fact_version_v1", policyVersion,
    resourceKey: pending.resourceKey, versionKey: pending.versionKey }));
  const prepared = prepareCanonicalFactVersionCommit({ contractVersion: "canonical_business_fact_version_v2", id,
    workspaceId: pending.scope.workspaceId, businessEntityId: pending.scope.businessEntityId,
    immutableVersion: source.immutableVersion, factKind: `${pending.providerRecordType}_observation`, factKey, dimensions: [],
    temporal: { effectiveAt: null, postingDate: null, periodStart: null, periodEnd: null, fiscalYear: null,
      fiscalPeriod: null, sourceTimeZone: null, closedPeriod: false },
    accounting: { basis: "not_applicable", sourceCurrency: null, reportingCurrency: null, exchangeRate: null, exchangeRateSource: null },
    value: { kind: "structured", value: { classification: "verified_provider_observation", economic: "blocked", historical: "unknown",
      applicability: pending.stream === "catalog" ? "seller_scoped" : "authorized_locations",
      providerRecordType: pending.providerRecordType, projection: pending.projection!.data } },
    reconciliationState: "accepted", validationState: "valid",
    sources: [{ sourceRecordVersionId: source.id, sourceFingerprint: source.sourceFingerprint,
      sourceRole: "control_observation", contributionWeight: null }],
    decision: { authority: "deterministic_policy", policyVersion, actorId: null, decidedAt: authority.admittedAt,
      reasonCodes: ["provider_observation_only"] }, normalizationVersion: SQUARE_SOURCE_MAPPING_VERSION,
    transformationVersion: policyVersion, sourceObservedAt: source.receivedAt, createdAt: authority.admittedAt });
  return freeze({ outcome: "admitted" as const, policyFingerprint: SQUARE_OBSERVATION_POLICY_FINGERPRINT,
    resourceKey: pending.resourceKey, versionKey: pending.versionKey, fact: prepared.version });
}

/** Stable set semantics; same-version incompatible evidence is never last-write-wins. */
export function reconcileSquareObservationAdmissions(inputs: readonly Parameters<typeof prepareSquareObservationAdmission>[0][]) {
  if (!Array.isArray(inputs) || inputs.length > 100) invalid();
  const results = inputs.map(prepareSquareObservationAdmission);
  const admitted = new Map<string, Extract<typeof results[number], { outcome: "admitted" }>>();
  const versions = new Map<string, Set<string>>();
  for (const result of results) if (result.outcome === "admitted") {
    const previous = admitted.get(result.fact.id);
    if (previous && previous.fact.factFingerprint !== result.fact.factFingerprint) invalid();
    admitted.set(result.fact.id, result);
    const observed = versions.get(result.resourceKey) ?? new Set<string>();
    observed.add(result.versionKey); versions.set(result.resourceKey, observed);
  }
  const conflicts = new Set([...versions].filter(([, seen]) => seen.size > 1).map(([key]) => key));
  const exclusions = new Map<string, string>();
  results.forEach((result, index) => {
    if (result.outcome !== "excluded") return;
    if (result.reason === "conflict") conflicts.add(inputs[index].pending.resourceKey);
    else exclusions.set(`${inputs[index].pending.resourceKey}/${inputs[index].pending.versionKey}/${result.reason}`, result.reason);
  });
  return freeze({ observations: [...admitted.values()].filter(result => !conflicts.has(result.resourceKey)).sort((a, b) => a.fact.id.localeCompare(b.fact.id)),
    excluded: [...exclusions.values(),
      ...[...conflicts].map(() => "conflict" as const)].sort(), economic: "blocked" as const });
}

/** Descriptive observation counts only; never amounts, quantities, KPIs or coverage. */
export function summarizeSquareObservations(inputs: readonly Parameters<typeof prepareSquareObservationAdmission>[0][]) {
  const reconciled = reconcileSquareObservationAdmissions(inputs);
  const counts = Object.fromEntries([...SQUARE_OBSERVATION_RECORD_TYPES].sort().map(type => [type,
    reconciled.observations.filter(item => item.fact.factKind === `${type}_observation`).length]));
  const reasons = Object.fromEntries([...new Set(reconciled.excluded)].sort().map(reason => [reason,
    reconciled.excluded.filter(value => value === reason).length]));
  const summary = { policyVersion: SQUARE_OBSERVATION_ADMISSION_POLICY, classification: "observation_only",
    counts, admitted: reconciled.observations.length, excluded: reconciled.excluded.length,
    conflicted: reasons.conflict ?? 0, reasons, economic: "blocked", historical: "unknown" };
  return freeze({ ...summary, summaryFingerprint: contractSha256(summary) });
}
