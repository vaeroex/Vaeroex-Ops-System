import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export type DocumentExtractionAadContext = {
  workspaceId: string;
  cacheKey: string;
  artifactFingerprint: string;
  extractionContractVersion: string;
  normalizationVersion: string;
  encryptionKeyVersion: string;
};

export type DocumentExtractionCiphertext = {
  algorithm: "aes-256-gcm";
  keyVersion: string;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  aadDigest: string;
  ciphertext: Uint8Array;
};

function assertHex64(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid ${label}.`);
}

function assertBoundedIdentity(value: string, label: string, maximum = 120) {
  if (!value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

export function documentExtractionAad(context: DocumentExtractionAadContext) {
  assertBoundedIdentity(context.workspaceId, "workspace identity", 80);
  assertHex64(context.cacheKey, "cache key");
  assertHex64(context.artifactFingerprint, "artifact fingerprint");
  assertBoundedIdentity(context.extractionContractVersion, "extraction contract version");
  assertBoundedIdentity(context.normalizationVersion, "normalization version");
  assertBoundedIdentity(context.encryptionKeyVersion, "encryption key version");
  return Buffer.from(
    JSON.stringify({
      artifactFingerprint: context.artifactFingerprint,
      cacheKey: context.cacheKey,
      encryptionKeyVersion: context.encryptionKeyVersion,
      extractionContractVersion: context.extractionContractVersion,
      normalizationVersion: context.normalizationVersion,
      workspaceId: context.workspaceId
    }),
    "utf8"
  );
}

export function documentExtractionAadDigest(context: DocumentExtractionAadContext) {
  return createHash("sha256").update(documentExtractionAad(context)).digest("hex");
}

export function encryptDocumentExtractionBytes({
  plaintext,
  key,
  context,
  nonce = randomBytes(12)
}: {
  plaintext: Uint8Array;
  key: Uint8Array;
  context: DocumentExtractionAadContext;
  nonce?: Uint8Array;
}): DocumentExtractionCiphertext {
  if (key.byteLength !== 32) throw new Error("AES-256-GCM requires a 256-bit key.");
  if (nonce.byteLength !== 12) throw new Error("AES-256-GCM requires a unique 96-bit nonce.");
  if (!plaintext.byteLength) throw new Error("Empty extraction payloads cannot be encrypted.");
  const aad = documentExtractionAad(context);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return {
    algorithm: "aes-256-gcm",
    keyVersion: context.encryptionKeyVersion,
    nonce: new Uint8Array(nonce),
    authenticationTag: new Uint8Array(authenticationTag),
    aadDigest: createHash("sha256").update(aad).digest("hex"),
    ciphertext: new Uint8Array(ciphertext)
  };
}

export function decryptDocumentExtractionBytes({
  envelope,
  key,
  context
}: {
  envelope: DocumentExtractionCiphertext;
  key: Uint8Array;
  context: DocumentExtractionAadContext;
}) {
  if (key.byteLength !== 32) throw new Error("AES-256-GCM requires a 256-bit key.");
  if (envelope.algorithm !== "aes-256-gcm" || envelope.keyVersion !== context.encryptionKeyVersion) {
    throw new Error("The encrypted extraction key context does not match.");
  }
  if (envelope.nonce.byteLength !== 12 || envelope.authenticationTag.byteLength !== 16) {
    throw new Error("The encrypted extraction envelope is malformed.");
  }
  const aad = documentExtractionAad(context);
  const expectedDigest = Buffer.from(createHash("sha256").update(aad).digest("hex"), "utf8");
  const receivedDigest = Buffer.from(envelope.aadDigest, "utf8");
  if (expectedDigest.byteLength !== receivedDigest.byteLength || !timingSafeEqual(expectedDigest, receivedDigest)) {
    throw new Error("The encrypted extraction metadata does not match its authenticated context.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag));
    return new Uint8Array(Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]));
  } catch {
    throw new Error("The encrypted extraction payload failed authentication.");
  }
}
