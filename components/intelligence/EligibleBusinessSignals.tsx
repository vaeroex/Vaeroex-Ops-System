"use client";

import { ChevronRight, Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { EligibleBusinessSignalCategory } from "@/lib/intelligence/layer";

const EXPLANATION = "Eligible Business Signals are the approved pieces of business information Vaeroex can currently use to understand your organization. More signals can provide broader context, but relevance and quality matter more than quantity.";

type EligibleBusinessSignalsProps = {
  total: number;
  categories: readonly EligibleBusinessSignalCategory[];
};

export function EligibleBusinessSignals({ total, categories }: EligibleBusinessSignalsProps) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const explanationId = useId();
  const breakdownId = useId();
  const breakdownTitleId = useId();
  const countButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const visibleCategories = categories.filter((category) => category.count > 0);

  useEffect(() => {
    if (!breakdownOpen) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBreakdownOpen(false);
      countButtonRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [breakdownOpen]);

  return (
    <div className="relative mt-1 flex items-center justify-end gap-1 sm:justify-end" data-eligible-business-signals>
      <button
        ref={countButtonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={breakdownOpen}
        aria-controls={breakdownOpen ? breakdownId : undefined}
        aria-label={`View breakdown of ${total} eligible Business Signals`}
        onClick={() => {
          setBreakdownOpen((open) => !open);
          setExplanationOpen(false);
        }}
        className="group inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-slate-300 transition hover:bg-cyan-950/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <span>{total} eligible signal{total === 1 ? "" : "s"}</span>
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </button>
      <div
        className="relative"
        onPointerEnter={() => setExplanationOpen(true)}
        onPointerLeave={() => setExplanationOpen(false)}
      >
        <button
          type="button"
          aria-label="About eligible Business Signals"
          aria-describedby={explanationOpen ? explanationId : undefined}
          onFocus={() => setExplanationOpen(true)}
          onBlur={() => setExplanationOpen(false)}
          onClick={() => {
            setExplanationOpen(true);
            setBreakdownOpen(false);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-cyan-950/60 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <Info aria-hidden="true" className="h-4 w-4" />
        </button>
        {explanationOpen ? (
          <div
            id={explanationId}
            role="tooltip"
            className="absolute right-0 top-9 z-30 w-[min(19rem,calc(100vw-2rem))] rounded-lg border border-cyan-200/20 bg-[#0f1f38] p-3 text-left text-xs font-normal leading-5 text-slate-200 shadow-command"
          >
            {EXPLANATION}
          </div>
        ) : null}
      </div>

      {breakdownOpen ? (
        <div
          id={breakdownId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={breakdownTitleId}
          className="absolute right-0 top-11 z-20 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-cyan-200/20 bg-[#0f1f38] p-4 text-left text-slate-100 shadow-command"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id={breakdownTitleId} className="text-sm font-semibold text-white">Eligible Business Signals</h3>
              <p className="mt-1 text-2xl font-semibold text-white">{total}</p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close eligible Business Signals breakdown"
              onClick={() => {
                setBreakdownOpen(false);
                countButtonRef.current?.focus();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-cyan-950/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          {visibleCategories.length ? (
            <dl className="mt-3 divide-y divide-white/10 border-t border-white/10">
              {visibleCategories.map((category) => (
                <div key={category.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <dt className="text-slate-300">{category.label}</dt>
                  <dd className="font-semibold text-white">{category.count}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-slate-300">No eligible Business Signals are available yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
