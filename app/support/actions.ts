"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function uuidOrNull(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function redirectBack(formData: FormData, key: "message" | "error", message: string): never {
  const returnPath = text(formData, "return_path") || "/support";
  const safePath = returnPath.startsWith("/support") || returnPath.startsWith("/app/support") ? returnPath : "/support";
  redirect(`${safePath}?${key}=${encodeURIComponent(message)}` as Route);
}

export async function createSupportRequestAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const name = text(formData, "name");
  const email = text(formData, "email").toLowerCase();
  const issueType = text(formData, "issue_type");
  const message = text(formData, "message");
  const priority = text(formData, "priority") || "Medium";
  const workspaceInput = text(formData, "workspace");
  const workspaceIdInput = text(formData, "workspace_id");

  if (!name || !email || !issueType || !message) {
    redirectBack(formData, "error", "Name, email, issue type, and message are required.");
  }

  let userId: string | null = null;
  let workspaceId = uuidOrNull(workspaceIdInput) || uuidOrNull(workspaceInput);

  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;

    if (!workspaceId && user) {
      const context = await getWorkspaceContext();
      workspaceId = context.activeWorkspace?.id ?? null;
    }
  }

  const fullMessage = workspaceInput && !uuidOrNull(workspaceInput)
    ? `Workspace: ${workspaceInput}\n\n${message}`
    : message;
  const client = admin || supabase;

  if (!client) {
    redirectBack(formData, "error", "Support requests are not configured yet.");
  }

  const { error } = await client.from("support_requests").insert({
    workspace_id: workspaceId,
    user_id: userId,
    name,
    email,
    issue_type: issueType,
    message: fullMessage,
    priority,
    status: "open"
  });

  if (error) {
    redirectBack(formData, "error", error.message);
  }

  redirectBack(formData, "message", "Support request received. Vaeroex will review it.");
}
