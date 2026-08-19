import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  PUBLIC_FORM_MAX_BODY_BYTES,
  PublicSubmissionValidationError,
  publicFormSubmissionSchema,
  readBoundedJson,
  validatePublicFormFields
} from "@/lib/security/public-submission-validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

type PublicFormSubmissionRouteContext = {
  params: Promise<{ slug: string }>;
};

function publicError(message: string, status: number) {
  return NextResponse.json({ accepted: false, error: message }, { status });
}

export async function POST(request: Request, context: PublicFormSubmissionRouteContext) {
  const admin = createSupabaseAdminClient();
  if (!admin) return publicError("This public form is not available.", 503);

  const { slug: rawSlug } = await context.params;
  const slug = rawSlug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) {
    return publicError("This public form is not available.", 404);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return publicError("Submit this form as JSON.", 415);
  }

  let submission: ReturnType<typeof publicFormSubmissionSchema.parse>;
  try {
    submission = publicFormSubmissionSchema.parse(await readBoundedJson(request, PUBLIC_FORM_MAX_BODY_BYTES));
  } catch (error) {
    const status = error instanceof PublicSubmissionValidationError ? error.status : 400;
    return publicError("Check the submitted form fields and try again.", status);
  }

  const { data: form, error: formError } = await admin
    .from("forms")
    .select("id,workspace_id,schema_json")
    .eq("public_slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (formError || !form) return publicError("This public form is not available.", 404);

  let fields: Record<string, string | number | boolean | null>;
  try {
    fields = validatePublicFormFields(submission.fields, form.schema_json);
  } catch (error) {
    const status = error instanceof PublicSubmissionValidationError ? error.status : 400;
    return publicError(error instanceof PublicSubmissionValidationError ? error.message : "Check the submitted form fields and try again.", status);
  }

  let rateLimit;
  try {
    rateLimit = await enforceRateLimit({
      action: "public_form.submit",
      limit: 8,
      windowSeconds: 15 * 60,
      requestHeaders: request.headers,
      workspaceId: form.workspace_id,
      identifiers: [slug, submission.submitter_email],
      metadata: { source: "validated_public_form", form_id: form.id } satisfies Json,
      strict: true
    });
  } catch {
    return publicError("Vaeroex could not verify request limits. Please try again shortly.", 503);
  }

  if (!rateLimit.allowed) return publicError(rateLimitMessage(rateLimit), 429);

  // Existing forms may add this inert field as a bot trap without changing the
  // public persistence contract. It still consumes the same atomic quota.
  if (submission.website) {
    return NextResponse.json({ accepted: true }, { status: 202 });
  }

  const { error } = await admin.from("form_submissions").insert({
    workspace_id: form.workspace_id,
    form_id: form.id,
    submitted_by: null,
    submitter_name: submission.submitter_name || null,
    submitter_email: submission.submitter_email || null,
    data_json: fields satisfies Json,
    ai_summary: null,
    ai_detected_priority: null,
    ai_detected_followups_json: []
  });

  if (error) return publicError("The form could not be submitted. Please try again.", 503);

  return NextResponse.json({ accepted: true }, { status: 201 });
}
