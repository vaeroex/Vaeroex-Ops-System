# VSI cross-integration coverage — November 16, 2026

Updated after all three refresh implementation groups (November 17 UTC):
[six reporting connectors](vsi-reporting-refresh-group.md),
[three standalone importers](vsi-standalone-refresh-group.md), and
[Square](vsi-square-refresh-group.md). Together with the existing Sheets and
QuickBooks paths, the candidate implements unattended refresh for all twelve
mapped integrations. The table distinguishes local/fixture verification from
deployed and demonstrated live behavior. See the
[isolated hosted qualification packet](vsi-reporting-hosted-qualification.md).

This is an implementation and qualification inventory, not a claim that every
connector has completed a live automatic-refresh-to-answer test. It continues
merged PR #558 and draft PR #571 without replacing their mapping work or enabling
global gates. The product is Executive Intelligence; Vaeroex is the company and
the in-app assistant.

## Inspected baseline and proof categories

- Current merged main: `796ade18fde960c253b6023c29b182c9222c6f2f`.
- Existing PR #571 head before this continuation:
  `4b8ba77c1df5308546d1be449c20a1f256faff69` on
  `codex/vsi-bounded-qualification`; its four required CI jobs previously passed
  in run `41246346794`. That result does not cover new continuation changes.
- A read-only Vercel deployment lookup on November 16 resolved `www.vaeroex.com`
  to READY Production deployment `dpl_7WFhsfRia5K5Jzwj59zzjV6mLYF6`, source main
  commit `796ade18fde960c253b6023c29b182c9222c6f2f`. This establishes deployed
  application identity, not scheduler state, provider data arrival or answer quality.
- All three ordinary release gates remain literal `false`:
  `lib/ai/shared-evidence/runtime-gate.ts`,
  `lib/ai/shared-evidence/qualitative-policy.ts`, and
  `lib/vsi/failure-accounting-gate.ts`.
- PR #558's protected mapping SQL was recorded as installed by migration
  `20261027162100`; its later PT409 correction is recorded as
  `20261027181014`. This historical receipt is not a fresh catalog check and
  does not authorize replay of either SQL package.
- The all-twelve real-model evaluation used supplied **synthetic** records:
  four questions, eight calls, mechanical and manual review plus isolated
  save/reopen. It did not ingest new provider records, run hosted schedulers,
  or prove hosted cross-user concurrency. See
  [all-twelve qualification](vsi-all12-qualified-release.md).

The tables distinguish implemented application/SQL code, historical live
receipts, and missing current hosted demonstration. No provider secrets were
read, source records changed, access widened, scheduler activated or model call
made by this inventory.

## Two distinct VSI evidence paths

The ordinary path in `lib/vsi/retrieval.ts` already retrieves permitted Business
Notes, Business Memory/file context, KPIs, findings, Health and saved analyses.
Its integration dashboard producer (`lib/integrations/dashboard/server.ts`)
explicitly reads **Square, QuickBooks and Google Sheets**, not the nine other
connectors. The ordinary QBO producer (`lib/vsi/financial-evidence.ts`) adds
eligible retained P&Ls and checked calculations. This legacy path is functional
code; it is not equivalent to the all-twelve protected-source implementation.

The protected shared path in `lib/ai/shared-evidence/` admits retained originals,
projects typed facts and application-computed results, selects bounded relevant
sources, seals exact authority, validates generated references, and rechecks
sources when saved answers reopen. It maps all twelve offered integrations.
The nine legacy connectors require an active owner-reviewed
`legacy_evidence_bindings` row for the exact connection incarnation and business
entity. A successful connection or matching account label is not this mapping.
Sheets, QBO and Square use their dedicated protected readers. See
[the existing field/meaning inventory](../vsi-all-provider-evidence-mapping.md).

