"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

const engineScenarios = [
  {
    title: "Business Health Score",
    signal: "92 / 100",
    summary: "Leadership signal combining performance, risk, evidence, and operational movement.",
    flow: ["Business Health Score", "Trend detected", "Source gap identified", "Recommendation generated"],
    output: "Review sales pipeline response quality and decide whether an executive brief is needed."
  },
  {
    title: "Profit Leak",
    signal: "7 items",
    summary: "Response gaps, unresolved issues, and stalled recovery patterns become visible.",
    flow: ["Issue detected", "Context matched", "Impact estimated", "Review output suggested"],
    output: "Generate an investigation summary or improvement plan for leadership review."
  },
  {
    title: "Customer Pipeline",
    signal: "Review needed",
    summary: "Pipeline risk is connected to response quality, conversion movement, and evidence.",
    flow: ["Risk surfaced", "Evidence linked", "Confidence scored", "Decision framed"],
    output: "Review the lead source trend and generate an executive brief if needed."
  }
] as const;

export function OperationsIntelligenceEngineDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = engineScenarios[activeIndex];

  return (
    <div className="rounded-xl border border-white/15 bg-[#08111f]/95 p-4 shadow-command">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence Engine Preview</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Operations signals becoming intelligence</h2>
        </div>
        <span className="rounded-full border border-vaeroex-accent/35 bg-vaeroex-accent/10 px-3 py-1 text-xs font-semibold text-vaeroex-accent">Live flow</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {engineScenarios.map((scenario, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={scenario.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={[
                "rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.06] hover:border-vaeroex-accent/40"
              ].join(" ")}
              aria-pressed={isActive}
              title={scenario.summary}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{scenario.title}</p>
              <p className="mt-2 text-2xl font-semibold text-vaeroex-accent">{scenario.signal}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{scenario.summary}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.2fr_1fr] lg:items-stretch">
        <section className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Selected Signal</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{active.title}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-300">{active.summary}</p>
        </section>

        <div className="relative min-h-20 rounded-lg border border-white/10 bg-white/[0.04]">
          <div className="vaeroex-signal-stream absolute inset-x-6 top-1/2 h-px -translate-y-1/2 lg:inset-x-1/2 lg:inset-y-6 lg:h-auto lg:w-px lg:-translate-x-1/2 lg:translate-y-0" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <section className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Generated Intelligence</p>
          <div className="mt-3 grid gap-2">
            {active.flow.map((step, index) => (
              <div key={step} className="vaeroex-signal-chip rounded-lg border border-white/10 bg-[#0d1728] px-3 py-2 text-sm font-semibold text-slate-100" style={{ "--signal-delay": `${index * 110}ms` } as CSSProperties}>
                {step}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-400/10 p-4 text-sm font-semibold leading-6 text-amber-100">
            {active.output}
          </div>
        </section>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-400">Illustrative product preview only. Actual workspace results depend on customer data and configuration.</p>
    </div>
  );
}
