"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type Supabase = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

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

function scopeFromForm(formData: FormData) {
  return shareScopeMap[text(formData, "recipient_scope")] || "workspace";
}

function scheduleFromForm(formData: FormData) {
  return scheduleMap[text(formData, "distribution_schedule")] || "one_time";
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

  revalidatePath(path);
  revalidatePath("/app");
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

  revalidatePath(path);
  revalidatePath("/app");
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
