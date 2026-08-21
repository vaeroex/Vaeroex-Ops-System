import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  CanonicalDecimalSchema,
  ContractVersionSchema,
  IsoTimestampSchema,
  PersistedFactDecimalSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import { reconciliationCaseFingerprint } from "@/lib/integrations/reconciliation/classifier";
import {
  ContributionFamilySchema,
  FactContributionBatchSchema,
  FactContributionEventSchema,
  RECONCILIATION_CONTRACT_VERSIONS,
  RECONCILIATION_FINGERPRINT_VERSION,
  ReconciliationCaseSchema,
  canonicalizeDimensions,
  contributionFamilyFingerprint,
  type ContributionFamilyV1,
  type FactContributionBatchV1,
  type FactContributionEvent,
  type ReconciliationCaseV1,
  type ReconciliationRepresentation
} from "@/lib/integrations/reconciliation/contracts";

export const PlanFactContributionBatchInputSchema = z
  .object({
    id: UuidSchema,
    reconciliationCase: ReconciliationCaseSchema,
    registryVersion: ContractVersionSchema,
    families: z.array(ContributionFamilySchema).min(1).max(100),
    priorEvents: z.array(FactContributionEventSchema).max(10_000),
    plannedAt: IsoTimestampSchema
  })
  .strict();

function semanticSort<T>(values: readonly T[]) {
  return [...values].sort((left, right) => {
    const leftHash = contractSha256(left);
    const rightHash = contractSha256(right);
    return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
  });
}

function timestampMillis(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_contribution_timestamp");
  return parsed;
}

function assertCaseFingerprint(reconciliationCase: ReconciliationCaseV1) {
  const fingerprint = reconciliationCaseFingerprint(reconciliationCase);
  if (
    reconciliationCase.caseFingerprint &&
    reconciliationCase.caseFingerprint !== fingerprint
  ) {
    throw new Error("reconciliation_case_fingerprint_mismatch");
  }
  return fingerprint;
}

function assertFamilyFingerprint(family: ContributionFamilyV1) {
  const fingerprint = contributionFamilyFingerprint(family);
  if (family.familyFingerprint && family.familyFingerprint !== fingerprint) {
    throw new Error("contribution_family_fingerprint_mismatch");
  }
  return fingerprint;
}

function familyForRepresentation(
  representation: ReconciliationRepresentation,
  families: readonly ContributionFamilyV1[],
  registryVersion: string,
  plannedAt: string
) {
  const identity = representation.economicIdentity;
  const family = families.find(
    (candidate) =>
      candidate.workspaceId === representation.workspaceId &&
      candidate.businessEntityId === representation.businessEntityId &&
      candidate.registryVersion === registryVersion &&
      candidate.domain === identity.domain &&
      candidate.familyKey === identity.contributionFamilyKey &&
      candidate.familyKind === identity.contributionFamilyKind &&
      candidate.measureKey === identity.measureKey &&
      candidate.aggregateKey === identity.aggregateKey
  );
  if (!family) throw new Error("contribution_family_not_found");

  const instant = timestampMillis(plannedAt);
  if (
    instant < timestampMillis(family.effectiveFrom) ||
    (family.effectiveTo !== null && instant >= timestampMillis(family.effectiveTo))
  ) {
    throw new Error("contribution_family_not_effective");
  }
  if (!family.allowedAccountingBases.includes(identity.accountingBasis)) {
    throw new Error("contribution_family_accounting_basis_mismatch");
  }
  if (family.currencyMode === "required" && identity.currency === null) {
    throw new Error("contribution_family_currency_required");
  }
  if (family.currencyMode === "forbidden" && identity.currency !== null) {
    throw new Error("contribution_family_currency_forbidden");
  }
  return { family, familyFingerprint: assertFamilyFingerprint(family) };
}

type ContributionEventDraft = Omit<FactContributionEvent, "eventFingerprint">;

function eventFingerprintFromDraft(event: ContributionEventDraft) {
  return contractSha256({
    fingerprintPurpose: "fact_contribution_event",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: {
      ...event,
      sourceRecordVersionIds: semanticSort(event.sourceRecordVersionIds),
      dimensions: canonicalizeDimensions(event.dimensions)
    }
  });
}

