"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import {
  PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS,
  PRE_CHECKOUT_ACCEPTANCE_SET_ID,
  PRE_CHECKOUT_ACCEPTANCE_SET_VERSION,
  preCheckoutAcceptanceSnapshot,
  preCheckoutPoliciesJson,
  preCheckoutSnapshotJson
} from "@/lib/legal/pre-checkout-acceptance";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type CheckoutLegalAcceptanceInsert =
  Database["public"]["Tables"]["checkout_legal_acceptances"]["Insert"];

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function redirectToLegal(error: string): never {
  redirect(`/checkout/legal?error=${encodeURIComponent(error)}` as Route);
}

export async function acceptPreCheckoutLegalPoliciesAction(formData: FormData) {
  if (!checked(formData, "accept_pre_checkout_legal")) {
    redirectToLegal("Review and accept the required Vaeroex subscription terms before Checkout.");
  }

  const snapshot = preCheckoutAcceptanceSnapshot();
  const submittedHash = String(formData.get("required_policy_hash") || "").trim();
  if (submittedHash !== snapshot.requiredPolicyHash) {
    redirectToLegal("The Vaeroex legal terms changed. Review the current terms before Checkout.");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirectToLegal("Vaeroex account services are temporarily unavailable.");

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signup?next=%2Fcheckout%2Flegal&message=Create%20or%20sign%20in%20to%20your%20Vaeroex%20account%20before%20checkout." as Route);
  }

  if (!user.email_confirmed_at) {
    redirect("/login?next=%2Fcheckout%2Flegal&error=Verify%20your%20email%20before%20starting%20checkout." as Route);
  }

  const context = await getWorkspaceContext();
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || requestHeaders.get("x-real-ip");

  const record = {
    user_id: user.id,
    workspace_id: context.activeWorkspace?.id ?? null,
    user_email: user.email ?? context.profile?.email ?? null,
    acceptance_set_id: PRE_CHECKOUT_ACCEPTANCE_SET_ID,
    acceptance_set_version: PRE_CHECKOUT_ACCEPTANCE_SET_VERSION,
    required_policy_hash: snapshot.requiredPolicyHash,
    accepted_policies_json: preCheckoutPoliciesJson(snapshot),
    acceptance_snapshot_json: preCheckoutSnapshotJson(snapshot),
    acceptance_source: "pre_checkout",
    acceptance_action: "accept_and_continue_to_stripe_checkout",
    record_class: PRE_CHECKOUT_ACCEPTANCE_RECORD_CLASS,
    user_agent: userAgent,
    ip_address: ipAddress || null
  } satisfies CheckoutLegalAcceptanceInsert;

  const { error } = await supabase
    .from("checkout_legal_acceptances")
    .upsert(record, {
      onConflict: "user_id,acceptance_set_id,acceptance_set_version,required_policy_hash",
      ignoreDuplicates: true
    });

  if (error) {
    redirectToLegal(error.message);
  }

  redirect("/api/stripe/checkout" as Route);
}
