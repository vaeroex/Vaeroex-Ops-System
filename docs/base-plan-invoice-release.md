# Base-plan invoice compatibility release

This release accepts both the legacy invoice `subscription` field and the modern
`parent.subscription_details.subscription` contract. Conflicting identities fail
closed. Current Stripe subscription state determines access; an invoice event's
label never grants or revokes access by itself.

## Ordering and isolation

Before reading a current subscription, the server claims a service-only database
observation generation. Only the latest issued generation can commit through
`sync_stripe_subscription_entitlement_v2`. Superseded reads fail retryably and
leave the webhook receipt unprocessed. This allows verified recovery within the
same Stripe timestamp second without admitting a delayed stale response.
Older events and exact duplicates remain no-ops. Canceled/expired subscriptions
cannot be resurrected. Existing purchase-intent, customer, owner, workspace, and
atomic workspace-cache checks remain enforced. Signed deletion events retain the
conservative v1 path. The separate capacity-pack router runs first and is unchanged.

## Verification

- `node scripts/stripe-webhook-receipt-tests.cjs`: locally signed synthetic modern
  and legacy invoice/payment/recovery/duplicate/attribution/receipt cases. Provider
  and database I/O are controlled; no real charges or provider calls.
- `BILLING_TEST_PG_BIN=/absolute/postgres/bin node scripts/base-billing-observation-database-tests.cjs`:
  actual migration/RPCs on an owned Unix-only disposable PostgreSQL instance,
  including concurrent sessions, same-second recovery, stale-read fencing,
  terminal states, tenant binding, atomic rollback, and role privileges.
- Existing billing, storage-pack, pre-checkout, public-copy, and Sheets UI/browser
  regressions; typecheck/lint and all required CI jobs.

## Release order

1. Save the current production deployment, main auto-deployment hold, billing
   aggregates, and live v1 function definition/ACLs to protected local evidence.
   Inspect affected receipt identities against current Stripe subscriptions.
2. After review and required CI, merge the exact verified head. Apply only
   `20261012201726_stripe_subscription_observation_fence.sql` to the verified
   production project. The additive migration leaves v1 and existing rows intact;
   it must precede the application that calls v2.
3. Verify new function definitions, service-only privileges, RLS, migration ledger,
   unchanged v1, and unchanged billing/price aggregates. Do not create a synthetic
   entitlement in production.
4. Archive the exact merged source, stage a Production-target deployment with
   `--skip-domain`, and verify READY, commit metadata, disclosure pages, auth
   boundaries, and unsigned-webhook rejection. Do not assign production domains
   before these checks pass.
5. Explicitly promote that deployment; verify live pages, authenticated integration
   disclosure, webhook boundary, billing receipt health, $250 base price, $5 storage
   capacity configuration, and the retained main auto-deployment hold.

## Receipt reconciliation

Do not replay receipt payloads as if they were newly signed provider events, change
provider timestamps, manually grant access, or create charges. For a verified
current mismatch, redeliver the authentic Stripe event through the signed webhook
and confirm its existing receipt and entitlement reconcile idempotently. Preserve
older/duplicate ordering protections. Historical receipts whose subscription is
already canceled in both Stripe and Vaeroex need no entitlement mutation; record
that no-op comparison privately and retain their original audit evidence. Test-mode
receipts must not be replayed as live events.

## Google Sheets availability

Google verification remains separate work. Until general availability is verified,
Pricing, pre-checkout, integration catalog/setup/authorization, and Help disclose
that Sheets is a limited pilot for approved Google test accounts; subscription
purchase does not provide pilot access. File uploads are the fallback. This release
does not change OAuth configuration, credentials, sync, existing authorizations,
legal document versions, the $250 base plan, or $5 capacity packs.

## Rollback

If app verification fails, do not promote (or restore the previously verified
production deployment). Retain the additive database objects: old application code
continues using the unchanged v1 RPC. Keep affected provider deliveries retryable;
do not erase receipts or force entitlements to simulate success.
