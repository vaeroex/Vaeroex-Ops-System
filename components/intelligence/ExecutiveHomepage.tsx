import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Database, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { generateReportAction } from "@/app/app/reports/actions";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import type { ExecutiveHomepageModel, ExecutivePriorityCard } from "@/lib/intelligence/executive-homepage";

type ExecutiveHomepageProps = {
  firstName?: string | null;
  lastUpdatedLabel: string;
  model: ExecutiveHomepageModel;
  healthHistory: BusinessHealthTrendPoint[];
  healthHistoryError?: string | null;
  isDemoWorkspace: boolean;
  reportReadiness: {
    canGenerate: boolean;
    reason: string;
    latestReportHref?: Route | null;
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
    <article className={`flex min-h-[230px] flex-col rounded-lg border p-5 shadow-panel ${priorityTone(card.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">{card.label}</p>
        <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(card.confidence)}`}>
          {card.empty ? "No active finding" : `Confidence: ${card.confidence}`}
        </span>
      </div>
      <h2 className="mt-4 text-lg font-semibold leading-6">{card.title}</h2>
      <p className="mt-2 text-sm leading-6 opacity-80">{card.summary}</p>
      <p className="mt-3 text-xs font-semibold opacity-70">{card.metadata}</p>
      <div className="mt-auto pt-5">
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
  isDemoWorkspace,
  reportReadiness
}: ExecutiveHomepageProps) {
  const heading = firstName ? `Good morning, ${firstName}` : "Executive overview";
  const trendDelta = model.health.trendDelta;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-line/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-sm text-muted">Here is what leadership should know now.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <p className="text-xs text-muted">Last updated {lastUpdatedLabel}</p>
          <Link href="/app/intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
            View full intelligence
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {isDemoWorkspace ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-300/25 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-50">
          <span><strong>Demo workspace:</strong> sample business evidence is active.</span>
          <span className="text-xs text-cyan-100/75">No real customer notifications are sent.</span>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg bg-vaeroex-navy p-5 text-white shadow-command sm:p-6" aria-labelledby="business-health-heading">
        <div className="grid gap-6 lg:grid-cols-[minmax(230px,.72fr)_minmax(0,1.28fr)] lg:items-start">
          <div>
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
              <p className="mt-5 text-2xl font-semibold">Business Health needs more eligible evidence.</p>
            )}
            {model.health.available ? (
              <p className="mt-3 text-sm text-slate-300">
                {trendDelta === null
                  ? "Trend will appear after additional dated evidence is available."
                  : `${trendDelta > 0 ? "Up" : trendDelta < 0 ? "Down" : "Unchanged"} ${Math.abs(trendDelta)} point${Math.abs(trendDelta) === 1 ? "" : "s"} since the previous stored review.`}
              </p>
            ) : null}
          </div>

          <div>
            <h2 className="text-xl font-semibold leading-7 sm:text-2xl">{model.health.summary}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                <p className="text-xs font-semibold text-cyan-200">Primary driver</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{model.health.driver}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                <p className="text-xs font-semibold text-cyan-200">Intelligence confidence</p>
                <p className="mt-2 text-lg font-semibold">{model.health.confidence}</p>
                <p className="mt-1 text-xs text-slate-300">{model.health.memorySignals} eligible evidence signal{model.health.memorySignals === 1 ? "" : "s"}</p>
              </div>
            </div>
            <Link href="/app/intelligence" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">
              View supporting evidence
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {model.health.available ? (
          <BusinessHealthTrendChart
            points={healthHistory}
            currentScore={model.health.score || 0}
            currentStatus={model.health.status}
            currentTrend={model.health.trend || "Not enough history"}
            isDemoWorkspace={isDemoWorkspace}
            errorMessage={healthHistoryError}
          />
        ) : null}
      </section>

      <section aria-label="Executive priorities" className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {model.priorities.map((card) => <PriorityCard key={card.label} card={card} />)}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-lg border border-line/80 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            {model.changes.state === "changes" ? <TrendingUp aria-hidden="true" className="h-5 w-5 text-vaeroex-blue" /> : <TrendingDown aria-hidden="true" className="h-5 w-5 text-slate-500" />}
            <h2 className="text-base font-semibold text-ink">What changed since your last review</h2>
          </div>
          {model.changes.items.length ? (
            <ul className="mt-4 divide-y divide-line/70">
              {model.changes.items.map((item) => (
                <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">{model.changes.message}</p>
          )}
        </div>

        <div className="rounded-lg border border-line/80 bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <Database aria-hidden="true" className="h-5 w-5 text-vaeroex-blue" />
            <h2 className="text-base font-semibold text-ink">Intelligence readiness</h2>
          </div>
          {model.readiness.available ? (
            <>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-semibold text-ink">{model.readiness.coverage}%</p>
                  <p className="mt-1 text-sm font-semibold text-muted">{model.readiness.label} understanding</p>
                </div>
                <ShieldCheck aria-label={`${model.readiness.label} intelligence readiness`} className="h-8 w-8 text-vaeroex-blue" />
              </div>
              <dl className="mt-5 grid gap-3 text-sm">
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
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/app/intelligence" className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-blue-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">View coverage details</Link>
            {model.readiness.available && model.readiness.showAddInformation ? (
              <Link href="/app/sources" className="inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60">Add information</Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-line/80 bg-white p-5 shadow-panel lg:flex-row lg:items-center lg:justify-between" aria-labelledby="executive-brief-heading">
        <div className="max-w-2xl">
          <h2 id="executive-brief-heading" className="text-base font-semibold text-ink">Executive Brief</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Package the current evidence into a concise leadership review. The report remains derived analysis and does not increase Business Health or evidence coverage.</p>
          {!reportReadiness.canGenerate ? <p className="mt-2 text-xs font-semibold text-amber-700">{reportReadiness.reason}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reportReadiness.latestReportHref ? <Link href={reportReadiness.latestReportHref} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-blue-950/10">View latest</Link> : null}
          <Link href="/app/reports" className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-blue-950/10">All reports</Link>
          <form action={generateReportAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="return_path" value="/app" />
            <input type="hidden" name="report_type" value="Executive Brief" />
            <input type="hidden" name="category" value="All" />
            <input type="hidden" name="anchor_date" value={new Date().toISOString().slice(0, 10)} />
            <select name="report_period" defaultValue="Last 7 days" aria-label="Executive Brief period" className="min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">
              <option>Today</option>
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
            <PendingSubmitButton disabled={!reportReadiness.canGenerate} pendingLabel="Generating brief..." className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Generate brief</PendingSubmitButton>
          </form>
        </div>
      </section>
    </div>
  );
}
