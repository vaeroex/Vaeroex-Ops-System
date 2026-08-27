export type IntegrationConnectionSummaryRow = Readonly<{
  id: string;
  provider_key: string;
  safe_display_name: string;
  status: string;
  status_changed_at: string;
}>;

export type IntegrationFreshnessSummaryRow = Readonly<{
  connection_id: string;
  scope_key: string;
  status: string;
  last_successful_sync_at: string | null;
  calculated_at: string;
}>;

export type CustomerConnectionStatus =
  | "Connected"
  | "Syncing"
  | "Current"
  | "Delayed"
  | "Failed"
  | "Reauthorization required";

function latestTimestamp(values: readonly (string | null)[]) {
  return values
    .filter((value): value is string => value !== null)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function customerConnectionStatus(
  connection: IntegrationConnectionSummaryRow,
  freshness: readonly IntegrationFreshnessSummaryRow[]
) {
  let status: CustomerConnectionStatus;
  if (connection.status === "reauthorization_required") {
    status = "Reauthorization required";
  } else if (connection.status === "error" || freshness.some((row) => row.status === "sync_error")) {
    status = "Failed";
  } else if (
    ["pending_authorization", "authorized_unmapped", "initializing"].includes(
      connection.status
    )
  ) {
    status = "Syncing";
  } else if (
    connection.status === "degraded" ||
    freshness.some((row) => ["aging", "stale", "unknown"].includes(row.status))
  ) {
    status = "Delayed";
  } else if (
    connection.status === "active" &&
    freshness.length > 0 &&
    freshness.every((row) => row.status === "current")
  ) {
    status = "Current";
  } else {
    status = "Connected";
  }

  return {
    status,
    lastSuccessfulSyncAt: latestTimestamp(
      freshness.map((row) => row.last_successful_sync_at)
    ),
    freshnessCalculatedAt: latestTimestamp(
      freshness.map((row) => row.calculated_at)
    )
  } as const;
}
