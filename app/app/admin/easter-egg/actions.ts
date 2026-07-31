"use server";

import { revalidatePath } from "next/cache";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";

const REJECTION_REASONS = new Set(["inappropriate", "reserved", "unclear", "other"] as const);

export async function moderateEasterEggDisplayNameAction(input: {
  workspaceId: string;
  decision: "approve" | "reject";
  reasonCode?: "inappropriate" | "reserved" | "unclear" | "other";
}) {
  const { admin, user } = await requireVaeroexAdmin("/app");
  if (!/^[0-9a-f-]{36}$/i.test(input.workspaceId)) return { ok: false, message: "The workspace could not be verified." };
  if (input.decision === "reject" && (!input.reasonCode || !REJECTION_REASONS.has(input.reasonCode))) {
    return { ok: false, message: "Choose a rejection reason." };
  }

  const now = new Date().toISOString();
  const result = await admin.from("easter_egg_workspace_settings").update({
    moderation_status: input.decision === "approve" ? "approved" : "rejected",
    moderated_by: user.id,
    moderated_at: now,
    moderation_reason_code: input.decision === "approve" ? null : input.reasonCode || "other",
    updated_by: user.id
  }).eq("workspace_id", input.workspaceId).eq("public_participation_requested", true).eq("moderation_status", "pending").select("workspace_id").maybeSingle();

  if (result.error || !result.data) return { ok: false, message: "The moderation decision could not be recorded." };
  revalidatePath("/app/admin/easter-egg");
  revalidatePath("/app/easter-egg");
  return { ok: true, message: input.decision === "approve" ? "Public display name approved." : "Public display name rejected." };
}
