"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { generatedOutputHref, outputTypeForInsight } from "@/lib/intelligence/generated-output";
import type { IntelligenceConfidence, IntelligenceInsight, IntelligenceInsightType } from "@/lib/intelligence/layer";

const signalTypes: IntelligenceInsightType[] = ["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"];
const confidenceOptions: Array<"All" | IntelligenceConfidence> = ["All", "High", "Medium", "Low"];
const pageSize = 10;

type SortMode = "Priority" | "Newest" | "Confidence";
type PanelMode = "summary" | "evidence";

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
  if (type === "Forecast") return "No forecast signals have enough historical evidence yet.";
  if (type === "Opportunity") return "No evidence-backed opportunity is ready for review.";
  return `No ${type.toLowerCase()} signals currently require attention.`;
}

function typeTabLabel(type: IntelligenceInsightType) {
  if (type === "Opportunity") return "Opportunities";
  if (type === "Anomaly") return "Anomalies";
  return `${type}s`;
}

function formatSignalDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function compactText(value: string, maxLength = 150) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "").trim()}...`;
}

function sortInsights(insights: IntelligenceInsight[], sortMode: SortMode) {
  const priorityRank = { High: 3, Medium: 2, Low: 1 };
  const confidenceRank = { High: 3, Medium: 2, Low: 1 };

  return [...insights].sort((a, b) => {
    if (sortMode === "Newest") return b.lastUpdated.localeCompare(a.lastUpdated);
    if (sortMode === "Confidence") {
      return confidenceRank[b.confidence] - confidenceRank[a.confidence] || priorityRank[b.priority] - priorityRank[a.priority];
    }
    return priorityRank[b.priority] - priorityRank[a.priority] || confidenceRank[b.confidence] - confidenceRank[a.confidence] || b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

function limitationFor(insight: IntelligenceInsight) {
  return insight.limitation || insight.suggestedNextData || "Not enough evidence for a reliable conclusion.";
}

function PanelTabs({ mode, onChange }: { mode: PanelMode; onChange: (mode: PanelMode) => void }) {
  const tabs: Array<{ id: PanelMode; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "evidence", label: "Evidence" }
  ];

  return (
    <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-slate-950/50 p-1" role="tablist" aria-label="Selected finding view">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={mode === tab.id}
          onClick={() => onChange(tab.id)}
          className={`min-h-10 rounded-md px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
            mode === tab.id ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/35 hover:text-white"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SummaryPanel({ insight }: { insight: IntelligenceInsight }) {
  return (
    <div className="space-y-4 text-sm leading-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">What happened</p>
        <p className="mt-2 text-slate-100">{compactText(insight.summary, 320)}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Why it matters</p>
        <p className="mt-2 text-slate-200">{compactText(insight.impact, 260)}</p>
      </section>
      <section className="border-l-2 border-cyan-300/50 pl-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Leadership decision</p>
        <p className="mt-2 text-slate-100">{compactText(insight.recommendedAction, 260)}</p>
      </section>
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Limitation</p>
        <p className="mt-2 text-slate-300">{compactText(limitationFor(insight), 280)}</p>
      </section>
      <Link
        href={generatedOutputHref({ type: outputTypeForInsight(insight), source: insight.id })}
        className="inline-flex min-h-10 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        {insight.type === "Risk" || insight.type === "Anomaly" || insight.type === "Bottleneck" ? "Create Investigation Summary" : "Create report"}
      </Link>
    </div>
  );
}

function EvidencePanel({ insight }: { insight: IntelligenceInsight }) {
  return (
    <div className="space-y-4 text-sm leading-6">
      <div className="grid gap-3 border-b border-white/10 pb-4 text-xs text-slate-300 sm:grid-cols-2">
        <p><span className="font-semibold text-slate-100">Supporting records:</span> {insight.evidenceCount}</p>
        <p><span className="font-semibold text-slate-100">Independent sources:</span> {insight.independentSourceCount}</p>
        <p><span className="font-semibold text-slate-100">Last updated:</span> {formatSignalDate(insight.lastUpdated)}</p>
        <p><span className="font-semibold text-slate-100">Period:</span> {insight.timePeriod}</p>
      </div>
      <ul className="divide-y divide-white/10 border-y border-white/10">
        {insight.supportingRecords.length ? insight.supportingRecords.map((record) => (
          <li key={record.id} className="py-4 first:pt-3 last:pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Link href={record.href as Route} className="font-semibold text-cyan-100 underline-offset-4 hover:text-white hover:underline">
                  {record.title}
                </Link>
                <p className="mt-1 text-xs text-slate-400">{record.recordType} · {formatSignalDate(record.date)} · {record.classification}</p>
              </div>
              <span className="max-w-full break-words text-xs font-semibold text-slate-200 sm:max-w-52 sm:text-right">{compactText(record.value, 120)}</span>
            </div>
            <p className="mt-2 break-words text-xs leading-5 text-slate-300">{compactText(record.support, 220)}</p>
          </li>
        )) : <li className="py-4 text-slate-400">No eligible supporting records are available for this finding.</li>}
      </ul>
      <div className={`grid gap-3 text-xs leading-5 ${insight.contradictoryEvidence.length ? "sm:grid-cols-2" : ""}`}>
        {insight.contradictoryEvidence.length ? (
          <div>
            <p className="font-semibold text-slate-100">Contradictory evidence</p>
            <p className="mt-1 text-slate-400">{insight.contradictoryEvidence.join("; ")}</p>
          </div>
        ) : null}
        <div>
          <p className="font-semibold text-slate-100">Missing evidence</p>
          <p className="mt-1 text-slate-400">{insight.missingEvidence.length ? insight.missingEvidence.join("; ") : "No material gap recorded."}</p>
        </div>
      </div>
    </div>
  );
}

