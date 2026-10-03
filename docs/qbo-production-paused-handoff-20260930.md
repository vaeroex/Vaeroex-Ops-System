# QBO release paused checkpoint: 2026-09-30

## Stop boundary

Paused at the user's explicit request. Do not resume tests, builds, merge,
migrations, deployment, scheduling or activation until the user says resume.
This is an **incomplete, unqualified checkpoint**, not a release approval.
PR: https://github.com/vaeroex/Vaeroex-Ops-System/pull/448
Branch: `codex/qbo-production-completion`. Previous remote head:
`f70508dbceb00ed6587505dac35b4d7a52dd65d3`. The commit containing this handoff
preserves the subsequent WIP image and browser-diagnostic changes.
Base/main last verified: `1ea316f7b10ab7fc83fa1293662e5a479b0799a7`.

## Incomplete changes saved here

- `services/external-integrations-qbo/Dockerfile`: proposed maintained Node 22
  Debian 13 nonroot runtime, digest
  `5ef534d3db0ac0c43bee379af4ae49cfbfc0ef38a46c94c52d87c68f32f34d8a`.
- `services/external-integrations-qbo/cloudbuild.yaml` and `image-smoke.mjs`:
  proposed finished-image, network-isolated six-mode smoke. Not executed yet.
  Checks nonroot, embedded OpenSSL, absent native addons/pg-native, source
  identity, health, disabled ingress and unauthenticated service denial.
- `scripts/external-integrations-qbo-production-regression-tests.js`: new base
  pin and smoke-registration assertions; focused run passed 238 assertions.
- `scripts/qbo-accounting-authority-ui-tests.cjs`: investigation assertions only,
  **still failing** on CI Chromium. Do not interpret these as the final fix.

No application authorization, credential, accounting, migration or Terraform
semantics were changed during this investigation. No production action occurred.

## Hosted browser failure

Run 1521, ID `36780444830`, head `f70508db...`:
`security-database`, `native-broker-qualification` and
`jit-canary-linux-qualification` passed. `verify` failed at the accounting-owner
browser fixture; later verify steps were skipped, not passed.
https://github.com/vaeroex/Vaeroex-Ops-System/actions/runs/36780444830
Verify job: `110109060566`.

Reproduced with Playwright 1.62.1 / Chromium 151.0.7922.34 (revision 1234).
Eleven unit tests pass; the twelfth browser test fails. The synthetic form POST
returns the exact expected 303 Location and the mock authority becomes enabled.
The redirected navigation then reaches `chrome-error://chromewebdata/` with
`net::ERR_NAME_NOT_RESOLVED`, no page JavaScript error. The synthetic origin is
`https://qbo-accounting.test`; this points to redirect interception/transport,
not a demonstrated rejection by the authorization route. Investigate the fixture
transport on resume; retain real browser redirects, strict HTTPS/Origin checks,
explicit consent, effective date and owner authorization. Do not skip the test.
Last local session `65763` finished with exit 1; no test remains running.

## Image security and independent review

The finished f705 runtime image is **not qualified**:
`sha256:0921b3d83db780bad88a793aea46258d73896cc1944e079c4e75f75b1e406559`.
Its deprecated Debian 12 base scan reports 1 CRITICAL, 6 HIGH, 31 MEDIUM,
27 LOW, 1 UNKNOWN; secret matches 0. Do not deploy it.

The proposed public Debian 13 base scan reports 0 CRITICAL, 2 HIGH, 28 MEDIUM,
10 LOW. The HIGH findings are CVE-2026-75804 (QUIC) and CVE-2026-84782 (DTLS),
in `libssl3t64 3.5.7-1~deb13u2`; Debian's fixed revision is `~deb13u3`.
Keep scanner severities unchanged. Upstream rates the QUIC advisory Low.
Sources: https://security-tracker.debian.org/tracker/CVE-2026-75804 and
https://security-tracker.debian.org/tracker/CVE-2026-84782 .

Independent read-only reviewer Descartes completed and was closed. Its traversal
covered 82 reachable repository files, finding no QUIC/DTLS/datagram/FFI or
custom-dispatcher path; HTTP/fetch and pg TCP/TLS are used. It supports a narrowly
artifact-bound non-applicability assessment only after finished-image evidence:
exact image/platform/bundle hashes, actual ELF/library/native-addon reachability,
all service modes and deployment configuration (including NODE_OPTIONS,
NODE_PG_FORCE_NATIVE and preloads). A base scan or startup memory map alone is
insufficient. No global CVE ignore or unrelated Square exception is approved.
If exposure remains unresolved, use a maintained patched image. The proposed
new image has **not been built or scanned**, and its smoke has not run.

