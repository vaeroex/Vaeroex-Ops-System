import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { AuthMessage } from "@/components/auth/AuthMessage";
import { GoogleSheetsAuthorizationForm } from "@/components/integrations/google-sheets/GoogleSheetsAuthorizationForm";
import { GoogleSheetsMappingEditor } from "@/components/integrations/google-sheets/GoogleSheetsMappingEditor";
import { googleSheetsErrorMessage, googleSheetsResults, googleSheetsReviewReason } from "@/components/integrations/google-sheets/status";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { FieldMappingSchema, sheetColumn } from "@/lib/integrations/google-sheets/contracts";
import { sheetsEnabled, type SheetsTab } from "@/lib/integrations/google-sheets/server";
import { googleSheetsResultVisibility } from "@/lib/integrations/google-sheets/result-visibility";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";
type PageProps = { searchParams?: Promise<{ result?: string | string[]; error?: string | string[] }> };
const inputClass = "mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue";

function tabsFromJson(value: unknown): SheetsTab[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tab): tab is SheetsTab => typeof tab === "object" && tab !== null && typeof tab.id === "number" && typeof tab.title === "string" && typeof tab.rowCount === "number");
}
function headersFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function reviewIssues(value: unknown): Array<{ rowNumber: number; metricName: string | null; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter((issue): issue is { rowNumber: number; metricName: string | null; reason: string } =>
    typeof issue === "object" && issue !== null && Number.isInteger(issue.rowNumber) && issue.rowNumber > 0 &&
    typeof issue.reason === "string" && (issue.metricName === null || typeof issue.metricName === "string")
  ).slice(0, 25);
}
function time(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export default async function GoogleSheetsSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { context, supabase, workspaceId } = await requireWorkspacePage();
  const canManage = context.membership?.role === "owner";
  const enabled = sheetsEnabled();
  const [connectionResult, entityResult, runResult] = await Promise.all([
    enabled ? supabase.from("google_sheets_connections").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    enabled && canManage ? supabase.from("business_entities").select("id,display_name").eq("workspace_id", workspaceId).eq("status", "active").order("display_name", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    enabled ? supabase.from("google_sheets_sync_runs").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(40) : Promise.resolve({ data: [], error: null })
  ]);
  const connections = connectionResult.data ?? [];
  const entities = entityResult.data ?? [];
  const result = typeof params?.result === "string" ? params.result : undefined;
  const error = typeof params?.error === "string" ? params.error : undefined;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Integrations" title="Google Sheets" description="Keep Executive Intelligence up to date with the business metrics you approve."
      actions={<Link href="/app/integrations" title="Back to integrations" aria-label="Back to integrations" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-ink hover:bg-slate-50"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    <div role={error ? "alert" : "status"}><AuthMessage message={result && Object.hasOwn(googleSheetsResults, result) ? googleSheetsResults[result] : undefined} error={googleSheetsErrorMessage(error) ?? undefined} /></div>
    <SectionCard title={enabled ? "Read only connection" : "Google Sheets is not available yet"}>
      <div className="space-y-2 text-sm leading-6 text-slate-600">
        {!enabled ? <p>The connector is disabled until the Google connection configuration is complete.</p> : null}
        <p>Google’s permission allows read access to spreadsheets your Google account can access. Vaeroex reads only the spreadsheet URL you configure and the columns you select. It cannot change your spreadsheet.</p>
        <p>Connect business data only. Do not use sheets containing patient or regulated healthcare data, Social Security numbers, or insurance identifiers.</p>
        <p>Each connection supports one tab, up to 12 numeric metrics, 10,000 data rows below the header, and 15,000 numeric observations per sync. Reports above the limits are rejected in full.</p>
      </div>
    </SectionCard>
    {!canManage ? <p role="status" className="text-sm text-slate-600">The workspace owner can connect a spreadsheet and approve its mapping.</p> : null}
    {enabled && canManage ? <SectionCard title="Connect a spreadsheet" description="Choose the business entity, then continue to Google to grant read only access.">
      {entityResult.error ? <p role="status" className="text-sm text-red-700">Business entities could not be loaded. Refresh this page before connecting.</p>
        : entities.length ? <GoogleSheetsAuthorizationForm className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">Business entity<select name="businessEntityId" required className={inputClass}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.display_name}</option>)}</select></label>
          <label className="text-sm font-medium text-ink">Connection name<input name="displayName" required maxLength={120} defaultValue="Business metrics sheet" className={inputClass} /></label>
        </GoogleSheetsAuthorizationForm> : <p className="text-sm text-slate-600">Create an active business entity before connecting a spreadsheet.</p>}
      <details open={!entityResult.error && entities.length === 0} className="mt-5 border-t border-line pt-4">
        <summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">Add business entity</summary>
        <p className="mt-2 text-sm leading-6 text-slate-600">Create the business or division that owns this spreadsheet’s metrics. You can use this entity for other integrations in the current workspace.</p>
        <form action="/api/integrations/google-sheets/entity" method="post" className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">Entity display name<input name="displayName" required maxLength={120} placeholder="For example, Operations reporting" className={inputClass} /></label>
          <label className="text-sm font-medium text-ink">Entity type<select name="entityType" defaultValue="operating_company" required className={inputClass}><option value="operating_company">Operating company</option><option value="holding_company">Holding company</option><option value="division">Division</option><option value="consolidated_group">Consolidated group</option></select></label>
          <label className="text-sm font-medium text-ink">Base currency<input name="baseCurrency" defaultValue="USD" required minLength={3} maxLength={3} pattern="[A-Z]{3}" autoCapitalize="characters" className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-600">Three-letter currency code, such as USD or EUR.</span></label>
          <label className="text-sm font-medium text-ink">Time zone<input name="timeZone" defaultValue="UTC" required maxLength={64} className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-600">Use UTC or an IANA name, such as America/Los_Angeles.</span></label>
          <label className="text-sm font-medium text-ink">Fiscal year start month<select name="fiscalYearStartMonth" defaultValue="1" required className={inputClass}>{["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-600 sm:col-span-2"><input type="checkbox" name="confirmation" value="create_entity" required className="mt-1.5 h-4 w-4 shrink-0" /><span>I confirm I want to create this business entity in the current workspace.</span></label>
          <button type="submit" className={`${buttonClass} justify-self-start sm:col-span-2`}>Create business entity</button>
        </form>
      </details>
    </SectionCard> : null}
    {connectionResult.error ? <p role="status" className="rounded-md border border-line p-4 text-sm text-slate-600">Connection status is unavailable. Refresh this page to try again.</p> : null}
    {connections.map((connection) => {
      const tabs = tabsFromJson(connection.tabs);
      const headers = headersFromJson(connection.headers);
      const parsed = FieldMappingSchema.safeParse(connection.field_mapping);
      const mapping = parsed.success ? parsed.data : null;
      const running = connection.sync_lease_expires_at !== null && Date.parse(connection.sync_lease_expires_at) > Date.now();
      const oauthBusy = connection.oauth_lease_expires_at !== null && Date.parse(connection.oauth_lease_expires_at) > Date.now();
      const active = enabled && canManage && connection.status === "connected" && !connection.revocation_pending && !connection.authorization_uncertain && !running;
      const recentRuns = (runResult.data ?? []).filter((run) => run.connection_id === connection.id).slice(0, 5);
      const issues = reviewIssues(recentRuns[0]?.review_issues);
      const entityName = entities.find((entity) => entity.id === connection.business_entity_id)?.display_name;
      const visibility = googleSheetsResultVisibility(connection);
      const status = connection.revocation_pending ? "Disconnect needs another attempt" : connection.authorization_uncertain ? "Authorization needs recovery" : running ? "Syncing" : connection.status === "connected" ? "Connected" : connection.status === "reauthorization_required" ? visibility.requiresReconnect ? "Reauthorization required" : "Authorization not completed" : connection.status === "pending_authorization" ? "Waiting for Google authorization" : "Disconnected";
      const lastError = googleSheetsErrorMessage(connection.last_error_code);
      return <SectionCard key={connection.id} title={connection.display_name} description={entityName ? `Business entity: ${entityName}` : "Connection in this workspace"}>
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap gap-2"><StatusBadge value={status} />{mapping && connection.active_approval_id ? <StatusBadge value="Mapping approved" /> : connection.status === "connected" ? <StatusBadge value="Mapping needs approval" /> : null}</div>
          {visibility.visible ? <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-600">Last successful sync</dt><dd className="mt-1 font-medium text-ink">{connection.last_sync_at ? <time dateTime={connection.last_sync_at}>{time(connection.last_sync_at)}</time> : "Never synced"}</dd></div>
            <div><dt className="text-slate-600">Automatic refresh</dt><dd className="mt-1 font-medium text-ink">{connection.status !== "connected" ? "Paused" : connection.automatic_refresh_enabled ? "Every 15 minutes" : "Off"}{connection.status === "connected" && connection.automatic_refresh_enabled && connection.next_sync_at ? <span className="mt-1 block text-xs font-normal text-slate-600">Next eligible run: {time(connection.next_sync_at)}</span> : null}</dd></div>
          </dl> : <p className="text-sm text-slate-600">Authorization has not completed. No spreadsheet data has been imported for this connection.</p>}
          {connection.last_sync_at ? <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-4">
            <p><strong className="block text-xl text-ink">{connection.last_sync_row_count ?? 0}</strong><span className="text-slate-600">Rows read</span></p>
            <p><strong className="block text-xl text-ink">{connection.last_sync_fact_count ?? 0}</strong><span className="text-slate-600">Validated metrics</span></p>
            <p><strong className="block text-xl text-ink">{connection.last_sync_rejected_count ?? 0}</strong><span className="text-slate-600">Rejected rows</span></p>
            <p><strong className="block text-xl text-ink">{connection.last_sync_conflict_count ?? 0}</strong><span className="text-slate-600">Held for review</span></p>
          </div> : null}
          {lastError ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{lastError}</p> : null}
          {(connection.last_sync_rejected_count ?? 0) > 0 ? <p className="text-sm leading-6 text-slate-600">Rejected rows were not published. Check empty or duplicate row IDs, dates, numeric cells, and business labels in the selected columns, then sync again.</p> : null}
          {(connection.last_sync_conflict_count ?? 0) > 0 ? <p className="text-sm leading-6 text-slate-600">Held metrics overlap another source for the same metric and period. Review the source and metric definition before changing the mapping. Held values do not update Executive Intelligence.</p> : null}
          {issues.length ? <details open className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <summary className="min-h-8 cursor-pointer text-sm font-semibold text-amber-900">Values to review in the latest sync</summary>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-900">{issues.map((issue, index) => <li key={index}><strong>Row {issue.rowNumber}{issue.metricName ? ` · ${issue.metricName}` : ""}:</strong> {googleSheetsReviewReason(issue.reason)}</li>)}</ul>
            <p className="mt-3 text-xs leading-5 text-amber-900">Up to 25 issues are shown. Correct the source values or review the mapping, then sync again. Raw invalid values are not stored in this summary.</p>
          </details> : null}
          {connection.spreadsheet_id ? <p className="break-words text-sm text-slate-600">Spreadsheet: <a href={`https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}/edit`} target="_blank" rel="noreferrer" className="font-medium text-vaeroex-blue underline">{connection.spreadsheet_title || "Open spreadsheet"}<ExternalLink aria-label="Opens in a new tab" className="ml-1 inline h-3 w-3" /></a>{connection.sheet_title ? ` · Tab: ${connection.sheet_title}` : ""}</p> : null}
          {mapping ? <details className="rounded-md border border-line p-3"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">Saved field mapping · {mapping.metrics.length} metrics</summary><ul className="mt-2 space-y-1 text-sm text-slate-600"><li>Row ID: {headers[mapping.rowKeyColumn] || sheetColumn(mapping.rowKeyColumn)} · Date: {headers[mapping.dateColumn] || sheetColumn(mapping.dateColumn)}{mapping.locationColumn !== null ? ` · Location: ${headers[mapping.locationColumn] || sheetColumn(mapping.locationColumn)}` : ""}</li>{mapping.metrics.map((metric) => <li key={metric.column}>{headers[metric.column] || sheetColumn(metric.column)} → {metric.name} ({metric.unit})</li>)}</ul></details> : null}
          {running ? <p role="status" className="text-sm text-slate-600">A sync is in progress. <Link href="/app/settings/integrations/google-sheets" className="font-semibold text-vaeroex-blue underline">Refresh status</Link> after it completes.</p> : null}
          {connection.authorization_uncertain ? <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
            <p>The Google authorization response could not be confirmed. Remove Vaeroex access in your <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer" className="font-semibold underline">Google account connections</a>, then confirm removal here. Other Vaeroex connections using the same Google account may need to reconnect.</p>
            <p>Only the workspace owner who started this attempt can confirm removal. Vaeroex records your confirmation; Google does not verify this recovery step for us.</p>
            {enabled && canManage ? <form action="/api/integrations/google-sheets/recovery" method="post" className="space-y-3">
              <input type="hidden" name="connectionId" value={connection.id} />
              <label className="flex items-start gap-3"><input type="checkbox" name="confirmation" value="access_removed" required disabled={oauthBusy} className="mt-1.5 h-4 w-4 shrink-0" /><span>I removed Vaeroex access from the Google account used for this attempt.</span></label>
              {oauthBusy ? <p>The previous authorization may still be finishing. <Link href="/app/settings/integrations/google-sheets" className="font-semibold underline">Refresh this page</Link> after two minutes before confirming removal.</p> : null}
              <button type="submit" disabled={oauthBusy} className="min-h-11 rounded-md border border-amber-400 px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Confirm access removed</button>
            </form> : null}
          </div> : null}
          {enabled && canManage && connection.status !== "connected" && !connection.revocation_pending && !connection.authorization_uncertain ? <GoogleSheetsAuthorizationForm mode="reconnect"><input type="hidden" name="connectionId" value={connection.id} /></GoogleSheetsAuthorizationForm> : null}
          {active ? <details open={!connection.spreadsheet_id} className="rounded-md border border-line p-3 sm:p-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">1. Choose spreadsheet</summary><form action="/api/integrations/google-sheets/spreadsheet" method="post" className="mt-3 space-y-3"><input type="hidden" name="connectionId" value={connection.id} /><label className="block text-sm font-medium text-ink">Spreadsheet URL<input name="spreadsheetUrl" type="url" required defaultValue={connection.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${connection.spreadsheet_id}/edit` : ""} placeholder="https://docs.google.com/spreadsheets/d/…/edit" className={inputClass} /></label><p className="text-xs leading-5 text-slate-600">Saving a spreadsheet resets the tab and approval. Your Google account must have access to the spreadsheet.</p><button type="submit" className={buttonClass}>Find spreadsheet and tabs</button></form></details> : null}
          {active && tabs.length ? <details open={connection.sheet_id === null} className="rounded-md border border-line p-3 sm:p-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">2. Choose tab and headers</summary><form action="/api/integrations/google-sheets/tab" method="post" className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]"><input type="hidden" name="connectionId" value={connection.id} /><label className="min-w-0 text-sm font-medium text-ink">Tab<select name="sheetId" defaultValue={connection.sheet_id ?? tabs[0]?.id} required className={inputClass}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.title}</option>)}</select></label><label className="text-sm font-medium text-ink">Header row<input name="headerRow" type="number" min={1} max={25} defaultValue={connection.header_row} required className={inputClass} /></label><p className="text-xs leading-5 text-slate-600 sm:col-span-2">Row 1–25 must contain column labels. Discovering headers resets the mapping approval.</p><button type="submit" className={`${buttonClass} justify-self-start sm:col-span-2`}>Discover headers</button></form></details> : null}
          {active && connection.sheet_id !== null && headers.length ? <details open={!connection.active_approval_id} className="rounded-md border border-line p-3 sm:p-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">3. Preview and approve mapping</summary><div className="mt-3"><GoogleSheetsMappingEditor key={`${connection.id}:${connection.updated_at}`} connectionId={connection.id} headers={headers} savedMapping={mapping} automaticEnabled={connection.automatic_refresh_enabled} approved={Boolean(connection.active_approval_id)} /></div></details> : null}
          {active && mapping && connection.active_approval_id ? <form action="/api/integrations/google-sheets/sync" method="post" className="space-y-3 border-t border-line pt-4"><input type="hidden" name="connectionId" value={connection.id} /><label className="flex items-start gap-3 text-sm leading-6 text-slate-600"><input type="checkbox" name="confirmation" value="sync" required className="mt-1.5 h-4 w-4 shrink-0" /><span>Import the latest values using this approved mapping. Validated metrics may update Executive Intelligence.</span></label><div className="flex flex-wrap items-center gap-4"><button type="submit" className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Sync now</button><Link href="/app/intelligence" className="inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline">Open Executive Intelligence</Link></div></form> : null}
          {recentRuns.length ? <details className="rounded-md border border-line p-3"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-ink">Recent syncs</summary><ol className="mt-3 divide-y divide-line">{recentRuns.map((run) => <li key={run.id} className="space-y-1 py-3 text-sm"><div className="flex flex-wrap items-center gap-2"><StatusBadge value={run.status} /><span className="text-slate-600">{run.trigger_kind === "scheduled" ? "Automatic refresh" : "Manual sync"} · {time(run.started_at)}</span></div><p className="text-slate-600">{run.row_count} rows · {run.fact_count} validated metrics · {run.rejected_count} rejected rows · {run.conflict_count} held</p>{run.error_code ? <p className="text-amber-900">{googleSheetsErrorMessage(run.error_code)}</p> : null}</li>)}</ol></details> : runResult.error ? <p className="text-sm text-slate-600">Recent sync history is unavailable.</p> : null}
          {enabled && canManage && !connection.authorization_uncertain && (connection.status !== "disconnected" || connection.revocation_pending) ? <details className="border-t border-line pt-4"><summary className="min-h-8 cursor-pointer text-sm font-semibold text-red-700">{connection.revocation_pending ? "Finish disconnecting" : "Disconnect Google Sheets"}</summary><form action="/api/integrations/google-sheets/disconnect" method="post" className="mt-3 space-y-3"><input type="hidden" name="connectionId" value={connection.id} /><p className="text-sm leading-6 text-slate-600">Stops refresh and removes this connection’s Google access. Imported records retain their source history. Google may also revoke other Vaeroex connections using the same Google account; those connections may need to reconnect.</p><label className="flex items-start gap-3 text-sm leading-6 text-slate-600"><input type="checkbox" name="confirmation" value="disconnect" required className="mt-1.5 h-4 w-4 shrink-0" /><span>I confirm I want to disconnect this spreadsheet.</span></label><button type="submit" className="min-h-11 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700">{connection.revocation_pending ? "Retry disconnect" : "Disconnect"}</button></form></details> : null}
        </div>
      </SectionCard>;
    })}
    {enabled && !connectionResult.error && !connections.length ? <p className="text-sm text-slate-600">No Google Sheets connections in this workspace.</p> : null}
  </div>;
}
