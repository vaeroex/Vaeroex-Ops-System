"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  Briefcase,
  Database,
  FileSearch,
  Gauge,
  Lightbulb,
  LineChart,
  Radar,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Workflow,
  Zap
} from "lucide-react";

type Confidence = "High" | "Medium" | "Developing";

type Capability = {
  title: string;
  short: string;
  icon: LucideIcon;
  creates: string;
  evidence: string[];
  leadershipBenefit: string;
  exampleOutput: string;
  exampleRecommendation: string;
  businessOutcome: string;
  confidence: Confidence;
  workflow: string[];
};

type LifecycleStage = {
  title: string;
  icon: LucideIcon;
  inputs: string[];
  processing: string;
  outputs: string[];
  executiveResult: string;
};

type BusinessSituation = {
  title: string;
  short: string;
  icon: LucideIcon;
  problem: string;
  evidenceAnalyzed: string[];
  signalsDetected: string[];
  businessMemory: string;
  recommendation: string;
  leadershipAction: string;
  confidence: Confidence;
};

const workflowLabels = ["Problem", "Evidence", "Understanding", "Prediction", "Executive Recommendation"] as const;

const intelligenceCapabilities: Capability[] = [
  {
    title: "Executive View",
    short: "Condenses operating movement into leadership context.",
    icon: Briefcase,
    creates: "A concise leadership read on what changed, why it matters, and what deserves review.",
    evidence: ["business health movement", "risk and opportunity signals", "recent reports", "Business Memory"],
    leadershipBenefit: "Leadership can start with the operating story instead of searching through disconnected dashboards.",
    exampleOutput: "Business health is steady, but customer response signals weakened during the last 30 days.",
    exampleRecommendation: "Review customer response evidence before the next executive meeting.",
    businessOutcome: "Faster alignment on the few operating conditions that deserve leadership attention.",
    confidence: "High",
    workflow: [
      "Customer response activity changed while revenue stayed stable.",
      "Vaeroex reviews response records, KPI movement, and recent business signals.",
      "The system separates stable revenue from emerging customer experience risk.",
      "Future conversion may soften if response delays continue.",
      "Review customer response evidence and generate an executive brief."
    ]
  },
  {
    title: "Business Memory",
    short: "Preserves the history behind recommendations.",
    icon: Brain,
    creates: "Long-term context from prior imports, signals, briefings, decisions, and outcomes.",
    evidence: ["indexed files", "business signals", "historical KPI records", "generated briefings"],
    leadershipBenefit: "Vaeroex can explain whether today's signal is new, recurring, or connected to prior business context.",
    exampleOutput: "The current vendor delay resembles two prior supply interruptions from March and May.",
    exampleRecommendation: "Review the vendor impact pattern before approving next quarter commitments.",
    businessOutcome: "Institutional knowledge becomes easier to reuse during leadership decisions.",
    confidence: "Medium",
    workflow: [
      "A new vendor issue appears in uploaded operating notes.",
      "Vaeroex compares it with indexed file evidence and prior business signals.",
      "The signal matches a recurring supply reliability pattern.",
      "Future delivery risk may increase if the pattern continues.",
      "Generate a vendor impact summary for leadership review."
    ]
  },
  {
    title: "Evidence Analysis",
    short: "Connects conclusions to source material.",
    icon: FileSearch,
    creates: "Source-backed findings from files, metrics, reports, and operational records.",
    evidence: ["uploaded documents", "spreadsheet rows", "source citations", "confidence limits"],
    leadershipBenefit: "Recommendations are easier to trust because leaders can see what evidence supports them.",
    exampleOutput: "Three uploaded files indicate rising service delays, but only one contains date-level detail.",
    exampleRecommendation: "Use the finding as a review prompt, not a forecast, until more historical records are available.",
    businessOutcome: "The platform stays conservative and avoids unsupported claims.",
    confidence: "Developing",
    workflow: [
      "A file mentions repeated service delays.",
      "Vaeroex extracts evidence and checks whether enough records support the finding.",
      "The system identifies the issue but flags limited historical coverage.",
      "A reliable forecast is not supported yet.",
      "Ask for more service history before making a trend claim."
    ]
  },
  {
    title: "KPI Meaning",
    short: "Turns metrics into interpretation.",
    icon: BarChart3,
    creates: "Meaning from target gaps, actual values, variance, trend direction, and historical depth.",
    evidence: ["KPI targets", "actual values", "period comparisons", "coverage quality"],
    leadershipBenefit: "Executives see whether movement is meaningful, noisy, or too thin to trust.",
    exampleOutput: "Revenue is above target, while conversion is below target for the second period in a row.",
    exampleRecommendation: "Review pipeline quality before assuming revenue growth is structurally improving.",
    businessOutcome: "Metric reviews become decision support instead of number watching.",
    confidence: "High",
    workflow: [
      "Revenue improved while conversion weakened.",
      "Vaeroex compares target performance, actual values, and historical direction.",
      "The system identifies a possible quality gap in the pipeline.",
      "Future revenue may become less predictable if conversion keeps falling.",
      "Review pipeline quality and generate a performance brief."
    ]
  },
  {
    title: "Performance Signals",
    short: "Shows whether movement is healthy or unstable.",
    icon: Gauge,
    creates: "A clearer read on improvement, decline, volatility, and below-target periods.",
    evidence: ["month-over-month movement", "volatility", "target misses", "recent imports"],
    leadershipBenefit: "Leadership can separate strong performance from inconsistent performance.",
    exampleOutput: "Lead volume is above target, but response time volatility increased across the same period.",
    exampleRecommendation: "Review whether growth is creating service pressure.",
    businessOutcome: "Leaders can spot operating strain before it becomes visible in end-of-month results.",
    confidence: "Medium",
    workflow: [
      "Lead volume rises while response consistency weakens.",
      "Vaeroex compares growth signals with service quality indicators.",
      "The system identifies possible capacity pressure.",
      "Customer experience risk may increase if volume continues to rise.",
      "Generate a growth-pressure briefing for leadership."
    ]
  },
  {
    title: "Trend Detection",
    short: "Surfaces repeated movement before it becomes obvious.",
    icon: LineChart,
    creates: "Early visibility into recurring patterns, directional changes, and unusual movement.",
    evidence: ["historical KPI history", "recurring signals", "data recency", "source quality"],
    leadershipBenefit: "Executives can review weak signals before they become late-stage problems.",
    exampleOutput: "Open issue volume has increased in three of the last four periods.",
    exampleRecommendation: "Review issue themes and decide whether the increase represents a structural pattern.",
    businessOutcome: "Leadership gains earlier warning without relying on intuition alone.",
    confidence: "Medium",
    workflow: [
      "Open issue counts rise across multiple periods.",
      "Vaeroex checks recurrence, recency, and source consistency.",
      "The system identifies a possible operational pattern.",
      "Risk may rise if the same issue themes continue.",
      "Generate an investigation summary."
    ]
  },
  {
    title: "Risk Detection",
    short: "Identifies conditions that may become business risk.",
    icon: ShieldAlert,
    creates: "Operational risk context from delays, quality decline, customer signals, and missing evidence.",
    evidence: ["open issue patterns", "response delays", "complaints", "procedure gaps"],
    leadershipBenefit: "Vaeroex explains what could matter and why without treating it like a work queue.",
    exampleOutput: "Customer response delays increased while complaint notes became more frequent.",
    exampleRecommendation: "Review customer response risk with leadership before the next reporting cycle.",
    businessOutcome: "Risk conversations become evidence-backed instead of anecdotal.",
    confidence: "High",
    workflow: [
      "Customer delay and complaint signals increase together.",
      "Vaeroex connects customer evidence with operational signals.",
      "The system identifies a response-quality risk.",
      "Retention and future conversion could weaken if the pattern continues.",
      "Generate an executive risk brief."
    ]
  },
  {
    title: "Opportunity Detection",
    short: "Finds positive movement worth understanding.",
    icon: TrendingUp,
    creates: "Visibility into improving performance, underused capacity, and areas with momentum.",
    evidence: ["above-target movement", "stronger conversion", "improving cycle times", "positive signals"],
    leadershipBenefit: "Leadership sees where to lean in, not only what to fix.",
    exampleOutput: "New leads and average deal size improved while complaint volume stayed flat.",
    exampleRecommendation: "Review which channel or process may be driving higher-quality demand.",
    businessOutcome: "Good movement becomes easier to understand and repeat.",
    confidence: "Medium",
    workflow: [
      "Lead quality improves without a matching rise in complaints.",
      "Vaeroex compares growth, customer, and operational quality evidence.",
      "The system identifies a possible source of healthy growth.",
      "More revenue opportunity may exist if the pattern is intentional.",
      "Generate an opportunity brief."
    ]
  },
  {
    title: "Decision Support",
    short: "Frames evidence for leadership review.",
    icon: Lightbulb,
    creates: "Recommendations with evidence, reasoning, confidence, and known limitations.",
    evidence: ["supporting sources", "data gaps", "confidence labels", "contextual reasoning"],
    leadershipBenefit: "Leaders get a clearer basis for review without Vaeroex pretending to run the business.",
    exampleOutput: "The evidence supports a review of customer follow-up quality, but not a reliable revenue forecast.",
    exampleRecommendation: "Generate an executive decision brief with evidence and limitations.",
    businessOutcome: "Decisions become more structured, transparent, and grounded.",
    confidence: "High",
    workflow: [
      "Signals point in different directions.",
      "Vaeroex separates evidence, inference, confidence, and missing context.",
      "The system explains what is known and what remains uncertain.",
      "Prediction is limited until more historical evidence is available.",
      "Generate a decision brief for leadership review."
    ]
  },
  {
    title: "Executive Briefs",
    short: "Produces meeting-ready intelligence outputs.",
    icon: Sparkles,
    creates: "Boardroom-ready summaries of risks, opportunities, evidence, and review priorities.",
    evidence: ["findings", "source evidence", "confidence", "limitations"],
    leadershipBenefit: "Executives can walk into a review with the business story already organized.",
    exampleOutput: "This week's briefing highlights one risk, one opportunity, and three evidence-backed review questions.",
    exampleRecommendation: "Use the brief to guide leadership discussion, not to replace judgment.",
    businessOutcome: "Meetings start with sharper context and fewer scattered updates.",
    confidence: "High",
    workflow: [
      "Leadership needs a concise operating read.",
      "Vaeroex gathers current signals, evidence, and Business Memory context.",
      "The system turns the evidence into a structured briefing.",
      "Forecast language appears only when data supports it.",
      "Review the executive brief with leadership."
    ]
  },
  {
    title: "Business Health",
    short: "Compresses condition, direction, risk, and focus.",
    icon: Activity,
    creates: "A compact view of overall condition, trend direction, risk level, and primary focus area.",
    evidence: ["KPI movement", "business signals", "risk patterns", "historical coverage"],
    leadershipBenefit: "The first screen answers whether the business is steady, improving, or under pressure.",
    exampleOutput: "Business health remains strong, but risk is rising from response-time volatility.",
    exampleRecommendation: "Review response quality before assuming the business is fully stable.",
    businessOutcome: "Executives can scan the operating condition in seconds.",
    confidence: "Medium",
    workflow: [
      "Some indicators improve while others weaken.",
      "Vaeroex weighs KPI movement, risk signals, and evidence coverage.",
      "The system produces a balanced health read.",
      "Risk may rise if weak indicators begin affecting customer outcomes.",
      "Use the health read as the starting point for review."
    ]
  },
  {
    title: "Forecasting",
    short: "Predicts only when evidence supports it.",
    icon: Radar,
    creates: "Conservative forward-looking insight when historical evidence is deep enough.",
    evidence: ["coverage depth", "trend history", "source quality", "recency"],
    leadershipBenefit: "Vaeroex labels uncertainty clearly and refuses to invent numbers from thin data.",
    exampleOutput: "There is enough evidence for a directional 30-day view, but not a reliable 6-month forecast.",
    exampleRecommendation: "Upload more historical revenue and customer response data before using longer-range forecasts.",
    businessOutcome: "Leaders get useful foresight without false precision.",
    confidence: "Developing",
    workflow: [
      "Leadership asks what may happen next.",
      "Vaeroex checks historical depth, recency, and source quality.",
      "The system decides whether a forecast is responsible.",
      "Limited history keeps confidence low beyond short-term direction.",
      "Request more historical evidence before long-range prediction."
    ]
  }
];

