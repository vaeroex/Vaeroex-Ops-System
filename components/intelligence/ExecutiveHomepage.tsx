import Link from "next/link";
import { ArrowRight, ShieldCheck, TrendingUp } from "lucide-react";
import { type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { SpatialSurface } from "@/components/spatial/SpatialSurface";
import type {
  BusinessHealthAnalysisState,
  BusinessHealthCitationView,
  BusinessHealthExplanationFacts
} from "@/lib/ai/business-health-explanation/contracts";
import type { ExecutiveHomepageModel, ExecutivePriorityCard } from "@/lib/intelligence/executive-homepage";
import {
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
  healthVisual?: "scorecard" | "arc";
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
    <SpatialSurface as="article" depth="raised" interactive className={`workspace-priority-card vaeroex-semantic-card ${semanticStatusClass(status)} flex flex-col rounded-lg border p-4 shadow-panel`}>
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
      <div className="mt-auto pt-4">
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
}: ExecutiveHomepageProps) {
  const risk = model.priorities[0];
  const opportunity = model.priorities[1];
  const decision = model.priorities[2];
  const riskStatus = priorityStatus(risk);
  const riskPresentation = semanticPresentation(riskStatus);
  const RiskIcon = riskPresentation.Icon;
  const riskPriority = semanticPresentation(findingPriorityStatus(risk.priority));
  const RiskPriorityIcon = riskPriority.Icon;
  const readinessStatus = intelligenceReadinessStatus(model.readiness.label);
  const readinessPresentation = semanticPresentation(readinessStatus);
  const ReadinessIcon = readinessPresentation.Icon;

  return (
    <div className="workspace-executive-overview vaeroex-priority-surface space-y-6">
      <header className="workspace-page-header flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Executive Overview</h1>
          <p className="mt-1 text-sm text-muted">What leadership should know now.</p>
        </div>
        <p className="shrink-0 text-xs text-muted">Last updated {lastUpdatedLabel}</p>
      </header>

      <section aria-label="Business Health in Intelligence" className="rounded-xl border border-cyan-200/25 bg-vaeroex-navy p-5 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Business Health is part of Intelligence</h2>
            <p className="mt-1 text-sm text-slate-300">Review the score, movement, freshness and contributing evidence alongside current findings.</p>
          </div>
          <Link href="/app/intelligence#business-health" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-cyan-200/30 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
            Review Business Health <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section aria-label="Executive priorities" className="workspace-executive-priorities grid items-stretch gap-4 lg:grid-cols-[1fr_1fr_.78fr]">
        <SpatialSurface as="article" depth="raised" interactive className={`workspace-priority-card vaeroex-semantic-card ${semanticStatusClass(riskStatus)} flex flex-col rounded-lg border p-4 shadow-panel`}>
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
          <Link href={risk.href} className="mt-auto inline-flex min-h-10 items-center gap-2 pt-4 text-sm font-semibold hover:underline">{risk.actionLabel} <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </SpatialSurface>
        <PriorityCard card={{ ...opportunity, label: "Top Opportunity" }} />
        <SpatialSurface as="article" depth="subtle" className={`workspace-readiness-card workspace-priority-card vaeroex-semantic-card ${semanticStatusClass(readinessStatus)} rounded-lg border p-4 shadow-panel`}>
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

      <SpatialSurface as="section" depth="subtle" className="workspace-change-summary rounded-lg border border-line/80 bg-white px-4 py-3 shadow-panel" ariaLabel="What changed">
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
