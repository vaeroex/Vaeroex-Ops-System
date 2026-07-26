"use server";

import { createHash, randomUUID } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { sendWorkspaceAgreementConfirmation } from "@/lib/email/workspace-agreement";
import { WORKSPACE_AGREEMENT_STORAGE_BUCKET } from "@/lib/legal/workspace-agreement";
import { generateWorkspaceAgreementPdf } from "@/lib/legal/workspace-agreement-pdf";
import { buildWorkspaceAgreementSnapshot, hashWorkspaceAgreement } from "@/lib/legal/workspace-agreement-record";
import {
  workspaceAgreementFormSchema,
  workspaceAgreementInputFromFormData
} from "@/lib/legal/workspace-agreement-schema";
import { getAppUrl } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

function setupError(message: string): never {
  redirect(`/app/setup?error=${encodeURIComponent(message)}` as Route);
}

export async function createWorkspaceWithAgreementAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) setupError("Supabase is not configured.");

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const subscription = await getSubscriptionStatus({
    supabase,
    userId: user.id,
    email: user.email
  });
  if (!subscription.allowed) {
    redirect(`/billing-required?reason=${encodeURIComponent(subscription.reason)}`);
  }

  const workspaceLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    limit: "workspaces"
  });
  if (workspaceLimit.reached) {
    redirect("/billing-required?reason=You%E2%80%99ve%20reached%20the%20limit%20for%20your%20current%20Vaeroex%20plan.");
  }

  const parsed = workspaceAgreementFormSchema.safeParse(workspaceAgreementInputFromFormData(formData));
  if (!parsed.success) setupError(parsed.error.issues[0]?.message || "Workspace Agreement validation failed.");

  const admin = createSupabaseAdminClient();
  if (!admin) setupError("Trusted workspace setup is not configured for this environment.");

  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email: user.email ?? parsed.data.ownerBusinessEmail,
    full_name: parsed.data.ownerLegalName
  });
  if (profileError) setupError("The workspace owner profile could not be prepared.");

  const workspaceId = randomUUID();
  const agreementId = randomUUID();
  const signedAt = new Date().toISOString();
  const snapshot = buildWorkspaceAgreementSnapshot({
    agreementId,
    workspaceId,
    authenticatedUserId: user.id,
    signedAt,
    input: parsed.data
  });
  const immutableHash = hashWorkspaceAgreement(snapshot);

  let pdf: Buffer;
  try {
    pdf = await generateWorkspaceAgreementPdf({ snapshot, immutableHash });
  } catch {
    setupError("The Workspace Agreement PDF could not be generated. No workspace was created.");
  }

  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  const storagePath = `${workspaceId}/${agreementId}.pdf`;
  const upload = await admin.storage.from(WORKSPACE_AGREEMENT_STORAGE_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false
  });
  if (upload.error) setupError("The Workspace Agreement could not be stored. No workspace was created.");

  const { error: creationError } = await admin.rpc("create_workspace_with_signed_agreement", {
    p_workspace_id: workspaceId,
    p_agreement_id: agreementId,
    p_user_id: user.id,
    p_organization_name: parsed.data.organizationName,
    p_owner_legal_name: parsed.data.ownerLegalName,
    p_owner_job_title: parsed.data.ownerJobTitle,
    p_owner_business_email: parsed.data.ownerBusinessEmail,
    p_business_type: parsed.data.businessType,
    p_team_size: parsed.data.teamSize,
    p_number_of_locations: parsed.data.numberOfLocations,
    p_subscription_status: subscription.status === "missing" ? "manual_review" : subscription.status,
    p_plan_slug: normalizePlanSlug(subscription.plan_slug) || VAEROEX_PLAN_SLUG,
    p_subscription_required: true,
    p_manually_unlocked: subscription.source === "manual",
    p_agreement_version: snapshot.agreementVersion,
    p_terms_version: snapshot.termsVersion,
    p_privacy_version: snapshot.privacyVersion,
    p_agreement_text: snapshot.agreementText,
    p_agreement_snapshot_json: snapshot as unknown as Json,
    p_typed_signature: snapshot.typedSignature,
    p_signed_at: signedAt,
    p_application_version: snapshot.applicationVersion,
    p_immutable_hash: immutableHash,
    p_pdf_sha256: pdfSha256,
    p_pdf_size_bytes: pdf.byteLength,
    p_storage_bucket: WORKSPACE_AGREEMENT_STORAGE_BUCKET,
    p_storage_path: storagePath
  });

  if (creationError) {
    const cleanup = await admin.storage.from(WORKSPACE_AGREEMENT_STORAGE_BUCKET).remove([storagePath]);
    if (cleanup.error) console.warn("Workspace Agreement staged-object cleanup failed.");
    setupError("The signed Workspace Agreement could not be finalized. No usable workspace was created.");
  }

  const secureAgreementUrl = new URL(`/app/legal/agreements/${agreementId}`, getAppUrl()).toString();
  const emailResult = await sendWorkspaceAgreementConfirmation({
    to: parsed.data.ownerBusinessEmail,
    ownerName: parsed.data.ownerLegalName,
    organizationName: parsed.data.organizationName,
    agreementId,
    secureAgreementUrl
  });

  const { error: emailAuditError } = await admin.from("security_audit_events").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    action_name: "workspace_agreement_confirmation_email",
    operation_type: "SYSTEM",
    target_table: "workspace_agreements",
    target_record_id: agreementId,
    initiated_by: "system",
    required_confirmation: false,
    confirmation_received: false,
    allowed: emailResult.status === "sent",
    reason_blocked: emailResult.status === "failed" ? "confirmation_email_delivery_failed" : null,
    request_id: agreementId,
    model: null,
    metadata_json: {
      delivery_status: emailResult.status,
      message_id_recorded: emailResult.status === "sent" && Boolean(emailResult.messageId)
    }
  });
  if (emailAuditError) console.warn("Workspace Agreement email status could not be audited.");

  const cookieStore = await cookies();
  cookieStore.set("vaeroex_workspace_id", workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });

  const message = emailResult.status === "sent"
    ? "Workspace created. Your signed agreement is available under Legal & Agreements and has been emailed to the workspace owner."
    : "Workspace created. Your signed agreement is available under Legal & Agreements; email delivery could not be confirmed.";
  redirect(`/app/sources?message=${encodeURIComponent(message)}` as Route);
}
