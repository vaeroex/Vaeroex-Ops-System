import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BusinessHealthAnalysisPanel } from "@/components/intelligence/BusinessHealthAnalysisPanel";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { EligibleBusinessSignals } from "@/components/intelligence/EligibleBusinessSignals";
import type { BusinessHealthAnalysisState, BusinessHealthCitationView, BusinessHealthExplanationFacts } from "@/lib/ai/business-health-explanation/contracts";
import type { ExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import { businessHealthStatus, semanticStatusClass } from "@/lib/presentation/semantic-status";

export type IntelligenceHealthSnapshotProps = {
  health: ExecutiveHomepageModel["health"];
  facts: BusinessHealthExplanationFacts;
  citations: readonly BusinessHealthCitationView[];
  history: BusinessHealthTrendPoint[];
  asOfDate: string;
  historyError?: string | null;
  analysis: { state: BusinessHealthAnalysisState; requestToken: string | null };
};

function evidenceDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No dated supporting evidence";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function contributionPresentation(scoreImpact: number) {
  if (scoreImpact < -5) {
    return { className: "text-red-300", description: "Negative contribution", tone: "negative" };
  }
  if (scoreImpact > 5) {
    return { className: "text-vaeroex-accent", description: "Positive contribution", tone: "positive" };
  }
  return {
    className: "text-amber-200",
    description: scoreImpact === 0 ? "Neutral contribution" : "Minor contribution",
    tone: "minor"
  };
}

function evidenceLinkLabel(citation: BusinessHealthCitationView | undefined) {
  if (!citation) return "View supporting evidence";
  const source = citation.sourceLabel.trim() || citation.title.trim();
  const dated = citation.recordedAt && Number.isFinite(Date.parse(citation.recordedAt));
  if (source && dated) return `${source} · ${evidenceDate(citation.recordedAt)}`;
  if (source) return `View ${source}`;
  if (dated) return `Supporting evidence · ${evidenceDate(citation.recordedAt)}`;
  return "View supporting evidence";
}

