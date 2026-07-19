import "server-only";

import type { AIValidationReasonCode, AIValidationStage } from "@/lib/ai/validation-diagnostics";

export const QUALIFICATION_CONTRACT_IDS = [
  "business_health_explanation_v1",
  "executive_brief_benchmark_v1",
  "leadership_priorities_benchmark_v1"
] as const;

export type QualificationContractId = (typeof QUALIFICATION_CONTRACT_IDS)[number];
export type QualificationProvider = "nvidia" | "openai";

export type QualificationReasoningMode =
  | "disabled"
  | "bounded"
  | "default"
  | "extended";

export type QualificationModelProfile = Readonly<{
  id: string;
  provider: QualificationProvider;
  model: string;
  reasoningMode: QualificationReasoningMode;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  systemPrefix?: string;
  requestExtensions?: Readonly<Record<string, unknown>>;
}>;
export type QualificationFixture = Readonly<{
  id: string;
  contractId: QualificationContractId;
  fingerprint: string;
  systemPrompt: string;
  input: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  validate(value: unknown): QualificationValidation;
}>;

export type QualificationValidation =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reasonCode: AIValidationReasonCode;
      stage: AIValidationStage;
      expectedField?: string;
    }>;

export type QualificationProbeResult = Readonly<{
  benchmarkVersion: "nvidia_capability_stage_1_v1";
  profileId: string;
  provider: QualificationProvider;
  model: string;
  reasoningMode: QualificationReasoningMode;
  contractId: QualificationContractId;
  fixtureFingerprint: string;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
  contractValid: boolean;
  validationReasonCode: AIValidationReasonCode | null;
  validationStage: AIValidationStage | null;
  finishReason: string | null;
  truncationDetected: boolean;
  reasoningContentDetected: boolean;
  latencyMs: number;
  firstByteMs: number | null;
  firstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  tokenCountsEstimated: boolean;
  outputCharacters: number;
  transportFailureCode:
    | "missing_credentials"
    | "timeout"
    | "rate_limit"
    | "unavailable"
    | "malformed_transport"
    | "transport_failure"
    | null;
}>;
