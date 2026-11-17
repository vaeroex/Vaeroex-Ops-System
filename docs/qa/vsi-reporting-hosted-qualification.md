# Reporting refresh: proposed isolated hosted qualification

This is a concrete preparation artifact for PR #571, not an execution receipt or
an approval request. No deployment, database migration, provider mutation,
temporary access grant, scheduler activation, or paid model call has been made
by this plan. Complete the remaining target compatibility and execution-manifest work below
before asking to execute it.

## Exact proposed targets and current status

| Item | Target / status |
| --- | --- |
| GitHub candidate | PR #571, branch `codex/vsi-bounded-qualification`; merged-main baseline `796ade18fde960c253b6023c29b182c9222c6f2f`; prior reviewed head `7d105ddb182ce09bfdaa6e36090f84ca693466f9` |
| Implementation source | Reporting group `74f46d55938757810a197ee3d27ac627c3006e2f`; standalone group `34bf9893d8e5a2950f601f2949c0d81601eabc93`; Square and scoped qualification changes are part of the final PR candidate. Bind execution to the final immutable PR head and exact-head CI, not one earlier group commit. This document grants no deployment authority. |
| Isolated database | Existing disposable Supabase project `bdmrcmbkiohcqkmcvvua`, named `executive-security-disposable-20261014`. This is the proposed target; it is not currently qualified for the campaign. |
| Preview project | Vercel project `prj_J810bZ9ECoN4CyLKujUoEEH8N6ja`, team `team_uORtrMvad77Qz6HikOgD4cnp` (`vaeroex-2167s-projects`). Create a protected **Preview**, bound to the final source and isolated database. No Preview build has been created for this group; there is no verified deployment ID or URL to publish yet. |
| Production exclusion | Do not target Supabase `mdiianhfrojmxqpwrflh`, assign/promote any Production domain, change Production environment values, or change main's automatic-deployment hold. |
| Application activation | All three ordinary shared-evidence, qualitative-synthesis, and failure-accounting gates remain `false`. Refresh consent and the Preview qualification manifest are separate authorities. |

The November 16 read-only catalog check found the following required entry points
absent from the disposable database: `discover_shared_evidence_v2`,
`preview_shared_legacy_evidence_v1`, `read_shared_typed_evidence_v1`,
`capture_legacy_evidence_v1`, `shared_evidence_dependencies_v1`,
`seal_shared_evidence_manifest_v1`, `vsi_mutate_v3`, and
`fail_vsi_request_accounting_v1`. Presence alone would not establish correct
bodies, grants, RLS, dependencies, or Auth compatibility.

The migration-history comparison also found **30 repository versions absent from
that target and 72 hosted versions absent from the repository**. These are
inventory differences, not permission to apply 30 migrations, repair history,
or overwrite the database. Preserve the existing disposable contents until its
ownership and reuse boundary are confirmed. Do not apply a full bootstrap over
an existing installation or copy Production credentials/data to make it work.

## Compatibility work required before an execution request

1. The exact 13-file forward closure below has passed an empty local structural
   installation rehearsal. Finish the remaining metadata checks for existing
   trigger/function composition, restrictive policies, keys/defaults and renamed
   helper collisions. Preserve the disposable target's existing records and
   establish its writer-quiescence boundary; no reset, ledger repair or target
   SQL execution is authorized. Private captures remain outside the PR and CI.
2. Both existing billing helper definitions and ACLs match the reviewed local
   source. Do not replay `20261002040031_google_sheets_lifecycle.sql` or
   `20261005022017_workspace_security_boundaries.sql`; their required functions
   already exist. The Google pilot remains unchanged. Verify newly installed
   recurring columns, due/consent/recovery RPCs, wrapped originals and private
   ACLs after any separately authorized installation. The shared bootstrap is
   an additional dependency, not something supplied by the recurring migration.
3. The candidate now supports an explicit `REPORTING_PREVIEW_QUALIFICATION`
   manifest for **Clockify/Katana key-based forms only**. It binds the immutable
   `VERCEL_URL`, exact owner and workspace, provider list, start and expiry (at
   most two hours), and fixed connect/select/import/consent/disconnect paths.
   Host, forwarded host/protocol, Origin and same-origin CSRF checks remain.
   OAuth callbacks stay canonical; no host spoofing or Production credentials
   are part of the witness. This manifest is not configured here.
