import "server-only";

import { z } from "zod";
import type { Json } from "@/lib/supabase/types";

export const LEGACY_EXECUTIVE_BRIEF_CONTRACT_ID = "executive_brief_v1" as const;
export const LEGACY_EXECUTIVE_BRIEF_CONTRACT_VERSION = "executive_brief_v1" as const;
export const LEGACY_EXECUTIVE_BRIEF_VALIDATOR_VERSION = "executive_brief_validator_v6" as const;

const analysisSchema = z.object({
  executive_summary: z.string(),
  why_it_matters: z.string(),
  primary_concern: z.string().nullable(),
  positive_signal: z.string().nullable(),
  leadership_focus: z.string(),
  uncertainty: z.string(),
  provisional_hypothesis: z.string().nullable()
}).strict();

const materialChangeSchema = z.object({
  stableKey: z.string(),
  label: z.string(),
  fact: z.string(),
  direction: z.enum(["positive", "negative", "neutral"])
}).strict();

const factsSchema = z.object({
  available: z.boolean(),
  businessHealth: z.object({
    score: z.number().nullable(),
    status: z.string(),
    trajectory: z.string().nullable(),
    comparisonDelta: z.number().nullable()
  }).strict(),
  materialChanges: z.array(materialChangeSchema),
  confidence: z.enum(["High", "Medium", "Low"]),
  freshness: z.enum(["current", "stale", "unavailable"]),
  latestEvidenceAt: z.string().nullable(),
  independentSourceCount: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
  deterministicReadout: z.array(z.string())
}).strict();

const signalSchema = z.object({
  ordinal: z.number().int().positive(),
  stableKey: z.string(),
  roles: z.array(z.enum(["primary_concern", "positive_signal", "leadership_focus", "context"])),
  classification: z.enum(["risk", "opportunity", "neutral"]),
  domain: z.string(),
  label: z.string(),
  approvedFact: z.string(),
  approvedLeadershipFocus: z.string().nullable(),
  coverageTerms: z.array(z.string()),
  citationIds: z.array(z.number().int().positive())
}).strict();

const citationSchema = z.object({
  citationId: z.number().int().positive(),
  title: z.string(),
  sourceLabel: z.string(),
  sourceType: z.string(),
  excerpt: z.string(),
  recordedAt: z.string().nullable()
}).strict();

const legacyArtifactSchema = z.object({
  contractId: z.literal(LEGACY_EXECUTIVE_BRIEF_CONTRACT_ID),
  contractVersion: z.literal(LEGACY_EXECUTIVE_BRIEF_CONTRACT_VERSION),
  validatorVersion: z.literal(LEGACY_EXECUTIVE_BRIEF_VALIDATOR_VERSION),
  fingerprint: z.string().length(64),
  generatedAt: z.string(),
  analysis: analysisSchema,
  facts: factsSchema,
  signals: z.array(signalSchema),
  citations: z.array(citationSchema),
  providerAttribution: z.object({
    provider: z.enum(["openai", "nvidia"]),
    model: z.string(),
    fallbackUsed: z.boolean(),
    providerPolicyId: z.string()
  }).strict()
}).strict();

export type LegacyExecutiveBriefArtifact = z.infer<typeof legacyArtifactSchema>;

export function parseLegacyExecutiveBriefArtifact(value: Json) {
  const parsed = legacyArtifactSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