`lib/vsi/engine.ts` ordinarily enters that shared path only when its reviewed
runtime gate is enabled. PR #571's bounded manifest guards and the separate
preview activation candidate are qualification mechanisms, not permission for
ordinary production activation. Qualitative synthesis and failure accounting
have independent gates. A private chat qualification must not accidentally
acquire owner-only shared-source authority.

VSI retrieval reads saved evidence; it does not perform a fresh provider sync.
Automatic ingestion must therefore work before a fresh record can become an
eligible answer input. Source pages and saved-answer citations are additional
runtime boundaries, not proof supplied merely by an HTTP-successful model call.

## Complete connector coverage matrix

“Shared gated” below means the protected all-twelve path is implemented but the
ordinary runtime gate is off. “Legacy available” describes a code path subject
to its existing actor, entitlement, source and provider controls, not universal
access or a claim that every workspace has records.

| Connector | Connection / retained ingestion | Automatic refresh and recovery | Typed meaning and deterministic boundary | VSI eligibility / exact stopping point | Demonstrated versus still unproved |
| --- | --- | --- | --- | --- | --- |
| **Google Sheets** | OAuth; selected spreadsheet/tab; approved stable-ID/date/metric mapping and retention/source approval; consistent double read; atomic normalized rows and KPI facts | Authenticated Vercel cron every 15 minutes; connected, approved, opted-in due sources only; pilot allowlist; lease fencing, token renewal, failure backoff and recovery route. Current dispatcher: four concurrent workspaces, at most 100 attempts, 240-second work / 285-second cleanup deadlines | Exact approved values/units and supplied row dates; deterministic validation and accepted fact links. Sheet labels cannot establish accounting semantics, complete coverage or a join | Legacy KPI/dashboard retrieval exists; shared reader also implemented/gated. Pilot, approval, source lifecycle and read tickets remain mandatory | Historical live connector release recorded; synthetic scheduler/SQL/changed-row tests exist. No current witnessed provider-row change → autonomous tick → shared VSI answer in this continuation. External Testing token expiry prevents an indefinite refresh claim |
| **QuickBooks Online** | Owner OAuth, realm/entity mapping; native credential/task authority; normalized accounting records and reports plus validation work | Separate GCP initialization/ongoing scheduler, dispatcher, Cloud Tasks, CDC, validation/accounting recovery and disconnect drain. Terraform `execution_enabled` controls queue/scheduler pause state | Document totals, balance at import, report period/basis/currency and qualified summary totals. Checked P&L calculations exist; unsupported shapes/missing values do not become zero; overlapping rows not summed | Legacy accounting dashboard/P&L retrieval exists; shared typed admission implemented/gated. Validated current source/entity and consent required | Native/disposable DB and synthetic P&L qualification recorded. Read-only November 17 check: three jobs ENABLED, queue RUNNING, five services Ready, recent scheduler/dispatcher/broker/runtime HTTP 200s. New-record delivery still needs a controlled hosted witness; liveness is not ingestion proof |
| **Square** | Owner OAuth; verified merchant/location; bounded Payments page, retained records and durable checkpoint/cursor | PR #571 adds explicit owner-consented hourly update windows on the current customer backend, with up to four pages per tick, retained cursors, renewal, retry/backoff and recovery. Five-minute overlap and bounded catch-up/replay-safe upserts remain. **Local fixture-verified; not deployed** | Completed payment amount in declared minor units with currency and event time; not orders, settlement, accounting revenue, profit or cash flow | Legacy saved-payment/dashboard retrieval exists; shared reader implemented/gated. Recurring code now exists but requires its reviewed incremental Square overlay, exact deployment scope and customer consent; shared VSI remains gated | New real-SQL scheduler → protected payment reader → typed VSI fact composition verifies changed payments, partial windows, backoff and revoked access. Provider HTTP is controlled; no hosted automatic new-payment → cross-source answer proof |
| **Xero** | Owner OAuth/offline refresh; explicit account selection; retained invoice/bill IDs, supplied document dates, currency-partitioned numerical contributions and coverage | PR #571 adds explicit owner opt-in, daily refresh of the last seven completed UTC dates, scoped due dispatcher, current authority fences, shared admission, retry/backoff and expired-lease recovery. Existing 45-second/12-request parser and atomic commit reused. **Local verified; not deployed** | Invoice totals/bills by currency, outstanding balance at last import; no payment/bank/journal/payroll access, cash received or profit inference | Shared gated; exact legacy binding required. Not read by the ordinary three-provider dashboard | Historical designated-account report success October 19; new real-SQL scheduler/protected-source composition and controlled provider fixtures pass. Automatic delivery and hosted shared-answer proof remain missing |
| **Harvest** | OAuth and account selection; retained entry IDs/dates/completed hours/billable hours; running entries excluded | PR #571 adds the same daily, opted-in, scoped reporting dispatcher and recovery. Current-authorizer visibility remains the limit. **Local verified; not deployed** | Tracked hours within authorizer visibility; not team payroll or labor cost; no persisted names/rates/notes | Shared gated and exact legacy binding; no ordinary dedicated producer | Historical designated-account report success October 19; new real-SQL scheduler/protected-source composition and controlled provider fixtures pass. No hosted automatic fresh-entry → shared-answer proof |
| **Clockify** | Owner API key, selected workspace; retained own-entry history by UTC start day | PR #571 adds daily, opted-in, scoped last-seven-complete-UTC-date refresh and recovery. API key owner entries only. **Local verified; not deployed** | Own completed durations and billable hours; cross-midnight duration assigned to start date, not split; not workforce payroll | Shared gated and exact legacy binding; no ordinary dedicated producer | Historical designated-account report success October 19; new scheduler/parser and SQL admission fixtures pass. Actual hosted automatic arrival and cross-source proof remain missing |
| **Toggl 2.0** | Owner bearer key and selected organization/workspace; visible active-project/lifetime-hours snapshot | PR #571 adds explicitly opted-in six-hour snapshot replacement, scoped scheduling and recovery. **Local verified; not deployed** | Project count is a current snapshot; hours are lifetime totals of visible active projects, not weekly hours or historical trend | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded. Synthetic mapping is not real changing-snapshot → answer proof |
| **Zoho Inventory** | U.S. OAuth and selected organization; current active-item and low-stock counts | PR #571 adds opted-in six-hour snapshot refresh, token renewal, scoped scheduling and recovery. **Local verified; not deployed** | Aggregate item/count snapshot; no SKU quantities, costs, orders or inventory adjustments; not inventory valuation | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated test report success October 19 recorded. Automatic change detection and hosted VSI use unproved |
| **Katana** | Owner private key; account bound to immutable connection/key incarnation; stock-row/availability-count snapshot | PR #571 adds opted-in six-hour snapshot refresh, scoped scheduling and recovery; key replacement retains checked lifecycle. **Local verified; not deployed** | Variant/location-row count; unavailable class is on-hand less committed quantity ≤0; no SKU cost/profit or shortage cause | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded; public OAuth partnership still not approved. Automatic and hosted shared-answer proof absent |
| **Loyverse** | OAuth, verified merchant currency; minimized receipts/type/tax/discount/cancellation/creation time and historical coverage | PR #571 adds explicit owner opt-in, daily refresh of the last seven complete UTC creation dates, bounded pagination/atomic import, renewal fencing, shared ten-connector concurrency after the Square overlay, retry/backoff and recovery. **Local fixture-verified; not deployed** | SALE/REFUND keep stored sign; cancellation explicit; no netting/tax double addition/accounting-revenue equivalence. Receipt date differs from import inclusion `created_at` | Shared gated and exact legacy binding. Protected currency projection was added by #558; no ordinary dedicated producer | New real-SQL scheduler/protected-source composition and controlled receipt fixtures pass; currency, refund/cancellation and revocation semantics remain tested. No hosted automatic-refresh or model-answer witness |
| **Zoho Books** | U.S. OAuth and eligible organization; retained invoice/expense IDs/date/currency/total/outstanding and history coverage | PR #571 adds opted-in daily refresh of the last seven complete UTC invoice/expense dates, guarded token renewal, complete atomic import, shared ten-connector concurrency after the Square overlay and failure recovery. **Local fixture-verified; not deployed** | USD/counting policy retained; foreign/draft/void exclusions not business zeros; invoice balance at import is not collection history or profit | Shared gated and exact legacy binding; no ordinary dedicated producer | New real-SQL scheduler/protected-source composition and controlled invoice/expense fixtures pass. Existing setup document records real-customer verification as pending; no new hosted receipt supersedes that limit |
| **Wix Orders** | Approved app installation/instance; approved orders with ID/time/amount/currency/payment status; historical coverage | PR #571 adds opted-in daily refresh of the last seven complete UTC order-creation dates, instance-token access, bounded complete cursor fetch, shared ten-connector concurrency after the Square overlay and atomic import/recovery. **Local fixture-verified; not deployed** | Provider-reported order amount/status; PAID is not bank settlement or posted revenue; no refund transaction/line-item matching | Shared gated and exact legacy binding; no ordinary dedicated producer | New real-SQL scheduler/protected-source composition and controlled order fixtures pass. No hosted automatic new-order → shared-answer proof |

