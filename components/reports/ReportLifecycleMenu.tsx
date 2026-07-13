import { MoreHorizontal } from "lucide-react";
import { manageRecordAction } from "@/app/app/operations/record-management-actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";

type ReportLifecycleMenuProps = {
  reportId: string;
  reportTitle: string;
  archived: boolean;
  returnPath?: string;
};

function LifecycleForm({
  reportId,
  reportTitle,
  action,
  returnPath
}: {
  reportId: string;
  reportTitle: string;
  action: "archive" | "restore" | "delete";
  returnPath: string;
}) {
  const label = action === "archive" ? "Archive" : action === "restore" ? "Restore" : "Delete";
  const pendingLabel = action === "archive" ? "Archiving..." : action === "restore" ? "Restoring..." : "Deleting...";
  const message =
    action === "delete"
      ? `Delete "${reportTitle}"? This soft-deletes the report from normal retrieval without deleting its source evidence.`
      : action === "archive"
        ? `Archive "${reportTitle}"? It will leave the active report library but remain available in Archived.`
        : `Restore "${reportTitle}" to the active report library?`;

  return (
    <form action={manageRecordAction}>
      <input type="hidden" name="collection" value="reports" />
      <input type="hidden" name="record_id" value={reportId} />
      <input type="hidden" name="record_action" value={action} />
      <input type="hidden" name="return_path" value={returnPath} />
      <ConfirmSubmitButton
        message={message}
        pendingLabel={pendingLabel}
        className={`min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
          action === "delete" ? "text-red-200 hover:bg-red-950/40" : "text-slate-200 hover:bg-cyan-950/30"
        }`}
      >
        {label}
      </ConfirmSubmitButton>
    </form>
  );
}

export function ReportLifecycleMenu({ reportId, reportTitle, archived, returnPath = "/app/reports" }: ReportLifecycleMenuProps) {
  return (
    <details className="group relative">
      <summary
        aria-label={`Manage ${reportTitle}`}
        className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-52 rounded-lg border border-white/10 bg-[#07111f] p-2 shadow-command">
        <LifecycleForm reportId={reportId} reportTitle={reportTitle} action={archived ? "restore" : "archive"} returnPath={returnPath} />
        <LifecycleForm reportId={reportId} reportTitle={reportTitle} action="delete" returnPath={returnPath} />
      </div>
    </details>
  );
}
