"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { runContextualAskVaeroexAction, type ContextualAskState } from "@/app/app/contextual-ask/actions";
import { useActivitySignal } from "@/components/app/ActivityProvider";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { isSecurityResponseMessage } from "@/lib/security/security-response";

type ContextualAskVaeroexProps = {
  label?: string;
  prompt: string;
  contextType: string;
  contextId?: string | null;
  sourceTitle?: string;
  sourceSummary?: string;
  evidence?: string[];
  compact?: boolean;
  mode?: "inline" | "drawer";
  defaultCollapsed?: boolean;
};

const initialState: ContextualAskState = { status: "idle" };

function progressMessage(progress: number) {
  if (progress >= 100) return "Explanation ready.";
  if (progress >= 88) return "Finalizing answer...";
  if (progress >= 58) return "Preparing explanation...";
  if (progress >= 28) return "Checking evidence...";
  return "Reading workspace context...";
}

function HiddenContextFields({
  prompt,
  contextType,
  contextId,
  sourceTitle,
  sourceSummary,
  evidence,
  followUp = ""
}: Required<Pick<ContextualAskVaeroexProps, "prompt" | "contextType">> &
  Pick<ContextualAskVaeroexProps, "contextId" | "sourceTitle" | "sourceSummary" | "evidence"> & {
    followUp?: string;
  }) {
  return (
    <>
      <input type="hidden" name="prompt" value={prompt} />
      <input type="hidden" name="context_type" value={contextType} />
      <input type="hidden" name="context_id" value={contextId || ""} />
      <input type="hidden" name="source_title" value={sourceTitle || ""} />
      <input type="hidden" name="source_summary" value={sourceSummary || ""} />
      <input type="hidden" name="evidence_json" value={JSON.stringify(evidence || [])} />
      {followUp ? <input type="hidden" name="follow_up" value={followUp} /> : null}
    </>
  );
}

