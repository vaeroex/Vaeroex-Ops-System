export const REPORT_SUBSCRIPTION_STATUSES = ["enabled", "disabled", "paused"] as const;

export const REPORT_SUBSCRIPTION_SCOPES = ["workspace", "role", "person"] as const;

export const REPORT_SCHEDULE_DAY_KINDS = ["custom_day", "first_business_day", "last_business_day"] as const;

export const REPORT_WEEKDAY_OPTIONS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 }
] as const;

export const REPORT_QUARTER_MONTH_OPTIONS = [
  { label: "First month", value: 1 },
  { label: "Second month", value: 2 },
  { label: "Third month", value: 3 }
] as const;

export const REPORT_SUBSCRIPTION_CATEGORIES = [
  {
    key: "weekly_review",
    label: "Weekly Review (Friday)",
    cadence: "Fridays",
    reportPeriod: "Weekly",
    reportType: "Weekly Review",
    scheduledReport: true
  },
  {
    key: "weekly_planning",
    label: "Weekly Planning (Monday)",
    cadence: "Mondays",
    reportPeriod: "Weekly",
    reportType: "Weekly Planning",
    scheduledReport: true
  },
  {
    key: "monthly_executive_summary",
    label: "Monthly Executive Summary",
    cadence: "First day of each month",
    reportPeriod: "Monthly",
    reportType: "Executive Summary",
    scheduledReport: true
  },
  {
    key: "quarterly_business_review",
    label: "Quarterly Business Review",
    cadence: "First day of each quarter",
    reportPeriod: "Quarterly",
    reportType: "Quarterly Business Review",
    scheduledReport: true
  },
  {
    key: "critical_kpi_alerts",
    label: "Critical KPI Alerts",
    cadence: "When triggered",
    reportPeriod: null,
    reportType: null,
    scheduledReport: false
  },
  {
    key: "shared_reports",
    label: "Shared Reports",
    cadence: "When shared",
    reportPeriod: null,
    reportType: null,
    scheduledReport: false
  },
  {
    key: "assigned_tasks",
    label: "Assigned Tasks",
    cadence: "When assigned",
    reportPeriod: null,
    reportType: null,
    scheduledReport: false
  }
] as const;

export type ReportSubscriptionCategory = (typeof REPORT_SUBSCRIPTION_CATEGORIES)[number]["key"];
export type ReportSubscriptionStatus = (typeof REPORT_SUBSCRIPTION_STATUSES)[number];
export type ReportSubscriptionScope = (typeof REPORT_SUBSCRIPTION_SCOPES)[number];
export type ReportScheduleDayKind = (typeof REPORT_SCHEDULE_DAY_KINDS)[number];

export type ReportSchedulePreference = {
  category: string;
  schedule_day_of_week?: number | null;
  schedule_day_kind?: string | null;
  schedule_day_of_month?: number | null;
  schedule_month_in_quarter?: number | null;
  schedule_time?: string | null;
};

export function reportSubscriptionCategory(value: string): ReportSubscriptionCategory {
  return REPORT_SUBSCRIPTION_CATEGORIES.some((category) => category.key === value)
    ? (value as ReportSubscriptionCategory)
    : "weekly_review";
}

export function reportSubscriptionStatus(value: string): ReportSubscriptionStatus {
  return REPORT_SUBSCRIPTION_STATUSES.includes(value as ReportSubscriptionStatus) ? (value as ReportSubscriptionStatus) : "disabled";
}

export function reportSubscriptionScope(value: string): ReportSubscriptionScope {
  return REPORT_SUBSCRIPTION_SCOPES.includes(value as ReportSubscriptionScope) ? (value as ReportSubscriptionScope) : "workspace";
}

export function reportScheduleDayKind(value: string): ReportScheduleDayKind {
  return REPORT_SCHEDULE_DAY_KINDS.includes(value as ReportScheduleDayKind) ? (value as ReportScheduleDayKind) : "custom_day";
}

export function categoryLabel(value: string) {
  return REPORT_SUBSCRIPTION_CATEGORIES.find((category) => category.key === value)?.label || value.replace(/_/g, " ");
}

export function categoryConfig(value: string) {
  return REPORT_SUBSCRIPTION_CATEGORIES.find((category) => category.key === value) || REPORT_SUBSCRIPTION_CATEGORIES[0];
}

export function isScheduledReportCategory(value: string) {
  return Boolean(categoryConfig(value).scheduledReport);
}

export function clampScheduleDay(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(31, Math.trunc(value)));
}

