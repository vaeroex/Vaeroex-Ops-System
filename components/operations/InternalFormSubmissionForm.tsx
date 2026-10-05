"use client";

import { useActionState, useState } from "react";
import { submitInternalForm } from "@/app/app/operations/form-submission-action";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { FORM_PRIORITIES, MAX_FIELD_LENGTH, parseSubmissionSchema, type SubmissionField } from "@/lib/forms/submission-schema";

type FormChoice = { id: string; name: string; schema_json: unknown };
export function InternalFormSubmissionForm({ forms, returnPath }: { forms: FormChoice[]; returnPath: string }) {
  // Track the submitted action itself: host form context can transiently reset
  // during a child render while its request is still in flight.
  const [, submitForm, submissionPending] = useActionState(submitInternalForm, null);
  const [formId, setFormId] = useState(forms[0]?.id || "");
  const selected = forms.find((form) => form.id === formId);
  let fields: SubmissionField[] = [];
  let schemaError: string | null = null;
  try { fields = parseSubmissionSchema(selected?.schema_json); }
  catch (error) { schemaError = error instanceof Error ? error.message : "This form cannot accept responses."; }
  return (
    <form action={submitForm} className="grid gap-4 lg:grid-cols-2">
      <input type="hidden" name="return_path" value={returnPath} />
      {forms.length > 1 ? (
        <label className="block text-sm font-medium">Form
          <select name="form_id" aria-label="Form" required value={formId} onChange={(event) => setFormId(event.target.value)} className="mt-2 w-full rounded-lg border border-line px-3 py-2">
            {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
          </select>
        </label>
      ) : <input type="hidden" name="form_id" value={formId} />}
      {schemaError ? <p role="alert" className="lg:col-span-2">{schemaError}</p> : (
        <>
          <fieldset key={formId} className="grid gap-4 rounded-lg border border-line p-4 lg:col-span-2 lg:grid-cols-2">
            <legend className="px-2 font-semibold">{selected?.name} fields</legend>
            {fields.map((field) => (
              <label key={field.key} className="block text-sm font-medium">{field.label}{field.required ? " (required)" : ""}
                {field.type === "priority" ? (
                  <select name={`field:${field.key}`} required={field.required} defaultValue="" className="mt-2 w-full rounded-lg border border-line px-3 py-2">
                    <option value="">Choose priority</option>
                    {FORM_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                  </select>
                ) : <input name={`field:${field.key}`} type={field.type === "date" ? "date" : "text"} required={field.required} maxLength={MAX_FIELD_LENGTH} className="mt-2 w-full rounded-lg border border-line px-3 py-2" />}
              </label>
            ))}
            {!fields.length ? <p className="text-sm text-muted">This form has no custom fields.</p> : null}
          </fieldset>
          <TextInput label="Submitter name" name="submitter_name" required />
          <TextInput label="Submitter email" name="submitter_email" type="email" />
          <SelectInput label="Priority" name="priority" defaultValue="Medium" options={FORM_PRIORITIES} />
          <div className="lg:col-span-2"><TextArea label="Submission summary" name="summary" required rows={4} /></div>
          <div className="lg:col-span-2"><TextArea label="Signals or evidence, one per line" name="follow_up" rows={4} /></div>
          <div className="lg:col-span-2"><PrimaryButton pending={submissionPending}>Save submission</PrimaryButton></div>
        </>
      )}
    </form>
  );
}
