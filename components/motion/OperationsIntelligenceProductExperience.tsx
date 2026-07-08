"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Brain, Lightbulb, Radar, Search, ShieldAlert } from "lucide-react";

type Confidence = "High" | "Medium" | "Developing";

type DemoStory = {
  title: string;
  plainAnswer: string;
  icon: LucideIcon;
  problem: string;
  evidence: string;
  analysis: string;
  recommendation: string;
  outcome: string;
  confidence: Confidence;
};

const stories: DemoStory[] = [
  {
    title: "Visibility",
    plainAnswer: "See what is happening.",
    icon: Search,
    problem: "Revenue looks healthy, but customer response time is getting slower.",
    evidence: "Revenue, response-time records, customer notes, and recent business signals.",
    analysis: "Vaeroex separates the visible result from the hidden pressure underneath it.",
    recommendation: "Review customer response quality before assuming growth is fully healthy.",
    outcome: "Leadership sees the real operating condition sooner.",
    confidence: "High"
  },
  {
    title: "Business Memory",
    plainAnswer: "Remember what the business has already shown you.",
    icon: Brain,
    problem: "A vendor delay looks isolated until prior operating notes are considered.",
    evidence: "Uploaded files, prior briefings, business signals, and historical KPI movement.",
    analysis: "Vaeroex compares the current issue with previous patterns so context is not lost.",
    recommendation: "Review whether the vendor pattern is becoming a recurring operating risk.",
    outcome: "Leadership decisions use institutional memory, not just today's report.",
    confidence: "Medium"
  },
  {
    title: "Risk Detection",
    plainAnswer: "Find what could hurt performance.",
    icon: ShieldAlert,
    problem: "Customer activity is rising, but complaints and delayed responses are rising too.",
    evidence: "Customer records, response timing, complaint notes, and conversion movement.",
    analysis: "Vaeroex connects customer friction to future revenue and retention risk.",
    recommendation: "Generate an executive risk brief for leadership review.",
    outcome: "Leadership sees risk before it becomes a financial surprise.",
    confidence: "High"
  },
  {
    title: "Prediction",
    plainAnswer: "Know what may happen next.",
    icon: Radar,
    problem: "Conversion is softening, but the long-term forecast is not fully supported yet.",
    evidence: "Trend history, source quality, data recency, and coverage depth.",
    analysis: "Vaeroex checks whether the evidence is strong enough to support a responsible forecast.",
    recommendation: "Use the near-term outlook as a review prompt and add more historical data before relying on a longer forecast.",
    outcome: "Leaders get foresight without false certainty.",
    confidence: "Developing"
  },
  {
    title: "Recommendations",
    plainAnswer: "Know what leadership should review.",
    icon: Lightbulb,
    problem: "Several signals point to the same customer response issue.",
    evidence: "Risk signals, supporting sources, Business Memory, and known limitations.",
    analysis: "Vaeroex turns evidence into a concise leadership review path.",
    recommendation: "Prepare an executive brief or meeting agenda focused on customer response quality.",
    outcome: "The next leadership discussion starts with evidence and a clear question.",
    confidence: "High"
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

export function OperationsIntelligenceProductExperience() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStory = stories[activeIndex] ?? stories[0];
  const ActiveIcon = activeStory.icon;

  return (
    <section id="intelligence-created" className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Product Demo</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Choose what leadership needs to understand.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Operations Intelligence teaches one idea at a time: problem, evidence, analysis, recommendation, and outcome.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {stories.map((story, index) => {
              const isActive = index === activeIndex;
              const Icon = story.icon;

              return (
                <button
                  key={story.title}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={[
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 text-white"
                      : "border-white/10 bg-white/[0.055] text-slate-300 hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10 hover:text-white"
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  <Icon className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />
                  {story.title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-vaeroex-blue/25 bg-[#07101f]/95 shadow-command">
          <div className="border-b border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-vaeroex-accent">
                  <ActiveIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">{activeStory.title}</h3>
                  <p className="mt-1 text-sm font-semibold text-vaeroex-accent">{activeStory.plainAnswer}</p>
                </div>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(activeStory.confidence)}`}>
                Confidence: {activeStory.confidence}
              </span>
            </div>
          </div>

          <div className="divide-y divide-white/10">
            <StoryRow label="Business problem" value={activeStory.problem} />
            <StoryRow label="Evidence" value={activeStory.evidence} />
            <StoryRow label="Analysis" value={activeStory.analysis} />
            <StoryRow label="Recommendation" value={activeStory.recommendation} emphasized />
            <StoryRow label="Business outcome" value={activeStory.outcome} />
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-[0.28fr_0.72fr] sm:items-start sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">{label}</p>
      <p className={["text-sm leading-6", emphasized ? "font-semibold text-white" : "text-slate-200"].join(" ")}>{value}</p>
    </div>
  );
}
