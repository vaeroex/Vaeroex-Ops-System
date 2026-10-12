import "server-only";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AIProviderPolicyError, type AIProviderName } from "@/lib/ai/providers/types";

const contextSchema = z.object({
  ticketId: z.string().uuid(),
  containsGoogleSheets: z.boolean(),
  hasUnattributedDerivedSources: z.boolean()
});

/** Server-created authority only. Revalidate immediately before each transport,
 * including retries: a request may have been built before an erasure fence. */
export async function assertGoogleSheetsProviderPolicy(ticketId: string | undefined, provider: AIProviderName) {
  if (ticketId === undefined) return { containsGoogleSheets: false };
  if (!z.string().uuid().safeParse(ticketId).success) throw new AIProviderPolicyError("Reload the source data before requesting analysis.");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new AIProviderPolicyError("Source-data authority is unavailable.");
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const result = await rpc("get_google_sheets_read_context_v1", { p_ticket_id: ticketId });
  const parsed = contextSchema.safeParse(result.data);
  if (result.error || !parsed.success || parsed.data.ticketId !== ticketId) {
    throw new AIProviderPolicyError("Source data changed or expired. Reload before requesting analysis.");
  }
  if (parsed.data.hasUnattributedDerivedSources) {
    throw new AIProviderPolicyError("This historical analysis needs a source review before it can be sent for further analysis.");
  }
  if (parsed.data.containsGoogleSheets) {
    if (provider !== "openai") throw new AIProviderPolicyError("Google Sheets analysis is limited to the verified OpenAI project.");
    verifiedOpenAIHeaders();
  }
  return { containsGoogleSheets: parsed.data.containsGoogleSheets };
}

function verifiedOpenAIHeaders(): Record<string, string> {
  // Configure only after the dedicated key's issuing project and data controls
  // have been verified. These settings are not a Zero Data Retention claim.
  const apiKey = process.env.GOOGLE_SHEETS_OPENAI_API_KEY?.trim();
  const organization = process.env.GOOGLE_SHEETS_OPENAI_ORGANIZATION_ID?.trim();
  const project = process.env.GOOGLE_SHEETS_OPENAI_PROJECT_ID?.trim();
  if (!apiKey || !organization || !/^org-[A-Za-z0-9_-]+$/.test(organization) || !project || !/^proj_[A-Za-z0-9_-]+$/.test(project)) {
    throw new AIProviderPolicyError("Google Sheets analysis is unavailable until its provider connection is verified.");
  }
  return { Authorization: `Bearer ${apiKey}`, "OpenAI-Organization": organization, "OpenAI-Project": project };
}

export async function googleSheetsOpenAIHeaders(ticketId: string | undefined): Promise<Record<string, string>> {
  const policy = await assertGoogleSheetsProviderPolicy(ticketId, "openai");
  return policy.containsGoogleSheets ? verifiedOpenAIHeaders() : {};
}
