import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  IsoTimestampSchema,
  ProviderEnvironmentKeySchema,
  ProviderKeySchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";
import { CredentialEnvelopeSchema } from "@/lib/integrations/credentials/contracts";

export const PROVIDER_OAUTH_POLICY_CONTRACT_VERSION =
  "provider_oauth_policy_v1" as const;
export const PROVIDER_OAUTH_POLICY_REGISTRY_CONTRACT_VERSION =
  "provider_oauth_policy_registry_v1" as const;
export const PROVIDER_OAUTH_ACCESS_TOKEN_MAX_SECONDS = 86_400 as const;

const LOCAL_RETURN_PATH_MAX_BYTES = 512;
const OAUTH_URL_MAX_BYTES = 2_048;

function addIssue(context: z.RefinementCtx, message: string) {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}

function assertNoUrlConfusion(value: string, context: z.RefinementCtx) {
  if (
    /[\u0000-\u001f\u007f\s]/.test(value) ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("@")
  ) {
    addIssue(context, "OAuth URL contains unsafe normalized characters");
  }
}

export const LocalOAuthReturnPathSchema = z
  .string()
  .min(1)
  .max(LOCAL_RETURN_PATH_MAX_BYTES)
  .superRefine((value, context) => {
    if (
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.includes("\\") ||
      value.includes("%") ||
      value.includes("?") ||
      value.includes("#") ||
      value.includes("@") ||
      value.includes(":") ||
      value.includes("//") ||
      /[\u0000-\u001f\u007f\s]/.test(value) ||
      !/^\/[A-Za-z0-9/_-]*$/.test(value)
    ) {
      addIssue(context, "OAuth return path must be a normalized local path");
      return;
    }
    const segments = value.split("/");
    if (
      segments.some(
        (segment) => segment === "." || segment === ".." || segment.endsWith(".")
      )
    ) {
      addIssue(context, "OAuth return path must not contain dot segments");
      return;
    }
    const parsed = new URL(value, "https://vaeroex-return.invalid");
    if (
      parsed.origin !== "https://vaeroex-return.invalid" ||
      parsed.pathname !== value ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      addIssue(context, "OAuth return path must remain local after parsing");
    }
  });

const ExactHttpsOAuthUrlSchema = z
  .string()
  .min("https://a.co/".length)
  .max(OAUTH_URL_MAX_BYTES)
  .superRefine((value, context) => {
    assertNoUrlConfusion(value, context);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      addIssue(context, "OAuth endpoint URL is malformed");
      return;
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.hostname.endsWith(".") ||
      parsed.pathname.includes("//") ||
      parsed.pathname.split("/").some(
        (segment) => segment === "." || segment === ".." || segment.endsWith(".")
      ) ||
      parsed.toString() !== value
    ) {
      addIssue(context, "OAuth endpoint URL must be exact and normalized");
    }
  });

const sortedUniqueIdentifierSetSchema = z
  .array(BoundedIdentifierSchema)
  .min(1)
  .max(64)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      addIssue(context, "OAuth policy values must be unique");
    }
    if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
      addIssue(context, "OAuth policy values must be sorted");
    }
  });

const sortedUniqueReturnPathSetSchema = z
  .array(LocalOAuthReturnPathSchema)
  .min(1)
  .max(32)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      addIssue(context, "OAuth return paths must be unique");
    }
    if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
      addIssue(context, "OAuth return paths must be sorted");
    }
  });

export const ProviderOAuthTokenLifetimePolicySchema = z
  .object({
    accessTokenMaximumSeconds: z
      .number()
      .int()
      .positive()
      .max(PROVIDER_OAUTH_ACCESS_TOKEN_MAX_SECONDS)
      .safe(),
    requiredAccessTokenLifetimeSeconds: z
      .number()
      .int()
      .positive()
      .max(PROVIDER_OAUTH_ACCESS_TOKEN_MAX_SECONDS)
      .safe()
      .nullable(),
    providerShortLivedAccessTokenRequired: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.requiredAccessTokenLifetimeSeconds !== null &&
      value.requiredAccessTokenLifetimeSeconds >
        value.accessTokenMaximumSeconds
    ) {
      addIssue(context, "Required token lifetime cannot exceed the maximum");
    }
    if (
      value.providerShortLivedAccessTokenRequired &&
      value.requiredAccessTokenLifetimeSeconds !==
        PROVIDER_OAUTH_ACCESS_TOKEN_MAX_SECONDS
    ) {
      addIssue(
        context,
        "Short-lived provider token policy must require a 24-hour lifetime"
      );
    }
  });

