"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

export async function updateSupportRequestAction(formData: FormData) {
  const { admin } = await requireVaeroexAdmin("/app/admin/support-requests");
  const id = text(formData, "support_request_id");
  const status = text(formData, "status") || "in_review";
  const priority = text(formData, "priority") || "Medium";

  if (!id) {
    redirect("/app/admin/support-requests?error=Support request is required.");
  }

  const { error } = await admin
    .from("support_requests")
    .update({ status, priority })
    .eq("id", id);

  if (error) {
    redirect(`/app/admin/support-requests?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/admin/support-requests");
  redirect("/app/admin/support-requests?message=Support request updated.");
}
