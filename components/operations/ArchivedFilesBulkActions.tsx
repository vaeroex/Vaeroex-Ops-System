"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { bulkManageRecordsAction } from "@/app/app/operations/record-management-actions";
import { useActivitySignal } from "@/components/app/ActivityProvider";

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

export function ArchivedFilesBulkActions({
  children,
  fileCount,
  returnPath
}: {
  children: ReactNode;
  fileCount: number;
  returnPath: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [showDelayedFeedback, setShowDelayedFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  useActivitySignal(submitting, feedback || "Updating archived files...", { source: "bulk-archived-files", timeoutMs: 45000 });

  const updateSelectedCount = () => {
    const checked = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="record_id"]:checked').length || 0;
    setSelectedCount(checked);
  };

  useEffect(() => {
    if (!feedback) {
      setShowDelayedFeedback(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDelayedFeedback(true);
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  function toggleVisible(checked: boolean) {
    const checkboxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="record_id"]') || [];
    checkboxes.forEach((checkbox) => {
      checkbox.checked = checked;
    });
    updateSelectedCount();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const action = submitter?.value || "";

    if (!selectedCount) {
      event.preventDefault();
      setFeedback("Select at least one archived file.");
      setShowDelayedFeedback(true);
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(`Delete ${plural(selectedCount, "selected archived file")}? This removes ${selectedCount === 1 ? "it" : "them"} from active and archived Sources.`);

      if (!confirmed) {
        event.preventDefault();
        return;
      }

      if (selectedCount > 1) {
        const typed = window.prompt(`Type DELETE to confirm deleting ${plural(selectedCount, "selected archived file")}.`)?.trim() || "";

        if (typed !== "DELETE") {
          event.preventDefault();
          setFeedback("Bulk deletion cancelled. Type DELETE exactly to confirm.");
          setShowDelayedFeedback(true);
          return;
        }

        setTypedConfirmation("DELETE");
        const hiddenInput = formRef.current?.querySelector<HTMLInputElement>('input[name="typed_confirmation"]');

        if (hiddenInput) {
          hiddenInput.value = "DELETE";
        }
      }

      setFeedback(`Deleting ${plural(selectedCount, "selected file")}...`);
    } else if (action === "restore") {
      setFeedback(`Restoring ${plural(selectedCount, "selected file")}...`);
    } else {
      event.preventDefault();
      setFeedback("Choose restore or delete.");
      setShowDelayedFeedback(true);
      return;
    }

    setSubmitting(true);
  }

  const allSelected = fileCount > 0 && selectedCount === fileCount;

  return (
    <form ref={formRef} action={bulkManageRecordsAction} onSubmit={handleSubmit} onChange={updateSelectedCount} className="space-y-3">
      <input type="hidden" name="collection" value="files" />
      <input type="hidden" name="return_path" value={returnPath} />
      <input type="hidden" name="typed_confirmation" value={typedConfirmation} />
      <div className="flex flex-col gap-3 rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-3 text-sm text-cyan-50 md:flex-row md:items-center md:justify-between">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => toggleVisible(event.currentTarget.checked)}
            className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
          />
          Select all visible
        </label>
        <p className="text-xs text-cyan-100">
          {selectedCount ? `${selectedCount} selected` : "Select archived files to restore or delete."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="bulk_action"
            value="restore"
            disabled={submitting}
            className="min-h-10 rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && feedback.startsWith("Restoring") ? "Restoring..." : "Restore selected"}
          </button>
          <button
            type="submit"
            name="bulk_action"
            value="delete"
            disabled={submitting}
            className="min-h-10 rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && feedback.startsWith("Deleting") ? "Deleting..." : "Delete selected"}
          </button>
        </div>
      </div>
      {showDelayedFeedback && feedback ? (
        <div className="rounded-lg border border-vaeroex-accent/35 bg-blue-950/30 p-3 text-sm text-cyan-50" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span>{feedback}</span>
            <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-900">
              <span className="block h-full w-2/3 rounded-full bg-gradient-to-r from-vaeroex-blue to-vaeroex-accent" />
            </span>
          </div>
        </div>
      ) : null}
      {children}
    </form>
  );
}
