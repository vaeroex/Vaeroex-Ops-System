# Shopify connector: pilot implementation and activation

## Current status

Vaeroex Executive Intelligence exists in the Vaeroex Shopify organization. The
owner approved public distribution on October 13, 2026, and it has been selected
in Shopify Partners. Public distribution is needed for unrelated customer stores;
it does not mean the app is approved or published.

This change implements a disabled-by-default connector. No production migration,
credentials, Shopify version release, real-store authorization, or customer
launch has been performed by this code change. `shopify.app.toml` is the prepared
configuration for the existing app, not evidence that these settings are live.

## Preview migration verification — October 13, 2026 (Pacific)

The owner approved migration `20261014002542` for preview project
`zfpnhvcmuuvtswttmnjd` only. It was applied with Supabase CLI after the connector
returned expired-request errors, and the exact version was recorded in the preview
migration ledger. Production project `mdiianhfrojmxqpwrflh` was checked read-only:
Shopify tables/functions and this migration record are absent. Production is not approved.

`supabase/tests/shopify_preview_verification.sql` passed 23 assertions against the
actual preview database under anon, authenticated and service roles. It covers
permissions, cross-workspace/session rejection, one-time OAuth state, connection,
refresh/sync leases, aggregate-only storage, data-request acknowledgement,
customer erasure/stale-write denial, uninstall, disconnect and shop erasure.
The transaction rolled back: zero test workspaces, connections or cutoffs remained.
Synthetic credentials were used; this is not a live Shopify authorization test.

