"use client";

import { Archive, CheckCheck, RotateCcw, Trash2 } from "lucide-react";
import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type EvidenceLifecycleAction = "approve" | "archive" | "restore" | "delete";

export type EvidenceLifecycleResult = Readonly<{
  ok: boolean;
  message: string;
}>;

type SelectionItem = Readonly<{
  id: string;
  label: string;
  approvable?: boolean;
}>;

type SelectionContextValue = Readonly<{
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
}>;

const SelectionContext = createContext<SelectionContextValue | null>(null);

function itemLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function confirmationCopy(action: EvidenceLifecycleAction, count: number, singular: string) {
  const items = itemLabel(count, singular);
  if (action === "archive") {
    return `Archive ${items}?\n\nThey will no longer participate in active intelligence but can be restored later.`;
  }
  if (action === "delete") {
    return `Delete ${items}?\n\nThis removes them from active evidence. They can no longer influence Executive Intelligence.`;
  }
  if (action === "approve") return `Approve ${items} to Evidence?`;
  return `Restore ${items} to active intelligence?`;
}

export function EvidenceLifecycleSelection({
  items,
  singularLabel,
  archived = false,
  action,
  children
}: {
  items: readonly SelectionItem[];
  singularLabel: string;
  archived?: boolean;
  action: (input: { ids: string[]; action: EvidenceLifecycleAction; typedConfirmation?: string }) => Promise<EvidenceLifecycleResult>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  const canApprove = selectedItems.length > 0 && selectedItems.every((item) => item.approvable);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.map((item) => item.id)));
  }

  function run(nextAction: EvidenceLifecycleAction) {
    if (!selectedItems.length || pending) return;
    if (!window.confirm(confirmationCopy(nextAction, selectedItems.length, singularLabel))) return;

    let typedConfirmation: string | undefined;
    if (nextAction === "delete" && selectedItems.length > 1) {
      typedConfirmation = window.prompt(`Type DELETE to confirm deleting ${itemLabel(selectedItems.length, singularLabel)}.`)?.trim();
      if (typedConfirmation !== "DELETE") {
        setMessage("Bulk deletion cancelled. Type DELETE exactly to confirm.");
        return;
      }
    }

    setMessage("");
    startTransition(async () => {
      const result = await action({ ids: selectedItems.map((item) => item.id), action: nextAction, typedConfirmation });
      setMessage(result.message);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <SelectionContext.Provider value={{ selected, toggle }}>
      <div className="mb-3 flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
        <button type="button" onClick={selectAll} disabled={allSelected || pending} className="text-sm font-semibold text-cyan-200 disabled:text-slate-500">
          Select All
        </button>
        {selected.size ? (
          <button type="button" onClick={() => setSelected(new Set())} disabled={pending} className="text-sm font-semibold text-slate-300 disabled:text-slate-500">
            Clear Selection
          </button>
        ) : null}
        <span className="text-sm text-slate-400">{selected.size} selected</span>
        {selected.size ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {canApprove && !archived ? (
              <button type="button" disabled={pending} onClick={() => run("approve")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emerald-300/30 bg-emerald-950/25 px-3 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-50">
                <CheckCheck aria-hidden="true" className="h-4 w-4" /> Approve
              </button>
            ) : null}
            {archived ? (
              <button type="button" disabled={pending} onClick={() => run("restore")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-950/25 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-50">
                <RotateCcw aria-hidden="true" className="h-4 w-4" /> Restore
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => run("archive")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 disabled:opacity-50">
                <Archive aria-hidden="true" className="h-4 w-4" /> Archive
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => run("delete")} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 disabled:opacity-50">
              <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete
            </button>
          </div>
        ) : null}
      </div>
      {message ? <p className="mb-3 text-sm text-slate-300" role="status">{message}</p> : null}
      {children}
    </SelectionContext.Provider>
  );
}

export function EvidenceLifecycleCheckbox({ id, label }: { id: string; label: string }) {
  const context = useContext(SelectionContext);
  if (!context) return null;
  return (
    <input
      type="checkbox"
      checked={context.selected.has(id)}
      onChange={() => context.toggle(id)}
      aria-label={`Select ${label}`}
      className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-cyan-400"
    />
  );
}
