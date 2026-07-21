"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowRight, Clock3, FileText, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { generateExecutiveBriefAction } from "@/app/app/executive-brief/actions";
import { SaveAnalysisButton } from "@/components/reports/SaveAnalysisButton";
import type {
  ExecutiveBriefCitationView,
  ExecutiveBriefFacts,
  ExecutiveBriefSignal,
  ExecutiveBriefState
} from "@/lib/ai/executive-brief/contracts";

type ExecutiveBriefPanelProps = {
  initialState: ExecutiveBriefState;
  requestToken: string | null;
  currentFacts: ExecutiveBriefFacts;
  currentSignals: readonly ExecutiveBriefSignal[];
  currentCitations: readonly ExecutiveBriefCitationView[];
};

function readableDate(value: string | null) {
  if (!value) return "No dated evidence";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function statusLabel(state: ExecutiveBriefState) {
  if (state.status === "current") return "Current brief";
  if (state.status === "stale") return "Update available";
  if (state.status === "loading") return "Preparing brief";
  if (state.status === "insufficient_evidence") return "Evidence limited";
  if (state.status === "failed") return "Brief unavailable";
  if (state.status === "unavailable") return "Temporarily unavailable";
  return "Ready to prepare";
}

function statusTone(state: ExecutiveBriefState) {
  if (state.status === "current") return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  if (state.status === "stale") return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  if (state.status === "failed" || state.status === "unavailable") return "border-red-300/35 bg-red-400/10 text-red-100";
  return "border-white/15 bg-white/[0.06] text-slate-200";
}

function EvidenceList({ citations }: { citations: readonly ExecutiveBriefCitationView[] }) {
  if (!citations.length) return <p className="text-sm leading-6 text-muted">No supporting citation is available for this brief.</p>;
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

function SignalFact({ signal }: { signal: ExecutiveBriefSignal }) {
  return (
    <li className="border-l-2 border-vaeroex-accent/45 pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{signal.label}</span>
        <span className="text-xs font-semibold text-muted">{signal.domain}</span>
        {signal.citationIds.map((citationId) => (
          <span key={citationId} className="text-xs font-semibold text-vaeroex-blue">[{citationId}]</span>
        ))}
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-700">{signal.approvedFact}</p>
    </li>
  );
}

export function ExecutiveBriefPanel({
  initialState,
  requestToken,
  currentFacts,
  currentSignals,
  currentCitations
}: ExecutiveBriefPanelProps) {
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

  function requestBrief() {
    if (!requestToken || requestInFlight.current || isPending) return;
    requestInFlight.current = true;
    setState((current) => ({ ...current, status: "loading", message: "Preparing a validated brief from eligible evidence." }));
    startTransition(async () => {
      try {
        setState(await generateExecutiveBriefAction(requestToken));
      } catch {
        setState({
          status: "failed",
          artifact: null,
          message: "The brief took too long or could not be completed. Executive facts remain available."
        });
      } finally {
        requestInFlight.current = false;
      }
    });
  }

  function openPanel() {
    setOpen(true);
    if (state.status === "available") requestBrief();
  }

  const artifact = state.artifact;
  const facts = artifact?.facts || currentFacts;
  const signals = artifact?.signals || currentSignals;
  const citations = artifact?.citations || currentCitations;
  const concern = artifact?.analysis.primary_concern
    || signals.find((signal) => signal.roles.includes("primary_concern"))?.label
    || null;
  const positive = artifact?.analysis.positive_signal
    || signals.find((signal) => signal.roles.includes("positive_signal"))?.label
    || null;
  const leadershipFocus = artifact?.analysis.leadership_focus
    || signals.find((signal) => signal.roles.includes("leadership_focus"))?.approvedLeadershipFocus
    || "Keep attention on the highest-ranked eligible evidence.";
  const unavailableWithoutArtifact = !artifact && ["failed", "unavailable"].includes(state.status);
  const summary = artifact?.analysis.executive_summary
    || (unavailableWithoutArtifact
      ? "Executive facts remain available while the validated brief is unavailable."
      : facts.deterministicReadout[0])
    || "Vaeroex needs more eligible evidence before it can establish the current executive story.";
  const showRefresh = Boolean(requestToken && ["stale", "failed"].includes(state.status) && !isPending);

  return (
    <>
      <div className="flex h-full flex-col" data-executive-brief>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText aria-hidden="true" className="h-4 w-4 text-cyan-200" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Executive Brief</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${statusTone(state)}`}>
            {statusLabel(state)}
          </span>
        </div>
        <h2 className="mt-4 max-w-3xl text-xl font-semibold leading-7 text-white sm:text-2xl">{summary}</h2>
        <dl className="mt-5 grid gap-3 border-y border-white/10 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-cyan-200">Primary concern</dt>
            <dd className="mt-1 leading-6 text-slate-200">{concern || "No evidence-backed primary concern currently stands out."}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-cyan-200">Positive signal</dt>
            <dd className="mt-1 leading-6 text-slate-200">{positive || "No evidence-backed positive signal currently stands out."}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-cyan-200">Leadership focus</dt>
            <dd className="mt-1 leading-6 text-slate-200">{leadershipFocus}</dd>
          </div>
        </dl>
        <div className="mt-auto pt-4">
          <button
            ref={triggerRef}
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-vaeroex-navy transition hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
            onClick={openPanel}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            Read full brief
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="absolute inset-0 hidden bg-slate-950/55 backdrop-blur-[2px] sm:block"
            aria-label="Close Executive Brief"
            onClick={() => setOpen(false)}
          />
          <aside ref={panelRef} className="absolute inset-0 flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:left-auto sm:max-w-3xl sm:border-l sm:border-line">
            <header className="shrink-0 border-b border-line bg-white px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-blue">Executive Overview</p>
                  <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink sm:text-2xl">Executive Brief</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-line bg-vaeroex-soft px-2.5 py-1 font-semibold text-slate-700">{statusLabel(state)}</span>
                    <span className="inline-flex items-center gap-1 text-muted"><ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" /> Confidence: {facts.confidence}</span>
                    <span className="inline-flex items-center gap-1 text-muted"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> Evidence {facts.freshness}</span>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-white text-slate-700 hover:bg-vaeroex-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55"
                  onClick={() => setOpen(false)}
                  aria-label="Close Executive Brief"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
              {["stale", "failed", "unavailable", "insufficient_evidence"].includes(state.status) ? (
                <div className={`mb-5 rounded-lg border px-4 py-3 text-sm leading-6 ${statusTone(state)}`} role={state.status === "failed" ? "alert" : "status"}>
                  {state.message}
                </div>
              ) : null}

              {artifact ? (
                <section aria-labelledby={`${titleId}-summary`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-blue">Executive summary</p>
                  <h3 id={`${titleId}-summary`} className="sr-only">Executive summary</h3>
                  <p className="mt-2 text-xl font-semibold leading-8 text-ink">{summary}</p>
                </section>
              ) : null}

              {!artifact && signals.length ? (
                <section aria-labelledby={`${titleId}-facts`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-blue">Current executive facts</p>
                  <h3 id={`${titleId}-facts`} className="sr-only">Current executive facts</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">Validated facts remain available while the narrative is being prepared.</p>
                  <ul className="mt-4 space-y-4">{signals.slice(0, 3).map((signal) => <SignalFact key={signal.stableKey} signal={signal} />)}</ul>
                </section>
              ) : null}

              {state.status === "loading" || isPending ? (
                <div className="mt-7 flex min-h-40 items-center justify-center border-y border-line py-8 text-center" role="status" aria-live="polite">
                  <div>
                    <Loader2 aria-hidden="true" className="mx-auto h-6 w-6 animate-spin text-vaeroex-blue" />
                    <p className="mt-3 text-sm font-semibold text-ink">Preparing the latest validated brief</p>
                    <p className="mt-1 text-sm text-muted">The underlying executive facts remain available while this completes.</p>
                  </div>
                </div>
              ) : artifact ? (
                <>
                  <section className="mt-7 border-t border-line pt-6" aria-labelledby={`${titleId}-concern`}>
                    <h3 id={`${titleId}-concern`} className="text-sm font-semibold text-ink">Primary concern</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.primary_concern || "No evidence-backed primary concern currently stands out."}</p>
                  </section>
                  {artifact.analysis.positive_signal ? (
                    <section className="mt-6" aria-labelledby={`${titleId}-positive`}>
                      <h3 id={`${titleId}-positive`} className="text-sm font-semibold text-ink">Positive signal</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.positive_signal}</p>
                    </section>
                  ) : null}
                  <section className="mt-6 grid gap-5 sm:grid-cols-2" aria-label="Executive interpretation">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">Why it matters</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.why_it_matters}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-ink">Leadership focus</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.leadership_focus}</p>
                    </div>
                  </section>
                  {artifact.analysis.provisional_hypothesis ? (
                    <section className="mt-6 border-l-2 border-amber-400 pl-3" aria-labelledby={`${titleId}-hypothesis`}>
                      <h3 id={`${titleId}-hypothesis`} className="text-sm font-semibold text-ink">Supported hypothesis</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">Provisional: {artifact.analysis.provisional_hypothesis}</p>
                    </section>
                  ) : null}
                  <section className="mt-6" aria-labelledby={`${titleId}-uncertainty`}>
                    <h3 id={`${titleId}-uncertainty`} className="text-sm font-semibold text-ink">What remains uncertain</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{artifact.analysis.uncertainty}</p>
                  </section>
                </>
              ) : state.status === "available" ? (
                <div className="mt-7 border-t border-line pt-5">
                  <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55" onClick={requestBrief}>
                    Prepare brief <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {facts.limitations.length ? (
                <section className="mt-7 border-t border-line pt-5" aria-labelledby={`${titleId}-limitations`}>
                  <h3 id={`${titleId}-limitations`} className="text-sm font-semibold text-ink">Known limitations</h3>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                    {facts.limitations.map((limitation) => <li key={limitation}><span aria-hidden="true">-</span> {limitation}</li>)}
                  </ul>
                </section>
              ) : null}

              <details className="mt-7 border-y border-line py-4">
                <summary className="cursor-pointer text-sm font-semibold text-vaeroex-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55">Supporting evidence ({citations.length})</summary>
                <p className="mt-2 text-sm leading-6 text-muted">Citations and source lineage are attached by Vaeroex after contract validation.</p>
                <EvidenceList citations={citations} />
              </details>

              {showRefresh ? (
                <div className="mt-6">
                  <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-vaeroex-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/55" onClick={requestBrief}>
                    <RefreshCw aria-hidden="true" className="h-4 w-4" /> Refresh brief
                  </button>
                </div>
              ) : null}

              {artifact ? <div className="mt-7"><SaveAnalysisButton analysisType="executive_brief" fingerprint={artifact.fingerprint} generatedAt={artifact.generatedAt} light /></div> : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
