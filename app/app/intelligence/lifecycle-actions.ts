"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  INTELLIGENCE_CARD_RECHECK_DAYS,
  type IntelligenceCardLifecycleAction,
  type IntelligenceCardLifecycleActionResult,
  type IntelligenceCardLifecycleReason
} from "@/lib/intelligence/card-lifecycle/contracts";
import { openIntelligenceCardLifecycleToken } from "@/lib/intelligence/card-lifecycle/token";
import { requireWorkspaceRole } from "@/lib/security/require-workspace-role";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const allowedActions = new Set<IntelligenceCardLifecycleAction>(["acknowledge", "dismiss", "pin", "unpin"]);
const allowedReasons = new Set<IntelligenceCardLifecycleReason>(["irrelevant", "duplicate", "temporary", "not_material", "other"]);

export async function mutateIntelligenceCardLifecycleAction(input: {
  token: string;
  action: IntelligenceCardLifecycleAction;
  reasonCode?: IntelligenceCardLifecycleReason | null;
  reasonText?: string | null;
}): Promise<IntelligenceCardLifecycleActionResult> {
  if (!allowedActions.has(input.action)) return { ok: false, message: "This lifecycle action is not supported." };
  const access = await requireWorkspaceRole(["owner", "admin", "manager"]);
  const opened = openIntelligenceCardLifecycleToken(input.token, {
    workspaceId: access.workspaceId,
    userId: access.user.id
  });
  if (!opened.ok) {
    return { ok: false, message: opened.reason === "expired" ? "This finding changed or the action expired. Reload and try again." : "This finding action could not be verified." };
  }
  const reasonCode = input.reasonCode || null;
  const reasonText = input.reasonText?.trim() || null;
  if (reasonCode && !allowedReasons.has(reasonCode)) return { ok: false, message: "Choose a supported dismissal reason." };
  if (reasonText && reasonText.length > 500) return { ok: false, message: "Keep the dismissal note to 500 characters or fewer." };
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Intelligence lifecycle storage is unavailable." };
  const recheckAfter = input.action === "dismiss"
    ? new Date(Date.now() + INTELLIGENCE_CARD_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const { error } = await admin.rpc("mutate_intelligence_card_lifecycle_v1", {
    p_workspace_id: access.workspaceId,
    p_actor_id: access.user.id,
    p_action: input.action,
    p_finding_key_hash: opened.payload.findingKeyHash,
    p_finding_fingerprint: opened.payload.findingFingerprint,
    p_material_signature: opened.payload.materialSignature,
    p_finding_id: opened.payload.findingId,
    p_card_snapshot_json: opened.payload.cardSnapshot,
    p_reason_code: reasonCode,
    p_reason_text: reasonText,
    p_recheck_after: recheckAfter,
    p_request_id: randomUUID()
  });
  if (error) {
    console.error(JSON.stringify({
      level: "error",
      component: "intelligence-card-lifecycle",
      event: "mutation_failed",
      action: input.action,
      reason: error.message
    }));
    return { ok: false, message: "The finding lifecycle could not be updated. No intelligence was changed." };
  }
  revalidatePath("/app/intelligence");
  return {
    ok: true,
    message: input.action === "acknowledge"
      ? "Finding acknowledged."
      : input.action === "dismiss"
        ? "Finding moved to History."
        : input.action === "pin"
          ? "Finding pinned."
          : "Finding unpinned."
  };
}
