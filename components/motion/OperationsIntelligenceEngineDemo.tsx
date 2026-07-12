"use client";

import { useState } from "react";
import { ArrowRight, FileCheck2, Lightbulb, Search } from "lucide-react";

const engineScenarios = [
  {
    tab: "Performance",
    question: "Where are we losing performance?",
    evidence: "Margin movement, delayed customer response, issue patterns, and recent operating notes.",
    interpretation: "Revenue remains stable, but slower response and repeat service issues are creating pressure below the headline result.",
    recommendation: "Review whether response coverage or process consistency is the stronger source of margin pressure.",
    outcome: "Leadership reviews the operating cause before treating the result as a sales problem.",
    confidence: "High"
  },
  {
    tab: "Change",
    question: "What changed this month?",
    evidence: "Dated KPI history, new source files, Business Signals, and the prior stored intelligence review.",
    interpretation: "Customer demand improved while fulfillment consistency weakened across two recent reporting periods.",
    recommendation: "Protect the demand gain by reviewing the fulfillment pattern before the next reporting cycle.",
    outcome: "Leadership sees the meaningful change, not a list of every updated record.",
    confidence: "Medium"
  },
  {
    tab: "Risk",
    question: "Which risk requires attention?",
    evidence: "Complaint themes, response-time history, customer activity, and supporting source documents.",
    interpretation: "Customer response quality is the most consistent current risk because multiple independent signals point in the same direction.",
    recommendation: "Review the response process with leadership and confirm whether capacity or consistency is the primary cause.",
    outcome: "The next review begins with a supported risk and a clear question to resolve.",
    confidence: "High"
  },
  {
    tab: "Targets",
    question: "Are we meeting our targets?",
    evidence: "Current KPI values, workspace targets, reporting periods, freshness, and recent direction.",
    interpretation: "Revenue is above target, but response time and customer satisfaction require attention before performance can be considered balanced.",
    recommendation: "Review the weakest weighted KPI first and confirm whether its latest data is current enough for a decision.",
    outcome: "Leadership sees performance in context instead of treating one strong metric as the whole business.",
    confidence: "High"
  }
] as const;

export function OperationsIntelligenceEngineDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = engineScenarios[activeIndex] ?? engineScenarios[0];

  return (
    <div className="overflow-hidden rounded-lg border border-white/15 bg-[#07111f] shadow-command">
      <div className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Illustrative product experience</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Choose a leadership question.</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-slate-400">Vaeroex narrows the evidence, explains what it means, and keeps uncertainty visible.</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="tablist" aria-label="Leadership question examples">
          {engineScenarios.map((scenario, index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={scenario.tab}
                id={`operations-intelligence-demo-tab-${index}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="operations-intelligence-demo-panel"
                onClick={() => setActiveIndex(index)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${isActive ? "border-cyan-300/45 bg-cyan-950/35 text-white" : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"}`}
              >
                {scenario.tab}
              </button>
            );
          })}
        </div>
      </div>

      <div key={active.tab} id="operations-intelligence-demo-panel" role="tabpanel" aria-labelledby={`operations-intelligence-demo-tab-${activeIndex}`} aria-live="polite" className="vaeroex-story-change grid gap-px bg-white/10 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
        <div className="bg-[#08111f] p-4 sm:p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-950/30 text-cyan-100">
            <Search className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Business question</p>
          <h3 className="mt-2 text-2xl font-semibold leading-8 text-white">{active.question}</h3>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
              Evidence reviewed
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-300">{active.evidence}</p>
          </div>
        </div>

        <div className="bg-[#07111f] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Vaeroex interpretation</p>
            <span className="rounded-full border border-emerald-300/25 bg-emerald-950/30 px-2.5 py-1 text-xs font-semibold text-emerald-100">{active.confidence} confidence</span>
          </div>
          <p className="mt-3 text-lg font-semibold leading-7 text-white">{active.interpretation}</p>
          <div className="mt-5 border-t border-white/10 pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
              <Lightbulb className="h-4 w-4" aria-hidden="true" />
              Recommended review
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-200">{active.recommendation}</p>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-blue-300/20 bg-blue-950/25 p-4">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-cyan-100">Leadership outcome</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">{active.outcome}</p>
            </div>
          </div>
        </div>
      </div>

      <p className="border-t border-white/10 px-4 py-3 text-[0.68rem] leading-5 text-slate-500 sm:px-5">Illustrative examples only. Actual conclusions depend on the eligible evidence available in each private workspace.</p>
    </div>
  );
}
