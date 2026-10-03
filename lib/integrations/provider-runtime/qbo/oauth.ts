import "server-only";

import { z } from "zod";

import {
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CredentialEnvelopeSchema,
  type CredentialEnvelope,
  type CredentialRefreshBoundaryReport,
  type CredentialRefreshBoundaryReporter
} from "@/lib/integrations/credentials/contracts";
import { ProviderCredentialRefreshFailure } from "@/lib/integrations/credentials/provider-failure";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { validateProviderOAuthCallbackUri } from "@/lib/integrations/credentials/oauth-policy";
import {
  QboProviderEnvironmentSchema,
  type QboProviderEnvironment
} from "@/lib/integrations/provider-runtime/qbo/client";
import {
  QBO_ACCOUNTING_SCOPE,
  QBO_AUTHORIZATION_ENDPOINT,
  QBO_REVOCATION_ENDPOINT,
  QBO_TOKEN_ENDPOINT,
  qboProviderOAuthPolicy
} from "@/lib/integrations/provider-runtime/qbo/oauth-policy";
import { QBO_PROVIDER_KEY } from "@/lib/integrations/providers/qbo/contracts";

export {
  QBO_ACCOUNTING_SCOPE,
  QBO_AUTHORIZATION_ENDPOINT,
  QBO_OAUTH_POLICY_VERSION,
  QBO_PROVIDER_OAUTH_POLICY_REGISTRY,
  QBO_REVOCATION_ENDPOINT,
  QBO_TOKEN_ENDPOINT
} from "@/lib/integrations/provider-runtime/qbo/oauth-policy";

export const QBO_OAUTH_MAX_RESPONSE_BYTES = 64 * 1024;

const QboRealmIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/);

const QboOAuthTokenResponseSchema = z
  .object({
    access_token: z.string().min(16).max(16_384),
    refresh_token: z.string().min(16).max(16_384),
    expires_in: z.number().int().positive().max(86_400),
    x_refresh_token_expires_in: z.number().int().positive().max(31_536_000),
    token_type: z.literal("bearer"),
    scope: z.string().min(1).max(4_096).optional()
  })
  .passthrough();

const QboOAuthErrorResponseSchema = z
  .object({ error: z.string().min(1).max(128) })
  .passthrough();

export type QboOAuthHttpResponse = Readonly<{
  status: number;
  body: Uint8Array;
}>;

export type QboOAuthHttpTransport = Readonly<{
  postForm(input: Readonly<{
    url: string;
    authorization: string;
    contentType: "application/x-www-form-urlencoded" | "application/json";
    body: string;
    timeoutMs: number;
    maximumResponseBytes: number;
  }>): PromiseLike<QboOAuthHttpResponse>;
}>;

function safeBase64Basic(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function sortedScopes(value: string) {
  const scopes = value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean).sort();
  if (new Set(scopes).size !== scopes.length) {
    throw new Error("qbo_oauth_scope_response_invalid");
  }
  return scopes;
}

function assertAccountingScope(scopes: readonly string[]) {
  if (scopes.length !== 1 || scopes[0] !== QBO_ACCOUNTING_SCOPE) {
    throw new Error("qbo_oauth_scope_set_invalid");
  }
}

