import "server-only";
import { z } from "zod";
import type { admin } from "@/lib/integrations/reporting/security";
import type { ReportingRecurringAuthority, ReportingRecurringState } from "@/components/integrations/ReportingRecurringSettings";
import type { ImportProvider } from "./scope";

const tables = { loyverse: "loyverse_connections", "zoho-books": "zoho_books_connections", "wix-orders": "wix_order_connections" } as const;
const instant = z.string().datetime({ offset: true }).nullable();
const stateSchema = z.object({ recurring_enabled: z.boolean(), recurring_authorized_at: instant,
  recurring_next_refresh_at: instant, recurring_last_attempt_at: instant, recurring_failure_count: z.number().int().nonnegative(),
  recurring_last_failure_at: instant, refresh_not_before: instant }).strict();
const authoritySchema = z.object({ authorized: z.boolean(), reason: z.enum([
  "active", "owner_unavailable", "entitlement_unavailable", "disabled", "connection_unavailable"
]) }).strict();

export type ImportRecurringSettings = { state: ReportingRecurringState; authority: ReportingRecurringAuthority | null; refreshNotBefore: string | null };

/** Call only after the authenticated page selects this exact workspace row.
 * Optional rollout columns never replace the legacy query or hide saved data. */
export async function readImportRecurringSettings(db: ReturnType<typeof admin>, workspaceId: string, provider: ImportProvider,
  connectionId: string): Promise<ImportRecurringSettings | null> {
  let state: z.infer<typeof stateSchema>;
  try {
    const result = await db.from(tables[provider])
      .select("recurring_enabled,recurring_authorized_at,recurring_next_refresh_at,recurring_last_attempt_at,recurring_failure_count,recurring_last_failure_at,refresh_not_before")
      .eq("workspace_id", workspaceId).eq("id", connectionId).maybeSingle();
    const parsed = stateSchema.safeParse(result.data);
    if (result.error || !parsed.success) return null;
    state = parsed.data;
  } catch { return null; }
  let authority: ReportingRecurringAuthority | null = null;
  if (state.recurring_enabled) {
    try {
      const result = await db.rpc("import_recurring_status", { p_workspace: workspaceId, p_provider: provider, p_connection: connectionId });
      const parsed = authoritySchema.safeParse(result.data);
      if (!result.error && parsed.success) authority = parsed.data;
    } catch { /* A failed status read never claims that automatic access is active. */ }
  }
  const { refresh_not_before: refreshNotBefore, ...recurring } = state;
  return { state: recurring, authority, refreshNotBefore };
}
