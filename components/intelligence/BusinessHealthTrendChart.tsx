"use client";

import { useMemo, useState } from "react";
import {
  buildBusinessHealthTrendBuckets,
  buildBusinessHealthTrendDisplayPoints,
  type BusinessHealthTrendBucket,
  type BusinessHealthTrendDisplayPoint,
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

type PositionedPoint = BusinessHealthTrendDisplayPoint & {
  x: number;
  y: number;
};

const CHART_WIDTH = 360;
const PLOT_LEFT = 30;
const PLOT_RIGHT = 350;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 98;
const Y_AXIS_VALUES = [100, 75, 50, 25, 0] as const;

const ranges: Array<{ key: BusinessHealthTrendRange; label: string }> = [
  { key: "7D", label: "7 Days" },
  { key: "1M", label: "1 Month" },
  { key: "3M", label: "3 Months" },
  { key: "6M", label: "6 Months" },
  { key: "YTD", label: "YTD" }
];

const RANGE_LABELS: Record<BusinessHealthTrendRange, string> = {
  "7D": "Last 7 days",
  "1M": "Last 30 days",
  "3M": "Last 13 weeks",
  "6M": "Last 13 two-week periods",
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

function formatMonth(value: string, includeYear = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: includeYear ? "long" : "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPeriod(point: BusinessHealthTrendDisplayPoint) {
  if (point.kind === "daily") return formatDate(point.startDate, true);
  if (point.kind === "monthly_average") return formatMonth(point.startDate, true);
  return `${formatDate(point.startDate)}–${formatDate(point.endDate, true)}`;
}

function periodKindLabel(point: BusinessHealthTrendDisplayPoint) {
  if (point.kind === "daily") return "Daily score";
  if (point.kind === "weekly_average") return "Weekly average";
  if (point.kind === "biweekly_average") return "Two-week average";
  return "Monthly average";
}

function scoringMethodLabel(point: BusinessHealthTrendDisplayPoint) {
  return point.calculationVersion === "business_health_calculation_v2" ? "Formula V2" : "Formula V1";
}

function axisLabel(bucket: BusinessHealthTrendBucket) {
  return bucket.kind === "monthly_average" ? formatMonth(bucket.startDate) : formatDate(bucket.startDate);
}

function axisTickIndexes(bucketCount: number, range: BusinessHealthTrendRange) {
  if (bucketCount <= 1) return [0];
  const interval = range === "7D" || range === "YTD" ? 1 : range === "1M" ? 5 : 2;
  const indexes = Array.from({ length: bucketCount }, (_, index) => index).filter((index) => index % interval === 0);
  if (indexes.at(-1) !== bucketCount - 1) indexes.push(bucketCount - 1);
  return indexes;
}

function xForBucket(bucketIndex: number, bucketCount: number) {
  if (bucketCount <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2;
  return PLOT_LEFT + (bucketIndex / (bucketCount - 1)) * (PLOT_RIGHT - PLOT_LEFT);
}

function yForScore(score: number) {
  return PLOT_BOTTOM - (score / 100) * (PLOT_BOTTOM - PLOT_TOP);
}

function positionPoints(points: readonly BusinessHealthTrendDisplayPoint[], bucketCount: number) {
  const pointsPerBucket = new Map<number, BusinessHealthTrendDisplayPoint[]>();
  for (const point of points) pointsPerBucket.set(point.bucketIndex, [...(pointsPerBucket.get(point.bucketIndex) || []), point]);

  return points.map((point) => {
    const bucketPoints = pointsPerBucket.get(point.bucketIndex) || [point];
    const index = bucketPoints.findIndex((candidate) => candidate.key === point.key);
    const methodOffset = bucketPoints.length > 1 ? (index - (bucketPoints.length - 1) / 2) * 10 : 0;
    return {
      ...point,
      x: xForBucket(point.bucketIndex, bucketCount) + methodOffset,
      y: yForScore(point.score)
    };
  });
}

function tooltipPosition(point: PositionedPoint) {
  const width = 156;
  const x = Math.max(2, Math.min(CHART_WIDTH - width - 2, point.x - width / 2));
  const y = point.y < 52 ? point.y + 9 : point.y - 45;
  return { width, x, y };
}

export function BusinessHealthTrendChart({
  points,
  asOfDate,
  errorMessage,
  loading = false
}: BusinessHealthTrendChartProps) {
  const [range, setRange] = useState<BusinessHealthTrendRange>("7D");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const buckets = useMemo(() => buildBusinessHealthTrendBuckets(range, asOfDate), [range, asOfDate]);
  const displayPoints = useMemo(
    () => buildBusinessHealthTrendDisplayPoints(points, range, asOfDate),
    [points, range, asOfDate]
  );
  const positionedPoints = useMemo(
    () => positionPoints(displayPoints, buckets.length),
    [displayPoints, buckets.length]
  );
  const displayedKey = activeKey || selectedKey;
  const activePoint = positionedPoints.find((point) => point.key === displayedKey) || null;
  const rangeLabel = RANGE_LABELS[range];
  const first = displayPoints[0];
  const last = displayPoints.at(-1);
  const hasScoringMethodBoundary = new Set(displayPoints.map((point) => point.methodSegment)).size > 1;
  const change = first && last && first.key !== last.key && first.methodSegment === last.methodSegment
    ? Math.round((last.score - first.score) * 10) / 10
    : null;
  const tickIndexes = axisTickIndexes(buckets.length, range);
  const hasGap = displayPoints.some((point, index) => index > 0
    && point.methodSegment === displayPoints[index - 1].methodSegment
    && point.bucketIndex - displayPoints[index - 1].bucketIndex > 1);

  return (
    <div className="mt-4 rounded-lg border border-cyan-300/15 bg-slate-950/40 p-3" data-business-health-trend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Health trend</p>
          <p className="mt-1 text-xs text-slate-300">
            {hasScoringMethodBoundary
              ? `${rangeLabel} · Scoring method updated`
              : change !== null
              ? `${rangeLabel} · ${change === 0 ? "Stable" : change > 0 ? `+${formatScore(change)}` : formatScore(change)} pts`
              : `${rangeLabel} · ${displayPoints.length} ${displayPoints.length === 1 ? "period" : "periods"} with stored history`}
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
                setActiveKey(null);
                setSelectedKey(null);
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
        <div className="mt-3 h-36 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" aria-live="polite">
          <span className="sr-only">Loading Business Health history.</span>
        </div>
      ) : errorMessage && !points.length ? (
        <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
          {errorMessage}
        </div>
      ) : displayPoints.length ? (
        <div className="mt-3">
          <svg
            viewBox="0 0 360 128"
            role="group"
            aria-label={`Business Health trend for ${rangeLabel}. ${displayPoints.length} plotted ${displayPoints.length === 1 ? "point" : "points"}.`}
            className="h-36 w-full overflow-visible"
          >
            {Y_AXIS_VALUES.map((value) => {
              const y = yForScore(value);
              return (
                <g key={value} aria-hidden="true">
                  <line
                    x1={PLOT_LEFT}
                    x2={PLOT_RIGHT}
                    y1={y}
                    y2={y}
                    stroke="rgba(148,163,184,.2)"
                    strokeDasharray={value === 0 ? undefined : "3 6"}
                  />
                  <text x="2" y={y + 3} fill="rgba(203,213,225,.76)" fontSize="9">{value}</text>
                </g>
              );
            })}

            {positionedPoints.slice(1).map((point, index) => {
              const previous = positionedPoints[index];
              if (point.methodSegment !== previous.methodSegment) return null;
              const crossesMissingPeriod = point.bucketIndex - previous.bucketIndex > 1;
              return (
                <line
                  key={`${previous.key}-${point.key}`}
                  x1={previous.x}
                  y1={previous.y}
                  x2={point.x}
                  y2={point.y}
                  stroke="#38bdf8"
                  strokeDasharray={crossesMissingPeriod ? "4 5" : undefined}
                  strokeLinecap="round"
                  strokeWidth="3"
                />
              );
            })}

            {positionedPoints.slice(1).map((point, index) => {
              const previous = positionedPoints[index];
              if (point.methodSegment === previous.methodSegment) return null;
              return (
                <g key={`method-boundary-${point.key}`} aria-hidden="true">
                  <line x1={point.x} x2={point.x} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke="rgba(251,191,36,.8)" strokeDasharray="3 4" />
                  <text x={point.x + 3} y={PLOT_TOP + 8} fill="rgba(253,230,138,.95)" fontSize="7">Formula V2</text>
                </g>
              );
            })}

            {positionedPoints.map((point) => {
              const active = activePoint?.key === point.key;
              const valueLabel = point.kind === "daily" ? "Business Health score" : "Average Business Health";
              return (
                <circle
                  key={point.key}
                  cx={point.x}
                  cy={point.y}
                  r={active ? 6 : 4.5}
                  fill="#38bdf8"
                  stroke={active ? "#f8fafc" : "#061225"}
                  strokeWidth={active ? 2.5 : 2}
                  role="button"
                  tabIndex={0}
                  aria-label={`${formatPeriod(point)}. ${valueLabel} ${formatScore(point.score)} out of 100. ${periodKindLabel(point)}. ${scoringMethodLabel(point)}.`}
                  onPointerEnter={() => setActiveKey(point.key)}
                  onPointerLeave={() => setActiveKey((current) => current === point.key ? null : current)}
                  onFocus={() => setActiveKey(point.key)}
                  onBlur={() => setActiveKey((current) => current === point.key ? null : current)}
                  onClick={() => setSelectedKey((current) => current === point.key ? null : point.key)}
                  className="cursor-pointer outline-none"
                />
              );
            })}

            {tickIndexes.map((index) => {
              const bucket = buckets[index];
              return (
                <text
                  key={`tick-${bucket.key}`}
                  x={xForBucket(index, buckets.length)}
                  y="120"
                  textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}
                  fill="rgba(203,213,225,.72)"
                  fontSize="7.5"
                  aria-hidden="true"
                >
                  {axisLabel(bucket)}
                </text>
              );
            })}

            {activePoint ? (() => {
              const tooltip = tooltipPosition(activePoint);
              const valueLabel = activePoint.kind === "daily" ? "Business Health" : "Average Business Health";
              return (
                <g aria-hidden="true" pointerEvents="none">
                  <rect x={tooltip.x} y={tooltip.y} width={tooltip.width} height="49" rx="5" fill="#0f1f38" stroke="rgba(103,232,249,.45)" />
                  <text x={tooltip.x + 8} y={tooltip.y + 11} fill="#cbd5e1" fontSize="8.5">{formatPeriod(activePoint)}</text>
                  <text x={tooltip.x + 8} y={tooltip.y + 23} fill="#ffffff" fontSize="9.5" fontWeight="600">{valueLabel}: {formatScore(activePoint.score)}</text>
                  <text x={tooltip.x + 8} y={tooltip.y + 34} fill="#94a3b8" fontSize="8">{periodKindLabel(activePoint)}</text>
                  <text x={tooltip.x + 8} y={tooltip.y + 44} fill="#fcd34d" fontSize="8">{scoringMethodLabel(activePoint)}</text>
                </g>
              );
            })() : null}
          </svg>
          {hasGap ? (
            <p className="mt-1 text-xs leading-5 text-slate-400">Dashed line segments cross periods without stored Business Health reviews.</p>
          ) : null}
          {hasScoringMethodBoundary ? (
            <p className="mt-1 text-xs leading-5 text-amber-200">Formula V1 history remains visible, but Vaeroex does not calculate a continuous change or period average across the Formula V2 boundary.</p>
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
