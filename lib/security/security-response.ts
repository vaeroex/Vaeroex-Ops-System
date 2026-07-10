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
  /\brequest denied\b/i,
  /\brequest blocked\b/i,
  /\bsecurity policy\b/i,
  /\bsecurity requirements\b/i,
  /\bblocked by vaeroex\b/i,
  /\bdata deletion not permitted\b/i,
  /\bdeletion not permitted\b/i,
  /\bnot allowed to delete\b/i,
  /\bcannot delete\b/i,
  /\bcan(?:'|’)?t delete\b/i,
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

const LEGACY_SAVED_DENIAL_PATTERNS = [
  /\baction blocked\b/i,
  /\brequest denied\b/i,
  /\brequest blocked\b/i,
  /\bdata deletion not permitted\b/i,
  /\bdeletion not permitted\b/i,
  /\bnot allowed to delete\b/i,
  /\bcannot delete\b/i,
  /\bcan(?:'|’)?t delete\b/i,
  /\bsecurity requirements\b/i
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

export type SecurityIntentCategory =
  | "Business Intelligence"
  | "Educational"
  | "Administrative"
  | "Security Sensitive"
  | "Operational";

export type SecurityIntentClassification = {
  category: SecurityIntentCategory;
  securitySensitive: boolean;
  confidence: "Low" | "Medium" | "High";
  reasons: string[];
};

const DESTRUCTIVE_INTENT_TERMS = [
  "delete",
  "remove",
  "wipe",
  "erase",
  "destroy",
  "purge",
  "truncate",
  "drop",
  "disable",
  "bypass",
  "exfiltrate",
  "reveal",
  "retrieve",
  "access"
];

const PROTECTED_DATA_TERMS = [
  "sql row",
  "sql rows",
  "database row",
  "database rows",
  "database record",
  "database records",
  "customer data",
  "workspace data",
  "business memory",
  "evidence",
  "kpi",
  "kpis",
  "report",
  "reports",
  "audit log",
  "audit logging",
  "secrets",
  "api key",
  "service role",
  "environment variable",
  "system prompt",
  "another workspace",
  "other workspace",
  "different workspace",
  "another customer",
  "other customer",
  "tenant data"
];

const SQL_MUTATION_PATTERNS = [
  /\bdelete\s+from\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\balter\s+table\b/i,
  /\bupdate\s+["'`[\]\w.]+\s+set\b/i,
  /\binsert\s+into\b/i
];

const EDUCATIONAL_FRAMING_PATTERNS = [
  /^\s*(explain|define|what\s+is|what\s+are|teach\s+me|compare)\b/i,
  /^\s*difference\s+between\b/i,
  /^\s*how\s+does\b/i,
  /\b(for\s+learning|conceptually|in\s+general|educational|tutorial)\b/i
];

const EDUCATIONAL_SQL_PATTERNS = [
  /^\s*(explain|define|what\s+is|what\s+are)\s+(sql\s+)?(delete|delete\s+from|drop\s+table|truncate|truncate\s+table)\b/i,
  /^\s*difference\s+between\s+(sql\s+)?(delete|truncate|drop\s+table)\b/i,
  /^\s*teach\s+me\s+sql\b/i,
  /^\s*how\s+does\s+(sql\s+)?(delete|delete\s+from|drop\s+table|truncate|truncate\s+table)\s+work\b/i
];

const CONTEXTUAL_EXPLANATION_PATTERNS = [
  /^\s*explain\s+(this|the|my|current)\s+(briefing|recommendation|evidence|result|report|output|kpi|metric|business\s+signal|file|analysis|comparison|forecast|confidence)\b/i,
  /^\s*explain\s+this\b/i,
  /^\s*tell\s+me\s+more\s+about\s+(this|the|my|current)\b/i,
  /^\s*why\s+did\s+vaeroex\s+surface\s+this\b/i
];

const ACTIONABLE_SQL_PATTERNS = [
  /^\s*(run|execute|perform|write|generate|create|give\s+me|show\s+me|build)\b[\s\S]*\b(delete\s+from|drop\s+table|truncate\s+table|alter\s+table|update\s+["'`[\]\w.]+\s+set|insert\s+into)\b/i,
  /\b(how\s+do\s+i|how\s+can\s+i|help\s+me)\b[\s\S]*\b(delete|remove|wipe|purge|drop|truncate)\b[\s\S]*\b(rows?|records?|table|database|customer\s+data|business\s+memory|evidence)\b/i
];

const BUSINESS_INTELLIGENCE_TERMS = [
  "risk",
  "opportunity",
  "forecast",
  "trend",
  "insight",
  "revenue",
  "customer",
  "operations",
  "performance",
  "business health",
  "kpi",
  "briefing"
];

const ADMINISTRATIVE_TERMS = ["billing", "subscription", "account", "settings", "invite", "workspace settings", "user role"];
const OPERATIONAL_TERMS = ["workflow", "process", "implementation", "setup", "configure", "upload", "import", "export"];

function normalizeIntentText(value?: string | null) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAnyTerm(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function matchesAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function isContextualExplanationRequest(value?: string | null) {
  const text = normalizeIntentText(value);
  return Boolean(text && matchesAnyPattern(text, CONTEXTUAL_EXPLANATION_PATTERNS));
}

export function contextualSecurityIntentInput({
  prompt,
  followUp
}: {
  prompt?: string | null;
  followUp?: string | null;
}) {
  const userFollowUp = normalizeIntentText(followUp);

  if (userFollowUp) {
    return userFollowUp;
  }

  const controlledPrompt = normalizeIntentText(prompt);

  if (!controlledPrompt || isContextualExplanationRequest(controlledPrompt)) {
    return "";
  }

  return controlledPrompt;
}

function isEducationalSecurityQuestion(text: string) {
  if (!matchesAnyPattern(text, EDUCATIONAL_FRAMING_PATTERNS)) {
    return false;
  }

  if (matchesAnyPattern(text, ACTIONABLE_SQL_PATTERNS)) {
    return false;
  }

  if (/\b(my|our|this|the|workspace|customer|company|production)\b[\s\S]*\b(rows?|records?|data|database|business\s+memory|evidence|reports?|kpis?)\b/i.test(text)) {
    return false;
  }

  return matchesAnyPattern(text, EDUCATIONAL_SQL_PATTERNS) || !includesAnyTerm(text, PROTECTED_DATA_TERMS);
}

export function classifySecurityIntent(value?: string | null): SecurityIntentClassification {
  const text = normalizeIntentText(value);

  if (!text) {
    return {
      category: "Business Intelligence",
      securitySensitive: false,
      confidence: "Low",
      reasons: ["empty_request"]
    };
  }

  const reasons: string[] = [];
  const educational = isEducationalSecurityQuestion(text);
  const destructiveIntent = includesAnyTerm(text, DESTRUCTIVE_INTENT_TERMS);
  const protectedDataTarget = includesAnyTerm(text, PROTECTED_DATA_TERMS);
  const sqlMutation = matchesAnyPattern(text, SQL_MUTATION_PATTERNS);
  const actionableSql = matchesAnyPattern(text, ACTIONABLE_SQL_PATTERNS);
  const legacyPatternMatch = SECURITY_REQUEST_PATTERNS.some((pattern) => pattern.test(text));

  if (legacyPatternMatch) reasons.push("security_pattern");
  if (destructiveIntent) reasons.push("destructive_intent");
  if (protectedDataTarget) reasons.push("protected_data_target");
  if (sqlMutation) reasons.push("sql_mutation");
  if (actionableSql) reasons.push("actionable_sql");

  if (!educational && (legacyPatternMatch || actionableSql || (destructiveIntent && protectedDataTarget) || sqlMutation)) {
    return {
      category: "Security Sensitive",
      securitySensitive: true,
      confidence: reasons.length >= 2 ? "High" : "Medium",
      reasons: reasons.length ? reasons : ["security_sensitive_intent"]
    };
  }

  if (educational) {
    return {
      category: "Educational",
      securitySensitive: false,
      confidence: "High",
      reasons: ["educational_framing"]
    };
  }

  if (matchesAnyPattern(text, EDUCATIONAL_FRAMING_PATTERNS)) {
    return {
      category: "Educational",
      securitySensitive: false,
      confidence: "Medium",
      reasons: ["educational_framing"]
    };
  }

  if (includesAnyTerm(text, ADMINISTRATIVE_TERMS)) {
    return {
      category: "Administrative",
      securitySensitive: false,
      confidence: "Medium",
      reasons: ["administrative_intent"]
    };
  }

  if (includesAnyTerm(text, OPERATIONAL_TERMS)) {
    return {
      category: "Operational",
      securitySensitive: false,
      confidence: "Medium",
      reasons: ["operational_intent"]
    };
  }

  if (includesAnyTerm(text, BUSINESS_INTELLIGENCE_TERMS)) {
    return {
      category: "Business Intelligence",
      securitySensitive: false,
      confidence: "Medium",
      reasons: ["business_intelligence_intent"]
    };
  }

  return {
    category: "Business Intelligence",
    securitySensitive: false,
    confidence: "Low",
    reasons: ["default_business_intelligence"]
  };
}

export function isSecurityResponseMessage(message?: string | null) {
  const value = String(message || "").trim();

  if (!value) {
    return false;
  }

  return SECURITY_RESPONSE_PATTERNS.some((pattern) => pattern.test(value));
}

function isLegacySavedDenialMessage(message?: string | null) {
  const value = String(message || "").trim();

  if (!value) {
    return false;
  }

  return LEGACY_SAVED_DENIAL_PATTERNS.some((pattern) => pattern.test(value));
}

function containsSecurityResponseString(value: unknown): boolean {
  if (typeof value === "string") {
    return isLegacySavedDenialMessage(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsSecurityResponseString);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsSecurityResponseString);
  }

  return false;
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
    isSecurityResponseMessage(typeof record.executive_summary === "string" ? record.executive_summary : "") ||
    containsSecurityResponseString(record)
  );
}

export function isSecuritySensitiveRequest(value?: string | null) {
  return classifySecurityIntent(value).securitySensitive;
}
