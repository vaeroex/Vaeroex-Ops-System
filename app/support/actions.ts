"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function text(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function uuidOrNull(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function redirectBack(formData: FormData, key: "message" | "error", message: string): never {
  const returnPath = text(formData, "return_path") || "/support";
  const safePath = ["/support", "/app/support", "/contact", "/demo"].some((path) => returnPath.startsWith(path)) ? returnPath : "/support";
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
  const pageModule = text(formData, "page_module");
  const company = text(formData, "company");
  const role = text(formData, "role");
  const businessType = text(formData, "business_type");
  const teamSize = text(formData, "team_size");
  const improvementGoal = text(formData, "improvement_goal");
  const preferredContactMethod = text(formData, "preferred_contact_method");

  if (!name || !email || !issueType || !message) {
    redirectBack(formData, "error", "Name, email, issue type, and message are required.");
  }

  let userId: string | null = null;
  let workspaceId: string | null = null;
  const requestedWorkspaceId = uuidOrNull(workspaceIdInput) || uuidOrNull(workspaceInput);

  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;

    if (user && requestedWorkspaceId) {
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", requestedWorkspaceId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      workspaceId = membership?.workspace_id ?? null;
    }

    if (!workspaceId && user && !requestedWorkspaceId) {
      const context = await getWorkspaceContext();
      workspaceId = context.activeWorkspace?.id ?? null;
    }
  }

  const workspaceReference = workspaceInput || workspaceIdInput;
  const contextLines = [
    pageModule ? `Page/module: ${pageModule}` : "",
    company ? `Company: ${company}` : "",
    role ? `Role: ${role}` : "",
    businessType ? `Business type: ${businessType}` : "",
    teamSize ? `Team size: ${teamSize}` : "",
    improvementGoal ? `Trying to improve: ${improvementGoal}` : "",
    preferredContactMethod ? `Preferred contact method: ${preferredContactMethod}` : "",
    workspaceReference && !workspaceId ? `Workspace reference: ${workspaceReference}` : "",
    workspaceInput && !uuidOrNull(workspaceInput) ? `Workspace: ${workspaceInput}` : ""
  ].filter(Boolean);
  const fullMessage = contextLines.length ? `${contextLines.join("\n")}\n\n${message}` : message;
  const client = admin || supabase;

  if (!client) {
    redirectBack(formData, "error", "Support requests are not configured yet.");
  }

  const { data: supportRequest, error } = await client
    .from("support_requests")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      name,
      email,
      issue_type: issueType,
      message: fullMessage,
      priority,
      status: "open"
    })
    .select("id")
    .maybeSingle();

  if (error) {
    redirectBack(formData, "error", error.message);
  }

  await logSecurityAuditEvent({
    supabase: client,
    workspaceId,
    userId,
    actionName: "support.create_request",
    operationType: "CREATE_RECORD",
    targetTable: "support_requests",
    targetRecordId: supportRequest?.id ?? null,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: true,
    metadata: {
      source: "public_support_request",
      issue_type: issueType,
      priority,
      authenticated: Boolean(userId),
      workspace_scoped: Boolean(workspaceId)
    } satisfies Json
  });

  const successMessage =
    issueType === "Demo request" || issueType === "Product Demo"
      ? "Demo request received. Vaeroex will review it."
      : [
          "Contact request",
          "General Question",
          "General Inquiry",
          "Platform Questions",
          "Network Interest",
          "Strategic Partnership",
          "Advisor Interest",
          "Investor / Strategic Relationship",
          "Implementation Partner",
          "Partnership Opportunities",
          "Business Inquiry",
          "Billing or Subscription"
        ].includes(issueType)
        ? "Contact request received. Vaeroex will review it."
        : "Support request received. Vaeroex will review it.";

  redirectBack(formData, "message", successMessage);
}