4. The three-slot VSI manifest now accepts an explicit `approvedProviders` list
   for its business slot. Omitted lists preserve the old Xero/Sheets campaign.
   Phase B must name exactly `clockify,katana` and the complete reviewed source
   hash set. Missing, extra or changed source/provider sets fail closed. Private
   slots cannot supply provider lists. The immutable questions, actor/workspace/
   chat/request bindings, call/spend limits and normal admission remain.
5. An optional `inspectCitations: true` enables a Preview-only source inspection
   window for the business slot's owner/workspace. The saved exchange must match
   the approved chat and question through the authenticated client's normal RLS;
   the existing reopen RPC then checks the saved artifact, current permissions,
   mappings and exact source versions. Source hashes/providers must still equal
   the reviewed set after the read, and expiry closes the path. No admin source
   reader or global gate is enabled. Old manifests continue hiding citations.
6. Freeze the final source, run required exact-head CI, and prepare a protected
   Preview with **only isolated** database/provider configuration. Record the
   immutable deployment ID, URL, commit and nonsecret configuration fingerprint.
   Perform catalog/ACL compatibility checks on that same database before any
   provider or model execution. Reconcile different results; do not replay
   bootstrap SQL or relax access controls.

The Preview does not yet exist. The forward closure has local structural and
regression evidence, while target writer/policy compatibility and real Auth are
not yet qualified. Items 3–5 have local code and regression coverage. This artifact is
**not ready for hosted execution approval** until the target schema closure,
source/build identity, credentials provenance and exact provider-record execution
manifest are complete. Local mocks do not resolve those remaining conditions.

## Reviewed isolated forward closure and local rehearsal

The proposed database target remains `bdmrcmbkiohcqkmcvvua`. The smallest reviewed
closure for this Clockify/Katana Preview is the following ordered package. These
are existing exact source bytes, not a reconstructed migration-history upgrade.
The shared bootstrap is appropriate only because its objects are absent here;
it must never be replayed over an existing shared-evidence installation.

| Order | Source file | SHA-256 |
| --- | --- | --- |
| 1 | `supabase/migrations/20261017013603_loyverse_read_only_connection.sql` | `a3755d4cda49495b197e8eb189568ffc7cb931034f5a8d1b360397fa5525ddfb` |
| 2 | `supabase/migrations/20261017023221_zoho_books_read_only_connection.sql` | `bae4ee841f129f787ab7a54015ebb50ed6773e801877555581e343cf47262e25` |
| 3 | `supabase/migrations/20261017051502_wix_orders_read_only_connection.sql` | `fd00638b38e6042d4f4ca863ce225e863378673b1352f2b5ddcc1b0f7e7c7d6b` |
| 4 | `supabase/migrations/20261017184954_loyverse_merchant_reconnect_guard.sql` | `c4dee8d1a023f08c706bbbcd2f9ab09a341731b55edb74a58baea793121dac8a` |
| 5 | `supabase/migrations/20261019001207_ready_account_reporting_connectors.sql` | `19b9ec711bc48f2c4e8da03d45bb3643d231480fc93bdd34b0c52789f45b2724` |
| 6 | `supabase/migrations/20261019033506_reporting_supported_jwt_role.sql` | `7d719156d8a62641f222f14e1782ea3a6485cbae090adadd6398f583e1799ddb` |
| 7 | `supabase/migrations/20261019070945_reporting_import_history.sql` | `f16404ea373c576671880789e1ee380c181f8a1706150ee894209bc9cff33c5f` |
| 8 | `supabase/migrations/20261019070949_zoho_books_import_history.sql` | `8dda6837bf6421386d0734cb3b11647b6a8e20e522157d9661dc7f3d6206658e` |
| 9 | `supabase/migrations/20261019070953_loyverse_import_history.sql` | `e53a5c864e6a5b39e94490ab97ed85088bc7c8e6aa755c087953c300c1e88d4b` |
| 10 | `supabase/migrations/20261019071008_wix_orders_import_history.sql` | `b7f4b537a7f78cfa740eccf2c188e47c5ca74ec8e1cdd7f70264cf4ea79a6367` |
| 11 | `docs/security-drafts/release/forward.sql` | `7ceebc67399a92cd968ffa46dcf245665aecc28b9f6b822406842e4b96bab264` |
| 12 | `supabase/migrations/20261117005822_reporting_recurring_refresh.sql` | `9be7c03b199fe2e7c685209eabe3ee43a95b760e9e03e2761d87a613e89b6473` |
| 13 | `supabase/migrations/20261117012702_import_recurring_refresh.sql` | `434f2801e3769ec752ca9473e541b759dbdd10f0a6ccae6c10c7805da1e3a861` |