function createEvent(draft: ContributionEventDraft): FactContributionEvent {
  return FactContributionEventSchema.parse({
    ...draft,
    sourceRecordVersionIds: semanticSort(draft.sourceRecordVersionIds),
    dimensions: canonicalizeDimensions(draft.dimensions),
    eventFingerprint: eventFingerprintFromDraft(draft)
  });
}

export function factContributionEventFingerprintInput(input: unknown) {
  const event = FactContributionEventSchema.parse(input);
  const { eventFingerprint: _eventFingerprint, ...draft } = event;
  void _eventFingerprint;
  return {
    fingerprintPurpose: "fact_contribution_event",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: {
      ...draft,
      sourceRecordVersionIds: semanticSort(draft.sourceRecordVersionIds),
      dimensions: canonicalizeDimensions(draft.dimensions)
    }
  };
}

export function factContributionEventFingerprint(input: unknown) {
  return contractSha256(factContributionEventFingerprintInput(input));
}

function commonEventFields(
  representation: ReconciliationRepresentation,
  sourceRecordVersionIds: readonly string[],
  reconciliationCase: ReconciliationCaseV1,
  caseFingerprint: string,
  family: ContributionFamilyV1,
  familyFingerprint: string
) {
  return {
    workspaceId: representation.workspaceId,
    businessEntityId: representation.businessEntityId,
    canonicalFactVersionId: representation.canonicalFactVersionId,
    canonicalFactFingerprint: representation.canonicalFactFingerprint,
    sourceRecordVersionIds: [...sourceRecordVersionIds],
    reconciliationCaseId: reconciliationCase.id,
    reconciliationCaseFingerprint: caseFingerprint,
    policyId: reconciliationCase.policyId,
    policyVersion: reconciliationCase.policyVersion,
    policyFingerprint: reconciliationCase.policyFingerprint,
    contributionFamily: {
      id: family.id,
      familyFingerprint,
      registryVersion: family.registryVersion,
      familyVersion: family.familyVersion,
      domain: family.domain,
      familyKey: family.familyKey,
      familyKind: family.familyKind,
      measureKey: family.measureKey,
      aggregateKey: family.aggregateKey
    },
    value: representation.value,
    effectiveTime: representation.economicIdentity.effectiveTime,
    dimensions: representation.economicIdentity.dimensions,
    accountingBasis: representation.economicIdentity.accountingBasis,
    currency: representation.economicIdentity.currency,
    reasonCode: reconciliationCase.classification
  };
}

function activeEstablishments(events: readonly FactContributionEvent[]) {
  const eventIds = new Set(events.map((event) => event.eventFingerprint));
  const retracted = new Set<string>();
  for (const event of events) {
    if (event.eventKind !== "retract" || event.retractsEventFingerprint === null) continue;
    if (!eventIds.has(event.retractsEventFingerprint)) {
      throw new Error("retraction_target_missing_from_history");
    }
    if (retracted.has(event.retractsEventFingerprint)) {
      throw new Error("contribution_event_retracted_more_than_once");
    }
    retracted.add(event.retractsEventFingerprint);
  }
  return events.filter(
    (event) => event.eventKind === "establish" && !retracted.has(event.eventFingerprint)
  );
}

function replacementTarget(reconciliationCase: ReconciliationCaseV1) {
  const successor = reconciliationCase.members.find((member) =>
    reconciliationCase.decision.selectedRepresentationIds.includes(
      member.representation.representationId
    )
  )?.representation;
  if (!successor) throw new Error("replacement_successor_not_selected");

  const lineage = successor.lineage;
  if (lineage.kind === "correction") {
    const target = reconciliationCase.members.find(
      (member) =>
        member.representation.canonicalFactVersionId ===
          lineage.priorCanonicalFactVersionId ||
        member.representation.sourceRecordVersionId ===
          lineage.priorSourceRecordVersionId
    )?.representation;
    if (!target) throw new Error("correction_target_not_in_case");
    return { successor, target };
  }

  if (lineage.kind === "manual_override") {
    const target = reconciliationCase.members.find(
      (member) =>
        member.representation.canonicalFactVersionId ===
        lineage.overriddenCanonicalFactVersionId
    )?.representation;
    if (!target) throw new Error("manual_override_target_not_in_case");
    return { successor, target };
  }

  throw new Error("replacement_lineage_missing");
}

