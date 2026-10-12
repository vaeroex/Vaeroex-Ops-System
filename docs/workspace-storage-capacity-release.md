# Workspace storage and paid capacity

This feature gives each workspace an independent 15,000,000,000-byte allowance and 500 original-file slots. No allowance is pooled across workspaces or businesses. Decimal GB are used for customer capacity; the per-original limit is 25 MiB (26,214,400 bytes).

Settings → Usage & Storage reports exact included/total allowances, retained original bytes, available capacity after reservations, active and archived files, ordinary Trash, protected historical Trash, and the 50 largest retained originals. Trash is separately paginated with one-based pages. Missing originals are shown as missing instead of consuming phantom file slots. Retained objects without records remain counted until reconciled. Database estimates are separately labeled and excluded from the paid file quota.

## Purchase terms for final release review

Terms version: `storage-capacity-v1`. Live purchases are activated only after the product owner reviews the concrete terms and approves this version. Test checkout remains fully exercisable before that activation.

- Each recurring $5 USD/month pack adds 10,000,000,000 bytes and 500 file slots to its selected workspace.
- Owners can choose additional capacity at every usage level. Self-service is bounded to 10 paid packs: 115 GB and 5,500 file slots total. This is a file-capacity ceiling, not a promise of enterprise processing or integration throughput. Larger deployments require separate qualification.
- Each explicit purchase starts a separate monthly subscription with a fixed renewal anchor. The review shows new total allowance, recurring new/total capacity charges, Stripe's amount for the first period at review time, exact renewal date/time, and cancellation effect. The initial period may be prorated. Final Checkout confirms its current payment amount; it must not exceed the reviewed amount. Subsequent full monthly periods cost $5 USD per pack. Preparing an unpaid checkout for this review does not authorize a charge; the payment URL is withheld until the owner accepts the recurring purchase. There is no automatic expansion, metered overage, trial, coupon, or billing credit path.
- The implementation currently charges the disclosed USD amount with `automatic_tax.enabled=false` and disables automatic currency conversion. It does not add tax at Checkout. Whether the $5 amount includes all applicable taxes, and where this policy can be sold, are explicit final owner decisions before live activation. The test price is inclusive; that test configuration does not qualify production tax handling.
- Canceling renewal leaves capacity through its paid period. A failed renewal stops adding new paid periods. A partial refund leaves the period's capacity in place; a full refund withdraws that invoice's capacity. An active or lost payment dispute withdraws the disputed period. A verified won dispute or closed inquiry restores any still-current, unrefunded paid period. Provider timestamps and current dispute records prevent older event work from reversing newer reconciliation. Existing originals remain retained and restorable in every case; only new uploads that need unavailable capacity are blocked.
- The 10-pack purchase guard includes existing subscriptions that can still renew, plus the workspace's in-progress purchase. This prevents a failed subscription's later recovery from silently exceeding the qualified operating limit. Refunding a payment does not itself cancel future renewal; the owner can cancel renewal separately.
- A payment-success URL never grants capacity. Verified billing events reconcile provider objects into idempotent paid periods. Quantity, product, price, workspace, customer, subscription, invoice, currency, and successful charge attribution are checked before entitlement is granted.

There is no manual-credit release step and no planned dormant purchase feature. The remaining live-purchase gate is the user's requested final pricing/terms review, followed by activation after the complete staging and normal release checks succeed.

## Lifecycle behavior

All retained originals consume bytes and file slots, including active files, archived files, Trash, and protected historical Trash. A new deletion moves the source to 30-day Trash; bytes and the file slot stay counted until confirmed physical deletion. This keeps restore available above the allowance while preventing Trash/restore from bypassing file capacity. Explicit permanent deletion requires confirmation and retries are visible as pending. Saved analyses/imported business records are not silently deleted with an original.

Pre-existing deleted objects are protected from permanent deletion, including manual purge. Their recovery/download controls remain available, pending an announced recovery/export window. No rollout operation should remove that protection or assign those records an automatic purge deadline without the approved notice process.

