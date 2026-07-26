export const BUSINESS_NOTE_EXTRACTION_CONTRACT_ID = "business_note_extraction_v1" as const;
export const BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION = "business_note_extraction_v1" as const;
export const BUSINESS_NOTE_EXTRACTION_VALIDATOR_VERSION = "business_note_extraction_validator_v2" as const;
export const BUSINESS_NOTE_EXTRACTION_POLICY_SELECTOR = "gpt56_luna_terra_v1" as const;
export const BUSINESS_NOTE_EXTRACTION_POLICY_ID = "business_note_gpt56_luna_terra_v2" as const;
export const BUSINESS_NOTE_MAX_CHARACTERS = 20_000;

export const BUSINESS_NOTE_TYPES = [
  "observation",
  "concern",
  "assumption",
  "decision",
  "incident",
  "meeting_outcome",
  "idea",
  "question",
  "mixed"
] as const;

export const BUSINESS_NOTE_SOURCE_CLASSIFICATIONS = [
  "executive_observation",
  "manager_observation",
  "employee_observation",
  "meeting_notes",
  "incident_note",
  "general_business_note"
] as const;

export const BUSINESS_NOTE_EVIDENCE_TREATMENTS = ["context_only", "potentially_supporting"] as const;
export const BUSINESS_NOTE_EXTRACTION_DISPOSITIONS = ["extractable", "no_business_context", "too_ambiguous"] as const;

export type BusinessNoteType = (typeof BUSINESS_NOTE_TYPES)[number];
export type BusinessNoteSourceClassification = (typeof BUSINESS_NOTE_SOURCE_CLASSIFICATIONS)[number];
export type BusinessNoteEvidenceTreatment = (typeof BUSINESS_NOTE_EVIDENCE_TREATMENTS)[number];
export type BusinessNoteExtractionDisposition = (typeof BUSINESS_NOTE_EXTRACTION_DISPOSITIONS)[number];
export type BusinessNoteReleaseChannel = "production" | "preview" | "development";
export type BusinessNoteStatus = "draft" | "extracting" | "review_required" | "approved" | "rejected" | "extraction_failed" | "archived";
export type BusinessNoteReviewWarningCode =
  | "low_confidence"
  | "reporting_period_unclear"
  | "department_needs_confirmation";

export type BusinessNoteReviewWarning = Readonly<{
  code: BusinessNoteReviewWarningCode;
  label: string;
}>;

export type BusinessNoteQuotedEntity = Readonly<{
  name: string;
  sourceQuote: string;
}>;

export type BusinessNoteQuotedStatement = Readonly<{
  statement: string;
  sourceQuote: string;
  confidence: number;
}>;

export type BusinessNoteQuotedDescription = Readonly<{
  description: string;
  sourceQuote: string;
  confidence: number;
}>;

export type BusinessNoteMentionedMetric = Readonly<{
  name: string;
  value: number | null;
  unit: string | null;
  sourceQuote: string;
  confidence: number;
}>;

export type BusinessNoteExtraction = Readonly<{
  schemaVersion: typeof BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION;
  extractionDisposition: BusinessNoteExtractionDisposition;
  title: string;
  summary: string;
  noteType: BusinessNoteType;
  sourceClassification: BusinessNoteSourceClassification;
  departments: readonly string[];
  topics: readonly string[];
  peopleMentioned: readonly BusinessNoteQuotedEntity[];
  customersMentioned: readonly BusinessNoteQuotedEntity[];
  vendorsMentioned: readonly BusinessNoteQuotedEntity[];
  projectsMentioned: readonly BusinessNoteQuotedEntity[];
  explicitFacts: readonly BusinessNoteQuotedStatement[];
  opinionsOrAssumptions: readonly BusinessNoteQuotedStatement[];
  risks: readonly BusinessNoteQuotedDescription[];
  opportunities: readonly BusinessNoteQuotedDescription[];
  decisions: readonly BusinessNoteQuotedDescription[];
  mentionedMetrics: readonly BusinessNoteMentionedMetric[];
  reportingPeriod: Readonly<{
    start: string | null;
    end: string | null;
    inferred: boolean;
    sourceQuote: string | null;
  }>;
  evidenceTreatment: BusinessNoteEvidenceTreatment;
  extractionConfidence: number;
  missingContext: readonly string[];
}>;

