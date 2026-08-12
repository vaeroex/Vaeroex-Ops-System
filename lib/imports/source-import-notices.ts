const OBSOLETE_COMPLETED_IMPORT_ERRORS = new Set(["No extracted rows were found to save."]);
const TARGET_BINDING_ERROR_PREFIX = "KPI target metadata could not be bound safely. ";

type SourceImportNoticeState = {
  error?: string | null;
  successMessage?: string | null;
  fileImportStatus?: string | null;
  latestImportStatus?: string | null;
  persistedIssues?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sourceImportHasPersistedIssue(value: unknown, message: string | null | undefined) {
  if (!message || !Array.isArray(value)) return false;
  const expected = message.trim();
  return value.some((issue) => {
    if (!isRecord(issue) || typeof issue.message !== "string") return false;
    const persisted = issue.message.trim();
    return persisted === expected || `${TARGET_BINDING_ERROR_PREFIX}${persisted}` === expected;
  });
}

export function shouldClearSourceImportError({
  error,
  successMessage,
  fileImportStatus,
  latestImportStatus,
  persistedIssues
}: SourceImportNoticeState) {
  if (!error) return false;
  if (successMessage) return true;
  if (sourceImportHasPersistedIssue(persistedIssues, error)) return true;

  const importCompleted = latestImportStatus === "completed" || (!latestImportStatus && fileImportStatus === "imported");
  return importCompleted && OBSOLETE_COMPLETED_IMPORT_ERRORS.has(error);
}
