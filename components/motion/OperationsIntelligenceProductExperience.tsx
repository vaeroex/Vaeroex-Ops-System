"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Brain,
  Database,
  Gauge,
  Lightbulb,
  Radar,
  Search,
  ShieldAlert,
  Target,
  TrendingUp,
  Workflow,
  Zap
} from "lucide-react";

type Confidence = "High" | "Medium" | "Developing";

type Pillar = {
  number: string;
  title: string;
  promise: string;
  icon: LucideIcon;
  howItWorks: string;
  memory: string;
  evidence: string[];
  example: string;
  outcome: string;
  recommendation: string;
  confidence: Confidence;
};

type LifecycleStage = {
  title: string;
  plainLanguage: string;
  icon: LucideIcon;
  inputs: string[];
  processing: string;
  output: string;
  leadershipResult: string;
};

type BusinessArea = {
  title: string;
  question: string;
  icon: LucideIcon;
  problem: string;
  evidence: string[];
  patterns: string[];
  memory: string;
  recommendation: string;
  leadershipReview: string;
  confidence: Confidence;
};

const pillars: Pillar[] = [
  {
    number: "1",
    title: "Understand",
    promise: "See what is happening.",
    icon: Search,
    howItWorks: "Vaeroex organizes scattered operating activity into a clear leadership view.",
    memory: "Business Memory compares current activity with prior imports, signals, and reviews so leaders can see whether a condition is new or recurring.",
    evidence: ["recent metrics", "uploaded files", "business signals", "prior briefings"],
    example: "Revenue is above target, but customer response time has worsened for two periods.",
    outcome: "Leadership gets a faster read on the operating picture without opening five different systems.",
    recommendation: "Review the customer response evidence before assuming revenue growth is structurally healthy.",
    confidence: "High"
  },
  {
    number: "2",
    title: "Explain",
    promise: "Understand why it is happening.",
    icon: Brain,
    howItWorks: "Vaeroex connects the visible condition to supporting evidence, context, and possible causes.",
    memory: "Business Memory helps distinguish a one-time event from a pattern the organization has seen before.",
    evidence: ["source records", "historical movement", "recurring notes", "data gaps"],
    example: "Lead volume stayed stable while conversion fell, suggesting follow-up quality or pipeline fit may have changed.",
    outcome: "Leadership can discuss the likely cause instead of debating disconnected numbers.",
    recommendation: "Generate an executive explanation brief with evidence, confidence, and limitations.",
    confidence: "Medium"
  },
  {
    number: "3",
    title: "Predict",
    promise: "Know what is likely to happen next.",
    icon: Radar,
    howItWorks: "Vaeroex produces forward-looking direction only when the available history is strong enough to support it.",
    memory: "Business Memory gives forecasts context by checking how similar conditions developed in prior periods.",
    evidence: ["trend history", "recency", "source quality", "coverage depth"],
    example: "If response delays continue, conversion pressure may become visible within the next reporting cycle.",
    outcome: "Leaders get useful foresight without false certainty or invented numbers.",
    recommendation: "Use the near-term outlook as a review prompt and upload more history before relying on longer-range forecasts.",
    confidence: "Developing"
  },
  {
    number: "4",
    title: "Recommend",
    promise: "Receive evidence-backed executive recommendations.",
    icon: Lightbulb,
    howItWorks: "Vaeroex turns evidence into a clear leadership review path with confidence and known limitations.",
    memory: "Business Memory keeps recommendations connected to prior context, past signals, and unresolved patterns.",
    evidence: ["risk signals", "opportunity signals", "supporting sources", "confidence limits"],
    example: "Customer response quality deserves leadership review before the next growth push.",
    outcome: "Executives know what to review next while execution remains in the systems the business already uses.",
    recommendation: "Generate an executive brief or meeting agenda for leadership discussion.",
    confidence: "High"
  }
];

const lifecycle: LifecycleStage[] = [
  {
    title: "Information",
    plainLanguage: "The business creates activity.",
    icon: Database,
    inputs: ["files", "metrics", "reports", "business signals"],
    processing: "Vaeroex captures the source material and preserves where it came from.",
    output: "Evidence becomes available for future answers.",
    leadershipResult: "Leaders can see what evidence exists and what is missing."
  },
  {
    title: "Visibility",
    plainLanguage: "Patterns become visible.",
    icon: Search,
    inputs: ["source evidence", "recent activity", "workspace context"],
    processing: "Related signals are grouped so the operating picture is easier to scan.",
    output: "Patterns, gaps, and source relationships are surfaced.",
    leadershipResult: "The business stops feeling scattered."
  },
  {
    title: "Understanding",
    plainLanguage: "The system explains why it matters.",
    icon: Brain,
    inputs: ["current signals", "Business Memory", "historical comparisons"],
    processing: "Vaeroex compares what is happening now with what the organization has already shown it.",
    output: "Reasoning, context, and confidence become clear.",
    leadershipResult: "Leaders can discuss causes, not just symptoms."
  },
  {
    title: "Prediction",
    plainLanguage: "The likely direction becomes clearer.",
    icon: TrendingUp,
    inputs: ["history depth", "recency", "source quality"],
    processing: "Vaeroex checks whether the evidence supports a responsible forward-looking view.",
    output: "A directional outlook appears when confidence is sufficient.",
    leadershipResult: "Forecasts are useful without pretending to be certain."
  },
  {
    title: "Recommendation",
    plainLanguage: "Leadership gets a review path.",
    icon: Target,
    inputs: ["findings", "evidence", "confidence", "limitations"],
    processing: "Vaeroex frames what leadership should review and why.",
    output: "Executive recommendations, briefings, and decision support.",
    leadershipResult: "The business knows what deserves attention next."
  }
];