const intelligenceLifecycle: LifecycleStage[] = [
  {
    title: "Information",
    icon: Database,
    inputs: ["files", "metrics", "reports", "business signals"],
    processing: "Vaeroex captures activity without assuming it is already meaningful.",
    outputs: ["source evidence", "raw context", "data quality notes"],
    executiveResult: "Leadership can see what evidence exists and what is still missing."
  },
  {
    title: "Visibility",
    icon: Search,
    inputs: ["source evidence", "workspace context", "recent activity"],
    processing: "Scattered activity is organized into visible patterns, gaps, and categories.",
    outputs: ["patterns", "coverage gaps", "source relationships"],
    executiveResult: "The operating picture becomes easier to scan."
  },
  {
    title: "Understanding",
    icon: Brain,
    inputs: ["current signals", "Business Memory", "historical comparisons"],
    processing: "Vaeroex compares current activity against prior context and evidence quality.",
    outputs: ["reasoning", "business context", "confidence"],
    executiveResult: "Leaders see why a signal may matter."
  },
  {
    title: "Prediction",
    icon: TrendingUp,
    inputs: ["historical depth", "recency", "source quality"],
    processing: "Forward-looking insight is generated only when the evidence can support it.",
    outputs: ["directional outlook", "limitations", "data gaps"],
    executiveResult: "Leadership gets foresight without false certainty."
  },
  {
    title: "Action",
    icon: Target,
    inputs: ["findings", "risk context", "opportunity context"],
    processing: "Vaeroex frames what leadership should review next.",
    outputs: ["executive recommendations", "briefings", "decision support"],
    executiveResult: "The business keeps execution in its existing systems while Vaeroex provides intelligence."
  }
];

