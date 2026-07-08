"use client";

import { useMemo, useState } from "react";

export type BusinessHealthTrendPoint = {
  snapshotDate: string;
  score: number;
  status: string;
  trend: string;
};

type RangeKey = "7D" | "6M" | "YTD";
type ChartPoint = {
  key: string;
  label: string;
  score: number;
};

const ranges: Array<{ key: RangeKey; label: string }> = [
  { key: "7D", label: "7D" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" }
];

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function average(values: number[]) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildDailyPoints(points: BusinessHealthTrendPoint[]) {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6));
  const startKey = dateOnly(start);

  return points
    .filter((point) => point.snapshotDate >= startKey)
    .map((point) => ({
      key: point.snapshotDate,
      label: formatDayLabel(point.snapshotDate),
      score: point.score
    }));
}

function buildMonthlyPoints(points: BusinessHealthTrendPoint[], range: Extract<RangeKey, "6M" | "YTD">) {
  const today = new Date();
  const start =
    range === "YTD"
      ? new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const grouped = new Map<string, number[]>();

  for (const point of points) {
    const date = new Date(`${point.snapshotDate}T00:00:00Z`);

    if (date < start) {
      continue;
    }

    const key = monthKey(date);
    grouped.set(key, [...(grouped.get(key) || []), point.score]);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      key,
      label: formatMonthLabel(key),
      score: average(values)
    }));
}

function chartData(points: BusinessHealthTrendPoint[], range: RangeKey) {
  if (range === "7D") return buildDailyPoints(points);
  return buildMonthlyPoints(points, range);
}

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

export function BusinessHealthTrendChart({ points }: { points: BusinessHealthTrendPoint[] }) {
  const [range, setRange] = useState<RangeKey>("7D");
  const selectedPoints = useMemo(() => chartData(points, range), [points, range]);
  const coordinates = useMemo(() => pointCoordinates(selectedPoints), [selectedPoints]);
  const linePath = useMemo(() => pathFor(selectedPoints), [selectedPoints]);
  const first = selectedPoints[0]?.score;
  const last = selectedPoints[selectedPoints.length - 1]?.score;
  const change = typeof first === "number" && typeof last === "number" ? last - first : 0;
  const rangeLabel = range === "7D" ? "Last 7 days" : range === "6M" ? "Last 6 months" : "Year to date";
  const isLimited = selectedPoints.length > 0 && (range === "7D" ? selectedPoints.length < 4 : selectedPoints.length < 2);

  return (
    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Health trend</p>
          <p className="mt-1 text-xs text-slate-300">
            {selectedPoints.length ? `${rangeLabel} · ${change === 0 ? "Stable" : change > 0 ? `+${change}` : change} pts` : rangeLabel}
          </p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-white/[0.04] p-1">
          {ranges.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
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

      {selectedPoints.length ? (
        <div className="mt-3">
          <svg viewBox="0 0 320 92" role="img" aria-label={`Business Health trend for ${rangeLabel}`} className="h-24 w-full overflow-visible">
            <defs>
              <linearGradient id="business-health-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#1E6BFF" />
                <stop offset="100%" stopColor="#38BDF8" />
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
              <path d={linePath} fill="none" stroke="url(#business-health-line)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
            ) : null}
            {coordinates.map((point) => (
              <g key={point.key}>
                <circle cx={point.x} cy={point.y} r="4" fill="#38BDF8" stroke="#061225" strokeWidth="2" />
                <text x={point.x} y="91" textAnchor="middle" fill="rgba(203,213,225,.78)" fontSize="8">
                  {point.label}
                </text>
              </g>
            ))}
          </svg>
          {isLimited ? (
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Limited history available. Vaeroex is showing the Business Health points collected so far.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-4 text-xs leading-5 text-slate-300">
          Business Health history will appear as Vaeroex collects more signals.
        </div>
      )}
    </div>
  );
}
