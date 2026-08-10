import Link from "next/link";
import { ArrowRight, ShieldCheck, TrendingUp } from "lucide-react";
import { BusinessHealthInstrument } from "@/components/intelligence/BusinessHealthInstrument";
import { BusinessHealthAnalysisPanel } from "@/components/intelligence/BusinessHealthAnalysisPanel";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { EligibleBusinessSignals } from "@/components/intelligence/EligibleBusinessSignals";
import { SpatialSurface } from "@/components/spatial/SpatialSurface";
import type {
  BusinessHealthAnalysisState,
  BusinessHealthCitationView,
  BusinessHealthExplanationFacts
} from "@/lib/ai/business-health-explanation/contracts";
import type { ExecutiveHomepageModel, ExecutivePriorityCard } from "@/lib/intelligence/executive-homepage";
import {
  businessHealthStatus,
  findingPriorityStatus,
  intelligenceReadinessStatus,
  semanticPresentation,
  semanticStatusClass
} from "@/lib/presentation/semantic-status";

type ExecutiveHomepageProps = {
  firstName?: string | null;
  lastUpdatedLabel: string;
  model: ExecutiveHomepageModel;
  healthHistory: BusinessHealthTrendPoint[];
  healthHistoryAsOfDate: string;
  healthHistoryError?: string | null;
  businessHealthAnalysis: {
    state: BusinessHealthAnalysisState;
    requestToken: string | null;
    facts: BusinessHealthExplanationFacts;
    citations: readonly BusinessHealthCitationView[];
  };
};

function confidenceTone(confidence: ExecutivePriorityCard["confidence"]) {
  return `vaeroex-confidence-badge vaeroex-confidence-${confidence.toLowerCase()}`;
}

function priorityStatus(card: ExecutivePriorityCard) {
  if (card.tone === "risk") return "critical" as const;
  if (card.tone === "opportunity") return "opportunity" as const;
  return "neutral" as const;
}

