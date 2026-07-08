"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import {
  generatedOutputHref,
  outputTypeForInsight,
  type GeneratedOutputType
} from "@/lib/intelligence/generated-output";
import type {
  IntelligenceConfidence,
  IntelligenceInsight,
  IntelligenceInsightType
} from "@/lib/intelligence/layer";

const signalTypes: IntelligenceInsightType[] = ["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"];
const confidenceOptions: Array<"All" | IntelligenceConfidence> = ["All", "High", "Medium", "Low"];
const pageSize = 10;

type SortMode = "Priority" | "Newest" | "Confidence" | "Signal type";

function confidenceClass(confidence: IntelligenceConfidence) {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function priorityClass(priority: "High" | "Medium" | "Low") {
  if (priority === "High") return "border-red-300/40 bg-red-500/15 text-red-100";
  if (priority === "Medium") return "border-amber-300/35 bg-amber-500/15 text-amber-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function typeEmptyMessage(type: IntelligenceInsightType) {
  if (type === "Forecast") return "No forecast signals currently have enough historical evidence.";
  if (type === "Bottleneck") return "No bottleneck signals currently require leadership review.";
  if (type === "Recommendation") return "No recommendations currently require leadership review.";
  if (type === "Anomaly") return "No anomaly signals currently require leadership review.";
  if (type === "Opportunity") return "No opportunity signals currently require leadership review.";
  return "No risk signals currently require leadership review.";
}

function typeTabLabel(type: IntelligenceInsightType) {
  if (type === "Opportunity") return "Opportunities";
  if (type === "Anomaly") return "Anomalies";
  return `${type}s`;
}

function formatSignalDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function compactText(value: string, maxLength = 140) {
  const text = value.replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function primaryOutputType(insight: IntelligenceInsight): GeneratedOutputType {
  return outputTypeForInsight(insight);
}

function primaryOutputLabel(type: GeneratedOutputType) {
  if (type === "risk_brief") return "Generate Investigation Summary";
  if (type === "executive_briefing") return "Generate Executive Briefing";
  return "Generate Improvement Plan";
}

function sortInsights(insights: IntelligenceInsight[], sortMode: SortMode) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const confidenceRank = { High: 3, Medium: 2, Low: 1 };
  const typeRank = Object.fromEntries(signalTypes.map((type, index) => [type, index]));

  return [...insights].sort((a, b) => {
    if (sortMode === "Newest") return b.lastUpdated.localeCompare(a.lastUpdated);
    if (sortMode === "Confidence") {
      const confidenceDelta = confidenceRank[b.confidence] - confidenceRank[a.confidence];
      return confidenceDelta || priorityRank[b.priority] - priorityRank[a.priority] || b.lastUpdated.localeCompare(a.lastUpdated);
    }
    if (sortMode === "Signal type") {
      return (typeRank[a.type] ?? 99) - (typeRank[b.type] ?? 99) || priorityRank[b.priority] - priorityRank[a.priority];
    }

    const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
    return priorityDelta || confidenceRank[b.confidence] - confidenceRank[a.confidence] || b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

function isActionable(insight: IntelligenceInsight) {
  return insight.priority !== "Low" || insight.confidence !== "Low" || insight.evidenceCount >= 2;
}

export function IntelligenceSignalInbox({ insights }: { insights: IntelligenceInsight[] }) {
  const initialType = signalTypes.find((type) => insights.some((insight) => insight.type === type)) || "Risk";
  const [activeType, setActiveType] = useState<IntelligenceInsightType>(initialType);
  const [selectedId, setSelectedId] = useState<string>(insights.find((insight) => insight.type === initialType)?.id || insights[0]?.id || "");
  const [confidence, setConfidence] = useState<"All" | IntelligenceConfidence>("All");
  const [sortMode, setSortMode] = useState<SortMode>("Priority");
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  const counts = useMemo(
    () =>
      signalTypes.reduce<Record<IntelligenceInsightType, number>>((acc, type) => {
        acc[type] = insights.filter((insight) => insight.type === type).length;
        return acc;
      }, {} as Record<IntelligenceInsightType, number>),
    [insights]
  );

  const filteredInsights = useMemo(() => {
    const base = insights
      .filter((insight) => insight.type === activeType)
      .filter((insight) => (confidence === "All" ? true : insight.confidence === confidence))
      .filter((insight) => (hideLowConfidence ? insight.confidence !== "Low" : true))
      .filter((insight) => (onlyActionable ? isActionable(insight) : true));

    return sortInsights(base, sortMode);
  }, [activeType, confidence, hideLowConfidence, insights, onlyActionable, sortMode]);

  const visibleInsights = filteredInsights.slice(0, visibleCount);
  const selectedInsight =
    filteredInsights.find((insight) => insight.id === selectedId) ||
    visibleInsights[0] ||
    insights.find((insight) => insight.id === selectedId) ||
    null;

  function selectType(type: IntelligenceInsightType) {
    const firstInsight = insights.find((insight) => insight.type === type);
    setActiveType(type);
    setSelectedId(firstInsight?.id || "");
    setVisibleCount(pageSize);
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#07101f] p-4 text-slate-100 shadow-command">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Executive Inbox</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Signals requiring leadership review</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
            Review one intelligence category at a time. Open a signal for evidence, reasoning, confidence, and executive outputs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">
            <input
              type="checkbox"
              checked={hideLowConfidence}
              onChange={(event) => setHideLowConfidence(event.currentTarget.checked)}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
            />
            Hide low confidence
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">
            <input
              type="checkbox"
              checked={onlyActionable}
              onChange={(event) => setOnlyActionable(event.currentTarget.checked)}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
            />
            Show only actionable
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/35 p-2">
        {signalTypes.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => selectType(type)}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              activeType === type
                ? "bg-vaeroex-blue text-white"
                : "border border-white/10 bg-white/[0.04] text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-950/30"
            }`}
          >
            {typeTabLabel(type)}
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{counts[type]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-300">
          Confidence
          <select
            value={confidence}
            onChange={(event) => {
              setConfidence(event.currentTarget.value as "All" | IntelligenceConfidence);
              setVisibleCount(pageSize);
            }}
            className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
          >
            {confidenceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Sort by
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.currentTarget.value as SortMode)}
            className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
          >
            {(["Priority", "Newest", "Confidence", "Signal type"] as SortMode[]).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-slate-300">
          Showing {filteredInsights.length ? `1-${visibleInsights.length}` : "0"} of {filteredInsights.length} {activeType.toLowerCase()} signal{filteredInsights.length === 1 ? "" : "s"}.
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)]">
        <div className="space-y-3">
          {visibleInsights.length ? (
            visibleInsights.map((insight) => (
              <article
                key={insight.id}
                className={`rounded-xl border p-3 transition ${
                  selectedInsight?.id === insight.id
                    ? "border-cyan-300/45 bg-cyan-950/25 shadow-panel"
                    : "border-white/10 bg-slate-950/40 hover:border-cyan-300/35 hover:bg-cyan-950/15"
                }`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="line-clamp-1 text-sm font-semibold text-white">{insight.title}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(insight.confidence)}`}>
                        {insight.confidence}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-300">{compactText(insight.summary, 150)}</p>
                    <p className="mt-2 text-xs text-slate-500">{formatSignalDate(insight.lastUpdated)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(insight.id)}
                    className="min-h-10 shrink-0 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                  >
                    View Details
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
              {typeEmptyMessage(activeType)}
            </div>
          )}

          {filteredInsights.length > visibleInsights.length ? (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + pageSize)}
              className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30"
            >
              Load More
            </button>
          ) : null}
        </div>

        <aside className="rounded-xl border border-white/10 bg-slate-950/45 p-4 shadow-panel xl:sticky xl:top-24 xl:self-start">
          {selectedInsight ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-300/35 bg-cyan-950/35 px-2.5 py-1 text-xs font-semibold text-cyan-50">
                  {selectedInsight.type}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(selectedInsight.priority)}`}>
                  Priority: {selectedInsight.priority}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(selectedInsight.confidence)}`}>
                  Confidence: {selectedInsight.confidence}
                </span>
              </div>

              <div>
                <h3 className="text-lg font-semibold leading-7 text-white">{selectedInsight.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{selectedInsight.summary}</p>
              </div>

              <div className="grid gap-3 text-sm leading-6">
                <section className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Why Vaeroex surfaced it</p>
                  <p className="mt-2 text-slate-200">{selectedInsight.why}</p>
                </section>
                <section className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Executive recommendation</p>
                  <p className="mt-2 text-slate-200">{selectedInsight.recommendedAction}</p>
                </section>
                <section className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Business impact</p>
                  <p className="mt-2 text-slate-200">{selectedInsight.impact}</p>
                </section>
              </div>

              <details className="rounded-lg border border-white/10 bg-slate-950/45 p-3" open>
                <summary className="cursor-pointer text-xs font-semibold text-cyan-100">Evidence and Business Memory</summary>
                <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-300">
                  <ul className="space-y-2">
                    {selectedInsight.evidence.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                    <p>Evidence count: {selectedInsight.evidenceCount}</p>
                    <p>Business Memory references: {selectedInsight.sourceTypes.join(", ")}</p>
                    <p>Confidence explanation: {selectedInsight.confidence} confidence based on source depth, priority, and evidence count.</p>
                  </div>
                </div>
              </details>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={generatedOutputHref({ type: primaryOutputType(selectedInsight), source: selectedInsight.id })}
                  className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy"
                >
                  {primaryOutputLabel(primaryOutputType(selectedInsight))}
                </Link>
                <Link
                  href={generatedOutputHref({ type: "executive_briefing", source: selectedInsight.id })}
                  className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                >
                  Generate Executive Briefing
                </Link>
                <Link
                  href={selectedInsight.sourceHref as Route}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30"
                >
                  Open source area
                </Link>
                <ContextualAskVaeroex
                  label="Explain This"
                  prompt={`Explain why this ${selectedInsight.type.toLowerCase()} matters, what evidence supports it, what could happen next, and what leadership should review.`}
                  contextType={`intelligence_${selectedInsight.type.toLowerCase()}`}
                  contextId={selectedInsight.id}
                  sourceTitle={selectedInsight.title}
                  sourceSummary={`${selectedInsight.summary} Executive recommendation: ${selectedInsight.recommendedAction}`}
                  evidence={[
                    selectedInsight.why,
                    ...selectedInsight.evidence,
                    `Confidence: ${selectedInsight.confidence}`,
                    `Source types: ${selectedInsight.sourceTypes.join(", ")}`,
                    `Evidence count: ${selectedInsight.evidenceCount}`
                  ]}
                  compact
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/15 p-5 text-sm leading-6 text-slate-300">
              Select a signal to review evidence, confidence, and recommended leadership action.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
