"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { deliverWorkspaceAgreementAdminEmail } from "@/lib/email/workspace-agreement-admin";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { getAppUrl } from "@/lib/supabase/config";
import type { Json } from "@/lib/supabase/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resendWorkspaceAgreementAdminEmailAction(formData: FormData) {
  const agreementId = String(formData.get("agreement_id") || "").trim();
  if (!UUID_PATTERN.test(agreementId)) redirect("/app/admin/workspace-agreements?error=Valid agreement is required.");

  const returnPath = `/app/admin/workspace-agreements/${agreementId}` as Route;
  const { admin, user } = await requireVaeroexAdmin(returnPath);
  const { data: agreement, error } = await admin
    .from("workspace_agreements")
    .select("id,workspace_id,organization_name,owner_legal_name,owner_business_email,signed_at")
    .eq("id", agreementId)
    .maybeSingle();
  if (error || !agreement) redirect(`${returnPath}?error=${encodeURIComponent("Workspace Agreement was not found.")}` as Route);

  const result = await deliverWorkspaceAgreementAdminEmail({
    admin,
    agreementId: agreement.id,
    workspaceId: agreement.workspace_id,
    organizationName: agreement.organization_name,
    ownerName: agreement.owner_legal_name,
    ownerEmail: agreement.owner_business_email,
    signedAt: agreement.signed_at,
    secureAdminAgreementUrl: new URL(returnPath, getAppUrl()).toString(),
    source: "admin_resend"
  });

  await logSecurityAuditEvent({
    supabase: admin,
    workspaceId: agreement.workspace_id,
    userId: user.id,
    actionName: "admin.resend_workspace_agreement_email",
    operationType: "ADMIN",
    targetTable: "workspace_agreement_admin_email_deliveries",
    targetRecordId: agreement.id,
    initiatedBy: "user",
    requiredConfirmation: true,
    confirmationReceived: true,
    allowed: result.status === "sent",
    reasonBlocked: result.status === "failed" ? "admin_email_delivery_failed" : null,
    metadata: {
      delivery_status: result.status,
      attempt_count: result.attemptCount,
      message_id_recorded: result.status === "sent" && Boolean(result.messageId)
    } satisfies Json
  });

  revalidatePath(returnPath);
  const message = result.status === "sent"
    ? "Administrative agreement email sent."
    : result.status === "skipped"
      ? "Administrative agreement email is skipped outside Production."
      : result.status === "pending"
        ? "Administrative agreement email is already pending."
        : "Administrative agreement email could not be sent.";
  redirect(`${returnPath}?message=${encodeURIComponent(message)}` as Route);
}
