"use client";

import { BarChart3, LoaderCircle } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { generateExecutiveKpiAnalysisAction } from "@/app/app/kpis/executive-analysis/actions";
import type { ExecutiveKpiAnalysisState } from "@/lib/ai/executive-kpi-analysis/contracts";

const TEMPORARY_PROVIDER_FAILURE = {
  code: "TEMPORARY_PROVIDER_FAILURE" as const,
  canGenerate: false,
  title: "Executive Analysis is temporarily unavailable.",
  explanation: "Validated KPI facts remain available below.",
  nextSteps: ["Please try again shortly."]
};

function metricNames(ordinals: readonly number[], state: ExecutiveKpiAnalysisState) {
  const metrics = state.artifact?.facts.metrics || [];
  return ordinals
    .map((ordinal) => metrics.find((metric) => metric.ordinal === ordinal)?.name)
    .filter(Boolean)
    .join(" + ");
}

function AnalysisList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExecutiveKpiAnalysis({
  initialState,
  requestToken,
  deterministicFallback
}: {
  initialState: ExecutiveKpiAnalysisState;
  requestToken: string | null;
  deterministicFallback: readonly string[];
}) {
  const [state, setState] = useState(initialState);
  const [isPending, startTransition] = useTransition();
  const requestInFlight = useRef(false);

  function generate() {
    if (!requestToken || requestInFlight.current || isPending) return;
    requestInFlight.current = true;
    setState((current) => ({ ...current, status: "loading", message: "Preparing an executive analysis from the validated KPI comparison." }));
    startTransition(async () => {
      try {
        setState(await generateExecutiveKpiAnalysisAction(requestToken));
      } catch {
        setState({
          status: "failed",
          artifact: null,
          message: null,
          readiness: TEMPORARY_PROVIDER_FAILURE
        });
      } finally {
        requestInFlight.current = false;
      }
    });
  }

  const analysis = state.artifact?.analysis;
  const readiness = state.readiness;
  const canRequestAnalysis = Boolean(requestToken)
    && (readiness?.canGenerate === true || state.status === "failed");
  const showReadiness = Boolean(readiness)
    && state.status !== "loading"
    && (readiness?.code !== "READY" || !analysis);
  const showFallback = !analysis && (
    readiness?.canGenerate === false
    || ["failed", "unavailable", "insufficient_evidence"].includes(state.status)
  );

  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/35 p-4" aria-labelledby="executive-kpi-analysis-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p id="executive-kpi-analysis-title" className="text-sm font-semibold text-white">Executive KPI Analysis</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Understand the story behind the selected KPIs, including important patterns, possible relationships, and what leadership should investigate next.
          </p>
        </div>
        {!analysis && canRequestAnalysis ? (
          <button
            type="button"
            onClick={generate}
            disabled={isPending || state.status === "loading"}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/60 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isPending || state.status === "loading" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <BarChart3 aria-hidden="true" className="h-4 w-4" />}
            {isPending || state.status === "loading"
              ? "Generating analysis"
              : state.status === "failed"
                ? "Try again"
                : "Generate Executive Analysis"}
          </button>
        ) : null}
      </div>

      {state.status === "loading" || isPending ? (
        <div className="mt-5 flex min-h-28 items-center justify-center border-t border-white/10 pt-5 text-center" role="status" aria-live="polite">
          <div>
            <LoaderCircle aria-hidden="true" className="mx-auto h-6 w-6 animate-spin text-cyan-200" />
            <p className="mt-3 text-sm font-semibold text-white">Reviewing the selected KPI story</p>
            <p className="mt-1 text-xs text-slate-400">The chart and validated KPI facts remain available while this completes.</p>
          </div>
        </div>
      ) : null}

      {showReadiness && readiness ? (
        <div
          className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-950/20 px-4 py-3"
          data-readiness-state={readiness.code}
          role={readiness.code === "TEMPORARY_PROVIDER_FAILURE" ? "alert" : "status"}
        >
          <p className="text-sm font-semibold text-white">{readiness.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{readiness.explanation}</p>
          {readiness.nextSteps.length ? (
            <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-300">
              {readiness.nextSteps.map((step) => (
                <li key={step} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-200" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state.message && state.status !== "loading" && readiness?.code !== "TEMPORARY_PROVIDER_FAILURE" ? (
        <p className="mt-4 rounded-lg border border-amber-300/25 bg-amber-950/25 px-3 py-2 text-sm leading-6 text-amber-100" role={state.status === "failed" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}

      {analysis ? (
        <div className="mt-5 divide-y divide-white/10 border-t border-white/10">
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Executive Summary</h3>
            <p className="mt-3 text-sm leading-6 text-slate-200">{analysis.executive_summary}</p>
          </div>
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">What Stands Out</h3>
            <div className="mt-3 space-y-3">
              {analysis.significant_trends.map((item, index) => (
                <div key={`${item.statement}-${index}`}>
                  <p className="text-xs font-semibold text-slate-400">{metricNames(item.metric_ordinals, state)}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-200">{item.statement}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Pattern Worth Investigating</h3>
            <div className="mt-3 space-y-3">
              {analysis.potential_kpi_relationships.map((item, index) => (
                <div key={`${item.statement}-${index}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/15 px-2 py-1 text-[11px] font-semibold text-slate-300">{item.status}</span>
                    <span className="text-xs font-semibold text-slate-400">{metricNames(item.metric_ordinals, state)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{item.statement}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Possible Business Drivers</h3>
            <AnalysisList items={analysis.possible_business_drivers.map((item) => item.statement)} />
          </div>
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Leadership Focus</h3>
            <AnalysisList items={analysis.leadership_considerations} />
          </div>
          <div className="py-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cyan-100">Keep In Mind</h3>
            <AnalysisList items={analysis.analysis_limitations} />
          </div>
          {state.artifact?.citations.length ? (
            <details className="py-5">
              <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Supporting sources ({state.artifact.citations.length})</summary>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                {state.artifact.citations.map((citation) => (
                  <li key={citation.citationId} className="break-words">
                    <span className="font-semibold text-slate-200">[{citation.citationId}] {citation.sourceLabel}</span>
                    <span className="text-slate-400"> · {citation.sourceType}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {showFallback ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Validated KPI facts</p>
          <AnalysisList items={deterministicFallback.length ? deterministicFallback : ["The selected KPIs do not yet have enough comparable history to calculate percentage movement."]} />
        </div>
      ) : null}
    </section>
  );
}
