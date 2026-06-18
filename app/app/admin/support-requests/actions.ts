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

export async function manageSupportRequestAction(formData: FormData) {
  const { admin } = await requireVaeroexAdmin("/app/admin/support-requests");
  const id = text(formData, "support_request_id");
  const action = text(formData, "support_action");
  const now = new Date().toISOString();
  const db = admin as any;

  if (!id) {
    redirect("/app/admin/support-requests?error=Support request is required.");
  }

  if (action === "duplicate") {
    const { data, error } = await db
      .from("support_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      redirect(`/app/admin/support-requests?error=${encodeURIComponent(error?.message || "Support request not found.")}`);
    }

    const copy = { ...data };
    delete copy.id;
    delete copy.created_at;
    delete copy.updated_at;
    delete copy.archived_at;
    delete copy.deleted_at;
    copy.issue_type = `${copy.issue_type} copy`;

    const { error: insertError } = await db.from("support_requests").insert(copy);

    if (insertError) {
      redirect(`/app/admin/support-requests?error=${encodeURIComponent(insertError.message)}`);
    }

    revalidatePath("/app/admin/support-requests");
    redirect("/app/admin/support-requests?message=Support request duplicated.");
  }

  const update =
    action === "archive"
      ? { archived_at: now, status: "closed" }
      : action === "delete"
        ? { deleted_at: now, status: "closed" }
        : action === "restore"
          ? { archived_at: null, deleted_at: null, status: "open" }
          : null;

  if (!update) {
    redirect("/app/admin/support-requests?error=Support action is not supported.");
  }

  const { error } = await db
    .from("support_requests")
    .update(update)
    .eq("id", id);

  if (error) {
    redirect(`/app/admin/support-requests?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/admin/support-requests");
  redirect("/app/admin/support-requests?message=Support request updated.");
}
