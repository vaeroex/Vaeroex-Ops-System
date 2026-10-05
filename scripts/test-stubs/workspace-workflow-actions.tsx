export async function createFormSubmissionAction(data: FormData) {
  const response = await fetch("/fixture-submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
  if (!response.ok) throw new Error("Synthetic submission failed");
}
