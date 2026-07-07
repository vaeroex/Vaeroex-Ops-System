"use client";

import { useState } from "react";

const signalExamples = [
  {
    title: "Signal Confidence",
    description: "A detected pattern is scored so leaders know how strongly Vaeroex sees the signal.",
    steps: ["Signal detected", "Confidence calculated", "Context matched", "Recommendation generated"],
    output: "Review the confidence score before deciding whether to act."
  },
  {
    title: "Risk Surface",
    description: "Changing conditions are organized into risk signals that need review.",
    steps: ["Risk detected", "Exposure grouped", "Evidence linked", "Review suggested"],
    output: "Risk is no longer buried inside disconnected updates."
  },
  {
    title: "Anomaly Pattern",
    description: "Vaeroex highlights activity that differs from expected movement.",
    steps: ["Deviation detected", "Baseline compared", "Impact estimated", "Review recommended"],
    output: "A potential issue becomes visible before it becomes normal."
  },
  {
    title: "Context Match",
    description: "A current signal is matched against prior history, decisions, and outcomes.",
    steps: ["Context retrieved", "History matched", "Pattern connected", "Meaning summarized"],
    output: "Teams can see why the current signal matters."
  },
  {
    title: "Decision Point",
    description: "A moment requiring review becomes clear enough for leadership to act.",
    steps: ["Threshold reached", "Options surfaced", "Decision required", "Next step prepared"],
    output: "Vaeroex turns ambiguity into a reviewable decision."
  },
  {
    title: "Review Path",
    description: "A recommended response is turned into a reviewable executive output.",
    steps: ["Recommendation generated", "Evidence summarized", "Confidence labeled", "Output prepared"],
    output: "Insight becomes a leadership decision instead of another note."
  },
  {
    title: "Source Context",
    description: "Unclear source data is surfaced so leaders can review the underlying workflow.",
    steps: ["Signal identified", "Context checked", "Gap surfaced", "Review prepared"],
    output: "Accountability becomes visible without Vaeroex replacing the execution system."
  },
  {
    title: "Outcome Signal",
    description: "After action is taken, Vaeroex keeps track of whether conditions improved.",
    steps: ["Outcome captured", "Movement compared", "Impact summarized", "Next review queued"],
    output: "The system learns from what happened after action."
  }
] as const;

export function SignalProductionDemo() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeSignal = activeIndex === null ? null : signalExamples[activeIndex];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {signalExamples.map((signal, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={signal.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={[
                "vaeroex-hover-card rounded-lg border p-3 text-left shadow-command transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.06]"
              ].join(" ")}
              aria-pressed={isActive}
              title={signal.description}
            >
              <span className="inline-flex rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                Signal
              </span>
              <h3 className="mt-3 font-semibold text-white">{signal.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-300">{signal.description}</p>
            </button>
          );
        })}
      </div>

      {activeSignal ? (
        <section className="vaeroex-intelligence-flow grid gap-4 rounded-lg border border-white/10 bg-[#08111f]/95 p-4 shadow-command lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Signal Production</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{activeSignal.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{activeSignal.description}</p>
          </div>

          <div>
            <div className="flex flex-wrap gap-2">
              {activeSignal.steps.map((step) => (
                <span key={step} className="rounded-full border border-white/10 bg-[#0d1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                  {step}
                </span>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-vaeroex-accent/30 bg-vaeroex-accent/10 p-3 text-sm font-semibold leading-6 text-slate-100">
              {activeSignal.output}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
