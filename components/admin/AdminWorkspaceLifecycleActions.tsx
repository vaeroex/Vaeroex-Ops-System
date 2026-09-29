"use client";

import { transitionWorkspaceLifecycleAction } from "@/app/app/admin/workspaces/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import type { AdminLifecycle } from "@/lib/admin/company-directory";

export function AdminWorkspaceLifecycleActions({
  workspaceId,
  companyName,
  lifecycle,
  returnTo
}: {
  workspaceId: string;
  companyName: string;
  lifecycle: AdminLifecycle;
  returnTo: string;
}) {
  if (lifecycle === "archived") {
    return (
      <form
        action={transitionWorkspaceLifecycleAction}
        className="space-y-3"
        onSubmitCapture={(event) => {
          if (!window.confirm(`Restore ${companyName} to normal Admin lists? This does not reactivate workspace access or change billing.`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <input type="hidden" name="lifecycle_action" value="restore" />
        <input type="hidden" name="return_to" value={returnTo} />
        <p className="text-sm leading-6 text-muted">
          Returns this workspace to normal Admin lists. Access settings, user accounts, billing, saved data, and connection records remain unchanged.
        </p>
        <PendingSubmitButton
          pendingLabel="Restoring workspace..."
          className="min-h-11 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:border-blue-500"
        >
          Restore to Admin lists
        </PendingSubmitButton>
      </form>
    );
  }

  if (lifecycle !== "inactive") {
    return <p className="text-sm leading-6 text-muted">Archive is available when workspace access and linked subscriptions are inactive. Pending activation must be resolved first. Archiving hides the workspace from normal Admin lists and preserves its data.</p>;
  }

  return (
    <form
      action={transitionWorkspaceLifecycleAction}
      className="space-y-3"
      onSubmitCapture={(event) => {
        if (!window.confirm(`Archive ${companyName}? This hides it from normal Admin lists. Access settings, billing, historical data, and connection records remain unchanged.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="lifecycle_action" value="archive" />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="text-sm leading-6 text-muted">
        Hides this inactive workspace from normal Admin lists. User accounts, access settings, Stripe billing, agreements, subscriptions, evidence, files, delivery records, and connections are retained. You can restore it to the lists later.
      </p>
      <PendingSubmitButton
        pendingLabel="Archiving workspace..."
        className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-400"
      >
        Archive workspace
      </PendingSubmitButton>
    </form>
  );
}