export const ProviderOAuthExternalEntityAuthorityPolicySchema = z
  .object({
    requiredForAuthorization: z.boolean(),
    authorizedEntityTypes: sortedUniqueIdentifierSetSchema,
    reauthorizationEntityTypes: sortedUniqueIdentifierSetSchema
  })
  .strict()
  .superRefine((value, context) => {
    const authorized = new Set(value.authorizedEntityTypes);
    if (
      value.reauthorizationEntityTypes.some(
        (entityType) => !authorized.has(entityType)
      )
    ) {
      addIssue(
        context,
        "Reauthorization entity types must be a subset of authorized types"
      );
    }
  });

export const ProviderOAuthPolicySchema = z
  .object({
    contractVersion: z.literal(PROVIDER_OAUTH_POLICY_CONTRACT_VERSION),
    policyVersion: BoundedIdentifierSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: ProviderEnvironmentKeySchema,
    authorizationMode: z.literal("oauth2_confidential_authorization_code"),
    authorizationEndpoint: ExactHttpsOAuthUrlSchema,
    tokenEndpoint: ExactHttpsOAuthUrlSchema,
    revocationEndpoint: ExactHttpsOAuthUrlSchema.nullable(),
    callbackUri: ExactHttpsOAuthUrlSchema,
    callbackPath: LocalOAuthReturnPathSchema,
    defaultAuthorizationReturnPath: LocalOAuthReturnPathSchema,
    defaultReauthorizationReturnPath: LocalOAuthReturnPathSchema,
    permittedReturnPaths: sortedUniqueReturnPathSetSchema,
    requestedScopes: sortedUniqueIdentifierSetSchema,
    tokenLifetime: ProviderOAuthTokenLifetimePolicySchema,
    externalEntityAuthority: ProviderOAuthExternalEntityAuthorityPolicySchema
  })
  .strict()
  .superRefine((value, context) => {
    const callback = new URL(value.callbackUri);
    if (callback.pathname !== value.callbackPath) {
      addIssue(context, "OAuth callback URI must match the callback path");
    }
    const permitted = new Set(value.permittedReturnPaths);
    if (!permitted.has(value.defaultAuthorizationReturnPath)) {
      addIssue(
        context,
        "Default authorization return path must be explicitly permitted"
      );
    }
    if (!permitted.has(value.defaultReauthorizationReturnPath)) {
      addIssue(
        context,
        "Default reauthorization return path must be explicitly permitted"
      );
    }
  });

export const ProviderOAuthPolicyRegistrySchema = z
  .object({
    contractVersion: z.literal(PROVIDER_OAUTH_POLICY_REGISTRY_CONTRACT_VERSION),
    policies: z.array(ProviderOAuthPolicySchema).min(1).max(32)
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>();
    for (const [index, policy] of value.policies.entries()) {
      const key = `${policy.providerKey}\u0000${policy.providerEnvironment}`;
      if (keys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policies", index],
          message: "Provider OAuth policy environments must be unique"
        });
      }
      keys.add(key);
    }
    if (
      value.policies.some(
        (policy, index) =>
          index > 0 &&
          `${value.policies[index - 1].providerKey}\u0000${value.policies[index - 1].providerEnvironment}` >
            `${policy.providerKey}\u0000${policy.providerEnvironment}`
      )
    ) {
      addIssue(context, "Provider OAuth policy registry must be sorted");
    }
  });

export const AuthorizedProviderEntityEvidenceSchema = z
  .object({
    providerKey: ProviderKeySchema,
    providerEnvironment: ProviderEnvironmentKeySchema,
    externalAuthorizedEntityReference: BoundedIdentifierSchema,
    providerEntityType: BoundedIdentifierSchema,
    safeDisplayName: BoundedLabelSchema,
    verificationFingerprint: Sha256FingerprintSchema
  })
  .strict();

export type ProviderOAuthPolicy = Readonly<
  z.infer<typeof ProviderOAuthPolicySchema>
>;
export type ProviderOAuthPolicyRegistry = Readonly<
  z.infer<typeof ProviderOAuthPolicyRegistrySchema>
>;
export type AuthorizedProviderEntityEvidence = Readonly<
  z.infer<typeof AuthorizedProviderEntityEvidenceSchema>
>;

export function createProviderOAuthPolicyRegistry(
  policies: readonly ProviderOAuthPolicy[]
) {
  return ProviderOAuthPolicyRegistrySchema.parse({
    contractVersion: PROVIDER_OAUTH_POLICY_REGISTRY_CONTRACT_VERSION,
    policies: policies
      .map((policy) => ProviderOAuthPolicySchema.parse(policy))
      .sort((left, right) =>
        `${left.providerKey}\u0000${left.providerEnvironment}`.localeCompare(
          `${right.providerKey}\u0000${right.providerEnvironment}`
        )
      )
  });
}

