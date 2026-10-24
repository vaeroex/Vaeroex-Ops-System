"use server";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { evidenceMappingSetupEnabled } from "@/lib/ai/shared-evidence/mapping-gate";
import { confirmEvidenceMapping } from "@/lib/ai/shared-evidence/mapping";

export async function confirmMappingAction(form: FormData): Promise<void> {
  const enabled = evidenceMappingSetupEnabled();
  if (!enabled) redirect("/app/integrations");
  const access = await requireWorkspaceAccess();
  const result = await confirmEvidenceMapping(access, form, enabled);
  redirect(`/app/integrations/evidence-mapping?result=${result}`);
}
