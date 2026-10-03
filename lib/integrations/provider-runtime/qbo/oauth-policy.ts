import {
  ProviderOAuthPolicySchema,
  createProviderOAuthPolicyRegistry,
  providerOAuthPolicy
} from "@/lib/integrations/credentials/oauth-policy";
import { QBO_PROVIDER_KEY } from "@/lib/integrations/providers/qbo/contracts";

export const QBO_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting" as const;
export const QBO_AUTHORIZATION_ENDPOINT =
  "https://appcenter.intuit.com/connect/oauth2" as const;
export const QBO_TOKEN_ENDPOINT =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" as const;
export const QBO_REVOCATION_ENDPOINT =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke" as const;
export const QBO_OAUTH_POLICY_VERSION = "qbo_oauth_runtime_policy_v1" as const;
export const QBO_PRODUCTION_CALLBACK_URI =
  "https://integrations.vaeroex.com/oauth/callback" as const;
export const QBO_CUSTOMER_SETTINGS_PATH = "/app/settings" as const;
export const QBO_CUSTOMER_DISCONNECT_PATH =
  "/app/settings/integrations/quickbooks/disconnect" as const;
export const QBO_PHASE_8B_CALLBACK_URI =
  "https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback" as const;
export const QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH =
  "/phase8b/sandbox/authorized" as const;
export const QBO_PHASE_8B_REAUTHORIZATION_RETURN_PATH =
  "/phase8b/sandbox/reauthorized" as const;

export const QBO_PRODUCTION_OAUTH_POLICY = ProviderOAuthPolicySchema.parse({
  contractVersion: "provider_oauth_policy_v1",
  policyVersion: QBO_OAUTH_POLICY_VERSION,
  providerKey: QBO_PROVIDER_KEY,
  providerEnvironment: "production",
  authorizationMode: "oauth2_confidential_authorization_code",
  authorizationEndpoint: QBO_AUTHORIZATION_ENDPOINT,
  tokenEndpoint: QBO_TOKEN_ENDPOINT,
  revocationEndpoint: QBO_REVOCATION_ENDPOINT,
  callbackUri: QBO_PRODUCTION_CALLBACK_URI,
  callbackPath: "/oauth/callback",
  defaultAuthorizationReturnPath: QBO_CUSTOMER_SETTINGS_PATH,
  defaultReauthorizationReturnPath: QBO_CUSTOMER_SETTINGS_PATH,
  permittedReturnPaths: [QBO_CUSTOMER_SETTINGS_PATH],
  requestedScopes: [QBO_ACCOUNTING_SCOPE],
  tokenLifetime: {
    accessTokenMaximumSeconds: 86_400,
    requiredAccessTokenLifetimeSeconds: null,
    providerShortLivedAccessTokenRequired: false
  },
  externalEntityAuthority: {
    requiredForAuthorization: true,
    authorizedEntityTypes: ["company"],
    reauthorizationEntityTypes: ["company"]
  }
});

export const QBO_PHASE_8B_OAUTH_POLICY = ProviderOAuthPolicySchema.parse({
  contractVersion: "provider_oauth_policy_v1",
  policyVersion: QBO_OAUTH_POLICY_VERSION,
  providerKey: QBO_PROVIDER_KEY,
  providerEnvironment: "sandbox",
  authorizationMode: "oauth2_confidential_authorization_code",
  authorizationEndpoint: QBO_AUTHORIZATION_ENDPOINT,
  tokenEndpoint: QBO_TOKEN_ENDPOINT,
  revocationEndpoint: QBO_REVOCATION_ENDPOINT,
  callbackUri: QBO_PHASE_8B_CALLBACK_URI,
  callbackPath: "/oauth/callback",
  defaultAuthorizationReturnPath: QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH,
  defaultReauthorizationReturnPath: QBO_PHASE_8B_REAUTHORIZATION_RETURN_PATH,
  permittedReturnPaths: [
    QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH,
    QBO_PHASE_8B_REAUTHORIZATION_RETURN_PATH
  ],
  requestedScopes: [QBO_ACCOUNTING_SCOPE],
  tokenLifetime: {
    accessTokenMaximumSeconds: 86_400,
    requiredAccessTokenLifetimeSeconds: null,
    providerShortLivedAccessTokenRequired: false
  },
  externalEntityAuthority: {
    requiredForAuthorization: true,
    authorizedEntityTypes: ["company"],
    reauthorizationEntityTypes: ["company"]
  }
});

export const QBO_PROVIDER_OAUTH_POLICY_REGISTRY =
  createProviderOAuthPolicyRegistry([
    QBO_PHASE_8B_OAUTH_POLICY,
    QBO_PRODUCTION_OAUTH_POLICY
  ]);

export function qboProviderOAuthPolicy(environment: "production" | "sandbox") {
  return providerOAuthPolicy(
    QBO_PROVIDER_OAUTH_POLICY_REGISTRY,
    QBO_PROVIDER_KEY,
    environment
  );
}
