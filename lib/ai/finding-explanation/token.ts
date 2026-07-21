import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import {
  FINDING_EXPLANATION_CONTRACT_ID,
  FINDING_EXPLANATION_CONTRACT_VERSION,
  FINDING_EXPLANATION_VALIDATOR_VERSION,
  type FindingExplanationPackage
} from "@/lib/ai/finding-explanation/contracts";

const TOKEN_VERSION = "finding_explanation_token_v1" as const;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_LENGTH = 96_000;

type TokenPayload = {
  version: typeof TOKEN_VERSION;
  workspaceId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  analysisPackage: FindingExplanationPackage;
};

function encryptionKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("Finding explanation authority is unavailable.");
  return createHash("sha256")
    .update("vaeroex:finding-explanation-token:v1\0")
    .update(serviceRoleKey)
    .digest();
}

function validPackage(value: unknown): value is FindingExplanationPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.contractId === FINDING_EXPLANATION_CONTRACT_ID
    && candidate.contractVersion === FINDING_EXPLANATION_CONTRACT_VERSION
    && candidate.validatorVersion === FINDING_EXPLANATION_VALIDATOR_VERSION
    && typeof candidate.fingerprint === "string"
    && candidate.fingerprint.length === 64
    && Boolean(candidate.facts && typeof candidate.facts === "object")
    && Boolean(candidate.manifest && typeof candidate.manifest === "object")
    && Array.isArray(candidate.requiredCitationIds)
    && Array.isArray(candidate.citations);
}

export function sealFindingExplanationPackage({
  analysisPackage,
  workspaceId,
  userId,
  nowMs = Date.now()
}: {
  analysisPackage: FindingExplanationPackage;
  workspaceId: string;
  userId: string;
  nowMs?: number;
}) {
  if (analysisPackage.manifest.workspaceId !== workspaceId) throw new Error("Finding evidence must belong to the authorized workspace.");
  const payload: TokenPayload = {
    version: TOKEN_VERSION,
    workspaceId,
    userId,
    issuedAt: nowMs,
    expiresAt: nowMs + TOKEN_TTL_MS,
    analysisPackage
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [TOKEN_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function openFindingExplanationPackage(token: string, expected: { workspaceId: string; userId: string }, nowMs = Date.now()) {
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
  const candidate = payload as Partial<TokenPayload>;
  if (
    candidate.version !== TOKEN_VERSION
    || candidate.workspaceId !== expected.workspaceId
    || candidate.userId !== expected.userId
    || !Number.isFinite(candidate.issuedAt)
    || !Number.isFinite(candidate.expiresAt)
    || Number(candidate.issuedAt) > nowMs + 60_000
    || Number(candidate.expiresAt) <= Number(candidate.issuedAt)
    || !validPackage(candidate.analysisPackage)
  ) return { ok: false as const, reason: "invalid" as const };
  if (Number(candidate.expiresAt) < nowMs) return { ok: false as const, reason: "expired" as const };
  if (candidate.analysisPackage.manifest.workspaceId !== expected.workspaceId) return { ok: false as const, reason: "invalid" as const };
  return { ok: true as const, analysisPackage: candidate.analysisPackage };
}

export function trySealFindingExplanationPackage(input: Parameters<typeof sealFindingExplanationPackage>[0]) {
  try {
    return sealFindingExplanationPackage(input);
  } catch {
    return null;
  }
}
