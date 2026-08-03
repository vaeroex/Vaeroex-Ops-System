import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION } from "@/lib/document-extraction/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

type LeaseCapability = {
  version: typeof DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION;
  kind: "lease";
  jobId: string;
  workerId: string;
  expiresAt: number;
};

type FileCapability = {
  version: typeof DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION;
  kind: "file";
  grantId: string;
  workerId: string;
  secret: string;
  expiresAt: number;
};

export type DocumentExtractionBrokerCapability = LeaseCapability | FileCapability;

function capabilityKey(environment: NodeJS.ProcessEnv) {
  const encoded = environment.DOCUMENT_EXTRACTION_BROKER_CAPABILITY_SECRET;
  if (!encoded?.trim()) throw new Error("document_extraction_broker_capability_key_missing");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    throw new Error("document_extraction_broker_capability_key_invalid");
  }
  return key;
}

function payloadFor(capability: DocumentExtractionBrokerCapability) {
  return Buffer.from(JSON.stringify(capability), "utf8").toString("base64url");
}

function sign(payload: string, environment: NodeJS.ProcessEnv) {
  return createHmac("sha256", capabilityKey(environment)).update(payload).digest("base64url");
}

function encode(capability: DocumentExtractionBrokerCapability, environment: NodeJS.ProcessEnv) {
  const payload = payloadFor(capability);
  return `${payload}.${sign(payload, environment)}`;
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
  const expected = Buffer.from(sign(payload, environment), "utf8");
  const observed = Buffer.from(signature, "utf8");
  if (expected.byteLength !== observed.byteLength || !timingSafeEqual(expected, observed)) {
    throw new Error("document_extraction_capability_invalid");
  }
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
