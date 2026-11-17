// Shared presentation/status types live in lib so isolated worker builds do not depend on UI files.
export type ReportingRecurringState = {
  recurring_enabled: boolean;
  recurring_authorized_at: string | null;
  recurring_next_refresh_at: string | null;
  recurring_last_attempt_at: string | null;
  recurring_failure_count: number;
  recurring_last_failure_at: string | null;
};
export type ReportingRecurringAuthority = {
  authorized: boolean;
  reason: "active" | "owner_unavailable" | "entitlement_unavailable" | "disabled" | "connection_unavailable";
};

