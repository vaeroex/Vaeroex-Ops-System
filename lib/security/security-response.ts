export const SECURITY_RESPONSE_MESSAGE =
  "This request cannot be performed because it conflicts with platform security requirements.";

export const SECURITY_RESPONSE_TITLE = "Action Blocked";

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
  /\bsystem prompt\b/i
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