Before/after fingerprints of existing public/private function definitions,
function/table grants, table RLS flags and policies matched:
`a284c2f95d01fddd4f86ef5b70768062`. The advisor added only two INFO notices for
RLS without policies on the new private tables: intentional default-deny tables
behind the service-only RPC. No new WARN/ERROR security findings were introduced.
See [the advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Local Shopify provider/database/route tests passed, as did Google Sheets, Square
connection routes and shared provider authorization contracts. QuickBooks behavioral
tests passed; its fixed production-candidate inventory was updated to exclude only
this explicitly preview-only migration, retaining all existing count/hash guards.
These are regression checks, not proof of fresh live provider synchronizations.
No existing customer credentials were used or rotated and no real orders were changed.

Preview credentials have been configured on branch `codex/shopify-integration`,
and Shopify development store `Vaeroex Integration Test` was created with sample
data. Keep the preview feature flag off until callback/scopes/webhooks are released
and live deliveries have been tested. The migration verification does not complete
those remaining external activation steps.

## Customer value and first release scope

A workspace owner connects one Shopify store, approves a manual read, and sees
30 complete UTC days of order value, refunded amount, order counts and cancelled
order counts, broken out by day and shop currency. Up to 10,000 orders are read
with cursor pagination. Failed, throttled, truncated, duplicated or malformed
responses never replace the last complete saved report.

Order value is Shopify `totalPriceSet`, including taxes, shipping, unpaid and
cancelled orders. Refund totals are `totalRefundedSet`, grouped by the creation
date of the associated order, not the refund date. They are not accounting
revenue, cash receipts, profit, or Shopify's sales-report definitions. Test orders
are excluded. Multiple currencies are never added together. Decimal summation
uses integers at six-decimal precision; display follows currency conventions.

This first release displays operational results on the Shopify integration page.
It does not publish these results into Vaeroex's canonical KPI/evidence pipeline
or send Shopify data to AI providers. Cross-source financial analysis needs a
separate source-authority and business-entity mapping implementation. Future
phases can add product/inventory analysis after the relevant scopes and data
contracts are justified; no product, customer, inventory or write scopes are
requested here.

## Storage and authorization

- Only `read_orders` is requested. This ordinarily covers the last 60 days;
  this connector uses a 30-day window and does not request `read_all_orders`.
- No customer names, addresses, emails, phones, payment details, product labels,
  order notes or free text are queried. Order IDs exist only in memory to detect
  duplicate pages and are not stored. Daily aggregates are allowlisted twice.
- Credentials are AES-256-GCM encrypted with authenticated workspace, shop,
  generation, credential version and application origin. Encryption material is
  server-only. Rotating the encryption key requires reconnecting stores.
- SQL tables live in `private`, have RLS enabled, and deny direct access to
  browser roles and the service role. The service-only lifecycle RPC validates
  active workspace ownership, live authentication session and non-banned user
  status for every customer operation. Webhook cleanup is a separate branch,
  called only after authenticating the exact raw body against Shopify's HMAC.
- OAuth requires a random state, matching HttpOnly secure same-site browser cookie,
  matching signed-in session, a valid signed Shopify callback and a single-use
  database state. Arbitrary shop hosts, redirect targets and duplicate callback
  parameters are rejected.
- Expiring offline access and refresh tokens are supported. One database lease
  serializes refresh/read work. A lost/uncertain refresh is treated as requiring
  reconnection. Stale work cannot overwrite data after disconnect or redaction.
- One shop is assigned to one workspace, consistent with Shopify's current token
  lifecycle. Workspace owners see reports; there is no browser access to tokens.

## Privacy and disconnect behavior

All three mandatory compliance topics and `app/uninstalled` use
`/api/integrations/shopify/webhooks`. Do not enable the connector before these
subscriptions are released and test deliveries work.

`customers/data_request` acknowledges that no customer-identifiable records are
stored by this connector. `customers/redact` conservatively deletes the entire
saved aggregate, discards credentials, and requires reconnection. A shop-level
cutoff prevents old orders from being reimported; the reporting window can be
shorter afterward. `shop/redact` and `app/uninstalled` delete the connection and
report and invalidate pending work. Uninstall keeps the shop-domain cutoff, without customer identifiers, to suppress
reimport of earlier data. `shop/redact` also deletes that cutoff; a later new
installation requires fresh merchant authorization. The customer-facing
report is not an immutable audit or accounting record.

Disconnect deletes Vaeroex's credential and report immediately. The UI explicitly
instructs the owner to uninstall in Shopify to revoke Shopify's authorization as
well. Disconnect, read-only status and privacy cleanup remain available when the
feature flag or subscription is off; connection/sync require an active subscription.

Before public review, document production backup expiration and restoration
procedures so deleted records cannot be resurrected from backups. Do not claim
that online row deletion has erased every backup. Finalize whether shop cutoff
records should be keyed with a dedicated keyed hash and purged after their
30-day suppression window.

## Deployment configuration

Apply `supabase/migrations/20261014002542_shopify_read_only_connector.sql` using
the normal reviewed database release path. Its prerequisites are the existing
workspace membership tables and Supabase auth tables. It creates no browser API
grants. Run database advisors against the target project after migration.

Set these secrets on the Vaeroex server (never `NEXT_PUBLIC_`):

```text
SHOPIFY_ENABLED=false
SHOPIFY_CLIENT_ID=619a697e05ce4287419abaf4c759995c
SHOPIFY_CLIENT_SECRET=<from the existing Shopify app>
SHOPIFY_TOKEN_ENCRYPTION_KEY=<base64 encoding of 32 random bytes>
```

`NEXT_PUBLIC_APP_URL` must be the exact HTTPS origin hosting the routes. The
production URL is `https://www.vaeroex.com`. Do not allow a redirect between www and
non-www on the OAuth callback. Existing Supabase service credentials are required.
Do not write credentials or OAuth query strings to logs, a PR, or documentation.

Publish the prepared `shopify.app.toml` through Shopify's supported CLI flow,
after endpoint deployment and an explicit approval for the app's `read_orders`
permission. Shopify must record the exact callback URL and all webhook topics.
Do not merely save a new app URL while leaving required webhooks unregistered.

## Remaining external launch steps

1. Install this change in a development/preview environment with HTTPS and an
   isolated database. Configure the server secrets securely and apply its migration.
2. Release the Shopify version declaring `read_orders`, the callback and webhooks.
3. Request protected customer data access for **orders only**, describing the
   aggregate analytics purpose. Order data can require Shopify approval even
   without name/address/email/phone fields. Do not request those identifying fields.
4. Create/use a Shopify development store with fictional sample orders. Enable
   the connector only in the isolated test environment and run the live checklist.
5. Prepare the listing, privacy-policy disclosures, support contact, review
   instructions and test access. Confirm Shopify's billing rules for the existing
   Vaeroex SaaS subscription before describing the listing's pricing; do not
   invent a free tier or promise an exemption from Shopify billing.
6. Submit for Shopify review only with the actual product behavior and verified
   operating controls. Public store installs remain subject to Shopify approval.
7. After approval and live checks, apply the reviewed production migration,
   configure secrets, release the verified app version and enable a limited pilot.

## Verification performed / live checklist

Offline tests use real PostgreSQL semantics through PGlite, the actual migration,
actual route functions, synthetic sessions and mocked Shopify HTTP responses.
They verify callback HMAC/state/cookie checks, replay rejection, cross-workspace
access denial, private table grants and RLS, encrypted credentials, paging,
currency separation, exact summation, partial-response rejection, refresh leases,
redaction races, cutoff preservation, and disconnection. They do not prove live
Shopify scope approval, hosting configuration or delivery of real webhooks.

```sh
pnpm test:shopify
pnpm typecheck
pnpm build
```

Live verification must cover: connect/decline, callback on the exact origin,
read-only scope screen, report comparison against known sample orders (including
taxes, shipping, partial refunds, cancellations and multiple currencies), second
read replacing the report, token expiry/refresh, 401/reconnect, simultaneous
reads, all signed webhook topics, tampered HMAC returning 401, privacy redaction
during a read, uninstall/reinstall, cross-workspace denial and owner/session
revocation. Obtain permission for any real merchant-store data before installation.

## Primary references

- [App distribution](https://shopify.dev/docs/apps/launch/distribution)
- [Standalone app authorization](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps)
- [Order fields and history limits](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order)
- [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [Required privacy webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [App configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration)
