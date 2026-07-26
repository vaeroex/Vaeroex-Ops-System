"use server";

import { createHash } from "crypto";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  BUSINESS_NOTE_EXTRACTION_CONTRACT_ID,
  BUSINESS_NOTE_EXTRACTION_POLICY_ID,
  BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
  BUSINESS_NOTE_EXTRACTION_VALIDATOR_VERSION,
  BUSINESS_NOTE_MAX_CHARACTERS,
  BUSINESS_NOTE_TYPES,
  type BusinessNoteExtraction,
  type BusinessNoteReviewCorrections
} from "@/lib/ai/business-notes/contracts";
import { indexApprovedBusinessNote } from "@/lib/ai/business-notes/indexing";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { parseBusinessNoteUserAddedContext } from "@/lib/ai/business-notes/review-context";
import {
  businessNoteProviderAttemptTelemetry,
  generateBusinessNoteExtraction
} from "@/lib/ai/business-notes/service";
import {
  applyBusinessNoteReviewCorrections,
  businessNoteSourceSpans,
  validateBusinessNoteExtraction
} from "@/lib/ai/business-notes/validation";
import { enforceAIProviderRateLimits } from "@/lib/ai/provider-guardrails";
import { AIProviderExecutionError } from "@/lib/ai/providers/provider-manager";
import { isBusinessNoteExtractionEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { estimatedProviderCostCents, recordVaeroexAiUsage, type VaeroexTokenUsage } from "@/lib/ai/usage";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

type BusinessNoteRow = Database["public"]["Tables"]["business_notes"]["Row"];

const uuidSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(""));

function rawText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function trimmedText(formData: FormData, key: string) {
  return rawText(formData, key).trim();
}

function hashSource(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function noticeUrl(kind: "message" | "error", message: string) {
  return `/app/sources?${kind}=${encodeURIComponent(message)}#business-notes` as Route;
}

function listValue(value: string, maxItems: number) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))).slice(0, maxItems);
}

function safeFailureReason(error: unknown) {
  if (!(error instanceof AIProviderExecutionError)) return "provider_execution_failed";
  return error.attempts.at(-1)?.fallbackReason || "provider_execution_failed";
}

