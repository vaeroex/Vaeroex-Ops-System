import { isSecurityResponseMessage, securityResponseMessage } from "@/lib/security/security-response";

const SECRET_KEY_PATTERN = /\bsk-[a-zA-Z0-9_-]+/g;
export const VAEROEX_INTELLIGENCE_UNAVAILABLE_MESSAGE =
  "Vaeroex intelligence is temporarily unavailable. Please try again later or contact support@vaeroex.com.";

export function cleanVaeroexErrorMessage(message: string | undefined, fallback = "Vaeroex could not complete the request.") {
  const value = String(message || "").trim();

  if (!value || value === "NEXT_REDIRECT" || value.includes("NEXT_REDIRECT;")) {
    return fallback;
  }

  const redacted = value.replace(SECRET_KEY_PATTERN, "the configured API key");

  if (isSecurityResponseMessage(redacted)) {
    return securityResponseMessage();
  }

  if (/incorrect api key|invalid api key|api key provided|authentication|authorization/i.test(redacted)) {
    return VAEROEX_INTELLIGENCE_UNAVAILABLE_MESSAGE;
  }

  if (/rate limit/i.test(redacted)) {
    return "Vaeroex is temporarily busy. Please try again in a few minutes.";
  }

  return redacted;
}