The current offered catalog is the twelve rows above, established by
`app/app/integrations/page.tsx` and `lib/integrations/reporting/catalog.ts`.
Square Sandbox is an environment, not a thirteenth production connector.
Clover, Shopify, BambooHR and partner-pending systems in other branches or
workspaces are not counted as current offered integrations merely because
unmerged code or developer applications exist.

## Source paths and verification receipts

- Sheets scheduling: `vercel.json`,
  `app/api/integrations/google-sheets/scheduled-sync/route.ts`,
  `lib/integrations/google-sheets/scheduler.ts`, `sync.ts`, `read-authority.ts`,
  `app/api/integrations/google-sheets/recover-syncs/route.ts`.
- QBO: `services/external-integrations-qbo/src/scheduler.ts`, `server.ts`,
  `executor.ts`, `cdc.ts`, `validation-recovery.ts`, `accounting-recovery.ts`;
  its `infra/main.tf` and `variables.tf`. Historical deployment/repair records:
  `docs/qbo-production-completion.md`, `docs/deployments/qbo-connect-live-repair-20261002.md`.
- Square: `lib/integrations/square-direct/`,
  `app/api/integrations/square/scheduled-sync/route.ts`;
  `supabase/production-migrations/20261117014116_square_customer_recurring_refresh.sql`;
  `docs/square-customer-backend-release.md`. The new recurring worker uses the
  current customer backend, not the historical native control-plane scheduler.
