import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { ASK_MAX_FOLLOW_UPS, ASK_MAX_SESSION_TOKEN_CHARS, compactAnswerForFollowUp } from "@/lib/search/ask-session";
import type { GlobalSearchAnswer } from "@/lib/search/types";
import type { GoogleSheetsReadTicket } from "@/lib/integrations/google-sheets/read-authority";

const TOKEN_VERSION = 2 as const;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const TOKEN_AAD = Buffer.from("vaeroex:executive-analysis-session:v2");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AskSessionContext = {
  initialSummary: string;
  recentSummaries: string[];
  previousQuestion: string;
  previousAnswerSummary: string;
};

type AskSessionTokenPayload = {
  version: typeof TOKEN_VERSION;
  sessionId: string;
  workspaceId: string;
  userId: string;
  originalQuestionHash: string;
  followUpCount: number;
  issuedAt: number;
  expiresAt: number;
  readTicket: Pick<GoogleSheetsReadTicket, "ticketId" | "epoch" | "expiresAt">;
  context: AskSessionContext;
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
  return createHash("sha256").update("vaeroex:executive-analysis-session:v2\0").update(serviceRoleKey).digest();
}

function questionHash(question: string) {
  return createHmac("sha256", signingKey())
    .update("vaeroex:executive-analysis-question:v1\0")
    .update(question.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function validPayload(value: unknown): value is AskSessionTokenPayload {
  if (!isRecord(value)) return false;
  const payload = value;
  const ticket = payload.readTicket;
  const context = payload.context;
  return (
    payload.version === TOKEN_VERSION &&
    typeof payload.sessionId === "string" && UUID_PATTERN.test(payload.sessionId) &&
    typeof payload.workspaceId === "string" && UUID_PATTERN.test(payload.workspaceId) &&
    typeof payload.userId === "string" && UUID_PATTERN.test(payload.userId) &&
    typeof payload.originalQuestionHash === "string" && /^[0-9a-f]{64}$/.test(payload.originalQuestionHash) &&
    Number.isInteger(payload.followUpCount) &&
    Number(payload.followUpCount) >= 0 &&
    Number(payload.followUpCount) <= ASK_MAX_FOLLOW_UPS &&
    Number.isFinite(payload.issuedAt) && Number.isFinite(payload.expiresAt) &&
    isRecord(ticket) && typeof ticket.ticketId === "string" && UUID_PATTERN.test(ticket.ticketId) &&
    Number.isSafeInteger(ticket.epoch) && Number(ticket.epoch) >= 0 &&
    typeof ticket.expiresAt === "string" && Number.isFinite(Date.parse(ticket.expiresAt)) &&
    Number(payload.expiresAt) <= Date.parse(ticket.expiresAt) &&
    isRecord(context) && boundedText(context.initialSummary, 900) &&
    Array.isArray(context.recentSummaries) &&
    context.recentSummaries.length === Math.min(Number(payload.followUpCount), 2) &&
    context.recentSummaries.every((text) => boundedText(text, 600)) &&
    boundedText(context.previousQuestion, 600) && boundedText(context.previousAnswerSummary, 1_800)
  );
}

/** Only server-produced answers enter the continuation context. Browser-provided
 * summaries are never used to construct or extend this authenticated state. */
export function nextAskSessionContext(answer: GlobalSearchAnswer, question: string, previous?: AskSessionContext): AskSessionContext {
  return {
    initialSummary: previous?.initialSummary ?? compactAnswerForFollowUp(answer, 900),
    recentSummaries: previous ? [...previous.recentSummaries, compactAnswerForFollowUp(answer, 600)].slice(-2) : [],
    previousQuestion: question,
    previousAnswerSummary: compactAnswerForFollowUp(answer)
  };
}

export function askSessionContinuationContext(context: AskSessionContext) {
  return {
    sessionSummary: [`Initial analysis: ${context.initialSummary}`, ...context.recentSummaries.map((summary) => `Later analysis: ${summary}`)].join(" ").slice(0, 2_200),
    previousQuestion: context.previousQuestion,
    previousAnswerSummary: context.previousAnswerSummary
  };
}

export function issueAskSessionToken({
  sessionId,
  workspaceId,
  userId,
  originalQuestion,
  followUpCount,
  readTicket,
  context,
  nowMs = Date.now()
}: {
  sessionId: string;
  workspaceId: string;
  userId: string;
  originalQuestion: string;
  followUpCount: number;
  readTicket: GoogleSheetsReadTicket;
  context: AskSessionContext;
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
    expiresAt: Math.min(nowMs + TOKEN_TTL_MS, Date.parse(readTicket.expiresAt)),
    readTicket: { ticketId: readTicket.ticketId, epoch: readTicket.epoch, expiresAt: readTicket.expiresAt },
    context
  };
  if (!validPayload(payload) || payload.expiresAt <= nowMs) throw new Error("Executive Analysis session authority is unavailable.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", signingKey(), nonce);
  cipher.setAAD(TOKEN_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const token = `v2.${nonce.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  if (token.length > ASK_MAX_SESSION_TOKEN_CHARS) throw new Error("Executive Analysis session context is too large.");
  return token;
}

export function verifyAskSessionToken(token: string, expected: ExpectedAskSessionToken, nowMs = Date.now()) {
  if (token.length > ASK_MAX_SESSION_TOKEN_CHARS) return { ok: false as const, reason: "invalid" as const };
  const [version, encodedNonce, encodedPayload, encodedTag, extra] = token.split(".");
  if (version !== "v2" || !encodedNonce || !encodedPayload || !encodedTag || extra) return { ok: false as const, reason: "invalid" as const };

  let payload: unknown;
  try {
    const nonce = Buffer.from(encodedNonce, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) return { ok: false as const, reason: "invalid" as const };
    const decipher = createDecipheriv("aes-256-gcm", signingKey(), nonce);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedPayload, "base64url")), decipher.final()]).toString("utf8"));
  } catch {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (!validPayload(payload)) return { ok: false as const, reason: "invalid" as const };
  if (payload.expiresAt <= nowMs) return { ok: false as const, reason: "expired" as const };
  if (payload.issuedAt > nowMs + 60_000 || payload.expiresAt <= payload.issuedAt) return { ok: false as const, reason: "invalid" as const };

  const matches =
    payload.sessionId === expected.sessionId &&
    payload.workspaceId === expected.workspaceId &&
    payload.userId === expected.userId &&
    payload.originalQuestionHash === questionHash(expected.originalQuestion) &&
    payload.followUpCount === expected.previousFollowUpCount;

  return matches ? { ok: true as const, payload } : { ok: false as const, reason: "invalid" as const };
}
