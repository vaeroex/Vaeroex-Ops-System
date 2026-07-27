import { transitionWorkspaceLifecycleAction } from "@/app/app/admin/workspaces/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
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
      <form action={transitionWorkspaceLifecycleAction}>
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <input type="hidden" name="lifecycle_action" value="restore" />
        <input type="hidden" name="return_to" value={returnTo} />
        <ConfirmSubmitButton
          message={`Restore ${companyName} to the normal Admin lists? Its prior workspace access state will remain unchanged.`}
          pendingLabel="Restoring..."
          className="min-h-11 rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:border-blue-500"
        >
          Restore workspace
        </ConfirmSubmitButton>
      </form>
    );
  }

  if (lifecycle !== "inactive") {
    return <p className="text-sm text-muted">Set workspace access to Inactive before archiving.</p>;
  }

  return (
    <form action={transitionWorkspaceLifecycleAction}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="lifecycle_action" value="archive" />
      <input type="hidden" name="return_to" value={returnTo} />
      <ConfirmSubmitButton
        message={`Archive ${companyName}? Historical agreements, subscriptions, evidence, files, and delivery records will remain intact.`}
        pendingLabel="Archiving..."
        className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-400"
      >
        Archive workspace
      </ConfirmSubmitButton>
    </form>
  );
}
