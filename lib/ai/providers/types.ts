import "server-only";

import type { AIProviderRetrySettings } from "@/lib/ai/provider-resilience";

export type AIProviderName = "openai" | "nvidia";
export type AIGenerationMode = "default" | "interactive_executive";
export type AIProviderErrorCode =
  | "transport_failure"
  | "empty_response"
  | "refusal"
  | "configuration"
  | "unsupported_input";
export type AIReasoningMode = "standard" | "pro";
export type AIReasoningEffort = "low" | "medium" | "high";

export type AIProviderReasoning = Readonly<{
  mode: AIReasoningMode;
  effort: AIReasoningEffort;
}>;

export type AIProviderStructuredOutput = Readonly<{
  name: string;
  schema: Readonly<Record<string, unknown>>;
  strict: true;
}>;

export type AIProviderInputPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; base64Data: string; detail?: "auto" | "low" | "high" }
  | { type: "file"; fileName: string; mimeType: string; base64Data: string };

export type AIProviderRequest = {
  googleSheetsReadTicketId?: string;
  model: string;
  systemPrompt: string;
  userContent: AIProviderInputPart[];
  temperature?: number;
  topP?: number;
  generationMode?: AIGenerationMode;
  maxOutputTokens?: number;
  reasoning?: AIProviderReasoning;
  structuredOutput?: AIProviderStructuredOutput;
  store?: boolean;
  stream?: false;
  settings: AIProviderRetrySettings;
};

export type AIProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type AIProviderResult = {
  content: string;
  requestId: string | null;
  latencyMs: number;
  usage: AIProviderUsage;
  finishReason: string | null;
  truncationDetected: boolean;
  runtimeModel?: string | null;
};

export type AIEmbeddingResult = {
  model: string;
  embeddings: Array<number[] | null>;
  tokens: number;
  error?: string;
};

export interface AIProvider {
  readonly name: AIProviderName;
  readonly supportsAttachments: boolean;
  isConfigured(): boolean;
  generate(request: AIProviderRequest): Promise<AIProviderResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly provider: AIProviderName,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: AIProviderErrorCode
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export type AIProviderPolicyFailure = "source_authority_unavailable" | "source_access_denied" | "source_changed"
  | "source_attribution" | "provider_configuration" | "provider_not_allowed" | "policy";

export class AIProviderPolicyError extends Error {
  constructor(message: string, readonly reason: AIProviderPolicyFailure = "policy") {
    super(message);
    this.name = "AIProviderPolicyError";
  }
}