export function IntelligenceSignalInbox({ insights, initialFindingId }: { insights: IntelligenceInsight[]; initialFindingId?: string }) {
  const requestedFinding = initialFindingId ? insights.find((insight) => insight.id === initialFindingId) : null;
  const initialType = requestedFinding?.type || signalTypes.find((type) => insights.some((insight) => insight.type === type)) || "Risk";
  const [activeType, setActiveType] = useState<IntelligenceInsightType>(initialType);
  const [selectedId, setSelectedId] = useState<string>(requestedFinding?.id || insights.find((insight) => insight.type === initialType)?.id || insights[0]?.id || "");
  const [confidence, setConfidence] = useState<"All" | IntelligenceConfidence>("All");
  const [sortMode, setSortMode] = useState<SortMode>("Priority");
  const [hideLowConfidence, setHideLowConfidence] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [panelMode, setPanelMode] = useState<PanelMode>("summary");

  const counts = useMemo(
    () => signalTypes.reduce<Record<IntelligenceInsightType, number>>((acc, type) => ({ ...acc, [type]: insights.filter((insight) => insight.type === type).length }), {} as Record<IntelligenceInsightType, number>),
    [insights]
  );
  const filteredInsights = useMemo(
    () => sortInsights(insights.filter((insight) => insight.type === activeType).filter((insight) => confidence === "All" || insight.confidence === confidence).filter((insight) => !hideLowConfidence || insight.confidence !== "Low"), sortMode),
    [activeType, confidence, hideLowConfidence, insights, sortMode]
  );
  const visibleInsights = filteredInsights.slice(0, visibleCount);
  const selectedInsight = selectedId ? filteredInsights.find((insight) => insight.id === selectedId) || visibleInsights[0] || null : null;

  function selectType(type: IntelligenceInsightType) {
    const firstInsight = insights.find((insight) => insight.type === type);
    setActiveType(type);
    setSelectedId(firstInsight?.id || "");
    setVisibleCount(pageSize);
    setPanelMode("summary");
  }

  function selectInsight(id: string) {
    setSelectedId(id);
    setPanelMode("summary");
  }

  return (
    <section className="rounded-xl border border-white/10 bg-[#07101f] p-4 text-slate-100 shadow-command">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence</p>
          <h2 className="mt-1 text-xl font-semibold text-white">What needs attention</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">
            <input type="checkbox" checked={hideLowConfidence} onChange={(event) => setHideLowConfidence(event.currentTarget.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent" />
            Hide low confidence
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">
            <span>Sort</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.currentTarget.value as SortMode)} className="bg-transparent text-xs text-slate-100 focus:outline-none">
              {(["Priority", "Newest", "Confidence"] as SortMode[]).map((option) => <option key={option} value={option} className="bg-slate-950">{option}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
        {signalTypes.map((type) => (
          <button key={type} type="button" onClick={() => selectType(type)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${activeType === type ? "bg-vaeroex-blue text-white" : "text-slate-300 hover:bg-cyan-950/30 hover:text-white"}`}>
            {typeTabLabel(type)} <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.7rem]">{counts[type]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(23rem,.82fr)]">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Showing {filteredInsights.length ? `1-${visibleInsights.length}` : "0"} of {filteredInsights.length}.</p>
          {visibleInsights.length ? visibleInsights.map((insight) => (
            <button key={insight.id} type="button" onClick={() => selectInsight(insight.id)} className={`block w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${selectedInsight?.id === insight.id ? "border-cyan-300/45 bg-cyan-950/25" : "border-white/10 bg-slate-950/35 hover:border-cyan-300/35 hover:bg-cyan-950/15"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold leading-5 text-white">{compactText(insight.title, 110)}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-300">{compactText(insight.summary)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(insight.confidence)}`}>{insight.confidence}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{formatSignalDate(insight.lastUpdated)}</p>
            </button>
          )) : <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">{typeEmptyMessage(activeType)}</div>}
          {filteredInsights.length > visibleInsights.length ? <button type="button" onClick={() => setVisibleCount((count) => count + pageSize)} className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">Load more</button> : null}
        </div>

        <aside className="rounded-lg border border-white/10 bg-slate-950/45 p-4 shadow-panel xl:sticky xl:top-24 xl:self-start">
          {selectedInsight ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityClass(selectedInsight.priority)}`}>Priority: {selectedInsight.priority}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(selectedInsight.confidence)}`}>Confidence: {selectedInsight.confidence}</span>
                  </div>
                  <h3 className="mt-3 break-words text-lg font-semibold leading-7 text-white">{compactText(selectedInsight.title, 140)}</h3>
                </div>
                <button type="button" onClick={() => setSelectedId("")} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-cyan-950/30 xl:hidden">Back to list</button>
              </div>
              <PanelTabs mode={panelMode} onChange={setPanelMode} />
              {panelMode === "summary" ? <SummaryPanel insight={selectedInsight} /> : null}
              {panelMode === "evidence" ? <EvidencePanel insight={selectedInsight} /> : null}
            </div>
          ) : <div className="py-8 text-sm leading-6 text-slate-300">Select a finding to review its summary and supporting evidence.</div>}
        </aside>
      </div>
    </section>
  );
}
