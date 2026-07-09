export const SECURITY_RESPONSE_MESSAGE =
  "This request cannot be performed because it conflicts with platform security requirements.";

export const SECURITY_RESPONSE_TITLE = "🛡 Action Blocked";

export const SECURITY_RESPONSE_OUTPUT = {
  security_response: true,
  blocked: true,
  title: SECURITY_RESPONSE_TITLE,
  message: SECURITY_RESPONSE_MESSAGE,
  files_modified: 0,
  business_memory_modified: 0,
  reports_modified: 0,
  kpis_modified: 0,
  workspace_modified: 0
} as const;

const SECURITY_RESPONSE_PATTERNS = [
  /\baction blocked\b/i,
  /\bsecurity policy\b/i,
  /\bsecurity requirements\b/i,
  /\bblocked by vaeroex\b/i,
  /\bunsafe generated response\b/i,
  /\bunsafe output\b/i,
  /\bunknown tool name\b/i,
  /\btool arguments failed\b/i,
  /\bstrict schema validation\b/i,
  /\buser role is not allowed\b/i,
  /\bexplicit user confirmation\b/i,
  /\bdestructive actions cannot\b/i,
  /\bprivileged actions cannot\b/i,
  /\bblocked or suspicious actions\b/i,
  /\brow-level security\b/i,
  /\bpermission denied\b/i,
  /\bprivilege escalation\b/i,
  /\bcross-workspace\b/i,
  /\banother customer workspace\b/i,
  /\bworkspace access is required\b/i,
  /\bdo not have permission\b/i,
  /\bnot authorized\b/i,
  /\bnot allowed to execute\b/i,
  /\breveal hidden prompts\b/i,
  /\bsystem prompt\b/i,
  /\bprompt injection\b/i,
  /\bsecret disclosure\b/i,
  /\btool execution\b/i
];

const SECURITY_REQUEST_PATTERNS = [
  /\b(ignore|bypass|override|forget)\s+(all\s+)?(previous|system|developer|security)\s+instructions\b/i,
  /\b(reveal|show|print|display|dump|return|exfiltrate)\s+(the\s+)?(system\s+prompt|developer\s+message|hidden\s+instructions?|api\s+key|secret|service\s+role|environment\s+variables?)\b/i,
  /\b(delete|remove|wipe|erase|destroy)\s+(all|every|workspace|business\s+memory|reports?|files?|kpis?|records?|users?|customer\s+data)\b/i,
  /\b(delete|remove|wipe|erase|destroy)\s+(this|that|the|selected|current|my|a|an)?\s*(file|report|kpi|record|workspace|business\s+memory|source|generated\s+insight|briefing)s?\b/i,
  /\b(manipulate|poison|overwrite|alter|modify)\s+(business\s+memory|evidence|source\s+data|workspace\s+memory)\b/i,
  /\b(drop|truncate|alter)\s+(table|database|schema)\b/i,
  /\b(run|execute)\s+(raw\s+)?sql\b/i,
  /\b(change|modify|disable|bypass)\s+(rls|row\s+level\s+security|permissions?|roles?|billing|subscription|security\s+policy)\b/i,
  /\b(access|show|open|retrieve)\s+(another|other|different)\s+(workspace|customer|tenant|company)\b/i,
  /\b(another|other|different)\s+(customer\s+)?(workspace|tenant|company)\b/i,
  /\bcross[-\s]?workspace\b/i,
  /\bprivilege\s+escalation\b/i,
  /\btool\s+execution\b.*\b(delete|admin|system|database|billing)\b/i
];

export function isSecurityResponseMessage(message?: string | null) {
  const value = String(message || "").trim();

  if (!value) {
    return false;
  }

  return SECURITY_RESPONSE_PATTERNS.some((pattern) => pattern.test(value));
}

export function securityResponseMessage() {
  return SECURITY_RESPONSE_MESSAGE;
}

export function securityResponseOutput() {
  return { ...SECURITY_RESPONSE_OUTPUT };
}

export function isSecurityResponseOutput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.security_response === true ||
    record.blocked === true ||
    isSecurityResponseMessage(typeof record.title === "string" ? record.title : "") ||
    isSecurityResponseMessage(typeof record.message === "string" ? record.message : "") ||
    isSecurityResponseMessage(typeof record.error === "string" ? record.error : "") ||
    isSecurityResponseMessage(typeof record.response_markdown === "string" ? record.response_markdown : "") ||
    isSecurityResponseMessage(typeof record.executive_summary === "string" ? record.executive_summary : "")
  );
}

export function isSecuritySensitiveRequest(value?: string | null) {
  const text = String(value || "").trim();

  if (!text) {
    return false;
  }

  return SECURITY_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}
