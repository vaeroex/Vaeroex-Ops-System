import "server-only";

import { runQualificationGeneration } from "@/lib/ai/qualification/generation-client";
import type {
  OpenAIModelAccessAudit,
  StageThreeBAssemblyMode,
  StageThreeBProfile,
  StageThreeBTransportResult,
  StageThreeBWorkflowSettings
} from "@/lib/ai/qualification/stage-three-b-types";
import type { QualificationModelProfile } from "@/lib/ai/qualification/types";
import type { StageTwoContractId } from "@/lib/ai/qualification/stage-two-types";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";

type OpenAIResponsesPayload = {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  reasoning?: { effort?: string; mode?: string; context?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};

type JsonSchema = Readonly<Record<string, unknown>>;

const stringField = { type: "string" } as const;
const nullableStringField = { type: ["string", "null"] } as const;
const ordinalArray = {
  type: "array",
  items: { type: "integer", minimum: 1 },
  minItems: 1
} as const;

function baseSchema(contractId: StageTwoContractId): JsonSchema {
  if (contractId === "business_health_explanation_v1") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["executive_interpretation", "why_it_matters", "leadership_consideration", "provisional_hypothesis"],
      properties: {
        executive_interpretation: stringField,
        why_it_matters: stringField,
        leadership_consideration: stringField,
        provisional_hypothesis: nullableStringField
      }
    };
  }
  if (contractId === "leadership_priorities_v1") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["overview", "priorities", "uncertainty"],
      properties: {
        overview: stringField,
        priorities: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ordinal", "emphasis", "sequencing_rationale", "tradeoff"],
            properties: {
              ordinal: { type: "integer", minimum: 1, maximum: 3 },
              emphasis: stringField,
              sequencing_rationale: stringField,
              tradeoff: nullableStringField
            }
          }
        },
        uncertainty: stringField
      }
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "executive_summary",
      "why_it_matters",
      "primary_concern",
      "strongest_positive_signal",
      "leadership_focus",
      "uncertainty",
      "provisional_hypothesis"
    ],
    properties: {
      executive_summary: stringField,
      why_it_matters: stringField,
      primary_concern: nullableStringField,
      strongest_positive_signal: nullableStringField,
      leadership_focus: stringField,
      uncertainty: stringField,
      provisional_hypothesis: nullableStringField
    }
  };
}

export function stageThreeBJsonSchema(contractId: StageTwoContractId, assemblyMode: StageThreeBAssemblyMode): JsonSchema {
  const schema = baseSchema(contractId);
  if (assemblyMode === "one_pass") return schema;
  const properties = { ...(schema.properties as Record<string, unknown>) };
  const required = [...(schema.required as string[])];
  if (contractId === "executive_brief_v1") {
    delete properties.primary_concern;
    delete properties.strongest_positive_signal;
    required.splice(required.indexOf("primary_concern"), 1);
    required.splice(required.indexOf("strongest_positive_signal"), 1);
  }
  required.push("covered_signal_ordinals");
  const additions: Record<string, unknown> = { covered_signal_ordinals: ordinalArray };
  if (contractId === "executive_brief_v1") {
    required.push("primary_concern_ordinal", "strongest_positive_signal_ordinal");
    additions.primary_concern_ordinal = { type: ["integer", "null"], minimum: 1 };
    additions.strongest_positive_signal_ordinal = { type: ["integer", "null"], minimum: 1 };
  }
  return { ...schema, required, properties: { ...properties, ...additions } };
}

function extractOpenAIContent(payload: OpenAIResponsesPayload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) return part.text;
      if (part.type === "refusal" && part.refusal) return "";
    }
  }
  return "";
}

function transportFailure(status: number) {
  if (status === 429) return "rate_limit" as const;
  if (status === 400 || status === 403 || status === 404 || status === 410 || status === 422) return "unavailable" as const;
  return "transport_failure" as const;
}

function emptyTransportResult({
  model,
  settings,
  failureCode,
  latencyMs = 0,
  endpointHealthy = false,
  httpStatus = null
}: {
  model: string;
  settings: StageThreeBWorkflowSettings;
  failureCode: StageThreeBTransportResult["transportFailureCode"];
  latencyMs?: number;
  endpointHealthy?: boolean;
  httpStatus?: number | null;
}): StageThreeBTransportResult {
  return {
    content: "",
    endpointHealthy,
    httpStatus,
    completed: false,
    requestedModel: model,
    runtimeModel: null,
    requestedReasoningEffort: settings.reasoningEffort || null,
    effectiveReasoningEffort: null,
    requestedReasoningMode: settings.reasoningMode || null,
    effectiveReasoningMode: null,
    finishReason: null,
    truncationDetected: false,
    reasoningContentDetected: false,
    latencyMs,
    firstByteMs: null,
    firstTokenMs: null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    tokenCountsEstimated: true,
    transportFailureCode: failureCode
  };
}

