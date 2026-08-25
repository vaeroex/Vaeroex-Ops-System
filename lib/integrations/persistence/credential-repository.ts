import "server-only";

import { z } from "zod";

import {
  AcquireRefreshLeaseCommandSchema,
  AuthorizationAuditEventSchema,
  CompleteCredentialRevocationCommandSchema,
  CompleteRefreshFailureCommandSchema,
  ConsumeReauthorizationStateCommandSchema,
  ConsumeOAuthStateCommandSchema,
  CreateReauthorizationStateCommandSchema,
  CreateOAuthStateCommandSchema,
  CredentialReauthorizationResultSchema,
  CredentialRefreshBoundaryEventSchema,
  CredentialMutationResultSchema,
  DestroyCredentialCommandSchema,
  ExpiredRefreshLeaseReclamationResultSchema,
  OAuthStateConsumeResultSchema,
  ProviderCredentialReadResultSchema,
  ReadProviderCredentialCommandSchema,
  ReclaimExpiredRefreshLeaseCommandSchema,
  RefreshLeaseResultSchema,
  ReauthorizationStateConsumeResultSchema,
  RevokeCredentialCommandSchema,
  RotateCredentialCommandSchema,
  StoreCredentialCommandSchema,
  StoreReauthorizedCredentialCommandSchema
} from "@/lib/integrations/credentials/contracts";
import { BoundedIdentifierSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

async function credentialRpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  if (!client) throw new Error("integration_credential_checked_rpc_client_required");
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`integration_credential_rpc_${disposition}:${name}`);
  }
  return result.data;
}

const OAuthStateCreateResultSchema = z
  .object({ stateId: UuidSchema, idempotent: z.boolean() })
  .strict();

const ReauthorizationStateCreateResultSchema = z
  .object({
    stateId: UuidSchema,
    connectionRowVersion: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    credentialRowVersion: z.number().int().positive().safe(),
    mappingId: UuidSchema,
    mappingRowVersion: z.number().int().positive().safe(),
    recoveryEvidenceCount: z.number().int().positive().safe(),
    idempotent: z.boolean()
  })
  .strict();

function requestId(value: string) {
  return BoundedIdentifierSchema.parse(value);
}

export async function createIntegrationOAuthState(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return OAuthStateCreateResultSchema.parse(
    await credentialRpc(
      "create_integration_oauth_state_v1",
      { p_command: CreateOAuthStateCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function consumeIntegrationOAuthState(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return OAuthStateConsumeResultSchema.parse(
    await credentialRpc(
      "consume_integration_oauth_state_v2",
      { p_command: ConsumeOAuthStateCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function createIntegrationReauthorizationState(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return ReauthorizationStateCreateResultSchema.parse(
    await credentialRpc(
      "create_integration_reauthorization_state_v1",
      {
        p_command: CreateReauthorizationStateCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function consumeIntegrationReauthorizationState(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return ReauthorizationStateConsumeResultSchema.parse(
    await credentialRpc(
      "consume_integration_reauthorization_state_v1",
      {
        p_command: ConsumeReauthorizationStateCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function storeIntegrationCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "store_integration_credential_v1",
      { p_command: StoreCredentialCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function storeReauthorizedIntegrationCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialReauthorizationResultSchema.parse(
    await credentialRpc(
      "store_reauthorized_integration_credential_v1",
      {
        p_command: StoreReauthorizedCredentialCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function acquireIntegrationCredentialRefreshLease(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return RefreshLeaseResultSchema.parse(
    await credentialRpc(
      "acquire_integration_credential_refresh_lease_v2",
      { p_command: AcquireRefreshLeaseCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function reclaimIntegrationExpiredRefreshLease(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return ExpiredRefreshLeaseReclamationResultSchema.parse(
    await credentialRpc(
      "reclaim_integration_expired_refresh_lease_v1",
      {
        p_command: ReclaimExpiredRefreshLeaseCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function readIntegrationProviderCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return ProviderCredentialReadResultSchema.parse(
    await credentialRpc(
      "read_integration_provider_credential_v3",
      {
        p_command: ReadProviderCredentialCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function rotateIntegrationCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "rotate_integration_credential_v1",
      { p_command: RotateCredentialCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function completeIntegrationCredentialRefreshFailure(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "complete_integration_credential_refresh_failure_v1",
      {
        p_command: CompleteRefreshFailureCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function revokeIntegrationCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "revoke_integration_credential_v1",
      { p_command: RevokeCredentialCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function completeIntegrationCredentialRevocation(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "complete_integration_credential_revocation_v1",
      {
        p_command: CompleteCredentialRevocationCommandSchema.parse(input),
        p_request_id: requestId(id)
      },
      client
    )
  );
}

export async function destroyIntegrationCredential(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return CredentialMutationResultSchema.parse(
    await credentialRpc(
      "destroy_integration_credential_v1",
      { p_command: DestroyCredentialCommandSchema.parse(input), p_request_id: requestId(id) },
      client
    )
  );
}

export async function recordIntegrationAuthorizationEvent(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return z
    .object({ eventId: UuidSchema })
    .strict()
    .parse(
      await credentialRpc(
        "record_integration_authorization_event_v1",
        { p_event: AuthorizationAuditEventSchema.parse(input), p_request_id: requestId(id) },
        client
      )
    );
}

export async function recordIntegrationCredentialRefreshBoundary(
  input: unknown,
  id: string,
  client: ExternalIntegrationsRpcClient
) {
  return z
    .object({ eventId: UuidSchema, idempotent: z.boolean() })
    .strict()
    .parse(
      await credentialRpc(
        "record_integration_credential_refresh_boundary_v2",
        {
          p_event: CredentialRefreshBoundaryEventSchema.parse(input),
          p_request_id: requestId(id)
        },
        client
      )
    );
}
