export const REPORT_SUBSCRIPTION_STATUSES = ["enabled", "disabled", "paused"] as const;

export const REPORT_SUBSCRIPTION_SCOPES = ["workspace", "role", "person"] as const;

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

export function categoryLabel(value: string) {
  return REPORT_SUBSCRIPTION_CATEGORIES.find((category) => category.key === value)?.label || value.replace(/_/g, " ");
}

export function categoryConfig(value: string) {
  return REPORT_SUBSCRIPTION_CATEGORIES.find((category) => category.key === value) || REPORT_SUBSCRIPTION_CATEGORIES[0];
}

export function isScheduledReportCategory(value: string) {
  return Boolean(categoryConfig(value).scheduledReport);
}

export function isReportSubscriptionDue(category: string, date = new Date()) {
  const day = date.getUTCDay();
  const month = date.getUTCMonth();
  const dateOfMonth = date.getUTCDate();

  if (category === "weekly_review") return day === 5;
  if (category === "weekly_planning") return day === 1;
  if (category === "monthly_executive_summary") return dateOfMonth === 1;
  if (category === "quarterly_business_review") return dateOfMonth === 1 && [0, 3, 6, 9].includes(month);
  return false;
}
