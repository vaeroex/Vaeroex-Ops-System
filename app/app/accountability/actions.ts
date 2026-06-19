"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type Supabase = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type KpiAlertRule = Database["public"]["Tables"]["kpi_alert_rules"]["Row"];

const shareScopeMap: Record<string, string> = {
  Person: "person",
  Role: "role",
  Department: "department",
  "Entire workspace": "workspace",
  person: "person",
  role: "role",
  department: "department",
  workspace: "workspace"
};
const scheduleMap: Record<string, string> = {
  "One-time share": "one_time",
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly",
  Quarterly: "quarterly",
  one_time: "one_time",
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly"
};
const conditionMap: Record<string, string> = {
  "Below target": "below_target",
  "Above target": "above_target",
  "Changes more than percent": "change_percent",
  "Declined for 2 periods": "declined_2_periods",
  "No update this month": "no_update_this_month",
  below_target: "below_target",
  above_target: "above_target",
  change_percent: "change_percent",
  declined_2_periods: "declined_2_periods",
  no_update_this_month: "no_update_this_month"
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}` as Route);
}

function returnPath(formData: FormData, fallback = "/app") {
  const value = text(formData, "return_path");
  return value.startsWith("/app") ? value : fallback;
}

function actionHref(formData: FormData, fallback = "/app") {
  const value = text(formData, "action_href");
  return value.startsWith("/app") ? value : fallback;
}

function scopeFromForm(formData: FormData) {
  return shareScopeMap[text(formData, "recipient_scope")] || "workspace";
}

function scheduleFromForm(formData: FormData) {
  return scheduleMap[text(formData, "distribution_schedule")] || "one_time";
}

function conditionFromForm(formData: FormData) {
  return conditionMap[text(formData, "condition_type")] || "below_target";
}

function optionalNumber(value: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function recipientLabel({
  scope,
  personName,
  role,
  department
}: {
  scope: string;
  personName?: string | null;
  role?: string | null;
  department?: string | null;
}) {
  if (scope === "person") return personName || "selected person";
  if (scope === "role") return role || "selected role";
  if (scope === "department") return department || "selected department";
  return "the entire workspace";
}

function requireRecipient(path: string, scope: string, personId: string | null, role: string | null, department: string | null) {
  if (scope === "person" && !personId) {
    redirectWithError(path, "Choose a person before saving.");
  }

  if (scope === "role" && !role) {
    redirectWithError(path, "Choose a role before saving.");
  }

  if (scope === "department" && !department) {
    redirectWithError(path, "Choose a department before saving.");
  }
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

async function getPersonName(supabase: Supabase, workspaceId: string, personId: string | null) {
  if (!personId) {
    return null;
  }

  const { data } = await supabase
    .from("people")
    .select("full_name")
    .eq("id", personId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return data?.full_name || null;
}

async function createNotification({
  supabase,
  workspaceId,
  type,
  title,
  body,
  priority,
  relatedModule,
  relatedRecordType,
  relatedRecordId,
  actionLabel,
  actionHref,
  recipientScope,
  recipientPersonId,
  recipientRole,
  recipientDepartment,
  metadata
}: {
  supabase: Supabase;
  workspaceId: string;
  type: string;
  title: string;
  body: string;
  priority?: string;
  relatedModule?: string | null;
  relatedRecordType?: string | null;
  relatedRecordId?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  recipientScope?: string;
  recipientPersonId?: string | null;
  recipientRole?: string | null;
  recipientDepartment?: string | null;
  metadata?: Json;
}) {
  const { error } = await supabase.from("notifications").insert({
    workspace_id: workspaceId,
    type,
    title,
    body,
    priority: priority || "Medium",
    related_module: relatedModule || null,
    related_record_type: relatedRecordType || null,
    related_record_id: relatedRecordId || null,
    action_label: actionLabel || "Open",
    action_href: actionHref || "/app",
    recipient_scope: recipientScope || "workspace",
    recipient_person_id: recipientPersonId || null,
    recipient_role: recipientRole || null,
    recipient_department: recipientDepartment || null,
    metadata_json: metadata || ({} satisfies Json)
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function shareRecordAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const sourceType = text(formData, "source_type");
  const sourceId = text(formData, "source_id");
  const sourceTitle = text(formData, "source_title");
  const scope = scopeFromForm(formData);
  const personId = scope === "person" ? nullableText(formData, "person_id") : null;
  const role = scope === "role" ? nullableText(formData, "role") : null;
  const department = scope === "department" ? nullableText(formData, "department") : null;
  const schedule = scheduleFromForm(formData);
  const personName = await getPersonName(supabase, workspaceId, personId);
  const recipient = recipientLabel({ scope, personName, role, department });

  if (!sourceType || !sourceId || !sourceTitle) {
    redirectWithError(path, "A record is required before sharing.");
  }

  requireRecipient(path, scope, personId, role, department);

  const { error } = await supabase.from("record_shares").insert({
    workspace_id: workspaceId,
    source_type: sourceType,
    source_id: sourceId,
    source_title: sourceTitle,
    share_scope: scope,
    person_id: personId,
    role,
    department,
    message: text(formData, "message"),
    distribution_schedule: schedule,
    last_shared_at: new Date().toISOString(),
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  try {
    await createNotification({
      supabase,
      workspaceId,
      type: `${sourceType}_shared`,
      title: `${sourceTitle} shared`,
      body: `${sourceTitle} was shared with ${recipient}. Email sending is not enabled, so Vaeroex created this in-app notification.`,
      priority: text(formData, "priority") || "Medium",
      relatedModule: text(formData, "related_module") || sourceType,
      relatedRecordType: sourceType,
      relatedRecordId: sourceId,
      actionLabel: text(formData, "action_label") || "Open record",
      actionHref: actionHref(formData, path),
      recipientScope: scope,
      recipientPersonId: personId,
      recipientRole: role,
      recipientDepartment: department,
      metadata: { distribution_schedule: schedule, source_title: sourceTitle } satisfies Json
    });
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "Share notification could not be created.");
  }

  revalidatePath(path);
  revalidatePath("/app");
  revalidatePath("/app/notifications");
  redirectWithMessage(path, `Shared with ${recipient}.`);
}

export async function createAssignmentAction(formData: FormData) {
  const path = returnPath(formData);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const sourceType = text(formData, "source_type") || "manual";
  const sourceId = nullableText(formData, "source_id");
  const sourceTitle = nullableText(formData, "source_title");
  const title = text(formData, "assignment_title") || sourceTitle || "Follow-up assignment";
  const scope = scopeFromForm(formData);
  const personId = scope === "person" ? nullableText(formData, "person_id") : null;
  const role = scope === "role" ? nullableText(formData, "role") : null;
  const department = scope === "department" ? nullableText(formData, "department") : null;
  const priority = text(formData, "priority") || "Medium";
  const status = text(formData, "status") || "Open";
  const personName = await getPersonName(supabase, workspaceId, personId);
  const recipient = recipientLabel({ scope, personName, role, department });

  if (!title) {
    redirectWithError(path, "Assignment title is required.");
  }

  requireRecipient(path, scope, personId, role, department);

  const { error } = await supabase.from("operational_assignments").insert({
    workspace_id: workspaceId,
    source_type: sourceType,
    source_id: sourceId,
    source_title: sourceTitle,
    title,
    description: text(formData, "description"),
    assigned_person_id: personId,
    assigned_role: role,
    assigned_department: department,
    due_date: nullableText(formData, "due_date"),
    priority,
    status,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  if (sourceId && sourceType === "task") {
    await supabase
      .from("tasks")
      .update({
        assigned_person_id: personId,
        assigned_role: role,
        assigned_department: department,
        due_date: nullableText(formData, "due_date"),
        priority,
        status
      })
      .eq("id", sourceId)
      .eq("workspace_id", workspaceId);
  }

  if (sourceId && sourceType === "issue") {
    await supabase
      .from("issues")
      .update({
        assigned_person_id: personId,
        assigned_role: role,
        assigned_department: department,
        due_date: nullableText(formData, "due_date"),
        severity: priority === "Urgent" ? "High" : priority,
        status
      })
      .eq("id", sourceId)
      .eq("workspace_id", workspaceId);
  }

  try {
    await createNotification({
      supabase,
      workspaceId,
      type: `${sourceType}_assigned`,
      title: `${title} assigned`,
      body: `${title} was assigned to ${recipient}.`,
      priority,
      relatedModule: text(formData, "related_module") || sourceType,
      relatedRecordType: sourceType,
      relatedRecordId: sourceId,
      actionLabel: text(formData, "action_label") || "Review assignment",
      actionHref: actionHref(formData, path),
      recipientScope: scope,
      recipientPersonId: personId,
      recipientRole: role,
      recipientDepartment: department,
      metadata: { source_title: sourceTitle, due_date: nullableText(formData, "due_date") } satisfies Json
    });
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "Assignment notification could not be created.");
  }

  revalidatePath(path);
  revalidatePath("/app");
  revalidatePath("/app/notifications");
  revalidatePath("/app/tasks");
  revalidatePath("/app/issues");
  redirectWithMessage(path, `Assigned to ${recipient}.`);
}

export async function dismissRecommendationAction(formData: FormData) {
  const path = returnPath(formData, "/app/agents");
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "assignment_title") || "Vaeroex recommendation dismissed";

  const { error } = await supabase.from("operational_assignments").insert({
    workspace_id: workspaceId,
    source_type: text(formData, "source_type") || "vaeroex_recommendation",
    source_id: nullableText(formData, "source_id"),
    source_title: nullableText(formData, "source_title"),
    title,
    description: "Dismissed for now.",
    priority: "Low",
    status: "Dismissed",
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Recommendation dismissed.");
}

export async function createKpiAlertRuleAction(formData: FormData) {
  const path = returnPath(formData, "/app/kpis");
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const scope = scopeFromForm(formData);
  const personId = scope === "person" ? nullableText(formData, "person_id") : null;
  const role = scope === "role" ? nullableText(formData, "role") : null;
  const department = scope === "department" ? nullableText(formData, "department") : null;
  const kpiName = text(formData, "kpi_name");

  if (!kpiName) {
    redirectWithError(path, "Choose a KPI for the alert rule.");
  }

  requireRecipient(path, scope, personId, role, department);

  const { error } = await supabase.from("kpi_alert_rules").insert({
    workspace_id: workspaceId,
    kpi_name: kpiName,
    condition_type: conditionFromForm(formData),
    threshold_value: optionalNumber(text(formData, "threshold_value")),
    recipient_scope: scope,
    person_id: personId,
    role,
    department,
    priority: text(formData, "priority") || "Medium",
    is_active: true,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "KPI alert rule created.");
}

function latestRowsByName(kpis: KpiRow[]) {
  const grouped = new Map<string, KpiRow[]>();

  for (const kpi of kpis) {
    grouped.set(kpi.name, [...(grouped.get(kpi.name) || []), kpi]);
  }

  for (const [name, rows] of grouped) {
    grouped.set(
      name,
      rows.sort((a, b) => `${b.metric_date}-${b.created_at}`.localeCompare(`${a.metric_date}-${a.created_at}`))
    );
  }

  return grouped;
}

function alertMessage(rule: KpiAlertRule, rows: KpiRow[]) {
  const latest = rows[0];
  const previous = rows[1];

  if (rule.condition_type === "no_update_this_month") {
    const currentMonth = todayDate().slice(0, 7);
    if (!latest || !latest.metric_date.startsWith(currentMonth)) {
      return {
        kpi: latest,
        title: `KPI Alert: ${rule.kpi_name} has no update this month`,
        message: `${rule.kpi_name} has not been updated for ${currentMonth}.`
      };
    }
    return null;
  }

  if (!latest || latest.actual_value === null) {
    return null;
  }

  if (rule.condition_type === "below_target" && latest.target !== null && latest.actual_value < latest.target) {
    return {
      kpi: latest,
      title: `KPI Alert: ${rule.kpi_name} is below target`,
      message: `${rule.kpi_name} is ${latest.actual_value}, below the target of ${latest.target}.`
    };
  }

  if (rule.condition_type === "above_target" && latest.target !== null && latest.actual_value > latest.target) {
    return {
      kpi: latest,
      title: `KPI Alert: ${rule.kpi_name} is above target`,
      message: `${rule.kpi_name} is ${latest.actual_value}, above the target of ${latest.target}.`
    };
  }

  if (rule.condition_type === "change_percent" && previous?.actual_value !== null && previous?.actual_value !== undefined && previous.actual_value !== 0) {
    const change = ((latest.actual_value - previous.actual_value) / Math.abs(previous.actual_value)) * 100;
    const threshold = rule.threshold_value || 10;

    if (Math.abs(change) >= threshold) {
      return {
        kpi: latest,
        title: `KPI Alert: ${rule.kpi_name} changed ${Math.round(change)}%`,
        message: `${rule.kpi_name} changed by ${change.toFixed(1)}%, which is at or above the ${threshold}% alert rule.`
      };
    }
  }

  if (rule.condition_type === "declined_2_periods" && rows.length >= 3) {
    const first = rows[2].actual_value;
    const second = rows[1].actual_value;
    const third = rows[0].actual_value;

    if (first !== null && second !== null && third !== null && third < second && second < first) {
      return {
        kpi: latest,
        title: `KPI Alert: ${rule.kpi_name} declined for 2 periods`,
        message: `${rule.kpi_name} has declined for two consecutive recorded periods.`
      };
    }
  }

  return null;
}

export async function evaluateKpiAlertsAction(formData: FormData) {
  const path = returnPath(formData, "/app/kpis");
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const [rulesResult, kpiResult] = await Promise.all([
    supabase
      .from("kpi_alert_rules")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("archived_at", null)
      .is("deleted_at", null),
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false })
  ]);

  if (rulesResult.error || kpiResult.error) {
    redirectWithError(path, rulesResult.error?.message || kpiResult.error?.message || "KPI alerts could not be checked.");
  }

  const grouped = latestRowsByName((kpiResult.data || []) as KpiRow[]);
  let triggered = 0;

  for (const rule of (rulesResult.data || []) as KpiAlertRule[]) {
    const alert = alertMessage(rule, grouped.get(rule.kpi_name) || []);

    if (!alert) {
      continue;
    }

    const { error: eventError } = await supabase.from("kpi_alert_events").insert({
      workspace_id: workspaceId,
      rule_id: rule.id,
      kpi_id: alert.kpi?.id || null,
      title: alert.title,
      message: alert.message,
      priority: rule.priority,
      created_by: user.id
    });

    if (eventError) {
      redirectWithError(path, eventError.message);
    }

    await createNotification({
      supabase,
      workspaceId,
      type: "kpi_alert",
      title: alert.title,
      body: alert.message,
      priority: rule.priority,
      relatedModule: "KPIs",
      relatedRecordType: "kpi",
      relatedRecordId: alert.kpi?.id || null,
      actionLabel: "Review KPI",
      actionHref: "/app/kpis",
      recipientScope: rule.recipient_scope,
      recipientPersonId: rule.person_id,
      recipientRole: rule.role,
      recipientDepartment: rule.department,
      metadata: { rule_id: rule.id, condition_type: rule.condition_type } satisfies Json
    });

    await supabase.from("kpi_alert_rules").update({ last_triggered_at: new Date().toISOString() }).eq("id", rule.id).eq("workspace_id", workspaceId);
    triggered += 1;
  }

  revalidatePath(path);
  revalidatePath("/app");
  revalidatePath("/app/notifications");
  redirectWithMessage(path, triggered ? `${triggered} KPI alert${triggered === 1 ? "" : "s"} created.` : "No KPI alerts were triggered.");
}

export async function markNotificationReadAction(formData: FormData) {
  const path = returnPath(formData, "/app/notifications");
  const { supabase, workspaceId } = await requireWorkspace(path);
  const notificationId = text(formData, "notification_id");

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("workspace_id", workspaceId);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app");
  redirectWithMessage(path, "Notification marked read.");
}

export async function markAllNotificationsReadAction(formData: FormData) {
  const path = returnPath(formData, "/app/notifications");
  const { supabase, workspaceId } = await requireWorkspace(path);

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("read_at", null);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app");
  redirectWithMessage(path, "All notifications marked read.");
}