function assertPriorEventFingerprints(events: readonly FactContributionEvent[]) {
  for (const event of events) {
    if (factContributionEventFingerprint(event) !== event.eventFingerprint) {
      throw new Error("fact_contribution_event_fingerprint_mismatch");
    }
  }
}

export function factContributionBatchFingerprintInput(input: unknown) {
  const batch = FactContributionBatchSchema.parse(input);
  return {
    fingerprintPurpose: "fact_contribution_batch",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: {
      contractVersion: batch.contractVersion,
      id: batch.id,
      workspaceId: batch.workspaceId,
      businessEntityId: batch.businessEntityId,
      reconciliationCaseId: batch.reconciliationCaseId,
      reconciliationCaseFingerprint: batch.reconciliationCaseFingerprint,
      policyId: batch.policyId,
      policyVersion: batch.policyVersion,
      policyFingerprint: batch.policyFingerprint,
      registryVersion: batch.registryVersion,
      events: semanticSort(batch.events)
    }
  } as const;
}

export function factContributionBatchFingerprint(input: unknown) {
  return contractSha256(factContributionBatchFingerprintInput(input));
}

export function planFactContributionBatch(input: unknown): FactContributionBatchV1 {
  const parsed = PlanFactContributionBatchInputSchema.parse(input);
  const reconciliationCase = parsed.reconciliationCase;
  const caseFingerprint = assertCaseFingerprint(reconciliationCase);
  assertPriorEventFingerprints(parsed.priorEvents);
  const events: FactContributionEvent[] = [];

  const addEstablish = (
    representation: ReconciliationRepresentation,
    sourceRecordVersionIds: readonly string[]
  ) => {
    const { family, familyFingerprint } = familyForRepresentation(
      representation,
      parsed.families,
      parsed.registryVersion,
      parsed.plannedAt
    );
    if (family.familyKind !== "additive_transaction") {
      throw new Error("non_additive_family_cannot_establish");
    }
    events.push(
      createEvent({
        eventKind: "establish",
        ...commonEventFields(
          representation,
          sourceRecordVersionIds,
          reconciliationCase,
          caseFingerprint,
          family,
          familyFingerprint
        ),
        retractsEventFingerprint: null
      })
    );
  };

  const addControl = (representation: ReconciliationRepresentation) => {
    const { family, familyFingerprint } = familyForRepresentation(
      representation,
      parsed.families,
      parsed.registryVersion,
      parsed.plannedAt
    );
    if (family.familyKind !== "non_additive_control") {
      throw new Error("additive_family_cannot_emit_control_observation");
    }
    events.push(
      createEvent({
        eventKind: "control_observation",
        ...commonEventFields(
          representation,
          [representation.sourceRecordVersionId],
          reconciliationCase,
          caseFingerprint,
          family,
          familyFingerprint
        ),
        retractsEventFingerprint: null
      })
    );
  };

  if (
    reconciliationCase.classification === "source_correction" ||
    reconciliationCase.classification === "manual_override"
  ) {
    const { successor, target } = replacementTarget(reconciliationCase);
    const active = activeEstablishments(parsed.priorEvents).filter(
      (event) =>
        event.workspaceId === reconciliationCase.workspaceId &&
        event.businessEntityId === reconciliationCase.businessEntityId &&
        event.canonicalFactVersionId === target.canonicalFactVersionId
    );
    if (active.length !== 1) throw new Error("replacement_requires_one_active_contribution");

    const { family, familyFingerprint } = familyForRepresentation(
      target,
      parsed.families,
      parsed.registryVersion,
      parsed.plannedAt
    );
    events.push(
      createEvent({
        eventKind: "retract",
        ...commonEventFields(
          target,
          active[0].sourceRecordVersionIds,
          reconciliationCase,
          caseFingerprint,
          family,
          familyFingerprint
        ),
        retractsEventFingerprint: active[0].eventFingerprint
      })
    );
    addEstablish(successor, [successor.sourceRecordVersionId]);
  } else if (reconciliationCase.classification === "control_observation_vs_additive_detail") {
    for (const member of reconciliationCase.members) {
      if (member.authorityRole === "excluded") continue;
      if (member.representation.economicIdentity.contributionFamilyKind === "non_additive_control") {
        addControl(member.representation);
      } else if (
        reconciliationCase.decision.selectedRepresentationIds.includes(
          member.representation.representationId
        )
      ) {
        addEstablish(member.representation, [member.representation.sourceRecordVersionId]);
      }
    }
  } else if (reconciliationCase.classification === "independent_facts") {
    for (const member of reconciliationCase.members) {
      if (
        reconciliationCase.decision.selectedRepresentationIds.includes(
          member.representation.representationId
        )
      ) {
        addEstablish(member.representation, [member.representation.sourceRecordVersionId]);
      }
    }
  } else if (reconciliationCase.decision.selectedRepresentationIds.length === 1) {
    const selected = reconciliationCase.members.find(
      (member) =>
        member.representation.representationId ===
        reconciliationCase.decision.selectedRepresentationIds[0]
    )?.representation;
    if (!selected) throw new Error("selected_reconciliation_representation_missing");
    const duplicateClass =
      reconciliationCase.classification === "same_fact_represented_twice" ||
      reconciliationCase.classification === "duplicate_evidence";
    const provenance = duplicateClass
      ? reconciliationCase.members.map((member) => member.representation.sourceRecordVersionId)
      : [selected.sourceRecordVersionId];
    addEstablish(selected, provenance);
  }

  const withoutFingerprint = FactContributionBatchSchema.parse({
    contractVersion: RECONCILIATION_CONTRACT_VERSIONS.factContributionBatch,
    id: parsed.id,
    workspaceId: reconciliationCase.workspaceId,
    businessEntityId: reconciliationCase.businessEntityId,
    reconciliationCaseId: reconciliationCase.id,
    reconciliationCaseFingerprint: caseFingerprint,
    policyId: reconciliationCase.policyId,
    policyVersion: reconciliationCase.policyVersion,
    policyFingerprint: reconciliationCase.policyFingerprint,
    registryVersion: parsed.registryVersion,
    events,
    plannedAt: parsed.plannedAt
  });
  const batchFingerprint = factContributionBatchFingerprint(withoutFingerprint);

  return FactContributionBatchSchema.parse({
    ...withoutFingerprint,
    batchFingerprint
  });
}

