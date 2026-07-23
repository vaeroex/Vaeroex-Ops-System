import type { Json } from "@/lib/supabase/types";

export const SAVED_ANALYSIS_ENVELOPE_VERSION = 1 as const;

export const SAVED_ANALYSIS_TYPES = [
  "executive_brief",
  "business_health",
  "finding_explanation"
] as const;

export type SavedAnalysisType = (typeof SAVED_ANALYSIS_TYPES)[number];
export type SavedAnalysisConfidence = "High" | "Medium" | "Low";
export type SavedAnalysisFreshness = "current" | "stale" | "unavailable";
export type SavedAnalysisReleaseChannel = "production" | "preview" | "development";

export type SavedAnalysisCitation = Readonly<{
  citationId: number;
  title: string;
  sourceLabel: string;
  sourceType: string;
  excerpt: string;
  recordedAt: string | null;
}>;

export type SavedAnalysisDisplaySection = Readonly<{
  id: string;
  label: string;
  body: string | readonly string[];
  tone?: "default" | "supporting" | "limitation";
}>;

export type SavedAnalysisEnvelope = Readonly<{
  record_kind: "saved_analysis";
  envelope_version: typeof SAVED_ANALYSIS_ENVELOPE_VERSION;
  saved_analysis_key: string;
  workspace_id: string;
  release_channel: SavedAnalysisReleaseChannel;
  analysis_type: SavedAnalysisType;
  title: string;
  source_artifact: Readonly<{
    id: string;
    workflow: string;
    contract_id: string;
    contract_version: string;
    validator_version: string;
    policy_id: string;
  }>;
  provider_attribution: Readonly<{
    provider: "openai" | "nvidia";
    model: string;
    fallback_used: boolean;
  }>;
  generated_at: string;
  saved_at: string;
  confidence: SavedAnalysisConfidence;
  freshness: SavedAnalysisFreshness;
  evidence_fingerprint: string;
  citations: readonly SavedAnalysisCitation[];
  evidence_lineage: readonly SavedAnalysisCitation[];
  display: Readonly<{
    summary_label: string;
    summary: string;
    sections: readonly SavedAnalysisDisplaySection[];
    evidence_status: string;
    date_range: string | null;
  }>;
  artifact: Json;
}>;

export type SavedAnalysisListItem = Readonly<{
  id: string;
  title: string;
  analysisType: SavedAnalysisType;
  generatedAt: string;
  savedAt: string;
  confidence: SavedAnalysisConfidence;
  evidenceStatus: string;
  dateRange: string | null;
}>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isAnalysisType(value: unknown): value is SavedAnalysisType {
  return typeof value === "string" && SAVED_ANALYSIS_TYPES.includes(value as SavedAnalysisType);
}

function isConfidence(value: unknown): value is SavedAnalysisConfidence {
  return value === "High" || value === "Medium" || value === "Low";
}

function isFreshness(value: unknown): value is SavedAnalysisFreshness {
  return value === "current" || value === "stale" || value === "unavailable";
}

function isReleaseChannel(value: unknown): value is SavedAnalysisReleaseChannel {
  return value === "production" || value === "preview" || value === "development";
}

function parseCitations(value: unknown): SavedAnalysisCitation[] | null {
  if (!Array.isArray(value)) return null;
  const citations = value.map((candidate) => {
    const citation = record(candidate);
    if (!Number.isInteger(citation.citationId) || Number(citation.citationId) < 1) return null;
    if (!text(citation.title) || !text(citation.sourceLabel) || !text(citation.sourceType) || !text(citation.excerpt)) return null;
    if (citation.recordedAt !== null && citation.recordedAt !== undefined && !isIsoDate(citation.recordedAt)) return null;
    return {
      citationId: Number(citation.citationId),
      title: text(citation.title),
      sourceLabel: text(citation.sourceLabel),
      sourceType: text(citation.sourceType),
      excerpt: text(citation.excerpt),
      recordedAt: typeof citation.recordedAt === "string" ? citation.recordedAt : null
    } satisfies SavedAnalysisCitation;
  });
  return citations.every(Boolean) ? citations as SavedAnalysisCitation[] : null;
}

