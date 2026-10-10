"use client";

import Link from "next/link";
import { ChatActions } from "@/components/vsi/ChatActions";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Exchange } from "@/components/vsi/Exchange";
import { displayDate, type VsiChat, type VsiExchange, type VsiUsageView } from "@/components/vsi/contracts";

type Props = { workspaceId: string; workspaceName: string; userId: string; timeZone?: string; initialConversationId?: string; initialPrompt?: string };
type ChatResponse = { workspaceId: string; conversation: VsiChat; exchanges?: VsiExchange[]; exchange?: VsiExchange; canEditBusinessNotes?: boolean };
type FailedQuestion = { conversationId: string; message: string; requestId: string };
const button = "min-h-11 sm:min-h-8 rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50";
class RequestError extends Error {
  constructor(message: string, readonly accessLost = false, readonly code = "") { super(message); }
}

export function VsiWorkspace({ workspaceId, workspaceName, userId, timeZone: workspaceTimeZone, initialConversationId = "", initialPrompt = "" }: Props) {
  const [timeZone, setTimeZone] = useState(workspaceTimeZone || "UTC");
  useEffect(() => { setTimeZone(workspaceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone); }, [workspaceTimeZone]);
  const [chats, setChats] = useState<VsiChat[]>([]), [chat, setChat] = useState<VsiChat | null>(null);
  const [slowAnswer, setSlowAnswer] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false), [showJump, setShowJump] = useState(false), [hasNewAnswer, setHasNewAnswer] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<VsiExchange[]>([]), [message, setMessage] = useState(initialPrompt);
  const [pending, setPending] = useState<string | null>("history"), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [accessLost, setAccessLost] = useState(false), [canEditNotes, setCanEditNotes] = useState(false);
  const [failedQuestion, setFailedQuestion] = useState<FailedQuestion | null>(null);
  const [renaming, setRenaming] = useState<VsiChat | null>(null), [title, setTitle] = useState(""), [deleting, setDeleting] = useState<VsiChat | null>(null);
  const [usageOpen, setUsageOpen] = useState(false), [usage, setUsage] = useState<VsiUsageView | null>(null);
  const controllers = useRef(new Set<AbortController>()), mounted = useRef(true), operation = useRef(false);
  const ownedNavigation = useRef<string | null>(null), viewEpoch = useRef(0);
  const workspace = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), transcript = useRef<HTMLDivElement>(null), followLatest = useRef(true);

  const request = useCallback(async <T,>(path: string, options?: { method: string; body?: Record<string, unknown> }): Promise<T> => {
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 205_000);
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
      followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
      setAccessLost(true); setRenaming(null); setDeleting(null); setUsageOpen(false); setHistoryCursor(null); setChat(null); setExchanges([]); setChats([]); setMessage(""); setFailedQuestion(null); setUsage(null);
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
    followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
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
    setSlowAnswer(false);
    if (pending !== "answer") return;
    const timer = setTimeout(() => setSlowAnswer(true), 10_000);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const syncHistory = () => setHistoryOpen(desktop.matches);
    syncHistory(); desktop.addEventListener("change", syncHistory);
    return () => desktop.removeEventListener("change", syncHistory);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const syncViewport = () => {
      const node = workspace.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      node.dataset.compactViewport = String(window.innerWidth < 640 && (viewport?.height || window.innerHeight) <= 560);
      node.style.setProperty("--vsi-available-height", `${Math.max(220, (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0) - top - 8)}px`);
      // Opening the software keyboard is a user action. Keep its focused
      // composer visible without following new answers for an earlier reader.
      if (document.activeElement === composer.current) composer.current?.closest("form")?.scrollIntoView({ block: "nearest" });
    };
    syncViewport(); viewport?.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => { viewport?.removeEventListener("resize", syncViewport); window.removeEventListener("resize", syncViewport); };
  }, []);

  useLayoutEffect(() => {
    // Scroll this viewport only. A response must not move a reader who has
    // scrolled back, or scroll the surrounding workspace page.
    if (followLatest.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [exchanges, failedQuestion, pending, slowAnswer]);

  function trackTranscriptPosition() {
    const viewport = transcript.current;
    if (!viewport) return;
    const nearLatest = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
    followLatest.current = nearLatest; setShowJump(!nearLatest);
    if (nearLatest) setHasNewAnswer(false);
  }

  function jumpToLatest() {
    followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
    if (transcript.current) { transcript.current.scrollTop = transcript.current.scrollHeight; transcript.current.focus({ preventScroll: true }); }
  }

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
      followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
      rememberChat(detail.conversation); setExchanges(detail.exchanges || []); setMessage(""); setFailedQuestion(null);
      setCanEditNotes(Boolean(detail.canEditBusinessNotes)); setRenaming(null); setDeleting(null);
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
    followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
    setChat(null); setExchanges([]); setMessage(""); setFailedQuestion(null); setError(""); setNotice(""); setRenaming(null); setDeleting(null);
    ownedNavigation.current = ""; window.history.replaceState(null, "", window.location.pathname); composer.current?.focus();
  }

  async function send(retry?: FailedQuestion) {
    const text = (retry?.message || message).trim();
    if (!text || pending || accessLost || (chat?.exchangeCount || 0) >= 250) return;
    followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
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
        if (!followLatest.current) { setHasNewAnswer(true); setShowJump(true); }
        setFailedQuestion(null); setNotice("Answer saved."); setUsage(null);
        if (followLatest.current && document.activeElement?.closest("[data-vsi-composer]")) composer.current?.focus({ preventScroll: true });
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
      followLatest.current = true; setShowJump(false); setHasNewAnswer(false);
      rememberChat(created.conversation); setExchanges(created.exchanges || []); setFailedQuestion(null);
      setNotice("New chat ready with a concise summary of the previous conversation."); composer.current?.focus();
    });
  }

  async function rename(event: FormEvent) {
    event.preventDefault(); if (!renaming || !title.trim()) return;
    await run("rename", async (epoch) => {
      const saved = await request<ChatResponse>(`/conversations/${renaming.id}`, { method: "PATCH", body: { title: title.trim() } });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      if (chat?.id === saved.conversation.id) setChat(saved.conversation);
      setChats((previous) => previous.map((entry) => entry.id === saved.conversation.id ? saved.conversation : entry)); setRenaming(null); setNotice("Chat renamed.");
    });
  }

  async function deleteChat() {
    if (!deleting) return;
    await run("delete", async (epoch) => {
      await request(`/conversations/${deleting.id}`, { method: "DELETE" });
      if (!mounted.current || epoch !== viewEpoch.current) return;
      setChats((previous) => previous.filter((entry) => entry.id !== deleting.id));
      if (chat?.id === deleting.id) { setChat(null); setExchanges([]); setMessage(""); setFailedQuestion(null); ownedNavigation.current = ""; window.history.replaceState(null, "", window.location.pathname); }
      setDeleting(null); setRenaming(null); setNotice("Chat deleted.");
    });
  }

  useEffect(() => {
    if (!usageOpen) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target as Element)?.closest(".vsi-usage-control")) setUsageOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setUsageOpen(false); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [usageOpen]);

  async function showUsage() {
    if (usageOpen) { setUsageOpen(false); return; }
    setUsageOpen(true);
    await run("usage", async (epoch) => { const result = await request<VsiUsageView & { workspaceId: string }>("/usage"); if (mounted.current && epoch === viewEpoch.current) setUsage(result); });
  }

  const readOnly = (chat?.exchangeCount || 0) >= 250, disabled = Boolean(pending) || accessLost;
  return <div ref={workspace} className="workspace-vsi flex min-h-0 flex-col gap-2" data-vsi-workspace={workspaceId}>
    <details className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Business Context <span className="sr-only ml-1 font-normal text-slate-500 sm:not-sr-only">(optional)</span></summary>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">For more useful business answers, describe what you sell, your locations, customers, goals, and other relevant context in Business Notes. Approved notes become available through Business Memory. Your ordinary conversations stay private and do not become shared business facts.</p>
      <Link href="/app/sources#business-notes" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline">{canEditNotes ? "Add or manage Business Notes" : "View Business Notes"}</Link>
      <p className="text-xs leading-5 text-slate-500">Use Files &amp; Notes for file uploads. Chat accepts text only. <Link href="/app/help?q=Vaeroex%20Super%20Intelligence" className="underline">About Vaeroex and safe use</Link></p>
    </details>
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"><p>{error}</p>{accessLost ? <button type="button" onClick={() => window.location.assign("/app/si")} className="mt-2 min-h-11 font-semibold underline">Reload your active workspace</button> : null}</div> : null}
    <p role="status" aria-live="polite" className={notice && notice !== "Answer saved." ? "text-sm leading-6 text-slate-600" : "sr-only"}>{notice}</p>
    <div className="vsi-panels grid min-h-0 min-w-0 flex-1 gap-2 xl:grid-cols-[180px_minmax(0,1fr)]">
      <aside className="vsi-history min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white p-2" aria-label="Private chat history">
        <button type="button" onClick={newChat} disabled={disabled} className={`${button} w-full`}>New chat</button>
        <details className="mt-2" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold text-slate-700">Your chats</summary><p className="mt-1 text-xs leading-5 text-slate-500">Private to you in {workspaceName}.</p>
          <nav aria-label="Your chats" className="mt-2 max-h-40 space-y-1 overflow-y-auto overscroll-contain xl:max-h-[min(28rem,45dvh)]">
            {pending === "history" ? <p className="p-2 text-sm text-slate-500">Loading chats…</p> : chats.length ? chats.map((entry) => <div key={entry.id} className="vsi-chat-row group relative min-w-0">
              <div className="flex min-w-0 items-center">
                <button type="button" title={entry.title} onClick={() => openChat(entry.id)} disabled={disabled} aria-current={chat?.id === entry.id ? "page" : undefined} className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-vaeroex-blue disabled:opacity-60 ${chat?.id === entry.id ? "bg-vaeroex-soft text-vaeroex-blue" : "text-slate-700 hover:bg-slate-50"}`}><span className="block truncate font-medium">{entry.title}</span><span className="mt-1 block text-xs text-slate-500">{displayDate(entry.updatedAt, false, timeZone)}</span></button>
                <ChatActions title={entry.title} disabled={disabled} onRename={() => { setRenaming(entry); setTitle(entry.title); setDeleting(null); }} onDelete={() => { setDeleting(entry); setRenaming(null); }} />
              </div>
            </div>) : <p className="p-2 text-sm text-slate-500">Your saved chats will appear here.</p>}
          </nav>
          {historyCursor ? <button type="button" onClick={loadOlderChats} disabled={disabled} className={`${button} mt-3 w-full`}>{pending === "older" ? "Loading older chats…" : "Load older chats"}</button> : null}
        </details>
        <div className="vsi-usage-control relative shrink-0 xl:mt-auto xl:border-t xl:border-slate-200 xl:pt-2">
          <button type="button" onClick={showUsage} disabled={disabled} aria-expanded={usageOpen} aria-controls="vsi-usage" className={`${button} w-full`}>Usage</button>
    {usageOpen ? <section id="vsi-usage" style={{ backgroundColor: "var(--workspace-surface, white)" }} aria-label="VSI usage" className="vsi-usage-panel absolute right-0 top-full z-20 mt-2 max-h-[50dvh] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700 shadow-lg xl:bottom-full xl:left-0 xl:top-auto xl:mb-2">
      {usage ? <><p><strong>{usage.used} of {usage.limit} questions</strong> answered in your rolling 24-hour window. {usage.remaining} available within that ceiling.</p><p>Workspace spending protections also apply and can pause use earlier.</p>{usage.resetsAt ? <p>Your oldest counted question leaves this window after {displayDate(usage.resetsAt, true, timeZone)}.</p> : null}{usage.workspaceBudget ? <p>Workspace this month: ${usage.workspaceBudget.spentUsd.toFixed(2)} used of ${usage.workspaceBudget.limitUsd.toFixed(2)}.</p> : null}</> : <p>{pending === "usage" ? "Checking usage…" : "Usage is unavailable. Close this panel and try again."}</p>}
      <button type="button" onClick={() => setUsageOpen(false)} className={`${button} mt-2`}>Close usage</button>
    </section> : null}
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="Conversation" aria-busy={pending === "load"}>
        <div className="vsi-conversation-heading min-w-0 shrink-0 border-b border-slate-200 px-3 py-2 sm:px-4"><h2 title={chat?.title || "New conversation"} className="truncate text-sm font-semibold text-slate-900">{chat?.title || "New conversation"}</h2></div>
        {renaming ? <form data-vaeroex-skip-global-activity onSubmit={rename} className="flex shrink-0 flex-wrap items-end gap-2 border-b border-slate-200 p-3"><label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Chat name<input autoFocus maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-slate-900 focus:outline-vaeroex-blue" /></label><button disabled={disabled || !title.trim()} className={button}>{pending === "rename" ? "Saving…" : "Save name"}</button><button type="button" onClick={() => setRenaming(null)} disabled={disabled} className={button}>Cancel</button></form> : null}
        {deleting ? <div className="shrink-0 border-b border-red-200 bg-red-50 p-3"><p className="text-sm leading-6 text-red-800">Delete “{deleting.title}” and its transcript? This cannot be undone.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" autoFocus onClick={deleteChat} disabled={disabled} className={button}>{pending === "delete" ? "Deleting…" : "Delete this chat"}</button><button type="button" onClick={() => setDeleting(null)} disabled={disabled} className={button}>Keep chat</button></div></div> : null}
        {chat?.parentConversationId ? <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-6 text-slate-600">Continued with a summary from <a href={`/app/si?chat=${encodeURIComponent(chat.parentConversationId)}`} onClick={(event) => { event.preventDefault(); if (!disabled) void openChat(chat.parentConversationId!); }} className="font-semibold text-vaeroex-blue underline">the original transcript</a>. The original chat remains available.</p> : null}
        <div className="relative min-h-0 flex-1">
        <div ref={transcript} id="vsi-transcript" role="region" aria-label="Conversation transcript" tabIndex={0} onScroll={trackTranscriptPosition} className="h-full space-y-5 overflow-y-auto overscroll-contain p-3 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-vaeroex-blue sm:p-4">
          {!exchanges.length && !failedQuestion ? <div className="py-6 text-center sm:py-10"><h3 className="text-lg font-semibold text-slate-900">What would you like to explore?</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-slate-600">Write, plan, work through an idea, understand something new, or ask about your business.</p><p className="mx-auto mt-3 max-w-lg text-xs leading-6 text-slate-500">For current information, Vaeroex can check a live source. For business questions, it uses evidence you can access in this workspace.</p></div> : null}
          {exchanges.map((entry) => <Exchange key={entry.id} exchange={entry} canEditNotes={canEditNotes} saving={pending === `remember:${entry.id}`} disabled={disabled} workspaceName={workspaceName} timeZone={timeZone} onRemember={saveNote} />)}
          {failedQuestion ? <div className="space-y-3"><div className="ml-auto max-w-[92%] rounded-2xl bg-slate-100 p-4 text-sm leading-7 text-slate-900"><p className="text-xs font-semibold text-slate-500">You</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{failedQuestion.message}</p></div>{pending !== "answer" ? <button type="button" onClick={() => send(failedQuestion)} disabled={disabled} className={button}>Retry this question</button> : null}</div> : null}
          {pending === "answer" ? <p role="status" className="text-sm leading-6 text-slate-600">Vaeroex is preparing your answer…{slowAnswer ? <span className="mt-1 block text-xs">Some questions take about three minutes. You can keep reading while Vaeroex finishes.</span> : null}</p> : null}
        </div>
        {showJump ? <button type="button" onClick={jumpToLatest} aria-controls="vsi-transcript" style={{ transition: "none", backgroundColor: "var(--workspace-surface, white)" }} className={`${button.replace("bg-white", "").replace("hover:bg-slate-50", "")} absolute bottom-2 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 whitespace-nowrap shadow-sm`}>{hasNewAnswer ? "New answer · Jump to latest" : "Jump to latest"}</button> : null}
        </div>
        {(chat?.exchangeCount || 0) >= 225 ? <div className="mx-3 mb-3 shrink-0 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><p>{readOnly ? "This chat has reached 250 exchanges and is now read-only." : "This is a long conversation. At 250 exchanges, continue in a new chat to keep answers focused."} A new chat carries forward a concise summary and links back to this transcript.</p>{readOnly ? <button type="button" onClick={continueChat} disabled={disabled} className={`${button} mt-3`}>{pending === "continue" ? "Preparing new chat…" : "Continue in a new chat"}</button> : null}</div> : null}
        {!readOnly ? <form data-vsi-composer data-vaeroex-skip-global-activity onSubmit={(event) => { event.preventDefault(); void send(); }} className="shrink-0 scroll-mb-3 border-t border-slate-200 p-3 sm:px-4">
          <label htmlFor="vsi-message" className="sr-only">Message Vaeroex</label>
          <div className="flex items-end gap-2"><textarea ref={composer} id="vsi-message" rows={2} value={message} onChange={(event) => setMessage(event.target.value)} onFocus={() => composer.current?.closest("form")?.scrollIntoView({ block: "nearest" })} maxLength={8000} disabled={accessLost} placeholder="Ask anything…" aria-describedby="vsi-composer-help" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} className="block max-h-32 min-h-14 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-base leading-6 text-slate-900 placeholder:text-slate-500 focus:border-vaeroex-blue focus:outline-2 focus:outline-offset-2 focus:outline-vaeroex-blue disabled:opacity-50" />
          <button type="submit" disabled={disabled || !message.trim()} aria-label={pending === "answer" ? "Preparing answer…" : "Send"} className="min-h-11 shrink-0 rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50">{pending === "answer" ? "Waiting…" : "Send"}</button></div>
          <p id="vsi-composer-help" className="mt-2 text-xs leading-5 text-slate-500"><span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · </span>Double-check important answers</p>
        </form> : null}
      </section>
    </div>
  </div>;
}
