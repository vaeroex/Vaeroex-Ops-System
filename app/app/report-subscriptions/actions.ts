"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import {
  categoryLabel,
  reportSubscriptionCategory,
  reportSubscriptionScope,
  reportSubscriptionStatus
} from "@/lib/reports/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function returnPath(formData: FormData) {
  const value = text(formData, "return_path");
  return value.startsWith("/app") ? value : "/app/reports";
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}` as Route);
}

async function requireWorkspace(path: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError(path, "Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return { supabase, user, workspaceId: context.activeWorkspace.id };
}

export async function saveReportSubscriptionPreferenceAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const category = reportSubscriptionCategory(text(formData, "category"));
  const preferenceScope = reportSubscriptionScope(text(formData, "preference_scope"));
  const emailStatus = reportSubscriptionStatus(text(formData, "email_status"));
  const pauseUntil = nullableText(formData, "pause_until");
  const personId = preferenceScope === "person" ? nullableText(formData, "person_id") : null;
  const role = preferenceScope === "role" ? nullableText(formData, "role") : null;

  if (preferenceScope === "person" && !personId) {
    redirectWithError(path, "Choose a person before saving the subscription preference.");
  }

  if (preferenceScope === "role" && !role) {
    redirectWithError(path, "Choose a role before saving the subscription preference.");
  }

  if (emailStatus === "paused" && pauseUntil && !/^\d{4}-\d{2}-\d{2}$/.test(pauseUntil)) {
    redirectWithError(path, "Pause until must use the YYYY-MM-DD format.");
  }

  let query = supabase
    .from("report_subscription_preferences")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .eq("preference_scope", preferenceScope)
    .is("deleted_at", null);

  if (preferenceScope === "workspace") {
    query = query.is("person_id", null).is("role", null);
  } else if (preferenceScope === "role") {
    query = query.is("person_id", null).eq("role", role || "");
  } else {
    query = query.eq("person_id", personId || "");
  }

  const { data: existing, error: existingError } = await query.maybeSingle();

  if (existingError) {
    redirectWithError(path, existingError.message);
  }

  const payload = {
    workspace_id: workspaceId,
    category,
    preference_scope: preferenceScope,
    person_id: personId,
    role,
    email_status: emailStatus,
    pause_until: emailStatus === "paused" ? pauseUntil : null,
    created_by: user.id
  };

  const result = existing
    ? await supabase
        .from("report_subscription_preferences")
        .update({
          email_status: payload.email_status,
          pause_until: payload.pause_until,
          person_id: payload.person_id,
          role: payload.role
        })
        .eq("id", existing.id)
        .eq("workspace_id", workspaceId)
    : await supabase.from("report_subscription_preferences").insert(payload);

  if (result.error) {
    redirectWithError(path, result.error.message);
  }

  revalidatePath("/app/reports");
  redirectWithMessage(path, `${categoryLabel(category)} preference saved.`);
}