- Xero/Harvest/Clockify/Toggl/Zoho Inventory/Katana:
  `lib/integrations/reporting/{catalog,routes,adapters,transport,security,oauth,execution,scheduler}.ts`;
  `app/api/integrations/reporting/scheduled-sync/route.ts`;
  `supabase/migrations/20261117005822_reporting_recurring_refresh.sql`;
  `docs/integrations/ready-account-reporting.md`.
- Loyverse/Zoho Books/Wix:
  `app/api/integrations/{loyverse,zoho-books,wix-orders}/sync/route.ts`,
  corresponding `lib/integrations/*/server.ts`, shared
  `lib/integrations/import-refresh/{execution,scheduler}.ts`,
  `app/api/integrations/imports/scheduled-sync/route.ts`,
  `supabase/migrations/20261117012702_import_recurring_refresh.sql`, and
  `docs/integrations/historical-imports.md`.
- Shared semantics: `lib/ai/shared-evidence/generation.ts`, `fact-time.ts`,
  `financial-boundaries.ts`, `invoice-selection.ts`, `answer-contract.ts`;
  `lib/vsi/evidence-window.ts`, `engine.ts` and `citation-links.ts`.
- Reviewed protected SQL specifications and exact incremental dependencies:
  `docs/security-drafts/01-legacy-evidence.sql`, `06-typed-source-admission.sql`,
  `08-sheets-projection.sql`, `mapping-upgrade/manifest.json` and `forward.sql`.
  Bootstrap assemblies must not be replayed over an existing installation.
