export type BusinessSignalEvidenceScope = "related-signal-pattern" | "limited-signal-context";

type BusinessSignalEvidenceRecord = {
  status?: string | null;
  description?: string | null;
  category?: string | null;
  related_type?: string | null;
  due_date?: string | null;
};

export function isOpenBusinessSignal(signal: BusinessSignalEvidenceRecord) {
  return !["closed", "done", "complete", "completed", "converted", "won", "dismissed"].includes((signal.status || "").toLowerCase());
}

export function businessSignalMatchesEvidenceScope(signal: BusinessSignalEvidenceRecord, scope: BusinessSignalEvidenceScope) {
  if (!isOpenBusinessSignal(signal)) return false;
  if (scope === "related-signal-pattern") return Boolean(signal.description || signal.category || signal.related_type || signal.due_date);
  return !signal.description || !signal.category;
}

export function evidenceScopeForFinding(findingId: string): BusinessSignalEvidenceScope | null {
  if (findingId === "source-signal-review-pattern") return "related-signal-pattern";
  if (findingId === "unclear-source-signals") return "limited-signal-context";
  return null;
}
