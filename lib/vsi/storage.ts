import "server-only";

import { createHash } from "crypto";
import { updateVsiPrivateSummary } from "./summary";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import type { Database, Json } from "@/lib/supabase/types";
import type { VsiCitation } from "@/lib/vsi/types";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { businessNoteSourceSpans, validateBusinessNoteExtraction } from "@/lib/ai/business-notes/validation";
import type { BusinessNoteExtraction } from "@/lib/ai/business-notes/contracts";
import { isVsiRequestOriginAllowed } from "@/lib/vsi/request-boundary";
import { hasProhibitedVsiIdentifiers, VSI_PROHIBITED_INPUT_MESSAGE } from "@/lib/vsi/sensitive-input";

export class VsiHttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const vsiUuid = z.string().uuid();
export type ConversationRow = {
  id: string; workspace_id: string; actor_user_id: string; title: string; exchange_count: number;
  context_summary: string; parent_conversation_id: string | null; created_at: string; updated_at: string;
};
export type ExchangeRow = {
  id: string; workspace_id: string; actor_user_id: string; conversation_id: string;
  user_message: string; answer: string; citations: Json; public_research_topics?: Json; remember_proposal: Json | null; saved_note_id: string | null; created_at: string;
};
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type VsiDatabase = Database & { public: Database["public"] & {
  Tables: Database["public"]["Tables"] & { vsi_conversations: Table<ConversationRow>; vsi_exchanges: Table<ExchangeRow> };
  Functions: Database["public"]["Functions"] & { vsi_mutate_v1: { Args: { p_workspace_id: string; p_actor_user_id: string; p_action: string; p_input: Json }; Returns: Json } };
} };
export type VsiAccess = {
  supabase: SupabaseClient<Database>; workspaceId: string; userId: string; canEditBusinessNotes: boolean;
};

/** Bind every browser request to the workspace that rendered the page. */
export async function requireVsiAccess(request: Request, expectedWorkspaceId: unknown): Promise<VsiAccess> {
  if (!vsiUuid.safeParse(expectedWorkspaceId).success) throw new VsiHttpError(400, "workspace_required", "Reload this workspace before using Vaeroex.");
  if (request.method !== "GET") {
    if (!isVsiRequestOriginAllowed(request)) throw new VsiHttpError(403, "origin_denied", "This request did not come from Vaeroex.");
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new VsiHttpError(503, "storage_unavailable", "Chat storage is temporarily unavailable. Please try again.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new VsiHttpError(401, "authentication_required", "Sign in to continue this chat.");
  const context = await getWorkspaceContext(undefined, { supabase, user });
  if (!context.activeWorkspace || context.activeWorkspace.id !== expectedWorkspaceId || context.membership?.status !== "active") {
    throw new VsiHttpError(403, "workspace_changed", "Your active workspace changed or access ended. Reload before continuing.");
  }
  const subscription = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId: context.activeWorkspace.id });
  if (!subscription.allowed) throw new VsiHttpError(402, "subscription_required", "This workspace needs an active subscription to use Vaeroex.");
  return { supabase, workspaceId: context.activeWorkspace.id, userId: user.id,
    canEditBusinessNotes: ["owner", "admin", "manager", "staff"].includes(context.membership.role) };
}

export function conversationView(row: ConversationRow) {
  return { id: row.id, title: row.title, exchangeCount: row.exchange_count, createdAt: row.created_at, updatedAt: row.updated_at, parentConversationId: row.parent_conversation_id };
}
export function exchangeView(row: ExchangeRow) {
  return { id: row.id, userMessage: row.user_message, answer: row.answer, citations: row.citations as unknown as VsiCitation[],
    publicResearchTopics: Array.isArray(row.public_research_topics) ? row.public_research_topics.filter((term): term is string => typeof term === "string" && term.length <= 160).slice(0, 12) : [],
    createdAt: row.created_at, rememberProposal: row.remember_proposal as { title: string; content: string } | null, savedNoteId: row.saved_note_id };
}
export async function listVsiConversations(access: VsiAccess, before?: string | null) {
  const client = access.supabase as SupabaseClient<VsiDatabase>;
  let query = client.from("vsi_conversations").select("*").eq("workspace_id", access.workspaceId).eq("actor_user_id", access.userId);
  if (before) {
    try {
      if (before.length > 512) throw new Error("invalid_cursor");
      const cursor = z.object({ updatedAt: z.string().datetime({ offset: true }), id: vsiUuid }).strict().parse(JSON.parse(Buffer.from(before, "base64url").toString("utf8")));
      query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
    } catch { throw new VsiHttpError(400, "invalid_cursor", "Reload the chat history to continue."); }
  }
  const { data, error } = await query.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(101);
  if (error) throw new VsiHttpError(503, "storage_unavailable", "Saved chats are temporarily unavailable. Please try again.");
  const rows = data || [], page = rows.slice(0, 100), last = page.at(-1);
  return { conversations: page.map(conversationView), nextCursor: rows.length > 100 && last ? Buffer.from(JSON.stringify({ updatedAt: last.updated_at, id: last.id })).toString("base64url") : null };
}
export async function loadVsiConversation(access: VsiAccess, id: string) {
  if (!vsiUuid.safeParse(id).success) throw new VsiHttpError(404, "not_found", "This chat is unavailable in your active workspace.");
  const client = access.supabase as SupabaseClient<VsiDatabase>;
  const { data, error } = await client.from("vsi_conversations").select("*").eq("workspace_id", access.workspaceId).eq("actor_user_id", access.userId).eq("id", id).maybeSingle();
  if (error) throw new VsiHttpError(503, "storage_unavailable", "This chat could not be loaded. Please try again.");
  if (!data) throw new VsiHttpError(404, "not_found", "This chat is unavailable in your active workspace.");
  const { data: exchanges, error: exchangeError } = await client.from("vsi_exchanges").select("*").eq("workspace_id", access.workspaceId).eq("actor_user_id", access.userId).eq("conversation_id", id).order("created_at", { ascending: true }).limit(250);
  if (exchangeError) throw new VsiHttpError(503, "storage_unavailable", "This chat could not be loaded. Please try again.");
  return { row: data, conversation: conversationView(data), exchanges: (exchanges || []).map(exchangeView) };
}

