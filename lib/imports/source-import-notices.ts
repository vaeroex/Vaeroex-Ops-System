const OBSOLETE_COMPLETED_IMPORT_ERRORS = new Set(["No extracted rows were found to save."]);

type SourceImportNoticeState = {
  error?: string | null;
  successMessage?: string | null;
  fileImportStatus?: string | null;
  latestImportStatus?: string | null;
};

export function shouldClearSourceImportError({
  error,
  successMessage,
  fileImportStatus,
  latestImportStatus
}: SourceImportNoticeState) {
  if (!error) return false;
  if (successMessage) return true;

  const importCompleted = latestImportStatus === "completed" || (!latestImportStatus && fileImportStatus === "imported");
  return importCompleted && OBSOLETE_COMPLETED_IMPORT_ERRORS.has(error);
}
