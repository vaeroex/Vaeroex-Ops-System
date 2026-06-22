"use client";

import type { CSSProperties } from "react";
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
    steps: ["Risk detected", "Exposure grouped", "Owner located", "Escalation suggested"],
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
    title: "Action Path",
    description: "A recommended response is connected to ownership and follow-through.",
    steps: ["Action generated", "Owner suggested", "Due path created", "Outcome tracked"],
    output: "Insight becomes execution instead of another note."
  },
  {
    title: "Ownership Signal",
    description: "Responsibility is identified so unresolved work does not drift.",
    steps: ["Role identified", "Owner located", "Gap surfaced", "Assignment prepared"],
    output: "Accountability becomes part of the intelligence flow."
  },
  {
    title: "Outcome Signal",
    description: "After action is taken, Vaeroex keeps track of whether conditions improved.",
    steps: ["Outcome captured", "Movement compared", "Impact summarized", "Next review queued"],
    output: "The system learns from what happened after action."
  }
] as const;

export function SignalProductionDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSignal = signalExamples[activeIndex];

  return (
    <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
      <div className="grid gap-3 sm:grid-cols-2">
        {signalExamples.map((signal, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={signal.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={[
                "vaeroex-hover-card rounded-lg border p-4 text-left shadow-command transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.06]"
              ].join(" ")}
              aria-pressed={isActive}
              title={signal.description}
            >
              <span className="inline-flex rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                Signal
              </span>
              <h3 className="mt-4 font-semibold text-white">{signal.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{signal.description}</p>
            </button>
          );
        })}
      </div>

      <section className="vaeroex-intelligence-flow rounded-xl border border-white/10 bg-[#08111f]/95 p-5 shadow-command">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Signal Production</p>
        <h3 className="mt-2 text-2xl font-semibold text-white">{activeSignal.title}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-300">{activeSignal.description}</p>
        <div className="mt-5 grid gap-3">
          {activeSignal.steps.map((step, index) => (
            <div key={step} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="vaeroex-signal-chip rounded-lg border border-white/10 bg-[#0d1728] px-3 py-2 text-sm font-semibold text-slate-100" style={{ "--signal-delay": `${index * 100}ms` } as CSSProperties}>
                {step}
              </div>
              {index < activeSignal.steps.length - 1 ? (
                <span className="hidden h-px w-12 bg-gradient-to-r from-vaeroex-blue to-vaeroex-accent sm:block">
                  <span className="vaeroex-flow-dot relative block h-1.5 w-1.5 -translate-y-[3px] rounded-full bg-vaeroex-accent shadow-[0_0_16px_rgba(56,189,248,0.8)]" />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-vaeroex-accent/30 bg-vaeroex-accent/10 p-4 text-sm font-semibold leading-6 text-slate-100">
          {activeSignal.output}
        </div>
      </section>
    </div>
  );
}