export type BusinessNoteSourceSpan = Readonly<{
  path: string;
  quote: string;
  start: number;
  end: number;
}>;

export const BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS = [
  "reporting_period",
  "delay_duration",
  "department",
  "location",
  "relevant_team",
  "organization_name",
  "incident_identifier"
] as const;

export type BusinessNoteAdditionalContextKey = (typeof BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS)[number];

export type BusinessNoteAdditionalContextPrompt = Readonly<{
  key: BusinessNoteAdditionalContextKey;
  label: string;
  placeholder: string;
}>;

export type BusinessNoteUserAddedContext = Readonly<{
  field: BusinessNoteAdditionalContextKey;
  label: string;
  value: string;
  provenance: "supplied_during_review";
  userProvided: true;
  partOfOriginalNoteQuotation: false;
  evidenceTreatment: "contextual_metadata";
}>;

export type BusinessNoteReviewCorrections = Readonly<{
  title: string;
  noteType: BusinessNoteType;
  departments: readonly string[];
  topics: readonly string[];
  reportingPeriod: Readonly<{ start: string | null; end: string | null }>;
  removedItemPaths: readonly string[];
  userAddedContext: readonly BusinessNoteUserAddedContext[];
}>;

const quotedEntitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "sourceQuote"],
  properties: {
    name: { type: "string" },
    sourceQuote: { type: "string" }
  }
} as const;

const quotedStatementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statement", "sourceQuote", "confidence"],
  properties: {
    statement: { type: "string" },
    sourceQuote: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

const quotedDescriptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "sourceQuote", "confidence"],
  properties: {
    description: { type: "string" },
    sourceQuote: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

export const BUSINESS_NOTE_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "extractionDisposition",
    "title",
    "summary",
    "noteType",
    "sourceClassification",
    "departments",
    "topics",
    "peopleMentioned",
    "customersMentioned",
    "vendorsMentioned",
    "projectsMentioned",
    "explicitFacts",
    "opinionsOrAssumptions",
    "risks",
    "opportunities",
    "decisions",
    "mentionedMetrics",
    "reportingPeriod",
    "evidenceTreatment",
    "extractionConfidence",
    "missingContext"
  ],
  properties: {
    schemaVersion: { type: "string", const: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION },
    extractionDisposition: { type: "string", enum: BUSINESS_NOTE_EXTRACTION_DISPOSITIONS },
    title: { type: "string" },
    summary: { type: "string" },
    noteType: { type: "string", enum: BUSINESS_NOTE_TYPES },
    sourceClassification: { type: "string", enum: BUSINESS_NOTE_SOURCE_CLASSIFICATIONS },
    departments: { type: "array", items: { type: "string" } },
    topics: { type: "array", items: { type: "string" } },
    peopleMentioned: { type: "array", items: quotedEntitySchema },
    customersMentioned: { type: "array", items: quotedEntitySchema },
    vendorsMentioned: { type: "array", items: quotedEntitySchema },
    projectsMentioned: { type: "array", items: quotedEntitySchema },
    explicitFacts: { type: "array", items: quotedStatementSchema },
    opinionsOrAssumptions: { type: "array", items: quotedStatementSchema },
    risks: { type: "array", items: quotedDescriptionSchema },
    opportunities: { type: "array", items: quotedDescriptionSchema },
    decisions: { type: "array", items: quotedDescriptionSchema },
    mentionedMetrics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "unit", "sourceQuote", "confidence"],
        properties: {
          name: { type: "string" },
          value: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          sourceQuote: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    reportingPeriod: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end", "inferred", "sourceQuote"],
      properties: {
        start: { type: ["string", "null"] },
        end: { type: ["string", "null"] },
        inferred: { type: "boolean" },
        sourceQuote: { type: ["string", "null"] }
      }
    },
    evidenceTreatment: { type: "string", enum: BUSINESS_NOTE_EVIDENCE_TREATMENTS },
    extractionConfidence: { type: "number", minimum: 0, maximum: 1 },
    missingContext: { type: "array", items: { type: "string" } }
  }
} as const;
