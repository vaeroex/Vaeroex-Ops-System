"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
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

export async function saveGeneratedOutputToBriefingsAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspaceAccess();
  const title = text(formData, "title") || "Generated Vaeroex output";
  const outputType = text(formData, "output_type") || "Generated Output";
  const bodyMarkdown = text(formData, "body_markdown");
  const sourceData = parseJson(text(formData, "source_data_json"));

  if (!bodyMarkdown) {
    redirectWithError("Vaeroex could not save an empty generated output.");
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

  revalidatePath("/app/briefings");
  revalidatePath("/app/reports");
  redirect("/app/briefings?message=Generated output saved to Briefings." as Route);
}
