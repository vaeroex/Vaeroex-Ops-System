"use server";

import { saveExtractedImportAction } from "./actions";

// Keep the existing authenticated action and FormData unchanged while the
// client tracks this approval through child renders and its redirect.
export async function submitWorksheetApproval(_previous: null, data: FormData) {
  await saveExtractedImportAction(data);
  return null;
}
