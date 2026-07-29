import { shareRecordAction } from "@/app/app/accountability/actions";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { DISTRIBUTION_SCHEDULES, PRIORITIES, SHARE_SCOPES } from "@/lib/team/options";

export type TeamPersonOption = {
  id: string;
  full_name: string;
  role_title?: string | null;
  department?: string | null;
};

function ShareRecipientFields({ people, defaultRole }: { people: TeamPersonOption[]; defaultRole?: string }) {
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
      <TextInput label="Role" name="role" defaultValue={defaultRole} />
      <TextInput label="Department" name="department" />
    </div>
  );
}

function recipientFields(people: TeamPersonOption[], defaultRole?: string) {
  return <ShareRecipientFields people={people} defaultRole={defaultRole} />;
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
        Preserve an internal share record for this workspace. No message is sent.
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
