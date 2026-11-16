"use server";

import { notifyPublicInquiry } from "@/lib/email/inquiry-notification";
import { redirect } from "next/navigation";
import { z } from "zod";
import { INQUIRY_CATEGORIES, isProjectInquiry, type ContactFormState } from "@/lib/contact/inquiries";
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
  const submittedPath = text(formData, "return_path").slice(0, 120) || "/support";
  const returnPath = submittedPath === "/demo" ? "/contact" : submittedPath;
  const safePath = ["/support", "/app/support", "/contact"].includes(returnPath) ? returnPath : "/support";
  redirect(`${safePath}?${key}=${encodeURIComponent(message)}` as Route);
}

async function submitSupportRequest(formData: FormData): Promise<ContactFormState> {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  let submission: ReturnType<typeof supportRequestSchema.parse>;

  try {
    submission = supportRequestSchema.parse(
      boundedFormData(formData, SUPPORT_REQUEST_KEYS, SUPPORT_FORM_MAX_BODY_BYTES)
    );
  } catch (error) {
    const fieldErrors: Record<string, string> = {};
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        const field = String(issue.path[0]);
        fieldErrors[field] = field === "email" ? "Enter a valid email address."
          : issue.code === "too_small" && field === "name" ? "Enter your name."
          : issue.code === "too_small" && field === "message" ? "Add a brief description."
          : issue.code === "too_big" ? `Use no more than ${issue.maximum} characters.`
          : issue.message;
      }
    }
    return { error: "Check the submitted fields and try again.", fieldErrors };
  }
  if (!admin) return { error: "Contact requests are temporarily unavailable. Please use the direct email links on this page." };

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
    preferred_contact_method: preferredContactMethod,
    existing_tools: existingTools,
    expected_users: expectedUsers,
    project_budget: projectBudget,
    project_timeline: projectTimeline
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
    return { error: "Vaeroex could not verify request limits. Please try again shortly." };
  }

  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit) };
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
    isProjectInquiry(issueType) && existingTools ? `Existing tools or website: ${existingTools}` : "",
    issueType === "Custom Business Systems" && expectedUsers ? `Approximate expected users: ${expectedUsers}` : "",
    isProjectInquiry(issueType) && projectBudget ? `Approximate budget: ${projectBudget}` : "",
    isProjectInquiry(issueType) && projectTimeline ? `Approximate timeline: ${projectTimeline}` : "",
    workspaceReference && !workspaceId ? `Workspace reference: ${workspaceReference}` : "",
    workspaceInput && !uuidOrNull(workspaceInput) ? `Workspace: ${workspaceInput}` : ""
  ].filter(Boolean);
  const fullMessage = contextLines.length ? `${contextLines.join("\n")}\n\n${message}` : message;

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
      status: "open",
      ...(text(formData, "return_path") === "/contact" ? { notification_status: "pending" } : {})
    })
    .select("id")
    .maybeSingle();

  if (error || !supportRequest?.id) {
    return { error: "The request could not be submitted. Please try again or use the direct email links." };
  }

  try { await logSecurityAuditEvent({
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
  }); } catch { console.error("support_saved_audit_failed", { requestId: supportRequest.id }); }

  if (text(formData, "return_path") === "/contact") {
    try { await notifyPublicInquiry(admin, { id: supportRequest.id, name, email, category: issueType, message: fullMessage }); }
    catch { console.error("inquiry_notification_unavailable", { requestId: supportRequest.id }); }
  }

  const successMessage =
    issueType === "Demo request" || issueType === "Product Demo"
      ? "Contact request received. Vaeroex will review it."
      : [
          "Contact request",
          "General Question",
          "General Inquiry",
          "Platform Questions",
          "Executive Intelligence",
          "Custom Business Systems",
          "Website Development / Enhancement",
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

  return { message: successMessage };
}

// Preserve the redirect contract used by existing support forms.
export async function createSupportRequestAction(formData: FormData) {
  const result = await submitSupportRequest(formData);
  redirectBack(formData, result.error ? "error" : "message", result.error || result.message || "The request could not be submitted.");
}

// The public form uses the same validation, rate limiting, destination, and audit trail.
export async function createContactRequestAction(_previous: ContactFormState, formData: FormData): Promise<ContactFormState> {
  if (!Object.values(INQUIRY_CATEGORIES).some(category => category === formData.get("issue_type"))) {
    return { error: "Choose an inquiry type.", fieldErrors: { issue_type: "Choose an inquiry type." } };
  }
  formData.set("return_path", "/contact");
  formData.set("page_module", String(formData.get("issue_type")));
  try {
    return await submitSupportRequest(formData);
  } catch {
    return { error: "We could not confirm receipt. Please use the direct email links before retrying to avoid a duplicate request." };
  }
}