const businessAreas: BusinessArea[] = [
  {
    title: "Revenue",
    question: "Is growth healthy, or is money leaking beneath the surface?",
    icon: BarChart3,
    problem: "Revenue can look strong while conversion, response time, or customer quality weakens underneath.",
    evidence: ["revenue movement", "conversion rate", "lead quality", "response timing"],
    patterns: ["stable lead volume", "lower conversion", "slower response", "higher risk to future revenue"],
    memory: "Vaeroex compares current revenue movement against prior customer and pipeline signals.",
    recommendation: "Treat revenue strength as conditional until the supporting activity is reviewed.",
    leadershipReview: "Generate a revenue-risk brief for leadership discussion.",
    confidence: "High"
  },
  {
    title: "Operations",
    question: "Where is the business slowing down?",
    icon: Workflow,
    problem: "Operating friction often appears across several systems before it shows up as a single obvious problem.",
    evidence: ["issue themes", "operations notes", "KPI variance", "file analysis"],
    patterns: ["repeat delays", "capacity pressure", "process friction", "inconsistent completion"],
    memory: "Business Memory checks whether the same operating friction appeared in prior reviews.",
    recommendation: "Review the repeated bottleneck pattern before adding more volume to the process.",
    leadershipReview: "Generate an investigation summary with evidence and confidence.",
    confidence: "Medium"
  },
  {
    title: "Customers",
    question: "Are customers getting slower or weaker responses?",
    icon: Zap,
    problem: "Customer activity can rise while response quality quietly falls behind.",
    evidence: ["customer activity", "response-time records", "complaint notes", "completion trends"],
    patterns: ["higher volume", "slower response", "more customer friction", "possible retention pressure"],
    memory: "Vaeroex connects current response signals with prior customer satisfaction movement.",
    recommendation: "Review customer response quality before delays affect retention or future conversion.",
    leadershipReview: "Generate a customer response briefing for the next operating review.",
    confidence: "High"
  },
  {
    title: "Compliance",
    question: "Where is evidence incomplete?",
    icon: ShieldAlert,
    problem: "Procedure coverage, review history, or documentation can be too thin to support confident conclusions.",
    evidence: ["procedure records", "review dates", "checklist history", "uploaded policy notes"],
    patterns: ["stale procedures", "missing review evidence", "low coverage", "limited documentation"],
    memory: "Business Memory preserves prior procedure concerns and shows whether coverage is improving.",
    recommendation: "Use the finding as a compliance-aware review prompt without collecting regulated sensitive information.",
    leadershipReview: "Generate a procedure coverage brief for leadership review.",
    confidence: "Developing"
  },
  {
    title: "Performance",
    question: "Is performance improving, weakening, or becoming unstable?",
    icon: Gauge,
    problem: "A KPI can move below target without showing whether the cause is temporary noise or a real operating pattern.",
    evidence: ["KPI history", "target misses", "period comparisons", "supporting reports"],
    patterns: ["below-target movement", "higher volatility", "limited context", "possible operating pressure"],
    memory: "Vaeroex checks whether similar performance movement has appeared before.",
    recommendation: "Review the supporting evidence before treating the metric as a temporary fluctuation.",
    leadershipReview: "Generate a performance brief with data gaps and confidence.",
    confidence: "Medium"
  }
];

function confidenceClass(confidence: Confidence) {
  if (confidence === "High") {
    return "border-emerald-400/35 bg-emerald-950/35 text-emerald-100";
  }

  if (confidence === "Medium") {
    return "border-amber-400/35 bg-amber-950/35 text-amber-100";
  }

  return "border-cyan-400/35 bg-cyan-950/35 text-cyan-100";
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">{children}</p>;
}

