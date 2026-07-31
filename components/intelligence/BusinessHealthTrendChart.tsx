"use client";

import { useMemo, useState } from "react";
import {
  areConsecutiveBusinessHealthDates,
  businessHealthTrendDayOffset,
  businessHealthTrendRangeStart,
  filterStoredBusinessHealthTrendPoints,
  type BusinessHealthTrendRange,
  type StoredBusinessHealthTrendPoint
} from "@/lib/intelligence/business-health-trend";

export type BusinessHealthTrendPoint = StoredBusinessHealthTrendPoint;

type BusinessHealthTrendChartProps = {
  points: BusinessHealthTrendPoint[];
  asOfDate: string;
  errorMessage?: string | null;
  loading?: boolean;
};

type PositionedPoint = BusinessHealthTrendPoint & {
  x: number;
  y: number;
};

const ranges: Array<{ key: BusinessHealthTrendRange; label: string }> = [
  { key: "7D", label: "7 Days" },
  { key: "1M", label: "1 Month" },
  { key: "3M", label: "3 Months" },
  { key: "6M", label: "6 Months" },
  { key: "YTD", label: "YTD" }
];

const RANGE_LABELS: Record<BusinessHealthTrendRange, string> = {
  "7D": "Last 7 days",
  "1M": "Last month",
  "3M": "Last 3 months",
  "6M": "Last 6 months",
  YTD: "Year to date"
};

