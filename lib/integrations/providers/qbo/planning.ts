import {
  QBO_CDC_POLICY_VERSION,
  QBO_HISTORICAL_SYNC_POLICY_VERSION,
  QBO_PAGINATION_POLICY_VERSION,
  QboSupportedObjectTypeSchema,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_DEFAULT_QUERY_PAGE_SIZE = 500 as const;
export const QBO_MAX_QUERY_PAGE_SIZE = 1_000 as const;
export const QBO_DEFAULT_HISTORICAL_HORIZON_MONTHS = 24 as const;
export const QBO_DEFAULT_HISTORICAL_WINDOW_DAYS = 31 as const;
export const QBO_CDC_LOOKBACK_DAYS = 30 as const;
export const QBO_CDC_RESPONSE_OBJECT_CAP = 1_000 as const;
export const QBO_CDC_OVERLAP_SECONDS = 300 as const;

export type QboQueryPagePlan = Readonly<{
  policyVersion: typeof QBO_PAGINATION_POLICY_VERSION;
  recordType: QboSupportedObjectType;
  startPosition: number;
  maxResults: number;
  queryShape: "startposition_maxresults";
  orderingAssumption: "provider_default_no_sortable_id_assumption";
  cursor: string;
}>;

function assertIsoDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`qbo_planning_invalid_date:${field}`);
  }
}

function parseDate(value: string) {
  assertIsoDate(value, "date");
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function subtractMonths(value: Date, months: number) {
  const next = new Date(value.getTime());
  next.setUTCMonth(next.getUTCMonth() - months);
  return next;
}

function parseTimestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`qbo_planning_invalid_timestamp:${field}`);
  }
  return parsed;
}

function formatTimestamp(value: Date) {
  return value.toISOString();
}

export function normalizeQboQueryPageSize(pageSize: number = QBO_DEFAULT_QUERY_PAGE_SIZE) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error("qbo_page_size_invalid");
  }
  return Math.min(pageSize, QBO_MAX_QUERY_PAGE_SIZE);
}

export function encodeQboCursor(input: { recordType: QboSupportedObjectType; startPosition: number; maxResults: number }) {
  return `qbo:${input.recordType}:start:${input.startPosition}:max:${input.maxResults}`;
}

export function planQboQueryPages(input: {
  recordType: QboSupportedObjectType;
  totalCount: number;
  pageSize?: number;
  startPosition?: number;
}) {
  const recordType = QboSupportedObjectTypeSchema.parse(input.recordType);
  if (!Number.isSafeInteger(input.totalCount) || input.totalCount < 0) {
    throw new Error("qbo_total_count_invalid");
  }
  const pageSize = normalizeQboQueryPageSize(input.pageSize);
  const firstStart = input.startPosition ?? 1;
  if (!Number.isSafeInteger(firstStart) || firstStart < 1) {
    throw new Error("qbo_startposition_invalid");
  }
  if (input.totalCount === 0) {
    return [] as QboQueryPagePlan[];
  }
  const plans: QboQueryPagePlan[] = [];
  for (let startPosition = firstStart; startPosition <= input.totalCount; startPosition += pageSize) {
    plans.push({
      policyVersion: QBO_PAGINATION_POLICY_VERSION,
      recordType,
      startPosition,
      maxResults: pageSize,
      queryShape: "startposition_maxresults",
      orderingAssumption: "provider_default_no_sortable_id_assumption",
      cursor: encodeQboCursor({ recordType, startPosition, maxResults: pageSize })
    });
  }
  return plans;
}

export function nextQboQueryPageCursor(input: {
  recordType: QboSupportedObjectType;
  previousStartPosition: number;
  maxResults: number;
  returnedCount: number;
}) {
  const recordType = QboSupportedObjectTypeSchema.parse(input.recordType);
  if (!Number.isSafeInteger(input.returnedCount) || input.returnedCount < 0) {
    throw new Error("qbo_returned_count_invalid");
  }
  if (input.returnedCount < input.maxResults) {
    return { exhausted: true as const, cursor: null };
  }
  const startPosition = input.previousStartPosition + input.returnedCount;
  return {
    exhausted: false as const,
    cursor: encodeQboCursor({ recordType, startPosition, maxResults: input.maxResults }),
    startPosition
  };
}

