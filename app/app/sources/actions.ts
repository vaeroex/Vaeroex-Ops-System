"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import type { Database, Json } from "@/lib/supabase/types";

type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type JsonRecord = Record<string, unknown>;

type GenericSupabaseClient = {
  from: (table: string) => {
    select: (columns?: string) => unknown;
    update: (values: Record<string, unknown>) => unknown;
    delete: () => unknown;
  };
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeSourcesReturnPath(value: string) {
  return value.startsWith("/app/sources") ? (value as Route) : ("/app/sources#source-insights" as Route);
}

function pathWithNotice(path: Route, key: "error" | "message", message: string) {
  const [base, hash] = path.split("#");
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${key}=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}` as Route;
}

function redirectWithError(path: Route, message: string): never {
  redirect(pathWithNotice(path, "error", message));
}

function redirectWithMessage(path: Route, message: string): never {
  redirect(pathWithNotice(path, "message", message));
}

function runFileId(run: VaeroexRunRow) {
  const input = isRecord(run.input_json) ? run.input_json : {};
  const extraInputs = isRecord(input.extra_inputs) ? input.extra_inputs : {};
  const file = isRecord(extraInputs.file) ? extraInputs.file : {};
  return typeof file.id === "string" ? file.id : "";
}

function withoutRunMemory(metadata: Json, runId: string, removedAt: string): Json {
  if (!isRecord(metadata)) {
    return {
      excluded_analysis_run_ids: [runId],
      latest_analysis_excluded_at: removedAt
    };
  }

  const next: JsonRecord = { ...metadata };
  const currentExcluded = Array.isArray(next.excluded_analysis_run_ids)
    ? next.excluded_analysis_run_ids.filter((item): item is string => typeof item === "string")
    : [];

  next.excluded_analysis_run_ids = Array.from(new Set([runId, ...currentExcluded]));
  next.latest_analysis_excluded_at = removedAt;

  if (isRecord(next.business_memory) && next.business_memory.run_id === runId) {
    delete next.business_memory;
  }

  if (Array.isArray(next.business_memory_history)) {
    next.business_memory_history = next.business_memory_history.filter((item) => !(isRecord(item) && item.run_id === runId));
  }

  if (next.latest_analysis_run_id === runId) {
    next.latest_analysis_status = "excluded";
  }

  return next as Json;
}

export async function deleteGeneratedInsightAction(formData: FormData) {
  const returnPath = safeSourcesReturnPath(text(formData, "return_path") || "/app/sources#source-insights");
  const runId = text(formData, "run_id");

  if (!runId) {
    redirectWithError(returnPath, "Generated insight is required.");
  }

  const { supabase, workspaceId } = await requireWorkspaceAccess();
  const { data: run, error: runError } = await supabase
    .from("ai_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "file_analysis")
    .maybeSingle();

  if (runError || !run) {
    redirectWithError(returnPath, runError?.message || "Generated insight was not found in this workspace.");
  }

  const now = new Date().toISOString();
  const fileId = runFileId(run as VaeroexRunRow);
  const genericSupabase = supabase as unknown as GenericSupabaseClient;

  const chunkUpdate = genericSupabase.from("business_memory_chunks").update({
    deleted_at: now,
    archived_at: now,
    updated_at: now
  }) as {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        contains: (column: string, value: Record<string, unknown>) => {
          select: (columns: string) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>;
        };
      };
    };
  };

  const { error: chunkError } = await chunkUpdate
    .eq("workspace_id", workspaceId)
    .eq("source_type", "file_analysis")
    .contains("source_metadata", { run_id: runId })
    .select("id");

  if (chunkError) {
    redirectWithError(returnPath, `Generated insight could not be removed from Business Memory: ${chunkError.message}`);
  }

  if (fileId) {
    const { data: file } = await supabase
      .from("file_uploads")
      .select("metadata_json")
      .eq("id", fileId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (file) {
      await supabase
        .from("file_uploads")
        .update({ metadata_json: withoutRunMemory(file.metadata_json, runId, now), updated_at: now })
        .eq("id", fileId)
        .eq("workspace_id", workspaceId);
    }
  }

  const runDelete = genericSupabase.from("ai_agent_runs").delete() as {
    eq: (column: string, value: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const { error: deleteError } = await runDelete
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "file_analysis");

  if (deleteError) {
    redirectWithError(returnPath, deleteError.message);
  }

  revalidatePath("/app/sources");
  revalidatePath("/app/files");
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  redirectWithMessage(returnPath, "Generated insight deleted and removed from future Vaeroex answers.");
}
