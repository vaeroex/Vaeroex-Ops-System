import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION } from "@/lib/document-extraction/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const KEY_VERSION = /^[A-Za-z0-9._:-]{1,120}$/;

type LeaseCapability = {
  version: typeof DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION;
  keyVersion: string;
  kind: "lease";
  jobId: string;
  workerId: string;
  expiresAt: number;
};

type FileCapability = {
  version: typeof DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION;
  keyVersion: string;
  kind: "file";
  grantId: string;
  workerId: string;
  secret: string;
  expiresAt: number;
};

export type DocumentExtractionBrokerCapability = LeaseCapability | FileCapability;
type UnsignedDocumentExtractionBrokerCapability =
  | Omit<LeaseCapability, "keyVersion">
  | Omit<FileCapability, "keyVersion">;

function capabilityKeyring(environment: NodeJS.ProcessEnv) {
  const encodedKeys = environment.DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON;
  const currentVersion = environment.DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION;
  if (!encodedKeys?.trim() || !KEY_VERSION.test(currentVersion || "")) {
    throw new Error("document_extraction_broker_capability_key_missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKeys);
  } catch {
    throw new Error("document_extraction_broker_capability_key_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("document_extraction_broker_capability_key_invalid");
  }
  const entries = Object.entries(parsed);
  if (!entries.length || entries.length > 3) {
    throw new Error("document_extraction_broker_capability_key_invalid");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyVersion, encoded] of entries) {
    if (!KEY_VERSION.test(keyVersion) || typeof encoded !== "string") {
      throw new Error("document_extraction_broker_capability_key_invalid");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
      throw new Error("document_extraction_broker_capability_key_invalid");
    }
    keys.set(keyVersion, key);
  }
  if (!keys.has(currentVersion as string)) {
    throw new Error("document_extraction_broker_capability_key_invalid");
  }
  return { currentVersion: currentVersion as string, keys };
}

function payloadFor(capability: DocumentExtractionBrokerCapability) {
  return Buffer.from(JSON.stringify(capability), "utf8").toString("base64url");
}

function sign(payload: string, key: Buffer) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function encode(
  capability: UnsignedDocumentExtractionBrokerCapability,
  environment: NodeJS.ProcessEnv
) {
  const keyring = capabilityKeyring(environment);
  const versionedCapability = {
    ...capability,
    keyVersion: keyring.currentVersion
  } as DocumentExtractionBrokerCapability;
  const payload = payloadFor(versionedCapability);
  return `${payload}.${sign(payload, keyring.keys.get(keyring.currentVersion) as Buffer)}`;
}

export function createLeaseCapability({
  jobId,
  workerId,
  expiresAt,
  environment = process.env
}: {
  jobId: string;
  workerId: string;
  expiresAt: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const expiration = Date.parse(expiresAt);
  if (!UUID.test(jobId) || !WORKER_ID.test(workerId) || !Number.isFinite(expiration)) {
    throw new Error("document_extraction_lease_capability_invalid");
  }
  return encode({
    version: DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION,
    kind: "lease",
    jobId,
    workerId,
    expiresAt: expiration
  }, environment);
}

export function createFileCapability({
  grantId,
  workerId,
  expiresAt,
  secret,
  environment = process.env
}: {
  grantId: string;
  workerId: string;
  expiresAt: string;
  secret: string;
  environment?: NodeJS.ProcessEnv;
}) {
  const expiration = Date.parse(expiresAt);
  if (
    !UUID.test(grantId)
    || !WORKER_ID.test(workerId)
    || !Number.isFinite(expiration)
    || !/^[A-Za-z0-9_-]{43}$/.test(secret)
  ) {
    throw new Error("document_extraction_file_capability_invalid");
  }
  return encode({
    version: DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION,
    kind: "file",
    grantId,
    workerId,
    secret,
    expiresAt: expiration
  }, environment);
}

export function createFileGrantSecret() {
  return randomBytes(32).toString("base64url");
}

export function verifyBrokerCapability({
  token,
  workerId,
  expectedKind,
  environment = process.env,
  now = Date.now()
}: {
  token: string;
  workerId: string;
  expectedKind: DocumentExtractionBrokerCapability["kind"];
  environment?: NodeJS.ProcessEnv;
  now?: number;
}): DocumentExtractionBrokerCapability {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("document_extraction_capability_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("document_extraction_capability_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("document_extraction_capability_invalid");
  }
  const capability = parsed as Partial<DocumentExtractionBrokerCapability>;
  if (!KEY_VERSION.test(capability.keyVersion || "")) {
    throw new Error("document_extraction_capability_invalid");
  }
  const keyring = capabilityKeyring(environment);
  const key = keyring.keys.get(capability.keyVersion as string);
  if (!key) throw new Error("document_extraction_capability_expired_or_invalid");
  const expected = Buffer.from(sign(payload, key), "utf8");
  const observed = Buffer.from(signature, "utf8");
  if (expected.byteLength !== observed.byteLength || !timingSafeEqual(expected, observed)) {
    throw new Error("document_extraction_capability_invalid");
  }
  if (
    capability.version !== DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION
    || capability.kind !== expectedKind
    || capability.workerId !== workerId
    || !WORKER_ID.test(workerId)
    || !Number.isFinite(capability.expiresAt)
    || (capability.expiresAt as number) <= now
    || (capability.expiresAt as number) > now + 5 * 60_000
  ) {
    throw new Error("document_extraction_capability_expired_or_invalid");
  }
  if (capability.kind === "lease" && !UUID.test(capability.jobId || "")) {
    throw new Error("document_extraction_capability_invalid");
  }
  if (
    capability.kind === "file"
    && (!UUID.test(capability.grantId || "") || !/^[A-Za-z0-9_-]{43}$/.test(capability.secret || ""))
  ) {
    throw new Error("document_extraction_capability_invalid");
  }
  return capability as DocumentExtractionBrokerCapability;
}
