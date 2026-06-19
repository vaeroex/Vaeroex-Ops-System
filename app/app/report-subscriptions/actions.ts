"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createScheduledReport } from "@/lib/reports/scheduled-generator";
import {
  categoryLabel,
  clampScheduleDay,
  defaultMonthInQuarter,
  defaultWeekdayForCategory,
  isScheduledReportCategory,
  normalizeScheduleTime,
  reportSubscriptionCategory,
  reportSubscriptionScope,
  reportSubscriptionStatus,
  reportScheduleDayKind
} from "@/lib/reports/subscriptions";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type PreferenceRow = Database["public"]["Tables"]["report_subscription_preferences"]["Row"];

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function intValue(formData: FormData, key: string) {
  const value = Number(text(formData, key));
  return Number.isFinite(value) ? Math.trunc(value) : null;
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

  return {
    supabase,
    user,
    workspace: context.activeWorkspace,
    workspaceId: context.activeWorkspace.id,
    membership: context.membership
  };
}

function schedulePayload(category: string, formData: FormData) {
  const weekly = category === "weekly_review" || category === "weekly_planning";
  const monthly = category === "monthly_executive_summary";
  const quarterly = category === "quarterly_business_review";
  const scheduled = isScheduledReportCategory(category);
  const rawWeekday = intValue(formData, "schedule_day_of_week");
  const rawQuarterMonth = intValue(formData, "schedule_month_in_quarter");
  const dayKind = reportScheduleDayKind(text(formData, "schedule_day_kind"));

  return {
    schedule_day_of_week: weekly ? Math.max(0, Math.min(6, rawWeekday ?? defaultWeekdayForCategory(category))) : null,
    schedule_day_kind: monthly || quarterly ? dayKind : "custom_day",
    schedule_day_of_month: monthly || quarterly ? clampScheduleDay(intValue(formData, "schedule_day_of_month") ?? 1) : null,
    schedule_month_in_quarter: quarterly ? Math.max(1, Math.min(3, rawQuarterMonth ?? defaultMonthInQuarter(category) ?? 1)) : null,
    schedule_time: scheduled ? normalizeScheduleTime(text(formData, "schedule_time")) : null
  };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
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
  const schedule = schedulePayload(category, formData);

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
    ...schedule,
    created_by: user.id
  };

  const result = existing
    ? await supabase
        .from("report_subscription_preferences")
        .update({
          email_status: payload.email_status,
          pause_until: payload.pause_until,
          person_id: payload.person_id,
          role: payload.role,
          schedule_day_of_week: payload.schedule_day_of_week,
          schedule_day_kind: payload.schedule_day_kind,
          schedule_day_of_month: payload.schedule_day_of_month,
          schedule_month_in_quarter: payload.schedule_month_in_quarter,
          schedule_time: payload.schedule_time
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

export async function runReportSubscriptionNowAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspace, workspaceId, membership } = await requireWorkspace(path);
  const category = reportSubscriptionCategory(text(formData, "category"));
  const canRunNow = isVaeroexAdminUser(user) || ["owner", "admin"].includes(membership?.role || "");

  if (!canRunNow) {
    redirectWithError(path, "Only Vaeroex admins and workspace owners can run scheduled reports immediately.");
  }

  if (!isScheduledReportCategory(category)) {
    redirectWithError(path, `${categoryLabel(category)} is triggered by activity and does not have a scheduled report run.`);
  }

  const { data: preferences, error: preferenceError } = await supabase
    .from("report_subscription_preferences")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .is("deleted_at", null)
    .is("archived_at", null);

  if (preferenceError) {
    redirectWithError(path, preferenceError.message);
  }

  const today = dateOnly(new Date());
  const availablePreferences = ((preferences || []) as PreferenceRow[]).filter(
    (preference) => preference.email_status !== "paused" || !preference.pause_until || preference.pause_until < today
  );
  const enabledPreferences = availablePreferences.filter((preference) => preference.email_status === "enabled");
  const runPreferences = enabledPreferences.length ? enabledPreferences : availablePreferences;

  const { data: run, error: runError } = await supabase
    .from("scheduled_report_runs")
    .upsert(
      {
        workspace_id: workspaceId,
        category,
        run_date: today,
        status: "pending",
        report_id: null,
        completed_at: null,
        error_message: null,
        metadata_json: { run_now: true, preference_count: runPreferences.length } satisfies Json
      },
      { onConflict: "workspace_id,category,run_date" }
    )
    .select("id")
    .single();

  if (runError || !run) {
    redirectWithError(path, runError?.message || "Run record could not be created.");
  }

  try {
    const report = await createScheduledReport({
      supabase,
      workspace,
      category,
      preferences: runPreferences,
      runDate: new Date()
    });

    await supabase
      .from("scheduled_report_runs")
      .update({
        status: "generated",
        report_id: report.reportId,
        completed_at: new Date().toISOString(),
        metadata_json: {
          run_now: true,
          preference_count: runPreferences.length,
          start: report.startDate,
          end: report.endDate,
          counts: report.source.counts
        } satisfies Json
      })
      .eq("id", run.id)
      .eq("workspace_id", workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled report could not be generated.";

    await supabase
      .from("scheduled_report_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: message
      })
      .eq("id", run.id)
      .eq("workspace_id", workspaceId);

    redirectWithError(path, message);
  }

  revalidatePath("/app/reports");
  revalidatePath("/app/notifications");
  redirectWithMessage(path, `${categoryLabel(category)} generated now.`);
}
