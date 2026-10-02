import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { squareDirectEnabled, squareDirectPayments, squareSettingsPath } from "@/lib/integrations/square-direct/server";
import { squareResultEvidence } from "@/lib/integrations/square-direct/result-visibility";
import { sheetsEnabled } from "@/lib/integrations/google-sheets/server";
import { googleSheetsResultEvidence } from "@/lib/integrations/google-sheets/result-visibility";
import { integrationResultVisibility } from "@/lib/integrations/control-plane/result-visibility";
import { loadQboAccountingIntelligence, type QboAccountingIntelligenceLoad } from "@/lib/integrations/qbo-customer/accounting-intelligence-server";
import { buildQboAccountingIntelligence } from "@/lib/integrations/qbo-customer/accounting-intelligence";
import { qboBrowseHref } from "@/lib/integrations/qbo-customer/contracts";
import { loadActiveWorkspaceKpis } from "@/lib/kpis/load-workspace-kpis";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import type { Database, Json } from "@/lib/supabase/types";
import { IntegrationDashboardSchema, integrationDashboardStatus, selectLogicalConnections, type DashboardEntry } from "./model";
import { readIntegrationSummaryPreferences } from "./preferences-server";

type Access = Awaited<ReturnType<typeof requireWorkspaceAccess>>;
type Kpi = Database["public"]["Tables"]["kpis"]["Row"];
const identity = (provider: "square" | "google_sheets" | "quickbooks_online", parts: unknown[]) =>
  `${provider}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
const record = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;
const plusMinutes = (value: string | null, minutes: number) => value ? new Date(Date.parse(value) + minutes * 60_000).toISOString() : null;
const instant = z.string().datetime({ offset: true });
const qboMetadataSchema = z.array(z.object({
  connectionId: z.string().uuid(), logicalIdentityKey: z.string().regex(/^[a-f0-9]{64}$/),
  lastSuccessfulRefreshAt: instant.nullable(), currentUntil: instant.nullable(),
  freshness: z.enum(["current", "stale", "unknown"])
}).strict()).max(100);

type DashboardInput = { access: Access; qbo?: QboAccountingIntelligenceLoad; eligibleKpis?: Kpi[] };

export async function loadIntegrationDashboard(input: DashboardInput) {
  try { return await readIntegrationDashboard(input); }
  catch {
    const observedAt = new Date().toISOString();
    // An unavailable saved projection must not take findings or briefings down,
    // or fabricate an empty connected-state/zero financial result.
    return { loadFailed: true, dashboard: IntegrationDashboardSchema.parse({ workspaceId: input.access.workspaceId, observedAt,
      timeZone: "UTC", timeZoneConfirmed: false, preferencesAvailable: false, entries: [], unavailable: ["Integration"] }),
      currentQboAccounting: buildQboAccountingIntelligence({ workspaceId: input.access.workspaceId, summaries: [], asOf: observedAt }) };
  }
}

async function readIntegrationDashboard(input: DashboardInput) {
  const { supabase, workspaceId, user, membership } = input.access;
  let observedAt = new Date().toISOString();
  const [qbo, square, sheets, preferences] = await Promise.all([
    input.qbo ?? loadQboAccountingIntelligence(workspaceId, observedAt),
    membership.role === "owner" && squareDirectEnabled() ? squareDirectPayments({}, workspaceId).catch(() => null) : null,
    sheetsEnabled() ? supabase.from("google_sheets_connections")
      .select("id, business_entity_id, display_name, status, credential_version, spreadsheet_id, sheet_id, active_approval_id, last_sync_at, last_sync_fact_count, last_error_code, revocation_pending, authorization_uncertain, automatic_refresh_enabled, created_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(101) : null,
    readIntegrationSummaryPreferences({ supabase, workspaceId, user, membership })
  ]);
  const unavailable: string[] = [];
  if (membership.role === "owner" && squareDirectEnabled() && !square) unavailable.push("Square");
  if (sheets?.error || (sheets?.data?.length ?? 0) > 100) unavailable.push("Google Sheets");
  if (qbo.state === "unavailable") unavailable.push("QuickBooks");
  const configuredZone = input.access.workspace?.reporting_timezone;
  let timeZone = "UTC", timeZoneConfirmed = false;
  if (configuredZone) {
    try { new Intl.DateTimeFormat("en", { timeZone: configuredZone }); timeZone = configuredZone; timeZoneConfirmed = true; }
    catch { /* Unconfigured/invalid display metadata never changes financial dates. */ }
  }
  const entries: DashboardEntry[] = [];
  const hidden = new Set(preferences.state === "ready" ? preferences.preferences.filter(row => row.hiddenWhenDisconnected).map(row => row.summaryKey) : []);

  const squareRows = (square?.connections ?? []).flatMap(connection => {
    const evidence = squareResultEvidence({ ...connection,
      ...(square?.currentConnection?.connectionId === connection.connectionId ? square.currentConnection : {}) });
    if (!integrationResultVisibility(evidence).visible) return [];
    return [{ ...connection, evidence, key: connection.logicalIdentityKey ? `square:${connection.logicalIdentityKey}` : identity("square", [workspaceId, connection.connectionId]),
      connectionState: evidence.connectionState, lastSuccessfulRefreshAt: evidence.lastSuccessfulSyncAt, hasImportedData: evidence.hasImportedData }];
  });
  const squareGroups = selectLogicalConnections(squareRows);
  let squareResultReads = 0;
  for (const connection of squareGroups) {
    const href = `${squareSettingsPath}?connectionId=${encodeURIComponent(connection.connectionId)}`;
    const results: DashboardEntry["results"] = [];
    if (connection.connectionState !== "disconnected" && connection.hasImportedData && squareResultReads < 5) {
      squareResultReads += 1;
      const saved = await squareDirectPayments({ connectionId: connection.connectionId, status: "COMPLETED" }, workspaceId).catch(() => null);
      if (!saved) unavailable.push("Square results");
      const payment = saved?.payments.find(row => row.status === "COMPLETED" && row.amountMinor !== null && row.currency !== null);
      if (payment?.amountMinor && payment.currency) {
        // Exact provider minor units, not a revenue/settlement aggregate.
        const digits = new Intl.NumberFormat("en", { style: "currency", currency: payment.currency }).resolvedOptions().maximumFractionDigits ?? 2;
        const amount = BigInt(payment.amountMinor), negative = amount < BigInt(0), absolute = (negative ? -amount : amount).toString().padStart(digits + 1, "0");
        const value = `${negative ? "-" : ""}${digits ? `${absolute.slice(0, -digits)}.${absolute.slice(-digits)}` : absolute}`;
        results.push({ label: "Latest saved completed payment", value: `${payment.currency} ${value}`,
          period: `Payment date: ${new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric" }).format(new Date(payment.createdAt))}`,
          href: `${href}&status=COMPLETED#saved-payments`, limitation: "A payment is not posted revenue or a settlement total." });
      }
    } else if (connection.connectionState !== "disconnected" && connection.hasImportedData) unavailable.push("Additional Square results");
    entries.push({ key: connection.key, provider: "Square", name: [...new Set([connection.sellerLabel ?? connection.businessEntityLabel, connection.locationLabel].filter(Boolean))].join(" / "), href,
      connectionState: connection.connectionState, lastSuccessfulRefreshAt: connection.lastSuccessfulRefreshAt,
      currentUntil: null, freshness: connection.evidence.freshness, unchangedCheck: false,
      cadence: "Payments refresh on request in Integrations.", results, hidden: hidden.has(connection.key) });
  }

  const sheetRows = !sheets?.error && (sheets?.data?.length ?? 0) <= 100 ? (sheets?.data ?? []).flatMap(connection => {
    const evidence = googleSheetsResultEvidence(connection);
    if (!integrationResultVisibility(evidence).visible) return [];
    const key = identity("google_sheets", connection.spreadsheet_id && connection.sheet_id !== null
      ? [workspaceId, connection.business_entity_id, connection.spreadsheet_id, connection.sheet_id] : [workspaceId, connection.id]);
    return [{ ...connection, key, evidence, connectionId: connection.id, createdAt: connection.created_at,
      connectionState: evidence.connectionState, lastSuccessfulRefreshAt: evidence.lastSuccessfulSyncAt, hasImportedData: evidence.hasImportedData }];
  }) : [];
  const sheetsGroups = selectLogicalConnections(sheetRows);
  let kpis = input.eligibleKpis ?? [];
  if (!input.eligibleKpis && sheetsGroups.some(row => row.connectionState !== "disconnected" && row.hasImportedData)) {
    const loaded = await loadActiveWorkspaceKpis({ supabase, workspaceId });
    if (loaded.error || !loaded.complete) unavailable.push("Google Sheets results");
    else {
      const eligibility = await loadSourceParentEligibilityResult({ supabase, workspaceId, rows: loaded.data });
      if (eligibility.error) unavailable.push("Google Sheets results");
      else kpis = filterBySourceParentEligibility(loaded.data, eligibility.eligibility);
    }
  }
  for (const connection of sheetsGroups) {
    const results: DashboardEntry["results"] = [];
    if (connection.connectionState !== "disconnected") {
      const eligible = kpis.filter(row => {
        const source = record(record(row.raw_data_json)?.googleSheets);
        return row.workspace_id === workspaceId && row.archived_at === null && row.deleted_at === null
          && source?.connectionId === connection.id && source.approvalId === connection.active_approval_id
          && source.validation === "valid" && source.admission === "owner_approved_mapping"
          && typeof source.metricName === "string" && source.metricName.length > 0 && source.metricName.length <= 80
          && (source.location === null || source.location === undefined || (typeof source.location === "string" && source.location.length <= 120))
          && typeof row.actual_value === "number" && Number.isFinite(row.actual_value) && Math.abs(row.actual_value) <= Number.MAX_SAFE_INTEGER;
      }).sort((a, b) => b.metric_date.localeCompare(a.metric_date) || a.id.localeCompare(b.id));
      const metrics = new Set<string>();
      for (const row of eligible) {
        const source = record(record(row.raw_data_json)?.googleSheets)!;
        const scope = JSON.stringify([source.metricName, source.location, source.unit]);
        if (metrics.has(scope)) continue;
        metrics.add(scope);
        results.push({ label: [source.metricName, typeof source.location === "string" ? source.location : null].filter(Boolean).join(" / "),
          value: `${row.actual_value}${typeof source.unit === "string" ? ` ${source.unit}` : ""}`,
          period: `Reporting date: ${row.metric_date}`, href: "/app/settings/integrations/google-sheets", limitation: null });
        if (results.length === 4) break;
      }
    }
    entries.push({ key: connection.key, provider: "Google Sheets", name: connection.display_name,
      href: "/app/settings/integrations/google-sheets", connectionState: connection.connectionState,
      lastSuccessfulRefreshAt: connection.lastSuccessfulRefreshAt,
      currentUntil: connection.automatic_refresh_enabled ? plusMinutes(connection.lastSuccessfulRefreshAt, 15) : null,
      freshness: connection.evidence.freshness === "stale" ? "stale" : connection.automatic_refresh_enabled && connection.lastSuccessfulRefreshAt ? "current" : "unknown",
      unchangedCheck: false, cadence: connection.automatic_refresh_enabled ? "Automatic checks every 15 minutes." : "Automatic refresh is off. Refresh in Integrations.",
      results, hidden: hidden.has(connection.key) });
  }

  let currentQboAccounting = buildQboAccountingIntelligence({ workspaceId, summaries: [], asOf: observedAt });
  if (qbo.state === "available") {
    const call = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    const metadata = await call("read_qbo_dashboard_metadata_v1", { p_workspace_id: workspaceId });
    const parsed = qboMetadataSchema.safeParse(metadata.data);
    observedAt = new Date().toISOString();
    if (metadata.error || !parsed.success) unavailable.push("QuickBooks freshness");
    if (qbo.connectionsTruncated) unavailable.push("Additional QuickBooks connections");
    const currentIds = new Set<string>();
    const qboRows = qbo.connections.map(connection => {
      const meta = !metadata.error && parsed.success ? parsed.data.find(row => row.connectionId === connection.connectionId) : null;
      return { ...connection, meta, createdAt: connection.updatedAt,
        key: meta ? `quickbooks_online:${meta.logicalIdentityKey}` : identity("quickbooks_online", [workspaceId, connection.connectionId]),
        connectionState: connection.evidence.connectionState,
        lastSuccessfulRefreshAt: meta?.lastSuccessfulRefreshAt ?? connection.visibility.lastSuccessfulSyncAt,
        hasImportedData: qbo.data.summaries.some(row => row.connectionId === connection.connectionId && row.months.length > 0) };
    });
    for (const connection of selectLogicalConnections(qboRows)) {
      const summary = qbo.data.summaries.find(row => row.connectionId === connection.connectionId);
      if (!summary) continue;
      const { meta, key } = connection;
      const state = connection.evidence.connectionState;
      const calculationInFuture = summary.calculatedAt !== null && Date.parse(summary.calculatedAt) > Date.parse(observedAt);
      if (calculationInFuture) unavailable.push("QuickBooks calculation status");
      const entry: DashboardEntry = { key, provider: "QuickBooks", name: [...new Set([summary.businessEntityName, connection.label])].join(" / "),
        href: "/app/settings/integrations/quickbooks", connectionState: state,
        lastSuccessfulRefreshAt: meta?.lastSuccessfulRefreshAt ?? connection.visibility.lastSuccessfulSyncAt,
        currentUntil: meta?.currentUntil ?? null, freshness: meta?.freshness ?? "unknown", unchangedCheck: false,
        cadence: "Changes checked every 15 minutes; reports hourly; reference data every 6 hours.", hidden: hidden.has(key),
        results: state === "disconnected" || calculationInFuture || summary.calculationState !== "current" ? [] : [...summary.months].reverse().slice(0, 4).map(month => ({
          label: "Approved posted revenue subtotal", value: `${month.currency} ${month.valueCanonical}`,
          period: `${month.periodStart} to ${month.periodEnd}`,
          href: qboBrowseHref({ connectionId: summary.connectionId, after: null, sourceId: null, kind: "all" }),
          limitation: "Partial accrual subtotal, not total revenue. Reports and Square payments are not added." })) };
      entries.push(entry);
      if (!calculationInFuture && integrationDashboardStatus(entry, observedAt).current) currentIds.add(connection.connectionId);
    }
    const currentSummaries = qbo.data.summaries.filter(row => currentIds.has(row.connectionId));
    const scopeCounts = new Map<string, number>();
    for (const summary of currentSummaries) for (const currency of new Set(summary.months.map(month => month.currency))) {
      const scope = `${summary.businessEntityId}:${currency}`;
      scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
    }
    // Preserve separate company cards without publishing a shared entity's
    // aggregate twice or inventing authority between distinct connections.
    const unambiguous = currentSummaries.map(summary => ({ ...summary,
      months: summary.months.filter(month => scopeCounts.get(`${summary.businessEntityId}:${month.currency}`) === 1) }));
    if ([...scopeCounts.values()].some(count => count > 1)) unavailable.push("Shared-entity QuickBooks totals");
    currentQboAccounting = buildQboAccountingIntelligence({ workspaceId, summaries: unambiguous, asOf: observedAt });
  }
  return { loadFailed: false, dashboard: IntegrationDashboardSchema.parse({ workspaceId, observedAt, timeZone, timeZoneConfirmed,
    preferencesAvailable: preferences.state === "ready", entries, unavailable: [...new Set(unavailable)] }), currentQboAccounting };
}
