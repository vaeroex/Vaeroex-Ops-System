import { z } from "zod";

import {
  CredentialEnvironmentSchema,
  SecretManagerVersionResourceSchema
} from "@/lib/integrations/credentials/contracts";
import { ProviderKeySchema } from "@/lib/integrations/contracts/primitives";

const ProviderApplicationSecretPayloadSchema = z
  .object({
    schemaVersion: z.literal("provider_application_secret_v1"),
    providerKey: ProviderKeySchema,
    environment: CredentialEnvironmentSchema,
    clientId: z.string().min(8).max(512),
    clientSecret: z.string().min(16).max(16_384)
  })
  .strict();

export type SecretManagerTransport = Readonly<{
  accessSecretVersion(request: Readonly<{ name: string }>): PromiseLike<
    Readonly<{ payload: Readonly<{ data: string | null | undefined }> | null | undefined }>
  >;
}>;

export class ProviderApplicationSecret {
  readonly providerKey: string;
  readonly environment: string;
  readonly #clientId: string;
  readonly #clientSecret: string;

  constructor(input: z.infer<typeof ProviderApplicationSecretPayloadSchema>) {
    const value = ProviderApplicationSecretPayloadSchema.parse(input);
    this.providerKey = value.providerKey;
    this.environment = value.environment;
    this.#clientId = value.clientId;
    this.#clientSecret = value.clientSecret;
  }

  use<T>(callback: (value: Readonly<{ clientId: string; clientSecret: string }>) => T) {
    return callback({ clientId: this.#clientId, clientSecret: this.#clientSecret });
  }

  toJSON() {
    return {
      providerKey: this.providerKey,
      environment: this.environment,
      secretMaterial: "[redacted]"
    };
  }

  toString() {
    return "[ProviderApplicationSecret redacted]";
  }
}

export class GoogleSecretManagerProviderSecrets {
  readonly #transport: SecretManagerTransport;
  readonly #resources: ReadonlyMap<string, string>;

  constructor(input: {
    transport: SecretManagerTransport;
    resources: Readonly<Record<string, string>>;
  }) {
    this.#transport = input.transport;
    this.#resources = new Map(
      Object.entries(input.resources).map(([key, resource]) => [
        key,
        SecretManagerVersionResourceSchema.parse(resource)
      ])
    );
  }

  async access(providerKey: string, environment: string) {
    const checkedProvider = ProviderKeySchema.parse(providerKey);
    const checkedEnvironment = CredentialEnvironmentSchema.parse(environment);
    const resource = this.#resources.get(
      `${checkedProvider}:${checkedEnvironment}`
    );
    if (!resource) throw new Error("provider_application_secret_not_configured");

    try {
      const response = await this.#transport.accessSecretVersion({ name: resource });
      const encoded = response.payload?.data;
      if (!encoded) throw new Error("provider_application_secret_missing");
      const decoded = Buffer.from(encoded, "base64");
      try {
        const payload = ProviderApplicationSecretPayloadSchema.parse(
          JSON.parse(decoded.toString("utf8"))
        );
        if (
          payload.providerKey !== checkedProvider ||
          payload.environment !== checkedEnvironment
        ) {
          throw new Error("provider_application_secret_binding_invalid");
        }
        return new ProviderApplicationSecret(payload);
      } finally {
        decoded.fill(0);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "provider_application_secret_binding_invalid"
      ) {
        throw error;
      }
      throw new Error("provider_application_secret_access_failed");
    }
  }
}
