"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  boundedFormData,
  SUPPORT_FORM_MAX_BODY_BYTES,
  SUPPORT_REQUEST_KEYS,
  supportRequestSchema
} from "@/lib/security/public-submission-validation";
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
  const returnPath = text(formData, "return_path").slice(0, 120) || "/support";
  const safePath = ["/support", "/app/support", "/contact", "/demo"].includes(returnPath) ? returnPath : "/support";
  redirect(`${safePath}?${key}=${encodeURIComponent(message)}` as Route);
}

export async function createSupportRequestAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  let submission: ReturnType<typeof supportRequestSchema.parse>;

  try {
    submission = supportRequestSchema.parse(
      boundedFormData(formData, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES)
    );
  } catch {
    redirectBack(formData, "error", "Check the submitted fields and try again.");
  }

  const {
    name,
    email,
    issue_type: issueType,
    message,
    priority,
    workspace: workspaceInput,
    workspace_id: workspaceIdInput,
    page_module: pageModule,
    company,
    role,
    business_type: businessType,
    team_size: teamSize,
    improvement_goal: improvementGoal,
    preferred_contact_method: preferredContactMethod
  } = submission;

  let rateLimit;
  try {
    rateLimit = await enforceRateLimit({
      action: "support.create_request",
      limit: 5,
      windowSeconds: 10 * 60,
      identifiers: [email],
      metadata: {
        source: "public_support_request",
        issue_type: issueType
      } satisfies Json,
      strict: true
    });
  } catch {
    redirectBack(formData, "error", "Vaeroex could not verify request limits. Please try again shortly.");
  }

  if (!rateLimit.allowed) {
    redirectBack(formData, "error", rateLimitMessage(rateLimit));
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
  if (!admin) {
    redirectBack(formData, "error", "Support requests are not configured yet.");
  }

  const { data: supportRequest, error } = await admin
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
    redirectBack(formData, "error", "The support request could not be submitted. Please try again.");
  }

  await logSecurityAuditEvent({
    supabase: admin,
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
