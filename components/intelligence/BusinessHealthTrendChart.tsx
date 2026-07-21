"use client";

import { useMemo, useState } from "react";
import {
  buildBusinessHealthChartPoints,
  type BusinessHealthTrendPoint,
  type BusinessHealthTrendRange
} from "@/lib/intelligence/business-health-trend";

export type { BusinessHealthTrendPoint } from "@/lib/intelligence/business-health-trend";

type BusinessHealthTrendChartProps = {
  points: BusinessHealthTrendPoint[];
  errorMessage?: string | null;
  loading?: boolean;
};
type ChartPoint = {
  key: string;
  label: string;
  score: number;
  tooltip: string;
};

const ranges: Array<{ key: BusinessHealthTrendRange; label: string }> = [
  { key: "7D", label: "7D" },
  { key: "6W", label: "6W" },
  { key: "6M", label: "6M" }
];

function pathFor(points: ChartPoint[]) {
  if (!points.length) return "";

  const width = 320;
  const height = 92;
  const paddingX = 18;
  const paddingY = 10;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * innerWidth;
      const y = height - paddingY - (Math.max(0, Math.min(100, point.score)) / 100) * innerHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function pointCoordinates(points: ChartPoint[]) {
  const width = 320;
  const height = 92;
  const paddingX = 18;
  const paddingY = 10;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  return points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * innerWidth,
    y: height - paddingY - (Math.max(0, Math.min(100, point.score)) / 100) * innerHeight
  }));
}

export function BusinessHealthTrendChart({
  points,
  errorMessage,
  loading = false
}: BusinessHealthTrendChartProps) {
  const [range, setRange] = useState<BusinessHealthTrendRange>("7D");
  const selectedPoints = useMemo(() => buildBusinessHealthChartPoints(points, range), [points, range]);
  const coordinates = useMemo(() => pointCoordinates(selectedPoints), [selectedPoints]);
  const linePath = useMemo(() => pathFor(selectedPoints), [selectedPoints]);
  const first = selectedPoints[0]?.score;
  const last = selectedPoints[selectedPoints.length - 1]?.score;
  const change = typeof first === "number" && typeof last === "number" ? last - first : 0;
  const rangeLabel = range === "7D" ? "Last 7 days" : range === "6W" ? "Last 6 completed weeks" : "Last 6 completed months";
  const hasTrend = selectedPoints.length >= 2;
  const showError = Boolean(errorMessage && !points.length);

  return (
    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Health trend</p>
          <p className="mt-1 text-xs text-slate-300">
            {selectedPoints.length ? `${rangeLabel} · ${change === 0 ? "Stable" : change > 0 ? `+${change}` : change} pts` : rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {points.length ? (
            <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-[0.68rem] font-semibold text-cyan-100">
              Stored snapshots
            </span>
          ) : null}
          <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-1" role="group" aria-label="Business Health history range">
            {ranges.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setRange(item.key)}
                aria-pressed={range === item.key}
                className={`min-h-8 rounded-md px-2.5 text-xs font-semibold transition ${
                  range === item.key
                    ? "bg-vaeroex-blue text-white"
                    : "text-slate-300 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 h-24 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" aria-live="polite">
          <span className="sr-only">Loading Business Health history.</span>
        </div>
      ) : showError ? (
        <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
          {errorMessage}
        </div>
      ) : hasTrend ? (
        <div className="mt-3">
          <svg viewBox="0 0 320 92" role="img" aria-label={`Business Health trend for ${rangeLabel}`} className="h-24 w-full overflow-visible">
            <defs>
              <linearGradient id="business-health-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#1E6BFF" />
                <stop offset="100%" stopColor="#38BDF8" />
              </linearGradient>
              <linearGradient id="business-health-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(56,189,248,.22)" />
                <stop offset="100%" stopColor="rgba(30,107,255,0)" />
              </linearGradient>
            </defs>
            <line x1="18" x2="302" y1="10" y2="10" stroke="rgba(148,163,184,.2)" strokeDasharray="3 6" />
            <line x1="18" x2="302" y1="82" y2="82" stroke="rgba(148,163,184,.24)" />
            <text x="0" y="13" fill="rgba(203,213,225,.72)" fontSize="9">
              100
            </text>
            <text x="6" y="84" fill="rgba(203,213,225,.72)" fontSize="9">
              0
            </text>
            {selectedPoints.length > 1 ? (
              <>
                <path d={`${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} 82 L ${coordinates[0].x.toFixed(2)} 82 Z`} fill="url(#business-health-fill)" opacity="0.85" />
                <path d={linePath} fill="none" stroke="url(#business-health-line)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
              </>
            ) : null}
            {coordinates.map((point) => (
              <g key={point.key}>
                <title>{point.tooltip}</title>
                <circle cx={point.x} cy={point.y} r="4" fill="#38BDF8" stroke="#061225" strokeWidth="2" />
                <text x={point.x} y="91" textAnchor="middle" fill="rgba(203,213,225,.78)" fontSize="8">
                  {point.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-4 text-xs leading-5 text-slate-300">
          Trend will appear after additional Business Health scores are recorded.
        </div>
      )}
    </div>
  );
}