// Presentation only: all values and citations come from the existing scoped
// Health calculation/explanation package, including its version-aware comparison.
export function IntelligenceHealthSnapshot({ health, facts, citations, history, asOfDate, historyError, analysis }: IntelligenceHealthSnapshotProps) {
  const status = businessHealthStatus(health.status);
  const citationsById = new Map(citations.map((citation) => [citation.citationId, citation]));
  return (
    <section id="business-health" aria-labelledby="intelligence-health-heading" className="scroll-mt-24 rounded-xl border border-cyan-200/20 bg-vaeroex-navy p-4 text-white sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="intelligence-health-heading" className="text-lg font-semibold">Business Health</h2>
        <span className={`vaeroex-semantic-badge rounded-full border px-3 py-1 text-xs font-semibold ${semanticStatusClass(status)}`}>{health.status}</span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(160px,.65fr)_minmax(0,1.35fr)]">
        <div>
          <p aria-label={health.available ? `Business Health score ${health.score} out of 100` : "Business Health score unavailable"}>
            <span className={health.available ? "text-4xl font-semibold tabular-nums" : "text-xl font-semibold"}>{health.available ? health.score : "Not yet evaluable"}</span>
            {health.available ? <span className="ml-2 text-sm text-slate-300">/ 100</span> : null}
          </p>
          <p className="mt-2 text-sm font-semibold text-cyan-100" data-health-comparison>{facts.comparison}</p>
          <p className="mt-1 text-xs text-slate-300">Confidence: {health.confidence}</p>
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-6">{health.displayTitle}</p>
          <p className="mt-2 text-sm text-slate-300"><span className="font-semibold text-white">Latest supporting evidence:</span> {evidenceDate(facts.latestEvidenceAt)} · {facts.freshness}</p>
          {facts.freshness === "stale" ? <p className="mt-1 text-sm text-amber-200">Supporting evidence is over 45 days old. The score may not reflect the business today.</p> : null}
          {facts.freshness === "unavailable" ? <p className="mt-1 text-sm text-slate-300">Freshness cannot be established from dated supporting evidence.</p> : null}
          <p className="mt-2 text-sm text-slate-300"><span className="font-semibold text-white">Main factor:</span> {health.driverPresentation.identity}</p>
          {health.driverPresentation.details.map(detail => <p key={detail} className="mt-1 text-sm text-slate-300">{detail}</p>)}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <BusinessHealthAnalysisPanel initialState={analysis.state} requestToken={analysis.requestToken} currentFacts={facts} currentCitations={citations} />
        <Link href="/app/reports" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Saved analyses <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        <EligibleBusinessSignals total={health.memorySignals} categories={health.eligibleSignalCategories} />
      </div>
      <details className="mt-4 border-t border-white/15 pt-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Contributing factors and evidence</summary>
        {health.available ? <p className="mt-2 text-sm leading-6 text-slate-300">Performance baseline {facts.dataQualityBase} + positive performance {facts.opportunityAdjustment} − negative performance {facts.riskPenalty} = {health.score} out of 100. Confidence describes evidence coverage; it is not an extra score adjustment.</p> : <p className="mt-2 text-sm leading-6 text-slate-300">{health.summary}</p>}
        <ul className="mt-3 space-y-3">
          {facts.drivers.map((driver, index) => {
            const contribution = contributionPresentation(driver.scoreImpact);
            const signedImpact = `${driver.scoreImpact > 0 ? "+" : ""}${driver.scoreImpact}`;
            return <li key={`${driver.kind}-${driver.label}-${index}`} className="border-l-2 border-cyan-200/40 pl-3 text-sm">
              <p className="font-semibold">{driver.label} <span data-health-score-impact={contribution.tone} className={`font-semibold ${contribution.className}`}><span aria-hidden="true">({signedImpact} points)</span><span className="sr-only">{contribution.description}: {signedImpact} points</span></span></p>
              <p className="mt-1 leading-6 text-slate-300">{driver.fact}</p>
              {driver.limitation ? <p className="mt-1 text-slate-300">{driver.limitation}</p> : null}
              {driver.citationIds.length ? <div className="mt-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Supporting evidence for this factor</p><div className="mt-1 flex flex-wrap gap-2">{driver.citationIds.map((id) => {
                const citation = citationsById.get(id);
                const label = evidenceLinkLabel(citation);
                return <a key={id} href={`#health-evidence-${id}`} aria-label={`${label}. Supporting evidence citation ${id}.`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-cyan-200/30 bg-white/[0.04] px-3 py-2 text-cyan-100 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" data-health-evidence-link={id}>
                  <span>{label}</span><span className="text-xs text-slate-300">Citation {id}</span>
                </a>;
              })}</div></div> : null}
            </li>;
          })}
        </ul>
        {facts.limitations.length ? <div className="mt-4"><h3 className="text-sm font-semibold">Known limitations</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-300">{facts.limitations.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        <h3 className="mt-5 text-sm font-semibold">Supporting evidence ({citations.length})</h3>
        {citations.length ? <ol className="mt-3 space-y-3">{citations.map(citation => <li key={citation.citationId} id={`health-evidence-${citation.citationId}`} tabIndex={-1} className="scroll-mt-24 rounded-lg border border-white/10 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <p className="break-words font-semibold">[{citation.citationId}] {citation.title}</p>
          <p className="mt-1 break-words text-xs text-slate-300">{citation.sourceLabel} · {citation.sourceType} · {evidenceDate(citation.recordedAt)}</p>
          <p className="mt-2 break-words leading-6 text-slate-300">{citation.excerpt}</p>
        </li>)}</ol> : <p className="mt-2 text-sm text-slate-300">No eligible supporting citations are available yet.</p>}
        <Link href="/app/sources" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-100 hover:underline">Review Files &amp; Notes</Link>
      </details>
      <details className="mt-2 border-t border-white/15 pt-2">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Health history</summary>
        <p className="mt-1 text-xs leading-5 text-slate-300">Daily stored reviews preserve the first score recorded that day. The current score above can change as evidence changes. Missing days are not zero scores.</p>
        <BusinessHealthTrendChart points={history} asOfDate={asOfDate} errorMessage={historyError} />
      </details>
    </section>
  );
}
