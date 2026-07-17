import type { GlobalSearchAnswer } from "@/lib/search/types";

export const ASK_SESSION_VERSION = 1 as const;
export const ASK_MAX_FOLLOW_UPS = 5;
export const ASK_SESSION_INACTIVITY_MS = 60 * 60 * 1000;
export const ASK_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const ASK_MAX_STORED_SESSION_CHARS = 500_000;

const MAX_QUESTION_CHARS = 600;
const MAX_SESSION_SUMMARY_CHARS = 2_200;
const MAX_PREVIOUS_ANSWER_SUMMARY_CHARS = 1_800;
const MAX_SESSION_TOKEN_CHARS = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;

export type AskAnalysisRequest = {
  query: string;
  sessionId: string;
  followUpNumber: number;
  isFollowUp: boolean;
  sessionToken: string | null;
  originalQuestion: string;
  sessionSummary: string | null;
  previousQuestion: string | null;
  previousAnswerSummary: string | null;
};

export type AskAnalysisExchange = {
  id: string;
  question: string;
  answer: GlobalSearchAnswer;
  createdAt: string;
};

export type PersistentAskSession = {
  version: typeof ASK_SESSION_VERSION;
  sessionId: string;
  sessionToken: string;
  originalQuestion: string;
  originalAnswer: GlobalSearchAnswer;
  followUps: AskAnalysisExchange[];
  followUpCount: number;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
};

export type ParsedStoredAskSession = {
  session: PersistentAskSession | null;
  expired: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.slice(0, maxLength);
}

function validIsoTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isStoredAnswer(value: unknown): value is GlobalSearchAnswer {
  if (!isRecord(value)) return false;
  if (!["business_answer", "navigation_answer", "security_response"].includes(String(value.kind || ""))) return false;
  return typeof value.directAnswer === "string" && value.directAnswer.trim().length > 0;
}

function isStoredExchange(value: unknown): value is AskAnalysisExchange {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    compactText(value.question, MAX_QUESTION_CHARS).length >= 2 &&
    isStoredAnswer(value.answer) &&
    validIsoTimestamp(value.createdAt)
  );
}

export function askSessionStorageKey(workspaceId: string, userId: string) {
  return `vaeroex:executive-analysis:v${ASK_SESSION_VERSION}:${workspaceId}:${userId}`;
}

export function parseAskAnalysisRequest(value: unknown, fallbackSessionId: string):
  | { ok: true; value: AskAnalysisRequest }
  | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Enter a question for Vaeroex." };
  }

  const query = compactText(value.query, MAX_QUESTION_CHARS);
  if (query.length < 2) {
    return { ok: false, error: "Enter a question for Vaeroex." };
  }

  const providedSessionId = compactText(value.sessionId, 80);
  const sessionId = providedSessionId || fallbackSessionId;
  if (!UUID_PATTERN.test(sessionId)) {
    return { ok: false, error: "Start a new Executive Analysis and try again." };
  }

  const rawFollowUpNumber = value.followUpNumber === undefined ? 0 : value.followUpNumber;
  if (!Number.isInteger(rawFollowUpNumber) || Number(rawFollowUpNumber) < 0 || Number(rawFollowUpNumber) > ASK_MAX_FOLLOW_UPS) {
    return { ok: false, error: "This Executive Analysis has reached its follow-up limit. Start a new analysis to continue." };
  }

  const followUpNumber = Number(rawFollowUpNumber);
  const isFollowUp = followUpNumber > 0;
  const sessionToken = compactText(value.sessionToken, MAX_SESSION_TOKEN_CHARS);
  const originalQuestion = compactText(value.originalQuestion, MAX_QUESTION_CHARS);
  const sessionSummary = compactText(value.sessionSummary, MAX_SESSION_SUMMARY_CHARS);
  const previousQuestion = compactText(value.previousQuestion, MAX_QUESTION_CHARS);
  const previousAnswerSummary = compactText(value.previousAnswerSummary, MAX_PREVIOUS_ANSWER_SUMMARY_CHARS);

  if (isFollowUp && (!sessionToken || originalQuestion.length < 2 || !sessionSummary || previousQuestion.length < 2 || !previousAnswerSummary)) {
    return { ok: false, error: "This Executive Analysis cannot be continued safely. Start a new analysis and try again." };
  }

  return {
    ok: true,
    value: {
      query,
      sessionId,
      followUpNumber,
      isFollowUp,
      sessionToken: isFollowUp ? sessionToken : null,
      originalQuestion: isFollowUp ? originalQuestion : query,
      sessionSummary: isFollowUp ? sessionSummary : null,
      previousQuestion: isFollowUp ? previousQuestion : null,
      previousAnswerSummary: isFollowUp ? previousAnswerSummary : null
    }
  };
}

