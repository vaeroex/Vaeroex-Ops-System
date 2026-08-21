import {
  assertIntegrationConnectionTransition,
  type IntegrationConnectionStatus
} from "@/lib/integrations/contracts/control-plane";
import {
  FreshnessStateSchema,
  type FreshnessBlockingLevel,
  type FreshnessState
} from "@/lib/integrations/contracts/intelligence";
import {
  ConnectionSafeReasonCodeSchema,
  IntegrationConnectionControlSchema,
  IntegrationConnectionSummarySchema,
  IntegrationFreshnessSummarySchema,
  IntegrationSyncRunStateSchema,
  ProviderEntityMappingStatusSchema,
  type IntegrationConnectionControl,
  type PersistedIntegrationFreshness
} from "@/lib/integrations/control-plane/contracts";

const CONNECTION_REASONS: Readonly<
  Record<IntegrationConnectionStatus, readonly string[]>
> = {
  pending_authorization: ["authorization_pending", "authorization_required"],
  authorized_unmapped: [
    "authorization_completed",
    "mapping_required"
  ],
  initializing: ["initial_sync_pending"],
  active: ["healthy"],
  degraded: ["freshness_warning", "control_plane_error"],
  error: ["control_plane_error"],
  reauthorization_required: ["authorization_required"],
  disconnecting: ["customer_disconnect_requested"],
  disconnected: ["disconnected"],
  deleting: ["deletion_requested"],
  deleted: ["deleted"]
};

export type ConnectionActivationEvidence = Readonly<{
  activeVerifiedMapping: boolean;
  successfulInitialSync: boolean;
  requiredFreshnessSatisfied: boolean;
}>;

export function assertConnectionLifecycleTransition(input: {
  current: IntegrationConnectionControl;
  targetStatus: IntegrationConnectionStatus;
  targetReasonCode: string;
  expectedRowVersion: number;
  expectedGeneration: number;
  requestId: string;
  lastTransitionRequestId: string | null;
  requestFingerprint?: string;
  lastTransitionRequestFingerprint?: string | null;
  activationEvidence?: ConnectionActivationEvidence;
}) {
  const current = IntegrationConnectionControlSchema.parse(input.current);
  const reasonCode = ConnectionSafeReasonCodeSchema.parse(input.targetReasonCode);
  const idempotent =
    current.connection.status === input.targetStatus &&
    input.lastTransitionRequestId === input.requestId &&
    input.requestFingerprint !== undefined &&
    input.lastTransitionRequestFingerprint === input.requestFingerprint;
  if (idempotent) return { idempotent: true, current } as const;
  if (current.connection.status === "deleted") {
    throw new Error("integration_connection_deleted_terminal");
  }
  if (current.rowVersion !== input.expectedRowVersion) {
    throw new Error("integration_connection_row_version_stale");
  }
  if (current.connectionGeneration !== input.expectedGeneration) {
    throw new Error("integration_connection_generation_stale");
  }
  if (
    current.connection.status === "disconnected" &&
    input.targetStatus === "pending_authorization"
  ) {
    throw new Error("integration_connection_replacement_generation_required");
  }
  assertIntegrationConnectionTransition(
    current.connection.status,
    input.targetStatus
  );
  if (!CONNECTION_REASONS[input.targetStatus].includes(reasonCode)) {
    throw new Error("integration_connection_reason_invalid");
  }
  if (input.targetStatus === "active") {
    const evidence = input.activationEvidence;
    if (
      !evidence?.activeVerifiedMapping ||
      !evidence.successfulInitialSync ||
      !evidence.requiredFreshnessSatisfied
    ) {
      throw new Error("integration_connection_activation_gate_unsatisfied");
    }
  }
  return { idempotent: false, current } as const;
}

const MAPPING_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  pending_verification: ["active", "inactive"],
  active: ["inactive", "replaced"],
  inactive: ["pending_verification", "replaced"],
  replaced: []
};

export function assertProviderEntityMappingTransition(
  from: unknown,
  to: unknown,
  options: { hasSyntheticVerification: boolean }
) {
  const current = ProviderEntityMappingStatusSchema.parse(from);
  const target = ProviderEntityMappingStatusSchema.parse(to);
  if (current === target) return { idempotent: true } as const;
  if (!MAPPING_TRANSITIONS[current].includes(target)) {
    throw new Error("provider_entity_mapping_transition_invalid");
  }
  if (target === "active" && !options.hasSyntheticVerification) {
    throw new Error("provider_entity_mapping_verification_required");
  }
  return { idempotent: false } as const;
}

const SYNC_RUN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  created: ["running", "cancelled"],
  running: ["succeeded", "partially_succeeded", "failed", "cancelled"],
  succeeded: [],
  partially_succeeded: [],
  failed: [],
  cancelled: []
};

export function assertIntegrationSyncRunTransition(from: unknown, to: unknown) {
  const current = IntegrationSyncRunStateSchema.parse(from);
  const target = IntegrationSyncRunStateSchema.parse(to);
  if (current === target) return { idempotent: true } as const;
  if (!SYNC_RUN_TRANSITIONS[current].includes(target)) {
    throw new Error("integration_sync_run_transition_invalid");
  }
  return { idempotent: false } as const;
}

