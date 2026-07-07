"use client";

import { useState } from "react";

const intelligenceCapabilities = [
  {
    title: "Executive Intelligence",
    created: "A leadership-level view of what changed, what matters, and what deserves review.",
    evidence: ["Business health", "risk movement", "recommended review areas"],
    outcome: "Leaders get a concise operating read instead of another interface to interpret."
  },
  {
    title: "Business Memory",
    created: "Long-term context that remembers prior signals, imports, decisions, and outcomes.",
    evidence: ["historical context", "source history", "prior recommendations"],
    outcome: "Vaeroex can compare today's activity against what the organization has already shown it."
  },
  {
    title: "Evidence Analysis",
    created: "Source-backed findings from files, operational records, reports, and business signals.",
    evidence: ["uploaded records", "source references", "confidence labels"],
    outcome: "Recommendations stay connected to evidence instead of becoming generic advice."
  },
  {
    title: "KPI Intelligence",
    created: "Meaning from targets, actuals, movement, variance, and historical coverage.",
    evidence: ["target gaps", "trend direction", "period comparisons"],
    outcome: "Leadership can see whether performance movement is meaningful, noisy, or under-supported."
  },
  {
    title: "Performance Intelligence",
    created: "A clearer read on whether the business is improving, weakening, or becoming inconsistent.",
    evidence: ["month-over-month movement", "volatility", "below-target signals"],
    outcome: "Teams can review performance quality without manually stitching reports together."
  },
  {
    title: "Trend Detection",
    created: "Early visibility into repeated patterns and directional changes.",
    evidence: ["recurring signals", "historical comparisons", "data recency"],
    outcome: "Leadership sees movement before it becomes obvious in a monthly review."
  },
  {
    title: "Risk Detection",
    created: "Operational conditions that may become financial, customer, or execution risk.",
    evidence: ["open issues", "response delays", "quality deterioration"],
    outcome: "Vaeroex explains what could matter and why, without pretending to own the response."
  },
  {
    title: "Opportunity Detection",
    created: "Positive movement, underused capacity, and areas where performance may be improving.",
    evidence: ["above-target signals", "stronger conversion", "recovering trends"],
    outcome: "Executives can identify where to lean in, not only what to fix."
  },
  {
    title: "Decision Support",
    created: "Evidence-backed recommendations framed for leadership review.",
    evidence: ["reasoning", "confidence", "data gaps"],
    outcome: "Vaeroex helps leadership decide what to review next."
  },
  {
    title: "Executive Briefings",
    created: "Boardroom-ready summaries of risks, opportunities, evidence, and recommended review areas.",
    evidence: ["findings", "supporting sources", "limitations"],
    outcome: "Leaders can walk into a meeting with a clearer operating picture."
  },
  {
    title: "Business Health",
    created: "A compressed signal of overall condition, direction, risk level, and focus area.",
    evidence: ["KPI movement", "business signals", "recency"],
    outcome: "The first screen answers whether the business is steady, improving, or under pressure."
  },
  {
    title: "Predictive Intelligence",
    created: "Conservative forward-looking insight when enough historical evidence exists.",
    evidence: ["coverage depth", "trend history", "source quality"],
    outcome: "Vaeroex labels uncertainty clearly and refuses to invent forecasts from thin data."
  }
] as const;

const intelligenceLifecycle = [
  {
    title: "Information",
    summary: "Operational activity, files, metrics, reports, and business signals enter Vaeroex.",
    output: "Raw activity becomes available as evidence."
  },
  {
    title: "Visibility",
    summary: "Vaeroex organizes scattered activity so leaders can see the current operating picture.",
    output: "Patterns, gaps, and source context become visible."
  },
  {
    title: "Understanding",
    summary: "Current signals are compared against history, source quality, and business memory.",
    output: "The system explains why a signal may matter."
  },
  {
    title: "Prediction",
    summary: "When evidence is deep enough, Vaeroex estimates likely direction and warns when confidence is limited.",
    output: "Leaders see what may happen next without false certainty."
  },
  {
    title: "Recommendation",
    summary: "Findings become executive recommendations with evidence, reasoning, confidence, and limitations.",
    output: "Leadership gets a clear review path."
  },
  {
    title: "Executive Action",
    summary: "Vaeroex supports decisions by producing briefs, meeting agendas, reports, and improvement plans.",
    output: "The business keeps execution inside its existing systems."
  },
  {
    title: "Continuous Learning",
    summary: "New uploads, outcomes, and signals strengthen Business Memory over time.",
    output: "Future recommendations become more grounded as evidence improves."
  }
] as const;

