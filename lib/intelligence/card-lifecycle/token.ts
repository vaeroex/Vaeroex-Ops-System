import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  INTELLIGENCE_CARD_LIFECYCLE_VERSION,
  type IntelligenceCardSnapshotV1
} from "@/lib/intelligence/card-lifecycle/contracts";

const TOKEN_VERSION = "intelligence_card_lifecycle_token_v1" as const;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 16_000;

type IntelligenceCardLifecycleTokenPayload = Readonly<{
  version: typeof TOKEN_VERSION;
  workspaceId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  findingKeyHash: string;
  findingFingerprint: string;
  materialSignature: string;
  findingId: string;
  cardSnapshot: IntelligenceCardSnapshotV1;
}>;

function encryptionKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("Intelligence lifecycle authority is unavailable.");
  return createHash("sha256")
    .update("vaeroex:intelligence-card-lifecycle-token:v1\0")
    .update(serviceRoleKey)
    .digest();
}

function isHash(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isCardSnapshot(value: unknown): value is IntelligenceCardSnapshotV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<IntelligenceCardSnapshotV1>;
  return candidate.version === INTELLIGENCE_CARD_LIFECYCLE_VERSION
    && typeof candidate.findingId === "string"
    && typeof candidate.type === "string"
    && typeof candidate.title === "string"
    && typeof candidate.summary === "string"
    && typeof candidate.priority === "string"
    && typeof candidate.confidence === "string"
    && typeof candidate.affectedArea === "string"
    && typeof candidate.lastUpdated === "string";
}

export function sealIntelligenceCardLifecycleToken({
  workspaceId,
  userId,
  findingKeyHash,
  findingFingerprint,
  materialSignature,
  findingId,
  cardSnapshot,
  nowMs = Date.now()
}: Omit<IntelligenceCardLifecycleTokenPayload, "version" | "issuedAt" | "expiresAt"> & { nowMs?: number }) {
  if (!isHash(findingKeyHash) || !isHash(materialSignature) || !findingFingerprint || !findingId || !isCardSnapshot(cardSnapshot)) {
    throw new Error("Intelligence lifecycle identity is invalid.");
  }
  const payload: IntelligenceCardLifecycleTokenPayload = {
    version: TOKEN_VERSION,
    workspaceId,
    userId,
    issuedAt: nowMs,
    expiresAt: nowMs + TOKEN_TTL_MS,
    findingKeyHash,
    findingFingerprint,
    materialSignature,
    findingId,
    cardSnapshot
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function openIntelligenceCardLifecycleToken(
  token: string,
  expected: { workspaceId: string; userId: string },
  nowMs = Date.now()
) {
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false as const, reason: "invalid" as const };
  const [version, ivValue, tagValue, ciphertextValue, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !ivValue || !tagValue || !ciphertextValue || extra) {
    return { ok: false as const, reason: "invalid" as const };
  }
  let payload: unknown;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    payload = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final()
    ]).toString("utf8"));
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false as const, reason: "invalid" as const };
  const candidate = payload as Partial<IntelligenceCardLifecycleTokenPayload>;
  if (
    candidate.version !== TOKEN_VERSION
    || candidate.workspaceId !== expected.workspaceId
    || candidate.userId !== expected.userId
    || !Number.isFinite(candidate.issuedAt)
    || !Number.isFinite(candidate.expiresAt)
    || Number(candidate.issuedAt) > nowMs + 60_000
    || Number(candidate.expiresAt) <= Number(candidate.issuedAt)
    || !isHash(candidate.findingKeyHash)
    || !isHash(candidate.materialSignature)
    || typeof candidate.findingFingerprint !== "string"
    || !candidate.findingFingerprint
    || typeof candidate.findingId !== "string"
    || !candidate.findingId
    || !isCardSnapshot(candidate.cardSnapshot)
  ) return { ok: false as const, reason: "invalid" as const };
  if (Number(candidate.expiresAt) < nowMs) return { ok: false as const, reason: "expired" as const };
  return { ok: true as const, payload: candidate as IntelligenceCardLifecycleTokenPayload };
}

export function trySealIntelligenceCardLifecycleToken(input: Parameters<typeof sealIntelligenceCardLifecycleToken>[0]) {
  try {
    return sealIntelligenceCardLifecycleToken(input);
  } catch {
    return null;
  }
}
