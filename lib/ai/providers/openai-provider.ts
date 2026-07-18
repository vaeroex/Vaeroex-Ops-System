import "server-only";

import { consumeAIProviderResponse, isRetryableAIProviderStatus } from "@/lib/ai/provider-resilience";
import { AIProviderError, type AIEmbeddingResult, type AIProvider, type AIProviderRequest } from "@/lib/ai/providers/types";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";

type ResponsesPayload = {
  output_text?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

function extractContent(payload: ResponsesPayload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
      if (part.type === "refusal" && part.refusal) throw new AIProviderError("OpenAI declined the request.", "openai", false);
    }
  }
  return "";
}

function dataUrl(mimeType: string, base64Data: string) {
  return `data:${mimeType};base64,${base64Data}`;
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  readonly supportsAttachments = true;

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async generate(request: AIProviderRequest) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new AIProviderError("OpenAI API key is not configured.", "openai", false);

    const userContent = request.userContent.length === 1 && request.userContent[0]?.type === "text"
      ? request.userContent[0].text
      : request.userContent.map((part) => {
          if (part.type === "text") return { type: "input_text", text: part.text };
          if (part.type === "image") return { type: "input_image", image_url: dataUrl(part.mimeType, part.base64Data), detail: part.detail || "auto" };
          return { type: "input_file", filename: part.fileName, file_data: dataUrl(part.mimeType, part.base64Data) };
        });
    const startedAt = Date.now();
    const { response, value: payload } = await consumeAIProviderResponse("openai", OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    }, async (providerResponse) => {
      const body = await providerResponse.text();
      try {
        return JSON.parse(body) as ResponsesPayload;
      } catch {
        return {} as ResponsesPayload;
      }
    }, { ...request.settings, maxRetries: 0 });

    if (!response.ok) {
      throw new AIProviderError(
        response.status === 429 ? "OpenAI is temporarily rate limited." : "OpenAI could not complete the request.",
        "openai",
        isRetryableAIProviderStatus(response.status),
        response.status
      );
    }

    const content = extractContent(payload);
    const truncationDetected = payload.status === "incomplete";
    if (!content && !truncationDetected) throw new AIProviderError("OpenAI returned an empty response.", "openai", true);
    const inputTokens = payload.usage?.input_tokens || 0;
    const outputTokens = payload.usage?.output_tokens || 0;

    return {
      content,
      requestId: response.headers.get("x-request-id") || response.headers.get("openai-request-id"),
      latencyMs: Date.now() - startedAt,
      finishReason: payload.incomplete_details?.reason || payload.status || null,
      truncationDetected,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: payload.usage?.total_tokens || inputTokens + outputTokens
      }
    };
  }

  async createEmbeddings(inputs: string[], model: string, settings: AIProviderRequest["settings"]): Promise<AIEmbeddingResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey || !inputs.length) {
      return { model, embeddings: inputs.map(() => null), tokens: 0, error: apiKey ? undefined : "OpenAI embedding key is not configured." };
    }

    try {
      const { response, value: payload } = await consumeAIProviderResponse("openai", OPENAI_EMBEDDINGS_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: inputs })
      }, async (providerResponse) => {
        const body = await providerResponse.text();
        try {
          return JSON.parse(body) as {
            data?: Array<{ embedding?: number[] }>;
            usage?: { total_tokens?: number; prompt_tokens?: number };
          };
        } catch {
          return {};
        }
      }, settings);
      if (!response.ok) {
        return { model, embeddings: inputs.map(() => null), tokens: 0, error: `Embedding request failed with status ${response.status}.` };
      }
      return {
        model,
        embeddings: inputs.map((_, index) => payload.data?.[index]?.embedding || null),
        tokens: payload.usage?.total_tokens || payload.usage?.prompt_tokens || 0
      };
    } catch (error) {
      return { model, embeddings: inputs.map(() => null), tokens: 0, error: error instanceof Error ? error.message : "Embedding request failed." };
    }
  }
}