export function planQboDateSlices(input: {
  startDate: string;
  endDate: string;
  maxWindowDays?: number;
}) {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const maxWindowDays = input.maxWindowDays ?? QBO_DEFAULT_HISTORICAL_WINDOW_DAYS;
  if (start.getTime() > end.getTime()) throw new Error("qbo_date_slice_bounds_invalid");
  if (!Number.isSafeInteger(maxWindowDays) || maxWindowDays <= 0 || maxWindowDays > 92) {
    throw new Error("qbo_date_slice_window_invalid");
  }
  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const candidateEnd = addDays(cursor, maxWindowDays - 1);
    const windowEnd = candidateEnd.getTime() > end.getTime() ? end : candidateEnd;
    windows.push({ startDate: formatDate(cursor), endDate: formatDate(windowEnd) });
    cursor = addDays(windowEnd, 1);
  }
  return windows;
}

export function planQboHistoricalSync(input: {
  anchorDate: string;
  horizonMonths?: number;
  windowDays?: number;
  recordTypes?: readonly QboSupportedObjectType[];
}) {
  const anchor = parseDate(input.anchorDate);
  const horizonMonths = input.horizonMonths ?? QBO_DEFAULT_HISTORICAL_HORIZON_MONTHS;
  if (!Number.isSafeInteger(horizonMonths) || horizonMonths <= 0 || horizonMonths > 120) {
    throw new Error("qbo_historical_horizon_invalid");
  }
  const startDate = formatDate(subtractMonths(anchor, horizonMonths));
  const dateWindows = planQboDateSlices({
    startDate,
    endDate: input.anchorDate,
    maxWindowDays: input.windowDays ?? QBO_DEFAULT_HISTORICAL_WINDOW_DAYS
  });
  const recordTypes = input.recordTypes ?? [];
  return {
    policyVersion: QBO_HISTORICAL_SYNC_POLICY_VERSION,
    horizonMonths,
    windowDays: input.windowDays ?? QBO_DEFAULT_HISTORICAL_WINDOW_DAYS,
    anchorDate: input.anchorDate,
    windows: recordTypes.length === 0
      ? dateWindows
      : recordTypes.flatMap((recordType) => {
          const checked = QboSupportedObjectTypeSchema.parse(recordType);
          return dateWindows.map((window) => ({ ...window, recordType: checked }));
        })
  };
}

export function planQboCdcWindow(input: {
  changedSince: string;
  until: string;
  overlapSeconds?: number;
}) {
  const until = parseTimestamp(input.until, "until");
  const changedSince = parseTimestamp(input.changedSince, "changedSince");
  const overlapSeconds = input.overlapSeconds ?? QBO_CDC_OVERLAP_SECONDS;
  if (!Number.isSafeInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > 86_400) {
    throw new Error("qbo_cdc_overlap_invalid");
  }
  const earliestAllowed = new Date(until.getTime() - QBO_CDC_LOOKBACK_DAYS * 86_400_000);
  const overlappedStart = new Date(changedSince.getTime() - overlapSeconds * 1_000);
  const start = overlappedStart.getTime() < earliestAllowed.getTime() ? earliestAllowed : overlappedStart;
  if (start.getTime() > until.getTime()) throw new Error("qbo_cdc_window_bounds_invalid");
  return {
    policyVersion: QBO_CDC_POLICY_VERSION,
    changedSince: formatTimestamp(start),
    until: formatTimestamp(until),
    lookbackDays: QBO_CDC_LOOKBACK_DAYS,
    responseObjectCap: QBO_CDC_RESPONSE_OBJECT_CAP,
    overlapSeconds
  };
}

export function bisectQboCdcWindowIfDense(input: {
  window: ReturnType<typeof planQboCdcWindow>;
  observedObjectCount: number;
}) {
  if (!Number.isSafeInteger(input.observedObjectCount) || input.observedObjectCount < 0) {
    throw new Error("qbo_cdc_observed_count_invalid");
  }
  if (input.observedObjectCount < QBO_CDC_RESPONSE_OBJECT_CAP) {
    return [input.window];
  }
  const start = parseTimestamp(input.window.changedSince, "window.changedSince");
  const end = parseTimestamp(input.window.until, "window.until");
  const midpoint = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2));
  if (midpoint.getTime() <= start.getTime() || midpoint.getTime() >= end.getTime()) {
    throw new Error("qbo_cdc_window_too_dense_to_bisect");
  }
  return [
    planQboCdcWindow({
      changedSince: formatTimestamp(start),
      until: formatTimestamp(midpoint),
      overlapSeconds: 0
    }),
    planQboCdcWindow({
      changedSince: formatTimestamp(midpoint),
      until: formatTimestamp(end),
      overlapSeconds: 0
    })
  ];
}

export function resumeQboCdcCursor(input: {
  lastCompletedUntil: string;
  restartUntil: string;
}) {
  return planQboCdcWindow({
    changedSince: input.lastCompletedUntil,
    until: input.restartUntil
  });
}
