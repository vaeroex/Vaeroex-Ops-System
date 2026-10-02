export type IntegrationResultEvidence = Readonly<{
  successfulAuthorization: boolean;
  hasImportedData: boolean;
  connectionState: "connected" | "setup" | "disconnected" | "reauthorization_required" | "sync_error";
  lastSuccessfulSyncAt: string | null;
  freshness: "current" | "stale" | "unknown";
}>;

// Presentation eligibility is not accounting authority. Callers must supply
// canonical authorization/import evidence, never the existence or age of an attempt.
export function integrationResultVisibility(evidence: IntegrationResultEvidence) {
  const visible = evidence.successfulAuthorization || evidence.hasImportedData || evidence.lastSuccessfulSyncAt !== null;
  const requiresReconnect = visible && evidence.connectionState === "reauthorization_required";
  const status = !visible ? null
    : evidence.connectionState === "disconnected" ? "Disconnected. Saved data is retained; new imports are stopped."
      : requiresReconnect ? "Reconnect to resume imports. Saved data is retained."
        : evidence.connectionState === "setup" ? "Finish setup in Integrations."
          : evidence.connectionState === "sync_error" ? "The latest sync failed. View Integrations for details."
            : !evidence.hasImportedData && !evidence.lastSuccessfulSyncAt ? "Connected. A completed sync has not been recorded yet."
              : evidence.freshness === "stale" ? "Sync is delayed. Saved results may be out of date."
                : evidence.freshness === "unknown" ? "Sync freshness is not yet confirmed." : null;
  return { visible, requiresReconnect, status, lastSuccessfulSyncAt: evidence.lastSuccessfulSyncAt };
}

export type IntegrationResultVisibility = ReturnType<typeof integrationResultVisibility>;
