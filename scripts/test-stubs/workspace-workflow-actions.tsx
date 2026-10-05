export async function createFormSubmissionAction(data: FormData) {
  const response = await fetch("/fixture-submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
  if (!response.ok) throw new Error("Synthetic submission failed");
}

export async function submitInternalForm(_previous: null, data: FormData) {
  await createFormSubmissionAction(data);
  return null;
}

export async function submitWorksheetApproval(_previous: null, data: FormData) {
  await createFormSubmissionAction(data);
  return null;
}
