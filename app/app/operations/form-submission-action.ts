"use server";

import { createFormSubmissionAction } from "./actions";

// A server reference preserves progressive form posting while useActionState
// supplies authoritative pending state to the hydrated internal form.
export async function submitInternalForm(_previous: null, data: FormData) {
  await createFormSubmissionAction(data);
  return null;
}
