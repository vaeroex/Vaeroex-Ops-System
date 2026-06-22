import "server-only";

import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";
import { getAppUrl } from "@/lib/supabase/config";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = `Vaeroex <${VAEROEX_CONTACT_EMAILS.general}>`;

type SendOnboardingEmailInput = {
  to: string;
  customerName?: string | null;
  stripeSubscriptionId?: string | null;
};

type ResendResponse = {
  id?: string;
  error?: {
    message?: string;
  };
};

export type OnboardingEmailResult =
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

function firstName(name?: string | null) {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "";
}

function onboardingEmailText({ customerName, to }: SendOnboardingEmailInput) {
  const signupUrl = `${getAppUrl()}/signup`;
  const greetingName = firstName(customerName);
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi,";

  return `${greeting}

Welcome to Vaeroex.

Thank you for subscribing to Operations Intelligence through the Vaeroex Intelligence Platform. Your Stripe receipt is sent separately by Stripe; this email is here to help you start using Vaeroex.

Next steps:
1. Create your Vaeroex account using this same email address: ${to}
2. Accept the Vaeroex policies when prompted.
3. Create your workspace and choose the operational environment Vaeroex should analyze.
4. Complete setup so Vaeroex can help surface visibility, accountability, execution priorities, reports, and recommendations.

Signup link:
${signupUrl}

Need help?
General: ${VAEROEX_CONTACT_EMAILS.general}
Support: ${VAEROEX_CONTACT_EMAILS.support}
Billing: ${VAEROEX_CONTACT_EMAILS.billing}

Vaeroex
Build the structure your growth depends on.`;
}

function onboardingEmailHtml(input: SendOnboardingEmailInput) {
  const signupUrl = `${getAppUrl()}/signup`;
  const escapedSignupUrl = escapeHtml(signupUrl);
  const escapedEmail = escapeHtml(input.to);
  const greetingName = firstName(input.customerName);
  const greeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : "Hi,";

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
                <p style="margin:12px 0 0;color:#cbd5e1;font-size:15px;line-height:1.6;">Build the structure your growth depends on.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#f8fafc;">${greeting}</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#dbeafe;">
                  Thank you for subscribing to Operations Intelligence through the Vaeroex Intelligence Platform.
                </p>
                <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#94a3b8;">
                  Your Stripe receipt is sent separately by Stripe. This Vaeroex onboarding email is here to help you start your workspace.
                </p>
                <div style="border:1px solid rgba(56,189,248,0.32);background:#1a2332;border-radius:14px;padding:18px;margin:0 0 22px;">
                  <p style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:#38bdf8;font-weight:700;">Next steps</p>
                  <ol style="margin:0;padding-left:20px;color:#e2e8f0;font-size:14px;line-height:1.8;">
                    <li>Create your Vaeroex account using this same email: <strong style="color:#ffffff;">${escapedEmail}</strong></li>
                    <li>Accept the Vaeroex policies when prompted.</li>
                    <li>Create your workspace and choose the operational environment Vaeroex should analyze.</li>
                    <li>Complete setup so Vaeroex can surface visibility, accountability, execution priorities, reports, and recommendations.</li>
                  </ol>
                </div>
                <p style="margin:0 0 24px;">
                  <a href="${escapedSignupUrl}" style="display:inline-block;background:#1e6bff;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:700;">Create your Vaeroex account</a>
                </p>
                <p style="margin:0 0 6px;font-size:13px;line-height:1.7;color:#94a3b8;">Need help?</p>
                <p style="margin:0;font-size:13px;line-height:1.8;color:#cbd5e1;">
                  General: <a href="mailto:${VAEROEX_CONTACT_EMAILS.general}" style="color:#38bdf8;">${VAEROEX_CONTACT_EMAILS.general}</a><br />
                  Support: <a href="mailto:${VAEROEX_CONTACT_EMAILS.support}" style="color:#38bdf8;">${VAEROEX_CONTACT_EMAILS.support}</a><br />
                  Billing: <a href="mailto:${VAEROEX_CONTACT_EMAILS.billing}" style="color:#38bdf8;">${VAEROEX_CONTACT_EMAILS.billing}</a>
                </p>
              </td>
            </tr>
          </table>
          <p style="max-width:640px;margin:16px auto 0;color:#64748b;font-size:12px;line-height:1.6;">
            Vaeroex sends this onboarding email after a successful subscription so you can set up your workspace. Stripe receipts are sent separately.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendVaeroexOnboardingEmail(input: SendOnboardingEmailInput): Promise<OnboardingEmailResult> {
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
        ...(input.stripeSubscriptionId ? { "Idempotency-Key": `vaeroex-onboarding-${input.stripeSubscriptionId}` } : {})
      },
      body: JSON.stringify({
        from: fromEmail(),
        to: [input.to],
        subject: "Welcome to Vaeroex",
        html: onboardingEmailHtml(input),
        text: onboardingEmailText(input)
      }),
      cache: "no-store"
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as ResendResponse) : {};

    if (!response.ok) {
      return {
        status: "failed",
        error: data.error?.message || "Resend onboarding email request failed."
      };
    }

    return { status: "sent", messageId: data.id ?? null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Vaeroex onboarding email could not be sent."
    };
  }
}
