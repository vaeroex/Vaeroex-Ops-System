import type { GoogleSheetsReadTicket } from "@/lib/integrations/google-sheets/read-authority";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

import type { Comparison } from "@/lib/charts/comparison";

export type VsiCitation = { comparisons?: Comparison[]; inputSourceIds?: string[]; id: string; title: string; url: string; sourceType: string; sourceId: string | null;
  evidenceDate: string | null; evidenceDateKind?: "publication" | "updated" | "observation" | "event"; evidenceDateText?: string; retrievedAt: string; excerpt?: string; snapshotHash?: string };
export type VsiFailureCategory = "provider" | "timeout" | "output_validation" | "citation_validation" | "budget_block" | "context_block" | "evidence_unavailable" | "application";
export type VsiUsage = { model: "gpt-6-luna"; inputTokens: number; cachedInputTokens: number; outputTokens: number;
  reasoningTokens: number; webSearchCalls: number; retries: number; estimatedCostUsd: number; providerRequestId?: string | null; latencyMs: number; costEstimated?: boolean; toolAllowanceExceeded?: boolean; providerCalls?: number; webOpenCalls?: number; webFindCalls?: number; researchTier?: "simple" | "standard" | "deep";
  // Operational enums/counters only. Never persist prompts, source URLs or error messages here.
  telemetryVersion?: 1; outcomeFailure?: VsiFailureCategory; researchStatus?: "not_required" | "completed" | "partial" | "failed";
  citationStatus?: "not_required" | "validated" | "failed"; evidenceLimitations?: boolean; noteProposal?: boolean;
  providerFailures?: number; outputValidationFailures?: number; citationValidationFailures?: number };
export type VsiNoteDraft = { title: string; content: string };
export type VsiAnswer = { content: string; citations: VsiCitation[]; noteDraft?: VsiNoteDraft; publicResearchTopics?: string[]; usage: VsiUsage };
export type VsiMessage = { role: "user" | "assistant"; content: string; citations?: VsiCitation[]; publicResearchTopics?: string[] };
export type VsiRunInput = { readTicket: GoogleSheetsReadTicket; supabase: SupabaseClient<Database>; workspaceId: string; actorUserId: string; question: string;
  recentMessages: VsiMessage[]; priorPublicResearchTopics?: string[]; contextSummary?: string; requestId: string };
export type VsiEvidence = VsiCitation & { text: string; treatment: "record" | "reported_context" | "derived" };
export type VsiEvidenceResult = { sources: VsiEvidence[]; limitations: string[] };
