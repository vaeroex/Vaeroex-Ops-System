"use server";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { sharedEvidenceRuntimeEnabled } from "@/lib/ai/shared-evidence/runtime-gate";
import { confirmEvidenceMapping } from "@/lib/ai/shared-evidence/mapping";

export async function confirmMappingAction(form: FormData): Promise<void> {
  if (!sharedEvidenceRuntimeEnabled()) redirect("/app/integrations");
  const access = await requireWorkspaceAccess();
  const result = await confirmEvidenceMapping(access, form, sharedEvidenceRuntimeEnabled());
  redirect(`/app/integrations/evidence-mapping?result=${result}`);
}
