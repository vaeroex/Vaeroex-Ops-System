import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "Vaeroex <hq@vaeroex.com>";
export const WORKSPACE_AGREEMENT_ADMIN_EMAIL = "admin@vaeroex.com" as const;

type ReleaseChannel = "production" | "preview" | "development";
type DeliverySource = "workspace_finalization" | "admin_resend";
type DeliveryStatus = "pending" | "sent" | "failed" | "skipped";
type AdminClient = SupabaseClient<Database>;

type WorkspaceAgreementAdminEmailInput = {
  admin: AdminClient;
  agreementId: string;
  workspaceId: string;
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  signedAt: string;
  secureAdminAgreementUrl: string;
  source: DeliverySource;
};

type ResendResponse = {
  id?: string;
  error?: { message?: string };
};

export type WorkspaceAgreementAdminEmailResult = {
  status: DeliveryStatus;
  messageId: string | null;
  failureReason: string | null;
  attemptCount: number;
};

function releaseChannel(): ReleaseChannel {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendWorkspaceAgreementAdminEmail(input: WorkspaceAgreementAdminEmailInput, attemptCount: number) {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) return { status: "failed" as const, messageId: null, failureReason: "RESEND_API_KEY is not configured." };

  const organizationName = escapeHtml(input.organizationName);
  const ownerName = escapeHtml(input.ownerName);
  const ownerEmail = escapeHtml(input.ownerEmail);
  const agreementId = escapeHtml(input.agreementId);
  const signedAt = escapeHtml(input.signedAt);
  const secureAdminAgreementUrl = escapeHtml(input.secureAdminAgreementUrl);
  const text = `A Workspace Agreement has been finalized.

Organization: ${input.organizationName}
Workspace owner: ${input.ownerName}
Workspace owner email: ${input.ownerEmail}
Agreement ID: ${input.agreementId}
Signed at: ${input.signedAt}

View and download the canonical retained agreement:
${input.secureAdminAgreementUrl}

This secure administrative link requires authorized Vaeroex administrator access.`;
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Workspace Agreement finalized</title></head>
  <body style="margin:0;background:#07111f;color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#07111f;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid #243247;background:#0b1626;">
          <tr><td style="padding:28px;border-bottom:1px solid #243247;">
            <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#22d3ee;font-weight:700;">VAEROEX · LEGAL RECORDS</div>
            <h1 style="margin:10px 0 0;font-size:26px;color:#fff;">Workspace Agreement finalized</h1>
          </td></tr>
          <tr><td style="padding:28px;color:#cbd5e1;font-size:15px;line-height:1.7;">
            <p style="margin:0 0 18px;">A signed Workspace Agreement has been retained for <strong style="color:#fff;">${organizationName}</strong>.</p>
            <p style="margin:0 0 6px;"><strong style="color:#fff;">Workspace owner:</strong> ${ownerName}</p>
            <p style="margin:0 0 6px;"><strong style="color:#fff;">Owner email:</strong> ${ownerEmail}</p>
            <p style="margin:0 0 6px;"><strong style="color:#fff;">Agreement ID:</strong> ${agreementId}</p>
            <p style="margin:0 0 22px;"><strong style="color:#fff;">Signed at:</strong> ${signedAt}</p>
            <p style="margin:0 0 22px;"><a href="${secureAdminAgreementUrl}" style="display:inline-block;padding:11px 16px;background:#1266f1;color:#fff;text-decoration:none;font-weight:700;">View retained agreement</a></p>
            <p style="margin:0;color:#94a3b8;font-size:13px;">This secure administrative link requires authorized Vaeroex administrator access. The canonical immutable record remains stored in Vaeroex.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `workspace-agreement-admin-${input.agreementId}-${attemptCount}`
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL,
        to: [WORKSPACE_AGREEMENT_ADMIN_EMAIL],
        subject: `Workspace Agreement finalized: ${input.organizationName}`,
        html,
        text
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    const responseText = await response.text();
    let data: ResendResponse = {};
    try {
      data = responseText ? (JSON.parse(responseText) as ResendResponse) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        status: "failed" as const,
        messageId: null,
        failureReason: data.error?.message || `Resend returned HTTP ${response.status}.`
      };
    }

    return { status: "sent" as const, messageId: data.id || null, failureReason: null };
  } catch (error) {
    return {
      status: "failed" as const,
      messageId: null,
      failureReason: error instanceof Error ? error.message : "Administrative agreement email could not be sent."
    };
  }
}

