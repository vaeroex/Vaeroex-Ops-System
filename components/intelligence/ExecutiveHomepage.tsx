import Link from "next/link";
import { ArrowRight, Database, ShieldCheck, TrendingUp } from "lucide-react";
import { BusinessHealthAnalysisPanel } from "@/components/intelligence/BusinessHealthAnalysisPanel";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { ExecutiveBriefPanel } from "@/components/intelligence/ExecutiveBriefPanel";
import type {
  BusinessHealthAnalysisState,
  BusinessHealthCitationView,
  BusinessHealthExplanationFacts
} from "@/lib/ai/business-health-explanation/contracts";
import type {
  ExecutiveBriefCitationView,
  ExecutiveBriefFacts,
  ExecutiveBriefSignal,
  ExecutiveBriefState
} from "@/lib/ai/executive-brief/contracts";
import type { ExecutiveHomepageModel, ExecutivePriorityCard } from "@/lib/intelligence/executive-homepage";

type ExecutiveHomepageProps = {
  firstName?: string | null;
  lastUpdatedLabel: string;
  model: ExecutiveHomepageModel;
  healthHistory: BusinessHealthTrendPoint[];
  healthHistoryError?: string | null;
  executiveBrief: {
    state: ExecutiveBriefState;
    requestToken: string | null;
    facts: ExecutiveBriefFacts;
    signals: readonly ExecutiveBriefSignal[];
    citations: readonly ExecutiveBriefCitationView[];
  };
  businessHealthAnalysis: {
    state: BusinessHealthAnalysisState;
    requestToken: string | null;
    facts: BusinessHealthExplanationFacts;
    citations: readonly BusinessHealthCitationView[];
  };
};

function priorityTone(tone: ExecutivePriorityCard["tone"]) {
  if (tone === "risk") return "border-line border-l-4 border-l-red-500 bg-white text-ink";
  if (tone === "opportunity") return "border-line border-l-4 border-l-emerald-500 bg-white text-ink";
  return "border-line border-l-4 border-l-vaeroex-blue bg-white text-ink";
}

function confidenceTone(confidence: ExecutivePriorityCard["confidence"]) {
  if (confidence === "High") return "border-emerald-400/40 bg-emerald-950/20 text-emerald-700 dark:text-emerald-100";
  if (confidence === "Medium") return "border-amber-400/40 bg-amber-950/20 text-amber-800 dark:text-amber-100";
  return "border-slate-400/40 bg-slate-950/10 text-slate-600 dark:text-slate-200";
}

function healthTone(status: string) {
  if (status === "Healthy") return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  if (status === "Watch") return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  if (status === "Critical") return "border-red-300/40 bg-red-400/10 text-red-100";
  return "border-slate-300/30 bg-white/[0.05] text-slate-200";
}

