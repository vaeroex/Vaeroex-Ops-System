# VSI cross-integration coverage — November 16, 2026

Updated by the reporting refresh implementation group (November 17 UTC).
See [completed group and verification](vsi-reporting-refresh-group.md) and the
[isolated hosted qualification packet](vsi-reporting-hosted-qualification.md).
The table distinguishes new local code from unchanged deployed behavior.

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
| **Square** | Owner OAuth; verified merchant/location; bounded Payments page, retained records and durable checkpoint/cursor | Customer-requested reads only. Renewal on demand, five-minute overlap, bounded catch-up and replay-safe upserts. Native mapped-sync helper is explicitly operator-invoked, not a scheduler | Completed payment amount in declared minor units with currency and event time; not orders, settlement, accounting revenue, profit or cash flow | Legacy saved-payment/dashboard retrieval exists; shared reader implemented/gated. **Unattended customer refresh is missing**, before the shared gate is reached | Existing customer/native fixture qualification is separate from live unattended operation. No current automatic new-payment → cross-source answer proof |
| **Xero** | Owner OAuth/offline refresh; explicit account selection; retained invoice/bill IDs, supplied document dates, currency-partitioned numerical contributions and coverage | PR #571 adds explicit owner opt-in, daily refresh of the last seven completed UTC dates, scoped due dispatcher, current authority fences, shared admission, retry/backoff and expired-lease recovery. Existing 45-second/12-request parser and atomic commit reused. **Local verified; not deployed** | Invoice totals/bills by currency, outstanding balance at last import; no payment/bank/journal/payroll access, cash received or profit inference | Shared gated; exact legacy binding required. Not read by the ordinary three-provider dashboard | Six-provider baseline records designated Xero demo report success October 19. Synthetic shared reasoning passed. Automatic delivery and hosted shared-answer proof remain missing |
| **Harvest** | OAuth and account selection; retained entry IDs/dates/completed hours/billable hours; running entries excluded | PR #571 adds the same daily, opted-in, scoped reporting dispatcher and recovery. Current-authorizer visibility remains the limit. **Local verified; not deployed** | Tracked hours within authorizer visibility; not team payroll or labor cost; no persisted names/rates/notes | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded. No automatic fresh-entry → shared-answer proof |
| **Clockify** | Owner API key, selected workspace; retained own-entry history by UTC start day | PR #571 adds daily, opted-in, scoped last-seven-complete-UTC-date refresh and recovery. API key owner entries only. **Local verified; not deployed** | Own completed durations and billable hours; cross-midnight duration assigned to start date, not split; not workforce payroll | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded. Automatic refresh and hosted cross-source proof remain missing |
| **Toggl 2.0** | Owner bearer key and selected organization/workspace; visible active-project/lifetime-hours snapshot | PR #571 adds explicitly opted-in six-hour snapshot replacement, scoped scheduling and recovery. **Local verified; not deployed** | Project count is a current snapshot; hours are lifetime totals of visible active projects, not weekly hours or historical trend | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded. Synthetic mapping is not real changing-snapshot → answer proof |
| **Zoho Inventory** | U.S. OAuth and selected organization; current active-item and low-stock counts | PR #571 adds opted-in six-hour snapshot refresh, token renewal, scoped scheduling and recovery. **Local verified; not deployed** | Aggregate item/count snapshot; no SKU quantities, costs, orders or inventory adjustments; not inventory valuation | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated test report success October 19 recorded. Automatic change detection and hosted VSI use unproved |
| **Katana** | Owner private key; account bound to immutable connection/key incarnation; stock-row/availability-count snapshot | PR #571 adds opted-in six-hour snapshot refresh, scoped scheduling and recovery; key replacement retains checked lifecycle. **Local verified; not deployed** | Variant/location-row count; unavailable class is on-hand less committed quantity ≤0; no SKU cost/profit or shortage cause | Shared gated and exact legacy binding; no ordinary dedicated producer | Designated-account report success October 19 recorded; public OAuth partnership still not approved. Automatic and hosted shared-answer proof absent |
| **Loyverse** | OAuth, verified merchant currency; minimized receipts/type/tax/discount/cancellation/creation time and historical coverage | PR #571 adds explicit owner opt-in, daily refresh of the last seven complete UTC creation dates, bounded pagination/atomic import, renewal fencing, shared nine-connector concurrency, retry/backoff and recovery. **Local candidate; not deployed** | SALE/REFUND keep stored sign; cancellation explicit; no netting/tax double addition/accounting-revenue equivalence. Receipt date differs from import inclusion `created_at` | Shared gated and exact legacy binding. Protected currency projection was added by #558; no ordinary dedicated producer | SQL/projection fixtures cover currency revocation and refund/cancellation semantics. No new live automatic-refresh or end-to-end shared-answer witness |
| **Zoho Books** | U.S. OAuth and eligible organization; retained invoice/expense IDs/date/currency/total/outstanding and history coverage | PR #571 adds opted-in daily refresh of the last seven complete UTC invoice/expense dates, guarded token renewal, complete atomic import, shared nine-connector concurrency and failure recovery. **Local candidate; not deployed** | USD/counting policy retained; foreign/draft/void exclusions not business zeros; invoice balance at import is not collection history or profit | Shared gated and exact legacy binding; no ordinary dedicated producer | Setup document says real-customer verification was pending; no current receipt inspected supersedes it. Synthetic typed mapping is not live provider proof |
| **Wix Orders** | Approved app installation/instance; approved orders with ID/time/amount/currency/payment status; historical coverage | PR #571 adds opted-in daily refresh of the last seven complete UTC order-creation dates, instance-token access, bounded complete cursor fetch, shared nine-connector concurrency and atomic import/recovery. **Local candidate; not deployed** | Provider-reported order amount/status; PAID is not bank settlement or posted revenue; no refund transaction/line-item matching | Shared gated and exact legacy binding; no ordinary dedicated producer | Local import/coverage/mapping qualification exists. No current automatic new-order → shared-answer proof |

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
  `lib/integrations/control-plane/square-gcp-mapped-sync.ts` and
  `square-gcp-mapped-runtime.ts`; `docs/square-customer-backend-release.md`.
