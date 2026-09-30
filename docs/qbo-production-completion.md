# QBO Production completion candidate

## Verified starting point

This candidate starts from `1ea316f7b10ab7fc83fa1293662e5a479b0799a7` on
2026-09-29. Production was running that commit. Its QBO runtime configuration
and Production QBO connection counts were both zero. No QBO Cloud Run service
or queue existed in the dedicated project. The five existing numeric database
secret versions were present and their separate non-superuser, non-BYPASSRLS
session-pooler principals passed certificate-verified read-only checks. The
Production Intuit secret containers had no versions. These are observations,
not permanent assertions about a later deployment.

## Retained execution boundary

QBO retains its existing native database roles, task-bound credential authority,
KMS encryption, Cloud Tasks delivery fencing, and source/checkpoint contracts.
Those contracts explicitly depend on the narrow login-role membership and
leased-task identity. Replacing them with a broad service-role backend would
be a larger security change than completing the existing path. The retired
Square proof VM and native provisioning operations are not used.

Square's current customer implementation supplies useful patterns: derive the
owner and session on the server, independently authorize in PostgreSQL, persist
encrypted credentials before discovery, preserve uncertain exchange outcomes,
and show retained data without a new provider request. QBO company identity,
token policy, reports, accounting treatment, webhooks, and change tracking remain
provider-specific.

## Release order

1. Qualify the exact candidate, including the formerly skipped database suites,
   same-row refresh races, customer isolation, recurring synchronization,
   source validation, product rendering, and independent security review.
2. Reconcile the actual Production ledger and catalog. Stage only the exact
   canonical applied prefix and reviewed new Production migrations. Do not
   include the repository's unrelated Sandbox migration history or the retired
   unapplied Square native first-read candidate. An uncertain apply result
   requires ledger/catalog reconciliation before any retry.
3. Publish immutable runtime and edge artifacts from the reviewed commit; verify
   image provenance and scans. Provision only metadata-pinned secret versions.
   Never put provider credentials in a build context, Terraform value, log,
   command argument, browser snapshot, or client bundle.
4. Plan infrastructure against the existing static-egress foundation. Import
   existing resources into the chosen state rather than creating replacements.
   Reject unexplained changes or destruction. Initial deployment keeps the queue
   and scheduler jobs paused. The application connection gate remains closed.
5. Verify service identity, TLS, exact OIDC audiences, sanitized callback ingress,
   certificate/DNS, provider read-only policy, and the expected static egress.
   Register the real Production callback while preserving necessary existing
   registrations. Configure signed webhook delivery using the Production
   verifier, not the Development verifier.
6. Register the verified database runtime configuration and private application
   configuration. Open the customer flow only after review and health checks.
   A customer must personally authorize the intended company for their workspace.
7. Verify a real initial import, actual coverage, provenance, repeated/incremental
   work, unattended change detection, and customer status. Do not infer this
   result from a Sandbox fixture or an approved developer application.

## Rollback and accounting limits

Pause dispatch and schedulers before changing the runtime. Close new connection
admission as needed. Preserve encrypted credentials, KMS access needed for
revocation/recovery, existing source versions, checkpoints, and evidence. Do not
revert applied migrations or delete customer records as a rollback mechanism.
Reconcile in-flight provider operations and database acknowledgements before
retrying. An old image is not automatically compatible with a new database
contract; review that pairing before traffic rollback.

QBO reports are non-additive control observations. Square cash movement is not
automatically QBO recognized revenue. Without a proven cross-provider identity
and authority relationship, show separate provenance and an unavailable combined
total instead of inventing matches. Quarantined, incomplete, stale, or unsupported
data must not be presented as a fresh zero. Deterministic import and replay do
not need a model call.

## Phase 5 regression correction

Assertions 47-48 belong to the synthetic-provider credential-security suite.
The prior fixture's refresh credential expired on 2026-09-21; server-authoritative
time therefore correctly rejected both workers on 2026-09-29. The corrected
fixture anchors synthetic lifetime to the database transaction clock and retains
the winner/loser checks. Additional assertions verify winner ciphertext authority,
the loser's bounded response, expired-credential rejection, and reauthorization.
This does not waive any CI failure or change the runtime refresh contract.

## Release dependency security

