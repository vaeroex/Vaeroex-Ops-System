import "server-only";

import { createHash, createPublicKey, verify } from "node:crypto";
import { DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION } from "@/lib/document-extraction/contracts";

const ASSERTION_TTL_SECONDS = 60;
const MAX_CLOCK_SKEW_SECONDS = 15;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const KEY_VERSION = /^[A-Za-z0-9._:-]{1,120}$/;
const NONCE = /^[0-9a-f]{32}$/;

type WorkerPublicKeyRecord = {
  keyVersion: string;
  publicKeySpkiBase64: string;
};

export type VerifiedWorkerAssertion = {
  workerId: string;
  keyVersion: string;
  nonceHash: string;
  requestHash: string;
  assertedAt: string;
  expiresAt: string;
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function parseWorkerKeys(value: string | undefined) {
  if (!value?.trim()) throw new Error("document_extraction_worker_keys_missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("document_extraction_worker_keys_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("document_extraction_worker_keys_invalid");
  }
  const keys = new Map<string, WorkerPublicKeyRecord>();
  for (const [workerId, candidate] of Object.entries(parsed)) {
    if (!WORKER_ID.test(workerId) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("document_extraction_worker_keys_invalid");
    }
    const record = candidate as Partial<WorkerPublicKeyRecord>;
    if (
      !KEY_VERSION.test(record.keyVersion || "")
      || typeof record.publicKeySpkiBase64 !== "string"
      || !record.publicKeySpkiBase64.trim()
    ) {
      throw new Error("document_extraction_worker_keys_invalid");
    }
    const keyBytes = Buffer.from(record.publicKeySpkiBase64, "base64");
    if (!keyBytes.byteLength || keyBytes.toString("base64") !== record.publicKeySpkiBase64) {
      throw new Error("document_extraction_worker_keys_invalid");
    }
    keys.set(workerId, {
      keyVersion: record.keyVersion as string,
      publicKeySpkiBase64: record.publicKeySpkiBase64
    });
  }
  if (!keys.size || keys.size > 8) throw new Error("document_extraction_worker_keys_invalid");
  return keys;
}

export function canonicalWorkerAssertionPayload({
  method,
  requestTarget,
  bodyDigest,
  workerId,
  keyVersion,
  timestamp,
  nonce
}: {
  method: string;
  requestTarget: string;
  bodyDigest: string;
  workerId: string;
  keyVersion: string;
  timestamp: string;
  nonce: string;
}) {
  return [
    DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION,
    method.toUpperCase(),
    requestTarget,
    bodyDigest,
    workerId,
    keyVersion,
    timestamp,
    nonce
  ].join("\n");
}

export function verifyWorkerAssertion({
  request,
  body,
  environment = process.env,
  now = Date.now()
}: {
  request: Request;
  body: Uint8Array;
  environment?: NodeJS.ProcessEnv;
  now?: number;
}): VerifiedWorkerAssertion {
  const protocol = request.headers.get("x-vaeroex-broker-protocol") || "";
  const workerId = request.headers.get("x-vaeroex-worker-id") || "";
  const keyVersion = request.headers.get("x-vaeroex-worker-key-version") || "";
  const timestamp = request.headers.get("x-vaeroex-worker-timestamp") || "";
  const nonce = request.headers.get("x-vaeroex-worker-nonce") || "";
  const signature = request.headers.get("x-vaeroex-worker-signature") || "";
  if (
    protocol !== DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION
    || !WORKER_ID.test(workerId)
    || !KEY_VERSION.test(keyVersion)
    || !/^\d{10}$/.test(timestamp)
    || !NONCE.test(nonce)
    || !signature
  ) {
    throw new Error("document_extraction_worker_assertion_invalid");
  }
  const timestampMs = Number(timestamp) * 1_000;
  if (
    !Number.isSafeInteger(timestampMs)
    || timestampMs < now - ASSERTION_TTL_SECONDS * 1_000
    || timestampMs > now + MAX_CLOCK_SKEW_SECONDS * 1_000
  ) {
    throw new Error("document_extraction_worker_assertion_expired");
  }
  const workerKey = parseWorkerKeys(environment.DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON).get(workerId);
  if (!workerKey || workerKey.keyVersion !== keyVersion) {
    throw new Error("document_extraction_worker_identity_unknown");
  }
  const url = new URL(request.url);
  const requestTarget = `${url.pathname}${url.search}`;
  const bodyDigest = sha256(body);
  const canonical = canonicalWorkerAssertionPayload({
    method: request.method,
    requestTarget,
    bodyDigest,
    workerId,
    keyVersion,
    timestamp,
    nonce
  });
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    throw new Error("document_extraction_worker_assertion_invalid");
  }
  if (!signatureBytes.byteLength || signatureBytes.toString("base64") !== signature) {
    throw new Error("document_extraction_worker_assertion_invalid");
  }
  const key = createPublicKey({
    key: Buffer.from(workerKey.publicKeySpkiBase64, "base64"),
    format: "der",
    type: "spki"
  });
  if (!verify(null, Buffer.from(canonical, "utf8"), key, signatureBytes)) {
    throw new Error("document_extraction_worker_assertion_invalid");
  }
  return {
    workerId,
    keyVersion,
    nonceHash: sha256(nonce),
    requestHash: sha256(canonical),
    assertedAt: new Date(timestampMs).toISOString(),
    expiresAt: new Date(timestampMs + ASSERTION_TTL_SECONDS * 1_000).toISOString()
  };
}
