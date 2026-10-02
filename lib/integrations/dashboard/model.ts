import { z } from "zod";

const instant = z.string().datetime({ offset: true });
const href = z.string().max(1024).refine(value => value.startsWith("/app/") && !value.includes("\\"));
export const DashboardEntrySchema = z.object({
  key: z.string().regex(/^(square|quickbooks_online|google_sheets):[a-f0-9]{64}$/),
  provider: z.enum(["Square", "QuickBooks", "Google Sheets"]),
  name: z.string().min(1).max(520), href,
  connectionState: z.enum(["connected", "setup", "disconnected", "reauthorization_required", "sync_error"]),
  lastSuccessfulRefreshAt: instant.nullable(),
  currentUntil: instant.nullable(),
  freshness: z.enum(["current", "stale", "unknown"]),
  unchangedCheck: z.boolean(),
  cadence: z.string().max(200),
  results: z.array(z.object({ label: z.string().max(240), value: z.string().max(200),
    period: z.string().max(200), href, limitation: z.string().max(400).nullable() }).strict()).max(4),
  hidden: z.boolean()
}).strict();
export type DashboardEntry = z.infer<typeof DashboardEntrySchema>;
export const IntegrationDashboardSchema = z.object({
  workspaceId: z.string().uuid(), observedAt: instant,
  timeZone: z.string().max(255).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
  timeZoneConfirmed: z.boolean(), preferencesAvailable: z.boolean(),
  entries: z.array(DashboardEntrySchema).max(300), unavailable: z.array(z.string().max(100)).max(12)
}).strict();
export type IntegrationDashboard = z.infer<typeof IntegrationDashboardSchema>;

export function integrationDashboardStatus(entry: DashboardEntry, asOf: string) {
  if (entry.connectionState === "disconnected") return { label: "Disconnected", current: false, tone: "neutral" } as const;
  if (entry.connectionState === "reauthorization_required") return { label: "Reconnect required", current: false, tone: "warning" } as const;
  if (entry.connectionState === "setup") return { label: "Finish setup in Integrations", current: false, tone: "neutral" } as const;
  if (!entry.lastSuccessfulRefreshAt) return { label: "Awaiting first successful import", current: false, tone: "neutral" } as const;
  if (entry.connectionState === "sync_error") return { label: "Refresh failed", current: false, tone: "warning" } as const;
  if (entry.freshness === "stale" || (entry.currentUntil && Date.parse(asOf) > Date.parse(entry.currentUntil)))
    return { label: "Stale", current: false, tone: "warning" } as const;
  if (entry.freshness === "current" && entry.currentUntil && Date.parse(asOf) <= Date.parse(entry.currentUntil))
    return { label: entry.unchangedCheck ? "Up to date - no new data since the last successful check" : "Up to date", current: true, tone: "success" } as const;
  return { label: "Last-known data", current: false, tone: "neutral" } as const;
}

export function dashboardTimestamp(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

// Select one attempt, never add values or borrow an older attempt's freshness.
// Each provider supplies a canonical company/scope identity or an attempt-specific fallback.
export function selectLogicalConnections<T extends { key: string; connectionState: DashboardEntry["connectionState"];
  lastSuccessfulRefreshAt: string | null; createdAt: string; connectionId: string; hasImportedData: boolean }>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  return [...groups.values()].map(group => group.sort((a, b) =>
    Number(b.connectionState !== "disconnected") - Number(a.connectionState !== "disconnected")
    || (b.lastSuccessfulRefreshAt ?? "").localeCompare(a.lastSuccessfulRefreshAt ?? "")
    || Number(b.hasImportedData) - Number(a.hasImportedData)
    || b.createdAt.localeCompare(a.createdAt) || a.connectionId.localeCompare(b.connectionId))[0]);
}