function decimalParts(value: string) {
  const parsed = PersistedFactDecimalSchema.parse(value);
  const negative = parsed.startsWith("-");
  const unsigned = negative ? parsed.slice(1) : parsed;
  const [integer, fraction = ""] = unsigned.split(".");
  return { negative, integer, fraction };
}

function sumCanonicalDecimals(values: readonly string[]) {
  if (values.length === 0) return "0";
  const parts = values.map(decimalParts);
  const scale = Math.max(...parts.map((part) => part.fraction.length));
  const total = parts.reduce((sum, part) => {
    const digits = `${part.integer}${part.fraction.padEnd(scale, "0")}`;
    const magnitude = BigInt(digits);
    return sum + (part.negative ? -magnitude : magnitude);
  }, BigInt(0));
  if (total === BigInt(0)) return "0";

  const negative = total < BigInt(0);
  const absolute = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const integer = scale === 0 ? absolute : absolute.slice(0, -scale);
  const rawFraction = scale === 0 ? "" : absolute.slice(-scale);
  const fraction = rawFraction.replace(/0+$/, "");
  return CanonicalDecimalSchema.parse(
    `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`
  );
}

function negateCanonicalDecimal(value: string) {
  const parsed = PersistedFactDecimalSchema.parse(value);
  if (parsed === "0") return parsed;
  return parsed.startsWith("-") ? parsed.slice(1) : `-${parsed}`;
}

export function aggregateActiveContributions(input: unknown) {
  const events = z.array(FactContributionEventSchema).max(100_000).parse(input);
  assertPriorEventFingerprints(events);
  return sumCanonicalDecimals(activeEstablishments(events).map((event) => event.value));
}

export function contributionBatchNetValue(input: unknown) {
  const batch = FactContributionBatchSchema.parse(input);
  return sumCanonicalDecimals(
    batch.events.flatMap((event) => {
      if (event.eventKind === "control_observation") return [];
      return [event.eventKind === "retract" ? negateCanonicalDecimal(event.value) : event.value];
    })
  );
}
