import "server-only";

import type { BusinessNoteReleaseChannel } from "@/lib/ai/business-notes/contracts";

export function businessNoteReleaseChannel(): BusinessNoteReleaseChannel {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}