function formatDate(value: string, includeYear = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function positionPoints(points: readonly BusinessHealthTrendPoint[], range: BusinessHealthTrendRange, asOfDate: string) {
  const width = 320;
  const height = 104;
  const paddingX = 20;
  const paddingTop = 12;
  const paddingBottom = 14;
  const startDate = businessHealthTrendRangeStart(range, asOfDate);
  const daySpan = Math.max(1, businessHealthTrendDayOffset(startDate, asOfDate));
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;

  return points.map((point) => ({
    ...point,
    x: paddingX + (businessHealthTrendDayOffset(startDate, point.snapshotDate) / daySpan) * innerWidth,
    y: paddingTop + (1 - point.score / 100) * innerHeight
  }));
}

function tooltipPosition(point: PositionedPoint) {
  const width = 118;
  const x = Math.max(2, Math.min(320 - width - 2, point.x - width / 2));
  const y = point.y < 48 ? point.y + 9 : point.y - 39;
  return { width, x, y };
}

export function BusinessHealthTrendChart({
  points,
  asOfDate,
  errorMessage,
  loading = false
}: BusinessHealthTrendChartProps) {
  const [range, setRange] = useState<BusinessHealthTrendRange>("7D");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const selectedPoints = useMemo(
    () => filterStoredBusinessHealthTrendPoints(points, range, asOfDate),
    [points, range, asOfDate]
  );
  const positionedPoints = useMemo(
    () => positionPoints(selectedPoints, range, asOfDate),
    [selectedPoints, range, asOfDate]
  );
  const activePoint = positionedPoints.find((point) => point.snapshotDate === activeDate) || null;
  const rangeLabel = RANGE_LABELS[range];
  const hasEnoughHistory = selectedPoints.length >= 2;
  const first = selectedPoints[0];
  const last = selectedPoints.at(-1);
  const change = first && last ? last.score - first.score : null;

  return (
    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-slate-950/40 p-3" data-business-health-trend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Health trend</p>
          <p className="mt-1 text-xs text-slate-300">
            {hasEnoughHistory && change !== null
              ? `${rangeLabel} · ${change === 0 ? "Stable" : change > 0 ? `+${change}` : change} pts`
              : rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-1" aria-label="Business Health trend range">
          {ranges.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={range === item.key}
              onClick={() => {
                setRange(item.key);
                setActiveDate(null);
              }}
              className={`min-h-9 rounded-md px-2.5 text-xs font-semibold transition ${
                range === item.key
                  ? "bg-vaeroex-blue text-white"
                  : "text-slate-300 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-3 h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" aria-live="polite">
          <span className="sr-only">Loading Business Health history.</span>
        </div>
      ) : errorMessage && !points.length ? (
        <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
          {errorMessage}
        </div>
      ) : hasEnoughHistory ? (
        <div className="mt-3">
          <svg
            viewBox="0 0 320 104"
            role="group"
            aria-label={`Business Health trend for ${rangeLabel}. ${selectedPoints.length} stored points.`}
            className="h-28 w-full overflow-visible"
          >
            <line x1="20" x2="300" y1="12" y2="12" stroke="rgba(148,163,184,.2)" strokeDasharray="3 6" />
            <line x1="20" x2="300" y1="90" y2="90" stroke="rgba(148,163,184,.24)" />
            <text x="1" y="15" fill="rgba(203,213,225,.72)" fontSize="9">100</text>
            <text x="8" y="93" fill="rgba(203,213,225,.72)" fontSize="9">0</text>
            {positionedPoints.slice(1).map((point, index) => {
              const previous = positionedPoints[index];
              if (!areConsecutiveBusinessHealthDates(previous.snapshotDate, point.snapshotDate)) return null;
              return (
                <line
                  key={`${previous.snapshotDate}-${point.snapshotDate}`}
                  x1={previous.x}
                  y1={previous.y}
                  x2={point.x}
                  y2={point.y}
                  stroke="#38bdf8"
                  strokeLinecap="round"
                  strokeWidth="3"
                />
              );
            })}
            {positionedPoints.map((point) => {
              const active = activePoint?.snapshotDate === point.snapshotDate;
              return (
                <circle
                  key={point.snapshotDate}
                  cx={point.x}
                  cy={point.y}
                  r={active ? 6 : 4.5}
                  fill="#38bdf8"
                  stroke={active ? "#f8fafc" : "#061225"}
                  strokeWidth={active ? 2.5 : 2}
                  role="button"
                  tabIndex={0}
                  aria-label={`${formatDate(point.snapshotDate, true)}. Business Health score ${point.score} out of 100.`}
                  onPointerEnter={() => setActiveDate(point.snapshotDate)}
                  onPointerLeave={() => setActiveDate((current) => current === point.snapshotDate ? null : current)}
                  onFocus={() => setActiveDate(point.snapshotDate)}
                  onBlur={() => setActiveDate((current) => current === point.snapshotDate ? null : current)}
                  onClick={() => setActiveDate(point.snapshotDate)}
                  className="cursor-pointer outline-none"
                />
              );
            })}
            {activePoint ? (() => {
              const tooltip = tooltipPosition(activePoint);
              return (
                <g aria-hidden="true" pointerEvents="none">
                  <rect x={tooltip.x} y={tooltip.y} width={tooltip.width} height="31" rx="5" fill="#0f1f38" stroke="rgba(103,232,249,.45)" />
                  <text x={tooltip.x + 8} y={tooltip.y + 12} fill="#cbd5e1" fontSize="8.5">{formatDate(activePoint.snapshotDate, true)}</text>
                  <text x={tooltip.x + 8} y={tooltip.y + 24} fill="#ffffff" fontSize="10" fontWeight="600">Business Health: {activePoint.score}</text>
                </g>
              );
            })() : null}
          </svg>
          <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem] text-slate-400" aria-hidden="true">
            <span>{first ? formatDate(first.snapshotDate) : ""}</span>
            <span>{last ? formatDate(last.snapshotDate) : ""}</span>
          </div>
          {positionedPoints.some((point, index) => index > 0 && !areConsecutiveBusinessHealthDates(positionedPoints[index - 1].snapshotDate, point.snapshotDate)) ? (
            <p className="mt-2 text-xs leading-5 text-slate-400">Line breaks mark dates without a stored Business Health review.</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-4 text-xs leading-5 text-slate-300">
          More stored Business Health history is needed for this range. Vaeroex will show only actual dated reviews as they become available.
        </div>
      )}
    </div>
  );
}
