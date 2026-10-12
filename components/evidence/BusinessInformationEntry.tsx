"use client";

import { useId, useState, type ReactNode } from "react";

export function BusinessInformationEntry({ uploadAction, children }: { uploadAction: ReactNode; children: ReactNode }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const editorId = useId();

  return (
    <div className="space-y-3" aria-label="Add business information">
      <div className="grid items-start gap-3 md:grid-cols-2">
        <section aria-labelledby="upload-files-heading" className="workspace-panel min-w-0 p-3 sm:p-4">
          <h2 id="upload-files-heading" className="text-sm font-semibold text-slate-100">Upload files</h2>
          <p className="mt-1 text-sm leading-5 text-[color:var(--workspace-muted)]">Add reports, spreadsheets, documents, or photos of business records for Vaeroex to review.</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--workspace-muted)]">Supports PDF, CSV, Excel (.xlsx), Word (.docx), and PNG/JPG images.</p>
          <div className="mt-3">{uploadAction}</div>
        </section>
        <section aria-labelledby="business-notes-heading" className="workspace-panel min-w-0 p-3 sm:p-4">
          <h2 id="business-notes-heading" className="text-sm font-semibold text-slate-100">Business Notes</h2>
          <p className="mt-1 text-sm leading-5 text-[color:var(--workspace-muted)]">Give Vaeroex context about your business—what you sell, your locations, operating hours, goals, and important details. You can also add meeting notes, decisions, and updates.</p>
          <button type="button" aria-expanded={editorOpen} aria-controls={editorId} onClick={() => setEditorOpen((open) => !open)} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/60">
            {editorOpen ? "Close note editor" : "Add business note"}
          </button>
        </section>
      </div>
      <p className="text-xs leading-5 text-[color:var(--workspace-muted)]">Review and approve information before Vaeroex uses it as business evidence.</p>
      {/* Keep one mounted form across disclosure and breakpoint changes so drafts survive. */}
      <div id={editorId} hidden={!editorOpen} className="workspace-panel min-w-0 p-3 sm:p-4">
        {children}
      </div>
    </div>
  );
}
