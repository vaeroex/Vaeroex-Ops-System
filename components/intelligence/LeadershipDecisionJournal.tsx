import { createBusinessDecisionAction } from "@/app/app/intelligence/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { Database } from "@/lib/supabase/types";

type BusinessDecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];

type LeadershipDecisionJournalProps = {
  decisions: BusinessDecisionRow[];
  returnPath?: string;
};

const decisionStatuses = ["open", "in_progress", "reviewed", "completed", "dismissed"];

export function LeadershipDecisionJournal({
  decisions,
  returnPath = "/app"
}: LeadershipDecisionJournalProps) {
  const recentDecisions = decisions.slice(0, 6);

  return (
    <div id="decision-journal">
      <CreateDrawer
        title="Log decision"
        description="Vaeroex will retain this leadership decision for future reviews."
        triggerLabel="Log Decision"
      >
        <form action={createBusinessDecisionAction} className="grid gap-4 lg:grid-cols-2">
          <input type="hidden" name="return_path" value={returnPath} />
          <TextInput label="Decision title" name="title" required />
          <TextInput label="Responsible leader" name="owner" />
          <TextInput label="Related KPI" name="related_kpi" />
          <TextInput label="Review date" name="review_date" type="date" />
          <SelectInput label="Status" name="status" options={decisionStatuses} defaultValue="open" />
          <div className="lg:col-span-2">
            <TextArea label="Reason" name="reason" rows={3} />
          </div>
          <div className="lg:col-span-2">
            <TextArea label="Expected outcome" name="expected_outcome" rows={3} />
          </div>
          <div className="lg:col-span-2">
            <PrimaryButton>Save decision</PrimaryButton>
          </div>
        </form>
      </CreateDrawer>
      <div className="mt-4 space-y-3">
        {recentDecisions.length ? (
          recentDecisions.map((decision) => (
            <article key={decision.id} className="rounded-lg border border-line p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-ink">{decision.title}</p>
                <StatusBadge value={decision.status} />
              </div>
              <p className="mt-2 text-muted">{decision.reason || decision.expected_outcome || "Outcome review pending."}</p>
              <p className="mt-2 text-xs text-muted">
                Responsible leader: {decision.owner || "Not set"} | Review: {decision.review_date || "Not scheduled"}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm leading-6 text-muted">No decisions logged yet.</p>
        )}
      </div>
    </div>
  );
}