type FreshnessInput = Readonly<{
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  mappingId: string | null;
  domain: string;
  scopeKey: string;
  providerWatermarkAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastReconciledAt: string | null;
  observedLagSeconds: number | null;
  connectionStatus: IntegrationConnectionStatus;
  latestSyncFailed: boolean;
  policyVersion: string;
  currentMaxAgeSeconds: number;
  staleAfterSeconds: number;
  staleBlockingLevel?: Extract<
    FreshnessBlockingLevel,
    "current_intelligence" | "all_derived"
  >;
  calculatedAt: string;
  rowVersion: number;
}>;

export function deriveIntegrationFreshness(input: FreshnessInput): FreshnessState {
  const calculatedAt = Date.parse(input.calculatedAt);
  const successAt =
    input.lastSuccessfulSyncAt === null
      ? null
      : Date.parse(input.lastSuccessfulSyncAt);
  if (
    !Number.isFinite(calculatedAt) ||
    (successAt !== null && (!Number.isFinite(successAt) || successAt > calculatedAt))
  ) {
    throw new Error("integration_freshness_timestamp_invalid");
  }

  const ageSeconds =
    successAt === null ? null : Math.floor((calculatedAt - successAt) / 1_000);
  let status: FreshnessState["status"];
  let blockingLevel: FreshnessState["blockingLevel"];
  let reasonCode: string;

  if (input.connectionStatus === "reauthorization_required") {
    status = "reauthorization_required";
    blockingLevel = "all_derived";
    reasonCode = "connection_reauthorization_required";
  } else if (
    ["disconnecting", "disconnected", "deleting", "deleted"].includes(
      input.connectionStatus
    )
  ) {
    status = "disconnected";
    blockingLevel = "all_derived";
    reasonCode = "connection_disconnected";
  } else if (input.latestSyncFailed || input.connectionStatus === "error") {
    status = "sync_error";
    blockingLevel = "current_intelligence";
    reasonCode = "latest_sync_failed";
  } else if (ageSeconds === null) {
    status = "unknown";
    blockingLevel = "current_intelligence";
    reasonCode = "no_successful_sync";
  } else if (ageSeconds <= input.currentMaxAgeSeconds) {
    status = "current";
    blockingLevel = "none";
    reasonCode = "within_current_threshold";
  } else if (ageSeconds <= input.staleAfterSeconds) {
    status = "aging";
    blockingLevel = "warning";
    reasonCode = "exceeds_current_threshold";
  } else {
    status = "stale";
    blockingLevel = input.staleBlockingLevel ?? "current_intelligence";
    reasonCode = "exceeds_stale_threshold";
  }

  return FreshnessStateSchema.parse({
    contractVersion: "integration_freshness_v1",
    workspaceId: input.workspaceId,
    businessEntityId: input.businessEntityId,
    connectionId: input.connectionId,
    mappingId: input.mappingId,
    domain: input.domain,
    scopeKey: input.scopeKey,
    providerWatermarkAt: input.providerWatermarkAt,
    lastAttemptAt: input.lastAttemptAt,
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    lastReconciledAt: input.lastReconciledAt,
    observedLagSeconds: input.observedLagSeconds,
    status,
    blockingLevel,
    reasonCode,
    policyVersion: input.policyVersion,
    calculatedAt: input.calculatedAt,
    currentMaxAgeSeconds: input.currentMaxAgeSeconds,
    staleAfterSeconds: input.staleAfterSeconds,
    ageSeconds,
    rowVersion: input.rowVersion
  });
}

export function connectionCustomerSummary(input: IntegrationConnectionControl) {
  const value = IntegrationConnectionControlSchema.parse(input);
  return IntegrationConnectionSummarySchema.parse({
    contractVersion: "integration_connection_summary_v1",
    id: value.connection.id,
    workspaceId: value.connection.workspaceId,
    businessEntityId: value.connection.businessEntityId,
    providerKey: value.connection.providerKey,
    providerEnvironment: value.connection.providerEnvironment,
    safeDisplayName: value.safeDisplayName,
    status: value.connection.status,
    stateReasonCode: value.stateReasonCode,
    requestedScopes: value.connection.requestedScopes,
    grantedScopes: value.connection.grantedScopes,
    capabilitySnapshot: value.capabilitySnapshot,
    adapterVersion: value.adapterVersion,
    configurationVersion: value.connection.configurationVersion,
    connectionGeneration: value.connectionGeneration,
    statusChangedAt: value.connection.statusChangedAt,
    disconnectedAt: value.disconnectedAt,
    rowVersion: value.rowVersion
  });
}

export function freshnessCustomerSummary(
  input: PersistedIntegrationFreshness & { providerKey: string }
) {
  const value = input.state;
  if (value.connectionId === null) {
    throw new Error("integration_freshness_connection_required");
  }
  return IntegrationFreshnessSummarySchema.parse({
    contractVersion: "integration_freshness_summary_v1",
    id: input.id,
    workspaceId: value.workspaceId,
    businessEntityId: value.businessEntityId,
    connectionId: value.connectionId,
    providerKey: input.providerKey,
    domain: value.domain,
    scopeKey: value.scopeKey,
    lastAttemptAt: value.lastAttemptAt,
    lastSuccessfulSyncAt: value.lastSuccessfulSyncAt,
    lastReconciledAt: value.lastReconciledAt,
    observedLagSeconds: value.observedLagSeconds,
    status: value.status,
    blockingLevel: value.blockingLevel,
    reasonCode: value.reasonCode,
    policyVersion: value.policyVersion,
    calculatedAt: value.calculatedAt,
    rowVersion: value.rowVersion
  });
}
