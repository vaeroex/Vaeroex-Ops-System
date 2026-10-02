import { integrationResultVisibility, type IntegrationResultEvidence } from "@/lib/integrations/control-plane/result-visibility";
import type { DirectView } from "./contracts";

type Connection = DirectView["connections"][number];
export type SquareResultConnection = Pick<Connection, "state" | "sellerLabel"> & Partial<Pick<Connection,
  "locationId" | "lastSyncedAt" | "lastCompletedRead" | "lastError" | "activeRead" | "hasMore" |
  "revocationPending" | "recoveryRequired" | "payments">> & { paymentCount?: number };

export function squareResultEvidence(connection: SquareResultConnection): IntegrationResultEvidence {
  // Credential staging precedes successful discovery. The completed connection
  // writes the seller label; mapping and saved reads provide further proof.
  const successfulAuthorization = Boolean(connection.sellerLabel || connection.locationId);
  const hasImportedData = (connection.paymentCount ?? connection.payments?.length ?? 0) > 0;
  const lastSuccessfulSyncAt = [connection.lastSyncedAt, connection.lastCompletedRead?.completedAt]
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  let connectionState: IntegrationResultEvidence["connectionState"];
  if (connection.recoveryRequired) connectionState = "setup";
  else if (connection.state === "disconnected" || connection.revocationPending) connectionState = "disconnected";
  else if (connection.state === "reauthorization_required") {
    // The status RPC also projects expired exchange leases as reauthorization.
    connectionState = connection.lastError === "reauthorization_required" ? "reauthorization_required" : "setup";
  } else if (connection.state === "retry_required") connectionState = "sync_error";
  else if (connection.state === "connected" || connection.state === "syncing") connectionState = "connected";
  else connectionState = "setup";
  return {
    successfulAuthorization, hasImportedData, connectionState, lastSuccessfulSyncAt,
    freshness: lastSuccessfulSyncAt && (connection.lastError || connection.activeRead || connection.hasMore) ? "stale" : "unknown"
  };
}

export function squareResultVisibility(connection: SquareResultConnection) {
  return integrationResultVisibility(squareResultEvidence(connection));
}