export function providerOAuthPolicyFingerprint(policy: ProviderOAuthPolicy) {
  return contractSha256({
    fingerprintPurpose: "provider_oauth_policy",
    fingerprintVersion: "provider_oauth_policy_fingerprint_v1",
    payload: ProviderOAuthPolicySchema.parse(policy)
  });
}

export function providerOAuthPolicy(
  registry: ProviderOAuthPolicyRegistry,
  providerKey: string,
  providerEnvironment: string
) {
  const checked = ProviderOAuthPolicyRegistrySchema.parse(registry);
  const provider = ProviderKeySchema.parse(providerKey);
  const environment = ProviderEnvironmentKeySchema.parse(providerEnvironment);
  const policy = checked.policies.find(
    (candidate) =>
      candidate.providerKey === provider &&
      candidate.providerEnvironment === environment
  );
  if (!policy) throw new Error("provider_oauth_policy_not_registered");
  return policy;
}

export function assertProviderOAuthPolicyBinding(
  policy: ProviderOAuthPolicy,
  input: { providerKey: string; providerEnvironment: string }
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  if (
    checked.providerKey !== ProviderKeySchema.parse(input.providerKey) ||
    checked.providerEnvironment !==
      ProviderEnvironmentKeySchema.parse(input.providerEnvironment)
  ) {
    throw new Error("provider_oauth_policy_binding_invalid");
  }
  return checked;
}

export function normalizeProviderOAuthReturnPath(
  policy: ProviderOAuthPolicy,
  value: string
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  const normalized = LocalOAuthReturnPathSchema.parse(value);
  if (!checked.permittedReturnPaths.includes(normalized)) {
    throw new Error("provider_oauth_return_path_denied");
  }
  return normalized;
}

export function normalizeProviderOAuthRequestedScopes(
  policy: ProviderOAuthPolicy,
  values: readonly string[]
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  const normalized = sortedUniqueIdentifierSetSchema.parse(
    [...new Set(values)].sort((left, right) => left.localeCompare(right))
  );
  if (
    normalized.length !== checked.requestedScopes.length ||
    normalized.some((scope, index) => scope !== checked.requestedScopes[index])
  ) {
    throw new Error("provider_oauth_requested_scopes_denied");
  }
  return normalized;
}

export function validateProviderOAuthCallbackUri(
  policy: ProviderOAuthPolicy,
  value: string
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  const callback = ExactHttpsOAuthUrlSchema.parse(value);
  if (callback !== checked.callbackUri) {
    throw new Error("provider_oauth_callback_uri_denied");
  }
  return callback;
}

export function assertCredentialEnvelopeMatchesProviderOAuthPolicy(
  policy: ProviderOAuthPolicy,
  value: unknown
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  const envelope = CredentialEnvelopeSchema.parse(value);
  if (
    envelope.providerKey !== checked.providerKey ||
    envelope.environment !== checked.providerEnvironment
  ) {
    throw new Error("provider_oauth_envelope_binding_invalid");
  }
  const updatedAt = Date.parse(IsoTimestampSchema.parse(envelope.updatedAt));
  const accessExpiresAt = Date.parse(
    IsoTimestampSchema.parse(envelope.accessExpiresAt)
  );
  const lifetimeMs = accessExpiresAt - updatedAt;
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs <= 0 ||
    lifetimeMs > checked.tokenLifetime.accessTokenMaximumSeconds * 1_000
  ) {
    throw new Error("provider_oauth_access_lifetime_invalid");
  }
  if (
    checked.tokenLifetime.requiredAccessTokenLifetimeSeconds !== null &&
    lifetimeMs !==
      checked.tokenLifetime.requiredAccessTokenLifetimeSeconds * 1_000
  ) {
    throw new Error("provider_oauth_access_lifetime_required");
  }
  return envelope;
}

export function assertAuthorizedProviderEntityEvidence(
  policy: ProviderOAuthPolicy,
  value: unknown,
  input: {
    externalAuthorizedEntityReference: string;
    purpose: "authorization" | "reauthorization";
  }
) {
  const checked = ProviderOAuthPolicySchema.parse(policy);
  const evidence = AuthorizedProviderEntityEvidenceSchema.parse(value);
  if (
    evidence.providerKey !== checked.providerKey ||
    evidence.providerEnvironment !== checked.providerEnvironment ||
    evidence.externalAuthorizedEntityReference !==
      BoundedIdentifierSchema.parse(input.externalAuthorizedEntityReference)
  ) {
    throw new Error("provider_oauth_entity_authority_binding_invalid");
  }
  const allowed =
    input.purpose === "reauthorization"
      ? checked.externalEntityAuthority.reauthorizationEntityTypes
      : checked.externalEntityAuthority.authorizedEntityTypes;
  if (!allowed.includes(evidence.providerEntityType)) {
    throw new Error("provider_oauth_entity_type_denied");
  }
  return evidence;
}
