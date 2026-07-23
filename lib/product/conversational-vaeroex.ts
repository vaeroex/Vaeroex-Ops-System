import "server-only";

export const PREMIUM_CONVERSATIONAL_POLICY = "premium_conversational_v1" as const;

export function isPremiumConversationalVaeroexEnabled() {
  return process.env.VAEROEX_CONVERSATIONAL_POLICY === PREMIUM_CONVERSATIONAL_POLICY;
}
