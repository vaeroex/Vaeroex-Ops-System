import "server-only";

import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = `Vaeroex <${VAEROEX_CONTACT_EMAILS.general}>`;

type WorkspaceAgreementEmailInput = {
  to: string;
  ownerName: string;
  organizationName: string;
  agreementId: string;
  secureAgreementUrl: string;
};

type ResendResponse = {
  id?: string;
  error?: { message?: string };
};

export type WorkspaceAgreementEmailResult =
  | { status: "sent"; messageId: string | null }
  | { status: "failed"; error: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendWorkspaceAgreementConfirmation(
  input: WorkspaceAgreementEmailInput
): Promise<WorkspaceAgreementEmailResult> {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) return { status: "failed", error: "RESEND_API_KEY is not configured." };

  const ownerName = escapeHtml(input.ownerName);
  const organizationName = escapeHtml(input.organizationName);
  const agreementId = escapeHtml(input.agreementId);
  const agreementUrl = escapeHtml(input.secureAgreementUrl);
  const text = `Hello ${input.ownerName},

Your Executive Intelligence Workspace for ${input.organizationName} has been created.

Workspace Agreement ID: ${input.agreementId}

View or download your signed agreement securely:
${input.secureAgreementUrl}

You will need to sign in to the authorized workspace before the agreement can be opened.

Vaeroex
Executive Intelligence
www.vaeroex.com`;
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Your Vaeroex Workspace Agreement</title></head>
  <body style="margin:0;background:#07111f;color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#07111f;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border:1px solid #243247;background:#0b1626;">
          <tr><td style="padding:28px;border-bottom:1px solid #243247;">
            <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#22d3ee;font-weight:700;">VAEROEX</div>
            <h1 style="margin:10px 0 0;font-size:26px;color:#fff;">Your Workspace Agreement</h1>
          </td></tr>
          <tr><td style="padding:28px;color:#cbd5e1;font-size:15px;line-height:1.7;">
            <p style="margin:0 0 16px;">Hello ${ownerName},</p>
            <p style="margin:0 0 16px;">Your Executive Intelligence Workspace for <strong style="color:#fff;">${organizationName}</strong> has been created.</p>
            <p style="margin:0 0 20px;"><strong style="color:#fff;">Agreement ID:</strong> ${agreementId}</p>
            <p style="margin:0 0 22px;"><a href="${agreementUrl}" style="display:inline-block;padding:11px 16px;background:#1266f1;color:#fff;text-decoration:none;font-weight:700;">View signed agreement</a></p>
            <p style="margin:0;color:#94a3b8;font-size:13px;">This secure link requires sign-in to the authorized workspace. Internal audit information is not included.</p>
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
        "Idempotency-Key": `workspace-agreement-${input.agreementId}`
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL,
        to: [input.to],
        subject: "Your Vaeroex Workspace Agreement",
        html,
        text
      }),
      cache: "no-store"
    });
    const responseText = await response.text();
    const data = responseText ? (JSON.parse(responseText) as ResendResponse) : {};

    if (!response.ok) {
      return { status: "failed", error: data.error?.message || "Workspace agreement email request failed." };
    }

    return { status: "sent", messageId: data.id || null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Workspace agreement email could not be sent."
    };
  }
}
