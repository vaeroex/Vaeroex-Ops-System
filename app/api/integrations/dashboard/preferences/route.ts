import {
  IntegrationSummaryPreferenceError,
  IntegrationSummaryPreferenceInputSchema,
  saveIntegrationSummaryPreference
} from "@/lib/integrations/dashboard/preferences-server";
import { PublicSubmissionValidationError, readBoundedJson } from "@/lib/security/public-submission-validation";

const headers = { "cache-control": "no-store" };

export async function PATCH(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin ||
      request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ ok: false, error: "origin_denied" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ ok: false, error: "unsupported_content_type" }, { status: 415, headers });
  }
  try {
    const input = IntegrationSummaryPreferenceInputSchema.safeParse(await readBoundedJson(request, 1024));
    if (!input.success) return Response.json({ ok: false, error: "invalid_preference" }, { status: 400, headers });
    const preference = await saveIntegrationSummaryPreference(input.data);
    return Response.json({ ok: true, ...preference }, { headers });
  } catch (error) {
    if (error instanceof PublicSubmissionValidationError) {
      return Response.json({ ok: false, error: "invalid_preference" }, { status: error.status, headers });
    }
    const status = error instanceof IntegrationSummaryPreferenceError ? error.status : 503;
    const code = error instanceof IntegrationSummaryPreferenceError ? error.code : "preference_save_failed";
    return Response.json({ ok: false, error: code }, { status, headers });
  }
}
