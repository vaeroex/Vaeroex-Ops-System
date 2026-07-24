export const EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID = "executive_kpi_analysis_v1" as const;
export const EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION = "executive_kpi_analysis_v2" as const;
export const EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION = "executive_kpi_analysis_validator_v2" as const;

export const EXECUTIVE_KPI_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executive_summary",
    "significant_trends",
    "potential_kpi_relationships",
    "possible_business_drivers",
    "leadership_considerations",
    "analysis_limitations"
  ],
  properties: {
    executive_summary: { type: "string" },
    significant_trends: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metric_ordinals", "statement"],
        properties: {
          metric_ordinals: { type: "array", minItems: 1, items: { type: "integer", minimum: 1 } },
          statement: { type: "string" }
        }
      }
    },
    potential_kpi_relationships: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metric_ordinals", "status", "statement"],
        properties: {
          metric_ordinals: { type: "array", minItems: 2, maxItems: 4, items: { type: "integer", minimum: 1 } },
          status: {
            type: "string",
            enum: ["Pattern worth investigating", "Possible relationship", "Supported correlation", "Strong supported relationship", "No clear relationship detected"]
          },
          statement: { type: "string" }
        }
      }
    },
    possible_business_drivers: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metric_ordinals", "statement"],
        properties: {
          metric_ordinals: { type: "array", minItems: 2, maxItems: 4, items: { type: "integer", minimum: 1 } },
          statement: { type: "string" }
        }
      }
    },
    leadership_considerations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" }
    },
    analysis_limitations: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" }
    }
  }
} as const;

export type ExecutiveKpiRelationshipStatus =
  | "observed_movement_only"
  | "correlated"
  | "statistically_meaningful"
  | "not_established";

export type ExecutiveKpiAnalysisModelOutput = Readonly<{
  executive_summary: string;
  significant_trends: readonly Readonly<{ metric_ordinals: readonly number[]; statement: string }>[];
  potential_kpi_relationships: readonly Readonly<{
    metric_ordinals: readonly number[];
    status: "Pattern worth investigating" | "Possible relationship" | "Supported correlation" | "Strong supported relationship" | "No clear relationship detected";
    statement: string;
  }>[];
  possible_business_drivers: readonly Readonly<{ metric_ordinals: readonly number[]; statement: string }>[];
  leadership_considerations: readonly string[];
  analysis_limitations: readonly string[];
}>;

export type ExecutiveKpiMetricFact = Readonly<{
  ordinal: number;
  stableKpiIds: readonly string[];
  name: string;
  directionality: "higher_is_better" | "lower_is_better" | "exact_target" | "neutral_contextual";
  trendDirection: "up" | "down" | "flat" | "insufficient_history";
  percentageChange: number | null;
  observationCount: number;
  freshness: "current" | "stale" | "unavailable";
  latestObservedAt: string | null;
  values: readonly Readonly<{
    observedAt: string;
    actualValue: number;
    targetValue: number | null;
    normalizedValue: number;
    percentFromFirst: number | null;
  }>[];
}>;

export type ExecutiveKpiRelationshipFact = Readonly<{
  leftOrdinal: number;
  rightOrdinal: number;
  status: ExecutiveKpiRelationshipStatus;
  movement: "same_direction" | "opposite_direction" | "not_established";
  correlationCoefficient: number | null;
  significanceThreshold: number | null;
  causationEstablished: false;
}>;

export type ExecutiveKpiCitationView = Readonly<{
  citationId: number;
  sourceLabel: string;
  sourceType: "Uploaded evidence" | "KPI record";
  metricOrdinals: readonly number[];
  recordedAt: string | null;
}>;

export type ExecutiveKpiAnalysisFacts = Readonly<{
  timeframe: string;
  startDate: string;
  endDate: string;
  mode: "actual" | "percent" | "normalized";
  confidenceLabel: string;
  confidenceScore: number;
  metrics: readonly ExecutiveKpiMetricFact[];
  relationships: readonly ExecutiveKpiRelationshipFact[];
  limitations: readonly string[];
  deterministicFallback: readonly string[];
}>;

export type ExecutiveKpiAnalysisPackage = Readonly<{
  contractId: typeof EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID;
  contractVersion: typeof EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION;
  validatorVersion: typeof EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION;
  workspaceId: string;
  fingerprint: string;
  facts: ExecutiveKpiAnalysisFacts;
  citations: readonly ExecutiveKpiCitationView[];
}>;

export type ExecutiveKpiAnalysisArtifact = Readonly<{
  contractId: typeof EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID;
  contractVersion: typeof EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION;
  validatorVersion: typeof EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION;
  fingerprint: string;
  generatedAt: string;
  analysis: ExecutiveKpiAnalysisModelOutput;
  facts: ExecutiveKpiAnalysisFacts;
  citations: readonly ExecutiveKpiCitationView[];
  providerAttribution: Readonly<{
    provider: "openai" | "nvidia";
    model: string;
    fallbackUsed: boolean;
    providerPolicyId: string;
  }>;
}>;

export type ExecutiveKpiAnalysisViewArtifact = Omit<ExecutiveKpiAnalysisArtifact, "providerAttribution">;

export type ExecutiveKpiAnalysisState = Readonly<{
  status: "available" | "current" | "loading" | "failed" | "unavailable" | "insufficient_evidence";
  artifact: ExecutiveKpiAnalysisViewArtifact | null;
  message: string | null;
}>;