async function runOpenAIResponsesGeneration({
  profile,
  settings,
  contractId,
  assemblyMode,
  prompt,
  content
}: {
  profile: StageThreeBProfile;
  settings: StageThreeBWorkflowSettings;
  contractId: StageTwoContractId;
  assemblyMode: StageThreeBAssemblyMode;
  prompt: string;
  content: string;
}): Promise<StageThreeBTransportResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return emptyTransportResult({ model: profile.model, settings, failureCode: "missing_credentials" });

  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: profile.model,
        instructions: prompt,
        input: [{ role: "user", content: [{ type: "input_text", text: content }] }],
        reasoning: {
          effort: settings.reasoningEffort,
          ...(settings.reasoningMode === "pro" ? { mode: "pro" } : {})
        },
        max_output_tokens: settings.maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: `${contractId}_${assemblyMode}`.replace(/[^a-z0-9_]/gi, "_"),
            strict: true,
            schema: stageThreeBJsonSchema(contractId, assemblyMode)
          }
        },
        store: false
      }),
      cache: "no-store",
      signal: controller.signal
    });
    const firstByteMs = Date.now() - startedAt;
    const body = await response.text();
    let payload: OpenAIResponsesPayload = {};
    try {
      payload = JSON.parse(body) as OpenAIResponsesPayload;
    } catch {
      payload = {};
    }
    if (!response.ok) {
      return emptyTransportResult({
        model: profile.model,
        settings,
        failureCode: transportFailure(response.status),
        latencyMs: Date.now() - startedAt,
        endpointHealthy: response.status !== 429 && response.status < 500,
        httpStatus: response.status
      });
    }
    const output = extractOpenAIContent(payload);
    const incomplete = payload.status === "incomplete";
    return {
      content: output,
      endpointHealthy: true,
      httpStatus: response.status,
      completed: Boolean(output),
      requestedModel: profile.model,
      runtimeModel: payload.model || null,
      requestedReasoningEffort: settings.reasoningEffort || null,
      effectiveReasoningEffort: payload.reasoning?.effort || null,
      requestedReasoningMode: settings.reasoningMode || null,
      effectiveReasoningMode: payload.reasoning?.mode || null,
      finishReason: payload.incomplete_details?.reason || payload.status || null,
      truncationDetected: incomplete,
      reasoningContentDetected: (payload.output || []).some((item) => item.type === "reasoning"),
      latencyMs: Date.now() - startedAt,
      firstByteMs,
      firstTokenMs: null,
      inputTokens: payload.usage?.input_tokens ?? null,
      cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null,
      tokenCountsEstimated: !payload.usage,
      transportFailureCode: output ? null : "malformed_transport"
    };
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return emptyTransportResult({
      model: profile.model,
      settings,
      failureCode: timedOut ? "timeout" : "transport_failure",
      latencyMs: Date.now() - startedAt,
      endpointHealthy: !timedOut
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runCompatibleGeneration({
  profile,
  settings,
  prompt,
  content
}: {
  profile: StageThreeBProfile;
  settings: StageThreeBWorkflowSettings;
  prompt: string;
  content: string;
}): Promise<StageThreeBTransportResult> {
  const qualificationProfile: QualificationModelProfile = {
    id: profile.id,
    provider: profile.provider,
    model: profile.model,
    reasoningMode: settings.requestExtensions ? "bounded" : "disabled",
    temperature: settings.temperature,
    topP: settings.topP,
    maxOutputTokens: settings.maxOutputTokens,
    requestExtensions: settings.requestExtensions
  };
  const providerPrompt = profile.provider === "nvidia"
    ? `${prompt}\nThe visible final response must contain only the requested JSON object. Keep hidden reasoning separate from final output.`
    : prompt;
  const result = await runQualificationGeneration({
    profile: qualificationProfile,
    prompt: providerPrompt,
    content,
    timeoutMs: settings.timeoutMs
  });
  return {
    content: result.content,
    endpointHealthy: result.endpointHealthy,
    httpStatus: result.httpStatus,
    completed: result.completed,
    requestedModel: profile.model,
    runtimeModel: result.runtimeModel || profile.model,
    requestedReasoningEffort: null,
    effectiveReasoningEffort: null,
    requestedReasoningMode: null,
    effectiveReasoningMode: null,
    finishReason: result.finishReason,
    truncationDetected: result.truncationDetected,
    reasoningContentDetected: result.reasoningContentDetected,
    latencyMs: result.latencyMs,
    firstByteMs: result.firstByteMs,
    firstTokenMs: result.firstTokenMs,
    inputTokens: result.inputTokens,
    cachedInputTokens: result.cachedInputTokens ?? null,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    tokenCountsEstimated: result.tokenCountsEstimated,
    transportFailureCode: result.transportFailureCode
  };
}

export async function runStageThreeBGeneration({
  profile,
  settings,
  contractId,
  assemblyMode,
  prompt,
  content
}: {
  profile: StageThreeBProfile;
  settings: StageThreeBWorkflowSettings;
  contractId: StageTwoContractId;
  assemblyMode: StageThreeBAssemblyMode;
  prompt: string;
  content: string;
}) {
  return profile.transport === "openai_responses"
    ? runOpenAIResponsesGeneration({ profile, settings, contractId, assemblyMode, prompt, content })
    : runCompatibleGeneration({ profile, settings, prompt, content });
}

export async function auditStageThreeBOpenAIModelAccess(model: OpenAIModelAccessAudit["model"]): Promise<OpenAIModelAccessAudit> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { model, accessible: false, httpStatus: null, runtimeModelId: null, ownedBy: null, failureCode: "missing_credentials" };
  try {
    const response = await fetch(`${OPENAI_MODELS_ENDPOINT}/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; owned_by?: string };
    return {
      model,
      accessible: response.ok && payload.id === model,
      httpStatus: response.status,
      runtimeModelId: typeof payload.id === "string" ? payload.id : null,
      ownedBy: typeof payload.owned_by === "string" ? payload.owned_by : null,
      failureCode: response.ok ? null : response.status === 401 || response.status === 403 ? "denied" : "unavailable"
    };
  } catch {
    return { model, accessible: false, httpStatus: null, runtimeModelId: null, ownedBy: null, failureCode: "transport_failure" };
  }
}
