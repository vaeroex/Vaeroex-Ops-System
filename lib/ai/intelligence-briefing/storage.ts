import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
  INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
  INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
  INTELLIGENCE_BRIEFING_PROMPT_VERSION,
  INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
  INTELLIGENCE_BRIEFING_SECTION_IDS,
  INTELLIGENCE_BRIEFING_TYPES,
  INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
  type IntelligenceBriefingArtifact,
  type IntelligenceBriefingPackage,
  type IntelligenceBriefingState,
  type IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import type { Database } from "@/lib/supabase/types";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true });
const dateLike = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isFinite(Date.parse(value)),
  "Expected an ISO date or timestamp."
);
const confidence = z.enum(["High", "Medium", "Low"]);
const freshness = z.enum(["current", "stale", "unavailable"]);
const periodSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoff: iso,
  dayCount: z.union([z.literal(7), z.literal(30)]),
  timeZone: z.literal("UTC")
}).strict();
const claimSchema = z.object({
  text: z.string().trim().min(1),
  support_refs: z.array(z.string().trim().min(1)).min(1)
}).strict();
const modelOutputSchema = z.object({
  executive_summary: claimSchema,
  sections: z.array(z.object({
    section_id: z.enum(INTELLIGENCE_BRIEFING_SECTION_IDS),
    summary: z.string().trim().min(1),
    support_refs: z.array(z.string().trim().min(1)).min(1),
    claims: z.array(claimSchema).min(1)
  }).strict()),
  leadership_considerations: z.array(claimSchema).min(1),
  limitation_refs: z.array(z.string().trim().min(1))
}).strict();
const coverageSchema = z.object({
  supportingRecordCount: z.number().int().nonnegative(),
  independentSourceCount: z.number().int().nonnegative(),
  freshness,
  latestEvidenceAt: iso.nullable(),
  overallCoverage: z.number().min(0).max(100).nullable(),
  coverageLabel: z.string().trim().min(1),
  includedDomains: z.array(z.string().trim().min(1)),
  missingOrWeakDomains: z.array(z.string().trim().min(1))
}).strict();
const signalSchema = z.object({
  ref: z.string().trim().min(1),
  stableKey: hash,
  kind: z.enum(["business_health", "kpi", "finding", "reported_context"]),
  authority: z.enum(["deterministic_result", "measured_evidence", "reported_context"]),
  sectionId: z.enum(INTELLIGENCE_BRIEFING_SECTION_IDS).nullable(),
  label: z.string().trim().min(1),
  fact: z.string().trim().min(1),
  confidence,
  citationIds: z.array(z.number().int().positive()),
  evidenceReferenceIds: z.array(z.string().trim().min(1)),
  limitation: z.string().trim().min(1).nullable(),
  periodRelation: z.enum(["new_or_changed", "continuing", "current_state", "reported_context"]),
  semanticState: z.object({
    desiredDirection: z.string(),
    targetStatus: z.string(),
    performanceEffect: z.string(),
    metricRole: z.string()
  }).strict().optional()
}).strict();
const artifactSchema = z.object({
  contractId: z.literal(INTELLIGENCE_BRIEFING_CONTRACT_ID),
  contractVersion: z.literal(INTELLIGENCE_BRIEFING_CONTRACT_VERSION),
  schemaVersion: z.literal(INTELLIGENCE_BRIEFING_SCHEMA_VERSION),
  validatorVersion: z.literal(INTELLIGENCE_BRIEFING_VALIDATOR_VERSION),
  promptVersion: z.literal(INTELLIGENCE_BRIEFING_PROMPT_VERSION),
  generationPolicyVersion: z.literal(INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION),
  materialityVersion: z.literal(INTELLIGENCE_BRIEFING_MATERIALITY_VERSION),
  workspaceId: z.string().uuid(),
  briefingType: z.enum(INTELLIGENCE_BRIEFING_TYPES),
  period: periodSchema,
  eligibility: z.enum(["limited", "sufficient"]),
  confidence,
  evidenceCoverage: coverageSchema,
  evidenceFingerprint: hash,
  effectiveEvidenceFingerprint: hash,
  materialStateFingerprint: hash,
  generationKey: hash,
  snapshotFingerprint: snapshotHash,
  generatedAt: iso,
  businessHealth: z.object({
    available: z.boolean(),
    score: z.number().min(0).max(100).nullable(),
    status: z.string().trim().min(1),
    trajectory: z.string().trim().min(1).nullable(),
    confidence
  }).strict(),
  analysis: modelOutputSchema,
  sections: z.array(z.object({
    id: z.enum(INTELLIGENCE_BRIEFING_SECTION_IDS),
    label: z.string().trim().min(1),
    signalRefs: z.array(z.string().trim().min(1)).min(1)
  }).strict()),
  signals: z.array(signalSchema).min(1),
  limitations: z.array(z.object({ ref: z.string().trim().min(1), text: z.string().trim().min(1) }).strict()),
  citations: z.array(z.object({
    citationId: z.number().int().positive(),
    title: z.string().trim().min(1),
    sourceLabel: z.string().trim().min(1),
    sourceType: z.string().trim().min(1),
    excerpt: z.string().trim().min(1),
    recordedAt: iso.nullable(),
    href: z.string().startsWith("/app/")
  }).strict()),
  contextReferences: z.array(z.object({
    ref: z.string().trim().min(1),
    sourceNoteId: z.string().uuid(),
    sourceVersion: z.number().int().positive(),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    approvedAt: iso,
    observedAt: dateLike.nullable(),
    applicabilityStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    applicabilityEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
  }).strict()),
  providerAttribution: z.object({
    provider: z.literal("openai"),
    model: z.string().trim().min(1),
    fallbackUsed: z.boolean(),
    providerPolicyId: z.string().trim().min(1)
  }).strict(),
  provenance: z.object({
    snapshotContract: z.literal("intelligence_snapshot_v1"),
    snapshotFingerprint: snapshotHash,
    evidenceManifestId: hash,
    previousBriefingRunId: z.string().uuid().nullable()
  }).strict()
}).strict();

