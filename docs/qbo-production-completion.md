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

The product surface currently provides validated accounting-record inspection,
non-additive report observations, lifecycle and import-quality diagnostics, and
provenance. It does **not** complete canonical accounting intelligence or connect
those observations to snapshot intake. That next stage requires immutable source
selection, explicit customer/operator source-authority policy, qualified single
fact admission, lifecycle reversal and deterministic snapshot receipts. In
particular, `Income` plus `Other Income` transactions are not automatically a
comparable population for a report's `Total Income`. No combined Square/QBO
revenue, financial contribution, KPI, or evidence eligibility is inferred here.
See [the stored-data contract](qbo-customer-stored-data.md) for the exact boundary.

Production credentials, callback/DNS and hosted ingress verification, real
customer consent/company binding, actual ongoing delivery, and representative
Production record reconciliation remain deployment/activation gates. The
developer application's approval and mocked browser/database checks are not
evidence that these gates passed. Keep the connection feature gate closed and
execution paused until the applicable release scope and all required gates are
explicitly verified.
