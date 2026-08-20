const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checkoutRoute = read("app/api/stripe/checkout/route.ts");
const checkoutLegalPage = read("app/checkout/legal/page.tsx");
const checkoutLegalAction = read("app/checkout/legal/actions.ts");
const startMenu = read("components/legal/StartWithVaeroexMenu.tsx");
const legalContent = read("lib/legal/content.ts");
const preCheckout = read("lib/legal/pre-checkout-acceptance.ts");
const publicSystems = read("lib/marketing/public-systems.ts");
const migration = read("supabase/migrations/20260820170000_pre_checkout_legal_acceptance.sql");
const billingMigration = read("supabase/migrations/20260820053955_customer_1_billing_entitlement_remediation.sql");
const subscriptionAccess = read("lib/billing/get-subscription-status.ts");
const packageJson = read("package.json");

assert.match(startMenu, /href="\/checkout\/legal"/, "public checkout CTA must send customers to the legal acceptance step first");
assert.doesNotMatch(startMenu, /href="\/api\/stripe\/checkout"/, "public CTA must not send customers directly to the Stripe Checkout API");
assert.match(publicSystems, /checkoutRoute: "\/checkout\/legal"/, "public pricing metadata must expose the legal review route as the checkout route");

assert.match(checkoutRoute, /supabase\.auth\.getUser\(\)/, "Checkout API must require an authenticated Vaeroex user");
assert.match(checkoutRoute, /user\.email_confirmed_at/, "Checkout API must require a verified account email");
assert.match(checkoutRoute, /hasAcceptedCurrentPreCheckoutPolicies\(supabase, user\.id\)/, "Checkout API must check durable pre-checkout acceptance server-side");
assert.match(checkoutRoute, /if \(!acceptedPreCheckoutTerms\)[\s\S]+\/checkout\/legal/, "Checkout API must fail closed to the legal review step without current acceptance");
assert.match(checkoutRoute, /hasAcceptedCurrentPreCheckoutPolicies[\s\S]+claimCheckoutIntent/, "acceptance must be verified before a Checkout intent is claimed");
assert.match(checkoutRoute, /hasAcceptedCurrentPreCheckoutPolicies[\s\S]+createOperationsIntelligenceCheckoutSession/, "acceptance must be verified before a Stripe Session is created");

assert.match(checkoutLegalPage, /requiredPolicies\.map/, "legal acceptance page must link every configured required policy");
assert.match(checkoutLegalPage, /target="_blank"/, "customers must be able to open policies before accepting");
assert.match(checkoutLegalPage, /type="checkbox" required/, "acceptance must be affirmative and unchecked by default");
assert.doesNotMatch(checkoutLegalPage, /defaultChecked|checked=\{true\}/, "pre-checkout consent must not be pre-checked");
assert.match(checkoutLegalPage, /Recurring monthly subscription/, "recurring cadence must be visible before charge");
assert.match(checkoutLegalPage, /VAEROEX_PLAN_PRICE_LABEL/, "price must be displayed from the canonical billing label");
assert.match(checkoutLegalPage, /payment method will be charged each billing period/, "recurring charge authorization must be visible before charge");
assert.match(checkoutLegalPage, /Cancellation prevents the next renewal/, "cancellation summary must be visible before charge");
assert.match(checkoutLegalPage, /Subscription and Billing Terms[\s\S]+Refund Policy/, "billing and refund policy links must be visible before charge");

assert.match(checkoutLegalAction, /submittedHash !== snapshot\.requiredPolicyHash/, "stale rendered policy hashes must be rejected");
assert.match(checkoutLegalAction, /user\.email_confirmed_at/, "acceptance action must require a verified authenticated user");
assert.match(checkoutLegalAction, /required_policy_hash: snapshot\.requiredPolicyHash/, "acceptance record must store the exact required policy hash");
assert.match(checkoutLegalAction, /accepted_policies_json: preCheckoutPoliciesJson/, "acceptance record must store policy/version/hash details");
assert.match(checkoutLegalAction, /acceptance_snapshot_json: preCheckoutSnapshotJson/, "acceptance record must store an immutable snapshot");
assert.match(checkoutLegalAction, /acceptance_source: "pre_checkout"/, "acceptance source must be explicit");
assert.match(checkoutLegalAction, /acceptance_action: "accept_and_continue_to_stripe_checkout"/, "acceptance action must be explicit");
assert.match(checkoutLegalAction, /ignoreDuplicates: true/, "duplicate submissions must not update or conflict with existing proof records");
assert.match(checkoutLegalAction, /onConflict: "user_id,acceptance_set_id,acceptance_set_version,required_policy_hash"/, "duplicate detection must use the immutable acceptance identity");

