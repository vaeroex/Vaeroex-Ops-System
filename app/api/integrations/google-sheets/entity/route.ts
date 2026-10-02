import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertBusinessLabel } from "@/lib/integrations/google-sheets/contracts";
import { requireSheetsManager, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm } from "@/lib/integrations/google-sheets/server";
import { createBusinessEntity, type ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

const entityForm = z.object({
  displayName: z.string().trim().min(1).max(120),
  entityType: z.enum(["operating_company", "holding_company", "division", "consolidated_group"]),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  timeZone: z.string().trim().min(1).max(64).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
    catch { return false; }
  }),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  confirmation: z.literal("create_entity")
}).strict();

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = entityForm.parse(await readSheetsForm(request, 2048));
    const access = await requireSheetsManager();
    // Preserve the existing RPC's authenticated auth.uid()/workspace boundary.
    // This path intentionally uses the owner's client, not the Sheets service client.
    await createBusinessEntity({
      workspaceId: access.workspaceId,
      entityKey: `sheets-${randomUUID()}`,
      entityType: input.entityType,
      displayName: assertBusinessLabel(input.displayName),
      baseCurrency: input.baseCurrency,
      timeZone: input.timeZone,
      fiscalYearStartMonth: input.fiscalYearStartMonth
    }, access.supabase as unknown as ExternalIntegrationsRpcClient);
    return sheetsRedirect("result", "entity_created");
  } catch {
    try { return sheetsRedirect("error", "entity_create_failed"); }
    catch { return new Response("Business entity could not be created.", { status: 400, headers: { "cache-control": "no-store" } }); }
  }
}
