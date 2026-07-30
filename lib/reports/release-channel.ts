import "server-only";
import type { SavedAnalysisReleaseChannel } from "@/lib/reports/saved-analysis";

export function currentSavedAnalysisReleaseChannel(): SavedAnalysisReleaseChannel {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}
