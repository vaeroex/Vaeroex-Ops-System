import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CreateOAuthStateCommandSchema,
  CreateReauthorizationStateCommandSchema,
  OAuthReturnIntentSchema,
  PHASE_5_OAUTH_STATE_BYTES,
  PHASE_5_OAUTH_STATE_TTL_SECONDS,
  PHASE_8B_REAUTHORIZATION_REDIRECT_URI,
  PHASE_8B_REAUTHORIZATION_RETURN_INTENT,
  type CreateOAuthStateCommand,
  type CreateReauthorizationStateCommand
} from "@/lib/integrations/credentials/contracts";

export function oauthStateHash(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) {
    throw new Error("oauth_state_format_invalid");
  }
  return `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}` as const;
}

export function reauthorizationStateHash(state: string) {
  if (!/^r1_[A-Za-z0-9_-]{43}$/.test(state)) {
    throw new Error("reauthorization_state_format_invalid");
  }
  return `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}` as const;
}

export function isReauthorizationOAuthState(state: string) {
  return /^r1_[A-Za-z0-9_-]{43}$/.test(state);
}

export function normalizeOAuthReturnIntent(value: string) {
  return OAuthReturnIntentSchema.parse(value);
}

export function sortedCredentialScopes(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createOAuthStateIntent(
  input: Omit<
    CreateOAuthStateCommand,
    "contractVersion" | "id" | "stateHash" | "createdAt" | "expiresAt" | "requestedScopes" | "returnIntent"
  > & {
    requestedScopes: readonly string[];
    returnIntent: string;
  },
  now = new Date()
) {
  const state = randomBytes(PHASE_5_OAUTH_STATE_BYTES).toString("base64url");
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + PHASE_5_OAUTH_STATE_TTL_SECONDS * 1_000
  ).toISOString();
  const command = CreateOAuthStateCommandSchema.parse({
    ...input,
    contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.oauthState,
    id: randomUUID(),
    requestedScopes: sortedCredentialScopes(input.requestedScopes),
    returnIntent: normalizeOAuthReturnIntent(input.returnIntent),
    stateHash: oauthStateHash(state),
    createdAt,
    expiresAt
  });

  return {
    state,
    command
  } as const;
}

export function createReauthorizationStateIntent(
  input: Omit<
    CreateReauthorizationStateCommand,
    | "contractVersion"
    | "id"
    | "stateHash"
    | "createdAt"
    | "expiresAt"
    | "requestedScopes"
    | "redirectUri"
    | "returnIntent"
    | "authorizationPurpose"
    | "reasonCode"
  > & {
    requestedScopes: readonly string[];
  },
  now = new Date()
) {
  const state = `r1_${randomBytes(PHASE_5_OAUTH_STATE_BYTES).toString("base64url")}`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + PHASE_5_OAUTH_STATE_TTL_SECONDS * 1_000
  ).toISOString();
  const command = CreateReauthorizationStateCommandSchema.parse({
    ...input,
    contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.reauthorizationState,
    id: randomUUID(),
    requestedScopes: sortedCredentialScopes(input.requestedScopes),
    redirectUri: PHASE_8B_REAUTHORIZATION_REDIRECT_URI,
    returnIntent: PHASE_8B_REAUTHORIZATION_RETURN_INTENT,
    authorizationPurpose: "reauthorization",
    reasonCode: "expired_credential_recovery",
    stateHash: reauthorizationStateHash(state),
    createdAt,
    expiresAt
  });

  return { state, command } as const;
}