function timestampAfter(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

async function reportBoundary(
  reporter: CredentialRefreshBoundaryReporter | undefined,
  event: CredentialRefreshBoundaryReport
) {
  if (!reporter) return;
  try {
    await reporter(event);
  } catch {
    // Boundary telemetry is deliberately non-blocking after the refresh lease is held.
  }
}

function providerFailure(response: QboOAuthHttpResponse, parsed: unknown) {
  if (response.status === 429 || response.status >= 500) {
    return new ProviderCredentialRefreshFailure("provider_transient");
  }
  const errorCode = QboOAuthErrorResponseSchema.safeParse(parsed);
  if (errorCode.success && errorCode.data.error === "invalid_grant") {
    return new ProviderCredentialRefreshFailure("invalid_grant");
  }
  if (
    response.status === 403 ||
    (errorCode.success && ["access_denied", "authorization_expired"].includes(errorCode.data.error))
  ) {
    return new ProviderCredentialRefreshFailure("provider_revoked");
  }
  return new ProviderCredentialRefreshFailure("integrity_failure");
}

async function parseTokenResponse(
  response: QboOAuthHttpResponse,
  reporter?: CredentialRefreshBoundaryReporter
) {
  await reportBoundary(reporter, {
    stage: "provider_response_parse",
    outcome: "started",
    reasonCode: "started"
  });
  if (response.body.byteLength === 0 || response.body.byteLength > QBO_OAUTH_MAX_RESPONSE_BYTES) {
    await reportBoundary(reporter, {
      stage: "provider_response_parse",
      outcome: "failed",
      reasonCode: "integrity_failure"
    });
    throw new ProviderCredentialRefreshFailure("integrity_failure");
  }
  const bytes = Buffer.from(response.body);
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new ProviderCredentialRefreshFailure("integrity_failure");
    }
    if (response.status < 200 || response.status >= 300) {
      throw providerFailure(response, parsed);
    }
    const token = QboOAuthTokenResponseSchema.safeParse(parsed);
    if (!token.success) throw new ProviderCredentialRefreshFailure("integrity_failure");
    await reportBoundary(reporter, {
      stage: "provider_response_parse",
      outcome: "succeeded",
      reasonCode: "succeeded"
    });
    return token.data;
  } catch (error) {
    const failure =
      error instanceof ProviderCredentialRefreshFailure
        ? error
        : new ProviderCredentialRefreshFailure("integrity_failure");
    await reportBoundary(reporter, {
      stage: "provider_response_parse",
      outcome: "failed",
      reasonCode: failure.code
    });
    throw failure;
  } finally {
    bytes.fill(0);
    response.body.fill(0);
  }
}

function credentialEnvelope(input: {
  response: z.infer<typeof QboOAuthTokenResponseSchema>;
  realmId: string;
  providerEnvironment: QboProviderEnvironment;
  now: Date;
  grantedScopes: readonly string[];
}): CredentialEnvelope {
  const grantedScopes = sortedScopes(input.grantedScopes.join(" "));
  assertAccountingScope(grantedScopes);
  if (input.response.scope !== undefined) {
    const responseScopes = sortedScopes(input.response.scope);
    assertAccountingScope(responseScopes);
    if (responseScopes.join(" ") !== grantedScopes.join(" ")) {
      throw new Error("qbo_oauth_scope_response_mismatch");
    }
  }
  return CredentialEnvelopeSchema.parse({
    schemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
    providerKey: QBO_PROVIDER_KEY,
    environment: QboProviderEnvironmentSchema.parse(input.providerEnvironment),
    externalAuthorizedEntityReference: QboRealmIdSchema.parse(input.realmId),
    accessToken: input.response.access_token,
    accessExpiresAt: timestampAfter(input.now, input.response.expires_in),
    refreshToken: input.response.refresh_token,
    refreshExpiresAt: timestampAfter(
      input.now,
      input.response.x_refresh_token_expires_in
    ),
    grantedScopes,
    issuedAt: input.now.toISOString(),
    updatedAt: input.now.toISOString()
  });
}