for (const policyId of [
  "terms",
  "privacy",
  "subscription-billing-terms",
  "refund-policy",
  "acceptable-use",
  "ai-disclaimer",
  "sensitive-data-policy",
  "data-retention",
  "human-review"
]) {
  assert.match(preCheckout, new RegExp(`"${policyId}"`), `${policyId} must be represented in the pre-checkout acceptance set`);
}

assert.match(preCheckout, /PRE_CHECKOUT_ACCEPTANCE_SET_VERSION = "2026-08-20\.2"/, "the required policy set must have its own version");
assert.match(preCheckout, /contentHash: sha256\(canonicalDocument\)/, "each policy must expose a stable content hash");
assert.match(preCheckout, /requiredPolicyHash: sha256\(policySet\)/, "the complete required policy set must expose a stable hash");
assert.match(preCheckout, /eq\("acceptance_set_version", PRE_CHECKOUT_ACCEPTANCE_SET_VERSION\)/, "stale acceptance-set versions must fail closed");
assert.match(preCheckout, /eq\("required_policy_hash", snapshot\.requiredPolicyHash\)/, "stale policy content hashes must fail closed");

for (const versionKey of [
  "acceptableUse",
  "refundPolicy",
  "subscriptionBillingTerms",
  "dataRetention",
  "humanReview"
]) {
  assert.match(legalContent, new RegExp(`${versionKey}:`), `${versionKey} must be included in LEGAL_DOCUMENT_VERSIONS`);
}

for (const href of [
  "/subscription-billing-terms",
  "/sensitive-data-policy",
  "/data-retention",
  "/human-review"
]) {
  assert.match(legalContent, new RegExp(`href: "${href}"`), `${href} must be discoverable from the shared legal links`);
}

assert.match(migration, /create table if not exists public\.checkout_legal_acceptances/, "migration must create the pre-checkout acceptance ledger");
assert.match(migration, /required_policy_hash text not null check \(required_policy_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/, "ledger must store a content-hash proof");
assert.match(migration, /accepted_policies_json jsonb not null/, "ledger must store exact accepted policy metadata");
assert.match(migration, /acceptance_snapshot_json jsonb not null/, "ledger must store an immutable snapshot");
assert.match(migration, /jsonb_typeof\(accepted_policies_json\) = 'array'/, "accepted policies must be stored as an array");
assert.match(migration, /jsonb_typeof\(acceptance_snapshot_json\) = 'object'/, "acceptance snapshot must be stored as an object");
assert.match(migration, /acceptance_snapshot_json \?& array\[/, "snapshot checks must reject missing proof fields");
assert.match(migration, /checkout_legal_acceptances_current_uidx/, "duplicate current acceptance records must be prevented");
assert.match(migration, /before update or delete[\s\S]+reject_checkout_legal_acceptance_mutation/, "ledger records must be immutable");
assert.match(migration, /user_id = auth\.uid\(\)/, "users may only insert their own acceptance record");
assert.doesNotMatch(migration, /grant update|grant delete|grant all/i, "acceptance ledger must not grant update/delete authority");

assert.match(billingMigration, /create_workspace_with_signed_agreement_v2/, "billing entitlement protections must remain present");
assert.match(billingMigration, /v_entitlement\.workspace_id is not null/, "workspace entitlement one-time binding must remain unchanged");
assert.match(subscriptionAccess, /isManualSubscriptionEntitled/, "manual activation behavior must remain valid");
assert.match(packageJson, /"test:pre-checkout-legal": "node scripts\/pre-checkout-legal-acceptance-regression-tests\.js"/, "package script must expose the pre-checkout regression suite");

process.stdout.write("Pre-checkout legal acceptance regressions passed.\n");
