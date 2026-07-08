import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function value(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function redirectWith(path: string, key: "message" | "error", text: string) {
  return NextResponse.redirect(new URL(`${path}?${key}=${encodeURIComponent(text)}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return redirectWith("/billing-required", "error", "Subscription activation requests are not configured yet.");
  }

  const formData = await request.formData();
  const name = value(formData, "name");
  const email = value(formData, "email");

  if (!name || !email) {
    return redirectWith("/billing-required", "error", "Enter your name and Vaeroex subscription email.");
  }

  const rateLimit = await enforceRateLimit({
    action: "subscription.activation_request",
    limit: 4,
    windowSeconds: 30 * 60,
    requestHeaders: request.headers,
    identifiers: [email],
    metadata: { source: "manual_activation_request" }
  });

  if (!rateLimit.allowed) {
    return redirectWith("/billing-required", "error", rateLimitMessage(rateLimit));
  }

  const { error } = await admin.from("manual_activation_requests").insert({
    name,
    email,
    company: value(formData, "company"),
    plan_purchased: value(formData, "plan_purchased"),
    order_number: value(formData, "order_number"),
    message: value(formData, "message"),
    status: "pending"
  });

  if (error) {
    return redirectWith("/billing-required", "error", error.message);
  }

  return redirectWith("/billing-required", "message", "Manual activation request received. Vaeroex will review your subscription access.");
}