function resultFromRow(row: Database["public"]["Tables"]["workspace_agreement_admin_email_deliveries"]["Row"]): WorkspaceAgreementAdminEmailResult {
  return {
    status: row.status,
    messageId: row.provider_message_id,
    failureReason: row.failure_reason,
    attemptCount: row.attempt_count
  };
}

export async function deliverWorkspaceAgreementAdminEmail(
  input: WorkspaceAgreementAdminEmailInput
): Promise<WorkspaceAgreementAdminEmailResult> {
  try {
    const channel = releaseChannel();
    const { data: existing, error: existingError } = await input.admin
      .from("workspace_agreement_admin_email_deliveries")
      .select("*")
      .eq("agreement_id", input.agreementId)
      .maybeSingle();

    if (existingError) {
      return { status: "failed", messageId: null, failureReason: existingError.message, attemptCount: 0 };
    }
    if (existing?.status === "sent" || existing?.status === "pending") return resultFromRow(existing);
    if (input.source === "workspace_finalization" && existing) return resultFromRow(existing);

    const now = new Date().toISOString();
    if (channel !== "production") {
      const skipped = {
        agreement_id: input.agreementId,
        workspace_id: input.workspaceId,
        recipient_email: WORKSPACE_AGREEMENT_ADMIN_EMAIL,
        status: "skipped" as const,
        provider: "resend" as const,
        release_channel: channel,
        provider_message_id: null,
        failure_reason: "Administrative agreement email is sent only from Production.",
        attempt_count: existing?.attempt_count || 0,
        last_attempt_source: input.source,
        last_attempt_at: null,
        sent_at: null,
        updated_at: now
      };
      const query = existing
        ? input.admin.from("workspace_agreement_admin_email_deliveries").update(skipped).eq("id", existing.id).select("*").maybeSingle()
        : input.admin.from("workspace_agreement_admin_email_deliveries").insert(skipped).select("*").maybeSingle();
      const { data, error } = await query;
      if (error || !data) {
        return { status: "failed", messageId: null, failureReason: error?.message || "Delivery status could not be recorded.", attemptCount: skipped.attempt_count };
      }
      return resultFromRow(data);
    }

    const attemptCount = (existing?.attempt_count || 0) + 1;
    const pending = {
      agreement_id: input.agreementId,
      workspace_id: input.workspaceId,
      recipient_email: WORKSPACE_AGREEMENT_ADMIN_EMAIL,
      status: "pending" as const,
      provider: "resend" as const,
      release_channel: channel,
      provider_message_id: null,
      failure_reason: null,
      attempt_count: attemptCount,
      last_attempt_source: input.source,
      last_attempt_at: now,
      sent_at: null,
      updated_at: now
    };
    const claim = existing
      ? input.admin
        .from("workspace_agreement_admin_email_deliveries")
        .update(pending)
        .eq("id", existing.id)
        .in("status", ["failed", "skipped"])
        .select("*")
        .maybeSingle()
      : input.admin.from("workspace_agreement_admin_email_deliveries").insert(pending).select("*").maybeSingle();
    const { data: claimed, error: claimError } = await claim;
    if (claimError || !claimed) {
      return { status: "failed", messageId: null, failureReason: claimError?.message || "Delivery attempt was not acquired.", attemptCount: existing?.attempt_count || 0 };
    }

    const delivery = await sendWorkspaceAgreementAdminEmail(input, attemptCount);
    const completedAt = new Date().toISOString();
    const { data: saved, error: saveError } = await input.admin
      .from("workspace_agreement_admin_email_deliveries")
      .update({
        status: delivery.status,
        provider_message_id: delivery.messageId,
        failure_reason: delivery.failureReason,
        sent_at: delivery.status === "sent" ? completedAt : null,
        updated_at: completedAt
      })
      .eq("id", claimed.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (saveError || !saved) {
      return { status: "failed", messageId: delivery.messageId, failureReason: saveError?.message || "Delivery result could not be recorded.", attemptCount };
    }

    return resultFromRow(saved);
  } catch (error) {
    return {
      status: "failed",
      messageId: null,
      failureReason: error instanceof Error ? error.message : "Administrative agreement delivery failed.",
      attemptCount: 0
    };
  }
}
