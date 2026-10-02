import { createRoot } from "react-dom/client";
import { ReportingTimezoneForm } from "@/components/settings/ReportingTimezoneForm";
import { SectionCard } from "@/components/operations/SectionCard";
import type { ReportingTimezoneState } from "@/app/app/settings/reporting-timezone-action";

declare global {
  interface Window {
    timezoneFixture: {
      calls: Record<string, FormDataEntryValue>[];
      complete?: (result: "success" | "error" | "transport") => void;
      switchWorkspace?: () => void;
    };
  }
}

window.timezoneFixture = { calls: [] };
export async function saveReportingTimezoneAction(_previous: ReportingTimezoneState, data: FormData): Promise<ReportingTimezoneState> {
  window.timezoneFixture.calls.push(Object.fromEntries(data.entries()));
  return new Promise((resolve, reject) => {
    window.timezoneFixture.complete = result => {
      if (result === "transport") reject(Error("fixture transport failure"));
      else resolve(result === "error"
        ? { status: "error", message: "The reporting timezone could not be saved. Try again." }
        : { status: "success", message: data.get("reportingTimezone")
          ? `Reporting timezone saved: ${data.get("reportingTimezone")}.`
          : "Reporting timezone cleared. Refresh timestamps use UTC until configured." });
    };
  });
}

const root = createRoot(document.getElementById("fixture")!);
function render(workspaceId: string, reportingTimezone: string | null) {
  root.render(<SectionCard title="Workspace">
    <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
      <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Current workspace</dt>
        <dd className="mt-1 font-semibold text-ink">Test workspace</dd></div>
      <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Your role</dt>
        <dd className="mt-1 font-semibold text-ink">owner</dd></div>
    </dl>
    <ReportingTimezoneForm key={workspaceId} workspaceId={workspaceId} reportingTimezone={reportingTimezone}
      timeZones={Array.from(new Set(["UTC", ...Intl.supportedValuesOf("timeZone")])).sort()} />
  </SectionCard>);
}
render("10000000-0000-4000-8000-000000000001", null);
window.timezoneFixture.switchWorkspace = () => render("10000000-0000-4000-8000-000000000002", "UTC");
