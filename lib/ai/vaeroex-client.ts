import { VAEROEX_SYSTEM_PROMPT } from "@/lib/ai/prompts/vaeroex-system-prompt";
import type { VaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import type { Json } from "@/lib/supabase/types";

type RunVaeroexRequest = {
  workflow: VaeroexWorkflow;
  userPrompt: string;
  workspaceSnapshot: Json;
  extraInputs?: Json;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function parseVaeroexJson(content: string): Json {
  try {
    return JSON.parse(content) as Json;
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as Json;
      } catch {
        // Fall through to a safe text wrapper.
      }
    }
  }

  return {
    title: "Vaeroex response",
    summary: content.slice(0, 280),
    response_markdown: content,
    suggested_tasks: [],
    save_recommendations: []
  } satisfies Json;
}

export async function runVaeroexCompletion({
  workflow,
  userPrompt,
  workspaceSnapshot,
  extraInputs = {}
}: RunVaeroexRequest) {
  if (!VAEROEX_SYSTEM_PROMPT.trim()) {
    throw new Error("Vaeroex prompt is not configured.");
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${VAEROEX_SYSTEM_PROMPT}\n\nWorkflow instructions:\n${workflow.instructions}`
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              workflow: workflow.key,
              user_request: userPrompt || workflow.promptPlaceholder,
              extra_inputs: extraInputs,
              workspace_context: workspaceSnapshot
            },
            null,
            2
          )
        }
      ]
    })
  });

  const payload = (await response.json()) as ChatCompletionResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || "Vaeroex could not complete the request.");
  }

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Vaeroex returned an empty response.");
  }

  return parseVaeroexJson(content);
}