function failedUsage(error: unknown, latencyMs: number): VaeroexTokenUsage {
  const attempts = error instanceof AIProviderExecutionError ? error.attempts : [];
  const totals = attempts.reduce((sum, attempt) => ({
    inputTokens: sum.inputTokens + attempt.inputTokens,
    outputTokens: sum.outputTokens + attempt.outputTokens,
    totalTokens: sum.totalTokens + attempt.totalTokens
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const last = attempts.at(-1);
  return {
    ...totals,
    model: last?.runtimeModel || last?.model || "business-note-provider-unavailable",
    requestId: last?.requestId || null,
    latencyMs,
    status: "failed",
    metadata: {
      workflow: BUSINESS_NOTE_EXTRACTION_CONTRACT_ID,
      provider_policy_id: BUSINESS_NOTE_EXTRACTION_POLICY_ID,
      fallback_used: attempts.some((attempt) => attempt.fallback),
      provider_attempts: attempts.map(businessNoteProviderAttemptTelemetry),
      failure_reason: safeFailureReason(error)
    } satisfies Json
  };
}

export async function submitBusinessNoteForReviewAction(formData: FormData) {
  const originalNote = rawText(formData, "note_text");
  const observationDate = trimmedText(formData, "observation_date");
  if (!originalNote.trim()) redirect(noticeUrl("error", "Write or paste a Business Note before submitting it for review."));
  if (originalNote.length > BUSINESS_NOTE_MAX_CHARACTERS) {
    redirect(noticeUrl("error", `Direct Business Notes are limited to ${BUSINESS_NOTE_MAX_CHARACTERS.toLocaleString()} characters. Upload the document through Evidence instead.`));
  }
  if (!dateSchema.safeParse(observationDate).success) redirect(noticeUrl("error", "The observation date is invalid."));
  if (!isBusinessNoteExtractionEnabled()) {
    redirect(noticeUrl("error", "Business Notes extraction is not enabled in this environment."));
  }

  const { supabase, user, workspaceId } = await requireWorkspaceAccess();
  const releaseChannel = businessNoteReleaseChannel();
  const sourceTextHash = hashSource(originalNote);
  const { data: existing } = await supabase
    .from("business_notes")
    .select("id,status,extraction_json")
    .eq("workspace_id", workspaceId)
    .eq("release_channel", releaseChannel)
    .eq("source_text_hash", sourceTextHash)
    .eq("source_version", 1)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    if (existing.status === "rejected" && validateBusinessNoteExtraction(existing.extraction_json, originalNote).ok) {
      await supabase
        .from("business_notes")
        .update({ status: "review_required", failure_reason: null })
        .eq("workspace_id", workspaceId)
        .eq("id", existing.id);
    }
    const message = existing.status === "approved"
      ? "This unchanged Business Note is already approved."
      : "This unchanged Business Note already has extracted business context. Review the existing note below.";
    redirect(noticeUrl("message", message));
  }

  const usageLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "ai_runs_this_month"
  });
  if (!usageLimit.subscription.allowed) redirect(noticeUrl("error", "Subscription access is required for Business Notes extraction."));
  if (usageLimit.reached) redirect(noticeUrl("error", "This workspace has reached its monthly intelligence usage limit."));

  const rateClaim = await enforceRateLimit({
    action: "business_notes.extract",
    limit: 1,
    windowSeconds: 60,
    workspaceId,
    userId: user.id,
    identifiers: [sourceTextHash],
    requestHeaders: new Headers({ "x-real-ip": "business-notes" }),
    metadata: { workflow: BUSINESS_NOTE_EXTRACTION_CONTRACT_ID },
    strict: true
  }).catch(() => null);
  if (!rateClaim?.allowed) redirect(noticeUrl("error", "This Business Note is already being prepared. Try again shortly."));
  try {
    await enforceAIProviderRateLimits({ userId: user.id, workspaceId, operation: BUSINESS_NOTE_EXTRACTION_CONTRACT_ID });
  } catch {
    redirect(noticeUrl("error", "Business Note request limits could not be verified. Try again shortly."));
  }

  const { data: note, error: insertError } = await supabase
    .from("business_notes")
    .insert({
      workspace_id: workspaceId,
      author_user_id: user.id,
      original_note_text: originalNote,
      source_text_hash: sourceTextHash,
      source_version: 1,
      release_channel: releaseChannel,
      status: "extracting",
      evidence_lifecycle_status: "inactive",
      user_observation_date: observationDate || null,
      extraction_version: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
      validator_version: BUSINESS_NOTE_EXTRACTION_VALIDATOR_VERSION,
      policy_version: BUSINESS_NOTE_EXTRACTION_POLICY_ID
    })
    .select("*")
    .maybeSingle();
  if (insertError || !note) redirect(noticeUrl("error", "This Business Note could not be saved for review."));

  const startedAt = Date.now();
  try {
    const generated = await generateBusinessNoteExtraction({ supabase, workspaceId, originalNote, startedAtMs: startedAt });
    const extraction = generated.extraction;
    const spans = businessNoteSourceSpans(extraction, originalNote);
    const attempts = generated.attempts.map(businessNoteProviderAttemptTelemetry);
    const update = {
      status: "review_required" as const,
      extraction_json: extraction as unknown as Json,
      reviewed_extraction_json: {} as Json,
      source_spans_json: spans as unknown as Json,
      inferred_reporting_period_start: extraction.reportingPeriod.start,
      inferred_reporting_period_end: extraction.reportingPeriod.end,
      provider_name: generated.provider,
      model_used: generated.usage.model,
      fallback_used: generated.fallbackUsed,
      provider_attempts_json: attempts as unknown as Json,
      input_tokens: generated.usage.inputTokens,
      output_tokens: generated.usage.outputTokens,
      total_tokens: generated.usage.totalTokens,
      estimated_provider_cost_cents: estimatedProviderCostCents(generated.usage),
      latency_ms: generated.usage.latencyMs || Date.now() - startedAt,
      provider_request_id: generated.usage.requestId || null,
      failure_reason: null,
      retry_count: generated.fallbackUsed ? 1 : 0,
      extracted_at: new Date().toISOString()
    };
    const { error: updateError } = await supabase
      .from("business_notes")
      .update(update)
      .eq("workspace_id", workspaceId)
      .eq("id", note.id)
      .eq("status", "extracting");
    if (updateError) throw new Error("Business Note extraction could not be saved.");
    await recordVaeroexAiUsage({
      supabase,
      workspaceId,
      userId: user.id,
      agentType: BUSINESS_NOTE_EXTRACTION_CONTRACT_ID,
      usage: generated.usage
    });
  } catch (error) {
    const usage = failedUsage(error, Date.now() - startedAt);
    const attempts = error instanceof AIProviderExecutionError ? error.attempts : [];
    await supabase
      .from("business_notes")
      .update({
        status: "extraction_failed",
        provider_name: attempts.at(-1)?.provider || null,
        model_used: attempts.at(-1)?.runtimeModel || attempts.at(-1)?.model || null,
        fallback_used: attempts.some((attempt) => attempt.fallback),
        provider_attempts_json: attempts.map(businessNoteProviderAttemptTelemetry) as unknown as Json,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        estimated_provider_cost_cents: estimatedProviderCostCents(usage),
        latency_ms: usage.latencyMs || null,
        provider_request_id: usage.requestId || null,
        failure_reason: safeFailureReason(error),
        retry_count: attempts.some((attempt) => attempt.fallback) ? 1 : 0,
        extracted_at: new Date().toISOString()
      })
      .eq("workspace_id", workspaceId)
      .eq("id", note.id);
    await recordVaeroexAiUsage({ supabase, workspaceId, userId: user.id, agentType: BUSINESS_NOTE_EXTRACTION_CONTRACT_ID, usage });
    redirect(noticeUrl("error", "Business context could not be extracted safely. The original note was preserved, but it was not added to Evidence."));
  }

  revalidatePath("/app/sources");
  redirect(noticeUrl("message", "Business context has been extracted and is ready for evidence review."));
}