function artifactRelationshipsAreValid(artifact: IntelligenceBriefingArtifact) {
  if ((artifact.briefingType === "weekly" ? 7 : 30) !== artifact.period.dayCount) return false;
  if (artifact.period.start > artifact.period.end || artifact.period.end > artifact.period.cutoff.slice(0, 10)) return false;
  if (artifact.snapshotFingerprint !== artifact.provenance.snapshotFingerprint) return false;
  const signalRefs = new Set(artifact.signals.map((signal) => signal.ref));
  if (signalRefs.size !== artifact.signals.length) return false;
  const limitationRefs = new Set(artifact.limitations.map((limitation) => limitation.ref));
  if (limitationRefs.size !== artifact.limitations.length) return false;
  const citationIds = new Set(artifact.citations.map((citation) => citation.citationId));
  if (citationIds.size !== artifact.citations.length) return false;
  if (artifact.sections.some((section) => section.signalRefs.some((ref) => !signalRefs.has(ref)))) return false;
  if (artifact.signals.some((signal) => signal.citationIds.some((id) => !citationIds.has(id)))) return false;
  const claims = [
    artifact.analysis.executive_summary,
    ...artifact.analysis.sections.flatMap((section) => [{ text: section.summary, support_refs: section.support_refs }, ...section.claims]),
    ...artifact.analysis.leadership_considerations
  ];
  if (claims.some((claim) => claim.support_refs.some((ref) => !signalRefs.has(ref)))) return false;
  if (artifact.analysis.limitation_refs.some((ref) => !limitationRefs.has(ref))) return false;
  const expectedSections = new Set(artifact.sections.map((section) => section.id));
  const actualSections = new Set(artifact.analysis.sections.map((section) => section.section_id));
  return expectedSections.size === actualSections.size && [...expectedSections].every((id) => actualSections.has(id));
}

export function parseIntelligenceBriefingArtifact(value: unknown): IntelligenceBriefingArtifact | null {
  const parsed = artifactSchema.safeParse(value);
  if (!parsed.success) return null;
  const artifact = parsed.data as IntelligenceBriefingArtifact;
  return artifactRelationshipsAreValid(artifact) ? artifact : null;
}

export type CurrentIntelligenceBriefing = Readonly<{
  runId: string;
  artifact: IntelligenceBriefingArtifact;
}>;

export async function loadCurrentIntelligenceBriefing({
  supabase,
  workspaceId,
  briefingType
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  briefingType: IntelligenceBriefingType;
}): Promise<CurrentIntelligenceBriefing | null> {
  const { data, error } = await supabase
    .from("ai_agent_runs")
    .select("id,input_json,output_json,created_at")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", INTELLIGENCE_BRIEFING_CONTRACT_ID)
    .eq("status", "completed")
    .is("archived_at", null)
    .is("deleted_at", null)
    .contains("input_json", { briefing_type: briefingType })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error("Current intelligence briefing could not be loaded.");
  for (const run of data || []) {
    const artifact = parseIntelligenceBriefingArtifact(run.output_json);
    if (!artifact) throw new Error("A completed intelligence briefing failed its stored artifact contract.");
    if (artifact.workspaceId !== workspaceId || artifact.briefingType !== briefingType) {
      throw new Error("A completed intelligence briefing failed its workspace or type binding.");
    }
    return { runId: run.id, artifact };
  }
  return null;
}

export function briefingStateFromPackage({
  briefingPackage,
  current
}: {
  briefingPackage: IntelligenceBriefingPackage;
  current: CurrentIntelligenceBriefing | null;
}): IntelligenceBriefingState {
  if (briefingPackage.eligibility === "no_eligible_evidence") {
    return {
      status: "unavailable",
      briefingType: briefingPackage.briefingType,
      period: briefingPackage.period,
      eligibility: briefingPackage.eligibility,
      confidence: briefingPackage.confidence,
      artifact: current?.artifact || null,
      message: "Vaeroex does not have eligible business evidence for this period. Add or update business information before generating a briefing."
    };
  }
  if (current?.artifact.effectiveEvidenceFingerprint === briefingPackage.effectiveEvidenceFingerprint) {
    return {
      status: "current",
      briefingType: briefingPackage.briefingType,
      period: briefingPackage.period,
      eligibility: briefingPackage.eligibility,
      confidence: briefingPackage.confidence,
      artifact: current.artifact,
      message: "This briefing already reflects the latest eligible business information. View the existing briefing or add new information before generating another."
    };
  }
  if (current?.artifact.materialStateFingerprint === briefingPackage.materialStateFingerprint) {
    return {
      status: "unchanged",
      briefingType: briefingPackage.briefingType,
      period: briefingPackage.period,
      eligibility: briefingPackage.eligibility,
      confidence: briefingPackage.confidence,
      artifact: current.artifact,
      message: "New information is available, but it does not materially change the existing briefing."
    };
  }
  return {
    status: "ready",
    briefingType: briefingPackage.briefingType,
    period: briefingPackage.period,
    eligibility: briefingPackage.eligibility,
    confidence: briefingPackage.confidence,
    artifact: current?.artifact || null,
    message: briefingPackage.eligibility === "limited"
      ? "This briefing will synthesize the information currently available. Some business areas may be omitted."
      : null
  };
}
