"use client";

import { useState } from "react";

type IntelligenceLoopShowcaseProps = {
  steps: ReadonlyArray<readonly [string, string]>;
};

const stageOutcomes: Record<string, string> = {
  Capture: "Signals, files, events, and observations enter the intelligence layer.",
  Remember: "Relevant history is preserved so context does not reset.",
  Analyze: "Patterns, risks, anomalies, and relationships become visible.",
  Predict: "Vaeroex estimates likely movement only when the evidence supports it.",
  Prioritize: "The most important risks, opportunities, and decisions move forward.",
  Execute: "Leadership receives review-ready intelligence and supporting outputs.",
  Measure: "Outcomes are compared over time so future intelligence improves."
};

export function IntelligenceLoopShowcase({ steps }: IntelligenceLoopShowcaseProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex === null ? null : steps[activeIndex];

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#08111f]/90 p-4 shadow-command">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_24%,rgba(56,189,248,0.12),transparent_30%),radial-gradient(circle_at_18%_78%,rgba(168,85,247,0.1),transparent_32%)]" />
      <div className="relative">
        <div className="hidden gap-2 lg:grid lg:grid-cols-7">
          {steps.map(([title], index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={title}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={[
                  "rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white shadow-[0_0_22px_rgba(56,189,248,0.16)]" : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block text-sm font-semibold">{title}</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 lg:hidden">
          {steps.map(([title], index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={title}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={[
                  "flex items-center justify-between rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white" : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="font-semibold">{title}</span>
                <span className="text-xs font-semibold text-vaeroex-accent">{String(index + 1).padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>

        {active ? (
          <section className="mt-4 rounded-lg border border-white/10 bg-white/[0.055] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Selected Stage</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{active[0]}</h3>
              </div>
              <span className="inline-flex w-fit rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-3 py-1 text-xs font-semibold text-vaeroex-accent">
                {(activeIndex ?? 0) + 1} of {steps.length}
              </span>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
              <p className="text-sm leading-6 text-slate-300">{active[1]}</p>
              <div className="rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3 text-sm font-semibold leading-6 text-slate-100">
                {stageOutcomes[active[0]]}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
