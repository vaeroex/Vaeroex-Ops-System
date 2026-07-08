"use client";

import { useState } from "react";

const engineScenarios = [
  {
    title: "Business Health",
    metric: "92 / 100",
    question: "Is the business healthy or hiding risk?",
    problem: "Revenue is strong, but customer response quality is weakening.",
    evidence: "KPI movement, response-time history, customer notes, and Business Memory.",
    result: "Vaeroex surfaces a healthy score with a clear review area: customer response quality."
  },
  {
    title: "Profit Leak",
    metric: "7 signals",
    question: "Where could money be slipping away?",
    problem: "Response gaps and unresolved issues are increasing across recent records.",
    evidence: "Issue themes, customer friction, delayed responses, and recovery patterns.",
    result: "Vaeroex frames the pattern as revenue risk, not as another task list."
  },
  {
    title: "Customer Risk",
    metric: "Review needed",
    question: "What should leadership look at first?",
    problem: "Lead quality is stable, but conversion pressure is rising.",
    evidence: "Pipeline movement, response timing, conversion trend, and source confidence.",
    result: "Vaeroex recommends an executive review before the trend becomes a revenue problem."
  }
] as const;

export function OperationsIntelligenceEngineDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = engineScenarios[activeIndex] ?? engineScenarios[0];

  return (
    <div className="rounded-xl border border-white/15 bg-[#08111f]/95 p-4 shadow-command">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Live Example</p>
          <h2 className="mt-1 text-xl font-semibold text-white">One question. One operating story.</h2>
        </div>
        <p className="max-w-xs text-sm leading-5 text-slate-300">
          Select what leadership wants to understand.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {engineScenarios.map((scenario, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={scenario.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={[
                "inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                isActive
                  ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white"
                  : "border-white/10 bg-white/[0.06] text-slate-300 hover:border-vaeroex-accent/40 hover:bg-vaeroex-blue/10 hover:text-white"
              ].join(" ")}
              aria-pressed={isActive}
            >
              {scenario.title}
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05]">
        <div className="border-b border-white/10 p-4">
          <p className="text-sm font-semibold text-vaeroex-accent">{active.question}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{active.metric}</p>
        </div>
        <div className="divide-y divide-white/10">
          <PreviewRow label="Problem" value={active.problem} />
          <PreviewRow label="Evidence" value={active.evidence} />
          <PreviewRow label="Leadership result" value={active.result} emphasized />
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-400">Illustrative product preview only. Actual workspace results depend on customer data and configuration.</p>
    </div>
  );
}

function PreviewRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="grid gap-1 p-3 sm:grid-cols-[0.34fr_0.66fr]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">{label}</p>
      <p className={["text-sm leading-6", emphasized ? "font-semibold text-white" : "text-slate-200"].join(" ")}>{value}</p>
    </div>
  );
}
