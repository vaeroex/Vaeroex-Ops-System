import "server-only";
import { integrationResultVisibility } from "@/lib/integrations/control-plane/result-visibility";
import { squareDirectEnabled, squareDirectPayments, squareSettingsPath } from "@/lib/integrations/square-direct/server";
import { squareResultEvidence } from "@/lib/integrations/square-direct/result-visibility";
import { sheetsEnabled } from "@/lib/integrations/google-sheets/server";
import { googleSheetsResultEvidence } from "@/lib/integrations/google-sheets/result-visibility";
import type { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { SquareSheetsResultsView, type SquareSheetsResult } from "./SquareSheetsResultsView";

type Props = Pick<Awaited<ReturnType<typeof requireWorkspacePage>>, "supabase" | "workspaceId"> & { isOwner: boolean };

export async function loadSquareSheetsResults({ supabase, workspaceId, isOwner }: Props): Promise<SquareSheetsResult[]> {
  const [square, sheets] = await Promise.all([
    isOwner && squareDirectEnabled() ? squareDirectPayments({}, workspaceId).catch(() => null) : null,
    sheetsEnabled() ? supabase.from("google_sheets_connections")
      .select("id, display_name, status, credential_version, spreadsheet_id, active_approval_id, last_sync_at, last_sync_fact_count, last_error_code, revocation_pending, authorization_uncertain")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false }) : null
  ]);
  const results: SquareSheetsResult[] = [];
  // The stored-payment browser includes historical connections beyond the
  // status preview's 32-row bound and makes no provider request.
  for (const connection of square?.connections ?? []) {
    const current = square?.currentConnection?.connectionId === connection.connectionId ? square.currentConnection : null;
    const evidence = squareResultEvidence({ ...connection, ...current });
    results.push({
      key: `square:${connection.connectionId}`, provider: "Square",
      label: [connection.sellerLabel ?? connection.businessEntityLabel, connection.locationLabel].filter(Boolean).join(" / "),
      href: `${squareSettingsPath}?connectionId=${encodeURIComponent(connection.connectionId)}#saved-payments`,
      hasImportedData: evidence.hasImportedData, visibility: integrationResultVisibility(evidence)
    });
  }
  if (!sheets?.error) for (const connection of sheets?.data ?? []) {
    const evidence = googleSheetsResultEvidence(connection);
    results.push({
      key: `google-sheets:${connection.id}`, provider: "Google Sheets", label: connection.display_name,
      href: "/app/settings/integrations/google-sheets", hasImportedData: evidence.hasImportedData,
      visibility: integrationResultVisibility(evidence)
    });
  }
  return results.filter(result => result.visibility.visible);
}

export async function SquareSheetsResults(props: Props) {
  return <SquareSheetsResultsView results={await loadSquareSheetsResults(props)} />;
}