function parseSections(value: unknown): SavedAnalysisDisplaySection[] | null {
  if (!Array.isArray(value)) return null;
  const sections = value.map((candidate) => {
    const section = record(candidate);
    const body = section.body;
    const validBody = typeof body === "string"
      ? Boolean(body.trim())
      : Array.isArray(body) && body.every((item) => typeof item === "string" && item.trim());
    if (!text(section.id) || !text(section.label) || !validBody) return null;
    const tone = section.tone === "supporting" || section.tone === "limitation" ? section.tone : "default";
    return {
      id: text(section.id),
      label: text(section.label),
      body: typeof body === "string" ? body.trim() : (body as string[]).map((item) => item.trim()),
      tone
    } satisfies SavedAnalysisDisplaySection;
  });
  return sections.every(Boolean) ? sections as SavedAnalysisDisplaySection[] : null;
}

export function parseSavedAnalysisEnvelope(value: unknown): SavedAnalysisEnvelope | null {
  const envelope = record(value);
  const source = record(envelope.source_artifact);
  const provider = record(envelope.provider_attribution);
  const display = record(envelope.display);
  const citations = parseCitations(envelope.citations);
  const lineage = parseCitations(envelope.evidence_lineage);
  const sections = parseSections(display.sections);

  if (envelope.record_kind !== "saved_analysis" || envelope.envelope_version !== SAVED_ANALYSIS_ENVELOPE_VERSION) return null;
  if (!text(envelope.saved_analysis_key) || !text(envelope.workspace_id) || !isReleaseChannel(envelope.release_channel)) return null;
  if (!isAnalysisType(envelope.analysis_type) || !text(envelope.title)) return null;
  if (!text(source.id) || !text(source.workflow) || !text(source.contract_id) || !text(source.contract_version) || !text(source.validator_version) || !text(source.policy_id)) return null;
  if ((provider.provider !== "openai" && provider.provider !== "nvidia") || !text(provider.model) || typeof provider.fallback_used !== "boolean") return null;
  if (!isIsoDate(envelope.generated_at) || !isIsoDate(envelope.saved_at) || !isConfidence(envelope.confidence) || !isFreshness(envelope.freshness)) return null;
  if (!text(envelope.evidence_fingerprint) || !citations || !lineage || !sections || !text(display.summary_label) || !text(display.summary) || !text(display.evidence_status)) return null;
  if (envelope.artifact === undefined) return null;
  if (display.date_range !== null && display.date_range !== undefined && typeof display.date_range !== "string") return null;

  return {
    record_kind: "saved_analysis",
    envelope_version: SAVED_ANALYSIS_ENVELOPE_VERSION,
    saved_analysis_key: text(envelope.saved_analysis_key),
    workspace_id: text(envelope.workspace_id),
    release_channel: envelope.release_channel,
    analysis_type: envelope.analysis_type,
    title: text(envelope.title),
    source_artifact: {
      id: text(source.id),
      workflow: text(source.workflow),
      contract_id: text(source.contract_id),
      contract_version: text(source.contract_version),
      validator_version: text(source.validator_version),
      policy_id: text(source.policy_id)
    },
    provider_attribution: {
      provider: provider.provider,
      model: text(provider.model),
      fallback_used: provider.fallback_used
    },
    generated_at: envelope.generated_at as string,
    saved_at: envelope.saved_at as string,
    confidence: envelope.confidence,
    freshness: envelope.freshness,
    evidence_fingerprint: text(envelope.evidence_fingerprint),
    citations,
    evidence_lineage: lineage,
    display: {
      summary_label: text(display.summary_label),
      summary: text(display.summary),
      sections,
      evidence_status: text(display.evidence_status),
      date_range: typeof display.date_range === "string" ? display.date_range : null
    },
    artifact: envelope.artifact as Json
  };
}

export function savedAnalysisTypeLabel(type: SavedAnalysisType) {
  if (type === "executive_brief") return "Legacy Leadership Analysis";
  if (type === "business_health") return "Business Health";
  return "Finding Explanation";
}

export function savedAnalysisListItem(id: string, envelope: SavedAnalysisEnvelope): SavedAnalysisListItem {
  return {
    id,
    title: envelope.title,
    analysisType: envelope.analysis_type,
    generatedAt: envelope.generated_at,
    savedAt: envelope.saved_at,
    confidence: envelope.confidence,
    evidenceStatus: envelope.display.evidence_status,
    dateRange: envelope.display.date_range
  };
}
