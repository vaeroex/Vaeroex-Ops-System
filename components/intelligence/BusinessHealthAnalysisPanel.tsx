"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowRight, Clock3, Eye, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { generateBusinessHealthExplanationAction } from "@/app/app/business-health-analysis/actions";
import type {
  BusinessHealthAnalysisState,
  BusinessHealthCitationView,
  BusinessHealthExplanationFacts
} from "@/lib/ai/business-health-explanation/contracts";

type BusinessHealthAnalysisPanelProps = {
  initialState: BusinessHealthAnalysisState;
  requestToken: string | null;
  currentFacts: BusinessHealthExplanationFacts;
  currentCitations: readonly BusinessHealthCitationView[];
};

function readableDate(value: string | null) {
  if (!value) return "No dated evidence";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function statusLabel(state: BusinessHealthAnalysisState) {
  if (state.status === "current") return "Current analysis";
  if (state.status === "stale") return "Update available";
  if (state.status === "loading") return "Preparing analysis";
  if (state.status === "insufficient_evidence") return "Evidence limited";
  if (state.status === "failed") return "Analysis unavailable";
  if (state.status === "unavailable") return "Temporarily unavailable";
  return "Ready to analyze";
}

function statusTone(state: BusinessHealthAnalysisState) {
  if (state.status === "current") return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  if (state.status === "stale") return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  if (state.status === "failed" || state.status === "unavailable") return "border-red-300/35 bg-red-400/10 text-red-100";
  return "border-white/15 bg-white/[0.06] text-slate-200";
}

function EvidenceList({ citations }: { citations: readonly BusinessHealthCitationView[] }) {
  if (!citations.length) return <p className="text-sm leading-6 text-muted">No supporting citation is available for this analysis.</p>;

  return (
    <ol className="mt-3 divide-y divide-line/80 border-y border-line/80">
      {citations.map((citation) => (
        <li key={citation.citationId} className="py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-vaeroex-soft px-1 text-xs font-semibold text-vaeroex-blue">
              {citation.citationId}
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-ink">{citation.title}</p>
              <p className="mt-1 break-words text-xs font-semibold text-muted">{citation.sourceLabel} · {citation.sourceType}</p>
              <p className="mt-2 break-words text-sm leading-6 text-slate-700">{citation.excerpt}</p>
              <p className="mt-1 text-xs text-muted">Recorded {readableDate(citation.recordedAt)}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function BusinessHealthAnalysisPanel({
  initialState,
  requestToken,
  currentFacts,
  currentCitations
}: BusinessHealthAnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const hasOpenedRef = useRef(false);
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!open) {
      if (hasOpenedRef.current) {
        triggerRef.current?.focus();
        hasOpenedRef.current = false;
      }
      return;
    }
    hasOpenedRef.current = true;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleDialogKeyboard);
    };
  }, [open]);

  function requestAnalysis() {
    if (!requestToken || requestInFlight.current || isPending) return;
    requestInFlight.current = true;
    setState((current) => ({ ...current, status: "loading", message: "Preparing a validated explanation from eligible evidence." }));
    startTransition(async () => {
      try {
        const nextState = await generateBusinessHealthExplanationAction(requestToken);
        setState(nextState);
      } catch {
        setState({
          status: "failed",
          artifact: null,
          message: "The analysis took too long or could not be completed. Business Health facts remain available."
        });
      } finally {
        requestInFlight.current = false;
      }
    });
  }

  function openPanel() {
    setOpen(true);
    if (state.status === "available") requestAnalysis();
  }

  const artifact = state.artifact;
  const analysisFacts = artifact?.facts || currentFacts;
  const analysisCitations = artifact?.citations || currentCitations;
  const showRefresh = Boolean(requestToken && ["stale", "failed"].includes(state.status) && !isPending);
  const factsForDisplay = analysisFacts;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-cyan-200/25 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/50 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Eye aria-hidden="true" className="h-4 w-4" />
        View analysis
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="absolute inset-0 hidden bg-slate-950/55 backdrop-blur-[2px] sm:block"
            aria-label="Close Business Health analysis"
            onClick={() => setOpen(false)}
          />
          <aside ref={panelRef} className="absolute inset-0 flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:left-auto sm:max-w-2xl sm:border-l sm:border-line">
            <header className="shrink-0 border-b border-line bg-white px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-blue">Business Health</p>
                  <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink sm:text-2xl">Executive analysis</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-line bg-vaeroex-soft px-2.5 py-1 font-semibold text-slate-700">{statusLabel(state)}</span>
                    <span className="inline-flex items-center gap-1 text-muted"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Confidence: {factsForDisplay.confidence}</span>
                    <span className="inline-flex items-center gap-1 text-muted"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> Evidence {factsForDisplay.freshness}</span>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-white text-slate-700 hover:bg-vaeroex-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55"
                  onClick={() => setOpen(false)}
                  aria-label="Close Business Health analysis"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
              {state.status === "stale" || state.status === "failed" || state.status === "unavailable" || state.status === "insufficient_evidence" ? (
                <div className={`mb-5 rounded-lg border px-4 py-3 text-sm leading-6 ${statusTone(state)}`} role={state.status === "failed" ? "alert" : "status"}>
                  {state.message}
                </div>
              ) : null}

              {state.status === "loading" || isPending ? (
                <div className="flex min-h-40 items-center justify-center border-b border-line pb-8 text-center" role="status" aria-live="polite">
                  <div>
                    <Loader2 aria-hidden="true" className="mx-auto h-6 w-6 animate-spin text-vaeroex-blue" />
                    <p className="mt-3 text-sm font-semibold text-ink">Preparing the latest validated analysis</p>
                    <p className="mt-1 text-sm text-muted">The underlying score and facts remain available while this completes.</p>
                  </div>
                </div>
              ) : artifact ? (
                <section aria-labelledby={`${titleId}-interpretation`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-blue">Executive interpretation</p>
                  <h3 id={`${titleId}-interpretation`} className="sr-only">Executive interpretation</h3>
                  <p className="mt-2 text-lg font-semibold leading-8 text-ink">{artifact.analysis.executive_interpretation}</p>
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <div>
                      <p className="text-sm font-semibold text-ink">Why it matters</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.why_it_matters}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">Leadership consideration</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.leadership_consideration}</p>
                    </div>
                  </div>
                  {artifact.analysis.provisional_hypothesis ? (
                    <div className="mt-5 border-l-2 border-amber-400 pl-3">
                      <p className="text-sm font-semibold text-ink">Supported hypothesis</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">Provisional: {artifact.analysis.provisional_hypothesis}</p>
                    </div>
                  ) : null}
                </section>
              ) : state.status === "available" ? (
                <div className="mt-6 border-t border-line pt-5">
                  <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55" onClick={requestAnalysis}>
                    Prepare analysis <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {factsForDisplay.limitations.length ? (
                <section className="mt-7 border-t border-line pt-5" aria-labelledby={`${titleId}-limitations`}>
                  <h3 id={`${titleId}-limitations`} className="text-sm font-semibold text-ink">Known limitations</h3>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                    {factsForDisplay.limitations.map((limitation) => <li key={limitation}><span aria-hidden="true">-</span> {limitation}</li>)}
                  </ul>
                </section>
              ) : null}

              <section className="mt-7 border-t border-line pt-6" aria-labelledby={`${titleId}-facts`}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-blue">What the evidence shows</p>
                <h3 id={`${titleId}-facts`} className="mt-2 text-lg font-semibold text-ink">
                  Business Health is {factsForDisplay.score === null ? "not yet established" : `${factsForDisplay.score} out of 100`}.
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">{factsForDisplay.deterministicSummary}</p>
                <dl className="mt-4 grid gap-3 border-y border-line py-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold text-muted">State and trajectory</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">{factsForDisplay.status}{factsForDisplay.trajectory ? ` · ${factsForDisplay.trajectory}` : ""}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-muted">Previous review</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">{factsForDisplay.comparison}</dd>
                  </div>
                </dl>
                {factsForDisplay.drivers.length ? (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-ink">Highest-weighted drivers</p>
                    <ul className="mt-2 space-y-3">
                      {factsForDisplay.drivers.map((driver, index) => (
                        <li key={`${driver.kind}-${driver.label}-${index}`} className="border-l-2 border-vaeroex-accent/45 pl-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{driver.label}</span>
                            <span className="text-xs font-semibold text-muted">{driver.scoreImpact > 0 ? "+" : ""}{driver.scoreImpact} points</span>
                            {driver.citationIds.map((citationId) => <span key={citationId} className="text-xs font-semibold text-vaeroex-blue">[{citationId}]</span>)}
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-700">{driver.fact}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>

              <details className="mt-7 border-y border-line py-4">
                <summary className="cursor-pointer text-sm font-semibold text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">Supporting evidence ({analysisCitations.length})</summary>
                <p className="mt-2 text-sm leading-6 text-muted">Citations and source lineage are attached by Vaeroex after analysis validation.</p>
                <EvidenceList citations={analysisCitations} />
              </details>

              {showRefresh ? (
                <div className="mt-6">
                  <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-vaeroex-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55" onClick={requestAnalysis}>
                    <RefreshCw aria-hidden="true" className="h-4 w-4" /> Refresh analysis
                  </button>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
