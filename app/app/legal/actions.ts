"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
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

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/app?error=Supabase is not configured." as Route);
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip");

  const { error } = await supabase.from("legal_acceptances").insert({
    user_id: user.id,
    workspace_id: context.activeWorkspace?.id ?? null,
    terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
    privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
    ai_disclaimer_version: LEGAL_DOCUMENT_VERSIONS.aiDisclaimer,
    sensitive_data_policy_version: LEGAL_DOCUMENT_VERSIONS.sensitiveData,
    user_email: user.email ?? context.profile?.email ?? null,
    user_agent: userAgent,
    ip_address: ipAddress || null
  });

  if (error) {
    redirect(`/app?error=${encodeURIComponent(error.message)}` as Route);
  }

  revalidatePath("/app");
  redirect("/app?message=Vaeroex policy acceptance recorded." as Route);
}
