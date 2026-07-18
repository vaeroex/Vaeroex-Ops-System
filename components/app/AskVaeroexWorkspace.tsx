"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Clock3, Loader2, Plus, Send } from "lucide-react";
import { useActivitySignal } from "@/components/app/ActivityProvider";
import { AskVaeroexResponse } from "@/components/app/AskVaeroexResponse";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import {
  ASK_MAX_FOLLOW_UPS,
  ASK_MAX_STORED_SESSION_CHARS,
  ASK_SESSION_TOUCH_INTERVAL_MS,
  ASK_SESSION_VERSION,
  askSessionStorageKey,
  buildCompactSessionSummary,
  compactAnswerForFollowUp,
  isAskSessionExpired,
  parseStoredAskSession,
  type AskAnalysisExchange,
  type PersistentAskSession
} from "@/lib/search/ask-session";
import { globalSearchApiErrorMessage } from "@/lib/search/api-errors";
import type { GlobalSearchAnswer, GlobalSearchResponse } from "@/lib/search/types";
import {
  EXECUTIVE_PROVIDER_POLICY_HEADER,
  EXECUTIVE_PROVIDER_POLICY_QUERY,
  isExecutiveProviderPolicyVariant
} from "@/lib/ai/providers/workflow-provider-policy-contract";

type AskVaeroexWorkspaceProps = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  initialPrompt?: string;
};

type LoadingMode = "initial" | "follow_up" | null;

const ASK_REQUEST_TIMEOUT_MS = 32_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAnswer(value: unknown): value is GlobalSearchAnswer {
  return isRecord(value) && typeof value.directAnswer === "string" && ["business_answer", "navigation_answer", "security_response"].includes(String(value.kind || ""));
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : "Recently";
}

function newSessionId() {
  return crypto.randomUUID();
}

function previewExecutiveProviderPolicyHeader(): Record<string, string> {
  const requested = new URLSearchParams(window.location.search).get(EXECUTIVE_PROVIDER_POLICY_QUERY);
  return isExecutiveProviderPolicyVariant(requested)
    ? { [EXECUTIVE_PROVIDER_POLICY_HEADER]: requested }
    : {};
}

function questionShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

function AnalysisExchange({ label, question, answer, createdAt }: { label: string; question: string; answer: GlobalSearchAnswer; createdAt: string }) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#0a1625] shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
      <header className="border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{label}</p>
            <h2 className="mt-2 break-words text-lg font-semibold leading-7 text-white">{question}</h2>
          </div>
          <time className="shrink-0 text-xs font-medium text-slate-500" dateTime={createdAt}>{formatTime(createdAt)}</time>
        </div>
      </header>
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <AskVaeroexResponse answer={answer} />
      </div>
    </article>
  );
}

