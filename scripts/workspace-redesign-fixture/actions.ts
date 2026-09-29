// All exports are generated from an exact reviewed module list. Never imports application actions.
export function fixtureAction(name: string) {
  return async () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fixture-action", { detail: `${name}: simulated pending → unavailable. No record changed.` }));
    await new Promise(resolve => setTimeout(resolve, 700));
    if (name === "submitBusinessNoteForReviewAction") {
      const message = "Synthetic preview: business note extraction is unavailable. Nothing was sent or saved; your entered note is preserved.";
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fixture-action", { detail: message }));
      return { ok: false, message };
    }
    if (name === "getSavedAnalysisState") return { saved: false, id: null };
    if (name === "deleteSavedAnalysesAction" || name.startsWith("bulkManage")) return { ok: false, message: "Synthetic unavailable result. No record was changed." };
    if (name === "uploadSourceAction") return { error: "Synthetic preview: upload is unavailable. Your selected file has not been sent.", blocked: false };
    throw new Error(`Synthetic preview: ${name} is inert; no backend operation was performed.`);
  };
}