- Prior qualification limits:
  `docs/qa/vsi-all12-isolated-synthetic.md`, `vsi-all12-qualified-release.md`,
  `vsi-isolated-evaluation-handoff.md`, `vsi-bounded-qualification.json` and
  `vsi-preview-activation.json`.

Some setup documents retain historical assertions. Sheets setup/verification
mentions 50 attempts in five batches; the current scheduler actually implements
100 attempts with four tenant-fair workers. Reporting `next_sync_at` remains the shared manual/provider cooldown; the new
`recurring_next_refresh_at` is a separate scheduled due date. A declared cron is
inert until deployment scope and connection consent both permit it.
The reporting setup's statement that reports are not fed into VSI describes the
legacy released behavior, while #558 supplied the separate dormant shared path.
Historical reports do not refresh because someone merely opens or filters them.

## Remaining hosted proof and enablement gates

The ten previously manual paths now have completed local recurring code. The
remaining work is target qualification, authorized hosted execution and release
review, not another connector mapping or unattended-admission implementation.

1. **Qualify the exact isolated target and migration order.** The proposed
   disposable database `bdmrcmbkiohcqkmcvvua` is not schema-qualified: the inspected
   inventory has 29 repository versions absent and 72 hosted-only versions, and
   the required shared eight-RPC surface is absent. Reconcile the exact dependency
   closure and compatibility; do not apply all missing migrations or replay a
   bootstrap. The reporting/import increments and guarded Square overlay must
   precede their changed application runtime. Preserve existing data, source
   eligibility and all three ordinary shared gates. The hosted packet records
   the project, target and acceptance checks; no exact candidate Preview exists yet.
2. **Stage the reviewed candidate in its permitted environment.** Clockify/Katana
   key-based forms now have an expiring, exact-Preview-host/actor/workspace scope;
   OAuth callbacks retain their production-origin policy. The answer manifest now
   supports an explicit provider set and optional actor/chat/question/source-bound
   citation inspection, without global access. These are locally tested mechanisms,
   not enabled settings. Square retains its Production-only backend gate and needs
   a separately reviewed isolated staging arrangement. Do not pretend a Preview is
   Production or copy production credentials. Vercel does not run Preview crons;
   the proposed temporary external authenticated timer needs its own exact scope.
3. **Run Phase A: new records to refreshed evidence, without a model call.**
   Obtain approval for exact isolated provider accounts, synthetic changes,
   temporary credentials and timer lifetime after prerequisites are satisfied.
   Capture the baseline; change the listed records; let the real schedule run
   without manual sync; verify provider reads, atomic writes, dates, source versions
   and freshness. Exercise failure, recovery, stale/incomplete coverage and revoked
   access. Historical corrections outside the seven-date window still need an
   explicit historical import; snapshot endpoints cannot reconstruct history.
4. **Run Phase B against the resulting immutable source versions.** Freeze the
   three-slot answer manifest only after Phase A produces its final source hashes.
   Use the existing bounded Luna-only accounting and private-chat isolation checks.
   Inspect a genuine cross-provider answer, exact dated source pages and saved
   reopening; reject wrong actor/workspace, changed hashes and expired scope.
   The existing ceiling is fifteen calls / USD 2, subject to the precise campaign
   authorization and current rate verification. A controlled rendered fixture is
   not a model-written answer and does not spend that allowance.