The ten canonical connector files are required by the shared dispatch/fence
schema even though only two providers participate in the witness. The two
recurring increments preserve the candidate's reporting/import contracts. The
sixteen absent historical Square canonical migrations and two unrelated marketing
migrations are excluded. The separate Square recurring production overlay is
also excluded from this Preview package: its Production-only runtime stays
closed. Before deploying the changed application where that Square backend can
run, its reviewed overlay must precede the app; a missing-status UI fallback is
not general runtime compatibility. See [Square release order](vsi-square-refresh-group.md).

Local rehearsal executed all 13 files unchanged and installed all **64 workspace
writer fences**. It used empty tables with the isolated target's observed column
names/types and 16 exact-matching screened authority/Sheets/VSI function bodies.
No customer rows, credentials, hosted connection, provider transport or model
were used. The exact bootstrap assembler/tail and the reporting/import/Square
migration suites also passed. This is structural installation evidence, not a
clone of the target's defaults, constraints, policies, existing triggers or
records, and not hosted Auth/PostgREST or multi-session writer proof.

Private local receipts are `vsi-isolated-forward-package-review.json`,
`vsi-isolated-structural-rehearsal-receipt.json` and the reproducible local
`vsi-isolated-structural-rehearsal.cjs`; they remain outside the repository.
The tracked bootstrap is independently reproducible with
`node scripts/shared-evidence-release-package.cjs --check`. Recompute this
package's hashes against the final frozen head before any execution request.

The November 17 metadata checks established:

- Of 64 writer-fence targets, 43 already exist and 21 are supplied by the package
  (nine shared tables and twelve connector fact/connection/coverage tables).
- None of the package's 30 new table names or 94 directly created function names
  collides with an existing target object. Renamed helper aliases and new trigger/
  policy names still require their explicit collision check.
- The entity `(workspace_id,id)` unique key exists. The required Auth user/session
  UUID and timestamp columns exist, including nullable session `not_after`, as
  the unchanged owner/session helper expects. No Auth record was read.
- All 16 screened authority/Sheets/VSI helper definitions match. Eight of eleven
  distinct typed helpers match; the three differing QBO definitions are
  `qbo_customer_source_browse_v1`, `read_qbo_customer_accounting_authority_v1` and
  `qbo_customer_preview_v1`. Preserve them and exclude QBO from this witness;
  reconcile them separately before QBO hosted qualification. These differences
  do not justify replaying QBO infrastructure or broadening this provider pair.
- Both billing helper definitions and ACLs match. Metadata reads returned no
  credentials, record contents or function bodies. Their success is not consent
  to alter the isolated database.

The next authorized action is a metadata-only comparison of the existing
artifact/VSI trigger graph and relevant grants/policies, prerequisite keys and
new alias/trigger/policy names against the qualified contracts. Use its result
to pin fail-closed installation checks and rehearse any actual dependency change
locally. Do not leave this as an unspecified full-database parity audit or assume
that matching migration version numbers are sufficient. Real Auth, protected
Preview behavior and concurrent writer acceptance belong to the later explicitly
approved isolated qualification, after this compatibility comparison passes.

## Phase A — real unattended ingestion, zero model calls

Use two dedicated provider test accounts, an isolated fictional workspace named
**Alder Workshop Qualification**, and one explicitly selected entity. Choose
**Clockify** and **Katana** first because their existing API-key paths avoid new
OAuth callbacks or broader OAuth scopes. They test both supported patterns:
dated own-entry history and current-state inventory snapshots. This choice does
not certify the other ten integrations.

No ready provider account, key, provider-generated record ID, workspace ID,
actor ID, connection ID, entity binding, source hash, or chat is asserted here.
Provisioning/using dedicated accounts and credentials, creating the isolated
workspace, and changing the records below require a target-specific execution
approval after preparation. Record those actual identifiers privately in the
execution manifest before making changes. Use the least provider permissions
available; do not describe an unscoped provider key as read-only. Vaeroex's
reporting path continues to make only supported provider GET requests.

### Exact fictional records and expected retained facts

