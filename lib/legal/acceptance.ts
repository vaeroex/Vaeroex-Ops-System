import type { SupabaseClient } from "@supabase/supabase-js";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";
import type { Database } from "@/lib/supabase/types";

export async function hasAcceptedLatestLegalPolicies(
  supabase: SupabaseClient<Database>,
  userId: string
) {
  const { data, error } = await supabase
    .from("legal_acceptances")
    .select("id")
    .eq("user_id", userId)
    .eq("terms_version", LEGAL_DOCUMENT_VERSIONS.terms)
    .eq("privacy_version", LEGAL_DOCUMENT_VERSIONS.privacy)
    .eq("ai_disclaimer_version", LEGAL_DOCUMENT_VERSIONS.aiDisclaimer)
    .eq("sensitive_data_policy_version", LEGAL_DOCUMENT_VERSIONS.sensitiveData)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return false;
  }

  return Boolean(data);
}
