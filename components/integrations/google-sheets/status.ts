export const googleSheetsResults: Record<string, string> = {
  entity_created: "Business entity created. Select it above to connect your spreadsheet.",
  recovery_recorded: "Your confirmation of Google access removal was recorded. Reconnect Google Sheets to start a fresh authorization.",
  connected: "Google Sheets is connected. Add a spreadsheet URL, choose a tab, and review your mapping.",
  reconnected: "Google access has been renewed. Review your saved mapping and sync when ready.",
  spreadsheet_saved: "Spreadsheet found. Choose a tab and header row.",
  headers_discovered: "Headers found. Select the columns to preview and approve.",
  mapping_saved: "Mapping approved and saved. Sync now to validate and import the selected metrics.",
  synced: "Sync finished. Review the imported, rejected, and held counts below.",
  disconnected: "Google Sheets is disconnected. Automatic refresh has stopped."
};

export const googleSheetsErrors: Record<string, string> = {
  entity_create_failed: "The business entity could not be created. Check its name, three-letter currency, time zone, and fiscal month, then try again as the workspace owner.",
  automatic_refresh_unavailable: "Automatic refresh could not start. Check the workspace subscription and approved mapping, then try Sync now.",
  reconnect_required: "Google access has expired or was revoked. Reconnect to continue syncing.",
  report_too_large: "Google returned more data than this connector can safely process. Reduce the selected report and try again.",
  provider_unavailable: "Google could not return the spreadsheet. Check that the connected account still has access, then try again.",
  provider_request_failed: "Google could not return the spreadsheet. Check that the connected account still has access, then try again.",
  response_too_large: "The spreadsheet response is too large. Reduce the selected report and try again. No partial report was published.",
  headers_unavailable: "No usable headers were found. Choose the row that contains business column labels and try again.",
  headers_changed: "The spreadsheet headers changed. Discover the headers again and approve the updated mapping before syncing.",
  tab_missing: "The selected tab is no longer in the spreadsheet. Choose a tab and approve its mapping again.",
  sync_busy: "A sync is already running. Refresh this page after it completes.",
  mapping_required: "Review and approve the field mapping before syncing. The current workspace owner must approve the source.",
  row_key_invalid: "A data row has an empty or invalid row ID. Fill every data row with a stable business record ID and sync again.",
  workspace_capacity: "This import would exceed the workspace’s 20,000 active metric limit. Reduce the report or archive older metrics before syncing again.",
  snapshot_changed: "The spreadsheet changed while it was being read. Let edits finish, then sync again. The previous successful import remains unchanged.",
  lease_expired: "The previous sync did not finish in time. Try Sync now again.",
  recovery_required: "Remove Vaeroex access from the Google account used for this attempt, then complete connection recovery here.",
  request_failed: "That step could not be completed. Check the connection and selected spreadsheet, then try again.",
  row_limit: "This report exceeds the import limit. Use a tab with at most 10,000 data rows below the header and 15,000 numeric observations. No partial report was published.",
  observation_limit: "This report has more than 15,000 numeric observations. Reduce the rows or selected metrics before syncing. No partial report was published.",
  sheet_changed: "The selected tab or mapped headers changed. Discover the headers again, review the mapping, and approve it before syncing.",
  invalid_value: "Some selected values could not be interpreted. Check numeric values and the chosen date format in the sheet.",
  sync_running: "A sync is already running. Refresh this page after it completes.",
  refresh_busy: "Google access is being renewed. Wait a moment and try again.",
  invalid_state: "The connection attempt expired or was already used. Reconnect to start a new Google authorization.",
  not_permitted: "You must be the workspace owner to manage this connection.",
  consent_denied: "Google access was not granted. Reconnect when you are ready to approve read only access.",
  connection_unavailable: "This connection is no longer available. Refresh the page to check its status.",
  authorization_required: "Google access has expired or was revoked. Reconnect to continue syncing.",
  reauthorization_required: "Google access has expired or was revoked. Reconnect to continue syncing.",
  revocation_pending: "Local access is stopped. Google access removal is still pending. Retry disconnect to finish removing it.",
  approval_required: "Review and approve the field mapping before syncing this connection.",
  duplicate_row_key: "The selected row ID column contains duplicate IDs. Give every business record a unique, stable ID and sync again.",
  sync_failed: "The last sync did not complete. Check Google access and your mapping, then try Sync now."
};

export function googleSheetsErrorMessage(code: string | null | undefined) {
  if (!code) return null;
  const normalized = code.replace(/^google_sheets_/, "");
  return googleSheetsErrors[normalized] ?? "The last operation could not complete. Check the connection, spreadsheet access, and saved mapping, then try again.";
}

export function googleSheetsReviewReason(reason: string) {
  const reasons: Record<string, string> = {
    date_required: "Add a date to the mapped date column.",
    date_invalid: "Use a valid date in the format selected in the mapping.",
    location_invalid: "Use a non-sensitive business location label or code.",
    numeric_values_required: "Add at least one numeric metric value.",
    overlapping_metric_period: "This metric and date overlap another record or source. Review the metric definition and source before changing the mapping."
  };
  const column = /^numeric_column_(\d{1,2})_invalid$/.exec(reason);
  return column ? `Column ${Number(column[1]) + 1} needs a valid numeric value in the selected unit.` : reasons[reason] ?? "Review this row’s mapped values and sync again.";
}