const ERROR_MESSAGES: Record<string, [number, string]> = {
  in_progress: [409, "Another answer is still being prepared. Wait a moment, then retry this question."],
  workspace_busy: [429, "This workspace is preparing several answers. Please try again shortly; this question has not been counted."],
  daily_limit: [429, "You have reached 100 answered questions in the past 24 hours. Earlier questions will leave that window gradually."],
  burst_limit: [429, "Please wait a minute before sending another question."],
  workspace_budget: [429, "This workspace does not have enough monthly Vaeroex Super Intelligence budget left to safely start this answer. Research reserves its maximum cost, then charges only recorded usage. Ask a workspace owner to review the allowance."],
  thread_full: [409, "This chat has reached 250 exchanges. Continue in a new chat to keep talking."],
  thread_not_full: [409, "This chat can still accept questions. Start a separate new chat if you prefer."],
  idempotency_conflict: [409, "This retry does not match the original question. Start a new submission."],
  stale_attempt: [409, "This attempt expired. Please retry the same question."],
  note_archived: [409, "This note already exists but is archived or deleted. No new note was saved. Manage the existing note in Business Notes."],
  note_rejected: [409, "This note already exists and was rejected during review. No new note was saved. Edit and submit it again through Business Notes."],
  note_already_exists: [409, "This note already exists in Business Notes. No new note was saved. Open Business Notes to see its current status."],
};
export async function mutateVsi<T>(access: VsiAccess, action: string, input: Record<string, unknown> = {}): Promise<T> {
  const admin = createSupabaseAdminClient() as SupabaseClient<VsiDatabase> | null;
  if (!admin) throw new VsiHttpError(503, "storage_unavailable", "Chat storage is temporarily unavailable. Please try again.");
  const { data, error } = await admin.rpc("vsi_mutate_v1", { p_workspace_id: access.workspaceId, p_actor_user_id: access.userId, p_action: action, p_input: input as Json });
  if (error) {
    if (error.code === "42501") throw new VsiHttpError(403, "access_denied", "Your access to this workspace or action has changed. Nothing was saved.");
    console.error("[vsi-storage]", { action, code: error.code });
    throw new VsiHttpError(503, "storage_unavailable", "Vaeroex could not save this change. Please retry; the same question will not be counted twice.");
  }
  const result = data as unknown as { error?: string };
  if (result?.error) {
    const [status, message] = ERROR_MESSAGES[result.error] || [503, "This request could not finish. Please retry."];
    throw new VsiHttpError(status, result.error, message);
  }
  return data as unknown as T;
}

export function questionHash(question: string) { return createHash("sha256").update(question).digest("hex"); }

/** Only user-authored conversation context is compacted. Historical answers require
 * their source permissions to be rechecked by the research/history layer. */
export function updateVsiSummary(previous: string, question: string, answer: string) {
  void answer;
  return updateVsiPrivateSummary(previous, question);
}

export async function confirmVsiNote(access: VsiAccess, conversationId: string, exchangeId: string) {
  if (!access.canEditBusinessNotes) throw new VsiHttpError(403, "note_permission", "You do not have permission to create Business Notes. This note was not saved.");
  const chat = await loadVsiConversation(access, conversationId);
  const exchange = chat.exchanges.find((item) => item.id === exchangeId);
  if (!exchange?.rememberProposal) throw new VsiHttpError(404, "proposal_missing", "This note proposal is no longer available.");
  const { content, title } = exchange.rememberProposal;
  if (hasProhibitedVsiIdentifiers(`${title}\n${content}`)) throw new VsiHttpError(422, "prohibited_identifiers", VSI_PROHIBITED_INPUT_MESSAGE);
  // The proposal is a user-authorized note, never an independently verified fact.
  const statements = content.match(/[\s\S]{1,220}/g) || [];
  const extraction: BusinessNoteExtraction = {
    schemaVersion: "business_note_extraction_v1", extractionDisposition: "extractable", title: title.slice(0, 160), summary: content.slice(0, 800),
    noteType: "observation", sourceClassification: "general_business_note", departments: [], topics: [], peopleMentioned: [], customersMentioned: [], vendorsMentioned: [], projectsMentioned: [],
    explicitFacts: [], opinionsOrAssumptions: statements.map((statement) => ({ statement, sourceQuote: statement, confidence: 0.5 })),
    risks: [], opportunities: [], decisions: [], mentionedMetrics: [], reportingPeriod: { start: null, end: null, inferred: false, sourceQuote: null },
    evidenceTreatment: "context_only", extractionConfidence: 0.5, missingContext: ["Confirm this author-provided context before approving it for business answers."]
  };
  const validated = validateBusinessNoteExtraction(extraction, content);
  if (!validated.ok) throw new VsiHttpError(422, "note_review_required", "This note needs to be entered and reviewed in Business Notes. It has not been saved.");
  return mutateVsi<{ noteId: string }>(access, "remember", { conversationId, exchangeId, content, sourceHash: questionHash(content),
    releaseChannel: businessNoteReleaseChannel(), extraction: validated.value, spans: businessNoteSourceSpans(validated.value, content) });
}
