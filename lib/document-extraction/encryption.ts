import type {
  EncryptedDocumentExtractionEnvelopeV1,
  NormalizedDocumentExtractionArtifactV1
} from "@/lib/document-extraction/contracts";

export type DocumentExtractionEncryptionContext = {
  workspaceId: string;
  cacheKey: string;
  extractionContractVersion: string;
};

export interface DocumentExtractionManagedEncryptionProvider {
  encrypt(
    artifact: NormalizedDocumentExtractionArtifactV1,
    context: DocumentExtractionEncryptionContext
  ): Promise<EncryptedDocumentExtractionEnvelopeV1>;
  decrypt(
    envelope: EncryptedDocumentExtractionEnvelopeV1,
    context: DocumentExtractionEncryptionContext
  ): Promise<NormalizedDocumentExtractionArtifactV1>;
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

// Phase A intentionally provides no encryption implementation and no fallback key.
// Phase B must bind this interface to managed, versioned key material before a worker exists.
