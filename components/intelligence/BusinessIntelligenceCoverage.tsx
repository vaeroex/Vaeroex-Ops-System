import type { BusinessIntelligenceCoverageItem, BusinessIntelligenceCoverageResult } from "@/lib/intelligence/coverage";

type BusinessIntelligenceCoverageProps = {
  coverage: BusinessIntelligenceCoverageResult;
  compact?: boolean;
};

function confidenceTone(value: number) {
  if (value <= 25) return "bg-red-400";
  if (value <= 45) return "bg-amber-400";
  if (value <= 65) return "bg-blue-400";
  if (value <= 80) return "bg-cyan-300";
  return "bg-emerald-300";
}

function badgeTone(label: string) {
  if (label === "Very Limited") return "border-red-400/40 bg-red-950/35 text-red-100";
  if (label === "Learning") return "border-amber-400/40 bg-amber-950/35 text-amber-100";
  if (label === "Partial") return "border-blue-400/40 bg-blue-950/35 text-blue-100";
  if (label === "Good") return "border-cyan-400/35 bg-cyan-950/30 text-cyan-100";
  return "border-emerald-400/35 bg-emerald-950/30 text-emerald-100";
}

function formatDate(value: string | null) {
  if (!value) return "No update yet";
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function svgPoints(points: BusinessIntelligenceCoverageResult["confidenceOverTime"]) {
  if (!points.length) return "";
  const width = 320;
  const height = 96;
  const maxIndex = Math.max(1, points.length - 1);

  return points
    .map((point, index) => {
      const x = (index / maxIndex) * width;
      const y = height - (point.value / 100) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function CoverageRow({ item }: { item: BusinessIntelligenceCoverageItem }) {
  return (
    <details className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <summary className="grid cursor-pointer gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_120px_130px] sm:items-center">
        <div>
          <span className="font-semibold text-white">{item.label}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-400">
            {item.sourceCount} source{item.sourceCount === 1 ? "" : "s"} · {item.dataQualityLabel}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-950/80">
          <div className={`h-full rounded-full ${confidenceTone(item.coverage)}`} style={{ width: `${item.coverage}%` }} />
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <span className="font-mono text-sm font-semibold text-white">{item.coverage}%</span>
          <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold ${badgeTone(item.confidenceLabel)}`}>
            {item.confidenceLabel}
          </span>
        </div>
      </summary>
      <div className="mt-4 grid gap-4 text-xs leading-5 text-slate-300 lg:grid-cols-[1fr_.85fr]">
        <div className="space-y-3">
          <p>{item.reason}</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <dt className="font-semibold text-white">Last updated</dt>
              <dd className="mt-1">{formatDate(item.lastUpdated)}</dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <dt className="font-semibold text-white">History</dt>
              <dd className="mt-1">{item.historyMonths} month{item.historyMonths === 1 ? "" : "s"} visible</dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <dt className="font-semibold text-white">Structured sources</dt>
              <dd className="mt-1">{item.structuredSourceCount} of {item.sourceCount}</dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <dt className="font-semibold text-white">Forecast support</dt>
              <dd className="mt-1">{item.forecastReady ? "Directional support available" : "Needs more history"}</dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="font-semibold text-white">Evidence</p>
          <ul className="mt-2 space-y-2">
            {item.evidence.length ? (
              item.evidence.map((entry) => (
                <li key={entry} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                  <span>{entry}</span>
                </li>
              ))
            ) : (
              <li>No source evidence is available yet.</li>
            )}
          </ul>
          <p className="mt-3 font-semibold text-white">Recommended next upload</p>
          <p className="mt-1">{item.recommendedNextUpload}</p>
        </div>
      </div>
    </details>
  );
}

function ConfidenceLine({ coverage }: { coverage: BusinessIntelligenceCoverageResult }) {
  const points = coverage.confidenceOverTime;
  const polyline = svgPoints(points);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Confidence Over Time</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">Derived from stored source dates, not a prediction claim.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeTone(coverage.overallConfidenceLabel)}`}>
          {coverage.overallConfidenceLabel}
        </span>
      </div>
      {points.length ? (
        <div className="mt-4">
          <svg viewBox="0 0 320 110" className="h-28 w-full overflow-visible" role="img" aria-label="Vaeroex confidence over time">
            <line x1="0" y1="96" x2="320" y2="96" stroke="rgba(148,163,184,.24)" />
            <line x1="0" y1="48" x2="320" y2="48" stroke="rgba(148,163,184,.16)" />
            <polyline points={polyline} fill="none" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point, index) => {
              const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 320;
              const y = 96 - (point.value / 100) * 96;
              return <circle key={`${point.label}-${point.value}`} cx={x} cy={y} r="4" fill="#1E6BFF" stroke="#F8FAFC" strokeWidth="1.5" />;
            })}
          </svg>
          <div className="mt-2 flex justify-between gap-2 text-[0.68rem] text-slate-400">
            <span>{points[0]?.label}</span>
            <span>{points.at(-1)?.label}</span>
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm leading-6 text-slate-300">
          No confidence timeline exists yet. Add source data over time to build memory.
        </p>
      )}
    </div>
  );
}

