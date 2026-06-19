"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type ManagedCollection =
  | "sops"
  | "tasks"
  | "checklists"
  | "checklist_runs"
  | "issues"
  | "reports"
  | "kpis"
  | "forms"
  | "form_submissions"
  | "ai_agent_runs"
  | "assets"
  | "asset_checks"
  | "crm_leads"
  | "files"
  | "people"
  | "support_requests";

type FieldKind = "text" | "requiredText" | "textarea" | "select" | "date" | "number" | "checkbox" | "lines";

type EditableField = {
  name: string;
  kind: FieldKind;
  maxLength?: number;
};

type CollectionConfig = {
  table: string;
  path: Route;
  titleField?: string;
  fields: EditableField[];
};

const COLLECTIONS: Record<ManagedCollection, CollectionConfig> = {
  forms: {
    table: "forms",
    path: "/app/forms",
    titleField: "name",
    fields: [
      { name: "name", kind: "requiredText", maxLength: 160 },
      { name: "description", kind: "textarea", maxLength: 800 },
      { name: "form_type", kind: "text", maxLength: 80 }
    ]
  },
  form_submissions: {
    table: "form_submissions",
    path: "/app/form-submissions",
    titleField: "submitter_name",
    fields: [
      { name: "submitter_name", kind: "text", maxLength: 160 },
      { name: "submitter_email", kind: "text", maxLength: 220 },
      { name: "ai_summary", kind: "textarea", maxLength: 3000 },
      { name: "ai_detected_priority", kind: "select", maxLength: 40 }
    ]
  },
  checklists: {
    table: "checklists",
    path: "/app/checklists",
    titleField: "name",
    fields: [
      { name: "name", kind: "requiredText", maxLength: 160 },
      { name: "category", kind: "text", maxLength: 120 },
      { name: "frequency", kind: "select", maxLength: 80 },
      { name: "assigned_role", kind: "text", maxLength: 120 },
      { name: "description", kind: "textarea", maxLength: 1200 },
      { name: "items_json", kind: "lines", maxLength: 6000 }
    ]
  },
  checklist_runs: {
    table: "checklist_runs",
    path: "/app/checklist-runs",
    titleField: "status",
    fields: [
      { name: "status", kind: "select", maxLength: 80 },
      { name: "completed_at", kind: "date" },
      { name: "due_date", kind: "date" },
      { name: "priority", kind: "select", maxLength: 40 },
      { name: "assigned_role", kind: "text", maxLength: 120 },
      { name: "assigned_department", kind: "text", maxLength: 140 },
      { name: "notes", kind: "textarea", maxLength: 1000 },
      { name: "responses_json", kind: "lines", maxLength: 6000 }
    ]
  },
  tasks: {
    table: "tasks",
    path: "/app/tasks",
    titleField: "title",
    fields: [
      { name: "title", kind: "requiredText", maxLength: 180 },
      { name: "description", kind: "textarea", maxLength: 2000 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "priority", kind: "select", maxLength: 80 },
      { name: "category", kind: "text", maxLength: 120 },
      { name: "assigned_role", kind: "text", maxLength: 120 },
      { name: "assigned_department", kind: "text", maxLength: 140 },
      { name: "due_date", kind: "date" }
    ]
  },
  issues: {
    table: "issues",
    path: "/app/issues",
    titleField: "title",
    fields: [
      { name: "title", kind: "requiredText", maxLength: 180 },
      { name: "issue_type", kind: "text", maxLength: 120 },
      { name: "description", kind: "textarea", maxLength: 2000 },
      { name: "severity", kind: "select", maxLength: 80 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "root_cause", kind: "textarea", maxLength: 2000 },
      { name: "recommended_fix", kind: "textarea", maxLength: 2000 },
      { name: "assigned_role", kind: "text", maxLength: 120 },
      { name: "assigned_department", kind: "text", maxLength: 140 },
      { name: "due_date", kind: "date" }
    ]
  },
  assets: {
    table: "assets",
    path: "/app/assets",
    titleField: "asset_name",
    fields: [
      { name: "asset_name", kind: "requiredText", maxLength: 180 },
      { name: "asset_type", kind: "text", maxLength: 120 },
      { name: "identifier", kind: "text", maxLength: 120 },
      { name: "location", kind: "text", maxLength: 160 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "notes", kind: "textarea", maxLength: 1200 }
    ]
  },
  asset_checks: {
    table: "asset_checks",
    path: "/app/assets",
    titleField: "status",
    fields: [
      { name: "status", kind: "select", maxLength: 80 },
      { name: "notes", kind: "textarea", maxLength: 1000 }
    ]
  },
  files: {
    table: "file_uploads",
    path: "/app/files",
    titleField: "display_name",
    fields: [
      { name: "display_name", kind: "requiredText", maxLength: 180 },
      { name: "import_type", kind: "text", maxLength: 40 },
      { name: "analysis_summary", kind: "textarea", maxLength: 5000 }
    ]
  },
  sops: {
    table: "sops",
    path: "/app/sops",
    titleField: "title",
    fields: [
      { name: "title", kind: "requiredText", maxLength: 180 },
      { name: "department", kind: "text", maxLength: 120 },
      { name: "category", kind: "text", maxLength: 120 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "version", kind: "number" },
      { name: "body_markdown", kind: "textarea", maxLength: 20000 }
    ]
  },
  reports: {
    table: "reports",
    path: "/app/reports",
    titleField: "title",
    fields: [
      { name: "title", kind: "requiredText", maxLength: 180 },
      { name: "report_type", kind: "text", maxLength: 140 },
      { name: "date_range_start", kind: "date" },
      { name: "date_range_end", kind: "date" },
      { name: "body_markdown", kind: "textarea", maxLength: 30000 }
    ]
  },
  ai_agent_runs: {
    table: "ai_agent_runs",
    path: "/app/agents",
    titleField: "agent_type",
    fields: [
      { name: "status", kind: "select", maxLength: 80 },
      { name: "error_message", kind: "textarea", maxLength: 2000 }
    ]
  },
  kpis: {
    table: "kpis",
    path: "/app/kpis",
    titleField: "name",
    fields: [
      { name: "name", kind: "requiredText", maxLength: 180 },
      { name: "category", kind: "text", maxLength: 100 },
      { name: "target", kind: "number" },
      { name: "actual_value", kind: "number" },
      { name: "metric_date", kind: "date" },
      { name: "owner", kind: "text", maxLength: 120 },
      { name: "notes", kind: "textarea", maxLength: 1500 },
      { name: "source", kind: "text", maxLength: 160 }
    ]
  },
  crm_leads: {
    table: "crm_leads",
    path: "/app/crm",
    titleField: "lead_name",
    fields: [
      { name: "lead_name", kind: "requiredText", maxLength: 180 },
      { name: "company", kind: "text", maxLength: 180 },
      { name: "email", kind: "text", maxLength: 220 },
      { name: "phone", kind: "text", maxLength: 80 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "estimated_value", kind: "number" },
      { name: "owner", kind: "text", maxLength: 120 },
      { name: "notes", kind: "textarea", maxLength: 2000 }
    ]
  },
  people: {
    table: "people",
    path: "/app/people",
    titleField: "full_name",
    fields: [
      { name: "full_name", kind: "requiredText", maxLength: 180 },
      { name: "email", kind: "text", maxLength: 220 },
      { name: "phone", kind: "text", maxLength: 80 },
      { name: "role_title", kind: "text", maxLength: 140 },
      { name: "department", kind: "text", maxLength: 140 },
      { name: "status", kind: "select", maxLength: 80 },
      { name: "start_date", kind: "date" },
      { name: "notes", kind: "textarea", maxLength: 2000 }
    ]
  },
  support_requests: {
    table: "support_requests",
    path: "/app/admin/support-requests",
    titleField: "issue_type",
    fields: [
      { name: "status", kind: "select", maxLength: 80 },
      { name: "priority", kind: "select", maxLength: 80 },
      { name: "message", kind: "textarea", maxLength: 5000 }
    ]
  }
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectionFromForm(formData: FormData): ManagedCollection {
  const collection = text(formData, "collection") as ManagedCollection;

  if (!collection || !COLLECTIONS[collection]) {
    redirectWithError("/app", "Record type is not supported.");
  }

  return collection;
}

function returnPath(formData: FormData, fallback: Route) {
  const value = text(formData, "return_path");
  return value.startsWith("/app") ? (value as Route) : fallback;
}

function redirectWithError(path: Route | string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(path: Route | string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}` as Route);
}

function friendlyMutationError(message: string | undefined, fallback: string) {
  const normalized = (message || "").toLowerCase();

  if (normalized.includes("row-level security") || normalized.includes("permission denied")) {
    return "You do not have permission to manage this record in the current workspace.";
  }

  if (normalized.includes("does not exist") && normalized.includes("column")) {
    return "This record type is missing the latest management fields. Apply the newest Supabase migration, then try again.";
  }

  if (normalized.includes("0 rows") || normalized.includes("no rows")) {
    return "Vaeroex could not find a matching record in this workspace.";
  }

  return fallback;
}

function dbClient(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
  return supabase as unknown as {
    from: (table: string) => {
      select: (columns?: string) => unknown;
      insert: (values: Record<string, unknown>) => unknown;
      update: (values: Record<string, unknown>) => unknown;
    };
  };
}

async function requireWorkspace(path: Route | string) {
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
    workspaceId: context.activeWorkspace.id
  };
}

async function validateFolder(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  workspaceId: string,
  collection: ManagedCollection,
  folderId: string,
  path: Route | string
) {
  if (!folderId) {
    return null;
  }

  const { data, error } = await supabase
    .from("record_folders")
    .select("id")
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .eq("collection_type", collection)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data) {
    redirectWithError(path, error?.message || "Folder not found for this workspace.");
  }

  return folderId;
}

function parsedFieldValue(field: EditableField, formData: FormData, path: Route | string) {
  const value = text(formData, field.name);

  if (field.kind === "checkbox") {
    return formData.get(field.name) === "on";
  }

  if (field.kind === "requiredText" && !value) {
    redirectWithError(path, `${field.name.replace(/_/g, " ")} is required.`);
  }

  if (field.maxLength && value.length > field.maxLength) {
    redirectWithError(path, `${field.name.replace(/_/g, " ")} must be ${field.maxLength} characters or fewer.`);
  }

  if (field.kind === "number") {
    if (!value) {
      return null;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      redirectWithError(path, `${field.name.replace(/_/g, " ")} must be a valid number.`);
    }

    return parsed;
  }

  if (field.kind === "date") {
    return value || null;
  }

  if (field.kind === "lines") {
    return lines(value) as Json;
  }

  return value || null;
}

function revalidateRelatedPaths(collection: ManagedCollection, path: Route | string) {
  revalidatePath(path);

  if (collection === "kpis" || collection === "files" || collection === "crm_leads") {
    revalidatePath("/app");
    revalidatePath("/app/reports");
  }
}

export async function createRecordFolderAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const folderName = text(formData, "folder_name");

  if (!folderName) {
    redirectWithError(path, "Folder name is required.");
  }

  const { error } = await supabase.from("record_folders").insert({
    workspace_id: workspaceId,
    collection_type: collection,
    name: folderName,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Folder created.");
}

export async function renameRecordFolderAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, workspaceId } = await requireWorkspace(path);
  const folderId = text(formData, "folder_id");
  const folderName = text(formData, "folder_name");

  if (!folderName) {
    redirectWithError(path, "Folder name is required.");
  }

  const { error } = await supabase
    .from("record_folders")
    .update({ name: folderName })
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .eq("collection_type", collection);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Folder renamed.");
}

export async function archiveRecordFolderAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, workspaceId } = await requireWorkspace(path);
  const folderId = text(formData, "folder_id");

  const { error } = await supabase
    .from("record_folders")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .eq("collection_type", collection);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Folder archived.");
}

export async function updateManagedRecordAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const recordId = text(formData, "record_id");
  const update: Record<string, unknown> = {};

  for (const field of config.fields) {
    update[field.name] = parsedFieldValue(field, formData, path);
  }

  const query = dbClient(supabase).from(config.table).update(update) as {
    eq: (column: string, value: string) => unknown;
  };
  const scopedQuery = query.eq("id", recordId) as {
    eq: (column: string, value: string) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await scopedQuery.eq("workspace_id", workspaceId).select("id").single();

  if (error || !data) {
    redirectWithError(path, friendlyMutationError(error?.message, "Record could not be updated. Refresh and try again."));
  }

  if (collection === "crm_leads") {
    const { error: historyError } = await supabase.from("crm_lead_history").insert({
      workspace_id: workspaceId,
      lead_id: recordId,
      event_type: "updated",
      status: typeof update.status === "string" ? update.status : null,
      estimated_value: typeof update.estimated_value === "number" ? update.estimated_value : null,
      owner: typeof update.owner === "string" ? update.owner : null,
      notes: typeof update.notes === "string" ? update.notes : null,
      raw_data_json: {
        source: "manual_edit",
        fields_changed: Object.keys(update)
      } satisfies Json,
      created_by: user.id
    });

    if (historyError) {
      redirectWithError(path, historyError.message);
    }
  }

  revalidateRelatedPaths(collection, path);
  redirectWithMessage(path, "Record updated.");
}

export async function manageRecordAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const recordId = text(formData, "record_id");
  const action = text(formData, "record_action");
  const now = new Date().toISOString();

  if (!recordId) {
    redirectWithError(path, "Record is required.");
  }

  if (action === "duplicate") {
    const selectQuery = dbClient(supabase).from(config.table).select("*") as {
      eq: (column: string, value: string) => unknown;
    };
    const workspaceQuery = selectQuery.eq("id", recordId) as { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } };
    const { data, error } = await workspaceQuery.eq("workspace_id", workspaceId).maybeSingle();

    if (error || !data) {
      redirectWithError(path, error?.message || "Record not found.");
    }

    const clone: Record<string, unknown> = { ...data };
    delete clone.id;
    delete clone.created_at;
    delete clone.updated_at;
    delete clone.archived_at;
    delete clone.deleted_at;

    if ("created_by" in clone) clone.created_by = user.id;
    if ("public_slug" in clone) clone.public_slug = null;
    if ("is_public" in clone) clone.is_public = false;
    if (config.titleField && typeof clone[config.titleField] === "string") {
      clone[config.titleField] = `${clone[config.titleField]} copy`;
    }

    const insertQuery = dbClient(supabase).from(config.table).insert(clone) as PromiseLike<{ error: { message: string } | null }>;
    const insertResult = await insertQuery;

    if (insertResult.error) {
      redirectWithError(path, insertResult.error.message);
    }

    revalidateRelatedPaths(collection, path);
    redirectWithMessage(path, "Record duplicated.");
  }

  const update: Record<string, unknown> = {};

  if (action === "archive") {
    update.archived_at = now;
  } else if (action === "delete") {
    update.deleted_at = now;
  } else if (action === "restore") {
    update.archived_at = null;
    update.deleted_at = null;
  } else if (action === "move") {
    update.folder_id = await validateFolder(supabase, workspaceId, collection, text(formData, "target_folder_id"), path);
  } else {
    redirectWithError(path, "Record action is not supported.");
  }

  const updateQuery = dbClient(supabase).from(config.table).update(update) as {
    eq: (column: string, value: string) => unknown;
  };
  const scopedQuery = updateQuery.eq("id", recordId) as {
    eq: (column: string, value: string) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await scopedQuery.eq("workspace_id", workspaceId).select("id").single();

  if (error || !data) {
    redirectWithError(path, friendlyMutationError(error?.message, "Record could not be changed. Refresh and try again."));
  }

  revalidateRelatedPaths(collection, path);
  redirectWithMessage(path, action === "delete" ? "Record deleted and removed from active records." : action === "archive" ? "Record archived and removed from active records." : "Record updated.");
}

export async function bulkManageRecordsAction(formData: FormData) {
  const collection = collectionFromForm(formData);
  const config = COLLECTIONS[collection];
  const path = returnPath(formData, config.path);
  const { supabase, workspaceId } = await requireWorkspace(path);
  const ids = formData.getAll("record_id").filter((value): value is string => typeof value === "string" && Boolean(value));
  const action = text(formData, "bulk_action");
  const now = new Date().toISOString();

  if (!ids.length) {
    redirectWithError(path, "Select at least one record.");
  }

  const update: Record<string, unknown> = {};

  if (action === "archive") {
    update.archived_at = now;
  } else if (action === "delete") {
    update.deleted_at = now;
  } else if (action === "restore") {
    update.archived_at = null;
    update.deleted_at = null;
  } else if (action === "move") {
    update.folder_id = await validateFolder(supabase, workspaceId, collection, text(formData, "target_folder_id"), path);
  } else {
    redirectWithError(path, "Choose a bulk action.");
  }

  const query = dbClient(supabase).from(config.table).update(update) as {
    in: (column: string, values: string[]) => unknown;
  };
  const idQuery = query.in("id", ids) as {
    eq: (column: string, value: string) => {
      select: (columns: string) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
    };
  };
  const { data, error } = await idQuery.eq("workspace_id", workspaceId).select("id");

  if (error || !data?.length) {
    redirectWithError(path, friendlyMutationError(error?.message, "Selected records could not be changed. Refresh and try again."));
  }

  revalidateRelatedPaths(collection, path);
  const actionLabel = action === "delete" ? "deleted and removed from active records" : action === "archive" ? "archived and removed from active records" : "updated";
  redirectWithMessage(path, `${data.length} record${data.length === 1 ? "" : "s"} ${actionLabel}.`);
}