export function createQboAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  providerEnvironment?: QboProviderEnvironment;
}) {
  const clientId = z.string().min(8).max(512).parse(input.clientId);
  const providerEnvironment = QboProviderEnvironmentSchema.parse(
    input.providerEnvironment ?? "production"
  );
  const redirectUri = validateProviderOAuthCallbackUri(
    qboProviderOAuthPolicy(providerEnvironment),
    input.redirectUri
  );
  const state = z.string().min(43).max(256).regex(/^[A-Za-z0-9_-]+$/).parse(input.state);
  const url = new URL(QBO_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_ACCOUNTING_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export function createQboSandboxAuthorizationUrl(
  input: Omit<Parameters<typeof createQboAuthorizationUrl>[0], "providerEnvironment">
) {
  return createQboAuthorizationUrl({ ...input, providerEnvironment: "sandbox" });
}

export class QboOAuthCredentialProvider {
  readonly providerKey = QBO_PROVIDER_KEY;
  readonly environment: QboProviderEnvironment;
  readonly refreshTokenRotationPolicy = "returned_token_authoritative" as const;
  readonly tokenType = "bearer" as const;
  readonly #redirectUri: string;
  readonly #transport: QboOAuthHttpTransport;

  constructor(input: {
    environment: QboProviderEnvironment;
    redirectUri: string;
    transport: QboOAuthHttpTransport;
  }) {
    this.environment = QboProviderEnvironmentSchema.parse(input.environment);
    this.#redirectUri = validateProviderOAuthCallbackUri(
      qboProviderOAuthPolicy(this.environment),
      input.redirectUri
    );
    this.#transport = input.transport;
  }

  async exchangeAuthorizationCode(input: {
    authorizationCode: string;
    externalAuthorizedEntityReference?: string | null;
    applicationSecret: ProviderApplicationSecret;
    requestedScopes: readonly string[];
    now: Date;
  }) {
    const requestedScopes = sortedScopes(input.requestedScopes.join(" "));
    assertAccountingScope(requestedScopes);
    const authorizationCode = z.string().min(8).max(8_192).parse(input.authorizationCode);
    const realmId = QboRealmIdSchema.parse(input.externalAuthorizedEntityReference);
    return input.applicationSecret.use(async ({ clientId, clientSecret }) => {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: this.#redirectUri
      }).toString();
      const response = await this.#transport.postForm({
        url: QBO_TOKEN_ENDPOINT,
        authorization: safeBase64Basic(clientId, clientSecret),
        contentType: "application/x-www-form-urlencoded",
        body,
        timeoutMs: 15_000,
        maximumResponseBytes: QBO_OAUTH_MAX_RESPONSE_BYTES
      });
      return credentialEnvelope({
        response: await parseTokenResponse(response),
        realmId,
        providerEnvironment: this.environment,
        now: input.now,
        grantedScopes: requestedScopes
      });
    });
  }

  async refreshCredential(input: {
    credential: CredentialEnvelope;
    applicationSecret: ProviderApplicationSecret;
    now: Date;
    reportBoundary?: CredentialRefreshBoundaryReporter;
  }) {
    const current = CredentialEnvelopeSchema.parse(input.credential);
    if (
      current.providerKey !== QBO_PROVIDER_KEY ||
      current.environment !== this.environment ||
      current.externalAuthorizedEntityReference === null
    ) {
      throw new Error("qbo_oauth_credential_binding_invalid");
    }
    const realmId = current.externalAuthorizedEntityReference;
    assertAccountingScope(current.grantedScopes);
    return input.applicationSecret.use(async ({ clientId, clientSecret }) => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken
      }).toString();
      await reportBoundary(input.reportBoundary, {
        stage: "provider_token_request",
        outcome: "started",
        reasonCode: "started"
      });
      let response: QboOAuthHttpResponse;
      try {
        response = await this.#transport.postForm({
          url: QBO_TOKEN_ENDPOINT,
          authorization: safeBase64Basic(clientId, clientSecret),
          contentType: "application/x-www-form-urlencoded",
          body,
          timeoutMs: 15_000,
          maximumResponseBytes: QBO_OAUTH_MAX_RESPONSE_BYTES
        });
      } catch {
        await reportBoundary(input.reportBoundary, {
          stage: "provider_token_request",
          outcome: "failed",
          reasonCode: "provider_transient"
        });
        throw new ProviderCredentialRefreshFailure("provider_transient");
      }
      await reportBoundary(input.reportBoundary, {
        stage: "provider_token_request",
        outcome: "succeeded",
        reasonCode: "succeeded"
      });
      return credentialEnvelope({
        response: await parseTokenResponse(response, input.reportBoundary),
        realmId,
        providerEnvironment: this.environment,
        now: input.now,
        grantedScopes: current.grantedScopes
      });
    });
  }

  async revokeCredential(input: {
    credential: CredentialEnvelope;
    applicationSecret: ProviderApplicationSecret;
  }) {
    const current = CredentialEnvelopeSchema.parse(input.credential);
    await input.applicationSecret.use(async ({ clientId, clientSecret }) => {
      const response = await this.#transport.postForm({
        url: QBO_REVOCATION_ENDPOINT,
        authorization: safeBase64Basic(clientId, clientSecret),
        contentType: "application/json",
        body: JSON.stringify({ token: current.refreshToken }),
        timeoutMs: 15_000,
        maximumResponseBytes: QBO_OAUTH_MAX_RESPONSE_BYTES
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error("qbo_oauth_revocation_failed");
      }
    });
  }
}

export class QboSandboxOAuthCredentialProvider extends QboOAuthCredentialProvider {
  constructor(
    input: Omit<ConstructorParameters<typeof QboOAuthCredentialProvider>[0], "environment">
  ) {
    super({ ...input, environment: "sandbox" });
  }
}
