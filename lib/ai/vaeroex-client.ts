import "server-only";
import { createHash, randomUUID } from "crypto";
import { cleanVaeroexErrorMessage, VAEROEX_INTELLIGENCE_UNAVAILABLE_MESSAGE } from "@/lib/ai/errors";
import { VAEROEX_SYSTEM_PROMPT } from "@/lib/ai/prompts/vaeroex-system-prompt";
import type { VaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import type { Json } from "@/lib/supabase/types";

type RunVaeroexRequest = {
  workflow: VaeroexWorkflow;
  userPrompt: string;
  workspaceSnapshot: Json;
  extraInputs?: Json;
  fileAttachment?: VaeroexFileAttachment;
};

export type VaeroexFileAttachment = {
  inputType: "image" | "file";
  fileName: string;
  mimeType: string;
  base64Data: string;
  detail?: "auto" | "low" | "high";
};

type ResponsesApiResponse = {
  output_text?: string;
  status?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type JsonRecord = Record<string, unknown>;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const LEGACY_OPENAI_ENV_NAMES = ["OPENAI_APIKEY", "OPENAI_KEY", "NEXT_PUBLIC_OPENAI", "OPENAI_SECRET"];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function normalizeVaeroexOutput(value: Json): Json {
  const output = isRecord(value)
    ? value
    : {
        title: "Vaeroex response",
        summary: String(value || ""),
        response_markdown: String(value || "")
      };
  const executiveSummary =
    str(output.executive_summary) ||
    str(output.summary) ||
    str(output.response_markdown, "Vaeroex completed the request and prepared recommendations for review.");
  const problemsIdentified =
    asArray(output.problems_identified).length ||
    asArray(output.current_operational_problems).length ||
    asArray(output.main_bottlenecks).length
      ? [
          ...asArray(output.problems_identified),
          ...asArray(output.current_operational_problems),
          ...asArray(output.main_bottlenecks)
        ]
      : ["Review the summary for the main operational gaps Vaeroex identified."];
  const recommendedActions =
    asArray(output.recommended_actions).length ||
    asArray(output.suggested_tasks).length ||
    asArray(output.thirty_day_action_plan).length
      ? [
          ...asArray(output.recommended_actions),
          ...asArray(output.suggested_tasks),
          ...asArray(output.thirty_day_action_plan)
        ]
      : ["Review this draft, identify the highest-priority executive recommendation, and decide what leadership should examine next."];
  const suggestedSystems =
    asArray(output.suggested_systems).length ||
    asArray(output.recommended_systems_to_build).length ||
    asArray(output.suggested_forms).length ||
    asArray(output.suggested_checklists).length
      ? [
          ...asArray(output.suggested_systems),
          ...asArray(output.recommended_systems_to_build),
          ...asArray(output.suggested_forms),
          ...asArray(output.suggested_checklists)
        ]
      : ["Executive briefing", "Improvement plan", "Manager review cadence"];

  return {
    ...output,
    executive_summary: executiveSummary,
    problems_identified: problemsIdentified,
    recommended_actions: recommendedActions,
    suggested_systems: suggestedSystems,
    response_markdown: str(output.response_markdown, executiveSummary)
  } as Json;
}

function parseVaeroexJson(content: string): Json {
  try {
    return normalizeVaeroexOutput(JSON.parse(content) as Json);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        return normalizeVaeroexOutput(JSON.parse(jsonMatch[0]) as Json);
      } catch {
        // Fall through to a safe text wrapper.
      }
    }
  }

  return normalizeVaeroexOutput({
    title: "Vaeroex response",
    summary: content.slice(0, 280),
    response_markdown: content,
    suggested_tasks: [],
    save_recommendations: []
  } satisfies Json);
}

function cleanOpenAIError(message: string | undefined, status: number) {
  const cleaned = cleanVaeroexErrorMessage(message);

  if (status === 401 || /api key|authentication|authorization/i.test(message || "")) {
    return VAEROEX_INTELLIGENCE_UNAVAILABLE_MESSAGE;
  }

  return cleaned;
}

function keyFingerprint(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function legacyEnvPresence() {
  return Object.fromEntries(LEGACY_OPENAI_ENV_NAMES.map((name) => [name, Boolean(process.env[name]?.trim())]));
}

function openAIEnvDiagnostics() {
  const openaiApiKey = process.env.OPENAI_API_KEY;

  return {
    openaiApiKeyConfigured: Boolean(openaiApiKey?.trim()),
    keySource: "OPENAI_API_KEY",
    keyFingerprint: keyFingerprint(openaiApiKey),
    legacyEnvPresence: legacyEnvPresence()
  };
}

function logVaeroexOpenAIEvent(event: string, details: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      level: "info",
      component: "vaeroex-openai",
      event,
      ...details
    })
  );
}