function PriorityCard({ card }: { card: ExecutivePriorityCard }) {
  return (
    <article className={`flex flex-col rounded-lg border p-4 shadow-panel ${priorityTone(card.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">{card.label}</p>
        <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(card.confidence)}`}>
          {card.empty ? "No active finding" : `Confidence: ${card.confidence}`}
        </span>
      </div>
      <h2 className="mt-3 text-lg font-semibold leading-6">{card.title}</h2>
      <p className="mt-2 text-sm leading-6 opacity-80">{card.summary}</p>
      <p className="mt-3 text-xs font-semibold opacity-70">{card.metadata}</p>
      <div className="mt-4">
        <Link
          href={card.href}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-sm font-semibold hover:bg-blue-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          {card.actionLabel}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

export function ExecutiveHomepage({
  firstName,
  lastUpdatedLabel,
  model,
  healthHistory,
  healthHistoryError,
  executiveBrief,
  businessHealthAnalysis
}: ExecutiveHomepageProps) {
  const heading = firstName ? `Good morning, ${firstName}` : "Executive overview";
  const trendDelta = model.health.trendDelta;
  const risk = model.priorities[0];
  const opportunity = model.priorities[1];
  const decision = model.priorities[2];
  const showHealthTrend = model.health.available && trendDelta !== null && healthHistory.length >= 2;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 border-b border-line/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-muted">What leadership should know now.</p>
        </div>
        <p className="text-xs text-muted">Last updated {lastUpdatedLabel}</p>
      </header>

      <section className="overflow-hidden rounded-lg bg-vaeroex-navy text-white shadow-command" data-executive-opening aria-label="Executive opening brief">
        <div className="grid xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
          <article className="min-w-0 p-5 sm:p-6">
            <ExecutiveBriefPanel
              initialState={executiveBrief.state}
              requestToken={executiveBrief.requestToken}
              currentFacts={executiveBrief.facts}
              currentSignals={executiveBrief.signals}
              currentCitations={executiveBrief.citations}
            />
          </article>

          <section className="min-w-0 border-t border-white/10 p-5 sm:p-6 xl:border-l xl:border-t-0" aria-labelledby="business-health-heading">
            <div className="flex flex-wrap items-center gap-2">
              <p id="business-health-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Business Health</p>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${healthTone(model.health.status)}`}>{model.health.status}</span>
            </div>
            {model.health.available && model.health.score !== null ? (
              <div className="mt-4 flex items-end gap-2" aria-label={`Business Health score ${model.health.score} out of 100`}>
                <span className="text-6xl font-semibold">{model.health.score}</span>
                <span className="pb-2 text-lg text-slate-300">/ 100</span>
              </div>
            ) : (
              <p className="mt-5 text-xl font-semibold leading-7">Business Health needs more eligible evidence.</p>
            )}
            {model.health.available ? (
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {trendDelta === null
                  ? "Trend will appear after additional dated evidence is available."
                  : `${trendDelta > 0 ? "Up" : trendDelta < 0 ? "Down" : "Unchanged"} ${Math.abs(trendDelta)} point${Math.abs(trendDelta) === 1 ? "" : "s"} since the previous stored review.`}
              </p>
            ) : null}
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              {businessHealthAnalysis.state.status === "current" ? "Validated score explanation" : "Current assessment"}
            </p>
            <h2 className="mt-1 text-xl font-semibold leading-7">{model.health.summary}</h2>
            {businessHealthAnalysis.state.status === "current" && businessHealthAnalysis.state.artifact ? (
              <p className="mt-3 text-sm leading-6 text-slate-200">{businessHealthAnalysis.state.artifact.analysis.executive_interpretation}</p>
            ) : null}
            <dl className="mt-4 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1">
              <div>
                <dt className="text-xs font-semibold text-cyan-200">Main driver</dt>
                <dd className="mt-1 leading-6 text-slate-200">{model.health.driver}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-cyan-200">Confidence</dt>
                <dd className="mt-1 font-semibold text-white">{model.health.confidence}</dd>
                <dd className="mt-1 text-xs text-slate-300">{model.health.memorySignals} eligible signal{model.health.memorySignals === 1 ? "" : "s"}</dd>
              </div>
            </dl>
            <BusinessHealthAnalysisPanel
              initialState={businessHealthAnalysis.state}
              requestToken={businessHealthAnalysis.requestToken}
              currentFacts={businessHealthAnalysis.facts}
              currentCitations={businessHealthAnalysis.citations}
            />
          </section>
        </div>

        {showHealthTrend ? (
          <div className="border-t border-white/10 px-5 pb-5 sm:px-6 sm:pb-6">
            <BusinessHealthTrendChart
              points={healthHistory}
              currentScore={model.health.score || 0}
              currentStatus={model.health.status}
              currentTrend={model.health.trend || "Not enough history"}
              errorMessage={healthHistoryError}
            />
          </div>
        ) : null}
      </section>

      <section aria-label="Executive priorities" className="grid items-start gap-4 lg:grid-cols-[1fr_1fr_.78fr]">
        <article className={`rounded-lg border p-4 shadow-panel ${priorityTone(risk.tone)}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">Needs Attention</p>
            <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(risk.confidence)}`}>{risk.empty ? "No active finding" : `Confidence: ${risk.confidence}`}</span>
          </div>
          <h2 className="mt-3 text-lg font-semibold leading-6">{risk.title}</h2>
          <p className="mt-2 text-sm leading-6 opacity-80">{risk.summary}</p>
          {!decision.empty ? <p className="mt-3 border-t border-current/10 pt-3 text-sm leading-6"><span className="font-semibold">Decision:</span> {decision.summary}</p> : null}
          <Link href={risk.href} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold hover:underline">{risk.actionLabel} <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </article>
        <PriorityCard card={{ ...opportunity, label: "Positive Signal" }} />
        <div className="rounded-lg border border-line/80 bg-white p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <Database aria-hidden="true" className="h-5 w-5 text-vaeroex-blue" />
            <h2 className="text-base font-semibold text-ink">Intelligence readiness</h2>
          </div>
          {model.readiness.available ? (
            <>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold text-ink">{model.readiness.coverage}%</p>
                  <p className="mt-1 text-sm font-semibold text-muted">{model.readiness.label} understanding</p>
                </div>
                <ShieldCheck aria-label={`${model.readiness.label} intelligence readiness`} className="h-8 w-8 text-vaeroex-blue" />
              </div>
              <dl className="mt-4 grid gap-2 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-muted">Strongest area</dt>
                  <dd className="mt-1 font-semibold text-ink">{model.readiness.strongestArea} — {model.readiness.strongestCoverage}%</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">Largest gap</dt>
                  <dd className="mt-1 font-semibold text-ink">{model.readiness.largestGap}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">Recommended next source</dt>
                  <dd className="mt-1 leading-6 text-ink">{model.readiness.recommendedNextSource}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">Readiness is limited until Vaeroex has enough eligible original evidence to assess the business reliably.</p>
          )}
          {model.readiness.available && model.readiness.showAddInformation ? <Link href="/app/sources" className="mt-4 inline-flex min-h-10 items-center text-sm font-semibold text-vaeroex-blue hover:underline">Add information</Link> : null}
        </div>
      </section>

      <section className="rounded-lg border border-line/80 bg-white px-4 py-3 shadow-panel" aria-label="What changed">
        <div className="flex items-start gap-2">
          <TrendingUp aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-vaeroex-blue" />
          {model.changes.items.length ? (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">What changed</p>
              <p className="mt-1 text-xs leading-5 text-muted">{model.changes.items[0].title}: {model.changes.items[0].detail}</p>
            </div>
          ) : <p className="text-sm leading-6 text-muted">{model.changes.message}</p>}
        </div>
      </section>
    </div>
  );
}
