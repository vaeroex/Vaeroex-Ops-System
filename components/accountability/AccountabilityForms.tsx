import { createAssignmentAction, createKpiAlertRuleAction, evaluateKpiAlertsAction, shareRecordAction } from "@/app/app/accountability/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { DISTRIBUTION_SCHEDULES, KPI_ALERT_CONDITIONS, OPERATIONAL_ROLES, PRIORITIES, SHARE_SCOPES, TEAM_DEPARTMENTS } from "@/lib/team/options";

export type TeamPersonOption = {
  id: string;
  full_name: string;
  role_title?: string | null;
  department?: string | null;
};

export function AssignmentTargetFields({ people, defaultRole }: { people: TeamPersonOption[]; defaultRole?: string }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <label className="block text-sm font-medium">
        Person
        <select name="person_id" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue">
          <option value="">Choose...</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </label>
      <SelectInput label="Role" name="role" options={OPERATIONAL_ROLES} defaultValue={defaultRole} />
      <SelectInput label="Department" name="department" options={TEAM_DEPARTMENTS} />
    </div>
  );
}

function recipientFields(people: TeamPersonOption[], defaultRole?: string) {
  return <AssignmentTargetFields people={people} defaultRole={defaultRole} />;
}

function hiddenRecordFields({
  sourceType,
  sourceId,
  sourceTitle,
  relatedModule,
  returnPath,
  actionHref
}: {
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  relatedModule: string;
  returnPath: string;
  actionHref: string;
}) {
  return (
    <>
      <input type="hidden" name="source_type" value={sourceType} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="source_title" value={sourceTitle} />
      <input type="hidden" name="related_module" value={relatedModule} />
      <input type="hidden" name="return_path" value={returnPath} />
      <input type="hidden" name="action_href" value={actionHref} />
    </>
  );
}

export function ShareRecordPanel({
  sourceType,
  sourceId,
  sourceTitle,
  relatedModule,
  returnPath,
  actionHref,
  people
}: {
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  relatedModule: string;
  returnPath: string;
  actionHref: string;
  people: TeamPersonOption[];
}) {
  return (
    <section className="rounded-lg border border-line bg-slate-50 p-4">
      <h4 className="text-sm font-semibold text-ink">Share / Distribute</h4>
      <p className="mt-1 text-sm leading-6 text-muted">
        Create an in-app share record and notification. Email sending is not enabled yet.
      </p>
      <form action={shareRecordAction} className="mt-4 grid gap-3">
        {hiddenRecordFields({ sourceType, sourceId, sourceTitle, relatedModule, returnPath, actionHref })}
        <SelectInput label="Share with" name="recipient_scope" options={SHARE_SCOPES} defaultValue="Entire workspace" required />
        {recipientFields(people)}
        <div className="grid gap-3 lg:grid-cols-2">
          <SelectInput label="Distribution schedule" name="distribution_schedule" options={DISTRIBUTION_SCHEDULES} defaultValue="One-time share" />
          <SelectInput label="Priority" name="priority" options={PRIORITIES} defaultValue="Medium" />
        </div>
        <TextArea label="Message" name="message" rows={3} placeholder="Add context for the recipients." />
        <PrimaryButton>Share</PrimaryButton>
      </form>
    </section>
  );
}

export function AssignmentPanel({
  sourceType,
  sourceId,
  sourceTitle,
  relatedModule,
  returnPath,
  actionHref,
  people,
  defaultTitle,
  defaultDescription,
  defaultRole,
  compact = false
}: {
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  relatedModule: string;
  returnPath: string;
  actionHref: string;
  people: TeamPersonOption[];
  defaultTitle?: string;
  defaultDescription?: string;
  defaultRole?: string;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "rounded-lg border border-line bg-white p-3" : "rounded-lg border border-line bg-slate-50 p-4"}>
      <h4 className="text-sm font-semibold text-ink">Assign</h4>
      <p className="mt-1 text-sm leading-6 text-muted">Assign this item to a person, role, or department without changing app permissions.</p>
      <form action={createAssignmentAction} className="mt-4 grid gap-3">
        {hiddenRecordFields({ sourceType, sourceId, sourceTitle, relatedModule, returnPath, actionHref })}
        <TextInput label="Assignment title" name="assignment_title" defaultValue={defaultTitle || sourceTitle} required />
        <TextArea label="Details" name="description" rows={compact ? 2 : 3} defaultValue={defaultDescription || ""} />
        <SelectInput label="Assign to" name="recipient_scope" options={SHARE_SCOPES.slice(0, 3)} defaultValue={defaultRole ? "Role" : "Role"} required />
        {recipientFields(people, defaultRole)}
        <div className="grid gap-3 lg:grid-cols-3">
          <TextInput label="Due date" name="due_date" type="date" />
          <SelectInput label="Priority" name="priority" options={PRIORITIES} defaultValue="Medium" />
          <SelectInput label="Status" name="status" options={["Open", "In Progress", "Waiting", "Done"]} defaultValue="Open" />
        </div>
        <PrimaryButton>Assign</PrimaryButton>
      </form>
    </section>
  );
}

export function KpiAlertRulePanel({
  kpiNames,
  people,
  returnPath = "/app/kpis"
}: {
  kpiNames: string[];
  people: TeamPersonOption[];
  returnPath?: string;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">KPI alerts</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            Create in-app alerts for KPI changes. Vaeroex will create notification records when rules are checked.
          </p>
        </div>
        <form action={evaluateKpiAlertsAction}>
          <input type="hidden" name="return_path" value={returnPath} />
          <ConfirmSubmitButton message="Check active KPI alert rules now?">Check alerts now</ConfirmSubmitButton>
        </form>
      </div>
      <form action={createKpiAlertRuleAction} className="mt-4 grid gap-3 lg:grid-cols-2">
        <input type="hidden" name="return_path" value={returnPath} />
        <SelectInput label="KPI" name="kpi_name" options={kpiNames} required />
        <SelectInput label="Alert when" name="condition_type" options={KPI_ALERT_CONDITIONS} defaultValue="Below target" required />
        <TextInput label="Change percent threshold" name="threshold_value" type="number" step="0.01" placeholder="Example: 10" />
        <SelectInput label="Notify" name="recipient_scope" options={SHARE_SCOPES} defaultValue="Entire workspace" />
        <div className="lg:col-span-2">{recipientFields(people)}</div>
        <SelectInput label="Priority" name="priority" options={PRIORITIES} defaultValue="Medium" />
        <div className="self-end">
          <PrimaryButton>Create alert rule</PrimaryButton>
        </div>
      </form>
    </section>
  );
}
