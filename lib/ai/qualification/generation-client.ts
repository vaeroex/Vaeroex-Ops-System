import "server-only";

import { getAIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { OpenAIProvider } from "@/lib/ai/providers/openai-provider";
import type { QualificationModelProfile } from "@/lib/ai/qualification/types";
import { estimateTokenCount } from "@/lib/ai/usage";

const NVIDIA_CHAT_COMPLETIONS_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

type GenerationTransportResult = Readonly<{
  content: string;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
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
  transportFailureCode:
    | "missing_credentials"
    | "timeout"
    | "rate_limit"
    | "unavailable"
    | "malformed_transport"
    | "transport_failure"
    | null;
}>;

type NvidiaStreamPayload = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

function failureCode(status: number) {
  if (status === 429) return "rate_limit" as const;
  if (status === 404 || status === 410 || status === 422) return "unavailable" as const;
  return "transport_failure" as const;
}
function systemPrompt(profile: QualificationModelProfile, prompt: string) {
  return profile.systemPrefix ? `${profile.systemPrefix}\n${prompt}` : prompt;
}

function estimatedTokenCounts(prompt: string, content: string, output: string) {
  return {
    input: estimateTokenCount(`${prompt}\n${content}`),
    output: estimateTokenCount(output)
  };
}

async function runNvidiaGeneration({
  profile,
  prompt,
  content,
  timeoutMs
}: {
  profile: QualificationModelProfile;
  prompt: string;
  content: string;
  timeoutMs: number;
}): Promise<GenerationTransportResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    return {
      content: "",
      endpointHealthy: false,
      httpStatus: null,
      completed: false,
      finishReason: null,
      truncationDetected: false,
      reasoningContentDetected: false,
      latencyMs: 0,
      firstByteMs: null,
      firstTokenMs: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      tokenCountsEstimated: true,
      transportFailureCode: "missing_credentials"
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NVIDIA_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: profile.model,
        messages: [
          { role: "system", content: systemPrompt(profile, prompt) },
          { role: "user", content }
        ],
        temperature: profile.temperature,
        top_p: profile.topP,
        max_tokens: profile.maxOutputTokens,
        frequency_penalty: 0,
        presence_penalty: 0,
        stream: true,
        ...profile.requestExtensions
      }),
      cache: "no-store",
      signal: controller.signal
    });
    const firstByteMs = Date.now() - startedAt;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        content: "",
        endpointHealthy: false,
        httpStatus: response.status,
        completed: false,
        finishReason: null,
        truncationDetected: false,
        reasoningContentDetected: false,
        latencyMs: Date.now() - startedAt,
        firstByteMs,
        firstTokenMs: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        tokenCountsEstimated: true,
        transportFailureCode: failureCode(response.status)
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.body) {
      return {
        content: "",
        endpointHealthy: true,
        httpStatus: response.status,
        completed: false,
        finishReason: null,
        truncationDetected: false,
        reasoningContentDetected: false,
        latencyMs: Date.now() - startedAt,
        firstByteMs,
        firstTokenMs: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        tokenCountsEstimated: true,
        transportFailureCode: "malformed_transport"
      };
    }

    let output = "";
    let firstTokenMs: number | null = null;
    let finishReason: string | null = null;
    let reasoningContentDetected = false;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let reasoningTokens: number | null = null;

    if (contentType.includes("text/event-stream")) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let payload: NvidiaStreamPayload;
          try {
            payload = JSON.parse(data) as NvidiaStreamPayload;
          } catch {
            continue;
          }
          const choice = payload.choices?.[0];
          const delta = choice?.delta;
          const visible = delta?.content || "";
          const reasoning = delta?.reasoning_content || delta?.reasoning || "";
          if ((visible || reasoning) && firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
          if (visible) output += visible;
          if (reasoning) reasoningContentDetected = true;
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (payload.usage) {
            inputTokens = payload.usage.prompt_tokens ?? inputTokens;
            outputTokens = payload.usage.completion_tokens ?? outputTokens;
            reasoningTokens = payload.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
          }
        }
      }
    } else {
      let payload: NvidiaStreamPayload;
      try {
        payload = JSON.parse(await new Response(response.body).text()) as NvidiaStreamPayload;
      } catch {
        payload = {};
      }
      const choice = payload.choices?.[0];
      output = choice?.message?.content || "";
      reasoningContentDetected = Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning);
      firstTokenMs = output || reasoningContentDetected ? firstByteMs : null;
      finishReason = choice?.finish_reason || null;
      inputTokens = payload.usage?.prompt_tokens ?? null;
      outputTokens = payload.usage?.completion_tokens ?? null;
      reasoningTokens = payload.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    }

    const estimates = estimatedTokenCounts(systemPrompt(profile, prompt), content, output);
    return {
      content: output,
      endpointHealthy: true,
      httpStatus: response.status,
      completed: Boolean(output),
      finishReason,
      truncationDetected: finishReason === "length",
      reasoningContentDetected,
      latencyMs: Date.now() - startedAt,
      firstByteMs,
      firstTokenMs,
      inputTokens: inputTokens ?? estimates.input,
      outputTokens: outputTokens ?? estimates.output,
      reasoningTokens,
      tokenCountsEstimated: inputTokens === null || outputTokens === null,
      transportFailureCode: output ? null : "malformed_transport"
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return {
      content: "",
      endpointHealthy: !timedOut,
      httpStatus: null,
      completed: false,
      finishReason: null,
      truncationDetected: false,
      reasoningContentDetected: false,
      latencyMs: Date.now() - startedAt,
      firstByteMs: null,
      firstTokenMs: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      tokenCountsEstimated: true,
      transportFailureCode: timedOut ? "timeout" : "transport_failure"
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runOpenAIGeneration({
  profile,
  prompt,
  content,
  timeoutMs
}: {
  profile: QualificationModelProfile;
  prompt: string;
  content: string;
  timeoutMs: number;
}): Promise<GenerationTransportResult> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return {
      content: "",
      endpointHealthy: false,
      httpStatus: null,
      completed: false,
      finishReason: null,
      truncationDetected: false,
      reasoningContentDetected: false,
      latencyMs: 0,
      firstByteMs: null,
      firstTokenMs: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      tokenCountsEstimated: true,
      transportFailureCode: "missing_credentials"
    };
  }
  const provider = new OpenAIProvider();
  try {
    const result = await provider.generate({
      model: profile.model,
      systemPrompt: prompt,
      userContent: [{ type: "text", text: content }],
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens,
      settings: {
        ...getAIProviderRetrySettings("openai"),
        timeoutMs,
        maxRetries: 0
      }
    });
    return {
      content: result.content,
      endpointHealthy: true,
      httpStatus: 200,
      completed: Boolean(result.content),
      finishReason: result.finishReason,
      truncationDetected: result.truncationDetected,
      reasoningContentDetected: false,
      latencyMs: result.latencyMs,
      firstByteMs: null,
      firstTokenMs: null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: null,
      tokenCountsEstimated: false,
      transportFailureCode: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const timedOut = message.includes("timed out") || message.includes("aborted");
    const rateLimited = message.includes("rate limit");
    return {
      content: "",
      endpointHealthy: !timedOut,
      httpStatus: rateLimited ? 429 : null,
      completed: false,
      finishReason: null,
      truncationDetected: false,
      reasoningContentDetected: false,
      latencyMs: timeoutMs,
      firstByteMs: null,
      firstTokenMs: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      tokenCountsEstimated: true,
      transportFailureCode: timedOut ? "timeout" : rateLimited ? "rate_limit" : "transport_failure"
    };
  }
}

export async function runQualificationGeneration({
  profile,
  prompt,
  content,
  timeoutMs
}: {
  profile: QualificationModelProfile;
  prompt: string;
  content: string;
  timeoutMs: number;
}) {
  return profile.provider === "nvidia"
    ? runNvidiaGeneration({ profile, prompt, content, timeoutMs })
    : runOpenAIGeneration({ profile, prompt, content, timeoutMs });
}