At 80% and 95% of byte or file capacity, the page warns proactively. At the allowance, existing access, downloads, search, exports, restoration of retained originals, deletion, operational work, integrations, and analyses remain governed by their existing permissions and separate processing limits. New uploads reserve bytes and a file slot atomically. Browser bytes go through a signed direct Storage PUT; only small metadata requests reach application routes/server actions. Unconfirmed transport outcomes stay blocked in the form and are not automatically retried.

## Release evidence required

1. Run normal typecheck, lint, build, and security/release checks on the exact release revision.
2. Run `scripts/storage-capacity-ui-tests.cjs`, `scripts/storage-capacity-upload-client-tests.cjs`, `scripts/source-upload-form-tests.js`, `scripts/source-upload-action-tests.js`, and `scripts/settings-clarity-regression-tests.js`. These exercise workspace-bound metadata, full 25 MiB transport shape, explicit purchase/deletion consent, expired quote handling, 80%/95% warnings, unknown measurements, non-owner restrictions, Trash pagination, retained form state, and staged-only spreadsheet preparation.
3. Run the isolated database storage and billing qualification suites, including simultaneous upload admission, paid-pack quantity ceilings, restores, expiry, refunds, duplicate/out-of-order events, unlinked objects, and cross-workspace access.
4. Run native staging HTTP/storage checks using synthetic data: actual 25 MiB PUT, completion replay, archive/Trash/restore/purge, missing-object reconciliation, invalid file signatures, origin/role/workspace rejection, and cleanup authentication.
5. Complete Stripe test checkout from the customer UI, verify automatic entitlement from the signed event, replay the event, then verify cancellation/refund/payment failure without data loss. Verify multiple explicit purchases affect only their target workspace.
6. Inspect customer UI at desktop and mobile widths, including owner/non-owner views, purchase review, post-checkout confirmation, protected historical Trash, and storage limits. Synthetic component/transport fixtures are supporting checks; they do not replace staging payment and object-storage qualification.
7. Reconcile objects before enabling byte admission; preserve historical deleted objects. Confirm maintenance scheduling and idempotent billing event delivery in the release environment, then verify production health and workspace aggregates without reading customer contents.

The command list describes required evidence, not a claim that every release check has already passed. The release report must state the actual completed checks and any remaining blocker precisely.

## Completed billing qualification

The [billing evidence manifest](security/audit-evidence/workspace-storage-capacity-billing.json) records 19 controlled-provider server tests and 28 checks against real Stripe test-mode payments with native local Supabase. Those checks cover the fixed renewal date, recurring charge totals independently of currently paid capacity, successful payment attribution, invalid signatures, duplicate events, first-period amount, cancellation through the customer endpoint, partial/full refunds, retained files, and a real declined renewal advanced through a Stripe test clock. The full storage/database suite separately passed 85 checks, including tenant isolation, five-writer admission races, the 10-pack operating ceiling, renewable commitments after a refund, refund ordering, and restoration after a won dispute.

The 28 Stripe payment checks fetched real events from Stripe and replayed them through the application's signature-verifying endpoint using a local test webhook secret. Five additional checks then used the official Stripe CLI 1.53.1 to receive and forward a newly created provider cancellation event directly to the production-mode local staging app. The endpoint returned 200 and automatically reconciled the cancellation while preserving current paid capacity and files. This second check did not construct or replay the event locally. The CLI event used the account's `2026-05-27.dahlia` snapshot version; authoritative object retrieval stayed pinned to `2024-06-20`. Delivery to the eventual hosted release URL must still be verified at deployment. Browser payment confirmation used synthetic actors and test cards. No customer card was charged.

Live activation requires `STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY` to identify the qualified $5 monthly price and `WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS=storage-capacity-v1` after the requested owner review. The subscription webhook must receive the relevant Checkout, subscription, invoice payment/failure, refund, and dispute events. Staging test mode remains usable without the live-approval variable.

## Activation runbook

