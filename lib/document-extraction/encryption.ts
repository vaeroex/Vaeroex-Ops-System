import "server-only";

import type {
  EncryptedDocumentExtractionEnvelopeV1,
  NormalizedDocumentExtractionArtifact
} from "@/lib/document-extraction/contracts";
import { parseAnyNormalizedDocumentExtractionArtifact } from "@/lib/document-extraction/artifact";
import {
  decryptDocumentExtractionBytes,
  encryptDocumentExtractionBytes,
  type DocumentExtractionAadContext
} from "@/lib/document-extraction/crypto-core";

const MAX_ENCRYPTED_ARTIFACT_BYTES = 8_000_000;

export type DocumentExtractionEncryptionContext = Omit<DocumentExtractionAadContext, "encryptionKeyVersion">;

export interface DocumentExtractionManagedEncryptionProvider {
  readonly currentKeyVersion: string;
  readonly readableKeyVersions: readonly string[];
  encrypt(
    artifact: NormalizedDocumentExtractionArtifact,
    context: DocumentExtractionEncryptionContext
  ): Promise<EncryptedDocumentExtractionEnvelopeV1>;
  decrypt(
    envelope: EncryptedDocumentExtractionEnvelopeV1,
    context: DocumentExtractionEncryptionContext
  ): Promise<NormalizedDocumentExtractionArtifact>;
}

export type DocumentExtractionManagedKeyring = {
  currentKeyVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
};

export type DocumentExtractionEncryptionProviderOptions = {
  nonceFactory?: () => Uint8Array;
};

function parseManagedKeyring(value: string | undefined, currentVersion: string | undefined) {
  if (!value?.trim() || !currentVersion?.trim()) {
    throw new Error("Managed document extraction encryption is not configured.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Managed document extraction encryption is misconfigured.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Managed document extraction encryption is misconfigured.");
  }
  const entries = Object.entries(parsed);
  if (!entries.length || entries.length > 3) throw new Error("Invalid document extraction key rotation set.");
  const keys = new Map<string, Uint8Array>();
  for (const [version, encoded] of entries) {
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(version) || typeof encoded !== "string") {
      throw new Error("Invalid document extraction key identity.");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
      throw new Error("Every document extraction key must be exactly 256 bits.");
    }
    keys.set(version, new Uint8Array(key));
  }
  if (!keys.has(currentVersion)) throw new Error("The current document extraction key is unavailable.");
  return { currentKeyVersion: currentVersion, keys } satisfies DocumentExtractionManagedKeyring;
}

export function loadManagedDocumentExtractionKeyring(
  environment: NodeJS.ProcessEnv = process.env
): DocumentExtractionManagedKeyring {
  // These values must be injected through the deployment secret manager. They are
  // deliberately unavailable to the Python worker and must never use NEXT_PUBLIC_.
  return parseManagedKeyring(
    environment.DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON,
    environment.DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION
  );
}

export function createManagedDocumentExtractionEncryptionProvider(
  keyring: DocumentExtractionManagedKeyring = loadManagedDocumentExtractionKeyring(),
  options: DocumentExtractionEncryptionProviderOptions = {}
): DocumentExtractionManagedEncryptionProvider {
  return {
    currentKeyVersion: keyring.currentKeyVersion,
    readableKeyVersions: [...keyring.keys.keys()],
    async encrypt(artifact, context) {
      const plaintext = Buffer.from(JSON.stringify(artifact), "utf8");
      if (!plaintext.byteLength || plaintext.byteLength > MAX_ENCRYPTED_ARTIFACT_BYTES) {
        throw new Error("The normalized extraction artifact exceeds its encryption boundary.");
      }
      const key = keyring.keys.get(keyring.currentKeyVersion);
      if (!key) throw new Error("The current document extraction key is unavailable.");
      return encryptDocumentExtractionBytes({
        plaintext,
        key,
        context: { ...context, encryptionKeyVersion: keyring.currentKeyVersion },
        nonce: options.nonceFactory?.()
      });
    },
    async decrypt(envelope, context) {
      assertEncryptedDocumentExtractionEnvelope(envelope);
      const key = keyring.keys.get(envelope.keyVersion);
      if (!key) throw new Error("The document extraction key version is unavailable.");
      const plaintext = decryptDocumentExtractionBytes({
        envelope,
        key,
        context: { ...context, encryptionKeyVersion: envelope.keyVersion }
      });
      if (plaintext.byteLength > MAX_ENCRYPTED_ARTIFACT_BYTES) {
        throw new Error("The decrypted extraction artifact exceeds its boundary.");
      }
      let artifact: unknown;
      try {
        artifact = JSON.parse(Buffer.from(plaintext).toString("utf8"));
      } catch {
        throw new Error("The decrypted extraction artifact is malformed.");
      }
      const normalizedArtifact = parseAnyNormalizedDocumentExtractionArtifact(artifact);
      if (normalizedArtifact.artifactFingerprint !== context.artifactFingerprint) {
        throw new Error("The decrypted artifact fingerprint does not match its cache identity.");
      }
      return normalizedArtifact;
    }
  };
}

export async function rotateDocumentExtractionEncryption({
  envelope,
  context,
  provider
}: {
  envelope: EncryptedDocumentExtractionEnvelopeV1;
  context: DocumentExtractionEncryptionContext;
  provider: DocumentExtractionManagedEncryptionProvider;
}) {
  const artifact = await provider.decrypt(envelope, context);
  if (envelope.keyVersion === provider.currentKeyVersion) return { artifact, envelope, rotated: false as const };
  return { artifact, envelope: await provider.encrypt(artifact, context), rotated: true as const };
}

export function assertEncryptedDocumentExtractionEnvelope(
  envelope: EncryptedDocumentExtractionEnvelopeV1
): EncryptedDocumentExtractionEnvelopeV1 {
  if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported document extraction encryption algorithm.");
  if (!envelope.keyVersion.trim() || envelope.keyVersion.length > 120) throw new Error("Invalid encryption key version.");
  if (envelope.nonce.byteLength !== 12) throw new Error("AES-GCM requires a 96-bit nonce.");
  if (envelope.authenticationTag.byteLength !== 16) throw new Error("AES-GCM requires a 128-bit authentication tag.");
  if (!/^[0-9a-f]{64}$/.test(envelope.aadDigest)) throw new Error("Invalid authenticated-data digest.");
  if (!envelope.ciphertext.byteLength) throw new Error("Plaintext or empty extraction cache payloads are not accepted.");
  return envelope;
}
