"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Exchange } from "@/components/vsi/Exchange";
import { displayDate, type VsiChat, type VsiExchange, type VsiUsageView } from "@/components/vsi/contracts";

type Props = { workspaceId: string; workspaceName: string; userId: string; initialConversationId?: string; initialPrompt?: string };
type ChatResponse = { workspaceId: string; conversation: VsiChat; exchanges?: VsiExchange[]; exchange?: VsiExchange; canEditBusinessNotes?: boolean };
type FailedQuestion = { conversationId: string; message: string; requestId: string };
const button = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50";
class RequestError extends Error {
  constructor(message: string, readonly accessLost = false, readonly code = "") { super(message); }
}

export function VsiWorkspace({ workspaceId, workspaceName, userId, initialConversationId = "", initialPrompt = "" }: Props) {
  const [chats, setChats] = useState<VsiChat[]>([]), [chat, setChat] = useState<VsiChat | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<VsiExchange[]>([]), [message, setMessage] = useState(initialPrompt);
  const [pending, setPending] = useState<string | null>("history"), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [accessLost, setAccessLost] = useState(false), [canEditNotes, setCanEditNotes] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<FailedQuestion | null>(null);
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState(""), [deleting, setDeleting] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false), [usage, setUsage] = useState<VsiUsageView | null>(null);
  const controllers = useRef(new Set<AbortController>()), mounted = useRef(true), operation = useRef(false);
  const ownedNavigation = useRef<string | null>(null), viewEpoch = useRef(0);
  const composer = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);

  const request = useCallback(async <T,>(path: string, options?: { method: string; body?: Record<string, unknown> }): Promise<T> => {
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 110_000);
    try {
      const response = await fetch(`/api/vsi${path}${options ? "" : `${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}`}`, {
        method: options?.method || "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        ...(options ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...options.body, expectedWorkspaceId: workspaceId }) } : {})
      });
      const body = await response.json().catch(() => ({}));
      const lost = response.status === 401 || response.status === 403 || ["workspace_mismatch", "workspace_changed", "workspace_access_changed"].includes(body.code);
      if (!response.ok) throw new RequestError(body.message || (typeof body.error === "string" ? body.error : "Vaeroex could not complete this request. Please try again."), lost, typeof body.code === "string" ? body.code : "");
      if (body.workspaceId !== workspaceId) throw new RequestError("Your active workspace changed. Reload to continue safely.", true);
      return body as T;
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") throw new RequestError("This request took too long. Retry to check for the saved answer without counting the question twice.");
      throw caught;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  }, [workspaceId]);

  const reportError = useCallback((caught: unknown) => {
    if (!mounted.current) return;
    setError(caught instanceof Error ? caught.message : "Vaeroex is temporarily unavailable. Please try again.");
    if (caught instanceof RequestError && caught.accessLost) {
      setAccessLost(true); setHistoryCursor(null); setChat(null); setExchanges([]); setChats([]); setMessage(""); setFailedQuestion(null); setUsage(null);
      for (const controller of controllers.current) controller.abort();
    }
  }, []);

  function rememberChat(next: VsiChat, publishUrl = true) {
    setChat(next); setChats((previous) => [next, ...previous.filter((item) => item.id !== next.id)]);
    if (!publishUrl) return;
    ownedNavigation.current = next.id;
    const url = new URL(window.location.href); url.search = ""; url.searchParams.set("chat", next.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => { mounted.current = false; for (const controller of activeControllers) controller.abort(); };
  }, [workspaceId, userId]);

  useEffect(() => {
    // Next integrates native history updates with searchParams. Our own URL
    // updates must not tear down the active send or reload its saved transcript.
    if (ownedNavigation.current === initialConversationId) { ownedNavigation.current = null; return; }
    viewEpoch.current += 1;
    operation.current = false;
    for (const controller of controllers.current) controller.abort();
    setPending("history"); setChat(null); setExchanges([]); setFailedQuestion(null);
    let active = true;
    async function load() {
      try {
        const history = await request<{ workspaceId: string; conversations: VsiChat[]; canEditBusinessNotes: boolean; nextCursor?: string | null }>("/conversations");
        if (!active) return;
        setChats(history.conversations); setHistoryCursor(history.nextCursor || null); setCanEditNotes(history.canEditBusinessNotes);
        if (initialConversationId) {
          const detail = await request<ChatResponse>(`/conversations/${encodeURIComponent(initialConversationId)}`);
          if (!active) return;
          setChat(detail.conversation); setExchanges(detail.exchanges || []); setCanEditNotes(Boolean(detail.canEditBusinessNotes));
        }
      } catch (caught) { if (active) reportError(caught); }
      finally { if (active) setPending(null); }
    }
    void load();
    return () => { active = false; };
  }, [initialConversationId, request, reportError, userId]);

  useEffect(() => {
    if (pending === "answer" || notice === "Answer saved.") end.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [pending, notice]);

  async function run(kind: string, action: (epoch: number) => Promise<void>) {
    if (operation.current || accessLost) return;
    const epoch = viewEpoch.current;
    operation.current = true; setPending(kind); setError(""); setNotice("");
    try { await action(epoch); } catch (caught) { if (epoch === viewEpoch.current) reportError(caught); }
    finally { if (epoch === viewEpoch.current) { operation.current = false; if (mounted.current) setPending(null); } }
  }

  async function openChat(id: string) {
    await run("load", async (epoch) => {
      const detail = await request<ChatResponse>(`/conversations/${encodeURIComponent(id)}`);
      if (!mounted.current || epoch !== viewEpoch.current) return;
      rememberChat(detail.conversation); setExchanges(detail.exchanges || []); setMessage(""); setFailedQuestion(null);
      setCanEditNotes(Boolean(detail.canEditBusinessNotes)); setRenaming(false); setDeleting(false);
    });
  }

  async function loadOlderChats() {
    if (!historyCursor) return;
    await run("older", async (epoch) => {
      const history = await request<{ workspaceId: string; conversations: VsiChat[]; nextCursor: string | null }>(`/conversations?before=${encodeURIComponent(historyCursor)}`);
      if (!mounted.current || epoch !== viewEpoch.current) return;
      setChats((previous) => [...previous, ...history.conversations.filter((entry) => !previous.some((existing) => existing.id === entry.id))]);
      setHistoryCursor(history.nextCursor);
    });
  }

  function newChat() {
    if (pending || accessLost) return;
    setChat(null); setExchanges([]); setMessage(""); setFailedQuestion(null); setError(""); setNotice(""); setRenaming(false); setDeleting(false);
    ownedNavigation.current = ""; window.history.replaceState(null, "", window.location.pathname); composer.current?.focus();
  }

  async function send(retry?: FailedQuestion) {
    const text = (retry?.message || message).trim();
    if (!text || pending || accessLost || (chat?.exchangeCount || 0) >= 250) return;
    const question = retry || { conversationId: chat?.id || "", message: text, requestId: crypto.randomUUID() };
    await run("answer", async (epoch) => {
      try {
        if (!question.conversationId) {
          const created = await request<ChatResponse>("/conversations", { method: "POST" });
          if (!mounted.current || epoch !== viewEpoch.current) return;
          question.conversationId = created.conversation.id; rememberChat(created.conversation, false);
        }
        setFailedQuestion(question); setMessage("");
        const result = await request<ChatResponse>(`/conversations/${question.conversationId}/messages`, { method: "POST", body: { message: question.message, requestId: question.requestId } });
        if (!mounted.current || epoch !== viewEpoch.current) return;
        if (!result.exchange) throw new RequestError("The saved answer was unavailable. Retry this question to retrieve it.");
        const exchange = result.exchange;
        rememberChat(result.conversation); setExchanges((previous) => [...previous.filter((entry) => entry.id !== exchange.id), exchange]);
        setFailedQuestion(null); setNotice("Answer saved."); setUsage(null); composer.current?.focus();
      } catch (caught) {
        if (caught instanceof RequestError && caught.code === "thread_full") {
          const latest = await request<ChatResponse>(`/conversations/${question.conversationId}`);
          if (mounted.current && epoch === viewEpoch.current) {
            rememberChat(latest.conversation); setExchanges(latest.exchanges || []);
            setFailedQuestion(null); setMessage(question.message);
          }
        } else if (mounted.current && epoch === viewEpoch.current && question.conversationId) setFailedQuestion(question);
        throw caught;
      }
    });
  }

  async function saveNote(exchangeId: string) {
    if (!chat) return;
    await run(`remember:${exchangeId}`, async (epoch) => {
      const saved = await request<{ workspaceId: string; noteId: string }>(`/conversations/${chat.id}/remember`, { method: "POST", body: { exchangeId, confirm: true } });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      setExchanges((previous) => previous.map((entry) => entry.id === exchangeId ? { ...entry, savedNoteId: saved.noteId } : entry));
      setNotice("Business Note saved for review. Review it in Files & Notes before it becomes Business Memory.");
    });
  }

  async function continueChat() {
    if (!chat) return;
    await run("continue", async (epoch) => {
      const created = await request<ChatResponse>(`/conversations/${chat.id}/continue`, { method: "POST" });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      rememberChat(created.conversation); setExchanges(created.exchanges || []); setFailedQuestion(null);
      setNotice("New chat ready with a concise summary of the previous conversation."); composer.current?.focus();
    });
  }

  async function rename(event: FormEvent) {
    event.preventDefault(); if (!chat || !title.trim()) return;
    await run("rename", async (epoch) => {
      const saved = await request<ChatResponse>(`/conversations/${chat.id}`, { method: "PATCH", body: { title: title.trim() } });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      rememberChat(saved.conversation); setRenaming(false); setNotice("Chat renamed.");
    });
  }

  async function deleteChat() {
    if (!chat) return;
    await run("delete", async (epoch) => {
      await request(`/conversations/${chat.id}`, { method: "DELETE" });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      setChats((previous) => previous.filter((entry) => entry.id !== chat.id)); setChat(null); setExchanges([]); setMessage(""); setFailedQuestion(null);
      setDeleting(false); setRenaming(false); setNotice("Chat deleted."); ownedNavigation.current = ""; window.history.replaceState(null, "", window.location.pathname);
    });
  }

  async function showUsage() {
    if (usageOpen) { setUsageOpen(false); return; }
    setUsageOpen(true);
    await run("usage", async (epoch) => { const result = await request<VsiUsageView & { workspaceId: string }>("/usage"); if (mounted.current && epoch === viewEpoch.current) setUsage(result); });
  }

  const readOnly = (chat?.exchangeCount || 0) >= 250, disabled = Boolean(pending) || accessLost;
  return <div className="workspace-vsi space-y-4" data-vsi-workspace={workspaceId}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Vaeroex Super Intelligence</h1><p className="mt-1 text-sm leading-6 text-slate-600">Ask anything. Grounded in your business when it matters.</p></div>
      <button type="button" onClick={showUsage} disabled={disabled} aria-expanded={usageOpen} aria-controls="vsi-usage" className={button}>Usage</button>
    </header>
    {usageOpen ? <section id="vsi-usage" aria-label="VSI usage" className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
      {usage ? <><p><strong>{usage.used} of {usage.limit} questions</strong> answered in your rolling 24-hour window. {usage.remaining} available within that ceiling.</p><p>Workspace spending protections also apply and can pause use earlier.</p>{usage.resetsAt ? <p>Your oldest counted question leaves this window after {displayDate(usage.resetsAt, true)}.</p> : null}{usage.workspaceBudget ? <p>Workspace this month: ${usage.workspaceBudget.spentUsd.toFixed(2)} used of ${usage.workspaceBudget.limitUsd.toFixed(2)}.</p> : null}</> : <p>{pending === "usage" ? "Checking usage…" : "Usage is unavailable. Close this panel and try again."}</p>}
    </section> : null}
    <details className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Business Context <span className="ml-1 font-normal text-slate-500">(optional)</span></summary>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">For more useful business answers, describe what you sell, your locations, customers, goals, and other relevant context in Business Notes. Approved notes become available through Business Memory. Your ordinary conversations stay private and do not become shared business facts.</p>
      <Link href="/app/sources#business-notes" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline">{canEditNotes ? "Add or manage Business Notes" : "View Business Notes"}</Link>
      <p className="text-xs leading-5 text-slate-500">Use Files &amp; Notes for file uploads. Chat accepts text only.</p>
    </details>
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"><p>{error}</p>{accessLost ? <button type="button" onClick={() => window.location.assign("/app/si")} className="mt-2 min-h-11 font-semibold underline">Reload your active workspace</button> : null}</div> : null}
    <p role="status" aria-live="polite" className={notice ? "text-sm leading-6 text-slate-600" : "sr-only"}>{notice}</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border border-slate-200 bg-white p-3" aria-label="Private chat history">
        <button type="button" onClick={newChat} disabled={disabled} className={`${button} w-full`}>New chat</button>
        <details className="mt-3" open><summary className="cursor-pointer text-sm font-semibold text-slate-700">Your chats</summary><p className="mt-1 text-xs leading-5 text-slate-500">Private to you in {workspaceName}.</p>
          <nav aria-label="Your chats" className="mt-3 max-h-48 space-y-1 overflow-y-auto xl:max-h-[65vh]">
            {pending === "history" ? <p className="p-2 text-sm text-slate-500">Loading chats…</p> : chats.length ? chats.map((entry) => <button key={entry.id} type="button" onClick={() => openChat(entry.id)} disabled={disabled} aria-current={chat?.id === entry.id ? "page" : undefined} className={`w-full min-w-0 rounded-lg px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-vaeroex-blue disabled:opacity-60 ${chat?.id === entry.id ? "bg-vaeroex-soft text-vaeroex-blue" : "text-slate-700 hover:bg-slate-50"}`}><span className="block break-words font-medium [overflow-wrap:anywhere]">{entry.title}</span><span className="mt-1 block text-xs text-slate-500">{displayDate(entry.updatedAt)}</span></button>) : <p className="p-2 text-sm text-slate-500">Your saved chats will appear here.</p>}
          </nav>
          {historyCursor ? <button type="button" onClick={loadOlderChats} disabled={disabled} className={`${button} mt-3 w-full`}>{pending === "older" ? "Loading older chats…" : "Load older chats"}</button> : null}
        </details>
      </aside>
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white" aria-label="Conversation" aria-busy={pending === "load"}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><h2 className="min-w-0 break-words text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{chat?.title || "New conversation"}</h2>{chat ? <div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => { setTitle(chat.title); setRenaming(!renaming); setDeleting(false); }} className={button}>Rename</button><button type="button" disabled={disabled} onClick={() => { setDeleting(!deleting); setRenaming(false); }} className={button}>Delete</button></div> : null}</div>
        {renaming ? <form data-vaeroex-skip-global-activity onSubmit={rename} className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-4"><label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Chat name<input autoFocus maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900 focus:outline-vaeroex-blue" /></label><button disabled={disabled || !title.trim()} className={button}>{pending === "rename" ? "Saving…" : "Save name"}</button><button type="button" onClick={() => setRenaming(false)} disabled={disabled} className={button}>Cancel</button></form> : null}
        {deleting ? <div className="border-b border-red-200 bg-red-50 p-4"><p className="text-sm leading-6 text-red-800">Delete this chat and its transcript? This cannot be undone.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={deleteChat} disabled={disabled} className={button}>{pending === "delete" ? "Deleting…" : "Delete this chat"}</button><button type="button" onClick={() => setDeleting(false)} disabled={disabled} className={button}>Keep chat</button></div></div> : null}
        {chat?.parentConversationId ? <p className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">Continued with a summary from <a href={`/app/si?chat=${encodeURIComponent(chat.parentConversationId)}`} onClick={(event) => { event.preventDefault(); if (!disabled) void openChat(chat.parentConversationId!); }} className="font-semibold text-vaeroex-blue underline">the original transcript</a>. The original chat remains available.</p> : null}
        <div className="space-y-7 p-4 sm:p-6">
          {!exchanges.length && !failedQuestion ? <div className="py-10 text-center sm:py-16"><h3 className="text-lg font-semibold text-slate-900">What would you like to explore?</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-slate-600">Write, plan, work through an idea, understand something new, or ask about your business.</p><p className="mx-auto mt-3 max-w-lg text-xs leading-6 text-slate-500">For current information, Vaeroex can check a live source. For business questions, it uses evidence you can access in this workspace.</p></div> : null}
          {exchanges.map((entry) => <Exchange key={entry.id} exchange={entry} canEditNotes={canEditNotes} saving={pending === `remember:${entry.id}`} disabled={disabled} workspaceName={workspaceName} onRemember={saveNote} />)}
          {failedQuestion ? <div className="space-y-3"><div className="ml-auto max-w-[92%] rounded-2xl bg-slate-100 p-4 text-sm leading-7 text-slate-900"><p className="text-xs font-semibold text-slate-500">You</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{failedQuestion.message}</p></div>{pending !== "answer" ? <button type="button" onClick={() => send(failedQuestion)} disabled={disabled} className={button}>Retry this question</button> : null}</div> : null}
          {pending === "answer" ? <p role="status" className="text-sm leading-7 text-slate-600">Vaeroex is preparing your answer…</p> : null}<div ref={end} />
        </div>
        {(chat?.exchangeCount || 0) >= 225 ? <div className="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><p>{readOnly ? "This chat has reached 250 exchanges and is now read-only." : "This is a long conversation. At 250 exchanges, continue in a new chat to keep answers focused."} A new chat carries forward a concise summary and links back to this transcript.</p>{readOnly ? <button type="button" onClick={continueChat} disabled={disabled} className={`${button} mt-3`}>{pending === "continue" ? "Preparing new chat…" : "Continue in a new chat"}</button> : null}</div> : null}
        {!readOnly ? <form data-vaeroex-skip-global-activity onSubmit={(event) => { event.preventDefault(); void send(); }} className="border-t border-slate-200 p-4">
          <label htmlFor="vsi-message" className="mb-2 block text-sm font-semibold text-slate-700">Message Vaeroex</label>
          <textarea ref={composer} id="vsi-message" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={8000} disabled={accessLost} placeholder="Ask anything…" aria-describedby="vsi-composer-help" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-3 text-base leading-7 text-slate-900 placeholder:text-slate-500 focus:border-vaeroex-blue focus:outline-2 focus:outline-offset-2 focus:outline-vaeroex-blue disabled:opacity-50" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p id="vsi-composer-help" className="text-xs leading-5 text-slate-500">Enter to send · Shift+Enter for a new line<br />Review recommendations before acting. Do not include sensitive personal or healthcare data.</p><button type="submit" disabled={disabled || !message.trim()} className="min-h-11 rounded-lg bg-vaeroex-blue px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50">{pending === "answer" ? "Preparing answer…" : "Send"}</button></div>
        </form> : null}
      </section>
    </div>
  </div>;
}
