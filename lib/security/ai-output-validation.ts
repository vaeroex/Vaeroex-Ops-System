import "server-only";

import type { Json } from "@/lib/supabase/types";

type ValidationResult = {
  ok: boolean;
  reason?: string;
};

const FORBIDDEN_OUTPUT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(ignore|bypass)\s+(all\s+)?(previous|system|developer|security)\s+instructions\b/i,
    reason: "Output attempted to bypass prompt or security instructions."
  },
  {
    pattern: /\b(execute|run)\s+(raw\s+)?sql\b/i,
    reason: "Output attempted to execute SQL."
  },
  {
    pattern: /\b(drop|truncate)\s+table\b/i,
    reason: "Output attempted destructive database instructions."
  },
  {
    pattern: /\bdelete\s+(all|every)\s+(files?|records?|kpis?|reports?|users?|workspaces?|business\s+memory|source\s+data)\b/i,
    reason: "Output attempted bulk destructive deletion."
  },
  {
    pattern: /\b(reveal|print|show|exfiltrate)\s+(the\s+)?(system\s+prompt|api\s+key|secret|environment\s+variables?|service\s+role)\b/i,
    reason: "Output attempted to reveal hidden prompts or secrets."
  },
  {
    pattern: /\b(change|update|modify)\s+(stripe|billing|pricing|subscription|rls|security\s+policy|environment\s+variables?)\b/i,
    reason: "Output attempted privileged billing, configuration, or security changes."
  },
  {
    pattern: /\b(call|invoke|use)\s+(the\s+)?(admin|system|database)\s+tool\b/i,
    reason: "Output attempted to invoke a privileged tool."
  }
];

function collectStrings(value: Json, path = "$", output: Array<{ path: string; value: string }> = []) {
  if (typeof value === "string") {
    output.push({ path, value });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectStrings(item as Json, `${path}.${key}`, output));
  }

  return output;
}

export function validateAiGeneratedOutput(output: Json): ValidationResult {
  for (const item of collectStrings(output)) {
    for (const rule of FORBIDDEN_OUTPUT_PATTERNS) {
      if (rule.pattern.test(item.value)) {
        return {
          ok: false,
          reason: `${rule.reason} Field: ${item.path}.`
        };
      }
    }
  }

  return { ok: true };
}
