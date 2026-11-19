import { z } from "zod";

const instant = z.string().datetime({ offset: true }).nullable();
export const SquareRecurringStatusSchema = z.object({
  recurring_enabled: z.boolean(), recurring_next_refresh_at: instant, recurring_last_attempt_at: instant,
  recurring_failure_count: z.number().int().nonnegative(), recurring_last_failure_at: instant,
  recurring_last_error_code: z.enum(["retry_required", "reauthorization_required"]).nullable(),
  authorized: z.boolean(), reason: z.enum(["active", "disabled", "owner_unavailable", "entitlement_unavailable",
    "connection_unavailable", "configuration_unavailable", "manual_read_in_progress"]),
  last_successful_refresh_at: instant, has_more: z.boolean(), manual_read_in_progress: z.boolean()
}).strict();
export type SquareRecurringStatus = z.infer<typeof SquareRecurringStatusSchema>;
export type SquareRecurringView = { connectionId: string; rolloutAllowed: boolean; status: SquareRecurringStatus | null };
