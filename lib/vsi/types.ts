import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type VsiCitation = { id: string; title: string; url: string; sourceType: string; sourceId: string | null;
  evidenceDate: string | null; retrievedAt: string; excerpt?: string; snapshotHash?: string };
export type VsiUsage = { model: "gpt-6-luna"; inputTokens: number; cachedInputTokens: number; outputTokens: number;
  reasoningTokens: number; webSearchCalls: number; retries: number; estimatedCostUsd: number; providerRequestId?: string | null; latencyMs: number; costEstimated?: boolean; providerCalls?: number; webOpenCalls?: number; webFindCalls?: number; researchTier?: "simple" | "standard" | "deep" };
export type VsiNoteDraft = { title: string; content: string };
export type VsiAnswer = { content: string; citations: VsiCitation[]; noteDraft?: VsiNoteDraft; publicResearchTopics?: string[]; usage: VsiUsage };
export type VsiMessage = { role: "user" | "assistant"; content: string; citations?: VsiCitation[]; publicResearchTopics?: string[] };
export type VsiRunInput = { supabase: SupabaseClient<Database>; workspaceId: string; actorUserId: string; question: string;
  recentMessages: VsiMessage[]; priorPublicResearchTopics?: string[]; contextSummary?: string; requestId: string };
export type VsiEvidence = VsiCitation & { text: string; treatment: "record" | "reported_context" | "derived" };
export type VsiEvidenceResult = { sources: VsiEvidence[]; limitations: string[] };