5. **Qualify every connector in the matrix and review release separately.**
   A first Clockify/Katana witness does not certify the other ten connectors,
   payroll, snapshot history or arbitrary customer records. Continue in provider-
   appropriate groups with explicit scope, records and expected semantics. Record
   overlap, currency/basis/period mismatch, stale/empty/ineligible sources and
   unsupported joins. Only exact-head CI, target preflight and authorized hosted
   evidence can support a later reviewed release; no broad deployment is authorized
   by the local implementation receipt.

Payment activity, invoice/accounting revenue, profit, and cash flow remain
separate measures. No overlap is added, no cross-provider transaction identity
is guessed, and no correlation becomes cause. Descriptive documents and approved
notes remain contextual evidence; they do not rewrite deterministic metrics.

## Hosted authority boundary

Local inspection and isolated tests are authorized. Current activation plans
require a separately reviewed exact Preview deployment, protected-preview
compatibility, selected test actor/workspace/chat/source hashes and an explicit
short qualification window. Temporary membership/entitlement/lock changes must
name exact targets, duration and restoration, not broaden production access.
The manifest's existing ceiling is three fixed questions/fifteen calls, no web,
no retries or fallback, with a documented conservative USD 1.716 reservation
inside the prior USD 2 campaign ceiling. Recheck the applicable approval and
rates before any paid execution; unused slots are not permission to rotate IDs
or expand the campaign. Any new paid campaign outside that plan needs its own
bounded approval. No customer credentials, real source payloads or canary values
belong in public receipts.

Source/entity bindings, migration parity, actual scheduler status and the
controlled-provider write/read witness must be established before claiming the
requested connect → automatic refresh → computed facts → cross-source answer
product behavior. Current application deployment identity and past synthetic
answer quality alone do not establish it.

## Continuation delivered and verification

The detached preview activation handoff was carried into #571, without global
activation. Only an immutable, validated `business_brief` slot can enter shared
preparation and qualitative rendering. The exact approved source set is required.
A nonserializable, request-bound accounting permit allows terminal reconciliation
after expiry; it never permits more generation. Private slots keep the ordinary
path. Independent code review found no actionable scoping/accounting issue.

Local checks on the continuation passed:

- Full `pnpm test:vsi`, TypeScript, targeted ESLint, and diff whitespace checks.
- Scoped activation, HTTP replay, unchanged hidden-citation view, source-set
  rejection, expiry/competing-completion accounting and all three gates-off tests.
- `scripts/vsi-automatic-refresh-path-tests.cjs`: actual Sheets scheduler,
  scheduled sync, double-read consistency, normalizer, source fingerprints,
  typed projection and fact times. Two ticks change a count from 3 to 4 and add
  a separate count of 2. Two failure modes preserve prior facts and last success.
  An excluded tenant cannot reach provider access. A separate Xero original
  retains balance-at-import meaning, unknown coverage and nonadditivity.
  **Modeled:** provider responses, SQL admission/commit, source resolution, and
  preexisting Xero data. No real provider arrival, hosted cron, automatic Xero
  refresh, hosted RLS or model answer is established by this test.
- New recurring suites exercise all six reporting parsers, all three standalone
  parsers and Square's original page parser. The reporting suite now includes
  two exact-Preview scope regressions; its total is **33** (17 runtime, 13 SQL,
  one real-SQL source composition, two Preview scope tests). Standalone has **36**.
  Square has **33** (10 runtime, five settings, 17 SQL, one real-SQL composition).
  The actual SQL composition tests cover changed facts and source hashes,
  authorization/revocation, complete versus partial freshness and recovery.
  Provider HTTP and identities remain controlled fixtures; browser tests cover
  1280px, 390px and 320px. See each group receipt for exact limits.
