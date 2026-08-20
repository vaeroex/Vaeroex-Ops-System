const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
Module._load = function loadServerModule(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const checkout = read("app/api/stripe/checkout/route.ts");
const webhook = read("app/api/stripe/webhook/route.ts");
const success = read("app/checkout/success/page.tsx");
const portal = read("app/api/stripe/portal/route.ts");
const stripe = read("lib/stripe/billing.ts");
const setup = read("app/app/setup/actions.ts");
const migration = read("supabase/migrations/20260820053955_customer_1_billing_entitlement_remediation.sql");
const databaseTest = read("supabase/tests/customer_1_billing_entitlement.test.sql");
const databaseRunner = read("scripts/run-isolated-database-tests.js");
const workflow = read(".github/workflows/ci.yml");

assert.match(checkout, /supabase\.auth\.getUser\(\)/, "Checkout must require an authenticated Vaeroex user");
assert.match(checkout, /user\.email_confirmed_at/, "Checkout must require a verified account email");
assert.match(checkout, /claim_stripe_checkout_intent_v1/, "Checkout must claim a durable service-only purchase intent");
assert.match(checkout, /record_stripe_checkout_session_v1/, "Checkout must record the exact Stripe Session");
assert.match(checkout, /retrieveStripeCheckoutSession/, "Checkout retries must inspect and reuse the stored Stripe Session");
assert.match(stripe, /Idempotency-Key/, "Stripe Checkout creation must send a provider idempotency key");
assert.match(stripe, /vaeroex-checkout-intent-\$\{intentId\}/, "idempotency must derive from the durable intent, not request ordering");
assert.match(stripe, /params\.set\("customer", stripeCustomerId\)/, "returning customers must reuse their Stripe Customer");
assert.match(stripe, /params\.set\("customer_email", email\)/, "new customers must use their verified account email");
assert.match(stripe, /metadata\[purchase_intent_id\]/, "Checkout and Subscription metadata must retain the trusted purchase intent");
assert.match(stripe, /metadata\[vaeroex_user_id\]/, "Checkout and Subscription metadata must retain the authenticated user binding");
assert.match(stripe, /stripeSubscriptionPriceId[\s\S]+matchingItems\.length === 1[\s\S]+exactPriceId[\s\S]+itemEnd/, "Stripe period normalization must bind one exact price item and fail closed on ambiguity");

assert.match(webhook, /sync_stripe_subscription_entitlement_v1/, "webhooks must use the transactional reconciliation RPC");
assert.match(webhook, /stripeSubscriptionPeriod\(subscription\)/, "webhooks must normalize current Stripe item-level billing periods");
assert.doesNotMatch(webhook, /findExistingSubscription/, "webhooks must not merge subscriptions through a broad email/customer OR query");
assert.match(webhook, /event\.created/, "provider event time must participate in ordering");
assert.match(webhook, /customer\.subscription\.deleted/, "subscription deletion must remain handled");
assert.match(webhook, /invoice\.payment_failed/, "payment failure must remain handled");
assert.match(webhook, /invoice\.paid/, "the current paid-invoice event must be handled");
assert.match(webhook, /checkout\.session\.expired/, "an expired Checkout Session must close its exact purchase intent");
assert.match(webhook, /checkout\.session\.async_payment_failed/, "an asynchronous payment failure must allow a safe retry");
assert.match(webhook, /session\.client_reference_id !== intentId/, "failed Checkout closure must preserve the trusted intent binding");
assert.match(webhook, /expire_stripe_checkout_intent_v1/, "failed Checkout closure must use the exact service-only intent RPC");
assert.match(webhook, /eventError\.code === "23505"/, "concurrent webhook inserts must be handled explicitly");
assert.match(webhook, /concurrentEvent\?\.processed/, "only a fully processed concurrent webhook may receive duplicate success");
assert.match(webhook, /matching Stripe event is still being processed[\s\S]+status: 409/, "an unresolved concurrent webhook must remain retryable");
assert.doesNotMatch(webhook, /eventError\.code === "23505" \? 200/, "a concurrent insert conflict must not acknowledge unfinished processing");
assert.match(stripe, /case "expired":/, "the stored terminal status must remain terminal when remapped");

assert.match(setup, /create_workspace_with_signed_agreement_v2/, "workspace creation must use the atomic entitlement-linking wrapper");
assert.match(setup, /p_entitlement_id: subscription\.subscription_id/, "workspace creation must bind the exact verified entitlement");
assert.match(setup, /p_authenticated_email: user\.email/, "workspace linkage must use server-authenticated identity");

assert.match(success, /retrieveStripeCheckoutSession\(sessionId\)/, "the success page must verify the Session with Stripe");
assert.match(success, /metadataUserId !== user\.id/, "the success page must enforce Vaeroex user ownership");
assert.match(success, /session\.status !== "complete"/, "an incomplete Session must not render success");
assert.match(success, /session\.payment_status === "paid"/, "the success page must require a paid Session");
assert.match(success, /No access was granted from the URL alone/, "unverified query parameters must not imply success");
assert.match(portal, /getSubscriptionStatus/, "Manage billing must use the canonical subscription resolver");
assert.doesNotMatch(portal, /\.or\(filters\.join/, "Manage billing must not use a broad customer lookup");

for (const invariant of [
  /create table public\.stripe_checkout_intents/,
  /enable row level security/,
  /revoke all on table public\.stripe_checkout_intents from public, anon, authenticated/,
  /stripe_checkout_intents_open_user_plan_uidx/,
  /customer_subscriptions_stripe_current_user_uidx/,
  /customer_subscriptions_stripe_current_workspace_uidx/,
  /customer_subscriptions_stripe_trusted_subscription_uidx/,
  /where billing_provider = 'stripe'\s+and stripe_checkout_intent_id is not null/,
  /pg_advisory_xact_lock/,
  /Stripe subscription cannot move between workspaces/,
  /v_existing\.stripe_last_event_created_at > p_event_created_at/,
  /A new Stripe entitlement requires a trusted purchase intent/,
  /v_existing\.stripe_last_event_created_at = p_event_created_at/,
  /create_workspace_with_signed_agreement_v2/,
  /v_entitlement\.workspace_id is not null/
]) {
  assert.match(migration, invariant);
}

assert.doesNotMatch(migration, /update public\.customer_subscriptions[\s\S]+where[\s\S]+billing_provider = 'stripe'[\s\S]+;[\s\S]+create unique index/i, "the migration must not backfill or rewrite existing subscriptions before adding invariants");
assert.match(migration, /Legacy provider rows remain untouched/, "legacy provider rows must be preserved rather than guessed or rewritten");
assert.match(databaseTest, /eight concurrent Checkout claims resolve to one purchase intent/);
assert.match(databaseTest, /a stale provider event cannot resurrect access/);
assert.match(databaseTest, /another user cannot claim the purchase intent/);
assert.match(databaseTest, /cannot create entitlement without a trusted purchase intent/);
assert.match(databaseTest, /equal-timestamp active event cannot resurrect a terminal subscription/);
assert.match(databaseTest, /the exact Stripe entitlement links atomically to the new workspace/);
assert.match(databaseTest, /second trusted current Stripe entitlement for one account/);
assert.match(databaseTest, /one Stripe Subscription ID cannot bind to two trusted purchase intents/);
assert.match(migration, /intent\.status in \('session_created', 'expired'\)/, "signed failure replay must close the same Checkout intent idempotently");
assert.match(databaseTest, /current_setting\('vaeroex\.test_database_url_b64'\)/, "hosted concurrency tests must use the disposable database's injected connection");
assert.doesNotMatch(databaseTest, /password\s*=|postgres:\s*postgres/i, "billing concurrency tests must not hardcode a database password");
assert.match(databaseRunner, /SUPABASE_TEST_DATABASE_URL/, "the database runner must accept an ephemeral hosted connection through process memory");
assert.match(databaseRunner, /POSTGRES_URL_NON_POOLING/, "the database runner must retrieve the disposable branch's non-pooling connection in memory");
assert.match(databaseRunner, /SUPABASE_TEST_BRANCH_NAME[\s\S]+SUPABASE_TEST_PARENT_PROJECT_REF/, "hosted verification must bind the exact branch to its parent project");
assert.match(databaseRunner, /new Client\([\s\S]+connectionString: databaseUrl[\s\S]+options: `-c vaeroex\.test_database_url_b64=/, "the hosted runner must pass the credential through an ephemeral database session setting");
assert.match(databaseRunner, /Array\.isArray\(queryResult\)[\s\S]+assertionCount/, "the direct runner must verify every pgTAP result rather than trusting query completion alone");
assert.match(databaseRunner, /isLocalDatabase[\s\S]+localDblinkConnection\(testUrl\)[\s\S]+: databaseUrl/, "the database runner must use an internal socket connection locally and the remote connection for a hosted branch");
assert.match(databaseRunner, /host='127\.0\.0\.1'[\s\S]+port='5432'[\s\S]+sslmode='disable'/, "local dblink sessions must use password-authenticated container loopback rather than the host-facing Supabase port or a trusted socket");
assert.match(databaseRunner, /decodeURIComponent\(url\.password\)/, "the local dblink connection must derive its credential from the ephemeral Supabase URL");
assert.match(databaseRunner, /Buffer\.from\(dblinkConnection, "utf8"\)\.toString\("base64"\)/, "the database runner must pass the appropriate dblink connection without embedding it in test SQL");
assert.doesNotMatch(databaseRunner, /postgres:\s*postgres|password\s*[:=]\s*["']postgres/i, "the database runner must not hardcode local database credentials");
assert.match(databaseRunner, /clearCredentialEnvironment\(\)[\s\S]+delete process\.env\.SUPABASE_TEST_DATABASE_URL/, "the database runner must clear the raw connection after verification");
assert.match(databaseRunner, /redactDatabaseDiagnostic/, "database diagnostics must be redacted defensively");
assert.doesNotMatch(databaseRunner, /--db-url|testUrl\.toString\(\)/, "the database runner must never place a credential-bearing URL in a child-process argument");
assert.doesNotMatch(
  databaseRunner,
  /console\.log|(?:stdout|stderr)\.write\([^)]*(?:databaseUrl|testUrl|connectionSetting)/,
  "the database runner must not print its connection credential"
);
assert.match(workflow, /security-database:[\s\S]+pnpm install --frozen-lockfile[\s\S]+node scripts\/run-isolated-database-tests\.js/, "CI must install the pinned PostgreSQL client before invoking the database coordinator");
assert.match(workflow, /node scripts\/run-isolated-database-tests\.js[\s\S]+security_high_findings_remediation\.test\.sql[\s\S]+customer_1_billing_entitlement\.test\.sql/, "CI must execute both portable pgTAP suites through the credential-safe runner");

const { getSubscriptionStatus, isStripeSubscriptionEntitled } = require(path.join(root, "lib/billing/get-subscription-status.ts"));
const { stripeSubscriptionPeriod } = require(path.join(root, "lib/stripe/billing.ts"));
const future = "2099-01-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";
const stripeRow = {
  id: "subscription-id",
  user_id: "user-id",
  workspace_id: "workspace-id",
  customer_email: "owner@example.test",
  status: "active",
  billing_provider: "stripe",
  manually_activated: false,
  current_period_end: future,
  stripe_customer_id: "cus_test",
  stripe_subscription_id: "sub_test",
  plan_slug: "vaeroex",
  created_at: "2026-08-20T00:00:00.000Z",
  subscription_plans: null
};

assert.equal(isStripeSubscriptionEntitled(stripeRow), true);
assert.equal(isStripeSubscriptionEntitled({ ...stripeRow, status: "past_due" }), false);
assert.equal(isStripeSubscriptionEntitled({ ...stripeRow, status: "canceled" }), false);
assert.equal(isStripeSubscriptionEntitled({ ...stripeRow, current_period_end: past }), false);
assert.equal(isStripeSubscriptionEntitled({ ...stripeRow, current_period_end: null }), false);

process.env.STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY = "price_vaeroex";
assert.deepEqual(
  stripeSubscriptionPeriod({ current_period_start: 100, current_period_end: 200 }),
  { currentPeriodStart: 100, currentPeriodEnd: 200 },
  "legacy Stripe subscription-level periods remain supported"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: { data: [{ price: { id: "price_vaeroex" }, current_period_start: 300, current_period_end: 400 }] }
  }),
  { currentPeriodStart: 300, currentPeriodEnd: 400 },
  "current Stripe item-level periods are authoritative"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: {
      data: [
        { price: { id: "price_other" }, current_period_start: 1, current_period_end: 2 },
        { price: { id: "price_vaeroex" }, current_period_start: 500, current_period_end: 600 }
      ]
    }
  }),
  { currentPeriodStart: 500, currentPeriodEnd: 600 },
  "the configured Vaeroex price wins without trusting item order"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: { data: [{ price: { id: "price_other" }, current_period_start: 1, current_period_end: 2 }] }
  }),
  { currentPeriodStart: null, currentPeriodEnd: null },
  "a subscription without the configured Vaeroex price fails closed"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: {
      data: [
        { price: { id: "price_vaeroex" }, current_period_start: 1, current_period_end: 2 },
        { price: { id: "price_vaeroex" }, current_period_start: 3, current_period_end: 4 }
      ]
    }
  }),
  { currentPeriodStart: null, currentPeriodEnd: null },
  "ambiguous duplicate price items fail closed"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: { data: [{ price: { id: "price_vaeroex" }, current_period_start: 0, current_period_end: Number.NaN }] }
  }),
  { currentPeriodStart: null, currentPeriodEnd: null },
  "invalid provider timestamps fail closed"
);
assert.deepEqual(
  stripeSubscriptionPeriod({
    current_period_start: 100,
    items: { data: [{ price: { id: "price_vaeroex" }, current_period_start: 300, current_period_end: 400 }] }
  }),
  { currentPeriodStart: null, currentPeriodEnd: null },
  "partial legacy fields cannot be mixed with item-level periods"
);
delete process.env.STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY;
assert.deepEqual(
  stripeSubscriptionPeriod({
    items: { data: [{ price: { id: "price_vaeroex" }, current_period_start: 300, current_period_end: 400 }] }
  }),
  { currentPeriodStart: null, currentPeriodEnd: null },
  "item-level periods require the configured Vaeroex price"
);

class Query {
  constructor(result) { this.result = result; }
  select() { return this; }
  eq() { return this; }
  or() { return this; }
  order() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
}

function client(workspace, subscriptions) {
  return {
    from(table) {
      if (table === "workspaces") return new Query({ data: workspace, error: null });
      if (table === "customer_subscriptions") return new Query({ data: subscriptions, error: null });
      throw new Error(`Unexpected table ${table}`);
    }
  };
}

async function verifyAuthority() {
  const cachedActiveWorkspace = {
    id: "workspace-id",
    subscription_status: "active",
    subscription_required: true,
    manually_unlocked: false,
    trial_ends_at: null,
    plan_slug: "vaeroex"
  };

  const active = await getSubscriptionStatus({
    supabase: client(cachedActiveWorkspace, [stripeRow]),
    userId: "user-id",
    email: "owner@example.test",
    workspaceId: "workspace-id"
  });
  assert.equal(active.allowed, true);
  assert.equal(active.source, "subscription");
  assert.equal(active.subscription_id, "subscription-id");

  for (const status of ["past_due", "unpaid", "canceled", "expired", "incomplete"]) {
    const denied = await getSubscriptionStatus({
      supabase: client(cachedActiveWorkspace, [{ ...stripeRow, status }]),
      userId: "user-id",
      email: "owner@example.test",
      workspaceId: "workspace-id"
    });
    assert.equal(denied.allowed, false, `${status} Stripe state must override cached workspace active state`);
  }

  const unlinked = await getSubscriptionStatus({
    supabase: client(cachedActiveWorkspace, []),
    userId: "user-id",
    email: "owner@example.test",
    workspaceId: "workspace-id"
  });
  assert.equal(unlinked.allowed, false, "cached active workspace state must not independently grant access");

  const manualRow = {
    ...stripeRow,
    id: "manual-id",
    billing_provider: "manual",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    manually_activated: true
  };
  const manual = await getSubscriptionStatus({
    supabase: client({ ...cachedActiveWorkspace, manually_unlocked: true }, [manualRow]),
    userId: "user-id",
    email: "owner@example.test",
    workspaceId: "workspace-id"
  });
  assert.equal(manual.allowed, true, "manual activation remains a separate explicit authority");
  assert.equal(manual.source, "manual");
}

verifyAuthority()
  .then(() => process.stdout.write("Customer #1 billing remediation regressions passed (88 assertions).\n"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
