export const ADMIN_USAGE_RANGES = ["month", "24h", "7d", "30d", "90d"] as const;
export type AdminUsageRange = (typeof ADMIN_USAGE_RANGES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function adminReportPeriod(value: string | undefined, now = new Date()) {
  const range: AdminUsageRange = ADMIN_USAGE_RANGES.includes(value as AdminUsageRange) ? value as AdminUsageRange : "month";
  const end = new Date(now);
  const start = range === "month" ? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)) : new Date(end.getTime() - ({ "24h": 1, "7d": 7, "30d": 30, "90d": 90 }[range] * 86_400_000));
  return { range, start: start.toISOString(), end: end.toISOString() };
}

export function adminWorkspaceFilter(value: string | undefined) {
  return value && UUID.test(value) ? value.toLowerCase() : "";
}

export function adminReportPage(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}