const executiveSituations: BusinessSituation[] = [
  {
    title: "Revenue leakage",
    short: "Revenue looks healthy, but supporting activity suggests future loss.",
    icon: BarChart3,
    problem: "Monthly revenue is above target, but conversion quality and response timing are moving in the wrong direction.",
    evidenceAnalyzed: ["revenue trend", "conversion rate", "response-time records", "recent sales notes"],
    signalsDetected: ["stable lead volume", "lower conversion", "slower response", "more unresolved customer notes"],
    businessMemory: "Prior periods show conversion softened after response delays increased.",
    recommendation: "Treat revenue strength as conditional until pipeline quality and response evidence are reviewed.",
    leadershipAction: "Generate an executive revenue-risk brief for leadership discussion.",
    confidence: "High"
  },
  {
    title: "Customer response delays",
    short: "Customer activity rises while response quality weakens.",
    icon: Zap,
    problem: "More customer activity is entering the business, but response speed is no longer keeping pace.",
    evidenceAnalyzed: ["customer activity records", "response-time KPIs", "complaint notes", "follow-up completion trends"],
    signalsDetected: ["response time above target", "higher volume", "more customer friction", "declining completion rate"],
    businessMemory: "Indexed notes connect response delays with prior customer satisfaction movement.",
    recommendation: "Review the customer response process before delays affect retention or conversion.",
    leadershipAction: "Generate a customer response briefing for the next operating review.",
    confidence: "High"
  },
  {
    title: "Operational bottlenecks",
    short: "Repeated friction appears across multiple sources.",
    icon: Workflow,
    problem: "Several records point to the same operating slowdown, but the signal is spread across different sources.",
    evidenceAnalyzed: ["issue themes", "file analysis", "operations notes", "KPI variance"],
    signalsDetected: ["repeat delays", "shared process language", "capacity pressure", "inconsistent completion"],
    businessMemory: "Business Memory shows similar friction was mentioned in two prior reviews.",
    recommendation: "Review the repeated bottleneck pattern before adding new volume to the process.",
    leadershipAction: "Generate an investigation summary with evidence and confidence.",
    confidence: "Medium"
  },
  {
    title: "Performance decline",
    short: "A KPI weakens enough to deserve context.",
    icon: AlertTriangle,
    problem: "A key metric has moved below target for more than one period, but the cause is not visible from the metric alone.",
    evidenceAnalyzed: ["KPI history", "target misses", "period comparisons", "supporting reports"],
    signalsDetected: ["below-target trend", "higher volatility", "insufficient source coverage", "possible operating pressure"],
    businessMemory: "Prior reports suggest the decline may connect to staffing changes and review cadence.",
    recommendation: "Review supporting evidence before treating the metric as a temporary fluctuation.",
    leadershipAction: "Generate a performance decline brief with data gaps.",
    confidence: "Medium"
  },
  {
    title: "Compliance gaps",
    short: "Procedure evidence or review coverage appears incomplete.",
    icon: ShieldAlert,
    problem: "Operational procedure coverage is uneven, and the available evidence does not prove consistent review.",
    evidenceAnalyzed: ["SOP records", "checklist history", "review dates", "uploaded procedure notes"],
    signalsDetected: ["stale procedures", "missing review evidence", "low checklist coverage", "limited documentation"],
    businessMemory: "Memory contains prior notes about procedure review concerns, but coverage is still incomplete.",
    recommendation: "Use the finding as a compliance-aware review prompt without collecting regulated sensitive information.",
    leadershipAction: "Generate a procedure coverage brief for leadership review.",
    confidence: "Developing"
  },
  {
    title: "Forecast risk",
    short: "Current signals suggest future risk, but confidence depends on history.",
    icon: Radar,
    problem: "Some indicators point toward a possible future decline, but historical depth may be limited.",
    evidenceAnalyzed: ["trend history", "data recency", "source mix", "confidence coverage"],
    signalsDetected: ["short-term softening", "limited historical records", "mixed source quality", "forecast constraint"],
    businessMemory: "Business Memory improves near-term context, but the longer-range forecast remains under-supported.",
    recommendation: "Use the directional signal cautiously and collect more historical evidence before long-range forecasting.",
    leadershipAction: "Generate a low-confidence forecast note with data gaps.",
    confidence: "Developing"
  },
  {
    title: "Vendor issues",
    short: "Supplier signals repeat across operating records.",
    icon: Briefcase,
    problem: "Vendor reliability concerns appear in multiple notes and may be affecting delivery or cost consistency.",
    evidenceAnalyzed: ["vendor notes", "delivery records", "cost variance", "quality signals"],
    signalsDetected: ["repeat delays", "cost movement", "quality exceptions", "service disruption language"],
    businessMemory: "Prior vendor references show the issue may be recurring rather than isolated.",
    recommendation: "Review vendor impact before making future purchasing or delivery commitments.",
    leadershipAction: "Generate a vendor impact summary for leadership review.",
    confidence: "Medium"
  },
  {
    title: "Quality deterioration",
    short: "Quality-related signals increase over time.",
    icon: Activity,
    problem: "Complaint, defect, or rework signals are increasing enough to deserve executive visibility.",
    evidenceAnalyzed: ["complaint notes", "quality records", "issue categories", "recent reports"],
    signalsDetected: ["more quality references", "repeat issue categories", "customer friction", "possible process drift"],
    businessMemory: "Business Memory connects quality notes to prior process review discussions.",
    recommendation: "Review whether the quality movement reflects a process issue or temporary noise.",
    leadershipAction: "Generate a quality trend briefing.",
    confidence: "Medium"
  },
  {
    title: "Missed follow-ups",
    short: "Customer follow-up activity weakens as volume continues.",
    icon: Target,
    problem: "Follow-up completion declined while customer-facing activity remained active.",
    evidenceAnalyzed: ["follow-up completion", "CRM export data", "customer notes", "conversion movement"],
    signalsDetected: ["completion decline", "aging follow-ups", "conversion pressure", "customer response risk"],
    businessMemory: "Historical evidence suggests follow-up gaps have previously appeared before weaker conversion periods.",
    recommendation: "Review the current customer follow-up process with leadership.",
    leadershipAction: "Generate an executive improvement plan for review.",
    confidence: "High"
  },
  {
    title: "Decision uncertainty",
    short: "Leadership has mixed signals and incomplete evidence.",
    icon: Lightbulb,
    problem: "Several indicators point in different directions, and the available evidence does not support a single confident conclusion.",
    evidenceAnalyzed: ["KPI movement", "source coverage", "business signals", "recent reports"],
    signalsDetected: ["conflicting signals", "missing context", "limited source depth", "unclear business impact"],
    businessMemory: "Business Memory supplies prior context but also reveals gaps in the current evidence base.",
    recommendation: "Separate what is known, what is inferred, and what still needs evidence before deciding.",
    leadershipAction: "Generate an executive decision brief.",
    confidence: "Developing"
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

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{children}</p>;
}

export function OperationsIntelligenceProductExperience() {
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [activeLifecycleIndex, setActiveLifecycleIndex] = useState(0);
  const [activeSituationIndex, setActiveSituationIndex] = useState(0);

  const activeCapability = intelligenceCapabilities[activeCapabilityIndex] ?? intelligenceCapabilities[0];
  const activeLifecycle = intelligenceLifecycle[activeLifecycleIndex] ?? intelligenceLifecycle[0];
  const activeSituation = executiveSituations[activeSituationIndex] ?? executiveSituations[0];
  const ActiveCapabilityIcon = activeCapability.icon;
  const ActiveLifecycleIcon = activeLifecycle.icon;
  const ActiveSituationIcon = activeSituation.icon;

  return (
    <div className="grid gap-8">
      <section id="intelligence-created" className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionLabel>Interactive Engine</SectionLabel>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Explore how operational evidence becomes leadership insight.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Select a capability. Vaeroex shows what it creates, what evidence it uses, why it matters, and what leadership receives.
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[0.88fr_1.12fr] xl:items-start">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
            {intelligenceCapabilities.map((capability, index) => {
              const isActive = index === activeCapabilityIndex;
              const Icon = capability.icon;

              return (
                <button
                  key={capability.title}
                  type="button"
                  onClick={() => setActiveCapabilityIndex(index)}
                  className={[
                    "group rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10 shadow-[0_0_24px_rgba(56,189,248,0.16)]"
                      : "border-white/10 bg-white/[0.055] hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  <div className="flex items-start gap-3">
                    <span className="rounded-lg border border-vaeroex-accent/20 bg-vaeroex-accent/10 p-2 text-vaeroex-accent">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white">{capability.title}</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-300">{capability.short}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-vaeroex-blue/25 bg-[#07101f]/95 p-4 shadow-command lg:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="rounded-xl border border-vaeroex-accent/25 bg-vaeroex-accent/10 p-3 text-vaeroex-accent">
                  <ActiveCapabilityIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <SectionLabel>Selected Capability</SectionLabel>
                  <h3 className="mt-1 text-2xl font-semibold tracking-tight text-white">{activeCapability.title}</h3>
                </div>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(activeCapability.confidence)}`}>
                Confidence: {activeCapability.confidence}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <SectionLabel>What It Creates</SectionLabel>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activeCapability.creates}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <SectionLabel>Why Leadership Benefits</SectionLabel>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activeCapability.leadershipBenefit}</p>
              </div>
            </div>

            <div className="mt-4">
              <SectionLabel>Evidence Used</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeCapability.evidence.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-vaeroex-accent/20 bg-vaeroex-accent/10 p-3">
              <SectionLabel>Example Output</SectionLabel>
              <p className="mt-2 text-sm font-semibold leading-6 text-white">{activeCapability.exampleOutput}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{activeCapability.exampleRecommendation}</p>
            </div>

            <div className="mt-4">
              <SectionLabel>Example Workflow</SectionLabel>
              <div className="mt-2 grid gap-2 md:grid-cols-5">
                {activeCapability.workflow.map((step, index) => (
                  <div key={`${activeCapability.title}-${workflowLabels[index]}`} className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">{workflowLabels[index]}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-200">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-[#0c1728] p-3">
              <SectionLabel>Business Outcome</SectionLabel>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeCapability.businessOutcome}</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="rounded-xl border border-white/10 bg-[#050b18] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionLabel>Lifecycle</SectionLabel>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Information becomes visibility, understanding, prediction, and action.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Select a stage to see the inputs, processing, outputs, and executive result.
          </p>
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-5">
          {intelligenceLifecycle.map((stage, index) => {
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
                <span className="flex items-center justify-between gap-3">
                  <Icon className="h-4 w-4 text-vaeroex-accent" aria-hidden="true" />
                  <span className="text-xs font-semibold text-vaeroex-accent">{String(index + 1).padStart(2, "0")}</span>
                </span>
                <span className="mt-2 block text-sm font-semibold">{stage.title}</span>
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
                <SectionLabel>Selected Stage</SectionLabel>
                <h3 className="mt-1 text-xl font-semibold text-white">{activeLifecycle.title}</h3>
              </div>
            </div>
            <p className="max-w-xl rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3 text-sm font-semibold leading-6 text-slate-100">
              {activeLifecycle.executiveResult}
            </p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <SectionLabel>Inputs</SectionLabel>
              <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-300">
                {activeLifecycle.inputs.map((input) => (
                  <li key={input}>{input}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3 lg:col-span-2">
              <SectionLabel>Processing</SectionLabel>
              <p className="mt-2 text-sm leading-6 text-slate-200">{activeLifecycle.processing}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
              <SectionLabel>Outputs</SectionLabel>
              <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-300">
                {activeLifecycle.outputs.map((output) => (
                  <li key={output}>{output}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-command sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionLabel>Business Situations</SectionLabel>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Explore how Vaeroex interprets real operating conditions.</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            Select a situation to see the problem, evidence, signals, Business Memory, confidence, and leadership-facing recommendation.
          </p>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[0.78fr_1.22fr] xl:items-start">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {executiveSituations.map((situation, index) => {
              const isActive = index === activeSituationIndex;
              const Icon = situation.icon;

              return (
                <button
                  key={situation.title}
                  type="button"
                  onClick={() => setActiveSituationIndex(index)}
                  className={[
                    "rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50",
                    isActive
                      ? "border-vaeroex-accent/70 bg-vaeroex-accent/10"
                      : "border-white/10 bg-white/[0.055] hover:border-vaeroex-blue/50 hover:bg-vaeroex-blue/10"
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  <span className="flex items-start gap-3">
                    <span className="rounded-lg border border-white/10 bg-[#0c1728] p-2 text-vaeroex-accent">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white">{situation.title}</span>
                      <span className="mt-1 block text-sm leading-5 text-slate-300">{situation.short}</span>
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
                  <ActiveSituationIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <SectionLabel>Selected Situation</SectionLabel>
                  <h3 className="mt-1 text-2xl font-semibold tracking-tight text-white">{activeSituation.title}</h3>
                </div>
              </div>
              <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(activeSituation.confidence)}`}>
                Confidence: {activeSituation.confidence}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <SectionLabel>Problem</SectionLabel>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activeSituation.problem}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-3">
                <SectionLabel>Business Memory Used</SectionLabel>
                <p className="mt-2 text-sm leading-6 text-slate-200">{activeSituation.businessMemory}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
                <SectionLabel>Evidence Analyzed</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeSituation.evidenceAnalyzed.map((item) => (
                    <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
                <SectionLabel>Signals Detected</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeSituation.signalsDetected.map((item) => (
                    <span key={item} className="rounded-full border border-white/10 bg-[#0c1728] px-3 py-1.5 text-xs font-semibold text-slate-100">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-vaeroex-accent/20 bg-vaeroex-accent/10 p-3">
                <SectionLabel>Recommendation</SectionLabel>
                <p className="mt-2 text-sm font-semibold leading-6 text-white">{activeSituation.recommendation}</p>
              </div>
              <div className="rounded-lg border border-vaeroex-blue/25 bg-vaeroex-blue/10 p-3">
                <SectionLabel>Leadership Action</SectionLabel>
                <p className="mt-2 text-sm font-semibold leading-6 text-white">{activeSituation.leadershipAction}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
