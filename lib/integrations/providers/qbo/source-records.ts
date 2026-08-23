import { externalSourceFingerprint } from "@/lib/integrations/contracts/canonical";
import {
  ExternalSourceRecordVersionSchema,
  type ExternalSourceRecordVersion
} from "@/lib/integrations/contracts/source-facts";
import { EXTERNAL_INTEGRATION_CONTRACT_VERSIONS } from "@/lib/integrations/contracts/versions";
import {
  QBO_PROVIDER_KEY,
  type QboMinimizedSourceRecord
} from "@/lib/integrations/providers/qbo/contracts";
import { classifyQboSourceChange } from "@/lib/integrations/providers/qbo/minimizers";
import type { ProviderAdapterContext } from "@/lib/integrations/contracts/provider-adapter";

function recordKind(recordType: string) {
  return `qbo_${recordType
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()}`;
}

export function qboMinimizedRecordToExternalSourceVersion(input: {
  context: ProviderAdapterContext;
  record: QboMinimizedSourceRecord;
  id: string;
  immutableVersion: number;
  priorVersionId: string | null;
  previousRecord: QboMinimizedSourceRecord | null;
  observedAt: string;
  synchronizedAt: string;
  ingestedAt: string;
  receivedAt: string;
}) {
  if (input.context.providerKey !== QBO_PROVIDER_KEY) {
    throw new Error("qbo_context_provider_mismatch");
  }
  if (input.record.provider.providerKey !== QBO_PROVIDER_KEY) {
    throw new Error("qbo_record_provider_mismatch");
  }
  if (
    input.record.provider.sourceEnvironment === "unknown" ||
    input.record.provider.sourceEnvironment !== input.context.providerEnvironment
  ) {
    throw new Error("qbo_source_environment_mismatch");
  }
  const changeKind = classifyQboSourceChange({
    previous: input.previousRecord,
    current: input.record
  });
  const liveProjection = changeKind === "deleted" ? null : input.record;
  const draft: ExternalSourceRecordVersion = {
    contractVersion: EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.sourceRecord,
    id: input.id,
    workspaceId: input.context.workspaceId,
    businessEntityId: input.context.businessEntityId,
    connectionId: input.context.connectionId,
    immutableVersion: input.immutableVersion,
    priorVersionId: input.priorVersionId,
    recordKind: recordKind(input.record.recordType),
    source: {
      kind: "provider",
      providerKey: QBO_PROVIDER_KEY,
      providerRecordType: input.record.recordType,
      providerRecordId: input.record.id,
      providerVersionReference: input.record.providerVersionReference
    },
    temporal: {
      basis: "event",
      providerCreatedAt: input.record.metadata.providerCreatedAt,
      providerUpdatedAt: input.record.metadata.providerUpdatedAt,
      observedAt: input.observedAt,
      synchronizedAt: input.synchronizedAt,
      ingestedAt: input.ingestedAt,
      effectiveAt: input.record.temporal.postingDate
        ? `${input.record.temporal.postingDate}T00:00:00.000Z`
        : null,
      postingDate: input.record.temporal.postingDate,
      periodStart: null,
      periodEnd: null,
      sourceTimeZone: null
    },
    accounting: {
      basis: input.record.accounting.basis,
      currency: input.record.accounting.sourceCurrency
    },
    normalizedSchemaVersion: input.record.minimizationVersion,
    changeKind,
    normalizedProjection: liveProjection,
    trust: "untrusted_external_input",
    validation: {
      state: "pending",
      validatorVersion: "qbo_phase_7_contract_validator_v1",
      issues: []
    },
    receivedAt: input.receivedAt
  };
  const parsed = ExternalSourceRecordVersionSchema.parse(draft);
  return ExternalSourceRecordVersionSchema.parse({
    ...parsed,
    sourceFingerprint: externalSourceFingerprint(parsed)
  });
}
