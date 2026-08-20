import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { legalDocuments, type LegalDocumentId } from "@/lib/legal/content";
import type { Database, Json } from "@/lib/supabase/types";

export const PRE_CHECKOUT_ACCEPTANCE_SET_ID = "vaeroex_pre_checkout_terms" as const;
export const PRE_CHECKOUT_ACCEPTANCE_SET_VERSION = "2026-08-20.2" as const;
export const PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS = "pre_checkout_legal_acceptance" as const;

export const PRE_CHECKOUT_REQUIRED_POLICY_IDS = [
  "terms",
  "privacy",
  "subscription-billing-terms",
  "refund-policy",
  "acceptable-use",
  "ai-disclaimer",
  "sensitive-data-policy",
  "data-retention",
  "human-review"
] as const satisfies readonly LegalDocumentId[];

export type PreCheckoutRequiredPolicyId = (typeof PRE_CHECKOUT_REQUIRED_POLICY_IDS)[number];

export type PreCheckoutPolicySnapshot = {
  id: PreCheckoutRequiredPolicyId;
  title: string;
  href: string;
  version: string;
  effectiveDate: string;
  contentHash: string;
};

export type PreCheckoutAcceptanceSnapshot = {
  acceptanceSetId: typeof PRE_CHECKOUT_ACCEPTANCE_SET_ID;
  acceptanceSetVersion: typeof PRE_CHECKOUT_ACCEPTANCE_SET_VERSION;
  recordClass: typeof PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS;
  priceLabel: typeof VAEROEX_PLAN_PRICE_LABEL;
  billingCadence: "monthly_subscription";
  requiredPolicies: PreCheckoutPolicySnapshot[];
  requiredPolicyHash: string;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function preCheckoutPolicySnapshots(): PreCheckoutPolicySnapshot[] {
  return PRE_CHECKOUT_REQUIRED_POLICY_IDS.map((id) => {
    const document = legalDocuments[id];
    const canonicalDocument = {
      id: document.id,
      title: document.title,
      summary: document.summary,
      href: document.href,
      version: document.updated,
      sections: document.sections
    };

    return {
      id,
      title: document.title,
      href: document.href,
      version: document.updated,
      effectiveDate: document.updated,
      contentHash: sha256(canonicalDocument)
    };
  });
}

export function preCheckoutAcceptanceSnapshot(): PreCheckoutAcceptanceSnapshot {
  const requiredPolicies = preCheckoutPolicySnapshots();
  const policySet = {
    acceptanceSetId: PRE_CHECKOUT_ACCEPTANCE_SET_ID,
    acceptanceSetVersion: PRE_CHECKOUT_ACCEPTANCE_SET_VERSION,
    priceLabel: VAEROEX_PLAN_PRICE_LABEL,
    billingCadence: "monthly_subscription",
    requiredPolicies
  } as const;

  return {
    ...policySet,
    recordClass: PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS,
    requiredPolicyHash: sha256(policySet)
  };
}

export async function hasAcceptedCurrentPreCheckoutPolicies(
  supabase: SupabaseClient<Database>,
  userId: string
) {
  const snapshot = preCheckoutAcceptanceSnapshot();
  const { data, error } = await supabase
    .from("checkout_legal_acceptances")
    .select("id")
    .eq("user_id", userId)
    .eq("acceptance_set_id", PRE_CHECKOUT_ACCEPTANCE_SET_ID)
    .eq("acceptance_set_version", PRE_CHECKOUT_ACCEPTANCE_SET_VERSION)
    .eq("required_policy_hash", snapshot.requiredPolicyHash)
    .eq("record_class", PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

export function preCheckoutSnapshotJson(snapshot = preCheckoutAcceptanceSnapshot()) {
  return snapshot as unknown as Json;
}

export function preCheckoutPoliciesJson(snapshot = preCheckoutAcceptanceSnapshot()) {
  return snapshot.requiredPolicies as unknown as Json;
}
