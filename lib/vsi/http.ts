import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { readVsiJson } from "@/lib/vsi/request-boundary";
import { hasProhibitedVsiIdentifiers, VSI_PROHIBITED_INPUT_MESSAGE } from "@/lib/vsi/sensitive-input";
import { getVsiConfig } from "@/lib/vsi/config";
import { runVsiAnswer, VsiEngineError } from "@/lib/vsi/engine";
import { confirmVsiNote, conversationView, listVsiConversations, loadVsiConversation, mutateVsi, questionHash, requireVsiAccess, updateVsiSummary, VsiHttpError, vsiUuid, type ConversationRow } from "@/lib/vsi/storage";

type RouteAction = "list" | "create" | "detail" | "rename" | "delete" | "messages" | "continue" | "remember" | "usage";
const base = z.object({ expectedWorkspaceId: vsiUuid });
const NO_STORE = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: NO_STORE }); }

export async function vsiRoute(request: Request, action: RouteAction, conversationId?: string) {
  let workspaceId: string | undefined;
  try {
    // A small bounded JSON body also rejects attachment payloads.
    let raw: unknown = {};
    if (request.method !== "GET") {
      if (!request.headers.get("content-type")?.includes("application/json")) throw new VsiHttpError(415, "json_required", "Send a text question using the chat composer.");
      try { raw = await readVsiJson(request); } catch (error) {
        if (error instanceof RangeError) throw new VsiHttpError(413, "request_too_large", "This message is too long. Please shorten it.");
        throw new VsiHttpError(400, "invalid_request", "This request could not be read. Please try again.");
      }
    }
    const expectedWorkspaceId = request.method === "GET" ? new URL(request.url).searchParams.get("workspaceId") : base.parse(raw).expectedWorkspaceId;
    const access = await requireVsiAccess(request, expectedWorkspaceId);
    workspaceId = access.workspaceId;
    const common = { workspaceId, canEditBusinessNotes: access.canEditBusinessNotes };
    if (request.method !== "GET") {
      const rate = await enforceRateLimit({ action: action === "messages" ? "vsi.questions" : "vsi.manage", limit: action === "messages" ? 10 : 60,
        windowSeconds: 60, userId: access.userId, requestHeaders: request.headers, strict: true });
      if (!rate.allowed) throw new VsiHttpError(429, "burst_limit", rateLimitMessage(rate));
    }
    if (action === "list") return json({ ...common, ...await listVsiConversations(access, new URL(request.url).searchParams.get("before")) });
    if (action === "usage") {
      const usage = await mutateVsi<{ used: number; resetsAt: string | null; spentUsd: number; reservedUsd: number; periodStart: string }>(access, "usage");
      return json({ workspaceId, used: usage.used, limit: 100, remaining: Math.max(0, 100 - usage.used), resetsAt: usage.resetsAt,
        workspaceBudget: { limitUsd: getVsiConfig().workspaceMonthlyBudgetUsd, spentUsd: usage.spentUsd, reservedUsd: usage.reservedUsd, periodStart: usage.periodStart } });
    }
    if (action === "create") {
      const input = base.extend({ title: z.string().trim().min(1).max(120).optional() }).strict().parse(raw);
      if (input.title && hasProhibitedVsiIdentifiers(input.title)) throw new VsiHttpError(422, "prohibited_identifiers", VSI_PROHIBITED_INPUT_MESSAGE);
      return json({ ...common, conversation: conversationView(await mutateVsi<ConversationRow>(access, "create", { title: input.title })) }, 201);
    }
    if (!conversationId || !vsiUuid.safeParse(conversationId).success) throw new VsiHttpError(404, "not_found", "This chat is unavailable.");
    if (action === "detail") {
      const chat = await loadVsiConversation(access, conversationId);
      return json({ ...common, conversation: chat.conversation, exchanges: chat.exchanges });
    }
    if (action === "rename") {
      const input = base.extend({ title: z.string().trim().min(1).max(120) }).strict().parse(raw);
      if (hasProhibitedVsiIdentifiers(input.title)) throw new VsiHttpError(422, "prohibited_identifiers", VSI_PROHIBITED_INPUT_MESSAGE);
      return json({ ...common, conversation: conversationView(await mutateVsi<ConversationRow>(access, "rename", { conversationId, title: input.title })) });
    }
    if (action === "delete") {
      base.strict().parse(raw);
      await mutateVsi(access, "delete", { conversationId });
      return json({ workspaceId, deleted: true });
    }
    if (action === "continue") {
      base.strict().parse(raw);
      return json({ ...common, conversation: conversationView(await mutateVsi<ConversationRow>(access, "continue", { conversationId })) });
    }
    if (action === "remember") {
      const input = base.extend({ exchangeId: vsiUuid, confirm: z.literal(true) }).strict().parse(raw);
      return json({ workspaceId, ...await confirmVsiNote(access, conversationId, input.exchangeId) });
    }
    const config = getVsiConfig();
    const input = base.extend({ message: z.string().trim().min(1).max(config.maxQuestionChars), requestId: vsiUuid }).strict().parse(raw);
    if (hasProhibitedVsiIdentifiers(input.message)) throw new VsiHttpError(422, "prohibited_identifiers", VSI_PROHIBITED_INPUT_MESSAGE);
    const chat = await loadVsiConversation(access, conversationId);
    // A continued chat may reuse a small, permission-checked context window
    // from its original transcript. No names are inferred from a prose summary.
    let inheritedExchanges: typeof chat.exchanges = [];
    if (chat.row.parent_conversation_id && chat.exchanges.length < 4) {
      try { inheritedExchanges = (await loadVsiConversation(access, chat.row.parent_conversation_id)).exchanges.slice(-4); }
      catch (error) { if (!(error instanceof VsiHttpError && error.status === 404)) throw error; }
    }
    const claim = await mutateVsi<{ state: "reserved" | "completed"; request: { id: string; attempt: number } }>(access, "reserve", {
      conversationId, requestId: input.requestId, questionHash: questionHash(input.message), reserveUsd: config.requestReserveUsd, monthlyBudgetUsd: config.workspaceMonthlyBudgetUsd
    });
    if (claim.state === "completed") {
      const saved = await loadVsiConversation(access, conversationId);
      const exchange = saved.exchanges.find((item) => item.id === claim.request.id);
      if (!exchange) throw new VsiHttpError(404, "not_found", "This chat has been deleted. Start a new chat.");
      return json({ ...common, conversation: saved.conversation, exchange, replayed: true });
    }
    let generated;
    try {
      generated = await runVsiAnswer({ supabase: access.supabase, workspaceId, actorUserId: access.userId, question: input.message,
        recentMessages: [...inheritedExchanges, ...chat.exchanges].flatMap((item) => [
          { role: "user" as const, content: item.userMessage },
          { role: "assistant" as const, content: item.answer, citations: item.citations, publicResearchTopics: item.publicResearchTopics }
        ]), contextSummary: chat.row.context_summary, requestId: input.requestId });
    } catch (error) {
      const engineError = error instanceof VsiEngineError ? error : null;
      const uncertainCost = !engineError || engineError.accountingUncertain || engineError.usage.costEstimated === true;
      const usage = { ...engineError?.usage, estimatedCostUsd: uncertainCost ? config.requestReserveUsd : engineError.usage.estimatedCostUsd,
        failed: true, costEstimated: uncertainCost };
      await mutateVsi(access, "settle", { conversationId, id: claim.request.id, attempt: claim.request.attempt, usage });
      if (engineError) throw new VsiHttpError(503, "answer_unavailable", engineError.message);
      throw new VsiHttpError(503, "answer_unavailable", "Vaeroex could not complete this answer. Please retry; this question was not counted.");
    }
    await mutateVsi(access, "settle", { conversationId, id: claim.request.id, attempt: claim.request.attempt, question: input.message, answer: generated.content,
      citations: generated.citations, publicResearchTopics: generated.publicResearchTopics || [], rememberProposal: generated.noteDraft || null, usage: generated.usage,
      summary: updateVsiSummary(chat.row.context_summary, input.message, generated.content) });
    const saved = await loadVsiConversation(access, conversationId);
    return json({ ...common, conversation: saved.conversation, exchange: saved.exchanges.find((item) => item.id === claim.request.id) });
  } catch (error) {
    if (error instanceof VsiHttpError) return json({ workspaceId, error: error.message, code: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ workspaceId, error: "Check your message and try again. Chat accepts text only.", code: "invalid_request" }, 400);
    console.error("[vsi-api]", { action, failure: error instanceof Error ? error.name : "unknown" });
    return json({ workspaceId, error: "Vaeroex is temporarily unavailable. Please try again.", code: "unavailable" }, 503);
  }
}
