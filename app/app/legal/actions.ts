"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

const uuid = z.string().uuid();

async function recordAcceptance() {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return "unconfigured";

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || !uuid.safeParse(user.id).success || !user.email?.trim()) return "sign_in";

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const sessionId = uuid.safeParse(claimsData?.claims?.session_id);
    if (claimsError || claimsData?.claims?.sub !== user.id || !sessionId.success) return "sign_in";

    const context = await getWorkspaceContext(undefined, { supabase, user });
    const workspaceId = context.activeWorkspace?.id ?? null;
    if (workspaceId !== null) {
      if (!uuid.safeParse(workspaceId).success || context.membership?.status !== "active" ||
          context.membership.user_id !== user.id || context.membership.workspace_id !== workspaceId) {
        return "workspace_changed";
      }
    } else if (context.membership) {
      return "workspace_changed";
    }

    const requestHeaders = await headers();
    const forwardedFor = requestHeaders.get("x-forwarded-for");
    const ipAddress = forwardedFor?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip");
    const admin = createSupabaseAdminClient();
    if (!admin) return "unavailable";

    // The protected function rechecks the live account/session and workspace membership.
    // All identity and policy arguments come from verified server state, never form fields.
    const { data, error } = await admin.rpc("record_trusted_in_app_legal_acceptance_v2", {
      p_user_id: user.id,
      p_workspace_id: workspaceId,
      p_user_email: user.email,
      p_terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
      p_privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
      p_ai_disclaimer_version: LEGAL_DOCUMENT_VERSIONS.aiDisclaimer,
      p_sensitive_data_policy_version: LEGAL_DOCUMENT_VERSIONS.sensitiveData,
      p_user_agent: requestHeaders.get("user-agent"),
      p_ip_address: ipAddress || null,
      p_session_id: sessionId.data
    });
    return error || !uuid.safeParse(data).success ? "unavailable" : "recorded";
  } catch {
    // Do not expose database errors, session metadata or request headers in redirects/logs.
    return "unavailable";
  }
}

export async function acceptLegalPoliciesAction(formData: FormData) {
  const allAccepted =
    checked(formData, "accept_terms") &&
    checked(formData, "accept_privacy") &&
    checked(formData, "accept_ai") &&
    checked(formData, "accept_sensitive");

  if (!allAccepted) {
    redirect("/app?error=Please review and accept all required Vaeroex policies." as Route);
  }

  const outcome = await recordAcceptance();
  if (outcome === "unconfigured") {
    redirect("/app?error=Supabase is not configured." as Route);
  }
  if (outcome === "sign_in") redirect("/login");
  if (outcome === "workspace_changed") {
    redirect("/app?error=Your workspace access changed. Reload before accepting policies." as Route);
  }
  if (outcome !== "recorded") {
    redirect("/app?error=We could not confirm policy acceptance. Reload before trying again." as Route);
  }

  revalidatePath("/app");
  redirect("/app?message=Vaeroex policy acceptance recorded." as Route);
}
