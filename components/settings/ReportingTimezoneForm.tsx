"use client";

import { startTransition, useActionState, useState } from "react";
import { Save } from "lucide-react";
import { saveReportingTimezoneAction, type ReportingTimezoneState } from "@/app/app/settings/reporting-timezone-action";

export function ReportingTimezoneForm({ workspaceId, reportingTimezone, timeZones }: {
  workspaceId: string;
  reportingTimezone: string | null;
  timeZones: string[];
}) {
  const [selected, setSelected] = useState(reportingTimezone ?? "");
  const [state, submit, pending] = useActionState<ReportingTimezoneState, FormData>(async (previous, data) => {
    try {
      return await saveReportingTimezoneAction(previous, data);
    } catch (error) {
      if (error && typeof error === "object" && "digest" in error
        && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
      return { status: "error", message: "The save could not be confirmed. Reload Settings to check the saved timezone." };
    }
  }, { status: "idle" });

  return (
    <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      // Preserve the selected value across React's automatic action-form reset.
      startTransition(() => submit(data));
    }}>
      <input type="hidden" name="expectedWorkspaceId" value={workspaceId} />
      <label className="block text-sm font-medium text-ink">
        Reporting timezone
        <select name="reportingTimezone" value={selected} onChange={event => setSelected(event.target.value)}
          disabled={pending} className="mt-2 min-h-11 w-full min-w-0 max-w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-vaeroex-blue disabled:opacity-60">
          <option value="">Not configured (UTC)</option>
          {timeZones.map(timeZone => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending} aria-busy={pending}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        <Save aria-hidden="true" className="h-4 w-4 shrink-0" />{pending ? "Saving..." : "Save timezone"}
      </button>
      {!pending && state.message ? <p role={state.status === "error" ? "alert" : "status"}
        className={`break-words text-sm ${state.status === "error" ? "text-red-700" : "text-vaeroex-blue"}`}>{state.message}</p> : null}
    </form>
  );
}
