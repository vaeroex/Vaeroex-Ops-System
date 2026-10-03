"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Eye, EyeOff, RefreshCw } from "lucide-react";
import { DashboardEntry, IntegrationDashboard, IntegrationDashboardSchema, dashboardTimestamp, integrationDashboardStatus } from "@/lib/integrations/dashboard/model";

const REFRESH_INTERVAL = 60_000;
const AUTOMATIC_CHECK_LIMIT = 10;

export function CurrentIntegrations({ initial }: { initial: IntegrationDashboard }) {
  const [dashboard, setDashboard] = useState(initial);
  const [now, setNow] = useState(initial.observedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [automaticPaused, setAutomaticPaused] = useState(false);
  const inFlight = useRef(false);
  const preferenceInFlight = useRef(false);
  const generation = useRef(0);
  const lastRequestedAt = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const workspaceId = initial.workspaceId;

  const refresh = useCallback(async () => {
    if (inFlight.current || preferenceInFlight.current || Date.now() - lastRequestedAt.current < 10_000) return;
    inFlight.current = true;
    lastRequestedAt.current = Date.now();
    setRefreshing(true);
    const currentGeneration = generation.current;
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 15_000);
    try {
      const response = await fetch(`/api/integrations/dashboard?workspaceId=${encodeURIComponent(workspaceId)}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.current.signal
      });
      if (!response.ok) throw new Error("dashboard_unavailable");
      const value = IntegrationDashboardSchema.parse(await response.json());
      if (value.workspaceId !== workspaceId) throw new Error("dashboard_workspace_changed");
      if (generation.current === currentGeneration) {
        setDashboard(value); setNow(value.observedAt); setRefreshError(false);
      }
    } catch {
      if (generation.current === currentGeneration) setRefreshError(true);
    } finally { clearTimeout(timer); inFlight.current = false; setRefreshing(false); }
  }, [workspaceId]);

  useEffect(() => {
    let attempts = 0;
    const interval = setInterval(() => {
      setNow(new Date().toISOString());
      if (document.visibilityState !== "visible" || inFlight.current || preferenceInFlight.current) return;
      if (attempts >= AUTOMATIC_CHECK_LIMIT) { setAutomaticPaused(true); return; }
      attempts += 1;
      void refresh();
    }, REFRESH_INTERVAL);
    return () => { clearInterval(interval); generation.current += 1; controller.current?.abort(); };
  }, [refresh]);

  const savePreference = async (entry: DashboardEntry, hiddenWhenDisconnected: boolean) => {
    if (preferenceInFlight.current || entry.connectionState !== "disconnected") return;
    preferenceInFlight.current = true;
    generation.current += 1;
    controller.current?.abort();
    setSaving(entry.key); setPreferenceError(null);
    const preferenceController = new AbortController();
    const timer = setTimeout(() => preferenceController.abort(), 15_000);
    try {
      const response = await fetch("/api/integrations/dashboard/preferences", { method: "PATCH", credentials: "same-origin",
        signal: preferenceController.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedWorkspaceId: workspaceId, summaryKey: entry.key, hiddenWhenDisconnected }) });
      if (!response.ok) throw new Error("preference_unavailable");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("workspaceId" in result) || result.workspaceId !== workspaceId
        || !("summaryKey" in result) || result.summaryKey !== entry.key
        || !("hiddenWhenDisconnected" in result) || result.hiddenWhenDisconnected !== hiddenWhenDisconnected)
        throw new Error("preference_workspace_changed");
      setDashboard(value => ({ ...value, entries: value.entries.map(row => row.key === entry.key ? { ...row, hidden: hiddenWhenDisconnected } : row) }));
    } catch { setPreferenceError("Your display preference could not be saved. Please try again."); }
    finally { clearTimeout(timer); preferenceInFlight.current = false; setSaving(null); }
  };

  const active = dashboard.entries.filter(entry => entry.connectionState !== "disconnected");
  const previous = dashboard.entries.filter(entry => entry.connectionState === "disconnected" && !entry.hidden);
  const hidden = dashboard.entries.filter(entry => entry.connectionState === "disconnected" && entry.hidden);
  const previousRow = (entry: DashboardEntry, restore = false) => <li key={entry.key} className="flex min-w-0 flex-col gap-2 border-t border-white/10 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><p className="break-words text-sm font-medium text-white">{entry.provider} / {entry.name}</p><p className="text-xs text-slate-400">Disconnected</p></div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
      <Link href={entry.href as Route} className="inline-flex min-h-11 items-center text-sm font-medium text-cyan-200 hover:underline">Reconnect<span className="sr-only"> {entry.provider}, {entry.name}</span></Link>
      <button type="button" disabled={saving !== null || !dashboard.preferencesAvailable} onClick={() => void savePreference(entry, !restore)}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-300 hover:text-white disabled:opacity-50">
        {restore ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
        {saving === entry.key ? "Saving..." : restore ? "Restore" : "Hide from this page"}<span className="sr-only"> {entry.provider}, {entry.name}</span>
      </button>
    </div>
  </li>;

  return <section aria-labelledby="current-integrations-heading" className="min-w-0 space-y-4 border-t border-white/10 py-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="current-integrations-heading" className="text-lg font-semibold text-white">Current integrations</h2>
      <div className="flex items-center gap-4">
        <Link href="/app/integrations" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-cyan-200 hover:underline">Manage integrations<ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || saving !== null} aria-label="Refresh integration status" title="Refresh saved integration status"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/15 text-slate-200 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </button>
      </div>
    </div>
    <div aria-live="polite" className="space-y-1 text-xs text-slate-400">
      <p>{refreshing ? "Checking saved status..." : `Status checked ${dashboardTimestamp(dashboard.observedAt, dashboard.timeZone)}`}</p>
      {!dashboard.timeZoneConfirmed ? <p>Refresh times are shown in UTC. An owner can set the workspace timezone in <Link href="/app/settings" className="underline">Settings</Link>.</p> : null}
      {automaticPaused ? <p>Automatic status checks paused. Refresh status to check again.</p> : null}
      {refreshError ? <p className="text-amber-200">Status could not be refreshed. Values below are last-known data.</p> : null}
      {dashboard.unavailable.length ? <p className="text-amber-200">{dashboard.unavailable.join(", ")} status is unavailable. Check Integrations.</p> : null}
      {preferenceError ? <p role="alert" className="text-amber-200">{preferenceError}</p> : null}
      {!dashboard.preferencesAvailable ? <p>Personal display preferences are temporarily unavailable.</p> : null}
    </div>
    {!active.length ? <div className="py-3"><p className="font-medium text-white">{dashboard.unavailable.length ? "Active integration status is unavailable" : "No active integrations"}</p></div> :
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">{active.map(entry => {
        const status = integrationDashboardStatus(entry, now);
        const current = status.current && !refreshError;
        return <article key={entry.key} className="min-w-0 rounded-lg border border-white/10 p-4">
          <p className="text-xs font-medium text-slate-400">{entry.provider}</p>
          <h3 className="mt-1 break-words text-base font-semibold text-white">{entry.name}</h3>
          <p className={`mt-2 text-sm ${status.tone === "warning" || refreshError ? "text-amber-200" : current ? "text-emerald-200" : "text-slate-300"}`}>{refreshError ? "Last-known data" : status.label}</p>
          {entry.lastSuccessfulRefreshAt ? <p className="mt-1 text-xs text-slate-400">Last successful refresh <time dateTime={entry.lastSuccessfulRefreshAt}>{dashboardTimestamp(entry.lastSuccessfulRefreshAt, dashboard.timeZone)}</time></p> : null}
          <p className="mt-1 text-xs text-slate-400">{entry.cadence}</p>
          {entry.results.length ? <div className="mt-4 space-y-3">{!current ? <p className="text-xs font-medium text-amber-200">Last-known values, not included in current totals.</p> : null}{entry.results.map((result, index) => <div key={`${result.label}:${result.period}:${index}`} className="min-w-0 border-t border-white/10 pt-3">
            <p className="break-words text-sm text-slate-300">{result.label}</p>
            <p className="mt-1 break-words text-xl font-semibold text-white">{result.value}</p>
            <p className="mt-1 text-xs text-slate-400">{result.period}</p>
            {result.limitation ? <p className="mt-1 text-xs text-slate-400">{result.limitation}</p> : null}
            <Link href={result.href as Route} className="inline-flex min-h-11 items-center text-sm text-cyan-200 hover:underline">View supporting data</Link>
          </div>)}</div> : <p className="mt-3 text-sm text-slate-300">{entry.lastSuccessfulRefreshAt ? "No validated business results are available for this connection yet." : "Business results will appear after a successful import and validation."}</p>}
          <Link href={entry.href as Route} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-cyan-200 hover:underline">{entry.connectionState === "reauthorization_required" ? "Reconnect" : "Manage"}<span className="sr-only"> {entry.provider}, {entry.name}</span></Link>
        </article>;
      })}</div>}
    {previous.length ? <div><h3 className="text-sm font-semibold text-slate-300">Previously connected</h3><ul className="mt-2">{previous.map(entry => previousRow(entry))}</ul></div> : null}
    {hidden.length ? <details className="border-t border-white/10 pt-3"><summary className="cursor-pointer py-2 text-sm text-slate-300 focus-visible:outline focus-visible:outline-2">Hidden integrations ({hidden.length})</summary><ul>{hidden.map(entry => previousRow(entry, true))}</ul></details> : null}
  </section>;
}
