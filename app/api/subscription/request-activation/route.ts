import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  ACTIVATION_FORM_MAX_BODY_BYTES,
  boundedFormData,
  MANUAL_ACTIVATION_REQUEST_KEYS,
  manualActivationRequestSchema,
  readBoundedUrlEncodedFormData
} from "@/lib/security/public-submission-validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function redirectWith(path: string, key: "message" | "error", text: string) {
  return NextResponse.redirect(new URL(`${path}?${key}=${encodeURIComponent(text)}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return redirectWith("/billing-required", "error", "Subscription activation requests are not configured yet.");
  }

  let submission: ReturnType<typeof manualActivationRequestSchema.parse>;
  try {
    const formData = await readBoundedUrlEncodedFormData(request, ACTIVATION_FORM_MAX_BODY_BYTES);
    submission = manualActivationRequestSchema.parse(
      boundedFormData(formData, MANUAL_ACTIVATION_REQUEST_KEYS, ACTIVATION_FORM_MAX_BODY_BYTES)
    );
  } catch {
    return redirectWith("/billing-required", "error", "Check the submitted activation details and try again.");
  }

  let rateLimit;
  try {
    rateLimit = await enforceRateLimit({
      action: "subscription.activation_request",
      limit: 4,
      windowSeconds: 30 * 60,
      requestHeaders: request.headers,
      identifiers: [submission.email],
      metadata: { source: "manual_activation_request" },
      strict: true
    });
  } catch {
    return redirectWith("/billing-required", "error", "Vaeroex could not verify request limits. Please try again shortly.");
  }

  if (!rateLimit.allowed) {
    return redirectWith("/billing-required", "error", rateLimitMessage(rateLimit));
  }

  const { error } = await admin.from("manual_activation_requests").insert({
    name: submission.name,
    email: submission.email,
    company: submission.company,
    plan_purchased: submission.plan_purchased,
    order_number: submission.order_number,
    message: submission.message,
    status: "pending"
  });

  if (error) {
    return redirectWith("/billing-required", "error", "The activation request could not be submitted. Please try again.");
  }

  return redirectWith("/billing-required", "message", "Manual activation request received. Vaeroex will review your subscription access.");
}
