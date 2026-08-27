import "server-only";

import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import {
  QboProviderEndpointClassSchema,
  QboProviderEndpointDomainSchema,
  QboProviderOutcomeSchema,
  QboReportParserOutcomeSchema
} from "@/lib/integrations/providers/qbo/contracts";
import { RuntimeQueueClassSchema, RuntimeTaskStateSchema } from "@/lib/integrations/runtime/contracts";

export const QBO_CUSTOMER_OAUTH_STATE_CONTRACT_VERSION =
  "qbo_customer_oauth_state_v2" as const;
export const QBO_CUSTOMER_OAUTH_STATE_CONSUME_CONTRACT_VERSION =
  "qbo_customer_oauth_state_consume_v2" as const;
export const QBO_CUSTOMER_REAUTHORIZATION_STATE_CONTRACT_VERSION =
  "qbo_customer_reauthorization_state_v2" as const;
export const QBO_CUSTOMER_REAUTHORIZATION_STATE_CONSUME_CONTRACT_VERSION =
  "qbo_customer_reauthorization_state_consume_v2" as const;
export const QBO_PRODUCTION_PROVIDER_RESULT_CONTRACT_VERSION =
  "qbo_provider_result_evidence_v2" as const;
export const QBO_PRODUCTION_REPORT_RESULT_CONTRACT_VERSION =
  "qbo_report_parser_result_evidence_v2" as const;
export const QBO_PRODUCTION_TASK_COMPLETION_CONTRACT_VERSION =
  "qbo_runtime_task_completion_v2" as const;
export const QBO_PRODUCTION_CLOUD_TASK_STAGING_CONTRACT_VERSION =
  "qbo_runtime_cloud_task_staging_v2" as const;

const RuntimeConfigurationSchema = z
  .object({
    contractVersion: z.literal("qbo_runtime_configuration_v2"),
    providerEnvironment: z.literal("production"),
    deploymentTier: z.literal("production"),
    configurationVersion: z.number().int().positive().safe(),
    authorizationRedirectUri: z.string().url().startsWith("https://"),
    authorizationReturnIntent: z.string().startsWith("/"),
    providerApiOrigin: z.literal("https://quickbooks.api.intuit.com"),
    queueName: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    queueAudience: z.string().url().startsWith("https://")
  })
  .strict();

const OAuthStateCreateResultSchema = z
  .object({
    stateId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    expiresAt: IsoTimestampSchema,
    idempotent: z.boolean()
  })
  .strict();

const OAuthStateConsumeResultSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(false), reasonCode: z.enum(["state_invalid", "state_replayed", "state_expired"]) }).strict(),
  z.object({
    accepted: z.literal(true),
    stateId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    expectedConnectionRowVersion: z.number().int().positive().safe(),
    providerKey: z.literal("quickbooks_online"),
    providerEnvironment: z.literal("production"),
    initiatedBy: UuidSchema,
    requestedScopes: z.tuple([z.literal("com.intuit.quickbooks.accounting")]),
    redirectUri: z.string().url().startsWith("https://"),
    returnIntent: z.string().startsWith("/"),
    consumedAt: IsoTimestampSchema
  }).strict()
]);

const ReauthorizationStateCreateResultSchema = OAuthStateCreateResultSchema;
const ReauthorizationStateConsumeResultSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(false), reasonCode: z.enum(["state_invalid", "state_replayed", "state_expired"]) }).strict(),
  z.object({
    accepted: z.literal(true),
    stateId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    mappingId: UuidSchema,
    providerKey: z.literal("quickbooks_online"),
    providerEnvironment: z.literal("production"),
    initiatedBy: UuidSchema,
    requestedScopes: z.tuple([z.literal("com.intuit.quickbooks.accounting")]),
    redirectUri: z.string().url().startsWith("https://"),
    returnIntent: z.string().startsWith("/"),
    supersededCredentialId: UuidSchema,
    supersededCredentialVersion: z.number().int().positive().safe(),
    providerEntityReferenceFingerprint: Sha256FingerprintSchema,
    consumedAt: IsoTimestampSchema
  }).strict()
]);

export const QboProductionDispatchCandidateSchema = z
  .object({
    taskId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    syncRunId: UuidSchema,
    providerEnvironment: z.literal("production"),
    queueClass: RuntimeQueueClassSchema,
    streamKey: BoundedIdentifierSchema,
    availableAt: IsoTimestampSchema,
    rowVersion: z.number().int().positive().safe(),
    dispatchGeneration: z.number().int().nonnegative().safe()
  })
  .strict();

export const QboProductionDispatchReconciliationSchema = z
  .object({
    taskId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    syncRunId: UuidSchema,
    providerEnvironment: z.literal("production"),
    queueClass: RuntimeQueueClassSchema,
    streamKey: BoundedIdentifierSchema,
    dispatcherTaskName: z.string().regex(
      /^projects\/[a-z][a-z0-9-]{0,62}\/locations\/[a-z][a-z0-9-]{0,62}\/queues\/[a-z][a-z0-9-]{0,62}\/tasks\/[a-f0-9]{64}$/
    ),
    dispatchGeneration: z.number().int().positive().safe(),
    rowVersion: z.number().int().positive().safe(),
    queueName: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
    queueAudience: z.string().url().startsWith("https://")
  })
  .strict();

