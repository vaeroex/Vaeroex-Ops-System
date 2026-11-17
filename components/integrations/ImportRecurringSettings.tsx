import type { ImportProvider } from "@/lib/integrations/import-refresh/scope";
import type { ImportRecurringSettings as Settings } from "@/lib/integrations/import-refresh/settings-read";
import { ReportingRecurringSettings, ReportingRefreshTime } from "./ReportingRecurringSettings";

export function ImportRecurringSettings({ provider, connectionId, settings, allowed, owner, status, lastSuccess, timeZone, asOf }: {
  provider: ImportProvider; connectionId: string; settings: Settings | null; allowed: boolean; owner: boolean;
  status: string; lastSuccess: string | null; timeZone?: string | null; asOf: string;
}) {
  return <>
    {settings && (allowed || settings.state.recurring_enabled) ? <ReportingRecurringSettings provider={provider}
      connectionId={connectionId} state={settings.state} authority={settings.authority} owner={owner} allowed={allowed}
      connected={status === "connected"} lastSuccess={lastSuccess} timeZone={timeZone} asOf={asOf}/>
      : allowed && !settings ? <p role="status" className="text-sm text-slate-600">Automatic refresh settings are unavailable. Your existing connection and saved history are unchanged.</p>
      : <p className="text-sm text-slate-600">Last successful refresh: <ReportingRefreshTime value={lastSuccess} timeZone={timeZone}/>.</p>}
    {settings?.refreshNotBefore && Date.parse(settings.refreshNotBefore) > Date.parse(asOf) ? <p className="text-sm text-slate-600">Provider reads are paused until at least <ReportingRefreshTime value={settings.refreshNotBefore} timeZone={timeZone}/>. Saved history keeps its original date.</p> : null}
  </>;
}

export function importRecurringResultMessage(result?: string): string | null {
  if (result === "recurring_enabled") return "Automatic refresh is authorized. The next scheduled attempt will read the supported information described below.";
  if (result === "recurring_disabled") return "Automatic refresh is off. Previously saved information was kept.";
  if (result === "recurring_configuration_required") return "Automatic refresh is not available for this connection yet. Your saved history is unchanged.";
  if (result === "recurring_error") return "The automatic refresh change could not be confirmed. Check the saved authorization below before trying again.";
  return null;
}
