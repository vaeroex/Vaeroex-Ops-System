"use client";

import { useState } from "react";

const intelligenceStages = [
  {
    title: "Information",
    short: "Signals enter Vaeroex.",
    description: "Raw records, updates, events, activity, and observations are captured as structured inputs.",
    input: "Signals, records, events, updates",
    processing: "Captured and prepared for visibility",
    output: "Incoming activity becomes organized context",
    examples: ["Report received", "KPI updated", "New event recorded"]
  },
  {
    title: "Visibility",
    short: "Activity becomes clear.",
    description: "Vaeroex organizes what is happening so important changes, ownership, and movement are easier to see.",
    input: "Grouped signals and current state",
    processing: "Patterns, owners, and trends are surfaced",
    output: "Pattern identified",
    examples: ["Ownership located", "Risk surfaced", "Trend detected"]
  },
  {
    title: "Understanding",
    short: "Context explains meaning.",
    description: "Current signals are compared against history, context, relationships, and prior outcomes.",
    input: "Visible patterns and workspace history",
    processing: "Context is matched against prior decisions and outcomes",
    output: "Cause and relationship clarified",
    examples: ["Historical match found", "Cause identified", "Context retrieved"]
  },
  {
    title: "Prediction",
    short: "Direction becomes visible.",
    description: "Vaeroex surfaces likely movement, emerging risk, and opportunities before they become obvious.",
    input: "Context plus directional movement",
    processing: "Likely outcomes and priority changes are estimated",
    output: "Emerging risk or opportunity identified",
    examples: ["Priority increasing", "Likely outcome estimated", "Opportunity detected"]
  },
  {
    title: "Action",
    short: "Intelligence becomes execution.",
    description: "Useful intelligence becomes reviewable decisions, ownership, follow-up, and measured outcomes.",
    input: "Prediction, priority, and context",
    processing: "Recommendations and ownership paths are prepared",
    output: "Recommendation generated",
    examples: ["Decision required", "Ownership assigned", "Outcome tracked"]
  }
] as const;

export function IntelligenceFlowDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStage = intelligenceStages[activeIndex];
  const stageProgress = `${(activeIndex / (intelligenceStages.length - 1)) * 100}%`;

  return (
    <div className="vaeroex-intelligence-flow vaeroex-intelligence-flow-lite relative overflow-hidden rounded-xl border border-white/10 bg-[#08111f]/95 p-4 shadow-command sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(56,189,248,0.16),transparent_30%),radial-gradient(circle_at_82%_72%,rgba(124,58,237,0.14),transparent_34%)]" />
      <div className="relative grid gap-6">
        <div className="relative">
          <div className="pointer-events-none absolute left-[9%] right-[9%] top-5 hidden h-px bg-white/10 lg:block" aria-hidden="true">
            <span className="block h-px bg-gradient-to-r from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 transition-[width] duration-300 ease-out" style={{ width: stageProgress }} />
          </div>

          <div className="relative z-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Interactive intelligence flow stages">
            {intelligenceStages.map((stage, index) => {
              const isActive = index === activeIndex;
              const isComplete = index < activeIndex;

              return (
                <button
                  key={stage.title}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={[
                    "min-h-28 rounded-lg border p-4 text-left transition duration-200 focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 shadow-[0_0_22px_rgba(56,189,248,0.18)]"
                      : isComplete
                        ? "border-vaeroex-blue/35 bg-vaeroex-blue/10"
                        : "border-white/10 bg-white/[0.055] hover:border-vaeroex-accent/40 hover:bg-white/[0.08]"
                  ].join(" ")}
                  aria-pressed={isActive}
                  title={stage.description}
                >
                  <span
                    className={[
                      "grid h-9 w-9 place-items-center rounded-full border text-xs font-semibold",
                      isActive
                        ? "border-vaeroex-accent bg-vaeroex-accent text-vaeroex-navy"
                        : isComplete
                          ? "border-vaeroex-blue bg-vaeroex-blue text-white"
                          : "border-white/15 bg-[#0d1728] text-slate-300"
                    ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <span className="mt-4 block text-sm font-semibold text-white">{stage.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">{stage.short}</span>
                </button>
              );
            })}
          </div>
        </div>

        <section className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Selected Stage: {activeStage.title}</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">Intelligence Output</h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{activeStage.description}</p>
            </div>
            <span className="w-fit rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
              Click or hover
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-[#0d1728] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Input</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">{activeStage.input}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0d1728] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Processing</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">{activeStage.processing}</p>
            </div>
            <div className="rounded-lg border border-vaeroex-accent/30 bg-vaeroex-accent/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">Output</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">{activeStage.output}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-full border border-white/10 bg-white/[0.06] p-1">
            <div className="relative h-1.5 rounded-full bg-white/10">
              <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 transition-[width] duration-300 ease-out" style={{ width: stageProgress }} />
              <span className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-vaeroex-accent shadow-[0_0_14px_rgba(56,189,248,0.55)]" style={{ left: stageProgress }} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeStage.examples.map((example) => (
              <span key={example} className="rounded-full border border-vaeroex-blue/25 bg-vaeroex-blue/10 px-3 py-1.5 text-xs font-semibold text-slate-100">
                {example}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