The existing Next.js 15.5.21 baseline failed the current registry security audit.
The candidate pins Next.js and its ESLint configuration to the patched 15.5.24
release and pins its optional Sharp dependency to 0.35.4, within Next's supported
`^0.34.3 || ^0.35.3` range. This is not a Next.js 16 migration. Relevant upstream
advisories are [Next AVIF processing](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4),
[Sharp libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), and
[Sharp libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
Retain the exact patched-version regression and require build, image handling,
browser, and dependency-audit verification before release.

## Qualification and remaining release boundaries

The local candidate qualification executed the existing Phase 0 through 8B
static suites (2,594 assertions), architecture (555), Production static contracts
(236), and 587 focused TLS, OAuth, service identity, runtime, source validation,
database harness, and customer-reader checks. The embedded database checks are
registered in the normal completion script; they do not replace native SQL tests.
Native qualification applied both the clean canonical 120-migration baseline and
the exact 108-migration Production baseline, each followed by the four candidates.
Each layout passed 232 assertions, including real concurrent sessions, with an
unchanged Square catalog. The four candidate migrations remain unapplied to
Production. Hosted `verify` and `security-database` must pass the committed head;
local evidence is not a waiver for those gates.

Those totals describe the earlier source-browse candidate, not the final release.
The 2026-09-30 accounting candidate adds the forward-only
`20260930193412_qbo_production_accounting_intake.sql` migration. It creates no
customer consent, runtime configuration, connection, credential or schedule on
application. All five candidate migrations still require the exact-head release
and Production-ledger checks before deployment.

The current candidate connects validated Production sources to the existing
canonical facts, reconciliation contribution events, Phase 3 deterministic
registry, and Executive Intelligence producer. An authenticated, current
workspace owner must separately approve the fixed posted-accrual policy and
effective date at `/app/settings/integrations/quickbooks/accounting`. This binds
the exact connection generation, mapping row version, realm fingerprint and
currency. Mapping reinstatement requires fresh owner approval. No developer's
approval substitutes for an actual business entity's consent.

Only supported, explicit posting-account detail is admitted: ordinary sales
lines and balanced journals with validated Income/Other Income classification.
Current Item classifications cannot invent historical posting accounts. Tax,
discount, group, foreign-currency or otherwise ambiguous economics remain under
review instead of being silently simplified. Legacy projections lacking the
required evidence are not promoted. Payments, deposits, transfers and report
totals do not become revenue. Reports remain non-additive controls, and Square,
manual and upload contributions are excluded by this explicit policy.

Admission and withdrawal use immutable source applications, canonical fact/source
edges, versioned native reconciliation cases and exactly-once financial events.
Source correction, void, mapping withdrawal and durable disconnect invalidate
effects; owner withdrawal preserves truthful fact history. Same-generation
connectivity failures block new admission/current display without orphaning
already-admitted effects. Reconsent can reuse an unchanged fact once, never add
the prior contribution twice. SQL independently checks posting amounts, dates,
dimensions and evidence even when a worker submits a valid hash.

The bounded validation-maintenance cycle also runs accounting admission and
deterministic processing. Independent visit timestamps prevent one blocked
tenant from starving another. Only the existing monthly revenue aggregate/KPI
formulas run, and only changed dependency scopes are dirtied. Database-owned
monotonic completion times, prior-watermark fencing and coherent summary reads
prevent stale values from appearing current.

Executive Intelligence receives entity/currency-scoped **partial admitted posted
revenue subtotals**, with native fact/source provenance and derived-only evidence.
It does not assign performance targets, claim complete posted revenue, treat
reports as a comparable population, merge Square cash activity, or manufacture
Business Health conclusions. Canonical money stays decimal; presentation numbers
require lossless decimal round-trip conversion. Amounts that cannot safely cross
that interface remain exact strings in the view. See
[the stored-data contract](qbo-customer-stored-data.md) for the inspection boundary.

Focused native qualification applies both canonical `120+5` and Production
`108+5` migration shapes. The latest run passed **520 assertions per shape**,
including 215 accounting end-to-end/adversarial assertions and real concurrent
admission sessions. It covers forged values, cross-source/stale authority,
service-role denial, correction, void/restoration, consent withdrawal/regrant,
mapping reapproval, exact deterministic totals, summary fencing and disconnect.
The Square catalog was unchanged. This is isolated synthetic evidence, not a
claim of live-company or deployed end-to-end verification.

The focused browser gate now includes owner consent/revocation and the accounting
summary, in addition to stored-data browsing. Synthetic desktop, tablet and
mobile checks preserve explicit unchecked consent, an unfilled effective date,
keyboard-accessible provenance links, bounded responsive layout, and no amount
for disabled/pending/unavailable calculations. The accounting producer passed 78
focused checks including that browser path. Phase 7 (606), Phase 8B (710),
architecture (555), TypeScript, scoped ESLint and whitespace checks also passed
locally. Required hosted gates must still qualify the exact committed head.

The isolated legacy validator harness loads the exact new projection-version
allowlist block, rather than testing the current v2 serializer against an old
v1-only function. The browse-only diagnostic regression still prohibits raw
QuickBooks observations from entering Intelligence; it now permits only the
separately qualified accounting KPI/provenance producer. The posting-date test
requires both the task window and owner-policy cutoff. These updates preserve
the security predicates instead of waiving failed checks.

## Supported Production webhook subscriptions

Production CloudEvents use Intuit's `void` event spelling; it is normalized to
the internal `voided` operation only after raw-body HMAC verification. Subscribe
only to the following supported entity/event combinations:

| Entities | Events |
| --- | --- |
| Account, Customer, Item, Vendor | Create, Update, Delete, Merge |
| Invoice, Payment, CreditMemo, SalesReceipt, RefundReceipt, BillPayment, Purchase, Transfer | Create, Update, Delete, Void |
| Bill, VendorCredit, Deposit, JournalEntry | Create, Update, Delete |

Do not select Emailed or additional unsupported events. These 60 combinations
are covered by focused signed-envelope tests. Invalid signatures fail before
parsing or persistence; stored verifier version metadata is not signature proof.
See [Intuit's webhook configuration reference](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html).

Production client/verifier version 1 and disabled HTTPS ingress were separately
verified before this accounting work. Operational secret bindings, runtime
deployment, real customer consent/company binding, actual ongoing delivery, and
representative Production record reconciliation remain release/activation gates. The
developer application's approval and mocked browser/database checks are not
evidence that these gates passed. Keep the connection feature gate closed and
execution paused until the applicable release scope and all required gates are
explicitly verified.
