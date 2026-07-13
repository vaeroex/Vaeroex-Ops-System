"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import type { Json } from "@/lib/supabase/types";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(message: string): never {
  redirect(`/app/generated/new?error=${encodeURIComponent(message)}` as Route);
}

function parseJson(value: string): Json {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed as Json;
  } catch {
    return {};
  }
}

export async function saveGeneratedOutputToReportsAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const title = text(formData, "title") || "Generated Vaeroex output";
  const outputType = text(formData, "output_type") || "Generated Output";
  const bodyMarkdown = text(formData, "body_markdown");
  const sourceData = parseJson(text(formData, "source_data_json"));

  if (!bodyMarkdown) {
    redirectWithError("Vaeroex could not save an empty generated output.");
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
        toolName: "save_generated_output_briefing",
        args: {
          title,
          outputType,
          bodyMarkdown,
          sourceData
        },
        initiatedBy: "user",
        confirmationReceived: true,
        metadata: {
          source: "generated_output"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Generated output was blocked by Vaeroex security policy.");
  }

  const { error } = await supabase.from("reports").insert({
    workspace_id: workspaceId,
    report_type: outputType,
    title,
    body_markdown: bodyMarkdown,
    source_data_json: sourceData,
    created_by: user.id
  });

  if (error) {
    redirect(`/app/generated/new?error=${encodeURIComponent(error.message || "Generated output could not be saved.")}` as Route);
  }

  revalidatePath("/app/reports");
  redirect("/app/reports?message=Report saved." as Route);
}
