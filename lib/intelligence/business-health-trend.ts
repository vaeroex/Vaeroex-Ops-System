import {
  BUSINESS_HEALTH_CALCULATION_VERSION_V1,
  BUSINESS_HEALTH_CALCULATION_VERSIONS,
  type BusinessHealthCalculationVersion
} from "@/lib/intelligence/snapshot/v1/versions";

export type BusinessHealthTrendRange = "7D" | "1M" | "3M" | "6M" | "YTD";

export type StoredBusinessHealthTrendPoint = Readonly<{
  snapshotDate: string;
  score: number;
  status: string;
  trend: string;
  calculationVersion?: BusinessHealthCalculationVersion;
}>;

export type BusinessHealthTrendPeriodKind = "daily" | "weekly_average" | "biweekly_average" | "monthly_average";

export type BusinessHealthTrendBucket = Readonly<{
  key: string;
  startDate: string;
  endDate: string;
  kind: BusinessHealthTrendPeriodKind;
}>;

export type BusinessHealthTrendDisplayPoint = BusinessHealthTrendBucket & Readonly<{
  bucketIndex: number;
  score: number;
  sampleCount: number;
  sourceDates: readonly string[];
  calculationVersion: BusinessHealthCalculationVersion;
  methodSegment: number;
}>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseDate(value: string) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shiftUtcDays(value: Date, days: number) {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

export function businessHealthTrendRangeStart(range: BusinessHealthTrendRange, asOfDate: string) {
  const asOf = parseDate(asOfDate);
  if (!asOf) throw new Error("Business Health trend requires a valid as-of date.");

  if (range === "YTD") return `${asOf.getUTCFullYear()}-01-01`;

  const calendarDays = range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 91 : 182;
  return dateOnly(shiftUtcDays(asOf, -(calendarDays - 1)));
}

export function buildBusinessHealthTrendBuckets(range: BusinessHealthTrendRange, asOfDate: string) {
  const asOf = parseDate(asOfDate);
  const start = parseDate(businessHealthTrendRangeStart(range, asOfDate));
  if (!asOf || !start) throw new Error("Business Health trend requires valid range dates.");

  const buckets: BusinessHealthTrendBucket[] = [];

  if (range === "YTD") {
    let cursor = start;
    while (cursor.getTime() <= asOf.getTime()) {
      const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const end = minDate(shiftUtcDays(nextMonth, -1), asOf);
      const startDate = dateOnly(cursor);
      const endDate = dateOnly(end);
      buckets.push({ key: `${startDate}:${endDate}`, startDate, endDate, kind: "monthly_average" });
      cursor = nextMonth;
    }
    return buckets;
  }

  const periodDays = range === "3M" ? 7 : range === "6M" ? 14 : 1;
  const kind: BusinessHealthTrendPeriodKind =
    range === "3M" ? "weekly_average" : range === "6M" ? "biweekly_average" : "daily";

  let cursor = start;
  while (cursor.getTime() <= asOf.getTime()) {
    const end = minDate(shiftUtcDays(cursor, periodDays - 1), asOf);
    const startDate = dateOnly(cursor);
    const endDate = dateOnly(end);
    buckets.push({ key: `${startDate}:${endDate}`, startDate, endDate, kind });
    cursor = shiftUtcDays(end, 1);
  }

  return buckets;
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

function averageScore(points: readonly StoredBusinessHealthTrendPoint[]) {
  const average = points.reduce((total, point) => total + point.score, 0) / points.length;
  return Math.round(average * 10) / 10;
}

function calculationVersion(point: StoredBusinessHealthTrendPoint): BusinessHealthCalculationVersion {
  return point.calculationVersion && BUSINESS_HEALTH_CALCULATION_VERSIONS.includes(point.calculationVersion)
    ? point.calculationVersion
    : BUSINESS_HEALTH_CALCULATION_VERSION_V1;
}

export function buildBusinessHealthTrendDisplayPoints(
  points: readonly StoredBusinessHealthTrendPoint[],
  range: BusinessHealthTrendRange,
  asOfDate: string
) {
  const buckets = buildBusinessHealthTrendBuckets(range, asOfDate);
  const storedPoints = filterStoredBusinessHealthTrendPoints(points, range, asOfDate);
  let methodSegment = 0;
  const segmentedPoints = storedPoints.map((point, index) => {
    const version = calculationVersion(point);
    if (index > 0 && version !== calculationVersion(storedPoints[index - 1])) methodSegment += 1;
    return { ...point, calculationVersion: version, methodSegment };
  });

  return buckets.flatMap<BusinessHealthTrendDisplayPoint>((bucket, bucketIndex) => {
    const sourcePoints = segmentedPoints.filter(
      (point) => point.snapshotDate >= bucket.startDate && point.snapshotDate <= bucket.endDate
    );

    if (!sourcePoints.length) return [];
    const segments = new Map<number, typeof sourcePoints>();
    for (const point of sourcePoints) segments.set(point.methodSegment, [...(segments.get(point.methodSegment) || []), point]);
    const splitByMethod = segments.size > 1;

    return [...segments.entries()].map(([segment, segmentPoints]) => ({
      ...bucket,
      key: `${bucket.key}:method-${segment}`,
      startDate: splitByMethod ? segmentPoints[0].snapshotDate : bucket.startDate,
      endDate: splitByMethod ? segmentPoints[segmentPoints.length - 1].snapshotDate : bucket.endDate,
      bucketIndex,
      score: bucket.kind === "daily" ? segmentPoints[segmentPoints.length - 1].score : averageScore(segmentPoints),
      sampleCount: segmentPoints.length,
      sourceDates: segmentPoints.map((point) => point.snapshotDate),
      calculationVersion: segmentPoints[0].calculationVersion,
      methodSegment: segment
    }));
  });
}

export function businessHealthTrendDayOffset(startDate: string, pointDate: string) {
  const start = parseDate(startDate);
  const point = parseDate(pointDate);
  if (!start || !point) throw new Error("Business Health trend point dates must be valid.");
  return Math.round((point.getTime() - start.getTime()) / DAY_MS);
}
