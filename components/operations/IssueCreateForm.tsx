"use client";
import { useActionState } from "react";
import { submitIssue } from "@/app/app/operations/issue-submission-action";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "./FormControls";

export function IssueCreateForm({ requestId }: { requestId: string }) {
  const [, submit, pending] = useActionState(submitIssue, null);
  return (
    <form action={submit} className="grid gap-4 lg:grid-cols-2">
      <input type="hidden" name="issue_request_id" value={requestId} />
      <TextInput label="Issue title" name="title" required />
      <TextInput label="Issue type" name="issue_type" placeholder="Process, customer, safety, equipment" />
      <TextArea label="Description" name="description" rows={4} />
      <SelectInput label="Severity" name="severity" defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
      <SelectInput label="Status" name="status" defaultValue="Open" options={["Open", "Investigating", "Waiting", "Closed"]} />
      <TextArea label="Root cause" name="root_cause" rows={3} />
      <TextArea label="Leadership review note" name="recommended_fix" rows={3} />
      <div className="lg:col-span-2"><PrimaryButton pending={pending}>Log issue</PrimaryButton></div>
    </form>
  );
}