Let `D` be the first scheduled claim's UTC date. Run the campaign away from UTC
midnight. All Clockify entries belong to the connected test-key owner; no other
person's entries, names, rates, notes, or workforce coverage are authorized.

| Provider | Baseline records, through the existing manual import | Approved provider-side change after baseline | Expected next complete scheduled evidence |
| --- | --- | --- | --- |
| Clockify | One completed billable entry on `D-1`, 10:00–12:00 UTC, in the selected test workspace. Its provider-generated ID is recorded privately. | Change that same entry's end to 12:30 UTC; create one additional completed **nonbillable** entry on `D-1`, 14:00–15:00 UTC. | Two stable record IDs; 2 completed entries, 3.5 hours, 2.5 billable hours, 0 running. Each entry retains its UTC start date and complete duration. No staff count, payroll or labor-cost implication. |
| Katana | Two distinct variant/location rows in the selected test factory: row A stock `4`, committed `1`; row B stock `0`, committed `0`. Record actual provider IDs privately. | Set row A committed quantity to `5`; create a third variant/location row C with stock `3`, committed `1`. | A current snapshot of 3 stock rows and 2 unavailable rows under the existing `stock - committed <= 0` definition. No combined quantities across units, SKU cost, historical stock trajectory, sales, or shortage cause. |

If a test account cannot support these exact operations without altering a real
merchant account or purchasing service, stop that provider preparation. Do not
substitute real customer records or an unreported mock. The Katana mutations
must use the provider's supported test UI/API semantics; this table does not
assume that committed quantity is a directly writable field. If a fictional
order/reservation is required, enumerate its exact line, variant/location and
cleanup in the private execution record before approval.

### Authorization, timer and timing

- The owner connects/selects each exact test account and reviews its protected
  legacy entity binding. Connection consent does not silently authorize
  recurrence or make all sources retrievable.
- Capture the baseline with the existing manual import and current snapshot.
  This setup import is not the automatic-refresh proof. Then the owner explicitly
  enables recurring access through connection settings.
- Restrict the Preview to
  `REPORTING_AUTOMATIC_REFRESH_ENABLED=true`,
  `REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS=<one actual isolated workspace UUID>`,
  and `REPORTING_AUTOMATIC_REFRESH_PROVIDERS=clockify,katana`. Preserve all other
  scopes and the Google pilot. Never use `*`, empty-as-all, or global enablement.