export function ContextualAskVaeroex({
  label = "Explain This",
  prompt,
  contextType,
  contextId,
  sourceTitle,
  sourceSummary,
  evidence = [],
  compact = false,
  mode = "inline",
  defaultCollapsed = true
}: ContextualAskVaeroexProps) {
  const [state, formAction, isPending] = useActionState(runContextualAskVaeroexAction, initialState);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [followUp, setFollowUp] = useState("");
  const [progress, setProgress] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const panelId = useMemo(() => `contextual-ask-${contextType}-${contextId || sourceTitle || "item"}`.replace(/[^a-zA-Z0-9_-]/g, "-"), [
    contextId,
    contextType,
    sourceTitle
  ]);
  const isGenerating = isPending || showCompletion;
  const displayedProgress = isGenerating ? Math.max(progress, 5) : progress;
  const answer = showAnswer ? state.answer : undefined;
  const activePanelId = isGenerating ? `${panelId}-progress` : panelId;
  useActivitySignal(isGenerating, progressMessage(displayedProgress), { source: "contextual-ask", timeoutMs: 90000 });

  useEffect(() => {
    if (!isPending) {
      return;
    }

    setProgress(5);
    setShowAnswer(false);
    setShowCompletion(false);

    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current < 70) {
          return Math.min(70, current + 5);
        }

        if (current < 90) {
          return Math.min(90, current + 2);
        }

        if (current < 95) {
          return Math.min(95, current + 1);
        }

        return current;
      });
    }, 700);

    return () => window.clearInterval(timer);
  }, [isPending]);

  useEffect(() => {
    if (isPending) {
      return;
    }

    if (state.status === "success" && state.answer) {
      setProgress(100);
      setShowCompletion(true);

      const timer = window.setTimeout(() => {
        setShowCompletion(false);
        setShowAnswer(true);
      }, 450);

      return () => window.clearTimeout(timer);
    }

    if (state.status === "error") {
      setShowCompletion(false);
      setShowAnswer(false);
      setProgress(0);
    }

    return undefined;
  }, [isPending, state.answer, state.status]);

  async function copyAnswer() {
    if (!answer?.copyText) {
      return;
    }

    await navigator.clipboard.writeText(answer.copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`${compact ? "space-y-3" : "space-y-4"} ${mode === "drawer" ? "max-w-2xl" : ""}`}>
      <form action={formAction}>
        <HiddenContextFields
          prompt={prompt}
          contextType={contextType}
          contextId={contextId}
          sourceTitle={sourceTitle}
          sourceSummary={sourceSummary}
          evidence={evidence}
        />
        <button
          type="submit"
          disabled={isGenerating}
          aria-busy={isGenerating}
          aria-controls={activePanelId}
          aria-expanded={isGenerating || (state.status === "success" && !collapsed)}
          className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isGenerating ? `Generating explanation... ${displayedProgress}%` : label}
        </button>
      </form>

      {isGenerating ? (
        <div
          id={`${panelId}-progress`}
          role="status"
          aria-live="polite"
          className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-4 text-sm text-cyan-50 shadow-panel"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Vaeroex is generating</p>
              <p className="mt-1 font-semibold text-white">{progressMessage(displayedProgress)}</p>
            </div>
            <span className="rounded-full border border-cyan-300/25 bg-slate-950/45 px-2.5 py-1 text-xs font-semibold text-cyan-100">
              {displayedProgress}%
            </span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-950/70">
            <div
              className="h-full rounded-full bg-gradient-to-r from-vaeroex-blue via-cyan-400 to-vaeroex-accent transition-[width] duration-700 ease-out"
              style={{ width: `${displayedProgress}%` }}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-300">
            Vaeroex is reviewing the selected item and its directly related evidence.
          </p>
        </div>
      ) : null}

      {!isGenerating && state.status === "error" && isSecurityResponseMessage(state.error) ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050b14] p-4">
          <div className="w-full max-w-3xl">
            <SecurityResponseNotice />
          </div>
        </div>
      ) : null}

      {!isGenerating && state.status === "error" && !isSecurityResponseMessage(state.error) ? (
        <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-4 text-sm leading-6 text-red-100">
          <p className="font-semibold">Vaeroex couldn’t generate this explanation.</p>
          <p className="mt-1">{state.error || "Try again in a moment."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={formAction}>
              <HiddenContextFields
                prompt={prompt}
                contextType={contextType}
                contextId={contextId}
                sourceTitle={sourceTitle}
                sourceSummary={sourceSummary}
                evidence={evidence}
              />
              <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
                Retry
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {answer ? (
        <div id={panelId} className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 text-sm text-cyan-50 shadow-panel">
          <div className="flex flex-col gap-3 border-b border-cyan-300/15 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Contextual Vaeroex answer</p>
              <h3 className="mt-2 text-base font-semibold text-white">{answer.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="w-fit rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          </div>
          {!collapsed ? (
            <div className="space-y-4 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Direct Explanation</p>
                <p className="mt-2 leading-6 text-slate-100">{answer.directExplanation}</p>
              </div>
              {answer.whyItMatters ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Why It Matters</p>
                  <p className="mt-2 leading-6 text-slate-100">{answer.whyItMatters}</p>
                </div>
              ) : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Evidence</p>
                <ul className="mt-2 space-y-1 leading-6 text-slate-100">
                  {answer.evidence.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`grid gap-3 ${answer.limitations ? "sm:grid-cols-2" : ""}`}>
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Recommendation Confidence</p>
                  <p className="mt-2 leading-6 text-slate-100">
                    <span className="font-semibold text-white">{answer.confidence}</span>
                  </p>
                </div>
                {answer.limitations ? (
                  <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Limitations</p>
                    <p className="mt-2 leading-6 text-slate-100">{answer.limitations}</p>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyAnswer}
                  className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45"
                >
                  {copied ? "Copied" : "Copy explanation"}
                </button>
                <button
                  type="button"
                  onClick={() => setFollowUp((value) => (value ? "" : " "))}
                  className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
                >
                  Ask follow-up
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
                >
                  Collapse
                </button>
              </div>
              {followUp ? (
                <form action={formAction} className="space-y-3 rounded-lg border border-white/10 bg-slate-950/35 p-3">
                  <HiddenContextFields
                    prompt={prompt}
                    contextType={contextType}
                    contextId={contextId}
                    sourceTitle={sourceTitle}
                    sourceSummary={sourceSummary}
                    evidence={evidence}
                  />
                  <label className="block text-xs font-semibold uppercase tracking-wide text-cyan-200">
                    Ask a follow-up about this
                    <textarea
                      name="follow_up"
                      rows={3}
                      value={followUp.trimStart()}
                      onChange={(event) => setFollowUp(event.target.value)}
                      placeholder="Should I apply this target?"
                      className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
                    />
                  </label>
                  <button
                    disabled={isGenerating || !followUp.trim()}
                    className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {isGenerating ? `Generating... ${displayedProgress}%` : "Ask follow-up"}
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="p-4">
              <p className="line-clamp-2 text-sm leading-6 text-slate-100">{answer.directExplanation}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
