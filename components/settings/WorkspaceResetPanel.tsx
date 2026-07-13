"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, ArchiveRestore, DatabaseZap, ShieldCheck, X } from "lucide-react";
import {
  resetWorkspaceDataAction,
  restoreWorkspaceDataAction,
  retryWorkspaceResetPurgeAction
} from "@/app/app/settings/workspace-reset-actions";
import { permanentWorkspaceResetPhrase, type WorkspaceResetSetupMode, type WorkspaceResetStorageMode } from "@/lib/workspaces/reset-policy";

type ResetOperationSummary = {
  id: string;
  storage_mode: string;
  setup_mode: string;
  status: string;
  purge_after: string | null;
  failure_summary: string | null;
  created_at: string;
};

type WorkspaceResetPanelProps = {
  workspaceId: string;
  workspaceName: string;
  available: boolean;
  recentOperations: ResetOperationSummary[];
};

function SubmitState({ idle, pending }: { idle: string; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={isPending}
      className="min-h-11 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-red-700"
    >
      {isPending ? pending : idle}
    </button>
  );
}

function OperationSubmitState({ kind }: { kind: "restore" | "retry" }) {
  const { pending } = useFormStatus();
  const restore = kind === "restore";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
        restore
          ? "border-vaeroex-blue text-vaeroex-blue hover:bg-vaeroex-soft disabled:hover:bg-transparent"
          : "border-red-700 text-red-800 hover:bg-red-50 disabled:hover:bg-transparent"
      }`}
    >
      {restore ? <ArchiveRestore className="size-4" aria-hidden="true" /> : null}
      {pending ? (restore ? "Restoring data..." : "Retrying purge...") : restore ? "Restore data" : "Retry private-file purge"}
    </button>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function WorkspaceResetPanel({ workspaceId, workspaceName, available, recentOperations }: WorkspaceResetPanelProps) {
  const [storageMode, setStorageMode] = useState<WorkspaceResetStorageMode>("recoverable");
  const [setupMode, setSetupMode] = useState<WorkspaceResetSetupMode>("blank");
  const [confirmationName, setConfirmationName] = useState("");
  const [permanentPhrase, setPermanentPhrase] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [operationId, setOperationId] = useState("");
  const [confirmationStep, setConfirmationStep] = useState<0 | 1 | 2>(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const expectedPermanentPhrase = useMemo(() => permanentWorkspaceResetPhrase(workspaceName), [workspaceName]);
  const configurationValid =
    confirmationName === workspaceName &&
    currentPassword.length >= 8 &&
    (storageMode !== "permanent" || permanentPhrase === expectedPermanentPhrase);

  useEffect(() => {
    if (!confirmationStep) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : reviewButtonRef.current;
    dialog?.focus();

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmationStep(0);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => {
      window.removeEventListener("keydown", handleDialogKey);
      previouslyFocused?.focus();
    };
  }, [confirmationStep]);

  function beginConfirmation() {
    if (!configurationValid) return;
    setOperationId(crypto.randomUUID());
    setConfirmationStep(1);
  }

  if (!available) {
    return (
      <section className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="font-semibold">Reset workspace data</h3>
            <p className="mt-1 text-sm leading-6">
              This control is unavailable until the reviewed workspace-reset migration is applied. No fallback deletion path is enabled.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-red-300 bg-red-50 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">Reset workspace data</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
              Remove business records and intelligence state from <strong>{workspaceName}</strong> without deleting the workspace, account,
              membership, subscription, legal history, or security audit records.
            </p>
          </div>
        </div>

        <form
          action={resetWorkspaceDataAction}
          className="mt-5 space-y-5"
          onSubmit={(event) => {
            if (confirmationStep !== 2) event.preventDefault();
          }}
        >
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="operation_id" value={operationId} />

          <fieldset>
            <legend className="text-sm font-semibold text-ink">Storage handling</legend>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <label className={`rounded-lg border p-3 ${storageMode === "recoverable" ? "border-vaeroex-blue bg-white" : "border-red-200 bg-red-50"}`}>
                <input
                  type="radio"
                  name="storage_mode"
                  value="recoverable"
                  checked={storageMode === "recoverable"}
                  onChange={() => setStorageMode("recoverable")}
                  className="mr-2"
                />
                <span className="text-sm font-semibold text-ink">Recoverable for 30 days</span>
                <span className="mt-1 block text-xs leading-5 text-slate-700">Business content leaves active use immediately. Private files remain available for controlled restoration until the purge deadline.</span>
              </label>
              <label className={`rounded-lg border p-3 ${storageMode === "permanent" ? "border-red-700 bg-white" : "border-red-200 bg-red-50"}`}>
                <input
                  type="radio"
                  name="storage_mode"
                  value="permanent"
                  checked={storageMode === "permanent"}
                  onChange={() => setStorageMode("permanent")}
                  className="mr-2"
                />
                <span className="text-sm font-semibold text-red-800">Permanently delete now</span>
                <span className="mt-1 block text-xs leading-5 text-red-800">Business records and uploaded files are permanently deleted. This cannot be undone.</span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-ink">After reset</legend>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <label className={`rounded-lg border p-3 ${setupMode === "blank" ? "border-vaeroex-blue bg-white" : "border-red-200"}`}>
                <input type="radio" name="setup_mode" value="blank" checked={setupMode === "blank"} onChange={() => setSetupMode("blank")} className="mr-2" />
                <span className="text-sm font-semibold text-ink">Start with a blank workspace</span>
                <span className="mt-1 block text-xs leading-5 text-slate-700">No sample KPIs, Business Signals, reports, or starter records are recreated.</span>
              </label>
              <label className={`rounded-lg border p-3 ${setupMode === "guided" ? "border-vaeroex-blue bg-white" : "border-red-200"}`}>
                <input type="radio" name="setup_mode" value="guided" checked={setupMode === "guided"} onChange={() => setSetupMode("guided")} className="mr-2" />
                <span className="text-sm font-semibold text-ink">Re-run guided setup</span>
                <span className="mt-1 block text-xs leading-5 text-slate-700">Setup opens only after reset. Nothing is recreated until you explicitly finish the wizard.</span>
              </label>
            </div>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              Type the workspace name exactly
              <input
                required
                name="confirmation_name"
                value={confirmationName}
                onChange={(event) => setConfirmationName(event.target.value)}
                autoComplete="off"
                className="mt-2 min-h-11 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-ink outline-none focus:border-red-700 focus:ring-2 focus:ring-red-200"
              />
              <span className="mt-1 block text-xs font-normal text-red-800">Expected: {workspaceName}</span>
            </label>
            <label className="block text-sm font-semibold text-ink">
              Confirm your current password
              <input
                required
                name="current_password"
                type="password"
                minLength={8}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-ink outline-none focus:border-red-700 focus:ring-2 focus:ring-red-200"
              />
              <span className="mt-1 block text-xs font-normal text-slate-700">
                Password-based reauthentication is required. OAuth-only accounts cannot use workspace reset yet.
              </span>
            </label>
          </div>

          {storageMode === "permanent" ? (
            <label className="block text-sm font-semibold text-ink">
              Type the irreversible confirmation phrase
              <input
                required
                name="permanent_phrase"
                value={permanentPhrase}
                onChange={(event) => setPermanentPhrase(event.target.value)}
                autoComplete="off"
                className="mt-2 min-h-11 w-full rounded-lg border-2 border-red-700 bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-red-200"
              />
              <span className="mt-1 block break-words text-xs font-normal text-red-800">Expected: {expectedPermanentPhrase}</span>
            </label>
          ) : null}

          <button
            ref={reviewButtonRef}
            type="button"
            disabled={!configurationValid}
            onClick={beginConfirmation}
            className="min-h-11 rounded-lg border border-red-700 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          >
            Review reset
          </button>

          {confirmationStep ? (
            <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4">
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="reset-confirmation-title"
                tabIndex={-1}
                className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-red-300 bg-white p-5 shadow-2xl outline-none sm:p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-red-700">Confirmation {confirmationStep} of 2</p>
                    <h4 id="reset-confirmation-title" className="mt-1 text-xl font-semibold text-slate-950">
                      {confirmationStep === 1 ? "Review what will change" : "Final confirmation"}
                    </h4>
                  </div>
                  <button type="button" onClick={() => setConfirmationStep(0)} aria-label="Close reset confirmation" className="grid size-11 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
                    <X className="size-5" aria-hidden="true" />
                  </button>
                </div>

                {confirmationStep === 1 ? (
                  <div className="mt-5 space-y-4 text-sm leading-6 text-slate-700">
                    <div>
                      <p className="font-semibold text-slate-950">Removed from active use</p>
                      <p>KPIs, source files, learned knowledge, Business Signals, reports, generated intelligence, forms, records, snapshots, and other workspace business content.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-950">Preserved</p>
                      <p>Your account, workspace identity, membership, subscription, billing links, legal acceptances, usage accounting, and security/audit history.</p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setConfirmationStep(0)} className="min-h-11 rounded-lg border border-line px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100">Cancel</button>
                      <button type="button" onClick={() => setConfirmationStep(2)} className="min-h-11 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800">Continue</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 space-y-4 text-sm leading-6 text-slate-700">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
                      <p className="font-semibold">{storageMode === "permanent" ? "This reset is irreversible." : "Business content will leave active use immediately."}</p>
                      <p className="mt-1">Storage: {storageMode === "permanent" ? "permanently delete now" : "recoverable for 30 days"}. After reset: {setupMode === "guided" ? "open guided setup" : "blank workspace"}.</p>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button type="button" onClick={() => setConfirmationStep(1)} className="min-h-11 rounded-lg border border-line px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100">Back</button>
                      <SubmitState idle={storageMode === "permanent" ? "Permanently reset workspace" : "Reset workspace data"} pending="Resetting workspace safely…" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </form>
      </section>

      {recentOperations.length ? (
        <section className="rounded-lg border border-line bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-5 text-vaeroex-blue" aria-hidden="true" />
            <h3 className="font-semibold text-ink">Recent reset operations</h3>
          </div>
          <div className="mt-4 space-y-3">
            {recentOperations.map((operation) => (
              <article key={operation.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">{operation.storage_mode === "permanent" ? "Permanent reset" : "Recoverable reset"}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(operation.created_at)} · Audit reference {operation.id}</p>
                  </div>
                  <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">{operation.status.replace(/_/g, " ")}</span>
                </div>
                {operation.failure_summary ? <p className="mt-3 text-sm text-red-700">{operation.failure_summary}</p> : null}
                {operation.status === "recoverable" ? (
                  <div className="mt-3">
                    <p className="text-xs leading-5 text-muted">Self-service restore is available only while the workspace remains blank, preventing old and new business histories from being merged.</p>
                    <form action={restoreWorkspaceDataAction} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <input type="hidden" name="workspace_id" value={workspaceId} />
                      <input type="hidden" name="operation_id" value={operation.id} />
                      <label className="flex-1 text-xs font-semibold text-muted">
                        Restore before {formatDate(operation.purge_after)}
                        <input required minLength={8} type="password" name="current_password" autoComplete="current-password" className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-ink" placeholder="Current password" />
                      </label>
                      <OperationSubmitState kind="restore" />
                    </form>
                  </div>
                ) : null}
                {operation.storage_mode === "permanent" && ["partial", "database_reset", "purging"].includes(operation.status) ? (
                  <form action={retryWorkspaceResetPurgeAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="operation_id" value={operation.id} />
                    <label className="flex-1 text-xs font-semibold text-muted">
                      Confirm password to retry the exact manifest
                      <input required minLength={8} type="password" name="current_password" autoComplete="current-password" className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 py-2 text-ink" />
                    </label>
                    <OperationSubmitState kind="retry" />
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