- [Vercel Cron runs only on Production deployments](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs#troubleshooting-cron-jobs). The proposed live witness needs
  an **ephemeral external authenticated timer**, targeting only the immutable
  protected Preview `/api/integrations/reporting/scheduled-sync` endpoint every
  15 minutes for at most two hours (at most 8 timer dispatches). The chosen
  timer service/job ID, protected-deployment access mechanism, and secret-store
  references must be fixed before approval; none has been created. Do not add a
  Production job or assume possession of `CRON_SECRET` bypasses Vercel protection.
- Honor the real one-hour manual cooldown. First eligible recurring work should
  occur on the next 15-minute tick after that cooldown (normally 60–75 minutes
  after baseline). Do not edit `next_sync_at`, backdate attempts or shorten the
  SQL cadence to manufacture a live unattended result. Subsequent history
  refreshes are daily and snapshots every six hours; two hours do not prove a
  complete later daily cycle.
- Change the fictional provider records after baseline and before the eligible
  tick. The timer must perform the refresh without opening a manual Sync route.
  SQL retains its shared cap of four active reporting leases and one per
  workspace; this dispatcher uses two local workers and at most 20 candidates.
  Reads remain bounded, and only complete validated windows can commit.

### Phase A acceptance and receipts

Record only content-safe receipt fields in public artifacts: deployment/source
identity, approved target identifiers where appropriate, run timestamps,
provider keys, outcome codes, row counts, deterministic expected-value checks,
source/manifest hashes and permission-denial booleans. Keep credentials, raw
provider payloads, session material and private chat content out of logs.

For each integration require:

1. Real provider-generated record IDs and their approved change receipt; real
   timer dispatch time; admitted connection/lease; unchanged manual cooldown.
2. One whole-window/snapshot commit. Compare prior and new last-success times and
   retained facts against the table. Clockify refreshes exactly the seven
   completed UTC dates anchored to the SQL claim; older dates are not claimed
   fresh. Katana is a point-in-time snapshot, not reconstructed history.
3. Normal authenticated protected discovery/read in the isolated workspace sees
   the changed source identity/version/hash and typed facts with dates, units,
   entity, scope, coverage, and observed time. Record exact before/after hashes;
   never pre-invent a hash or accept only an HTTP 200 as evidence.
4. An unchanged duplicate/overlapping timer attempt causes no second provider
   read or duplicate facts. A second workspace and an unauthorized actor cannot
   discover/read the records. Reopening a source revalidates current authority.
5. If real provider failure occurs, preserve the prior committed facts and
   last-success time; capture sanitized error/backoff/recovery receipts. Do not
   deliberately exhaust a provider quota. Local failure/partial/duplicate/
   revoked-source tests remain fixture proof unless the same fault is actually
   observed in this hosted run. An unsuccessful refresh does not become zero.

Stop the external timer after the Phase A receipt and before pinning the Phase B
source hashes. Disabling the timer is not disabling source access or changing
saved evidence. No new provider refresh, import, mapping edit or record mutation
is allowed during the fixed-hash model campaign. An unexpected source change
invalidates that campaign and must stop dispatch; do not silently update hashes.

## Phase B — three immutable questions over the retained sources

Only proceed after Phase A, schema/auth checks, the narrow provider-pair guard,
and scoped citation opening are qualified. Reuse
[`vsi-bounded-qualification.json`](vsi-bounded-qualification.json) and
[`vsi-preview-activation.json`](vsi-preview-activation.json), amended only through
review for this exact pair. Create/designate fresh pinned synthetic chats and
capture their actual IDs before building the immutable manifest. Old customer
chats and source mappings are excluded.

| Slot | Exact question | Acceptance |
| --- | --- | --- |
| `owner_private` | `What marker did I give you earlier in this private conversation?` | Only this synthetic owner's earlier private canary is in the serialized context/answer; no other actor/workspace marker or business sources. The canary values stay out of public receipts. |
| `demo_private` | `What marker did I give you earlier in this private conversation?` | A separate authorized synthetic viewer in its designated test workspace receives only its own canary. Owner-only shared preparation is not invoked. |
| `business_brief` | `What do the latest connected records show about my own tracked work and current inventory availability? Explain the dates and coverage, keep hours and inventory counts separate, and tell me what I should check next without assuming staffing costs, sales, or a cause.` | Use the exact newly captured Clockify and Katana originals, correct application facts and attribution, own-entry coverage, seven-date reporting window versus current snapshot, and the absence of evidence for costs, workforce coverage, sales or causality. |

Validate every material claim against the actual protected source and any
application-computed inputs. Three current stock rows are not three products;
2 unavailable rows do not establish lost sales. Clockify's 3.5 hours cover the
connected owner's completed entries in the window, not all workforce time.
Different observation timestamps and reporting bases must remain visible.

Do not ask the model to infer the Katana *historical change* merely because the
test operator recorded an earlier snapshot. This connector stores current-state
evidence; an operator's before/after receipt does not establish retrievable
snapshot history. If neither admitted source is actually stale, report that
live stale-answer handling was not witnessed. Do not backdate stored timestamps
to manufacture that claim. Missing/incomplete scope must still be explained;
local stale/failure fixtures remain separately labeled.

The manifest pins the actual actor/workspace/chat/request IDs, exact question
hashes, complete approved source hash set, final build and a window of at most
60 minutes. Private source lists are empty. Inspect actual serialized dispatch
receipts, not only the proposed prompt. Save/reopen the answer, inspect each
allowed citation, and deny copied links in the foreign workspace/viewer case.
Do not replace a failed immutable request ID, retry a model call, or expand slots.

### Proposed paid ceiling

- **Three questions; at most five provider calls each; 15 calls total.**
- **USD 2 maximum proposed campaign spend.** Existing conservative reservation:
  USD 0.572 per question, USD 1.716 total. This is a usage estimate, not a provider
  invoice or hard billing cap; confirm current rates and configured transport
  multipliers before requesting paid execution. If the bound exceeds USD 2,
  reduce the proposed bounded campaign or request a revised cap before calling.
- Internal model remains **`gpt-6-luna` only**. No fallback, web calls, automatic
  retries, extra prompts, images, or model changes.
- Existing serialized limits remain 192,000 input bytes and 8,000 maximum output
  tokens per call, with ordinary per-workspace accounting and safeguards intact.
  Unknown outcomes consume their full reserved budget until reconciled; stop
  supervised execution on ambiguity. Do not retry or replenish slots.
- Phase A makes **zero model calls**. Timer/provider platform charges, if any,
  are separate dependencies to disclose before creating paid infrastructure.
  This document grants no new spend authorization.

## Temporary access and restoration record

Before execution, the private manifest must name the actual isolated database,
immutable Preview, dedicated provider accounts, fictional records, synthetic
owner/viewer IDs and memberships, two test workspaces, entity bindings, temporary
entitlement/lock state, timer job, protected-preview access method, configuration
keys, start/deadline and restoration values. Unknown values are preparation gaps,
not an invitation to widen access during the test.

Use existing authorized synthetic identities where possible. Do not create new
real users, silently accept contracts, unlock a customer workspace, copy a
Production token, or broaden provider scopes. Any additional test membership,
entitlement, provider write, credential provisioning, Preview deployment/schema
change or paid timer/model usage must be named in the later execution request.

Restoration order:

1. Stop/delete the exact ephemeral timer; verify no future dispatch remains.
2. Let admitted bounded reads settle or recover expired leases. Reconcile every
   model ledger reservation and terminal result before revoking test access.
3. Remove the Preview qualification manifest/recurring rollout configuration;
   disable recurring consent on the designated test connections through the
   normal authorized path. Revoke only the temporary provider keys and test
   deployment access that were introduced for this campaign.
4. Restore only approved temporary test membership/entitlement/lock changes.
   Preserve audit/source-version/chat receipts under normal retention rules.
   Remove fictional provider records only according to the approved exact
   cleanup list; do not delete a reused test account or overwrite old records.
5. Retire the Preview and verify Production domains, source deployment,
   environment settings, provider connections and auto-deployment holds match
   the recorded pre-test baseline. Schema rollback is not automatic; preserve
   isolated data and use the separately reviewed target rollback if required.

## Scope after this group

The complete connector inventory remains in
[`vsi-cross-integration-coverage-2026-11-16.md`](vsi-cross-integration-coverage-2026-11-16.md).
The six-provider reporting group adds local recurring implementation for Xero,
Harvest, Clockify, Toggl, Zoho Inventory and Katana. Each still needs its own
hosted provider witness; a Clockify/Katana success would prove only those two.
Google Sheets retains its existing opted-in pilot scheduler; QuickBooks retains
its existing GCP path; restored read-only inspection confirmed service/scheduler
liveness, with the new-record witness still outstanding. Loyverse, Zoho Books and
Wix Orders and Square now have locally verified recurring implementations. Square
retains its Production-only backend gate and needs its own hosted arrangement.
No connector leaves scope because it is outside this first hosted pair, and no
global activation is implied by local mapping or fixtures.

## Standalone import extension (local only)

The candidate also adds `20261117012702_import_recurring_refresh.sql` for
Loyverse, Zoho Books and Wix Orders. It depends on the reporting recurring
migration and existing connector/history tables. It shares the four-active /
one-per-workspace admission boundary across all nine reporting/import providers.
Its cron is independently bounded; `IMPORT_AUTOMATIC_REFRESH_ENABLED`,
`IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS` and
`IMPORT_AUTOMATIC_REFRESH_PROVIDERS` must all explicitly select the intended
connections before recurring consent can be enabled. They remain unset here.

This does not expand the proposed Clockify/Katana hosted record changes or model
campaign. A standalone-provider witness needs its own exact synthetic account,
record, consent and immutable source/version inventory. The local three-provider
composition test proves actual SQL writes and protected source version changes
using controlled HTTP responses; it is not a hosted delivery receipt.

## November 17 nonsecret isolated catalog preflight

A read-only catalog query confirmed PostgreSQL 17.11 and the existing protected
VSI chat/ledger tables, business entities, membership and billing helpers. The
reporting tables and shared manifest/legacy-reference tables are absent. The
listed shared reader/seal/completion entry points are also absent. This is a
missing installation, not a request to weaken RLS or create broad service grants.

The target already has the Square direct backend and payment-history columns.
Its `public.square_customer_backend_v1` definition SHA-256 is
`9351187f0ccbda25958291916f8454f050bf1331812322596729dcde45453c89`; the
function is owned by postgres, SECURITY DEFINER, and executable only by postgres
and service_role. This supports exact comparison of the proposed Square increment;
it does not authorize applying that increment. No source records, credentials or
function bodies were returned by the preflight.