export function OperationsIntelligenceProductExperience() {
  const [activePillarIndex, setActivePillarIndex] = useState(0);
  const [activeLifecycleIndex, setActiveLifecycleIndex] = useState(0);
  const [activeAreaIndex, setActiveAreaIndex] = useState(0);

  const activePillar = pillars[activePillarIndex] ?? pillars[0];
  const activeLifecycle = lifecycle[activeLifecycleIndex] ?? lifecycle[0];
  const activeArea = businessAreas[activeAreaIndex] ?? businessAreas[0];
  const ActivePillarIcon = activePillar.icon;
  const ActiveLifecycleIcon = activeLifecycle.icon;
  const ActiveAreaIcon = activeArea.icon;

  return (
    <div className="grid gap-8">
      <section id="intelligence-created" className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">What It Does</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Understand. Explain. Predict. Recommend.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Operations Intelligence turns business activity into a clearer leadership view, then shows the evidence behind it.
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[0.72fr_1.28fr] xl:items-start">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {pillars.map((pillar, index) => {
              const isActive = index === activePillarIndex;
              const Icon = pillar.icon;

              return (
                <button
                  key={pillar.title}
                  type="button"
                  onClick={() => setActivePillarIndex(index)}
                  className={[
                    "rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 shadow-[0_0_24px_rgba(56,189,248,0.14)]"
                      : "border-white/10 bg-white/[0.055] hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  <span className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-vaeroex-accent/25 bg-vaeroex-accent/10 text-sm font-semibold text-vaeroex-accent">
                      {pillar.number}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-semibold text-white">
                        <Icon className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />
                        {pillar.title}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-slate-300">{pillar.promise}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-vaeroex-blue/25 bg-[#07101f]/95 p-4 shadow-command lg:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-vaeroex-accent">
                  <ActivePillarIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">{activePillar.title}</h3>
                  <p className="mt-1 text-sm font-semibold text-vaeroex-accent">{activePillar.promise}</p>
                </div>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(activePillar.confidence)}`}>
                Confidence: {activePillar.confidence}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <Label>How It Works</Label>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activePillar.howItWorks}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <Label>Business Memory</Label>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activePillar.memory}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
                <Label>Evidence Used</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activePillar.evidence.map((item) => (
                    <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-vaeroex-accent/20 bg-vaeroex-accent/10 p-3">
                <Label>Example</Label>
                <p className="mt-2 text-sm font-semibold leading-6 text-white">{activePillar.example}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#0c1728] p-3">
                <Label>Business Outcome</Label>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activePillar.outcome}</p>
              </div>
              <div className="rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3">
                <Label>Leadership Recommendation</Label>
                <p className="mt-2 text-sm font-semibold leading-6 text-white">{activePillar.recommendation}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="rounded-xl border border-white/10 bg-[#050b18] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">How It Works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">From scattered information to a recommended review.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Click a step to see how Vaeroex moves from source material to leadership-ready context.
          </p>
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-5">
          {lifecycle.map((stage, index) => {
            const isActive = index === activeLifecycleIndex;
            const Icon = stage.icon;

            return (
              <button
                key={stage.title}
                type="button"
                onClick={() => setActiveLifecycleIndex(index)}
                className={[
                  "rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive
                    ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white"
                    : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <Icon className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />
                <span className="mt-2 block text-sm font-semibold">{stage.title}</span>
                <span className="mt-1 block text-xs leading-4 text-slate-400">{stage.plainLanguage}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.055] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-vaeroex-accent">
                <ActiveLifecycleIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-xl font-semibold text-white">{activeLifecycle.title}</h3>
                <p className="mt-1 text-sm text-slate-300">{activeLifecycle.plainLanguage}</p>
              </div>
            </div>
            <p className="max-w-xl rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3 text-sm font-semibold leading-6 text-slate-100">
              {activeLifecycle.leadershipResult}
            </p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1.15fr_1.05fr]">
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <Label>Inputs</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeLifecycle.inputs.map((input) => (
                  <span key={input} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {input}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <Label>Processing</Label>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeLifecycle.processing}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <Label>Output</Label>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeLifecycle.output}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Business Questions</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">What should leadership understand first?</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Choose an area. Vaeroex shows the kind of evidence it reads and the review it would prepare for leadership.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {businessAreas.map((area, index) => {
            const isActive = index === activeAreaIndex;
            const Icon = area.icon;

            return (
              <button
                key={area.title}
                type="button"
                onClick={() => setActiveAreaIndex(index)}
                className={[
                  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                  isActive
                    ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white"
                    : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10 hover:text-white"
                ].join(" ")}
                aria-pressed={isActive}
              >
                <Icon className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />
                {area.title}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-vaeroex-blue/25 bg-[#07101f]/95 p-4 shadow-command lg:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-vaeroex-accent">
                <ActiveAreaIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-white">{activeArea.title}</h3>
                <p className="mt-1 text-sm font-semibold text-vaeroex-accent">{activeArea.question}</p>
              </div>
            </div>
            <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(activeArea.confidence)}`}>
              Confidence: {activeArea.confidence}
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
              <Label>Problem</Label>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeArea.problem}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
              <Label>Business Memory</Label>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeArea.memory}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <Label>Evidence Read</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeArea.evidence.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <Label>Patterns Detected</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeArea.patterns.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-vaeroex-accent/20 bg-vaeroex-accent/10 p-3">
              <Label>Recommendation</Label>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{activeArea.recommendation}</p>
            </div>
            <div className="rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3">
              <Label>Leadership Review</Label>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{activeArea.leadershipReview}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