export const QboProductionTaskDeliverySchema = z
  .object({
    taskId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    syncRunId: UuidSchema,
    mappingId: UuidSchema,
    providerEnvironment: z.literal("production"),
    queueClass: RuntimeQueueClassSchema,
    streamKey: BoundedIdentifierSchema,
    taskKind: BoundedIdentifierSchema,
    controlMetadata: z.record(z.unknown()),
    connectionConfigurationVersion: z.number().int().positive().safe(),
    mappingVersion: z.number().int().positive().safe(),
    providerTenantReferenceFingerprint: Sha256FingerprintSchema,
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    dispatchGeneration: z.number().int().positive().safe(),
    state: RuntimeTaskStateSchema,
    rowVersion: z.number().int().positive().safe(),
    queueAudience: z.string().url().startsWith("https://")
  })
  .strict();

async function rpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`qbo_production_rpc_${disposition}:${name}`);
  }
  return result.data;
}

export async function createQboCustomerOAuthState(
  command: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return OAuthStateCreateResultSchema.parse(
    await rpc(
      "create_qbo_customer_oauth_state_v2",
      { p_command: command, p_request_id: BoundedIdentifierSchema.parse(requestId) },
      client
    )
  );
}

export async function consumeQboCustomerOAuthState(
  command: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return OAuthStateConsumeResultSchema.parse(
    await rpc(
      "consume_qbo_customer_oauth_state_v2",
      { p_command: command, p_request_id: BoundedIdentifierSchema.parse(requestId) },
      client
    )
  );
}

export async function createQboCustomerReauthorizationState(
  command: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return ReauthorizationStateCreateResultSchema.parse(
    await rpc(
      "create_qbo_customer_reauthorization_state_v2",
      { p_command: command, p_request_id: BoundedIdentifierSchema.parse(requestId) },
      client
    )
  );
}

export async function consumeQboCustomerReauthorizationState(
  command: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return ReauthorizationStateConsumeResultSchema.parse(
    await rpc(
      "consume_qbo_customer_reauthorization_state_v2",
      { p_command: command, p_request_id: BoundedIdentifierSchema.parse(requestId) },
      client
    )
  );
}

export async function storeQboCustomerReauthorizedCredential(
  command: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    credentialStatus: z.literal("active"),
    supersededCredentialId: UuidSchema,
    connectionStatus: z.literal("initializing"),
    connectionRowVersion: z.number().int().positive().safe(),
    mappingId: UuidSchema,
    mappingStatus: z.literal("active"),
    mappingRowVersion: z.number().int().positive().safe(),
    idempotent: z.boolean()
  }).strict().parse(await rpc(
    "store_qbo_customer_reauthorized_credential_v2",
    { p_command: command, p_request_id: BoundedIdentifierSchema.parse(requestId) },
    client
  ));
}

export async function readQboRuntimeConfiguration(
  client: ExternalIntegrationsRpcClient
) {
  return RuntimeConfigurationSchema.parse(
    await rpc(
      "read_qbo_runtime_configuration_v2",
      { p_provider_environment: "production" },
      client
    )
  );
}

export async function scheduleQboProductionInitialization(
  maximumConnections: number,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    scheduledConnectionCount: z.number().int().min(0).max(25),
    scheduledTaskCount: z.number().int().min(0).max(600),
    runs: z.array(z.object({
      workspaceId: UuidSchema,
      businessEntityId: UuidSchema,
      connectionId: UuidSchema,
      connectionGeneration: z.number().int().positive().safe(),
      syncRunId: UuidSchema,
      taskCount: z.literal(24)
    }).strict()).max(25)
  }).strict().superRefine((value, context) => {
    if (
      value.runs.length !== value.scheduledConnectionCount ||
      value.scheduledTaskCount !== value.scheduledConnectionCount * 24
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "qbo_initialization_schedule_result_inconsistent"
      });
    }
  }).parse(await rpc(
    "schedule_qbo_initialization_v2",
    {
      p_limit: z.number().int().min(1).max(25).parse(maximumConnections),
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    },
    client
  ));
}

export async function discoverQboRuntimeDispatch(
  queueClass: "provider_interactive" | "provider_bulk",
  limit: number,
  client: ExternalIntegrationsRpcClient
) {
  return z.array(QboProductionDispatchCandidateSchema).max(100).parse(
    await rpc(
      "discover_qbo_runtime_dispatch_v2",
      {
        p_queue_class: queueClass,
        p_limit: z.number().int().min(1).max(100).parse(limit)
      },
      client
    )
  );
}

export async function discoverQboRuntimeDispatchReconciliation(
  queueClass: "provider_interactive" | "provider_bulk",
  limit: number,
  client: ExternalIntegrationsRpcClient
) {
  return z.array(QboProductionDispatchReconciliationSchema).max(100).parse(
    await rpc(
      "discover_qbo_runtime_dispatch_reconciliation_v2",
      {
        p_queue_class: queueClass,
        p_limit: z.number().int().min(1).max(100).parse(limit)
      },
      client
    )
  );
}