1. Complete the final revision's checks above and record the single owner approval of `storage-capacity-v1`, including the first-period proration, fixed USD charge with no added Checkout tax, refunds/disputes, and the 10-pack qualification ceiling. Keep the live approval variable empty until that decision. The feature's test-mode purchase flow is already implemented and exercised.
2. Use a dedicated Stripe product for workspace capacity and create its recurring price with `currency=usd`, `unit_amount=500`, `billing_scheme=per_unit`, `recurring.interval=month`, `recurring.interval_count=1`, `recurring.usage_type=licensed`, and `active=true`. Set `tax_behavior` consistently with the owner's approved tax treatment; the price validator currently verifies the charge, currency, interval, mode, and billing scheme, not tax registration or jurisdiction. This release uses `automatic_tax.enabled=false`, no coupons or credits, and no automatic currency conversion. If added tax is required, revise and requalify the checkout/invoice checks before activation. A test price ID must never be copied into live configuration.
3. Provision environment-scoped `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY`, the correct public application URL, existing Supabase server credentials, and `CRON_SECRET` (at least 32 random characters). Keep keys and the webhook secret server-only. Preserve the existing base-plan price and webhook event subscriptions. Configure the actual release endpoint `/api/stripe/webhook` to receive the additional snapshot events listed below, using API version `2024-06-20` for this qualification. The server independently retrieves provider objects with that pinned version. Verify signed delivery in the release environment before opening purchases.
4. Apply the normal reviewed migration chain in timestamp order: `20261012003846_workspace_storage_capacity.sql`, then `20261012003920_workspace_storage_capacity_billing.sql`. The first migration marks existing missing originals and protects all historical deleted records before introducing admission. Do not run the old application upload path against the new reservation guard; coordinate migration and deployment in the normal release window. The billing migration replaces the zero-pack entitlement getter with verified paid periods. After migration, run the service-only `reconcile_workspace_storage_v1(workspace_id)` for each workspace and inspect only its aggregate result. Resolve every `unknown_size_objects` result before admitting new uploads; retain missing-file metadata and historical objects. Do not infer physical deletion from a missing database record.
5. Deploy the checked application revision. Verify that Vercel has scheduled authenticated `GET /api/storage-capacity/maintenance` every 15 minutes from `vercel.json`; the request uses `Authorization: Bearer <CRON_SECRET>`. Verify 401 without authorization, successful authorized execution, and retry behavior with synthetic data in staging. Maintenance processes at most 100 due file purges and 100 expired uploads per batch, protects historical Trash, removes objects through Storage, and finalizes database state only after object removal. Monitor failed batches and pending deletion age.
6. After the requested final approval and successful release checks, set `WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS=storage-capacity-v1` in the live deployment environment and deploy that configuration. Verify owner purchase availability at low usage, non-owner rejection, exact workspace totals, review disclosure, and receipt/event processing. Do not make a live purchase merely to verify that the page is available. Every real charge still requires that workspace owner's explicit checkout confirmation.
7. Monitor event failures/retries, paid-period reconciliation, reservation expiration, purge retries, and aggregate usage. Preserve the existing webhook processing and cancellation endpoints throughout the subscription lifetime. Historical deletion notice and a recovery/export window are a separate required communication step before any future historical purge policy; this activation does not start a hidden deadline.

Additional Stripe events to enable (retain events required by the base subscription):

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
charge.refunded
refund.created
refund.updated
refund.failed
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
```

The handler reads current provider records and deduplicates immutable event IDs; a browser return URL, quote, incomplete checkout, or failed invoice cannot grant capacity. Refund/dispute processing must stay enabled even when new purchases are disabled.

## Rollback and incident operation

Clear `WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS` and redeploy configuration to stop new live purchases. This does not cancel an already accepted checkout or existing subscription. Expire any still-open affected Checkout sessions through Stripe after verifying their state; never silently leave paid customers without event processing. Keep the paid-period ledger, webhook, owner cancellation, retained file access, and maintenance running. Do not drop migrations, delete customer objects, change paid quantities by hand, or disable tenant/admission guards as a rollback shortcut.

For an application regression, deploy the last qualified revision that supports this schema, or make a reviewed forward fix. The previous direct-upload application is not compatible with the new reservation guard. Reconcile delayed provider events through the existing idempotent webhook after the fix; there is no manual capacity-credit procedure. Any customer refund or subscription cancellation must be an explicit provider action with its normal verified event and disclosed effect. Existing originals remain retained and restorable while new uploads over the resulting allowance are blocked.
