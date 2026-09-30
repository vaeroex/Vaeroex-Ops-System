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
- Also select Void for BillPayment, CreditMemo, Invoice, Payment, Purchase,
  RefundReceipt, SalesReceipt, Transfer.
- Leave Emailed and every other entity unselected. No report or CompanyInfo
  webhook subscription is supported by this parser.

These are 60 supported entity/operation subscriptions. Do not copy the portal's
all-events default. Registering is distinct from enabling processing or connecting
a company. If Save insists on a 2xx delivery before revealing the verifier, stop
and obtain Intuit's supported bootstrap procedure; do not synthesize a verifier,
accept unsigned notifications, or change 503 to 200 to pass validation.

The separate secret is raw verifier-token bytes, not OAuth JSON:
`projects/vaeroex-qbo-prod-20260827/secrets/qbo-intuit-webhook-verifier`.
Private Terminal entry must use hidden input, transmit directly to Secret Manager,
refuse an existing version rather than rotate automatically, and verify only
numeric version/ENABLED metadata. It must not mount the secret or enable ingress.

PR #448 stays draft/unmerged. No migration, company connection, synchronization,
additional service, queue, scheduler, DNS change, Intuit save, or activation is
part of this correction. Model calls remain zero; `promotionAuthorized=false`.
