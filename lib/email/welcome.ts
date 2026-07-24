import "server-only";

import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = `Vaeroex <${VAEROEX_CONTACT_EMAILS.general}>`;

type SendWelcomeEmailInput = {
  to: string;
  stripeSubscriptionId?: string | null;
};

type ResendResponse = {
  id?: string;
  error?: {
    message?: string;
  };
};

export type WelcomeEmailResult =
  | { status: "sent"; messageId: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

function resendApiKey() {
  return process.env.RESEND_API_KEY || "";
}

function fromEmail() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function welcomeEmailText() {
  return `Hello,

Thank you for choosing Vaeroex.

Your subscription has been successfully activated.

We're excited to have you as part of the Vaeroex community.

If you have any questions, need assistance, or would like help getting started, please contact us at:

${VAEROEX_CONTACT_EMAILS.support}

Thank you for your support and trust in Vaeroex.

The Advantage of Knowing First.

Vaeroex
Executive Intelligence
www.vaeroex.com`;
}

function welcomeEmailHtml() {
  const supportEmail = escapeHtml(VAEROEX_CONTACT_EMAILS.support);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to Vaeroex</title>
  </head>
  <body style="margin:0;background:#0b1220;color:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#111827;border:1px solid #253041;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 20px;background:linear-gradient(135deg,#0b1f4d 0%,#111827 62%,#07111f 100%);border-bottom:1px solid #253041;">
                <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#38bdf8;font-weight:700;">Vaeroex</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.18;color:#ffffff;">Welcome to Vaeroex</h1>
                <p style="margin:12px 0 0;color:#cbd5e1;font-size:15px;line-height:1.6;">The Advantage of Knowing First.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#f8fafc;">Hello,</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#dbeafe;">Thank you for choosing Vaeroex.</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#e2e8f0;">Your subscription has been successfully activated.</p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#cbd5e1;">We're excited to have you as part of the Vaeroex community.</p>
                <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#cbd5e1;">
                  If you have any questions, need assistance, or would like help getting started, please contact us at:
                </p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;">
                  <a href="mailto:${supportEmail}" style="color:#38bdf8;font-weight:700;">${supportEmail}</a>
                </p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#e2e8f0;">Thank you for your support and trust in Vaeroex.</p>
                <div style="border-top:1px solid #253041;padding-top:18px;">
                  <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#ffffff;font-weight:700;">The Advantage of Knowing First.</p>
                  <p style="margin:0;font-size:14px;line-height:1.7;color:#cbd5e1;">
                    Vaeroex<br />
                    Executive Intelligence<br />
                    <a href="https://www.vaeroex.com" style="color:#38bdf8;">www.vaeroex.com</a>
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendVaeroexWelcomeEmail(input: SendWelcomeEmailInput): Promise<WelcomeEmailResult> {
  const apiKey = resendApiKey();

  if (!apiKey) {
    return { status: "failed", error: "RESEND_API_KEY is not configured." };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(input.stripeSubscriptionId ? { "Idempotency-Key": `vaeroex-welcome-${input.stripeSubscriptionId}` } : {})
      },
      body: JSON.stringify({
        from: fromEmail(),
        to: [input.to],
        subject: "Welcome to Vaeroex",
        html: welcomeEmailHtml(),
        text: welcomeEmailText()
      }),
      cache: "no-store"
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as ResendResponse) : {};

    if (!response.ok) {
      return {
        status: "failed",
        error: data.error?.message || "Resend welcome email request failed."
      };
    }

    return { status: "sent", messageId: data.id ?? null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Vaeroex welcome email could not be sent."
    };
  }
}
