import "server-only";

import type { AIProviderRetrySettings } from "@/lib/ai/provider-resilience";

export type AIProviderName = "openai" | "nvidia";
export type AIGenerationMode = "default" | "interactive_executive";

export type AIProviderInputPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; base64Data: string; detail?: "auto" | "low" | "high" }
  | { type: "file"; fileName: string; mimeType: string; base64Data: string };

export type AIProviderRequest = {
  model: string;
  systemPrompt: string;
  userContent: AIProviderInputPart[];
  temperature: number;
  generationMode?: AIGenerationMode;
  maxOutputTokens?: number;
  settings: AIProviderRetrySettings;
};

export type AIProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AIProviderResult = {
  content: string;
  requestId: string | null;
  latencyMs: number;
  usage: AIProviderUsage;
  finishReason: string | null;
  truncationDetected: boolean;
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
    readonly status?: number
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export class AIProviderPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderPolicyError";
  }
}