const executiveSituations = [
  {
    title: "Revenue leakage",
    detects: "Revenue is healthy on the surface, but response delays or conversion movement suggest money may be slipping.",
    explains: "Vaeroex connects revenue, pipeline, response, and historical context.",
    recommends: "Review the sales process evidence and generate an executive revenue-risk brief."
  },
  {
    title: "Customer response delays",
    detects: "Customer activity is increasing while response speed or completion quality declines.",
    explains: "The signal is treated as customer experience risk, not a task list.",
    recommends: "Review the customer response workflow with leadership."
  },
  {
    title: "Operational bottlenecks",
    detects: "Repeated friction appears across files, reports, issues, or business signals.",
    explains: "Vaeroex shows the relationship between delays, source evidence, and business impact.",
    recommends: "Generate an investigation summary for the leadership team."
  },
  {
    title: "Performance decline",
    detects: "KPIs move below target or become volatile over a meaningful period.",
    explains: "The system separates real movement from limited or noisy data.",
    recommends: "Review the underlying evidence and update the executive briefing."
  },
  {
    title: "Compliance gaps",
    detects: "Operational knowledge, review evidence, or procedure coverage appears incomplete.",
    explains: "Vaeroex highlights missing context and evidence limitations.",
    recommends: "Generate a compliance-aware review brief without collecting regulated sensitive data."
  },
  {
    title: "Forecast risk",
    detects: "Current trends suggest a possible future decline, but confidence depends on historical depth.",
    explains: "Vaeroex labels whether there is enough evidence to forecast responsibly.",
    recommends: "Upload more historical data or review a low-confidence forecast note."
  },
  {
    title: "Vendor issues",
    detects: "Repeated supplier, delivery, cost, or quality signals appear across business records.",
    explains: "The signal becomes business context instead of a disconnected note.",
    recommends: "Create a vendor impact summary for leadership review."
  },
  {
    title: "Quality deterioration",
    detects: "Complaints, defects, missed steps, or quality-related signals increase over time.",
    explains: "Vaeroex connects quality movement to operational evidence.",
    recommends: "Generate an improvement plan for discussion."
  },
  {
    title: "Missed follow-ups",
    detects: "Follow-up activity declines or unresolved response signals accumulate.",
    explains: "The issue is framed as operating risk, not work assignment.",
    recommends: "Review the current follow-up process with responsible leadership."
  },
  {
    title: "Decision uncertainty",
    detects: "Leadership has competing signals and incomplete evidence.",
    explains: "Vaeroex separates what is known, what is inferred, and what is missing.",
    recommends: "Generate an executive decision brief with confidence and data gaps."
  }
] as const;

export function OperationsIntelligenceProductExperience() {
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState<number | null>(null);
  const [activeLifecycleIndex, setActiveLifecycleIndex] = useState<number | null>(null);
  const [activeSituationIndex, setActiveSituationIndex] = useState<number | null>(null);

  const activeCapability = activeCapabilityIndex === null ? null : intelligenceCapabilities[activeCapabilityIndex];
  const activeLifecycle = activeLifecycleIndex === null ? null : intelligenceLifecycle[activeLifecycleIndex];
  const activeSituation = activeSituationIndex === null ? null : executiveSituations[activeSituationIndex];

  return (
    <div className="grid gap-10">
      <section id="intelligence-created" className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">What Intelligence It Creates</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Operations activity becomes leadership understanding.</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Select a capability to see the intelligence created, the evidence used, and the outcome leadership receives.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
          {intelligenceCapabilities.map((capability, index) => {
            const isActive = index === activeCapabilityIndex;

            return (
              <button
                key={capability.title}
                type="button"
                onClick={() => setActiveCapabilityIndex(index)}
                className={[
                  "rounded-lg border p-3 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.055] hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">Intelligence</span>
                <h3 className="mt-2 font-semibold text-white">{capability.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-5 text-slate-300">{capability.created}</p>
              </button>
            );
          })}
        </div>

        {activeCapability ? (
          <div className="mt-4 grid gap-4 rounded-lg border border-white/10 bg-[#08111f]/95 p-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Selected Capability</p>
              <h3 className="mt-2 text-xl font-semibold text-white">{activeCapability.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{activeCapability.created}</p>
              <p className="mt-3 rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3 text-sm font-semibold leading-6 text-slate-100">
                {activeCapability.outcome}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Evidence Used</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeCapability.evidence.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-[#0d1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section id="how-it-works" className="rounded-xl border border-white/10 bg-[#050b18] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">How It Works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">The Operations Intelligence lifecycle.</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Vaeroex converts activity into visibility, understanding, prediction, recommendations, and executive action.
          </p>
        </div>

        <div className="mt-5 hidden gap-2 lg:grid lg:grid-cols-7">
          {intelligenceLifecycle.map((stage, index) => {
            const isActive = index === activeLifecycleIndex;

            return (
              <button
                key={stage.title}
                type="button"
                onClick={() => setActiveLifecycleIndex(index)}
                className={[
                  "rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white" : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block text-sm font-semibold">{stage.title}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:hidden">
          {intelligenceLifecycle.map((stage, index) => {
            const isActive = index === activeLifecycleIndex;

            return (
              <button
                key={stage.title}
                type="button"
                onClick={() => setActiveLifecycleIndex(index)}
                className={[
                  "flex items-center justify-between rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white" : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="font-semibold">{stage.title}</span>
                <span className="text-xs font-semibold text-vaeroex-accent">{String(index + 1).padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>

        {activeLifecycle ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-white/[0.055] p-4 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Selected Stage</p>
              <h3 className="mt-2 text-xl font-semibold text-white">{activeLifecycle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{activeLifecycle.summary}</p>
            </div>
            <div className="rounded-lg border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-sm font-semibold leading-6 text-slate-100">
              {activeLifecycle.output}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Business Situations</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Real conditions Operations Intelligence helps leadership understand.</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-300">
            Select a situation to see how Vaeroex detects, explains, and frames it for leadership review.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {executiveSituations.map((situation, index) => {
            const isActive = index === activeSituationIndex;

            return (
              <button
                key={situation.title}
                type="button"
                onClick={() => setActiveSituationIndex(index)}
                className={[
                  "rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive ? "border-vaeroex-accent/70 bg-vaeroex-accent/10" : "border-white/10 bg-white/[0.055] hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">Situation</span>
                <h3 className="mt-2 font-semibold text-white">{situation.title}</h3>
              </button>
            );
          })}
        </div>

        {activeSituation ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-[#08111f]/95 p-4 lg:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Detects</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{activeSituation.detects}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Explains</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{activeSituation.explains}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Executive Recommendation</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">{activeSituation.recommends}</p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
