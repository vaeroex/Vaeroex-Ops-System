import "server-only";

import type { WorkspaceAccess } from "@/lib/security/types";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";

/** Conservative, application-only admission. Do not load historical report
 * content before its stored read-ticket attribution is known. A citation in a
 * JSON envelope is not database attribution. Roots-only legacy records remain
 * excluded until a separately reviewed read-only eligibility API exists.
 * RLS, original-source checks and the final read-ticket guard still apply. */
export async function loadVsiAttributedReports({ supabase, workspaceId }: WorkspaceAccess) {
  const filter = { record_kind: "saved_analysis", release_channel: currentSavedAnalysisReleaseChannel() };
  const [reports, legacy] = await Promise.all([
    supabase.from("reports").select("id,title,source_data_json,created_at,google_sheets_read_ticket_id")
      .eq("workspace_id", workspaceId).is("deleted_at", null).is("archived_at", null)
      .contains("source_data_json", filter).not("google_sheets_read_ticket_id", "is", null)
      .order("created_at", { ascending: false }).limit(30),
    // Presence only: never load titles, summaries, citations or other content
    // from reports whose attribution this application cannot verify.
    supabase.from("reports").select("id")
      .eq("workspace_id", workspaceId).is("deleted_at", null).is("archived_at", null)
      .contains("source_data_json", filter).is("google_sheets_read_ticket_id", null).limit(1)
  ]);
  const limitations: string[] = [];
  if (reports.error || legacy.error) limitations.push("Some saved analyses could not be checked for this answer.");
  if (legacy.data?.length) limitations.push("Historical saved analyses without verified read-ticket attribution were excluded. This answer uses the remaining permitted sources.");
  const data = reports.error ? [] : (reports.data || []).filter(report => Boolean(report.google_sheets_read_ticket_id));
  return { data, limitations };
}