function PriorityCard({ card }: { card: ExecutivePriorityCard }) {
  const status = priorityStatus(card);
  const presentation = semanticPresentation(status);
  const Icon = presentation.Icon;
  const priority = semanticPresentation(findingPriorityStatus(card.priority));
  const PriorityIcon = priority.Icon;

  return (
    <SpatialSurface as="article" depth="raised" interactive className={`vaeroex-semantic-card ${semanticStatusClass(status)} flex flex-col rounded-lg border p-4 shadow-panel`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${semanticStatusClass(status)}`}><Icon aria-hidden="true" className="h-3.5 w-3.5" />{card.label}</span>
          {!card.empty ? <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${semanticStatusClass(priority.status)}`}><PriorityIcon aria-hidden="true" className="h-3.5 w-3.5" />{priority.label}</span> : null}
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(card.confidence)}`}>{card.empty ? "No active finding" : `Confidence: ${card.confidence}`}</span>
      </div>
      <h2 className="mt-3 text-lg font-semibold leading-6">{card.title}</h2>
      <p className="mt-2 text-sm leading-6 opacity-80">{card.summary}</p>
      <p className="mt-3 text-xs font-semibold opacity-70">{card.metadata}</p>
      <div className="mt-4">
        <Link
          href={card.href}
          className="vaeroex-semantic-interactive inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 px-3 py-2 text-sm font-semibold hover:bg-blue-950/10"
        >
          {card.actionLabel}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </SpatialSurface>
  );
}

export function ExecutiveHomepage({
  lastUpdatedLabel,
  model,
  healthHistory,
  healthHistoryAsOfDate,
  healthHistoryError,
  businessHealthAnalysis
}: ExecutiveHomepageProps) {
  const trendDelta = model.health.trendDelta;
  const previousReviewSummary = trendDelta === null
    ? "No previous review available."
    : trendDelta === 0
      ? "Unchanged"
      : `${trendDelta > 0 ? "Up" : "Down"} ${Math.abs(trendDelta)} point${Math.abs(trendDelta) === 1 ? "" : "s"}`;
  const risk = model.priorities[0];
  const opportunity = model.priorities[1];
  const decision = model.priorities[2];
  const healthStatus = businessHealthStatus(model.health.status);
  const healthPresentation = semanticPresentation(healthStatus);
  const HealthIcon = healthPresentation.Icon;
  const riskStatus = priorityStatus(risk);
  const riskPresentation = semanticPresentation(riskStatus);
  const RiskIcon = riskPresentation.Icon;
  const riskPriority = semanticPresentation(findingPriorityStatus(risk.priority));
  const RiskPriorityIcon = riskPriority.Icon;
  const readinessStatus = intelligenceReadinessStatus(model.readiness.label);
  const readinessPresentation = semanticPresentation(readinessStatus);
  const ReadinessIcon = readinessPresentation.Icon;

  return (
    <div className="vaeroex-priority-surface space-y-5">
      <header className="flex flex-col gap-2 border-b border-line/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Executive Overview</h1>
          <p className="mt-1 text-sm text-muted">What leadership should know now.</p>
        </div>
        <p className="text-xs text-muted">Last updated {lastUpdatedLabel}</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]" data-executive-opening>
        <SpatialSurface as="section" depth="focus" className={`vaeroex-business-health-surface vaeroex-semantic-frame ${semanticStatusClass(healthStatus)} overflow-hidden border-x-0 bg-vaeroex-navy p-5 text-white shadow-command xl:col-span-2`} ariaLabelledBy="business-health-heading">
          <div className="grid gap-5 lg:grid-cols-[minmax(220px,.62fr)_minmax(0,1.38fr)] lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p id="business-health-heading" className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Business Health</p>
                <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${semanticStatusClass(healthStatus)}`}><HealthIcon aria-hidden="true" className="h-3.5 w-3.5" />{model.health.status}</span>
              </div>
              <div className="mt-4">
                <BusinessHealthInstrument score={model.health.available ? model.health.score : null} status={model.health.status} />
              </div>
              {!model.health.available ? <p className="mt-4 text-xl font-semibold">Business Health needs more eligible evidence.</p> : null}
              {model.health.available ? (
                <dl className="mt-5 grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-1">
                  <div>
                    <dt className="text-xs font-semibold text-cyan-200">Current state</dt>
                    <dd className="mt-1 font-semibold text-white">
                      {model.health.status} · {model.health.trend || "Trajectory unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-cyan-200">Since previous review</dt>
                    <dd className="mt-1 text-slate-200">{previousReviewSummary}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-cyan-200">Confidence</dt>
                    <dd className="mt-1 font-semibold text-white">{model.health.confidence}</dd>
                  </div>
                </dl>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                {businessHealthAnalysis.state.status === "current" ? "Validated executive interpretation" : "Current assessment"}
              </p>
              <h2 className="text-xl font-semibold leading-7 sm:text-2xl">{model.health.displayTitle}</h2>
              {businessHealthAnalysis.state.status === "current" && businessHealthAnalysis.state.artifact ? (
                <p className="mt-3 text-sm leading-6 text-slate-200">{businessHealthAnalysis.state.artifact.analysis.executive_interpretation}</p>
              ) : null}
              <dl className="mt-4 border-t border-white/10 pt-4 text-sm">
                <div className={`vaeroex-semantic-detail border-l-2 pl-3 ${semanticStatusClass(healthStatus)}`}>
                  <dt className="text-xs font-semibold text-cyan-200">Highest Impact Driver</dt>
                  <dd className="mt-1 leading-6 text-slate-200">
                    <span className="block font-semibold text-white">{model.health.driverPresentation.identity}</span>
                    {model.health.driverPresentation.details.map((detail) => (
                      <span key={detail} className="block">{detail}</span>
                    ))}
                  </dd>
                </div>
              </dl>
              <div className="mt-3">
                <EligibleBusinessSignals
                  total={model.health.memorySignals}
                  categories={model.health.eligibleSignalCategories}
                />
              </div>
              <BusinessHealthAnalysisPanel
                initialState={businessHealthAnalysis.state}
                requestToken={businessHealthAnalysis.requestToken}
                currentFacts={businessHealthAnalysis.facts}
                currentCitations={businessHealthAnalysis.citations}
              />
            </div>
          </div>

          {model.health.available ? (
            <BusinessHealthTrendChart
              points={healthHistory}
              asOfDate={healthHistoryAsOfDate}
              errorMessage={healthHistoryError}
            />
          ) : null}
        </SpatialSurface>
      </div>

      <section aria-label="Executive priorities" className="grid items-start gap-4 lg:grid-cols-[1fr_1fr_.78fr]">
        <SpatialSurface as="article" depth="raised" interactive className={`vaeroex-semantic-card ${semanticStatusClass(riskStatus)} rounded-lg border p-4 shadow-panel`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${semanticStatusClass(riskStatus)}`}><RiskIcon aria-hidden="true" className="h-3.5 w-3.5" />Needs Attention</span>
              {!risk.empty ? <span className={`vaeroex-semantic-badge inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${semanticStatusClass(riskPriority.status)}`}><RiskPriorityIcon aria-hidden="true" className="h-3.5 w-3.5" />{riskPriority.label}</span> : null}
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(risk.confidence)}`}>{risk.empty ? "No active finding" : `Confidence: ${risk.confidence}`}</span>
          </div>
          <h2 className="mt-3 text-lg font-semibold leading-6">{risk.title}</h2>
          <p className="mt-2 text-sm leading-6 opacity-80">{risk.summary}</p>
          {!decision.empty ? <p className="mt-3 border-t border-current/10 pt-3 text-sm leading-6"><span className="font-semibold">Decision:</span> {decision.summary}</p> : null}
          <Link href={risk.href} className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold hover:underline">{risk.actionLabel} <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </SpatialSurface>
        <PriorityCard card={{ ...opportunity, label: "Top Opportunity" }} />
        <SpatialSurface as="article" depth="subtle" className={`vaeroex-semantic-card ${semanticStatusClass(readinessStatus)} rounded-lg border p-4 shadow-panel`}>
          <div className="flex items-center gap-2">
            <ReadinessIcon aria-hidden="true" className="h-5 w-5" />
            <h2 className="text-base font-semibold text-ink">Intelligence readiness</h2>
          </div>
          {model.readiness.available ? (
            <>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold text-ink">{model.readiness.coverage}%</p>
                  <p className="mt-1 text-sm font-semibold text-muted">{model.readiness.label} understanding</p>
                </div>
                <ShieldCheck aria-label={`${model.readiness.label} intelligence readiness`} className="h-8 w-8" />
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
        </SpatialSurface>
      </section>

      <SpatialSurface as="section" depth="subtle" className="rounded-lg border border-line/80 bg-white px-4 py-3 shadow-panel" ariaLabel="What changed">
        <div className="flex items-start gap-2">
          <TrendingUp aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-vaeroex-blue" />
          {model.changes.items.length ? (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">What changed</p>
              <p className="mt-1 text-xs leading-5 text-muted">{model.changes.items[0].title}: {model.changes.items[0].detail}</p>
            </div>
          ) : <p className="text-sm leading-6 text-muted">{model.changes.message}</p>}
        </div>
      </SpatialSurface>
    </div>
  );
}
