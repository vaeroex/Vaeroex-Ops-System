"use client";

import Link from "next/link";
import { MoreHorizontal, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSavedAnalysesAction } from "@/app/app/reports/saved-analysis-actions";
import {
  savedAnalysisTypeLabel,
  type SavedAnalysisListItem,
  type SavedAnalysisType
} from "@/lib/reports/saved-analysis";

type Filter = "all" | SavedAnalysisType;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "executive_brief", label: "Executive Briefs" },
  { value: "business_health", label: "Business Health" },
  { value: "finding_explanation", label: "Finding Explanations" }
];

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function SavedAnalysisList({ analyses }: { analyses: readonly SavedAnalysisListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = useMemo(() => analyses.filter((analysis) => {
    if (filter !== "all" && analysis.analysisType !== filter) return false;
    const search = query.trim().toLowerCase();
    return !search || `${analysis.title} ${savedAnalysisTypeLabel(analysis.analysisType)} ${analysis.evidenceStatus}`.toLowerCase().includes(search);
  }), [analyses, filter, query]);
  const allVisibleSelected = visible.length > 0 && visible.every((analysis) => selected.has(analysis.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      visible.forEach((analysis) => next.add(analysis.id));
      return next;
    });
  }

  function remove(ids: readonly string[]) {
    if (!ids.length || pending) return;
    if (!window.confirm(`Delete ${ids.length} saved ${ids.length === 1 ? "analysis" : "analyses"}? This will not delete the current analysis or its evidence.`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteSavedAnalysesAction(ids);
      setMessage(result.message);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="saved-analyses-heading">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="saved-analyses-heading" className="text-lg font-semibold text-white">Saved Analyses</h2>
          <p className="mt-1 text-sm text-slate-400">Analyses leadership explicitly chose to preserve.</p>
        </div>
        <label className="relative block min-w-0 lg:w-80">
          <span className="sr-only">Search saved analyses</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setSelected(new Set());
            }}
            placeholder="Search saved analyses"
            className="min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/75 py-2 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
          />
        </label>
      </div>

      <div className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1" aria-label="Saved analysis filters">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setFilter(item.value);
              setSelected(new Set());
            }}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3 py-2 text-sm font-semibold ${filter === item.value ? "border-cyan-300/40 bg-cyan-950/35 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-cyan-950/25"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length ? (
        <>
          <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
            <button type="button" onClick={selectAllVisible} disabled={allVisibleSelected} className="text-sm font-semibold text-cyan-200 disabled:text-slate-500">Select all visible</button>
            {selected.size ? <button type="button" onClick={() => setSelected(new Set())} className="text-sm font-semibold text-slate-300">Clear selection</button> : null}
            <span className="text-sm text-slate-400">{selected.size} selected</span>
            {selected.size ? (
              <button type="button" disabled={pending} onClick={() => remove([...selected])} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300/25 px-3 py-2 text-sm font-semibold text-red-200 disabled:opacity-60">
                <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete selected
              </button>
            ) : null}
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {visible.map((analysis) => (
              <article key={analysis.id} className="rounded-lg border border-white/10 bg-[#08111f] p-4 shadow-panel">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(analysis.id)}
                    onChange={() => toggle(analysis.id)}
                    aria-label={`Select ${analysis.title}`}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-cyan-400"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-950/30 px-2.5 py-1 text-[0.68rem] font-semibold text-cyan-100">{savedAnalysisTypeLabel(analysis.analysisType)}</span>
                      <details className="relative">
                        <summary aria-label={`Manage ${analysis.title}`} className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/[0.05]"><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></summary>
                        <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-white/10 bg-[#07111f] p-2 shadow-command">
                          <button type="button" onClick={() => remove([analysis.id])} className="min-h-10 w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-red-200 hover:bg-red-950/40">Delete</button>
                        </div>
                      </details>
                    </div>
                    <h3 className="mt-3 break-words text-lg font-semibold leading-6 text-white">{analysis.title}</h3>
                    <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                      <div><dt className="font-semibold text-slate-300">Generated</dt><dd className="mt-0.5">{readableDate(analysis.generatedAt)}</dd></div>
                      <div><dt className="font-semibold text-slate-300">Saved</dt><dd className="mt-0.5">{readableDate(analysis.savedAt)}</dd></div>
                      <div><dt className="font-semibold text-slate-300">Confidence</dt><dd className="mt-0.5">{analysis.confidence}</dd></div>
                      <div><dt className="font-semibold text-slate-300">Evidence</dt><dd className="mt-0.5">{analysis.evidenceStatus}</dd></div>
                    </dl>
                    {analysis.dateRange ? <p className="mt-2 text-xs text-slate-500">{analysis.dateRange}</p> : null}
                    <Link href={`/app/reports/${analysis.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy">View Analysis</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-white/15 bg-[#08111f] p-6 text-center">
          <h3 className="text-base font-semibold text-white">No saved analyses match this view</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Open a completed Executive Brief, Business Health analysis, or Finding Explanation and choose Save Analysis.</p>
        </div>
      )}
      {message ? <p className="text-sm text-slate-300" role="status">{message}</p> : null}
    </section>
  );
}
