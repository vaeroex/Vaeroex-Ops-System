import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/supabase/types";
import { retainSharedPreparationFailure } from "@/lib/ai/shared-evidence/preparation-diagnostics";

export const googleSheetsReadTicketId = z.string().uuid();
const ticketSchema = z.object({
  ticketId: googleSheetsReadTicketId,
  epoch: z.number().int().nonnegative().safe(),
  expiresAt: z.string().datetime({ offset: true })
}).passthrough();
export type GoogleSheetsReadTicket = z.infer<typeof ticketSchema>;
export type GoogleSheetsConsumedSource = Readonly<{ table: string; id: string }>;
type ReadAuthorityClient = {
  rpc(name: "begin_google_sheets_read_v1" | "bind_google_sheets_read_v1", args: Record<string, Json>): PromiseLike<{ data: unknown; error: unknown }>;
};

export class GoogleSheetsReadUnavailable extends Error {
  constructor(cause?: unknown, remote = false) {
    super("Workspace data changed or is being updated. Reload this page before trying again.");
    if (cause !== undefined) retainSharedPreparationFailure(this, cause, remote);
  }
}

/** Mint before loading any source data. Never replace this authority after an
 * asynchronous analysis or after opening an already-built evidence package. */
export async function beginGoogleSheetsRead(supabase: SupabaseClient<Database>, workspaceId: string, actorId: string | null = null): Promise<GoogleSheetsReadTicket> {
  const result = await (supabase as unknown as ReadAuthorityClient).rpc("begin_google_sheets_read_v1", {
    p_workspace_id: workspaceId, p_actor_id: actorId
  });
  const parsed = ticketSchema.safeParse(result.data);
  if (result.error) throw new GoogleSheetsReadUnavailable(result.error, true);
  if (!parsed.success) throw new GoogleSheetsReadUnavailable(parsed.error);
  return parsed.data;
}

/** Bind every consumed record, including context omitted from final citations.
 * The database resolves inherited roots/expiry and rejects stale epochs. */
export async function bindGoogleSheetsRead(supabase: SupabaseClient<Database>, ticketId: string, sources: readonly GoogleSheetsConsumedSource[]) {
  if (!googleSheetsReadTicketId.safeParse(ticketId).success) throw new GoogleSheetsReadUnavailable(new Error("read_ticket_invalid"));
  const unique = [...new Map(sources.map(source => [`${source.table}:${source.id}`, source])).values()];
  if (unique.length > 20_000 || unique.some(source => !/^[a-z][a-z0-9_]*$/.test(source.table) || !googleSheetsReadTicketId.safeParse(source.id).success)) throw new GoogleSheetsReadUnavailable(new Error("read_sources_invalid"));
  const result = await (supabase as unknown as ReadAuthorityClient).rpc("bind_google_sheets_read_v1", {
    p_ticket_id: ticketId, p_sources: unique as unknown as Json
  });
  const parsed = ticketSchema.safeParse(result.data);
  if (result.error) throw new GoogleSheetsReadUnavailable(result.error, true);
  if (!parsed.success) throw new GoogleSheetsReadUnavailable(parsed.error);
  if (parsed.data.ticketId !== ticketId) throw new GoogleSheetsReadUnavailable(new Error("read_ticket_mismatch"));
  return parsed.data;
}

export function googleSheetsReadSources(table: string, rows: readonly { id: string }[] | null | undefined): GoogleSheetsConsumedSource[] {
  return (rows ?? []).map(({ id }) => ({ table, id }));
}

export function googleSheetsReadTicketFields(ticketId: string) {
  if (!googleSheetsReadTicketId.safeParse(ticketId).success) throw new GoogleSheetsReadUnavailable();
  return { google_sheets_read_ticket_id: ticketId };
}