export async function confirmQboRuntimeCloudTaskStaged(
  input: {
    taskId: string;
    expectedRowVersion: number;
    dispatcherTaskName: string;
    dispatchGeneration: number;
    stagingOutcome: "created" | "already_existing";
  },
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    taskId: UuidSchema,
    dispatchGeneration: z.number().int().positive().safe(),
    dispatcherTaskName: QboProductionDispatchReconciliationSchema.shape.dispatcherTaskName,
    stagingOutcome: z.enum(["created", "already_existing", "delivery_observed"]),
    rowVersion: z.number().int().positive().safe(),
    idempotent: z.boolean()
  }).strict().parse(await rpc(
    "confirm_qbo_runtime_cloud_task_staged_v2",
    {
      p_command: {
        contractVersion: QBO_PRODUCTION_CLOUD_TASK_STAGING_CONTRACT_VERSION,
        taskId: UuidSchema.parse(input.taskId),
        expectedRowVersion: z.number().int().positive().safe().parse(
          input.expectedRowVersion
        ),
        dispatcherTaskName:
          QboProductionDispatchReconciliationSchema.shape.dispatcherTaskName.parse(
            input.dispatcherTaskName
          ),
        dispatchGeneration: z.number().int().positive().safe().parse(
          input.dispatchGeneration
        ),
        stagingOutcome: z.enum(["created", "already_existing"]).parse(
          input.stagingOutcome
        )
      },
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    },
    client
  ));
}

export async function readQboRuntimeTaskDelivery(
  input: { taskId: string; taskName: string; queueName: string },
  client: ExternalIntegrationsRpcClient
) {
  return QboProductionTaskDeliverySchema.parse(
    await rpc(
      "read_qbo_runtime_task_delivery_v2",
      {
        p_task_id: UuidSchema.parse(input.taskId),
        p_dispatcher_task_name: input.taskName,
        p_queue_name: input.queueName
      },
      client
    )
  );
}

export async function recordQboProviderResult(
  input: {
    credentialReadEvidenceId: string;
    requestOrdinal: number;
    endpointDomain: z.infer<typeof QboProviderEndpointDomainSchema>;
    endpointClass: z.infer<typeof QboProviderEndpointClassSchema>;
    providerRequestFingerprint: string;
    providerOutcome: z.infer<typeof QboProviderOutcomeSchema>;
  },
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    providerResultEvidenceId: UuidSchema,
    credentialReadEvidenceId: UuidSchema,
    requestOrdinal: z.number().int().min(1).max(128),
    endpointDomain: QboProviderEndpointDomainSchema,
    endpointClass: QboProviderEndpointClassSchema,
    providerOutcome: QboProviderOutcomeSchema,
    observedAt: IsoTimestampSchema,
    idempotent: z.boolean()
  }).strict().parse(await rpc(
    "record_qbo_provider_result_v2",
    {
      p_command: {
        contractVersion: QBO_PRODUCTION_PROVIDER_RESULT_CONTRACT_VERSION,
        credentialReadEvidenceId: UuidSchema.parse(input.credentialReadEvidenceId),
        requestOrdinal: z.number().int().min(1).max(128).parse(input.requestOrdinal),
        endpointDomain: QboProviderEndpointDomainSchema.parse(input.endpointDomain),
        endpointClass: QboProviderEndpointClassSchema.parse(input.endpointClass),
        providerRequestFingerprint: Sha256FingerprintSchema.parse(input.providerRequestFingerprint),
        providerOutcome: QboProviderOutcomeSchema.parse(input.providerOutcome)
      },
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    },
    client
  ));
}

export async function recordQboReportParserResult(
  input: { providerResultEvidenceId: string; parserOutcome: z.infer<typeof QboReportParserOutcomeSchema> },
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    parserResultEvidenceId: UuidSchema,
    providerResultEvidenceId: UuidSchema,
    parserOutcome: QboReportParserOutcomeSchema,
    observedAt: IsoTimestampSchema,
    idempotent: z.boolean()
  }).strict().parse(await rpc(
    "record_qbo_report_parser_result_v2",
    {
      p_command: {
        contractVersion: QBO_PRODUCTION_REPORT_RESULT_CONTRACT_VERSION,
        providerResultEvidenceId: UuidSchema.parse(input.providerResultEvidenceId),
        parserOutcome: QboReportParserOutcomeSchema.parse(input.parserOutcome)
      },
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    },
    client
  ));
}

export async function completeQboRuntimeTask(
  input: { completion: unknown; continuation: null | { kind: "next_page"; childTaskId: string } },
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return z.object({
    state: RuntimeTaskStateSchema,
    continuationTaskId: UuidSchema.nullable(),
    continuationCreated: z.boolean()
  }).passthrough().parse(await rpc(
    "complete_qbo_runtime_task_v2",
    {
      p_command: {
        contractVersion: QBO_PRODUCTION_TASK_COMPLETION_CONTRACT_VERSION,
        completion: input.completion,
        continuation: input.continuation
      },
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  ));
}