export function isAskSessionExpired(lastActiveAt: string, nowMs = Date.now()) {
  const lastActiveMs = Date.parse(lastActiveAt);
  return !Number.isFinite(lastActiveMs) || nowMs - lastActiveMs > ASK_SESSION_INACTIVITY_MS;
}

export function parseStoredAskSession(value: unknown, nowMs = Date.now()): ParsedStoredAskSession {
  if (!isRecord(value) || value.version !== ASK_SESSION_VERSION) return { session: null, expired: false };
  if (!UUID_PATTERN.test(String(value.sessionId || ""))) return { session: null, expired: false };
  if (typeof value.sessionToken !== "string" || !value.sessionToken || value.sessionToken.length > MAX_SESSION_TOKEN_CHARS) {
    return { session: null, expired: false };
  }
  if (compactText(value.originalQuestion, MAX_QUESTION_CHARS).length < 2 || !isStoredAnswer(value.originalAnswer)) {
    return { session: null, expired: false };
  }
  if (!Array.isArray(value.followUps) || value.followUps.length > ASK_MAX_FOLLOW_UPS || !value.followUps.every(isStoredExchange)) {
    return { session: null, expired: false };
  }
  if (!validIsoTimestamp(value.createdAt) || !validIsoTimestamp(value.updatedAt) || !validIsoTimestamp(value.lastActiveAt)) {
    return { session: null, expired: false };
  }

  if (isAskSessionExpired(String(value.lastActiveAt), nowMs)) {
    return { session: null, expired: true };
  }

  const followUps = value.followUps as AskAnalysisExchange[];
  return {
    expired: false,
    session: {
      version: ASK_SESSION_VERSION,
      sessionId: String(value.sessionId),
      sessionToken: value.sessionToken,
      originalQuestion: compactText(value.originalQuestion, MAX_QUESTION_CHARS),
      originalAnswer: value.originalAnswer as GlobalSearchAnswer,
      followUps,
      followUpCount: followUps.length,
      createdAt: String(value.createdAt),
      updatedAt: String(value.updatedAt),
      lastActiveAt: String(value.lastActiveAt)
    }
  };
}

export function compactAnswerForFollowUp(answer: GlobalSearchAnswer, maxLength = MAX_PREVIOUS_ANSWER_SUMMARY_CHARS) {
  if (answer.kind === "security_response") {
    return "The previous request was blocked and no business data was changed.";
  }

  const briefing = answer.executiveBriefing;
  const parts = briefing
    ? [
        briefing.executiveSummary,
        ...briefing.keyFindings.slice(0, 2).map((item) => item.finding),
        ...briefing.recommendedActions.slice(0, 2).map((item) => item.action),
        `Evidence sufficiency: ${briefing.evidenceSufficiency.state}.`,
        `Recommendation confidence: ${briefing.confidenceAssessment.level}.`
      ]
    : [answer.directAnswer, answer.evidenceNote || "", answer.recommendationConfidence ? `Recommendation confidence: ${answer.recommendationConfidence}.` : ""];

  return compactText(parts.filter(Boolean).join(" "), maxLength);
}

export function buildCompactSessionSummary(session: PersistentAskSession) {
  const initial = compactAnswerForFollowUp(session.originalAnswer, 900);
  const recent = session.followUps.slice(-2).map((exchange) => compactAnswerForFollowUp(exchange.answer, 600));
  return compactText([`Initial analysis: ${initial}`, ...recent.map((summary) => `Later analysis: ${summary}`)].join(" "), MAX_SESSION_SUMMARY_CHARS);
}
