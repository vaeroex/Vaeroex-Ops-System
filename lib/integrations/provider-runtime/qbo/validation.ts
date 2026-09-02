import {
  externalSourceFingerprint
} from "@/lib/integrations/contracts/canonical";
import {
  ExternalSourceRecordVersionSchema,
  type ExternalSourceRecordVersion
} from "@/lib/integrations/contracts/source-facts";
import {
  QBO_PROVIDER_KEY,
  QBO_REPORT_CONTRACT_VERSION,
  QBO_SOURCE_RECORD_CONTRACT_VERSION,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_DETERMINISTIC_VALIDATOR_VERSION =
  "qbo_phase_8b_deterministic_validator_v1" as const;

type ValidationIssue = ExternalSourceRecordVersion["validation"]["issues"][number];

function issue(code: string, detail: string, field: string | null = null): ValidationIssue {
  return { code, severity: "error", field, detail };
}

function projectionRealm(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const provider = (value as Record<string, unknown>).provider;
  if (provider === null || typeof provider !== "object" || Array.isArray(provider)) return null;
  const realmId = (provider as Record<string, unknown>).realmId;
  return typeof realmId === "string" ? realmId : null;
}

function validateProjection(version: ExternalSourceRecordVersion) {
  const projection = version.normalizedProjection;
  if (projection === null) {
    return [issue("qbo_deleted_source_requires_review", "Deleted QBO sources remain pending until exact prior fact lineage is available.")];
  }
  try {
    const contractVersion = projection.contractVersion;
    if (contractVersion === QBO_SOURCE_RECORD_CONTRACT_VERSION) {
      QboMinimizedSourceRecordSchema.parse(projection);
      return [];
    }
    if (contractVersion === QBO_REPORT_CONTRACT_VERSION) {
      QboReportControlObservationSchema.parse(projection);
      return [];
    }
    return [issue("qbo_projection_contract_unsupported", "The minimized QBO projection contract is not allowlisted.", "contractVersion")];
  } catch {
    return [issue("qbo_projection_contract_invalid", "The minimized QBO projection did not satisfy the registered deterministic contract.")];
  }
}

export function validatePendingQboSourceVersion(input: {
  pendingVersion: unknown;
  validatedVersionId: string;
  expectedRealmId: string;
  validatedAt: string;
}) {
  const pending = ExternalSourceRecordVersionSchema.parse(input.pendingVersion);
  if (
    pending.source.kind !== "provider" ||
    pending.source.providerKey !== QBO_PROVIDER_KEY ||
    pending.validation.state !== "pending" ||
    pending.trust !== "untrusted_external_input"
  ) {
    throw new Error("qbo_pending_source_validation_boundary_denied");
  }
  const issues = validateProjection(pending);
  const realmId = projectionRealm(pending.normalizedProjection);
  if (pending.normalizedProjection !== null && realmId !== input.expectedRealmId) {
    issues.push(
      issue(
        "qbo_realm_binding_mismatch",
        "The provider realm did not match the verified connection mapping.",
        "provider.realmId"
      )
    );
  }
  const state = issues.length === 0 ? "valid" as const : "quarantined" as const;
  const draft: ExternalSourceRecordVersion = {
    ...pending,
    id: input.validatedVersionId,
    immutableVersion: pending.immutableVersion + 1,
    priorVersionId: pending.id,
    changeKind: pending.changeKind === "deleted" ? "deleted" : "unchanged",
    validation: {
      state,
      validatorVersion: QBO_DETERMINISTIC_VALIDATOR_VERSION,
      issues
    },
    receivedAt: input.validatedAt,
    sourceFingerprint: undefined
  };
  const parsed = ExternalSourceRecordVersionSchema.parse(draft);
  return {
    state,
    issues,
    version: ExternalSourceRecordVersionSchema.parse({
      ...parsed,
      sourceFingerprint: externalSourceFingerprint(parsed)
    }),
    validatorVersion: QBO_DETERMINISTIC_VALIDATOR_VERSION
  } as const;
}