- The final Square overlay extends database admission to all **ten** new paths:
  four active refresh leases in total, one per workspace, shared by manual and
  scheduled work. Sheets and QuickBooks retain their separate existing budgets.
  PGlite is single-backend state verification, not multi-session lock-contention
  proof. Native PostgreSQL increment assertions are wired into existing isolated
  CI; read the result on the final pushed head.
- Existing screened, isolated SQL/database suite: 16 guard tests passed. The
  twelve-provider path passed actual SQL admission, packing, rendering, atomic
  save/reopen, all twelve revocations, wrong-actor/workspace denial and 110-row
  volume selection. Two mocked model replies; zero network calls. Its stale
  prompt-length assertion was replaced by exact current shared-prompt equality;
  fact/time/hash/binding equality assertions remain unchanged.
- Offline evaluator remains pinned to published-ancestor runtime `f92a5d63f15ca79e144d47aa7e18114dca461b8e`
  and exact app/lib trees; mutation tests still reject dirty or wrong trees.

No real provider/model calls were made in this continuation; additional spend
was **$0**. CI must be checked at the final pushed head, not inferred from the
older green run. No deployment, migration, membership, entitlement, source
mapping, provider record, scheduler or production setting changed.

The local Google Cloud session was reauthenticated. The read-only November 17
check of `vaeroex-qbo-prod-20260827` / `us-central1` found the three five-minute
scheduler jobs enabled, the queue running, all five Cloud Run services ready,
and recent scheduler/dispatcher/broker/runtime requests returning HTTP 200.
This establishes infrastructure liveness only; a controlled new-record witness
is still required. No infrastructure or provider data was changed.

## Why the existing hosted campaign cannot prove automatic arrival

The original three-slot campaign fixes original-source hashes and explicitly
excludes imports and new mappings. A successful refresh changes those hashes and
must be rejected by that manifest. The original manifest also hides citation links. The new optional citation
inspection scope is restricted to the approved business actor, workspace, saved
chat/question and exact revalidated sources during the approved window; older
manifests keep their original behavior. Do not treat the original static campaign
as the requested full-path acceptance test or loosen hashes/gates to make it pass.

Before hosted execution, prepare a separate reviewed two-phase refresh witness:
identify the exact synthetic provider accounts/records and workspace, approve
only the required provider mutations and existing scheduler window, capture the
new eligible source versions, then freeze the answer manifest against those new
versions. A citation-page qualification must independently retain its existing
session/actor/workspace/original checks. The current candidate implements the narrow Preview forms, explicit provider
manifest and citation-read mechanism needed for the proposed witness. No hosted
configuration, provider mutation, timer or paid execution is thereby authorized
or completed. A single static-source answer cannot close this delivery requirement.

Additional authorization must name the exact protected Preview SHA/project and
compatible isolated database; any temporary membership/entitlement/lock changes
with expiry/restoration; and the fixed paid-model slots and maximum spend after
current rates are checked. Provider test-record mutations and scheduler execution
need their own exact scope. Production promotion and global gate activation are
not part of that approval. Reporting and standalone import refresh are now implemented as local candidates.
Square recurring authority is now a third local implementation group, using its
existing customer backend rather than a timer around browser-session operations.
The separate hosted activation prerequisites still require resolution before any
execution approval request.

## Completed refresh implementation groups

The six reporting connectors, three standalone importers and Square now have
local recurring implementations. Sheets and QuickBooks retain their existing
automatic paths. Thus all twelve have an implemented refresh path in the candidate;
this is not a statement that all twelve are deployed, activated or demonstrated
with live records. Per-connector scope and the ordinary shared VSI gates remain
closed unless their existing or separately reviewed authority permits use.

Additional receipts: `vsi-standalone-refresh-group.md` and
`vsi-square-refresh-group.md`. The Square overlay and standalone RPC migration
must precede the changed application routes; optional UI metadata fallbacks do
not authorize app-only rollout against older SQL. Hosted evidence still needs
controlled new-record arrival, actual source/version verification and bounded
Luna execution after the isolated target is qualified.