export function AskVaeroexWorkspace({ workspaceId, workspaceName, userId, initialPrompt = "" }: AskVaeroexWorkspaceProps) {
  const storageKey = askSessionStorageKey(workspaceId, userId);
  const [session, setSession] = useState<PersistentAskSession | null>(null);
  const [initialQuestion, setInitialQuestion] = useState(initialPrompt.slice(0, 600));
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [securityBlocked, setSecurityBlocked] = useState(false);
  const initialInputRef = useRef<HTMLTextAreaElement | null>(null);
  const followUpInputRef = useRef<HTMLTextAreaElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestInFlightRef = useRef(false);
  const sessionRef = useRef<PersistentAskSession | null>(null);
  const loading = loadingMode !== null;
  const followUpsRemaining = Math.max(0, ASK_MAX_FOLLOW_UPS - (session?.followUpCount || 0));
  const followUpLimitReached = Boolean(session && followUpsRemaining === 0);
  useActivitySignal(loading, loadingMode === "follow_up" ? "Continuing analysis..." : "Analyzing...", {
    source: "ask-vaeroex",
    timeoutMs: ASK_REQUEST_TIMEOUT_MS
  });

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    requestInFlightRef.current = false;
    setLoadingMode(null);
    setError(null);
    setExpiredNotice(false);
    setSecurityBlocked(false);
    setRestored(false);
    setSession(null);

    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored && stored.length > ASK_MAX_STORED_SESSION_CHARS) {
        window.sessionStorage.removeItem(storageKey);
      } else if (stored) {
        const parsed = parseStoredAskSession(JSON.parse(stored));
        if (parsed.expired) {
          window.sessionStorage.removeItem(storageKey);
          setExpiredNotice(true);
        }
        setSession(parsed.session);
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    } finally {
      setRestored(true);
    }

    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      requestInFlightRef.current = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;

    if (!session) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    try {
      const serialized = JSON.stringify(session);
      if (serialized.length > ASK_MAX_STORED_SESSION_CHARS) {
        setError("This analysis is too large for browser-session persistence. Start a new analysis before continuing.");
        return;
      }
      window.sessionStorage.setItem(storageKey, serialized);
    } catch {
      setError("This browser could not preserve the current analysis. Keep this page open while reviewing it.");
    }
  }, [restored, session, storageKey]);

  useEffect(() => {
    if (!session) return;

    function touchSession() {
      if (document.visibilityState !== "visible") return;
      const current = sessionRef.current;
      if (!current) return;
      if (isAskSessionExpired(current.lastActiveAt)) {
        window.sessionStorage.removeItem(storageKey);
        sessionRef.current = null;
        setSession(null);
        setExpiredNotice(true);
        return;
      }
      const now = new Date().toISOString();
      const updated = { ...current, lastActiveAt: now };
      sessionRef.current = updated;
      setSession(updated);
    }

    const interval = window.setInterval(touchSession, ASK_SESSION_TOUCH_INTERVAL_MS);
    window.addEventListener("focus", touchSession);
    document.addEventListener("visibilitychange", touchSession);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", touchSession);
      document.removeEventListener("visibilitychange", touchSession);
    };
  }, [session?.sessionId, storageKey]);

  function startNewAnalysis() {
    if (loading) return;
    window.sessionStorage.removeItem(storageKey);
    setSession(null);
    setInitialQuestion("");
    setFollowUpQuestion("");
    setError(null);
    setExpiredNotice(false);
    setSecurityBlocked(false);
    window.setTimeout(() => initialInputRef.current?.focus(), 0);
  }

  async function requestAnalysis({ query, activeSession }: { query: string; activeSession: PersistentAskSession | null }) {
    const cleanQuery = query.replace(/\s+/g, " ").trim().slice(0, 600);
    if (cleanQuery.length < 2 || requestInFlightRef.current) return;

    const isFollowUp = Boolean(activeSession);
    const followUpNumber = isFollowUp ? activeSession!.followUpCount + 1 : 0;
    if (followUpNumber > ASK_MAX_FOLLOW_UPS) {
      setError("This Executive Analysis has reached its follow-up limit. Start a new analysis to continue.");
      return;
    }

    const sessionId = activeSession?.sessionId || newSessionId();
    const previousExchange = activeSession?.followUps.at(-1);
    const previousQuestion = previousExchange?.question || activeSession?.originalQuestion || "";
    const previousAnswer = previousExchange?.answer || activeSession?.originalAnswer;
    const body = isFollowUp
      ? {
          query: cleanQuery,
          sessionId,
          sessionToken: activeSession!.sessionToken,
          originalQuestion: activeSession!.originalQuestion,
          sessionSummary: buildCompactSessionSummary(activeSession!),
          previousQuestion,
          previousAnswerSummary: previousAnswer ? compactAnswerForFollowUp(previousAnswer) : "",
          followUpNumber
        }
      : { query: cleanQuery, sessionId, followUpNumber: 0 };

    const controller = new AbortController();
    let requestTimedOut = false;
    const requestTimeout = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, ASK_REQUEST_TIMEOUT_MS);
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    requestInFlightRef.current = true;
    setLoadingMode(isFollowUp ? "follow_up" : "initial");
    setError(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...previewExecutiveProviderPolicyHeader()
        },
        body: JSON.stringify(body)
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(globalSearchApiErrorMessage(response.status, payload));
      if (!isRecord(payload) || !isAnswer(payload.answer) || !isRecord(payload.analysisSession)) {
        throw new Error("Vaeroex returned an incomplete analysis. Please try again.");
      }

      const result = payload as GlobalSearchResponse;
      const authority = result.analysisSession;
      if (
        !authority ||
        authority.sessionId !== sessionId ||
        authority.followUpNumber !== followUpNumber ||
        typeof authority.sessionToken !== "string" ||
        !authority.sessionToken
      ) {
        throw new Error("Vaeroex could not verify this analysis session. Start a new analysis and try again.");
      }

      if (result.answer!.kind === "security_response") {
        window.sessionStorage.removeItem(storageKey);
        setSession(null);
        setInitialQuestion("");
        setFollowUpQuestion("");
        setSecurityBlocked(true);
        return;
      }

      const now = new Date().toISOString();
      if (!activeSession) {
        setSession({
          version: ASK_SESSION_VERSION,
          sessionId,
          sessionToken: authority.sessionToken,
          originalQuestion: cleanQuery,
          originalAnswer: result.answer!,
          followUps: [],
          followUpCount: 0,
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now
        });
        setInitialQuestion("");
      } else {
        const exchange: AskAnalysisExchange = {
          id: crypto.randomUUID(),
          question: cleanQuery,
          answer: result.answer!,
          createdAt: now
        };
        setSession((current) => {
          if (!current || current.sessionId !== sessionId) return current;
          const followUps = [...current.followUps, exchange].slice(0, ASK_MAX_FOLLOW_UPS);
          return {
            ...current,
            sessionToken: authority.sessionToken,
            followUps,
            followUpCount: followUps.length,
            updatedAt: now,
            lastActiveAt: now
          };
        });
        setFollowUpQuestion("");
      }
    } catch (requestError) {
      if (controller.signal.aborted) {
        if (requestTimedOut) setError("The analysis took too long. Please try again.");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "Vaeroex could not complete this analysis. Please try again.");
    } finally {
      window.clearTimeout(requestTimeout);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        requestInFlightRef.current = false;
        setLoadingMode(null);
      }
    }
  }

  function submitInitial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestAnalysis({ query: initialQuestion, activeSession: null });
  }

  function submitFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || followUpLimitReached) return;
    void requestAnalysis({ query: followUpQuestion, activeSession: session });
  }

  if (restored && securityBlocked) {
    return (
      <section className="min-h-[calc(100dvh-9rem)] bg-[#07111f] px-4 py-6 text-slate-100 sm:px-6 sm:py-8 lg:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <SecurityResponseNotice />
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100dvh-9rem)] bg-[#07111f] px-4 py-6 text-slate-100 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Ask Vaeroex</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Executive Analysis</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">Ask a focused leadership question about {workspaceName}. Vaeroex will use current eligible evidence and state what remains uncertain.</p>
          </div>
          {session ? (
            <button
              type="button"
              onClick={startNewAnalysis}
              disabled={loading}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.055] px-4 py-2 text-sm font-semibold text-white transition hover:border-vaeroex-accent/45 hover:bg-cyan-950/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 disabled:pointer-events-none disabled:opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Analysis
            </button>
          ) : null}
        </header>

        {!restored ? (
          <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-slate-400" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" />
            Restoring analysis...
          </div>
        ) : session ? (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />Last updated {formatTime(session.updatedAt)}</span>
              <span className="font-semibold text-slate-200">Follow-ups remaining: {followUpsRemaining}</span>
            </div>

            <AnalysisExchange label="Initial Question" question={session.originalQuestion} answer={session.originalAnswer} createdAt={session.createdAt} />
            {session.followUps.map((exchange, index) => (
              <AnalysisExchange
                key={exchange.id}
                label={`Follow-up ${index + 1}`}
                question={exchange.question}
                answer={exchange.answer}
                createdAt={exchange.createdAt}
              />
            ))}

            {loadingMode === "follow_up" ? (
              <div className="flex min-h-20 items-center gap-3 border-t border-white/10 py-5 text-sm text-slate-300" role="status" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin text-vaeroex-accent" aria-hidden="true" />
                Continuing analysis...
              </div>
            ) : null}

            {error ? <div className="rounded-lg border border-red-400/30 bg-red-950/35 p-4 text-sm text-red-100" role="alert">{error}</div> : null}

            {followUpLimitReached ? (
              <div className="border-t border-white/10 py-6">
                <h2 className="text-lg font-semibold text-white">This analysis reached its follow-up limit.</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Start a new Executive Analysis to examine a new question or refresh the evidence.</p>
                <button
                  type="button"
                  onClick={startNewAnalysis}
                  className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Start New Analysis
                </button>
              </div>
            ) : (
              <form className="border-t border-white/10 pt-6" onSubmit={submitFollowUp} data-vaeroex-skip-global-activity>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Continue Analysis</h2>
                    <p className="mt-1 text-sm text-slate-400">Ask a focused follow-up. Current workspace evidence will be checked again.</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-300">Follow-ups remaining: {followUpsRemaining}</span>
                </div>
                <label htmlFor="ask-vaeroex-follow-up" className="sr-only">Continue Analysis</label>
                <textarea
                  ref={followUpInputRef}
                  id="ask-vaeroex-follow-up"
                  value={followUpQuestion}
                  onChange={(event) => setFollowUpQuestion(event.target.value.slice(0, 600))}
                  onKeyDown={questionShortcut}
                  rows={3}
                  maxLength={600}
                  disabled={loading}
                  placeholder="Ask why, request a narrower comparison, or clarify what leadership should do first..."
                  className="mt-4 w-full resize-y rounded-lg border border-white/15 bg-slate-950/55 px-4 py-3 text-base leading-7 text-white outline-none placeholder:text-slate-500 focus:border-vaeroex-accent/55 focus:ring-2 focus:ring-vaeroex-accent/20 disabled:cursor-wait disabled:opacity-70"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">Cmd/Ctrl + Enter to submit</p>
                  <button
                    type="submit"
                    disabled={loading || followUpQuestion.trim().length < 2}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {loadingMode === "follow_up" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                    {loadingMode === "follow_up" ? "Continuing..." : "Continue Analysis"}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-3xl">
            {expiredNotice ? <div className="mb-5 rounded-lg border border-amber-300/25 bg-amber-950/25 p-4 text-sm text-amber-100">The previous analysis expired after 60 minutes of inactivity. Start a new analysis below.</div> : null}
            {error ? <div className="mb-5 rounded-lg border border-red-400/30 bg-red-950/35 p-4 text-sm text-red-100" role="alert">{error}</div> : null}
            <form onSubmit={submitInitial} data-vaeroex-skip-global-activity>
              <label htmlFor="ask-vaeroex-question" className="text-sm font-semibold text-white">What should leadership understand?</label>
              <textarea
                ref={initialInputRef}
                id="ask-vaeroex-question"
                value={initialQuestion}
                onChange={(event) => setInitialQuestion(event.target.value.slice(0, 600))}
                onKeyDown={questionShortcut}
                rows={5}
                maxLength={600}
                disabled={loading}
                autoFocus
                placeholder="Ask about business health, operating risks, performance changes, evidence quality, or what leadership should do next..."
                className="mt-3 w-full resize-y rounded-lg border border-white/15 bg-slate-950/60 px-4 py-4 text-base leading-7 text-white shadow-[0_18px_45px_rgba(0,0,0,0.18)] outline-none placeholder:text-slate-500 focus:border-vaeroex-accent/55 focus:ring-2 focus:ring-vaeroex-accent/20 disabled:cursor-wait disabled:opacity-70"
              />
              <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-slate-500">One initial question, then up to five focused follow-ups. Cmd/Ctrl + Enter to submit.</p>
                <button
                  type="submit"
                  disabled={loading || initialQuestion.trim().length < 2}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55 disabled:pointer-events-none disabled:opacity-60"
                >
                  {loadingMode === "initial" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                  {loadingMode === "initial" ? "Analyzing..." : "Ask Vaeroex"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
