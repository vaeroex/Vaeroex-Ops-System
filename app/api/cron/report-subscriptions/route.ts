import { NextResponse } from "next/server";
import { createScheduledReport } from "@/lib/reports/scheduled-generator";
import {
  getNextScheduledRun,
  isReportSubscriptionDue,
  isScheduledReportCategory,
  reportSubscriptionCategory
} from "@/lib/reports/subscriptions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type PreferenceRow = Database["public"]["Tables"]["report_subscription_preferences"]["Row"];
type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function preferenceIsActive(preference: PreferenceRow, now: Date) {
  if (preference.email_status !== "enabled") {
    return false;
  }

  const today = dateOnly(now);

  if (preference.pause_until && preference.pause_until >= today) {
    return false;
  }

  return isScheduledReportCategory(preference.category) && isReportSubscriptionDue(preference, now);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  const now = new Date();
  const today = dateOnly(now);
  const { data: preferences, error: preferenceError } = await supabase
    .from("report_subscription_preferences")
    .select("*")
    .eq("email_status", "enabled")
    .is("archived_at", null)
    .is("deleted_at", null);

  if (preferenceError) {
    return NextResponse.json({ error: preferenceError.message }, { status: 500 });
  }

  const duePreferences = ((preferences || []) as PreferenceRow[]).filter((preference) => preferenceIsActive(preference, now));
  const workspaceIds = Array.from(new Set(duePreferences.map((preference) => preference.workspace_id)));
  const { data: workspaces, error: workspaceError } = workspaceIds.length
    ? await supabase.from("workspaces").select("*").in("id", workspaceIds)
    : { data: [], error: null };

  if (workspaceError) {
    return NextResponse.json({ error: workspaceError.message }, { status: 500 });
  }

  const workspaceById = new Map(((workspaces || []) as WorkspaceRow[]).map((workspace) => [workspace.id, workspace]));
  const groups = new Map<string, PreferenceRow[]>();

  for (const preference of duePreferences) {
    const key = `${preference.workspace_id}:${preference.category}`;
    groups.set(key, [...(groups.get(key) || []), preference]);
  }

  const results: Array<{ workspace_id: string; category: string; status: string; report_id?: string | null; error?: string }> = [];

  for (const [key, group] of groups) {
    const [workspaceId, categoryValue] = key.split(":");
    const category = reportSubscriptionCategory(categoryValue);
    const workspace = workspaceById.get(workspaceId);

    if (!workspace) {
      results.push({ workspace_id: workspaceId, category, status: "skipped", error: "Workspace not found." });
      continue;
    }

    const nextRun = getNextScheduledRun(group[0], new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const runDate = nextRun ? dateOnly(nextRun) : today;
    const { data: existingRun, error: existingRunError } = await supabase
      .from("scheduled_report_runs")
      .select("id,status,report_id")
      .eq("workspace_id", workspaceId)
      .eq("category", category)
      .eq("run_date", runDate)
      .maybeSingle();

    if (existingRunError) {
      results.push({ workspace_id: workspaceId, category, status: "failed", error: existingRunError.message });
      continue;
    }

    if (existingRun) {
      results.push({ workspace_id: workspaceId, category, status: `skipped_${existingRun.status}`, report_id: existingRun.report_id });
      continue;
    }

    const { data: run, error: runError } = await supabase
      .from("scheduled_report_runs")
      .insert({
        workspace_id: workspaceId,
        category,
        run_date: runDate,
        status: "pending",
        metadata_json: { preference_count: group.length, scheduled_time: group[0]?.schedule_time || null }
      })
      .select("id")
      .single();

    if (runError || !run) {
      results.push({ workspace_id: workspaceId, category, status: "failed", error: runError?.message || "Run record could not be created." });
      continue;
    }

    try {
      const report = await createScheduledReport({
        supabase,
        workspace,
        category,
        preferences: group,
        runDate: nextRun || now
      });

      await supabase
        .from("scheduled_report_runs")
        .update({
          status: "generated",
          report_id: report.reportId,
          completed_at: new Date().toISOString(),
          metadata_json: {
            preference_count: group.length,
            start: report.startDate,
            end: report.endDate,
            counts: report.source.counts
          }
        })
        .eq("id", run.id)
        .eq("workspace_id", workspaceId);

      results.push({ workspace_id: workspaceId, category, status: "generated", report_id: report.reportId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scheduled report failed.";

      await supabase
        .from("scheduled_report_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: message
        })
        .eq("id", run.id)
        .eq("workspace_id", workspaceId);

      results.push({ workspace_id: workspaceId, category, status: "failed", error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    run_date: today,
    due_preferences: duePreferences.length,
    processed_groups: results.length,
    results
  });
}
