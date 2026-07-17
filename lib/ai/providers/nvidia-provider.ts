import "server-only";

import { consumeAIProviderResponse, isRetryableAIProviderStatus } from "@/lib/ai/provider-resilience";
import { AIProviderError, type AIProvider, type AIProviderRequest } from "@/lib/ai/providers/types";

const NVIDIA_CHAT_COMPLETIONS_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

type NvidiaPayload = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

function extractContent(payload: NvidiaPayload) {
  if (payload.choices?.[0]?.finish_reason === "length") {
    throw new AIProviderError("NVIDIA returned an incomplete response.", "nvidia", true);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text || "").join("").trim();
  return "";
}

export class NvidiaProvider implements AIProvider {
  readonly name = "nvidia" as const;
  readonly supportsAttachments = false;

  isConfigured() {
    return Boolean(process.env.NVIDIA_API_KEY?.trim());
  }

  async generate(request: AIProviderRequest) {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();
    if (!apiKey) throw new AIProviderError("NVIDIA API key is not configured.", "nvidia", false);
    if (request.userContent.some((part) => part.type !== "text")) {
      throw new AIProviderError("The selected NVIDIA model does not support this attachment input.", "nvidia", false);
    }

    const interactiveExecutive = request.generationMode === "interactive_executive";
    const startedAt = Date.now();
    const { response, value: payload } = await consumeAIProviderResponse("nvidia", NVIDIA_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: interactiveExecutive ? `/no_think\n${request.systemPrompt}` : request.systemPrompt },
          { role: "user", content: request.userContent.map((part) => part.type === "text" ? part.text : "").join("\n") }
        ],
        temperature: interactiveExecutive ? 0 : request.temperature,
        ...(!interactiveExecutive ? { top_p: 0.95 } : {}),
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: false
      })
    }, async (providerResponse) => {
      const body = await providerResponse.text();
      try {
        return JSON.parse(body) as NvidiaPayload;
      } catch {
        return {} as NvidiaPayload;
      }
    }, { ...request.settings, maxRetries: 0 });

    if (!response.ok) {
      throw new AIProviderError(
        response.status === 429 ? "NVIDIA is temporarily rate limited." : "NVIDIA could not complete the request.",
        "nvidia",
        isRetryableAIProviderStatus(response.status),
        response.status
      );
    }

    const content = extractContent(payload);
    if (!content) throw new AIProviderError("NVIDIA returned an empty response.", "nvidia", true);
    const inputTokens = payload.usage?.prompt_tokens || 0;
    const outputTokens = payload.usage?.completion_tokens || 0;

    return {
      content,
      requestId: response.headers.get("x-request-id") || response.headers.get("nv-request-id"),
      latencyMs: Date.now() - startedAt,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: payload.usage?.total_tokens || inputTokens + outputTokens
      }
    };
  }
}