function logVaeroexOpenAIError(event: string, details: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      level: "error",
      component: "vaeroex-openai",
      event,
      ...details
    })
  );
}

function extractResponsesContent(payload: ResponsesApiResponse) {
  if (payload.status === "incomplete") {
    throw new Error(`Vaeroex stopped before finishing the answer. Reason: ${payload.incomplete_details?.reason || "incomplete response"}.`);
  }

  if (payload.output_text) {
    return payload.output_text;
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }

      if (content.type === "refusal" && content.refusal) {
        throw new Error(content.refusal);
      }
    }
  }

  return "";
}

function fileDataUrl(attachment: VaeroexFileAttachment) {
  return `data:${attachment.mimeType};base64,${attachment.base64Data}`;
}

function buildUserContent({
  workflow,
  userPrompt,
  workspaceSnapshot,
  extraInputs,
  fileAttachment
}: RunVaeroexRequest) {
  const textInput = JSON.stringify(
    {
      workflow: workflow.key,
      user_request: userPrompt || workflow.promptPlaceholder,
      extra_inputs: extraInputs,
      workspace_context: workspaceSnapshot,
      attached_file: fileAttachment
        ? {
            input_type: fileAttachment.inputType,
            file_name: fileAttachment.fileName,
            mime_type: fileAttachment.mimeType
          }
        : null
    },
    null,
    2
  );

  if (!fileAttachment) {
    return textInput;
  }

  const content: JsonRecord[] = [
    {
      type: "input_text",
      text: textInput
    }
  ];

  if (fileAttachment.inputType === "image") {
    content.push({
      type: "input_image",
      image_url: fileDataUrl(fileAttachment),
      detail: fileAttachment.detail || "auto"
    });
  } else {
    content.push({
      type: "input_file",
      filename: fileAttachment.fileName,
      file_data: fileDataUrl(fileAttachment)
    });
  }

  return content;
}

export function getVaeroexOpenAIRuntimeStatus() {
  const env = openAIEnvDiagnostics();

  return {
    ...env,
    openaiModel: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    openaiApiMode: "responses",
    openaiEndpoint: "/v1/responses",
    responseFormat: "text.format json_object",
    serverOnly: true
  };
}

export async function runVaeroexCompletion({
  workflow,
  userPrompt,
  workspaceSnapshot,
  extraInputs = {},
  fileAttachment
}: RunVaeroexRequest) {
  if (!VAEROEX_SYSTEM_PROMPT.trim()) {
    throw new Error("Vaeroex prompt is not configured.");
  }

  const requestId = randomUUID();
  const env = openAIEnvDiagnostics();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logVaeroexOpenAIError("missing_api_key", {
      requestId,
      ...env,
      openaiApiMode: "responses",
      openaiEndpoint: "/v1/responses"
    });
    throw new Error("OpenAI API key is not configured.");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  logVaeroexOpenAIEvent("request_start", {
    requestId,
    workflow: workflow.key,
    model,
    ...env,
    openaiApiMode: "responses",
    openaiEndpoint: "/v1/responses"
  });

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: [
        {
          role: "system",
          content: `${VAEROEX_SYSTEM_PROMPT}\n\nWorkflow instructions:\n${workflow.instructions}`
        },
        {
          role: "user",
          content: buildUserContent({ workflow, userPrompt, workspaceSnapshot, extraInputs, fileAttachment })
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as ResponsesApiResponse;
  const openaiRequestId = response.headers.get("x-request-id") || response.headers.get("openai-request-id");

  if (!response.ok) {
    logVaeroexOpenAIError("request_failed", {
      requestId,
      workflow: workflow.key,
      model,
      ...env,
      openaiApiMode: "responses",
      openaiEndpoint: "/v1/responses",
      openaiStatus: response.status,
      openaiRequestId,
      openaiErrorMessage: cleanOpenAIError(payload.error?.message, response.status)
    });
    throw new Error(cleanOpenAIError(payload.error?.message, response.status));
  }

  const content = extractResponsesContent(payload);

  if (!content) {
    logVaeroexOpenAIError("empty_response", {
      requestId,
      workflow: workflow.key,
      model,
      ...env,
      openaiApiMode: "responses",
      openaiEndpoint: "/v1/responses",
      openaiStatus: response.status,
      openaiRequestId
    });
    throw new Error("Vaeroex returned an empty response.");
  }

  logVaeroexOpenAIEvent("request_succeeded", {
    requestId,
    workflow: workflow.key,
    model,
    ...env,
    openaiApiMode: "responses",
    openaiEndpoint: "/v1/responses",
    openaiStatus: response.status,
    openaiRequestId
  });

  return parseVaeroexJson(content);
}
