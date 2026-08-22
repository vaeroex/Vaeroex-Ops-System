import { createHash } from "node:crypto";

import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import {
  CredentialAadContextSchema,
  KmsCryptoKeyResourceSchema,
  PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES,
  PHASE_5_MAX_AAD_BYTES,
  type CredentialAadContext
} from "@/lib/integrations/credentials/contracts";

export type CredentialKmsEncryptRequest = Readonly<{
  keyResource: string;
  plaintext: Uint8Array;
  additionalAuthenticatedData: Uint8Array;
}>;

export type CredentialKmsDecryptRequest = Readonly<{
  keyResource: string;
  ciphertext: Uint8Array;
  additionalAuthenticatedData: Uint8Array;
}>;

export type GoogleCloudKmsTransport = Readonly<{
  encrypt(request: Readonly<{
    name: string;
    plaintext: string;
    additionalAuthenticatedData: string;
  }>): PromiseLike<Readonly<{ ciphertext: string | null | undefined }>>;
  decrypt(request: Readonly<{
    name: string;
    ciphertext: string;
    additionalAuthenticatedData: string;
  }>): PromiseLike<Readonly<{ plaintext: string | null | undefined }>>;
}>;

export type CredentialKms = Readonly<{
  encrypt(request: CredentialKmsEncryptRequest): Promise<Uint8Array>;
  decrypt(request: CredentialKmsDecryptRequest): Promise<Uint8Array>;
}>;

function checkedBytes(value: Uint8Array, maximum: number, label: string) {
  if (value.byteLength === 0 || value.byteLength > maximum) {
    throw new Error(`${label}_size_invalid`);
  }
}

export function credentialAad(context: CredentialAadContext) {
  const checked = CredentialAadContextSchema.parse(context);
  const value = Buffer.from(canonicalContractJson(checked), "utf8");
  checkedBytes(value, PHASE_5_MAX_AAD_BYTES, "credential_aad");
  return value;
}

export function credentialAadDigest(context: CredentialAadContext) {
  return `sha256:${createHash("sha256")
    .update(credentialAad(context))
    .digest("hex")}` as const;
}

export class GoogleCloudKmsCredentialAdapter implements CredentialKms {
  readonly #transport: GoogleCloudKmsTransport;
  readonly #allowedKeyResource: string;

  constructor(input: {
    transport: GoogleCloudKmsTransport;
    allowedKeyResource: string;
  }) {
    this.#transport = input.transport;
    this.#allowedKeyResource = KmsCryptoKeyResourceSchema.parse(
      input.allowedKeyResource
    );
  }

  async encrypt(request: CredentialKmsEncryptRequest) {
    const keyResource = KmsCryptoKeyResourceSchema.parse(request.keyResource);
    if (keyResource !== this.#allowedKeyResource) {
      throw new Error("credential_kms_key_not_allowed");
    }
    checkedBytes(
      request.plaintext,
      PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES,
      "credential_plaintext"
    );
    checkedBytes(
      request.additionalAuthenticatedData,
      PHASE_5_MAX_AAD_BYTES,
      "credential_aad"
    );
    try {
      const response = await this.#transport.encrypt({
        name: keyResource,
        plaintext: Buffer.from(request.plaintext).toString("base64"),
        additionalAuthenticatedData: Buffer.from(
          request.additionalAuthenticatedData
        ).toString("base64")
      });
      if (!response.ciphertext) throw new Error("kms_ciphertext_missing");
      return Buffer.from(response.ciphertext, "base64");
    } catch {
      throw new Error("credential_kms_encrypt_failed");
    }
  }

  async decrypt(request: CredentialKmsDecryptRequest) {
    const keyResource = KmsCryptoKeyResourceSchema.parse(request.keyResource);
    if (keyResource !== this.#allowedKeyResource) {
      throw new Error("credential_kms_key_not_allowed");
    }
    checkedBytes(request.ciphertext, 128 * 1024, "credential_ciphertext");
    checkedBytes(
      request.additionalAuthenticatedData,
      PHASE_5_MAX_AAD_BYTES,
      "credential_aad"
    );
    try {
      const response = await this.#transport.decrypt({
        name: keyResource,
        ciphertext: Buffer.from(request.ciphertext).toString("base64"),
        additionalAuthenticatedData: Buffer.from(
          request.additionalAuthenticatedData
        ).toString("base64")
      });
      if (!response.plaintext) throw new Error("kms_plaintext_missing");
      const plaintext = Buffer.from(response.plaintext, "base64");
      checkedBytes(
        plaintext,
        PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES,
        "credential_plaintext"
      );
      return plaintext;
    } catch {
      throw new Error("credential_kms_decrypt_failed");
    }
  }
}
