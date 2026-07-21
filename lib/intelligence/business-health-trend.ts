export type BusinessHealthTrendRange = "7D" | "6W" | "6M";

export type BusinessHealthTrendPoint = {
  snapshotDate: string;
  score: number;
  status: string;
  trend: string;
  recordedAt?: string;
};

export type BusinessHealthChartPoint = {
  key: string;
  label: string;
  score: number;
  tooltip: string;
};

type NormalizedPoint = BusinessHealthTrendPoint & {
  sourceIndex: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value ? parsed : null;
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfUtcWeek(date: Date) {
  const normalized = utcDate(date);
  const daysSinceMonday = (normalized.getUTCDay() + 6) % 7;
  return addUtcDays(normalized, -daysSinceMonday);
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00.000Z`)
  );
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(`${value}-01T00:00:00.000Z`)
  );
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isLaterPoint(candidate: NormalizedPoint, current: NormalizedPoint) {
  if (candidate.snapshotDate !== current.snapshotDate) {
    return candidate.snapshotDate > current.snapshotDate;
  }

  const candidateRecordedAt = Date.parse(candidate.recordedAt || "");
  const currentRecordedAt = Date.parse(current.recordedAt || "");

  if (Number.isFinite(candidateRecordedAt) || Number.isFinite(currentRecordedAt)) {
    if (!Number.isFinite(currentRecordedAt)) return true;
    if (!Number.isFinite(candidateRecordedAt)) return false;
    if (candidateRecordedAt !== currentRecordedAt) return candidateRecordedAt > currentRecordedAt;
  }

  return candidate.sourceIndex > current.sourceIndex;
}

function normalizeDailyPoints(points: BusinessHealthTrendPoint[]) {
  const byDate = new Map<string, NormalizedPoint>();

  points.forEach((point, sourceIndex) => {
    if (!parseDateKey(point.snapshotDate) || !Number.isFinite(point.score)) return;

    const candidate: NormalizedPoint = {
      ...point,
      score: clampScore(point.score),
      sourceIndex
    };
    const current = byDate.get(point.snapshotDate);

    if (!current || isLaterPoint(candidate, current)) {
      byDate.set(point.snapshotDate, candidate);
    }
  });

  return Array.from(byDate.values()).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

function latestByPeriod(points: NormalizedPoint[], keyForPoint: (point: NormalizedPoint) => string) {
  const byPeriod = new Map<string, NormalizedPoint>();

  for (const point of points) {
    const key = keyForPoint(point);
    const current = byPeriod.get(key);
    if (!current || isLaterPoint(point, current)) byPeriod.set(key, point);
  }

  return byPeriod;
}

function dailyPoints(points: NormalizedPoint[], now: Date): BusinessHealthChartPoint[] {
  const today = utcDate(now);
  const start = addUtcDays(today, -6);
  const startKey = dateKey(start);
  const endKey = dateKey(today);

  return points
    .filter((point) => point.snapshotDate >= startKey && point.snapshotDate <= endKey)
    .map((point) => ({
      key: point.snapshotDate,
      label: formatDay(point.snapshotDate),
      score: point.score,
      tooltip: `${formatDay(point.snapshotDate)}: ${point.score} out of 100`
    }));
}

function weeklyPoints(points: NormalizedPoint[], now: Date): BusinessHealthChartPoint[] {
  const currentWeekStart = startOfUtcWeek(now);
  const rangeStart = addUtcDays(currentWeekStart, -42);
  const filtered = points.filter((point) => {
    const date = parseDateKey(point.snapshotDate);
    return Boolean(date && date >= rangeStart && date < currentWeekStart);
  });
  const grouped = latestByPeriod(filtered, (point) => dateKey(startOfUtcWeek(parseDateKey(point.snapshotDate)!)));

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, point]) => ({
      key: weekStart,
      label: formatDay(weekStart),
      score: point.score,
      tooltip: `Week of ${formatDay(weekStart)}: ${point.score} out of 100`
    }));
}

function monthlyPoints(points: NormalizedPoint[], now: Date): BusinessHealthChartPoint[] {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rangeStart = addUtcMonths(currentMonthStart, -6);
  const filtered = points.filter((point) => {
    const date = parseDateKey(point.snapshotDate);
    return Boolean(date && date >= rangeStart && date < currentMonthStart);
  });
  const grouped = latestByPeriod(filtered, (point) => point.snapshotDate.slice(0, 7));

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, point]) => ({
      key: month,
      label: formatMonth(month),
      score: point.score,
      tooltip: `${formatMonth(month)}: ${point.score} out of 100`
    }));
}

export function buildBusinessHealthChartPoints(
  points: BusinessHealthTrendPoint[],
  range: BusinessHealthTrendRange,
  now = new Date()
) {
  const normalized = normalizeDailyPoints(points);
  if (range === "7D") return dailyPoints(normalized, now);
  if (range === "6W") return weeklyPoints(normalized, now);
  return monthlyPoints(normalized, now);
}