## Remote builds and plans

Completed f705 builds in `vaeroex-qbo-prod-20260827`, region `us-central1`:
- Runtime: `790a8298-cb4b-404e-b613-6978f1bab3fa`, SUCCESS, unqualified digest above.
- Callback edge: `7ac0c3e9-01f3-40a1-a93f-d5f99a258d8e`, SUCCESS,
  `sha256:d28cf116edddc7f8a5a1d95e4c7656954c56d5c4fa11705f92db6e3e40bd75ef`.
Check using `gcloud builds describe BUILD_ID --project=vaeroex-qbo-prod-20260827 --region=us-central1`.
No build for this WIP checkpoint was started. A checkpoint push may start normal
hosted checks/Preview automatically; do not retry or manually dispatch anything
while paused. Record any resulting run ID in the durable local pause receipt.

The f705 plan proposed 33 creates, 2 updates, 0 deletes, with queue and all three
schedulers paused. Plan SHA-256:
`866ba66c2dc1172cf448fc1b944b277190f134e3c135f6acb03c31930fe5a3df`.
It is **not applicable to this changed candidate**. Plans used copies of the
five-resource foundation and eleven-resource disabled-ingress state; original
state ownership was not moved. No apply occurred. Before any future apply,
reconcile existing ownership under an exclusive operator lock and regenerate
the exact-head plan. Do not apply the old plan or duplicate resource owners.

## Last verified Production state

- Supabase `mdiianhfrojmxqpwrflh`: 108 canonical applied migrations. User's private,
  certificate-verified normal dry run passed at 2026-09-30T21:36:03.495Z with
  exactly five pending migrations; nothing applied, no temporary login role.
- Pending: `20260930001000_qbo_customer_oauth_completion.sql`,
  `20260930002000_qbo_production_ongoing_sync.sql`,
  `20260930003000_qbo_customer_source_browse.sql`,
  `20260930004000_qbo_production_source_validation.sql`,
  `20260930193412_qbo_production_accounting_intake.sql`.
- Production QBO connections/runtime configurations: 0/0. Feature gate remains
  absent/false. No company is authorized for live verification.
- Existing ingress remains bootstrap-only, revision
  `qbo-production-oauth-ingress-00002-flh`, source
  `dd7a77b5a583ac978b2e05d7af5c74408507f363`; no operational DB/secret binding.
- HTTPS ingress IP `136.81.90.78`, certificate ACTIVE, hostname
  `integrations.vaeroex.com`; static outbound IP `34.134.226.250`.
- No operational queue or scheduler exists. Seven secret containers each have
  exactly enabled numeric version 1 (five narrow DB URLs, Intuit client,
  separate webhook verifier). Values were not read or printed.
- No new QBO call, company consent, customer financial authority or model call.
  `promotionAuthorized=false`. Original unrelated Terraform/foundation edits
  and `supabase/.temp/` remain untouched.

## Resume sequence and approvals

1. Require the user to say resume; check remaining Codex usage (20% at pause,
   pause again at 5%). Collect automatic hosted checkpoint results, no blind retry.
2. Fix only the synthetic redirect fixture and run its focused browser checks.
3. Finish image compatibility/reachability evidence, independent disposition and
   exact finished-image scan; keep the two findings visible until adjudicated.
   Build helper must include `image-smoke.mjs` in its archived build context.
4. Commit/push the final corrections and obtain all exact-head hosted gates.
   Previous passes do not qualify the WIP head. Final source change requires new
   image provenance and a fresh non-destructive plan.
5. Only after gates: fresh Production preflight and private hidden password entry
   for normal migration application. The prior password was not retained. Do not
   reuse a dry-run receipt as permission to skip reconciliation.
6. Follow existing authorized dependency-ordered operational release with queue,
   schedulers and customer gate closed until security/health checks pass.
   Cost growth, destructive/unexplained plan changes or enforced approval require
   stopping. No real company consent/import is authorized.

Durable local records are under
`/Users/isaacvizcarra/Documents/ChatGPT/QBO-Deployment-Records/`:
`20260930-operational-candidate`, `20260930-release-f70508d`,
`20260930-disabled-ingress`, and the new `20260930-paused-checkpoint`.
The pause receipt records the final commit, backup hashes, saved helper paths,
untracked tool-cache exclusions and any automatically started hosted run.
