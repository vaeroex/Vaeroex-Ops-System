"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupportRequestContentAction, manageSupportRequestAction } from "@/app/app/admin/support-requests/actions";
import { AdminLocalTime } from "@/components/admin/AdminLocalTime";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, type SupportFilters, type SupportMutationResult, type SupportRequestSummary } from "@/lib/admin/support-requests";

const control = "min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50";
const label = (value: string) => value.replaceAll("_", " ");

function RequestContent({ id }: { id: string }) {
  const [content, setContent] = useState<{ message: string | null; error: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    if (loading || content?.message !== undefined && content?.message !== null) return;
    setLoading(true);
    try { setContent(await getSupportRequestContentAction(id)); }
    catch { setContent({ message: null, error: "Support request is unavailable. Try again." }); }
    finally { setLoading(false); }
  }
  return <details onToggle={(event) => { if (event.currentTarget.open && !content) void load(); }}>
    <summary className="cursor-pointer py-1 text-sm font-semibold text-vaeroex-blue">Read support message</summary>
    <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite" aria-busy={loading}>
      {loading ? "Loading support message…" : content?.error ? <><p>{content.error}</p><button type="button" className={`${control} mt-2`} onClick={() => void load()}>Try again</button></> : <p className="whitespace-pre-wrap break-words">{content?.message}</p>}
    </div>
  </details>;
}

export function SupportRequestsInbox({ requests, filters, total }: { requests: SupportRequestSummary[]; filters: SupportFilters; total: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SupportMutationResult | null>(null);
  // Keep a failed submission's key until its outcome is known. Retrying after a
  // lost response cannot apply the same operation twice, even after a restore.
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  const inFlight = useRef(false);
  const visibleIds = new Set(requests.map((request) => request.id));
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = requests.length > 0 && selectedIds.length === requests.length;

  function clearSelection() { setSelected(new Set()); }
  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function submit(action: string, ids: string[], values?: { status: string; priority: string }) {
    if (inFlight.current || !ids.length) return;
    if (action === "delete" && !window.confirm(`Move exactly ${ids.length} ${ids.length === 1 ? "support request" : "support requests"} to Deleted? Contents and audit history will be retained. You can restore ${ids.length === 1 ? "it" : "them"} later.`)) return;
    const signature = JSON.stringify([action, [...ids].sort(), values || null]);
    if (retry.current?.signature !== signature) retry.current = { signature, operationId: crypto.randomUUID() };
    const formData = new FormData();
    formData.set("support_action", action);
    formData.set("operation_id", retry.current.operationId);
    for (const id of ids) formData.append("support_request_ids", id);
    if (values) { formData.set("status", values.status); formData.set("priority", values.priority); }
    inFlight.current = true;
    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await manageSupportRequestAction(formData);
        setResult(outcome);
        if (outcome.ok) { clearSelection(); retry.current = null; router.refresh(); }
      } catch { setResult({ ok: false, message: "The result is unavailable. Retry the same action to safely check its outcome." }); }
      finally { inFlight.current = false; }
    });
  }

  return <div className="space-y-3" aria-busy={pending}>
    <form className="grid gap-3 rounded-xl border border-line bg-white p-3 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_190px_150px_auto]" onChange={clearSelection}>
      <label className="grid gap-1 text-xs font-semibold text-muted">Search<input name="q" defaultValue={filters.q} maxLength={120} disabled={pending} placeholder="Name, email or issue type" className={control} /></label>
      <label className="grid gap-1 text-xs font-semibold text-muted">Status<select name="status" defaultValue={filters.status} disabled={pending} className={control}><option value="">All statuses</option>{SUPPORT_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold text-muted">Lifecycle<select name="view" defaultValue={filters.view} disabled={pending} className={control}><option value="active">Active</option><option value="archived">Archived</option><option value="deleted">Deleted</option><option value="all">All</option></select></label>
      <button disabled={pending} className="self-end rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Apply filters</button>
    </form>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
      <label className="flex items-center gap-2 text-sm"><input aria-label="Select all requests on this page" type="checkbox" disabled={pending || !requests.length} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(requests.map((request) => request.id)))} className="h-4 w-4" />This page</label>
      <span role="status" className="text-sm font-semibold">{selectedIds.length} selected</span>
      <button type="button" disabled={pending || !selectedIds.length} className={control} onClick={clearSelection}>Clear selection</button>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        <button type="button" disabled={pending || !selectedIds.length} className={control} onClick={() => submit("archive", selectedIds)}>Archive</button>
        <button type="button" disabled={pending || !selectedIds.length} className={control} onClick={() => submit("restore", selectedIds)}>Restore</button>
        <button type="button" disabled={pending || !selectedIds.length} className={`${control} border-red-200 text-red-700`} onClick={() => submit("delete", selectedIds)}>Delete</button>
      </div>
      <p className="w-full text-xs text-muted">Selection includes only this page. Archive closes active requests; restore reopens archived or deleted requests. Delete is reversible.</p>
    </div>
    <div aria-live="polite" aria-atomic="true">
      {pending ? <p role="status" className="rounded-lg border border-line p-3 text-sm">Saving support changes…</p> : null}
      {result ? <p role={result.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{result.message}</p> : null}
    </div>
    <ul aria-label="Support requests" className="divide-y divide-line rounded-xl border border-line bg-white">
      {requests.map((request) => <li key={request.id} className="p-3">
        <div className="flex items-start gap-3">
          <input aria-label={`Select request from ${request.name}: ${request.issue_type}`} type="checkbox" checked={selected.has(request.id)} disabled={pending} onChange={() => toggle(request.id)} className="mt-1 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="break-words text-sm font-semibold">{request.issue_type}</p><p className="break-words text-sm text-muted">{request.name} · {request.email}</p></div>
              <div className="flex flex-wrap gap-1"><StatusBadge value={request.priority} /><StatusBadge value={request.status} />{request.deleted_at ? <StatusBadge value="Deleted" /> : request.archived_at ? <StatusBadge value="Archived" /> : null}</div>
            </div>
            <p className="mt-1 break-words text-xs text-muted">{request.workspaceName} · <AdminLocalTime value={request.created_at} label="Created" /></p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-vaeroex-blue">Request details and triage</summary>
              <div className="mt-2 space-y-3"><RequestContent id={request.id} />
                <p className="text-xs text-muted"><AdminLocalTime value={request.updated_at} label="Updated" />{request.deleted_at ? <><br /><AdminLocalTime value={request.deleted_at} label="Deleted" /></> : request.archived_at ? <><br /><AdminLocalTime value={request.archived_at} label="Archived" /></> : null}</p>
                <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit("update", [request.id], { status: String(form.get("status")), priority: String(form.get("priority")) }); }}>
                  <fieldset disabled={pending || Boolean(request.deleted_at || request.archived_at)} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-xs font-semibold text-muted">Status<select name="status" defaultValue={request.status} className={control}>{SUPPORT_STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-semibold text-muted">Priority<select name="priority" defaultValue={request.priority} className={control}>{SUPPORT_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <button className={`${control} self-end font-semibold`}>Update</button>
                  </fieldset>
                </form>
                {request.deleted_at || request.archived_at ? <p className="text-xs text-muted">Select and restore this request before changing its status or priority.</p> : null}
              </div>
            </details>
          </div>
        </div>
      </li>)}
      {!requests.length ? <li className="p-6 text-center text-sm text-muted">{total ? "No requests on this page. Use Previous to return to available requests." : "No support requests match these filters."}</li> : null}
    </ul>
  </div>;
}
