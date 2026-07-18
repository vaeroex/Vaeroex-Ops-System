export const EXECUTIVE_PROVIDER_POLICY_HEADER = "x-vaeroex-preview-executive-policy";
export const EXECUTIVE_PROVIDER_POLICY_QUERY = "executive_provider_policy";

export type ExecutiveProviderPolicyVariant = "nvidia_first" | "openai_first";

export function isExecutiveProviderPolicyVariant(value: string | null): value is ExecutiveProviderPolicyVariant {
  return value === "nvidia_first" || value === "openai_first";
}
