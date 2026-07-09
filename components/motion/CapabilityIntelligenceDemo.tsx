"use client";

import { useState } from "react";

const capabilities = [
  {
    title: "Visibility",
    status: "Current",
    summary: "Structure scattered signals into a clearer view of what is happening.",
    generated: ["Signals grouped", "Source mapped", "Priority surfaced", "Current state summarized"],
    examples: ["Open items", "KPI movement", "activity changes", "source gaps"],
    relationship: "Connects raw information to what leaders can actually see."
  },
  {
    title: "Context Memory",
    status: "Current",
    summary: "Preserve relevant history so current signals can be understood against prior outcomes.",
    generated: ["Prior record found", "Past decision retrieved", "Outcome compared", "Context attached"],
    examples: ["previous reports", "import history", "old risks", "resolved issues"],
    relationship: "Connects today's signal to what happened before."
  },
  {
    title: "Risk Detection",
    status: "Current",
    summary: "Surface changing conditions, repeated friction, unresolved signals, and emerging exposure.",
    generated: ["Risk pattern detected", "Severity estimated", "Affected area found", "Review path suggested"],
    examples: ["response gaps", "open issues", "delayed signals", "below-target metrics"],
    relationship: "Connects changes to the risk they may create."
  },
  {
    title: "Predictive Insight",
    status: "Current",
    summary: "Identify directional movement and early indicators that may require review or response.",
    generated: ["Trend direction read", "Future condition estimated", "Confidence adjusted", "Priority changed"],
    examples: ["declining conversion", "rising response time", "increasing complaints", "capacity pressure"],
    relationship: "Connects current movement to what may happen next."
  },
  {
    title: "Decision Support",
    status: "Current",
    summary: "Turn context into review-ready recommendations, priorities, and next-step options.",
    generated: ["Options generated", "Tradeoff framed", "Evidence summarized", "Decision framed"],
    examples: ["review items", "executive recommendations", "supporting outputs", "leadership decisions"],
    relationship: "Connects intelligence to human review."
  },
  {
    title: "Source Evidence",
    status: "Current",
    summary: "Clarify source context, unresolved signals, and review status.",
    generated: ["Source located", "Gap identified", "Review prepared", "Outcome compared"],
    examples: ["shared reports", "unresolved signals", "response gaps", "leadership review"],
    relationship: "Connects intelligence to evidence and leadership review."
  },
  {
    title: "Performance Intelligence",
    status: "Current",
    summary: "Compare outcomes, targets, movement, and signal quality over time.",
    generated: ["Target compared", "Period matched", "Movement scored", "Variance explained"],
    examples: ["monthly trends", "KPI targets", "YTD performance", "period comparisons"],
    relationship: "Connects measurements to meaning."
  },
  {
    title: "Operational Intelligence",
    status: "Current",
    summary: "Apply intelligence to operational reviews, recurring decisions, and source evidence.",
    generated: ["Source signal read", "Pattern found", "Process context matched", "Output suggested"],
    examples: ["SOP reviews", "checklist misses", "source drift", "operating reports"],
    relationship: "Connects daily work to the intelligence layer."
  },
  {
    title: "Asset Intelligence",
    status: "Platform direction",
    summary: "Apply intelligence to assets, equipment, systems, reliability, and environmental signals.",
    generated: ["Asset signal read", "Status compared", "Reliability context attached", "Review suggested"],
    examples: ["equipment status", "maintenance logs", "reliability signals", "environmental changes"],
    relationship: "An area where intelligence can be applied over time."
  },
  {
    title: "Situational Awareness",
    status: "Platform direction",
    summary: "Help teams understand context, risk, alerts, and priorities across changing environments.",
    generated: ["Situation updated", "Signals correlated", "Risk level adjusted", "Response path surfaced"],
    examples: ["alerts", "events", "risk changes", "priority shifts"],
    relationship: "An area where intelligence can support faster awareness."
  }
] as const;

export function CapabilityIntelligenceDemo() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const visibleCapabilities = capabilities.filter((capability) => capability.status === "Current");
  const active = activeIndex === null ? null : visibleCapabilities[activeIndex];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {visibleCapabilities.map((capability, index) => {
          const isActive = index === activeIndex;

          return (
            <button
              key={capability.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={[
                "vaeroex-hover-card rounded-lg border p-3 text-left shadow-command backdrop-blur transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.055]"
              ].join(" ")}
              aria-pressed={isActive}
              title={capability.summary}
            >
              <h3 className="font-semibold text-white">{capability.title}</h3>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-300">{capability.summary}</p>
            </button>
          );
        })}
      </div>

      {active ? (
        <section className="vaeroex-intelligence-flow grid gap-4 rounded-lg border border-white/10 bg-[#08111f]/95 p-4 shadow-command lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Selected Capability</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{active.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{active.summary}</p>
            <div className="mt-3 rounded-lg border border-vaeroex-accent/30 bg-vaeroex-accent/10 p-3 text-sm font-semibold leading-6 text-slate-100">
              {active.relationship}
            </div>
          </div>

          <div className="grid gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Generation Flow</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {active.generated.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-[#0d1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Context Relationships</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {active.examples.map((item) => (
                  <span key={item} className="rounded-full border border-vaeroex-blue/25 bg-vaeroex-blue/10 px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
