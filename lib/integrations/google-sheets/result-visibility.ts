import { integrationResultVisibility, type IntegrationResultEvidence } from "@/lib/integrations/control-plane/result-visibility";
import type { GoogleSheetsConnectionRow } from "@/lib/supabase/types";

export type GoogleSheetsResultConnection = Pick<GoogleSheetsConnectionRow,
  "status" | "credential_version" | "spreadsheet_id" | "active_approval_id" | "last_sync_at" |
  "last_sync_fact_count" | "last_error_code" | "revocation_pending" | "authorization_uncertain">;

export function googleSheetsResultEvidence(connection: GoogleSheetsResultConnection): IntegrationResultEvidence {
  // Reconnect resets the credential version. Successfully saved spreadsheet
  // configuration and completed imports remain proof from earlier generations.
  const successfulAuthorization = connection.credential_version > 0 || Boolean(connection.spreadsheet_id || connection.active_approval_id);
  const lastSuccessfulSyncAt = connection.last_sync_at && Number.isFinite(Date.parse(connection.last_sync_at)) ? connection.last_sync_at : null;
  let connectionState: IntegrationResultEvidence["connectionState"];
  if (connection.status === "disconnected" || connection.revocation_pending) connectionState = "disconnected";
  else if (connection.authorization_uncertain || connection.status === "pending_authorization") connectionState = "setup";
  else if (connection.status === "reauthorization_required") {
    // Declined replacement consent has version zero, even with earlier history.
    connectionState = connection.credential_version > 0 ? "reauthorization_required" : "setup";
  } else if (connection.last_error_code) connectionState = "sync_error";
  else connectionState = connection.active_approval_id ? "connected" : "setup";
  return {
    successfulAuthorization,
    hasImportedData: lastSuccessfulSyncAt !== null && connection.last_sync_fact_count > 0,
    connectionState, lastSuccessfulSyncAt,
    freshness: lastSuccessfulSyncAt && connection.last_error_code ? "stale" : "unknown"
  };
}

export function googleSheetsResultVisibility(connection: GoogleSheetsResultConnection) {
  return integrationResultVisibility(googleSheetsResultEvidence(connection));
}
