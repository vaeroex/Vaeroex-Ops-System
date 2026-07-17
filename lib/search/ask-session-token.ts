import "server-only";

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ASK_MAX_FOLLOW_UPS } from "@/lib/search/ask-session";

const TOKEN_VERSION = 1 as const;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

type AskSessionTokenPayload = {
  version: typeof TOKEN_VERSION;
  sessionId: string;
  workspaceId: string;
  userId: string;
  originalQuestionHash: string;
  followUpCount: number;
  issuedAt: number;
  expiresAt: number;
};

type ExpectedAskSessionToken = {
  sessionId: string;
  workspaceId: string;
  userId: string;
  originalQuestion: string;
  previousFollowUpCount: number;
};

function signingKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("Executive Analysis session authority is unavailable.");
  return createHash("sha256").update("vaeroex:executive-analysis-session:v1\0").update(serviceRoleKey).digest();
}

function questionHash(question: string) {
  return createHmac("sha256", signingKey())
    .update("vaeroex:executive-analysis-question:v1\0")
    .update(question.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function signature(encodedPayload: string) {
  return createHmac("sha256", signingKey()).update(encodedPayload).digest("base64url");
}

function validPayload(value: unknown): value is AskSessionTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === TOKEN_VERSION &&
    typeof payload.sessionId === "string" &&
    typeof payload.workspaceId === "string" &&
    typeof payload.userId === "string" &&
    typeof payload.originalQuestionHash === "string" &&
    Number.isInteger(payload.followUpCount) &&
    Number(payload.followUpCount) >= 0 &&
    Number(payload.followUpCount) <= ASK_MAX_FOLLOW_UPS &&
    Number.isFinite(payload.issuedAt) &&
    Number.isFinite(payload.expiresAt)
  );
}

export function issueAskSessionToken({
  sessionId,
  workspaceId,
  userId,
  originalQuestion,
  followUpCount,
  nowMs = Date.now()
}: {
  sessionId: string;
  workspaceId: string;
  userId: string;
  originalQuestion: string;
  followUpCount: number;
  nowMs?: number;
}) {
  const payload: AskSessionTokenPayload = {
    version: TOKEN_VERSION,
    sessionId,
    workspaceId,
    userId,
    originalQuestionHash: questionHash(originalQuestion),
    followUpCount,
    issuedAt: nowMs,
    expiresAt: nowMs + TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyAskSessionToken(token: string, expected: ExpectedAskSessionToken, nowMs = Date.now()) {
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return { ok: false as const, reason: "invalid" as const };

  const expectedSignature = signature(encodedPayload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return { ok: false as const, reason: "invalid" as const };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (!validPayload(payload)) return { ok: false as const, reason: "invalid" as const };
  if (payload.expiresAt < nowMs) return { ok: false as const, reason: "expired" as const };
  if (payload.issuedAt > nowMs + 60_000 || payload.expiresAt <= payload.issuedAt) return { ok: false as const, reason: "invalid" as const };

  const matches =
    payload.sessionId === expected.sessionId &&
    payload.workspaceId === expected.workspaceId &&
    payload.userId === expected.userId &&
    payload.originalQuestionHash === questionHash(expected.originalQuestion) &&
    payload.followUpCount === expected.previousFollowUpCount;

  return matches ? { ok: true as const, payload } : { ok: false as const, reason: "invalid" as const };
}
