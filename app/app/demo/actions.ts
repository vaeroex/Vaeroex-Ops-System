"use server";

import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { ensureDemoWorkspacePopulated, isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
type SignedInUser = Awaited<ReturnType<SupabaseServerClient["auth"]["getUser"]>>["data"]["user"];
type WorkspaceJoinRow = {
  workspace_id: string;
  workspaces: { id: string; name: string; subscription_status: string } | { id: string; name: string; subscription_status: string }[] | null;
};

function normalizeWorkspace(row: WorkspaceJoinRow) {
  return Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
}

function throwIfError(error: { message?: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message || "request failed"}`);
  }
}

function appMessage(message: string) {
  return `/app?message=${encodeURIComponent(message)}` as Route;
}

function appError(message: string) {
  return `/app?error=${encodeURIComponent(message)}` as Route;
}

async function requireSignedInSession() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(appError("Supabase is not configured."));
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

async function setActiveWorkspace(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set("vaeroex_workspace_id", workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

async function clearActiveWorkspace() {
  const cookieStore = await cookies();
  cookieStore.delete("vaeroex_workspace_id");
}

async function listUserWorkspaces(supabase: SupabaseServerClient, userId: string) {
  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(id,name,subscription_status)")
    .eq("user_id", userId)
    .eq("status", "active");

  throwIfError(error, "Workspace lookup");

  return ((memberships || []) as WorkspaceJoinRow[]).map(normalizeWorkspace).filter(Boolean);
}

async function findDemoWorkspace(supabase: SupabaseServerClient, userId: string) {
  const workspaces = await listUserWorkspaces(supabase, userId);
  return workspaces.find(isDemoWorkspaceRecord) ?? null;
}

async function findNonDemoWorkspace(supabase: SupabaseServerClient, userId: string) {
  const workspaces = await listUserWorkspaces(supabase, userId);
  return workspaces.find((workspace) => !isDemoWorkspaceRecord(workspace)) ?? null;
}

async function createDemoWorkspaceShell(supabase: SupabaseServerClient, user: SignedInUser, name = "Vaeroex Demo Workspace") {
  if (!user) {
    throw new Error("Sign in before creating a demo workspace.");
  }

  const fullName = typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name
    : "Demo Owner";
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .insert({
      name,
      industry: "General Small Business",
      size: "12 employees",
      primary_contact_name: fullName,
      primary_contact_email: user.email,
      created_by: user.id,
      subscription_status: "demo",
      plan_slug: "growth",
      subscription_required: false,
      manually_unlocked: true
    })
    .select("id")
    .single();

  throwIfError(workspaceError, "Demo workspace");

  if (!workspace) {
    throw new Error("Demo workspace could not be created.");
  }

  const membership = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
    status: "active"
  });
  throwIfError(membership.error, "Demo membership");

  await ensureDemoWorkspacePopulated(supabase, workspace.id, user, { rebuild: true });

  return workspace.id;
}

export async function createDemoWorkspaceAction() {
  const { supabase, user } = await requireSignedInSession();
  let destination: Route = appMessage("Demo workspace created with realistic January-to-current-month sample data.");

  try {
    const existing = await findDemoWorkspace(supabase, user.id);

    if (existing) {
      await ensureDemoWorkspacePopulated(supabase, existing.id, user);
      await setActiveWorkspace(existing.id);
      destination = appMessage("Demo workspace already exists. Open it, reset it, or create a fresh demo.");
    } else {
      const workspaceId = await createDemoWorkspaceShell(supabase, user);
      await setActiveWorkspace(workspaceId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo workspace could not be created.";
    destination = appError(message);
  }

  redirect(destination);
}

export async function openDemoWorkspaceAction() {
  const { supabase, user } = await requireSignedInSession();
  const demoWorkspace = await findDemoWorkspace(supabase, user.id);

  if (!demoWorkspace) {
    redirect(appError("No demo workspace exists yet. Create a demo workspace first."));
  }

  await ensureDemoWorkspacePopulated(supabase, demoWorkspace.id, user);
  await setActiveWorkspace(demoWorkspace.id);
  redirect(appMessage("Demo workspace opened with realistic January-to-current-month sample data."));
}

export async function exitDemoWorkspaceAction() {
  const { supabase, user } = await requireSignedInSession();
  const normalWorkspace = await findNonDemoWorkspace(supabase, user.id);

  if (!normalWorkspace) {
    await clearActiveWorkspace();
    redirect("/app/setup?message=No non-demo workspace found yet. Create a workspace when you are ready." as Route);
  }

  await setActiveWorkspace(normalWorkspace.id);
  redirect(appMessage("Switched back to your workspace."));
}

export async function createFreshDemoWorkspaceAction() {
  const { supabase, user } = await requireSignedInSession();

  if (!isVaeroexAdminUser(user)) {
    redirect(appError("Vaeroex admin access is required to create a fresh demo workspace."));
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  const workspaceId = await createDemoWorkspaceShell(supabase, user, `Vaeroex Demo Workspace ${stamp}`);
  await setActiveWorkspace(workspaceId);
  redirect(appMessage("Fresh demo workspace created with realistic January-to-current-month sample data."));
}

export async function resetDemoWorkspaceAction() {
  const { supabase, user } = await requireSignedInSession();

  if (!isVaeroexAdminUser(user)) {
    redirect(appError("Vaeroex admin access is required to reset demo workspace."));
  }

  const demoWorkspace = await findDemoWorkspace(supabase, user.id);

  if (!demoWorkspace) {
    redirect(appError("No demo workspace exists yet. Create a demo workspace first."));
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    redirect(appError("Supabase service role is required to reset demo workspace."));
  }

  const { error } = await admin.from("workspaces").delete().eq("id", demoWorkspace.id);
  throwIfError(error, "Reset demo workspace");

  const workspaceId = await createDemoWorkspaceShell(supabase, user);
  await setActiveWorkspace(workspaceId);
  redirect(appMessage("Demo workspace reset with realistic January-to-current-month sample data."));
}
