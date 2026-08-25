import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

import {
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CredentialEnvelopeSchema,
  type CredentialEnvelope
} from "@/lib/integrations/credentials/contracts";
import type {
  CredentialKms,
  CredentialKmsDecryptRequest,
  CredentialKmsEncryptRequest
} from "@/lib/integrations/credentials/kms";
import { PHASE_5_LEAKAGE_CANARIES } from "@/lib/integrations/credentials/redaction";
import { ProviderCredentialRefreshFailure } from "@/lib/integrations/credentials/provider-failure";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";

export type SyntheticProviderFailureCode =
  | "invalid_grant"
  | "provider_revoked"
  | "provider_transient"
  | "scope_loss";

export class SyntheticProviderFailure extends ProviderCredentialRefreshFailure {
  constructor(code: SyntheticProviderFailureCode) {
    super(code);
    this.name = "SyntheticProviderFailure";
  }
}

export class SyntheticCredentialKms implements CredentialKms {
  readonly #keyResource: string;
  readonly #key: Buffer;
  #disabled = false;

  constructor(input: { keyResource: string; key?: Uint8Array }) {
    this.#keyResource = input.keyResource;
    this.#key = input.key ? Buffer.from(input.key) : randomBytes(32);
    if (this.#key.byteLength !== 32) throw new Error("synthetic_kms_key_invalid");
  }

  setDisabled(value: boolean) {
    this.#disabled = value;
  }

  async encrypt(request: CredentialKmsEncryptRequest) {
    this.#assertKey(request.keyResource);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(request.additionalAuthenticatedData));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(request.plaintext)),
      cipher.final()
    ]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
  }

  async decrypt(request: CredentialKmsDecryptRequest) {
    this.#assertKey(request.keyResource);
    const value = Buffer.from(request.ciphertext);
    if (value.byteLength < 30 || value[0] !== 1) {
      throw new Error("credential_kms_decrypt_failed");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        value.subarray(1, 13)
      );
      decipher.setAAD(Buffer.from(request.additionalAuthenticatedData));
      decipher.setAuthTag(value.subarray(13, 29));
      return Buffer.concat([decipher.update(value.subarray(29)), decipher.final()]);
    } catch {
      throw new Error("credential_kms_decrypt_failed");
    }
  }

  #assertKey(keyResource: string) {
    if (this.#disabled) throw new Error("credential_kms_key_disabled");
    if (keyResource !== this.#keyResource) {
      throw new Error("credential_kms_key_not_allowed");
    }
  }
}

export class SyntheticOAuthProvider {
  readonly providerKey = "synthetic" as const;
  readonly environment = "test" as const;
  readonly refreshTokenRotationPolicy = "must_rotate" as const;
  readonly tokenType = "bearer" as const;
  readonly #activeRefreshTokens = new Set<string>();
  readonly #revokedRefreshTokens = new Set<string>();
  #sequence = 0;
  #nextRefreshFailure: SyntheticProviderFailureCode | null = null;
  #failNextRevocation = false;
  #exchangeCalls = 0;
  #refreshCalls = 0;
  #revokeCalls = 0;

  get callCounts() {
    return {
      exchange: this.#exchangeCalls,
      refresh: this.#refreshCalls,
      revoke: this.#revokeCalls
    } as const;
  }

  failNextRefresh(code: SyntheticProviderFailureCode) {
    this.#nextRefreshFailure = code;
  }

  failNextRevocation() {
    this.#failNextRevocation = true;
  }

  async exchangeAuthorizationCode(input: {
    authorizationCode: string;
    applicationSecret: ProviderApplicationSecret;
    requestedScopes: readonly string[];
    now: Date;
  }) {
    this.#exchangeCalls += 1;
    this.#assertApplicationSecret(input.applicationSecret);
    if (input.authorizationCode !== PHASE_5_LEAKAGE_CANARIES.authorizationCode) {
      throw new SyntheticProviderFailure("invalid_grant");
    }
    return this.#newEnvelope(input.requestedScopes, input.now);
  }

  async refreshCredential(input: {
    credential: CredentialEnvelope;
    applicationSecret: ProviderApplicationSecret;
    now: Date;
  }) {
    this.#refreshCalls += 1;
    this.#assertApplicationSecret(input.applicationSecret);
    const credential = CredentialEnvelopeSchema.parse(input.credential);
    const failure = this.#nextRefreshFailure;
    this.#nextRefreshFailure = null;
    if (failure === "provider_transient") {
      throw new SyntheticProviderFailure(failure);
    }
    if (failure === "invalid_grant") {
      throw new SyntheticProviderFailure(failure);
    }
    if (
      failure === "provider_revoked" ||
      this.#revokedRefreshTokens.has(credential.refreshToken)
    ) {
      throw new SyntheticProviderFailure("provider_revoked");
    }
    if (!this.#activeRefreshTokens.has(credential.refreshToken)) {
      throw new SyntheticProviderFailure("invalid_grant");
    }
    this.#activeRefreshTokens.delete(credential.refreshToken);
    if (failure === "scope_loss") {
      return this.#newEnvelope(["read_synthetic_reference_data"], input.now);
    }
    return this.#newEnvelope(credential.grantedScopes, input.now);
  }

  async revokeCredential(input: {
    credential: CredentialEnvelope;
    applicationSecret: ProviderApplicationSecret;
  }) {
    this.#revokeCalls += 1;
    this.#assertApplicationSecret(input.applicationSecret);
    if (this.#failNextRevocation) {
      this.#failNextRevocation = false;
      throw new SyntheticProviderFailure("provider_transient");
    }
    const credential = CredentialEnvelopeSchema.parse(input.credential);
    this.#activeRefreshTokens.delete(credential.refreshToken);
    this.#revokedRefreshTokens.add(credential.refreshToken);
    return { revoked: true } as const;
  }

  #assertApplicationSecret(secret: ProviderApplicationSecret) {
    const valid = secret.use(
      ({ clientId, clientSecret }) =>
        clientId === "synthetic-phase5-client" &&
        clientSecret === PHASE_5_LEAKAGE_CANARIES.clientSecret
    );
    if (!valid) throw new SyntheticProviderFailure("invalid_grant");
  }

  #newEnvelope(scopes: readonly string[], now: Date) {
    this.#sequence += 1;
    const suffix = createHash("sha256")
      .update(String(this.#sequence))
      .digest("hex")
      .slice(0, 16);
    const refreshToken = `${PHASE_5_LEAKAGE_CANARIES.refreshToken}_${suffix}`;
    this.#activeRefreshTokens.add(refreshToken);
    return CredentialEnvelopeSchema.parse({
      schemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
      providerKey: this.providerKey,
      environment: this.environment,
      externalAuthorizedEntityReference: "synthetic_entity_phase5",
      accessToken: `${PHASE_5_LEAKAGE_CANARIES.accessToken}_${suffix}`,
      accessExpiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      refreshToken,
      refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      grantedScopes: [...new Set(scopes)].sort(),
      issuedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  }
}