export function normalizeScheduleTime(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return "09:00";

  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function defaultWeekdayForCategory(category: string) {
  if (category === "weekly_planning") return 1;
  if (category === "weekly_review") return 5;
  return 1;
}

export function defaultMonthInQuarter(category: string) {
  return category === "quarterly_business_review" ? 1 : null;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function isBusinessDay(date: Date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function firstBusinessDay(year: number, month: number) {
  let date = new Date(Date.UTC(year, month, 1, 12));

  while (!isBusinessDay(date)) {
    date = addDays(date, 1);
  }

  return date;
}

function lastBusinessDay(year: number, month: number) {
  let date = new Date(Date.UTC(year, month, daysInMonth(year, month), 12));

  while (!isBusinessDay(date)) {
    date = addDays(date, -1);
  }

  return date;
}

function dayOfMonthDate(year: number, month: number, requestedDay: number) {
  return new Date(Date.UTC(year, month, Math.min(clampScheduleDay(requestedDay), daysInMonth(year, month)), 12));
}

function withScheduleTime(date: Date, time: string) {
  const [hour, minute] = normalizeScheduleTime(time).split(":").map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0));
}

function monthlyScheduleDate(preference: ReportSchedulePreference, year: number, month: number) {
  const kind = reportScheduleDayKind(preference.schedule_day_kind || "custom_day");

  if (kind === "first_business_day") return firstBusinessDay(year, month);
  if (kind === "last_business_day") return lastBusinessDay(year, month);
  return dayOfMonthDate(year, month, clampScheduleDay(preference.schedule_day_of_month || 1));
}

function quarterScheduleDate(preference: ReportSchedulePreference, year: number, quarterStartMonth: number) {
  const monthOffset = Math.max(1, Math.min(3, preference.schedule_month_in_quarter || 1)) - 1;
  return monthlyScheduleDate(preference, year, quarterStartMonth + monthOffset);
}

function nextWeeklyRun(preference: ReportSchedulePreference, from: Date) {
  const targetDay = preference.schedule_day_of_week ?? defaultWeekdayForCategory(preference.category);

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = withScheduleTime(addDays(from, offset), normalizeScheduleTime(preference.schedule_time));

    if (candidate.getUTCDay() === targetDay && candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }

  return withScheduleTime(addDays(from, 7), normalizeScheduleTime(preference.schedule_time));
}

function nextMonthlyRun(preference: ReportSchedulePreference, from: Date) {
  for (let offset = 0; offset <= 13; offset += 1) {
    const monthDate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1, 12));
    const candidate = withScheduleTime(
      monthlyScheduleDate(preference, monthDate.getUTCFullYear(), monthDate.getUTCMonth()),
      normalizeScheduleTime(preference.schedule_time)
    );

    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }

  return withScheduleTime(addDays(from, 31), normalizeScheduleTime(preference.schedule_time));
}

function nextQuarterlyRun(preference: ReportSchedulePreference, from: Date) {
  const currentQuarterStart = Math.floor(from.getUTCMonth() / 3) * 3;

  for (let offset = 0; offset <= 5; offset += 1) {
    const quarterDate = new Date(Date.UTC(from.getUTCFullYear(), currentQuarterStart + offset * 3, 1, 12));
    const quarterStart = Math.floor(quarterDate.getUTCMonth() / 3) * 3;
    const candidate = withScheduleTime(
      quarterScheduleDate(preference, quarterDate.getUTCFullYear(), quarterStart),
      normalizeScheduleTime(preference.schedule_time)
    );

    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }

  return withScheduleTime(addDays(from, 92), normalizeScheduleTime(preference.schedule_time));
}

export function getNextScheduledRun(preference: ReportSchedulePreference, from = new Date()) {
  if (preference.category === "weekly_review" || preference.category === "weekly_planning") {
    return nextWeeklyRun(preference, from);
  }

  if (preference.category === "monthly_executive_summary") {
    return nextMonthlyRun(preference, from);
  }

  if (preference.category === "quarterly_business_review") {
    return nextQuarterlyRun(preference, from);
  }

  return null;
}

export function getScheduleDescription(preference: ReportSchedulePreference) {
  const time = normalizeScheduleTime(preference.schedule_time);

  if (preference.category === "weekly_review" || preference.category === "weekly_planning") {
    const day = REPORT_WEEKDAY_OPTIONS.find((option) => option.value === (preference.schedule_day_of_week ?? defaultWeekdayForCategory(preference.category)));
    return `${day?.label || "Selected day"} at ${time} UTC`;
  }

  if (preference.category === "monthly_executive_summary") {
    const kind = reportScheduleDayKind(preference.schedule_day_kind || "custom_day");
    if (kind === "first_business_day") return `First business day at ${time} UTC`;
    if (kind === "last_business_day") return `Last business day at ${time} UTC`;
    return `Day ${clampScheduleDay(preference.schedule_day_of_month || 1)} at ${time} UTC`;
  }

  if (preference.category === "quarterly_business_review") {
    const month = REPORT_QUARTER_MONTH_OPTIONS.find((option) => option.value === (preference.schedule_month_in_quarter || 1));
    const kind = reportScheduleDayKind(preference.schedule_day_kind || "custom_day");
    if (kind === "first_business_day") return `${month?.label || "Selected month"}: first business day at ${time} UTC`;
    if (kind === "last_business_day") return `${month?.label || "Selected month"}: last business day at ${time} UTC`;
    return `${month?.label || "Selected month"}: day ${clampScheduleDay(preference.schedule_day_of_month || 1)} at ${time} UTC`;
  }

  return "Triggered by activity";
}

export function isReportSubscriptionDue(preference: ReportSchedulePreference, date = new Date()) {
  if (!isScheduledReportCategory(preference.category)) return false;

  const previous = addDays(date, -1);
  const next = getNextScheduledRun(preference, previous);

  return Boolean(next && dateOnly(next) === dateOnly(date) && next.getTime() <= date.getTime());
}
