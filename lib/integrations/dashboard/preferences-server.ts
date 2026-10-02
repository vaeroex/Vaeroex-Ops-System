import "server-only";

import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export const IntegrationSummaryKeySchema = z.string().max(82)
  .regex(/^(square|quickbooks_online|google_sheets):[a-f0-9]{64}$/)
  .refine((key) => key === key.trim());

export const IntegrationSummaryPreferenceInputSchema = z.object({
  expectedWorkspaceId: z.string().uuid(),
  summaryKey: IntegrationSummaryKeySchema,
  hiddenWhenDisconnected: z.boolean()
}).strict();

export type IntegrationSummaryPreferenceInput = z.infer<typeof IntegrationSummaryPreferenceInputSchema>;
export type IntegrationSummaryPreference = {
  summaryKey: string;
  hiddenWhenDisconnected: boolean;
};

const rowSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid(),
  summary_key: IntegrationSummaryKeySchema,
  hidden_when_disconnected: z.boolean()
}).strict();
type PreferenceRow = z.infer<typeof rowSchema>;
type QueryResult = { data: unknown; error: unknown };
type PreferenceQuery = PromiseLike<QueryResult> & {
  eq(column: string, value: string): PreferenceQuery;
  single(): PromiseLike<QueryResult>;
};

// Narrow bridge until the shared generated Database type includes this table.
export type IntegrationSummaryPreferenceClient = {
  from(table: "integration_summary_preferences"): {
    select(columns: string): PreferenceQuery;
    upsert(row: PreferenceRow, options: { onConflict: string }): {
      select(columns: string): PreferenceQuery;
    };
  };
};
type WorkspaceAccess = Awaited<ReturnType<typeof requireWorkspaceAccess>>;
export type IntegrationSummaryPreferenceAccess = {
  supabase: WorkspaceAccess["supabase"] | IntegrationSummaryPreferenceClient;
  workspaceId: string;
  user: { id: string };
  membership: { workspace_id: string; user_id: string | null; status: string };
};

export class IntegrationSummaryPreferenceError extends Error {
  constructor(
    readonly code: "invalid_preference" | "preference_access_denied" | "workspace_changed" | "preference_save_failed",
    readonly status: number
  ) {
    super(code);
    this.name = "IntegrationSummaryPreferenceError";
  }
}

const columns = "workspace_id,user_id,summary_key,hidden_when_disconnected";

async function preferenceAccess(authenticated?: IntegrationSummaryPreferenceAccess) {
  const access = authenticated ?? await requireWorkspaceAccess();
  if (!z.string().uuid().safeParse(access.user.id).success ||
      !z.string().uuid().safeParse(access.workspaceId).success ||
      access.membership.user_id !== access.user.id || access.membership.workspace_id !== access.workspaceId ||
      access.membership.status !== "active") {
    throw new IntegrationSummaryPreferenceError("preference_access_denied", 403);
  }
  return { ...access, client: access.supabase as unknown as IntegrationSummaryPreferenceClient };
}

export type IntegrationSummaryPreferencesResult =
  | { state: "ready"; workspaceId: string; preferences: IntegrationSummaryPreference[]; hiddenSummaryKeys: string[] }
  | { state: "unavailable"; preferences: []; hiddenSummaryKeys: [] };

export async function readIntegrationSummaryPreferences(
  authenticated?: IntegrationSummaryPreferenceAccess
): Promise<IntegrationSummaryPreferencesResult> {
  try {
    const { client, workspaceId, user } = await preferenceAccess(authenticated);
    const result = await client.from("integration_summary_preferences").select(columns)
      .eq("workspace_id", workspaceId).eq("user_id", user.id);
    if (result.error) throw new Error("preference_read_failed");
    const rows = z.array(rowSchema).parse(result.data);
    if (rows.some((row) => row.workspace_id !== workspaceId || row.user_id !== user.id)) {
      throw new Error("preference_scope_invalid");
    }
    const preferences = rows.map((row) => ({ summaryKey: row.summary_key, hiddenWhenDisconnected: row.hidden_when_disconnected }));
    return { state: "ready", workspaceId, preferences,
      hiddenSummaryKeys: preferences.filter((row) => row.hiddenWhenDisconnected).map((row) => row.summaryKey) };
  } catch {
    return { state: "unavailable", preferences: [], hiddenSummaryKeys: [] };
  }
}

export async function saveIntegrationSummaryPreference(
  input: IntegrationSummaryPreferenceInput,
  authenticated?: IntegrationSummaryPreferenceAccess
): Promise<IntegrationSummaryPreference & { workspaceId: string }> {
  const parsed = IntegrationSummaryPreferenceInputSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationSummaryPreferenceError("invalid_preference", 400);
  try {
    const { client, workspaceId, user } = await preferenceAccess(authenticated);
    if (parsed.data.expectedWorkspaceId !== workspaceId) {
      throw new IntegrationSummaryPreferenceError("workspace_changed", 409);
    }
    const { summaryKey, hiddenWhenDisconnected } = parsed.data;
    const result = await client.from("integration_summary_preferences").upsert({
      workspace_id: workspaceId, user_id: user.id, summary_key: summaryKey,
      hidden_when_disconnected: hiddenWhenDisconnected
    }, { onConflict: "workspace_id,user_id,summary_key" }).select(columns)
      .eq("workspace_id", workspaceId).eq("user_id", user.id).eq("summary_key", summaryKey).single();
    if (result.error) throw new Error("preference_save_failed");
    const row = rowSchema.parse(result.data);
    if (row.workspace_id !== workspaceId || row.user_id !== user.id || row.summary_key !== summaryKey ||
        row.hidden_when_disconnected !== hiddenWhenDisconnected) throw new Error("preference_save_unconfirmed");
    return { workspaceId, summaryKey, hiddenWhenDisconnected };
  } catch (error) {
    if (error instanceof IntegrationSummaryPreferenceError) throw error;
    throw new IntegrationSummaryPreferenceError("preference_save_failed", 503);
  }
}
