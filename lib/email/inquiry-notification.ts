import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";
import { getAppUrl } from "@/lib/supabase/config";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Inquiry = { id: string; name: string; email: string; category: string; message: string };
/** A durable single claim prevents concurrent/replayed notifications. Uncertain
 * attempts stay claimed for manual reconciliation, never automatic blind resend. */
export async function notifyPublicInquiry(admin: SupabaseClient<Database>, input: Inquiry) {
  const { data, error } = await admin.from("support_requests")
    .update({ notification_status: "attempting", notification_attempted_at: new Date().toISOString() })
    .eq("id", input.id).eq("notification_status", "pending").select("id").maybeSingle();
  if (error || !data) { if (error) console.error("inquiry_notification_claim_failed", { requestId: input.id }); return; }
  let status = "failed", detail = "configuration_missing", providerId: string | null = null;
  // Reuse the established welcome/agreement sender configuration. No second key.
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || `Vaeroex <${VAEROEX_CONTACT_EMAILS.general}>`;
  // Preview must not inherit a Production NEXT_PUBLIC_APP_URL as its default.
  const origin = process.env.INQUIRY_ADMIN_ORIGIN || (process.env.VERCEL_ENV === "preview"
    ? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined)
    : getAppUrl());
  try {
    if (!key || !from || !origin) throw new Error("configuration_missing");
    const sender = from.match(/^(?:[^<>\r\n]+ <)?([^<>\s]+@vaeroex\.com)>?$/i);
    if (!sender) throw new Error("configuration_sender_invalid");
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || /[\r\n]/.test(from)) throw new Error("configuration_invalid");
    const link = `${url.origin}/app/admin/support-requests?q=${encodeURIComponent(input.email)}`;
    const summary = input.message.slice(0, 1200);
    const text = `New public inquiry (submitted content is untrusted)\nRequest: ${input.id}\nCategory: ${input.category}\nName: ${input.name}\nEmail: ${input.email}\n\n${summary}\n\nReview (admin sign-in required): ${link}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `public-inquiry-${input.id}` },
      body: JSON.stringify({ from, to: [VAEROEX_CONTACT_EMAILS.general], reply_to: input.email,
        subject: `New Vaeroex inquiry: ${input.category.replace(/[\r\n]/g, " ")}`,
        text, html: `<html lang="en"><body><h1>New public inquiry</h1><p>Submitted content is untrusted text.</p><pre style="white-space:pre-wrap">${escape(text)}</pre></body></html>` }),
      signal: AbortSignal.timeout(8000), cache: "no-store"
    });
    if (response.ok) {
      const result = await response.json();
      if (typeof result.id !== "string") { status = "unknown"; detail = "provider_response_invalid"; }
      else { status = "accepted"; detail = "provider_accepted_not_inbox_confirmed"; providerId = result.id; }
    } else { detail = `provider_http_${response.status}`; }
  } catch (error) {
    detail = error instanceof Error && /^configuration_/.test(error.message) ? error.message : "provider_outcome_unknown";
    if (detail === "provider_outcome_unknown") status = "unknown";
  }
  const saved = await admin.from("support_requests").update({ notification_status: status, notification_detail: detail, notification_provider_id: providerId }).eq("id", input.id);
  if (saved.error) console.error("inquiry_notification_status_failed", { requestId: input.id });
}
