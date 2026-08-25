import {
  PHASE_5_MODEL_CALL_COUNT,
  PHASE_5_PROMOTION_AUTHORIZED
} from "@/lib/integrations/credentials/contracts";
import {
  PHASE_6_MODEL_CALL_COUNT,
  PHASE_6_PROMOTION_AUTHORIZED
} from "@/lib/integrations/runtime/contracts";
import {
  QBO_ACCOUNTING_SCOPE,
  QBO_OAUTH_POLICY_VERSION
} from "@/lib/integrations/provider-runtime/qbo/oauth";
import {
  QBO_RUNTIME_EGRESS_POLICY_VERSION
} from "@/lib/integrations/provider-runtime/qbo/client";
import {
  QBO_PROVIDER_ADAPTER_VERSION,
  QBO_PROVIDER_KEY,
  QBO_MODEL_CALL_COUNT
} from "@/lib/integrations/providers/qbo/contracts";

export const QBO_PHASE_8B_RUNTIME_CONTRACT_VERSION =
  "qbo_sandbox_runtime_v1" as const;
export const QBO_PHASE_8B_PROVIDER_ENVIRONMENT = "sandbox" as const;
export const QBO_PHASE_8B_MODEL_CALL_COUNT = 0 as const;
export const QBO_PHASE_8B_PROMOTION_AUTHORIZED = false as const;

export const QBO_PHASE_8B_RUNTIME_BOUNDARY = Object.freeze({
  contractVersion: QBO_PHASE_8B_RUNTIME_CONTRACT_VERSION,
  providerKey: QBO_PROVIDER_KEY,
  providerEnvironment: QBO_PHASE_8B_PROVIDER_ENVIRONMENT,
  providerAdapterVersion: QBO_PROVIDER_ADAPTER_VERSION,
  oauthPolicyVersion: QBO_OAUTH_POLICY_VERSION,
  egressPolicyVersion: QBO_RUNTIME_EGRESS_POLICY_VERSION,
  scopes: [QBO_ACCOUNTING_SCOPE] as const,
  accountingMethods: ["GET"] as const,
  shadowOnly: true as const,
  promotionAuthorized: QBO_PHASE_8B_PROMOTION_AUTHORIZED,
  modelCallCount: QBO_PHASE_8B_MODEL_CALL_COUNT,
  inheritedBoundaryChecks: {
    phase5ModelCalls: PHASE_5_MODEL_CALL_COUNT,
    phase5PromotionAuthorized: PHASE_5_PROMOTION_AUTHORIZED,
    phase6ModelCalls: PHASE_6_MODEL_CALL_COUNT,
    phase6PromotionAuthorized: PHASE_6_PROMOTION_AUTHORIZED,
    phase7ModelCalls: QBO_MODEL_CALL_COUNT
  }
});
