import { isPercentageUnit, comparisonChange, comparisonDomain, comparisonValue, type Comparison } from "@/lib/charts/comparison";

export function ComparisonCharts({ charts, heading = "Evidence comparisons" }: { charts: readonly Comparison[]; heading?: string }) {
  if (!charts.length) return null;
  return <section className="my-5 space-y-3" aria-label={heading} data-comparison-charts>
    <h3 className="text-sm font-semibold text-slate-800">{heading}</h3>
    <div className="comparison-grid grid gap-4">
      {charts.map(chart => {
        const { delta, percent, outcome } = comparisonChange(chart), domain = comparisonDomain(chart);
        const y = (value: number) => 130 - (value - domain.min) / (domain.max - domain.min) * 110;
        const zero = y(0), fill = outcome === "favorable" ? "var(--comparison-positive)" : outcome === "unfavorable" ? "var(--comparison-negative)" : "var(--comparison-neutral)";
        return <figure key={chart.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm" data-comparison={chart.id}>
          <figcaption><h4 className="text-base font-semibold text-slate-900">{chart.title}</h4><p className="mt-1 text-xs leading-5 text-slate-600">{chart.context}</p></figcaption>
          <svg viewBox="0 0 300 164" className="mt-3 w-full" aria-hidden="true">
            <line x1="18" x2="282" y1={zero} y2={zero} stroke="#94a3b8" />
            <text x="5" y={zero + 4} fontSize="9" fill="var(--comparison-muted)">0</text>
            {[chart.before, chart.after].map((point, index) => {
              const top = Math.min(y(point.value), zero), height = Math.abs(y(point.value) - zero), center = index === 0 ? 83 : 217;
              return <g key={index}>
                {index === 0 && chart.targetRange ? <rect x={center - 29} y={y(chart.targetRange.max)} width="58" height={Math.max(1, y(chart.targetRange.min) - y(chart.targetRange.max))} rx="3" fill="#e2e8f0" stroke="#64748b" strokeDasharray="4 2" /> : <rect x={center - 29} y={top} width="58" height={height} rx="3" fill={index === 0 ? "#64748b" : fill} />}
                <text x={center} y={index === 0 && chart.targetRange ? y(chart.targetRange.max) - 6 : point.value < 0 ? y(point.value) + 13 : top - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--comparison-ink)">{index === 0 && chart.targetRange ? `${comparisonValue(chart.targetRange.min, chart)}–${comparisonValue(chart.targetRange.max, chart)}` : comparisonValue(point.value, chart)}</text>
                <text x={center} y="160" textAnchor="middle" fontSize="12" fill="var(--comparison-muted)">{point.label}</text>
              </g>;
            })}
          </svg>
          <p className="mt-2 text-xl font-semibold tabular-nums" style={{ color: fill }}>{chart.targetRange ? outcome === "favorable" ? "Within range" : "Outside range" : `${delta > 0 ? "+" : ""}${comparisonValue(delta, isPercentageUnit(chart.unit) ? { unit: "percentage points" } : chart)}`}{" "}<span className="ml-2 text-xs font-normal text-slate-600">{chart.kind === "target" ? "versus target" : "change"}{percent !== null && chart.kind !== "target" ? ` · ${percent > 0 ? "+" : ""}${percent.toFixed(2)}%` : ""}</span></p>
          {chart.kind !== "target" && percent === null ? <p className="mt-1 text-xs text-slate-600">Percentage change is not meaningful with a zero or negative starting value.</p> : null}
          <details className="mt-3 text-xs leading-5"><summary className="min-h-9 cursor-pointer font-semibold text-slate-700">Values and supporting evidence</summary>
            <table className="mt-2 w-full text-left"><caption className="sr-only">{chart.title} comparison values</caption><thead><tr><th scope="col">Observation</th><th scope="col">Value</th></tr></thead><tbody>{[chart.before, chart.after].map((point, index) => <tr key={index}><th scope="row" className="py-1 pr-2 font-normal">{point.label}<span className="block text-slate-500">{point.context}</span></th><td className="tabular-nums">{index === 0 && chart.targetRange ? `${comparisonValue(chart.targetRange.min, chart)}–${comparisonValue(chart.targetRange.max, chart)}` : comparisonValue(point.value, chart)}</td></tr>)}</tbody></table>
            <p className="mt-2">{outcome === "neutral" ? "No favorable or unfavorable interpretation assigned." : `${outcome === "favorable" ? "Favorable" : "Unfavorable"} against the stated metric direction or target.`}</p>
            <ul className="mt-2 space-y-1">{chart.sources.map((source, index) => <li key={index}><a className="inline-flex min-h-9 items-center text-blue-800 underline underline-offset-2" href={source.href}>{source.label}</a></li>)}</ul>
          </details>
          {chart.limitations.map((limit, index) => <p key={index} className="mt-2 text-xs leading-5 text-slate-600">{limit}</p>)}
        </figure>;
      })}
    </div>
  </section>;
}
