"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
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

function withoutRunMemory(metadata: Json, runIds: string[], removedAt: string): Json {
  const runIdSet = new Set(runIds);

  if (!isRecord(metadata)) {
    return {
      excluded_analysis_run_ids: runIds,
      latest_analysis_excluded_at: removedAt
    };
  }

  const next: JsonRecord = { ...metadata };
  const currentExcluded = Array.isArray(next.excluded_analysis_run_ids)
    ? next.excluded_analysis_run_ids.filter((item): item is string => typeof item === "string")
    : [];

  next.excluded_analysis_run_ids = Array.from(new Set([...runIds, ...currentExcluded]));
  next.latest_analysis_excluded_at = removedAt;

  if (isRecord(next.business_memory) && typeof next.business_memory.run_id === "string" && runIdSet.has(next.business_memory.run_id)) {
    delete next.business_memory;
  }

  if (Array.isArray(next.business_memory_history)) {
    next.business_memory_history = next.business_memory_history.filter((item) => !(isRecord(item) && typeof item.run_id === "string" && runIdSet.has(item.run_id)));
  }

  if (typeof next.latest_analysis_run_id === "string" && runIdSet.has(next.latest_analysis_run_id)) {
    next.latest_analysis_status = "excluded";
  }

  return next as Json;
}

async function deleteGeneratedInsights(runIds: string[], typedConfirmation?: string) {
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const uniqueRunIds = Array.from(new Set(runIds.map((id) => id.trim()).filter(Boolean))).slice(0, 25);

  if (!uniqueRunIds.length) {
    return { ok: false, deletedCount: 0, error: "Select at least one generated insight." };
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "delete_generated_insights",
        args: {
          runIds: uniqueRunIds,
          typedConfirmation: typedConfirmation === "DELETE" ? "DELETE" : undefined
        },
        initiatedBy: "user",
        confirmationReceived: true,
        metadata: {
          requested_count: uniqueRunIds.length,
          bulk: uniqueRunIds.length > 1
        } satisfies Json
      }
    );
  } catch (error) {
    return {
      ok: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : "Generated insight deletion was blocked by Vaeroex security policy."
    };
  }

  const { data: run, error: runError } = await supabase
    .from("ai_agent_runs")
    .select("*")
    .in("id", uniqueRunIds)
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "file_analysis");

  if (runError || !run?.length) {
    return { ok: false, deletedCount: 0, error: runError?.message || "Generated insights were not found in this workspace." };
  }

  const now = new Date().toISOString();
  const runs = run as VaeroexRunRow[];
  const genericSupabase = supabase as unknown as GenericSupabaseClient;

  for (const runId of uniqueRunIds) {
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
      return { ok: false, deletedCount: 0, error: `Generated insight could not be removed from Business Memory: ${chunkError.message}` };
    }
  }

  const runIdsByFileId = new Map<string, string[]>();
  runs.forEach((item) => {
    const fileId = runFileId(item);
    if (!fileId) return;
    runIdsByFileId.set(fileId, [...(runIdsByFileId.get(fileId) || []), item.id]);
  });

  for (const [fileId, fileRunIds] of runIdsByFileId) {
    const { data: file } = await supabase
      .from("file_uploads")
      .select("metadata_json")
      .eq("id", fileId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (file) {
      await supabase
        .from("file_uploads")
        .update({ metadata_json: withoutRunMemory(file.metadata_json, fileRunIds, now), updated_at: now })
        .eq("id", fileId)
        .eq("workspace_id", workspaceId);
    }
  }

  const runDelete = genericSupabase.from("ai_agent_runs").delete() as {
    in: (column: string, values: string[]) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const { error: deleteError } = await runDelete
    .in("id", runs.map((item) => item.id))
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "file_analysis");

  if (deleteError) {
    return { ok: false, deletedCount: 0, error: deleteError.message };
  }

  revalidatePath("/app/sources");
  revalidatePath("/app/files");
  revalidatePath("/app");
  revalidatePath("/app/intelligence");

  return { ok: true, deletedCount: runs.length, error: "" };
}

export async function deleteGeneratedInsightsAction(runIds: string[], typedConfirmation?: string) {
  return deleteGeneratedInsights(runIds, typedConfirmation);
}

export async function deleteGeneratedInsightAction(formData: FormData) {
  const returnPath = safeSourcesReturnPath(text(formData, "return_path") || "/app/sources#source-insights");
  const runId = text(formData, "run_id");
  const result = await deleteGeneratedInsights([runId]);

  if (!result.ok) {
    redirectWithError(returnPath, result.error || "Generated insight could not be deleted.");
  }

  redirectWithMessage(returnPath, "Deleted 1 insight.");
}
