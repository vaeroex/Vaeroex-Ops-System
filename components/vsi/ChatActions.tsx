"use client";

import { MoreHorizontal } from "lucide-react";
import { useLayoutEffect, useId, useRef, useState } from "react";

export function ChatActions({ title, disabled, onRename, onDelete }: { title: string; disabled: boolean; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) setPosition({ left: Math.max(8, Math.min(bounds.right - 144, window.innerWidth - 152)), top: bounds.bottom + 104 < window.innerHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - 104) });
    menu.current?.showPopover();
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div ref={root} className="shrink-0" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Chat actions for ${title}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }} className="vsi-chat-menu-trigger grid h-11 w-9 shrink-0 place-items-center rounded-lg text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-vaeroex-blue disabled:opacity-50"><MoreHorizontal aria-hidden="true" className="h-5 w-5" /></button>
    {open ? <div ref={menu} id={id} popover="auto" onToggle={(event) => { if (event.newState === "closed") setOpen(false); }} style={{ ...position, backgroundColor: "var(--workspace-surface, white)" }} role="menu" aria-label={`Actions for ${title}`} className="fixed inset-auto z-20 m-0 w-36 rounded-lg border border-slate-300 bg-white p-1 shadow-lg" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <button role="menuitem" type="button" tabIndex={-1} onClick={() => { setOpen(false); onRename(); }} className="min-h-11 w-full rounded px-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-100 focus:outline-2 focus:outline-vaeroex-blue">Rename</button>
      <button role="menuitem" type="button" tabIndex={-1} onClick={() => { setOpen(false); onDelete(); }} className="min-h-11 w-full rounded px-3 text-left text-sm text-red-700 hover:bg-red-50 focus:bg-red-50 focus:outline-2 focus:outline-vaeroex-blue">Delete</button>
    </div> : null}
  </div>;
}