function parsedReviewCorrections(formData: FormData, extraction: BusinessNoteExtraction): BusinessNoteReviewCorrections {
  const title = trimmedText(formData, "title");
  const noteType = trimmedText(formData, "note_type");
  const start = trimmedText(formData, "reporting_period_start");
  const end = trimmedText(formData, "reporting_period_end");
  if (!title || title.length > 160) throw new Error("Enter a Business Note title of 160 characters or fewer.");
  if (!BUSINESS_NOTE_TYPES.includes(noteType as (typeof BUSINESS_NOTE_TYPES)[number])) throw new Error("Select a valid note type.");
  if (!dateSchema.safeParse(start).success || !dateSchema.safeParse(end).success || (start && end && start > end)) {
    throw new Error("Enter a valid reporting period.");
  }
  const removedItemPaths = formData.getAll("remove_item").filter((value): value is string => typeof value === "string");
  return {
    title,
    noteType: noteType as BusinessNoteReviewCorrections["noteType"],
    departments: listValue(rawText(formData, "departments"), 20),
    topics: listValue(rawText(formData, "topics"), 30),
    reportingPeriod: { start: start || null, end: end || null },
    removedItemPaths,
    userAddedContext: parseBusinessNoteUserAddedContext(formData, extraction)
  };
}

