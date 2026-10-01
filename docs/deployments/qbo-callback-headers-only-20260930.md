# QBO callback headers-only compatibility correction

## Diagnosis and boundary

The disabled public ingress has valid HTTPS, but a synthetic canonical denial
(`error=access_denied` and a 46-character `i1_` state) returned the edge's fixed
400 instead of reaching the disabled backend. The synthetic query satisfies the
existing callback contract; it does not represent an issued OAuth state.

The edge incorrectly used the Proxy-Wasm request-header `end_of_stream` flag as
body authority. Google's official Service Extensions tester invokes
`onRequestHeaders(..., false)` unconditionally, including bodyless requests:
[framework.cc, pinned upstream reference](https://github.com/GoogleCloudPlatform/service-extensions/blob/9127abab99211aa726a19ab222e20f619f577cb6/plugins/test/framework.cc#L212).
Edge extensions support request headers only, not body observation:
[Google extension contract](https://docs.cloud.google.com/service-extensions/docs/lb-extensions-overview).

The correction separates header validation from actual stream completion:

- Exact host, method, path, query allowlist, state shape, query stripping, forged
  handoff removal, header limits, and fixed redacted rejection remain unchanged.
- The edge rejects declared bodies, ambiguous content length, transfer encoding,
  and Expect headers. It no longer treats the header callback's stream flag as
  proof of a body.
- Operational ingress must observe an empty, completely received request before
  parsing either handoff and before any callback broker operation. Bytes,
  incomplete/aborted streams, errors, and a five-second timeout fail closed.
- Bootstrap still returns 503 before loading operational ingress or reading any
  body, credential, secret, database, or provider. No signature exception or
  unverified-webhook acknowledgement is introduced.

Focused coverage includes both ABI flags, success and denial shapes, invalid
framing, actual body bytes despite absent/zero length, real loopback HTTP GETs,
abort/error/incomplete/timeout paths, and zero broker calls on failure. Required
hosted CI must pass for the exact candidate before deployment. The live result
must then verify canonical synthetic callbacks reach disabled 503 while malformed
callbacks remain rejected. No real OAuth state or provider credentials are used.

## Webhook registration is independent

The intended endpoint is `https://integrations.vaeroex.com/webhooks/qbo`; the OAuth
redirect is separately `https://integrations.vaeroex.com/oauth/callback`.
Intuit's [registration instructions](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html)
provide a verifier after endpoint configuration, do not specify a registration
challenge protocol, and limit change notifications to OAuth-authorized companies.
A successful event delivery requires a genuine verifier and verified HMAC; the
disabled endpoint is deliberately not a successful event consumer.

Production dashboard inspection found no saved endpoint, a disabled verifier
display control, CloudEvents off, and all entity groups selected by default.
Nothing was saved or toggled. For later manual registration:

- Enable CloudEvents payload format (the candidate parses a CloudEvents 1.0
  array, not the legacy envelope).
- Select Create, Update, Delete for Account, Bill, BillPayment, CreditMemo,
  Customer, Deposit, Invoice, Item, JournalEntry, Payment, Purchase,
  RefundReceipt, SalesReceipt, Transfer, Vendor, VendorCredit.
- Also select Merge for Account, Customer, Item, Vendor.
- Leave Void, Emailed and every other entity unselected. The current Production
  dashboard exposes `qbo.<entity>.void.v1`, but the candidate parser accepts
  `voided`, not `void`. This is a separate pre-activation compatibility gap, not
  a reason to change OAuth validation or acknowledge unverified notifications.
  No report or CompanyInfo webhook subscription is supported by this parser.

These are 52 compatible entity/operation subscriptions (48 CRUD plus four Merge).
This is a registration subset, not full operational webhook qualification; Void
coverage needs its own narrow correction before operational activation. Do not
copy the portal's all-events default. Registering is distinct from enabling processing or connecting
a company. If Save insists on a 2xx delivery before revealing the verifier, stop
and obtain Intuit's supported bootstrap procedure; do not synthesize a verifier,
accept unsigned notifications, or change 503 to 200 to pass validation.

The separate secret is raw verifier-token bytes, not OAuth JSON:
`projects/vaeroex-qbo-prod-20260827/secrets/qbo-intuit-webhook-verifier`.
Private Terminal entry must use hidden input, transmit directly to Secret Manager,
refuse an existing version rather than rotate automatically, and verify only
numeric version/ENABLED metadata. It must not mount the secret or enable ingress.

## Verified disabled deployment

Implementation commit `dd7a77b5a583ac978b2e05d7af5c74408507f363` passed
[hosted CI1517](https://github.com/vaeroex/Vaeroex-Ops-System/actions/runs/36758785034):
verify, security-database, native-broker-qualification and
jit-canary-linux-qualification. Focused local checks passed: 64 callback/body
checks, both Go edge packages, 79 disabled-bootstrap assertions, 236 QBO
Production assertions, scoped ESLint, Production runtime bundle and whitespace.
No broad local run or subagent was used.

The refreshed plan matched the saved reviewed plan exactly: zero creates, two
updates, zero deletes. Only the existing ingress artifact/source marker and
callback plugin artifact version changed. Saved plan SHA-256:
`52e859ee5bcf2d222517da40c0d1a82136d254dc85f94432dab9baca0b440fa5`.

- Runtime image: `us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/runtime@sha256:729d6e201cc272ca9d52cb1c71a007e57a3f1c5afeafab0d6e920bf7a641967f`.
- Edge image: `us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/callback-edge@sha256:6458297165b93fee41fdf9a02b986f071962beb9eb4fe8e79c0c01e516d0859c`.
- Both Cloud Build provenance and OCI revision labels identify the exact implementation commit above.
- Ready revision `qbo-production-oauth-ingress-00002-flh` receives 100% of intended traffic; plugin main version is `vdd7a77b5a583`.
- Ingress IP remains `136.81.90.78`; public DNS agrees and the managed certificate is ACTIVE.

At 2026-09-30T18:47:56Z, normal public HTTPS with certificate/hostname validation
passed nine probes. Synthetic success-shaped callbacks, initial/reconnect denial
callbacks, and unsigned/invalid-signature webhook POSTs return the fixed disabled
503 with no-store. Missing-state/extra-query callbacks and wrong-method webhooks
return fixed 400. A declared-body GET is rejected with 400 by Google's frontend
before the plugin. No 2xx acknowledgement of an unverified event is introduced.
The first probe 24 seconds after apply still saw the older rejection during edge
distribution; the repeated bounded matrix passed after propagation.

Fresh Terraform plan: zero creates, zero updates, zero deletes. Bootstrap-only is
still true. Default Cloud Run URLs are disabled/absent, database configuration and
secret mounts are absent, and edge/backend request logging remains disabled.
Bounded retained-log inspection found zero callback/token leakage markers,
unexpected runtime errors or ingress-principal Secret Manager/KMS operations.
Client secret version 1 remains ENABLED; the webhook verifier container remains
empty (metadata only). Intuit settings and DNS were not changed in this step.

The exact bundle, plans, state snapshot, artifact provenance, CI receipt and
sanitized verification records are retained in the private local durable directory
`/Users/isaacvizcarra/Documents/ChatGPT/QBO-Deployment-Records/20260930-callback-correction`.
Future drift checks must use this directory's `inputs.tfvars.json`; the earlier
deployment's inputs remain historical and would request an artifact rollback.
The original disabled-ingress Terraform backend remains unchanged.

PR #448 stays draft/unmerged. No migration, company connection, synchronization,
additional service, queue, scheduler, DNS change, Intuit save, or activation is
part of this correction. Model calls remain zero; `promotionAuthorized=false`.
