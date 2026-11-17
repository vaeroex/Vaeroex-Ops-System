import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { prepareSharedGeneration } from "@/lib/ai/shared-evidence/generation";
import { vsiEvidenceWindowSelection } from "./evidence-window";

/** Same selection and preparation for inspection and eventual answers. */
export async function prepareVsiSharedEvidence(supabase: SupabaseClient<Database>, workspaceId: string, question: string) {
  const window = vsiEvidenceWindowSelection(question);
  const prepared = await prepareSharedGeneration(supabase, workspaceId, window.start, window.end, question);
  return { window, prepared };
}
