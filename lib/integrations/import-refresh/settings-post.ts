import "server-only";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertRequest, formData, requireOwner } from "@/lib/integrations/reporting/security";
import { enabled as loyverseEnabled } from "@/lib/integrations/loyverse/server";
import { enabled as zohoBooksEnabled } from "@/lib/integrations/zoho-books/server";
import { enabled as wixOrdersEnabled } from "@/lib/integrations/wix-orders/server";
import { importRecurringAllowed, type ImportProvider } from "./scope";

const available = { loyverse: loyverseEnabled, "zoho-books": zohoBooksEnabled, "wix-orders": wixOrdersEnabled };
const uuid = z.string().uuid();

/** Fixed provider route + server-derived actor/workspace; never accept either
 * authority from form fields. Disabling requires no provider credential access. */
export async function postImportRecurringSettings(request: Request, provider: ImportProvider) {
  const redirect = (result: string) => Response.redirect(`https://www.vaeroex.com/app/integrations/${provider}?result=${result}`, 303);
  try {
    assertRequest(request);
    const access = await requireWorkspaceAccess(); requireOwner(access);
    const form = await formData(request);
    if ([...form.keys()].some(key => !["connectionId", "enabled", "confirmation"].includes(key))) throw new Error("invalid_form");
    const connection = uuid.parse(form.get("connectionId")), enabled = form.get("enabled");
    if (enabled !== "true" && enabled !== "false") throw new Error("invalid_form");
    if (form.get("confirmation") !== (enabled === "true" ? "enable-recurring" : "disable-recurring")) throw new Error("confirmation_required");
    if (enabled === "true" && (!available[provider]() || !importRecurringAllowed(access.workspaceId, provider)))
      return redirect("recurring_configuration_required");
    const result = await admin().rpc("set_import_recurring", { p_workspace: access.workspaceId, p_provider: provider,
      p_connection: connection, p_actor: access.user.id, p_enabled: enabled === "true" });
    if (result.error || result.data !== true) throw new Error("settings_unavailable");
    return redirect(enabled === "true" ? "recurring_enabled" : "recurring_disabled");
  } catch { return redirect("recurring_error"); }
}
