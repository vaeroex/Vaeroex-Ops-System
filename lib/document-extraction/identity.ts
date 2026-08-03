import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { DocumentExtractionDocumentClass, DocumentExtractionRoute } from "@/lib/document-extraction/contracts";

export const DOCUMENT_EXTRACTION_IDENTITY_VERSION = "document_extraction_identity_v1" as const;

type DocumentExtractionIdentityInput = {
  secret: Uint8Array;
  workspaceId: string;
  fileBytes: Uint8Array;
  route: DocumentExtractionRoute;
  documentClass: DocumentExtractionDocumentClass;
  provider: string;
  modelRevision: string;
  clientRevision: string;
  routingPolicyVersion: string;
  extractionContractVersion: string;
  normalizationVersion: string;
};

function requireBoundedIdentityPart(label: string, value: string, maxLength = 200) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error(`${label} is not a valid extraction identity component.`);
  }
  return normalized;
}

function hmacHex(secret: Uint8Array, value: string) {
  if (secret.byteLength < 32) throw new Error("Document extraction identity requires at least 256 bits of secret key material.");
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function buildDocumentExtractionIdentity(input: DocumentExtractionIdentityInput) {
  const workspaceId = requireBoundedIdentityPart("workspaceId", input.workspaceId, 64);
  const contentDigest = createHash("sha256").update(input.fileBytes).digest("hex");
  const contentHmac = hmacHex(
    input.secret,
    [DOCUMENT_EXTRACTION_IDENTITY_VERSION, "content", workspaceId, contentDigest].join("\u0000")
  );
  const cacheIdentity = {
    identityVersion: DOCUMENT_EXTRACTION_IDENTITY_VERSION,
    workspaceId,
    contentHmac,
    route: input.route,
    documentClass: input.documentClass,
    provider: requireBoundedIdentityPart("provider", input.provider),
    modelRevision: requireBoundedIdentityPart("modelRevision", input.modelRevision),
    clientRevision: requireBoundedIdentityPart("clientRevision", input.clientRevision),
    routingPolicyVersion: requireBoundedIdentityPart("routingPolicyVersion", input.routingPolicyVersion, 120),
    extractionContractVersion: requireBoundedIdentityPart("extractionContractVersion", input.extractionContractVersion, 120),
    normalizationVersion: requireBoundedIdentityPart("normalizationVersion", input.normalizationVersion, 120)
  } as const;
  const cacheKey = hmacHex(input.secret, JSON.stringify(cacheIdentity));
  return { contentHmac, cacheKey, cacheIdentity };
}

export function documentExtractionIdentityMatches(expectedHex: string, actualHex: string) {
  if (!/^[0-9a-f]{64}$/.test(expectedHex) || !/^[0-9a-f]{64}$/.test(actualHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(actualHex, "hex"));
}
