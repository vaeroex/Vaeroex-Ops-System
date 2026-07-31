export type BusinessHealthTrendRange = "7D" | "1M" | "3M" | "6M" | "YTD";

export type StoredBusinessHealthTrendPoint = Readonly<{
  snapshotDate: string;
  score: number;
  status: string;
  trend: string;
}>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function subtractUtcMonthsClamped(value: Date, months: number) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() - months;
  const day = value.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function businessHealthTrendRangeStart(range: BusinessHealthTrendRange, asOfDate: string) {
  const asOf = parseDate(asOfDate);
  if (!asOf) throw new Error("Business Health trend requires a valid as-of date.");

  if (range === "YTD") return `${asOf.getUTCFullYear()}-01-01`;
  if (range === "7D") {
    const start = new Date(asOf);
    start.setUTCDate(start.getUTCDate() - 6);
    return dateOnly(start);
  }
  return dateOnly(subtractUtcMonthsClamped(asOf, range === "1M" ? 1 : range === "3M" ? 3 : 6));
}

export function filterStoredBusinessHealthTrendPoints(
  points: readonly StoredBusinessHealthTrendPoint[],
  range: BusinessHealthTrendRange,
  asOfDate: string
) {
  const startDate = businessHealthTrendRangeStart(range, asOfDate);
  return points
    .filter((point) => {
      return Boolean(
        parseDate(point.snapshotDate)
        && Number.isFinite(point.score)
        && point.score >= 0
        && point.score <= 100
        && point.snapshotDate >= startDate
        && point.snapshotDate <= asOfDate
      );
    })
    .map((point) => ({ ...point }))
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
}

export function businessHealthTrendDayOffset(startDate: string, pointDate: string) {
  const start = parseDate(startDate);
  const point = parseDate(pointDate);
  if (!start || !point) throw new Error("Business Health trend point dates must be valid.");
  return Math.round((point.getTime() - start.getTime()) / 86_400_000);
}

export function areConsecutiveBusinessHealthDates(left: string, right: string) {
  return businessHealthTrendDayOffset(left, right) === 1;
}