- Xero/Harvest/Clockify/Toggl/Zoho Inventory/Katana:
  `lib/integrations/reporting/{catalog,routes,adapters,transport,security,oauth}.ts`;
  `supabase/migrations/20261019001207_ready_account_reporting_connectors.sql`;
  `docs/integrations/ready-account-reporting.md`.
- Loyverse/Zoho Books/Wix:
  `app/api/integrations/{loyverse,zoho-books,wix-orders}/sync/route.ts`,
  corresponding `lib/integrations/*/server.ts`, and
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

## Remaining work and staged implementation

1. **Finish the bounded qualification candidate.** Reuse PR #571's immutable
   actor/workspace/chat/question/source manifest and inspected activation plan.
   Keep three ordinary gates off. Qualify the scoped preview entry into shared
   preparation and terminal accounting, with exact-source and private-chat
   isolation tests. This is a controlled hosted-answer qualification step, not
   an automatic-ingestion implementation for the missing ten providers.
2. **Add automatic-refresh admission where missing.** Reuse current provider
   adapters and atomic commits. Introduce explicit owner consent for cadence,
   selected historical refresh window and entity/source mapping, durable due
   state, database entitlement/lifecycle checks independent of a browser session,
   per-workspace concurrency, bounded provider calls, lease fencing and recovery.
   Do not implement a timer that invokes an owner-only manual route or scans all
   connected accounts as implicit consent. Reporting providers are a coherent
   first group; Square and the three standalone legacy connectors retain their
   own authority boundaries. Any new schema or hosted runtime requires its own
   reviewed migration/deployment artifact; no such activation is implied here.
3. **Define current versus historical coverage.** Refresh an approved rolling
   overlap to pick up corrections while preserving older retained history.
   Old invoices/outstanding balances outside that window remain observed-at-import
   evidence; no last-sync timestamp may pretend every historic record was read.
   Snapshot endpoints cannot reconstruct past inventory or lifetime-hour trends.
   Failed/incomplete reads keep the previous committed facts with truthful
   freshness and coverage. Account/credential incarnation changes invalidate the
   applicable approved mapping and source hashes.
4. **Prove a controlled whole path.** Choose eligible existing test connections
   and approved originals from at least two integrations. Record baseline
   source/version/typed facts, add approved non-sensitive provider test records,
   wait for the real due scheduler without manual sync, verify one atomic fact
   update and bounded retry behavior, then ask the real VSI engine a question
   spanning those sources. Inspect exact dated provenance, omissions, stale
   handling, unsupported joins and mathematical inputs; save/reopen with a
   second unauthorized actor/workspace denied. Simulated provider transports
   can qualify orchestration locally but cannot be called this live proof.
5. **Expand qualification across every row.** Keep the matrix as the scope list;
   a Sheets-plus-Xero success does not certify Square, payroll-like interpretations,
   snapshot histories or all customer accounts. Qualify no-cost/incomplete,
   cross-currency/cash-versus-accrual, revoked/stale and overlapping-money cases.

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
must be rejected by that manifest. It also hides citation links, while the source
page remains behind the disabled shared gate. Do not treat that campaign as the
requested full-path acceptance test or loosen hashes/gates to make it pass.

Before hosted execution, prepare a separate reviewed two-phase refresh witness:
identify the exact synthetic provider accounts/records and workspace, approve
only the required provider mutations and existing scheduler window, capture the
new eligible source versions, then freeze the answer manifest against those new
versions. A citation-page qualification must independently retain its existing
session/actor/workspace/original checks. The current candidate does not implement
or authorize that new witness. A single static-source answer can qualify scoped
answer generation first, but cannot close this delivery requirement.

Additional authorization must name the exact protected Preview SHA/project and
compatible isolated database; any temporary membership/entitlement/lock changes
with expiry/restoration; and the fixed paid-model slots and maximum spend after
current rates are checked. Provider test-record mutations and scheduler execution
need their own exact scope. Production promotion and global gate activation are
not part of that approval. Reporting and standalone import refresh are now implemented as local candidates.
Square recurring authority is the remaining missing refresh implementation; the
separate hosted activation prerequisites still require resolution before any
execution approval request.
