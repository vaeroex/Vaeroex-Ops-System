"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

const intelligenceStages = [
  {
    title: "Information",
    short: "Raw signals enter Vaeroex.",
    description: "Signals, records, activity, updates, and events begin as scattered information.",
    items: ["Report received", "New activity detected", "KPI updated", "Asset status changed", "New event recorded"],
    transfer: "Signals moving into Visibility"
  },
  {
    title: "Visibility",
    short: "Signals organize into a clearer view.",
    description: "Vaeroex structures what is happening so important changes are easier to see.",
    items: ["Pattern identified", "Ownership located", "Risk surfaced", "Trend detected"],
    transfer: "Visibility moving into Understanding"
  },
  {
    title: "Understanding",
    short: "Context explains why it matters.",
    description: "Current signals are compared against history, context, relationships, and prior outcomes.",
    items: ["Historical match found", "Cause identified", "Correlation detected", "Context retrieved"],
    transfer: "Understanding moving into Prediction"
  },
  {
    title: "Prediction",
    short: "Forward-looking intelligence takes shape.",
    description: "Vaeroex surfaces what may happen next so leaders can review risk and opportunity sooner.",
    items: ["Emerging risk identified", "Opportunity detected", "Likely outcome estimated", "Priority increasing"],
    transfer: "Prediction moving into Action"
  },
  {
    title: "Action",
    short: "Intelligence becomes execution.",
    description: "Useful intelligence becomes decisions, ownership, follow-up, and measured outcomes.",
    items: ["Recommendation generated", "Decision required", "Ownership assigned", "Follow-up scheduled", "Outcome tracked"],
    transfer: "Action output ready for review"
  }
] as const;

export function IntelligenceFlowDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStage = intelligenceStages[activeIndex];
  const nextStage = intelligenceStages[activeIndex + 1];
  const stageProgress = `${(activeIndex / (intelligenceStages.length - 1)) * 100}%`;

  return (
    <div className="vaeroex-intelligence-flow relative overflow-hidden rounded-xl border border-white/10 bg-[#08111f]/95 p-4 shadow-command sm:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(56,189,248,0.22),transparent_28%),radial-gradient(circle_at_82%_72%,rgba(124,58,237,0.20),transparent_32%)]" />
      <div className="relative grid gap-5">
        <div className="relative" style={{ "--stage-progress": stageProgress } as CSSProperties}>
          <div className="pointer-events-none absolute left-[10%] right-[10%] top-7 hidden h-px bg-white/10 lg:block">
            <span className="block h-px bg-gradient-to-r from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 transition-[width] duration-500 ease-out" style={{ width: stageProgress }} />
            <span className="vaeroex-stage-stream absolute inset-0" aria-hidden="true">
              <span />
              <span />
            </span>
          </div>
          <div className="relative z-10 grid gap-3 lg:grid-cols-5" aria-label="Interactive intelligence flow stages">
            {intelligenceStages.map((stage, index) => {
              const isActive = index === activeIndex;
              const isComplete = index < activeIndex;

              return (
                <button
                  key={stage.title}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={[
                    "group relative rounded-lg border p-3 text-left transition duration-200 focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 shadow-[0_0_34px_rgba(56,189,248,0.26)]"
                      : isComplete
                        ? "border-vaeroex-blue/40 bg-vaeroex-blue/10"
                        : "border-white/10 bg-white/[0.055] hover:border-vaeroex-accent/45 hover:bg-white/[0.08]"
                  ].join(" ")}
                  aria-pressed={isActive}
                  title={stage.description}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={[
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                        isActive
                          ? "border-vaeroex-accent bg-vaeroex-accent text-vaeroex-navy"
                          : isComplete
                            ? "border-vaeroex-blue bg-vaeroex-blue text-white"
                            : "border-white/15 bg-white/5 text-slate-300"
                      ].join(" ")}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-white">{stage.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{stage.short}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.42fr_1fr] lg:items-stretch">
          <section className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">{activeStage.title}</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Intelligence being generated</h3>
              </div>
              <span className="rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                Live flow
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{activeStage.description}</p>
            <div className="mt-4 grid gap-2">
              {activeStage.items.map((item, index) => (
                <div
                  key={item}
                  className="vaeroex-signal-chip flex items-center gap-2 rounded-lg border border-white/10 bg-[#0d1728] px-3 py-2 text-sm font-semibold text-slate-100"
                  style={{ "--signal-delay": `${index * 90}ms` } as CSSProperties}
                >
                  <span className="h-2 w-2 rounded-full bg-vaeroex-accent shadow-[0_0_14px_rgba(56,189,248,0.85)]" />
                  {item}
                </div>
              ))}
            </div>
          </section>

          <div className="relative min-h-24 rounded-lg border border-white/10 bg-white/[0.04] p-4 lg:min-h-full">
            <div className="absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 lg:inset-x-1/2 lg:inset-y-6 lg:h-auto lg:w-px lg:-translate-x-1/2 lg:translate-y-0 lg:bg-gradient-to-b" />
            <div className="vaeroex-signal-stream absolute inset-x-6 top-1/2 h-px -translate-y-1/2 lg:inset-x-1/2 lg:inset-y-6 lg:h-auto lg:w-px lg:-translate-x-1/2 lg:translate-y-0" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="relative z-10 flex h-full min-h-20 items-center justify-center text-center">
              <div className="rounded-full border border-vaeroex-accent/40 bg-vaeroex-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent shadow-[0_0_28px_rgba(56,189,248,0.18)]">
                {activeStage.transfer}
              </div>
            </div>
          </div>

          <section className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">
              {nextStage ? `Next: ${nextStage.title}` : "Execution Output"}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {nextStage ? "What Vaeroex generates next" : "Ready for review and follow-through"}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {nextStage ? nextStage.description : "The intelligence has moved through the flow and is ready to support action, ownership, and outcomes."}
            </p>
            <div className="mt-4 grid gap-2">
              {(nextStage?.items || activeStage.items).slice(0, 4).map((item) => (
                <div key={item} className="rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 px-3 py-2 text-sm font-semibold text-slate-100">
                  {item}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
