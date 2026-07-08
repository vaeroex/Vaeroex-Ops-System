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
const SOURCE_REFERENCE_KEYS = new Set(["source_id", "source_file_id", "file_id", "report_id", "kpi_id", "run_id", "chunk_id"]);
const CITATION_COLLECTION_KEYS = new Set(["citation", "citations", "source_reference", "source_references", "evidence_reference", "evidence_references"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validateSourceCitations(value: Json, path = "$"): ValidationResult {
  if (Array.isArray(value)) {
    if (path.split(".").some((segment) => CITATION_COLLECTION_KEYS.has(segment.toLowerCase())) && value.length > 25) {
      return {
        ok: false,
        reason: `Too many source citations were generated. Field: ${path}.`
      };
    }

    for (const [index, item] of value.entries()) {
      const result = validateSourceCitations(item, `${path}[${index}]`);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true };
  }

  if (!value || typeof value !== "object") {
    return { ok: true };
  }

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const itemPath = `${path}.${key}`;

    if (SOURCE_REFERENCE_KEYS.has(normalizedKey) && typeof item === "string" && item.trim() && !UUID_PATTERN.test(item.trim())) {
      return {
        ok: false,
        reason: `Source citation IDs must be valid record IDs, not free-form instructions. Field: ${itemPath}.`
      };
    }

    if (CITATION_COLLECTION_KEYS.has(normalizedKey) && typeof item === "string" && item.length > 500) {
      return {
        ok: false,
        reason: `Source citation text is too long to be trustworthy. Field: ${itemPath}.`
      };
    }

    const result = validateSourceCitations(item as Json, itemPath);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
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

  return validateSourceCitations(output);
}
