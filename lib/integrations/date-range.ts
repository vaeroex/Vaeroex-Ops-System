/** UTC calendar ranges shared by historical connector imports and saved reports. */
export type ImportDateRange = { startDate: string; endDate: string; startAt: string; endAt: string };
export type ViewDateRange = { startDate: string | null; endDate: string | null };
export const MAX_IMPORT_DAYS = 366;
const DAY_MS = 86_400_000;

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) throw new Error("invalid_date_range");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("invalid_date_range");
  return value;
}

function absent(value: unknown): boolean { return value === null || value === undefined || value === ""; }

export function inclusiveDateCount(startDate: string, endDate: string): number {
  return Math.floor((new Date(`${calendarDate(endDate)}T00:00:00Z`).getTime() - new Date(`${calendarDate(startDate)}T00:00:00Z`).getTime()) / DAY_MS) + 1;
}

export function recentDateRange(days: number, today: string): { startDate: string; endDate: string } {
  if (!Number.isInteger(days) || days < 1 || days > MAX_IMPORT_DAYS) throw new Error("invalid_date_range");
  const endDate = calendarDate(today);
  const startDate = new Date(new Date(`${endDate}T00:00:00Z`).getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { startDate: calendarDate(startDate), endDate };
}

function checkedRange(start: unknown, end: unknown, now: Date): { startDate: string; endDate: string } {
  const startDate = calendarDate(start), endDate = calendarDate(end);
  if (startDate > endDate || endDate > now.toISOString().slice(0, 10)) throw new Error("invalid_date_range");
  return { startDate, endDate };
}

/** A bounded import may be for any historical year; 366 is a batch size, not a retention limit. */
export function resolveImportRange(start: unknown, end: unknown, now = new Date()): ImportDateRange {
  const today = now.toISOString().slice(0, 10);
  const range = absent(start) && absent(end) ? recentDateRange(30, today) : checkedRange(start, end, now);
  if (inclusiveDateCount(range.startDate, range.endDate) > MAX_IMPORT_DAYS) throw new Error("invalid_date_range");
  const startAt = `${range.startDate}T00:00:00.000Z`;
  const endAt = range.endDate === today ? now.toISOString() : new Date(new Date(`${range.endDate}T00:00:00Z`).getTime() + DAY_MS).toISOString();
  return { ...range, startAt, endAt };
}

/** Omitting both dates views all saved records; browsing never fetches provider data. */
export function resolveViewRange(start: unknown, end: unknown, now = new Date()): ViewDateRange {
  if (absent(start) && absent(end)) return { startDate: null, endDate: null };
  return checkedRange(start, end, now);
}