function extractedItemCount(extraction: BusinessNoteExtraction) {
  return extraction.peopleMentioned.length
    + extraction.customersMentioned.length
    + extraction.vendorsMentioned.length
    + extraction.projectsMentioned.length
    + extraction.explicitFacts.length
    + extraction.opinionsOrAssumptions.length
    + extraction.risks.length
    + extraction.opportunities.length
    + extraction.decisions.length
    + extraction.mentionedMetrics.length;
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function correctionCount(extraction: BusinessNoteExtraction, corrections: BusinessNoteReviewCorrections) {
  let count = corrections.removedItemPaths.length;
  if (corrections.title !== extraction.title) count += 1;
  if (corrections.noteType !== extraction.noteType) count += 1;
  if (!sameList(corrections.departments, extraction.departments)) count += 1;
  if (!sameList(corrections.topics, extraction.topics)) count += 1;
  if (corrections.reportingPeriod.start !== extraction.reportingPeriod.start) count += 1;
  if (corrections.reportingPeriod.end !== extraction.reportingPeriod.end) count += 1;
  return count;
}

export async function approveBusinessNoteAction(formData: FormData) {
  const noteId = trimmedText(formData, "note_id");
  if (!uuidSchema.safeParse(noteId).success) redirect(noticeUrl("error", "The Business Note could not be identified safely."));
  const { supabase, user, workspaceId, membership } = await requireWorkspaceAccess();
  const { data } = await supabase
    .from("business_notes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("release_channel", businessNoteReleaseChannel())
    .eq("id", noteId)
    .is("deleted_at", null)
    .maybeSingle();
  const note = data as BusinessNoteRow | null;
  if (!note || note.status !== "review_required") redirect(noticeUrl("error", "This Business Note is no longer available for review."));
  const canApproveNote = note.author_user_id === user.id || ["owner", "admin", "manager"].includes(membership.role);
  if (!canApproveNote) redirect(noticeUrl("error", "You do not have permission to approve this Business Note."));
  const validation = validateBusinessNoteExtraction(note.extraction_json, note.original_note_text);
  if (!validation.ok) redirect(noticeUrl("error", "The saved extraction could not be validated safely."));

  let corrections: BusinessNoteReviewCorrections;
  let reviewed: BusinessNoteExtraction;
  try {
    corrections = parsedReviewCorrections(formData, validation.value);
    reviewed = applyBusinessNoteReviewCorrections(validation.value, corrections);
  } catch (error) {
    redirect(noticeUrl("error", error instanceof Error ? error.message : "The Business Note review is invalid."));
  }
  if (reviewed.extractionDisposition !== "extractable" || extractedItemCount(reviewed) === 0) {
    redirect(noticeUrl("error", "Keep at least one source-grounded item before approving this note as Evidence."));
  }

  const admin = createSupabaseAdminClient();
  if (!admin) redirect(noticeUrl("error", "Business Note approval storage is temporarily unavailable."));
  const indexed = await indexApprovedBusinessNote({
    supabase: admin,
    workspaceId,
    note,
    extraction: reviewed,
    userAddedContext: corrections.userAddedContext,
    approvedBy: user.id
  });
  if (!indexed.indexedChunks || indexed.error) redirect(noticeUrl("error", "This Business Note could not be added to Evidence safely."));

  const approvedAt = new Date().toISOString();
  const { error: approvalError } = await admin
    .from("business_notes")
    .update({
      status: "approved",
      evidence_lifecycle_status: "active",
      reviewed_extraction_json: reviewed as unknown as Json,
      source_spans_json: businessNoteSourceSpans(reviewed, note.original_note_text) as unknown as Json,
      user_corrections_json: {
        userCorrections: {
          title: corrections.title,
          noteType: corrections.noteType,
          departments: corrections.departments,
          topics: corrections.topics,
          reportingPeriod: corrections.reportingPeriod,
          removedItemPaths: corrections.removedItemPaths
        },
        userAddedContext: corrections.userAddedContext,
        provenance: {
          originalNoteText: "business_notes.original_note_text",
          aiExtraction: "business_notes.extraction_json",
          userCorrections: "business_notes.user_corrections_json.userCorrections",
          userAddedContext: "business_notes.user_corrections_json.userAddedContext"
        },
        correction_count: correctionCount(validation.value, corrections)
      } as unknown as Json,
      user_reporting_period_start: corrections.reportingPeriod.start,
      user_reporting_period_end: corrections.reportingPeriod.end,
      approved_by: user.id,
      approved_at: approvedAt,
      failure_reason: null
    })
    .eq("workspace_id", workspaceId)
    .eq("id", note.id)
    .eq("status", "review_required");
  if (approvalError) redirect(noticeUrl("error", "The note remained outside active Evidence because approval could not be completed."));

  revalidatePath("/app/sources");
  revalidatePath("/app/intelligence");
  revalidatePath("/app");
  redirect(noticeUrl("message", indexed.embeddingWarning || "Business Note approved to Evidence as contextual information."));
}

export async function cancelBusinessNoteReviewAction(formData: FormData) {
  const noteId = trimmedText(formData, "note_id");
  if (!uuidSchema.safeParse(noteId).success) redirect(noticeUrl("error", "The Business Note could not be identified safely."));
  const { supabase, workspaceId } = await requireWorkspaceAccess();
  const { data, error } = await supabase
    .from("business_notes")
    .update({ status: "rejected", evidence_lifecycle_status: "inactive" })
    .eq("workspace_id", workspaceId)
    .eq("release_channel", businessNoteReleaseChannel())
    .eq("id", noteId)
    .eq("status", "review_required")
    .select("id")
    .maybeSingle();
  if (error || !data) redirect(noticeUrl("error", "This Business Note review could not be cancelled."));

  revalidatePath("/app/sources");
  redirect(noticeUrl("message", "Business Note review cancelled. The note was not added to Evidence."));
}
