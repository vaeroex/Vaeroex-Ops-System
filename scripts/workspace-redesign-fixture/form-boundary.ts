// Fixture-only dispatch. DOM .method defaults to GET even for React function actions.
export function classifyFixtureSubmission(methodAttribute: string | null, actionAttribute: string | null, origin: string) {
  if (actionAttribute?.startsWith("javascript:")) return { kind: "react-action" as const };
  if (methodAttribute?.toLowerCase() !== "get" || !actionAttribute) return { kind: "blocked" as const };
  try {
    const url = new URL(actionAttribute, origin);
    if (url.origin === origin && (url.pathname === "/app" || url.pathname.startsWith("/app/"))) return { kind: "get" as const, url };
  } catch { /* An invalid target is not a preview navigation. */ }
  return { kind: "blocked" as const };
}

const protectedNoteForms = new WeakSet<HTMLFormElement>();
export function preserveSyntheticNoteOnReset(form: HTMLFormElement) {
  if (!form.querySelector('textarea[name="note_text"]') || protectedNoteForms.has(form)) return;
  protectedNoteForms.add(form);
  // React resets uncontrolled inputs after a resolved function action. All note
  // results in this fixture are unavailable, so retain the user's local draft.
  form.addEventListener("reset", event => event.preventDefault());
}
