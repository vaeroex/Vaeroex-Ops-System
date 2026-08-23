import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { TextDecoder } from "node:util";

import {
  parseQboCloudEventsWebhook
} from "@/lib/integrations/providers/qbo/webhooks";
import type {
  QboProviderMetadata
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_WEBHOOK_SIGNATURE_HEADER = "intuit-signature" as const;
export const QBO_WEBHOOK_MAX_RAW_BODY_BYTES = 2 * 1024 * 1024;

function rawBodyBytes(value: Uint8Array) {
  if (!(value instanceof Uint8Array)) {
    throw new Error("qbo_webhook_raw_body_invalid");
  }
  if (value.byteLength === 0 || value.byteLength > QBO_WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new Error("qbo_webhook_raw_body_size_invalid");
  }
  return Buffer.from(value);
}

function verifierSecretBytes(value: Uint8Array) {
  if (!(value instanceof Uint8Array) || value.byteLength < 16 || value.byteLength > 16_384) {
    throw new Error("qbo_webhook_verifier_secret_invalid");
  }
  return Buffer.from(value);
}

function signatureBytes(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("qbo_webhook_signature_denied");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    decoded.fill(0);
    throw new Error("qbo_webhook_signature_denied");
  }
  return decoded;
}

export function qboWebhookDeliveryHash(rawBody: Uint8Array) {
  const body = rawBodyBytes(rawBody);
  try {
    return `sha256:${createHash("sha256").update(body).digest("hex")}` as const;
  } finally {
    body.fill(0);
  }
}

export function verifyQboWebhookSignature(input: {
  rawBody: Uint8Array;
  intuitSignature: string;
  verifierSecret: Uint8Array;
}) {
  const body = rawBodyBytes(input.rawBody);
  const secret = verifierSecretBytes(input.verifierSecret);
  let provided: Buffer | null = null;
  let expected: Buffer | null = null;
  try {
    provided = signatureBytes(input.intuitSignature);
    expected = createHmac("sha256", secret).update(body).digest();
    if (!timingSafeEqual(provided, expected)) {
      throw new Error("qbo_webhook_signature_denied");
    }
  } finally {
    body.fill(0);
    secret.fill(0);
    provided?.fill(0);
    expected?.fill(0);
  }
}

export function verifyAndParseQboCloudEventsWebhook(input: {
  rawBody: Uint8Array;
  intuitSignature: string;
  verifierSecret: Uint8Array;
  expectedProvider?: QboProviderMetadata;
}) {
  verifyQboWebhookSignature(input);
  const body = rawBodyBytes(input.rawBody);
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw new Error("qbo_webhook_raw_body_invalid");
    }
    const events = parseQboCloudEventsWebhook({
      raw: parsed,
      expectedProvider: input.expectedProvider
    }).map((event) => ({
      ...event,
      signatureVerification: "verified_hmac_sha256" as const
    }));
    return {
      deliveryHash: qboWebhookDeliveryHash(body),
      events
    } as const;
  } finally {
    body.fill(0);
  }
}