function SourceMix({ coverage }: { coverage: BusinessIntelligenceCoverageResult }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <h3 className="text-sm font-semibold text-white">Source Mix</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">What Vaeroex is learning from right now.</p>
      <div className="mt-4 space-y-3">
        {coverage.sourceMix.length ? (
          coverage.sourceMix.slice(0, 7).map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-slate-200">{item.label}</span>
                <span className="text-slate-400">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-950/80">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1E6BFF] to-[#38BDF8]" style={{ width: `${Math.max(4, item.percentage)}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm leading-6 text-slate-300">
            No sources have been added yet.
          </p>
        )}
      </div>
    </div>
  );
}

export function BusinessIntelligenceCoveragePanel({ coverage, compact = false }: BusinessIntelligenceCoverageProps) {
  const visibleCategories = compact ? coverage.categories.slice(0, 6) : coverage.categories;

  return (
    <section className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Business Intelligence Coverage</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">{coverage.overallCoverage}% covered</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{coverage.overallReason}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${badgeTone(coverage.overallConfidenceLabel)}`}>
            {coverage.overallConfidenceLabel}
          </span>
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${coverage.forecastReadiness.ready ? "border-cyan-300/35 bg-cyan-950/30 text-cyan-100" : "border-amber-400/35 bg-amber-950/30 text-amber-100"}`}>
            {coverage.forecastReadiness.label}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-3">
          {visibleCategories.map((item) => (
            <CoverageRow key={item.id} item={item} />
          ))}
          {compact ? (
            <details className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-cyan-100">View all coverage categories</summary>
              <div className="mt-3 space-y-3">
                {coverage.categories.slice(6).map((item) => (
                  <CoverageRow key={item.id} item={item} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <div className="space-y-4">
          <ConfidenceLine coverage={coverage} />
          <SourceMix coverage={coverage} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_.85fr]">
        <div className="rounded-lg border border-amber-400/25 bg-amber-950/20 p-4">
          <h3 className="text-sm font-semibold text-amber-100">Data Gaps</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50/85">
            {coverage.dataGaps.slice(0, compact ? 3 : 5).map((gap) => (
              <li key={gap} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-4">
          <h3 className="text-sm font-semibold text-cyan-100">Recommended Next Upload</h3>
          <p className="mt-3 text-sm leading-6 text-cyan-50/85">{coverage.recommendedNextUpload}</p>
          <p className="mt-3 text-xs leading-5 text-slate-400">{coverage.forecastReadiness.reason}</p>
        </div>
      </div>
    </section>
  );
}

export function BusinessIntelligenceCoverageSummary({ coverage }: { coverage: BusinessIntelligenceCoverageResult }) {
  const weakest = [...coverage.categories].sort((a, b) => a.coverage - b.coverage)[0];

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-slate-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Business Intelligence Coverage</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{coverage.overallCoverage}% · {coverage.overallConfidenceLabel}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">{coverage.overallReason}</p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${badgeTone(coverage.overallConfidenceLabel)}`}>
          {coverage.forecastReadiness.label}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {coverage.categories.slice(0, 3).map((item) => (
          <div key={item.id} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
            <p className="text-xs font-semibold text-slate-400">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-white">{item.coverage}%</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-950/80">
              <div className={`h-full rounded-full ${confidenceTone(item.coverage)}`} style={{ width: `${item.coverage}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-400">
        Weakest area: {weakest?.label || "No category yet"}. {weakest?.recommendedNextUpload || coverage.recommendedNextUpload}
      </p>
    </div>
  );
}
