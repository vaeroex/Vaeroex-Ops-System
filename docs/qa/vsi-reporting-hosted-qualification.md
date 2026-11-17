# Reporting refresh: proposed isolated hosted qualification

This is a concrete preparation artifact for PR #571, not an execution receipt or
an approval request. No deployment, database migration, provider mutation,
temporary access grant, scheduler activation, or paid model call has been made
by this plan. Complete the remaining code and schema compatibility work below
before asking to execute it.

## Exact proposed targets and current status

| Item | Target / status |
| --- | --- |
| GitHub candidate | PR #571, branch `codex/vsi-bounded-qualification`; merged-main baseline `796ade18fde960c253b6023c29b182c9222c6f2f`; prior reviewed head `7d105ddb182ce09bfdaa6e36090f84ca693466f9` |
| Runtime implementation source | `74f46d55938757810a197ee3d27ac627c3006e2f`. The PR records the final review head and exact-head CI after additive test-manifest corrections. Bind any future deployment and execution approval to that final immutable head; this runtime source alone is not execution authorization. |
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

The migration-history comparison also found **29 repository versions absent from
that target and 72 hosted versions absent from the repository**. These are
inventory differences, not permission to apply 29 migrations, repair history,
or overwrite the database. Preserve the existing disposable contents until its
ownership and reuse boundary are confirmed. Do not apply a full bootstrap over
an existing installation or copy Production credentials/data to make it work.

## Compatibility work required before an execution request

1. Reconcile the disposable schema with the exact source contracts. Prepare a
   reviewed, checksum-pinned forward dependency closure against its actual
   catalog. Check Auth/profile/workspace/session/membership tables, billing
   eligibility, reporting RLS and credentials, evidence entity bindings,
   protected source admission/sealing, VSI chat/ledger/accounting, and required
   grants. Existing private SQL captures remain local and must not be uploaded
   into a public PR or CI artifact. No target SQL is authorized by this document.
2. The reporting increment is
   `supabase/migrations/20261117005822_reporting_recurring_refresh.sql`. It depends
   on `20261019001207_ready_account_reporting_connectors.sql`,
   `20261019033506_reporting_supported_jwt_role.sql`, and
   `20261019070945_reporting_import_history.sql`, plus billing
   authority functions (`private.require_google_sheets_eligible_v1` and
   `private.workspace_billing_entitled_v1`). Their repository source migrations are
   `20261002040031_google_sheets_lifecycle.sql` and
   `20261005022017_workspace_security_boundaries.sql`; these references identify
   prerequisites, not a safe instruction to replay either full migration on the
   disposable target. Verify their exact bodies and ACLs;
   these billing helpers do not authorize broadening the separate Google pilot.
   Check new recurring fields, due index, consent RPC, recovery RPC, wrappers,
   private original-function ACLs, and absence of already-renamed functions
   before applying this one-time increment. Test the assembled forward package
   locally before any hosted request. Do not label the outstanding shared schema
   installation as covered by this single migration.
3. Reporting mutation/OAuth routes currently accept only
   `https://www.vaeroex.com`. Therefore connection, account selection, consent,
   and disconnect forms **cannot currently be qualified on a Preview hostname**.
   Implement and test narrowly pinned Preview-origin compatibility before
   requesting execution. Preserve canonical Production/OAuth behavior and CSRF
   checks. Do not use host-header spoofing, disabled origin checks, or a
   Production callback with Preview credentials as a workaround.
4. The current three-slot qualification source guard explicitly admits the
   reviewed **Xero + Google Sheets** provider pair. It cannot accept the proposed
   Clockify + Katana pair below. A narrow, separately reviewed Preview campaign
   change is required to bind this exact pair in addition to the complete source
   hash set. Reuse the immutable three slots, actor/workspace/chat/request binding,
   normal protected source authority, and budget; do not enable all providers or
   a global source gate. Without this change, Phase A may later be qualified
   independently, but Phase B cannot demonstrate the same refreshed sources.
5. The existing qualification presentation hides citation markers/cards and the
   protected source page remains behind the disabled global gate. Implement and
   test a Preview-only read authorization bound to the approved actor, workspace,
   source identity/version and expiry before claiming inspectable citations.
   Stored canonical provenance inspection alone is not customer source-link
   acceptance. A foreign actor, foreign workspace, expired campaign, revoked
   mapping or changed source must fail closed.
6. Freeze the final source, run required exact-head CI, and prepare a protected
   Preview with **only isolated** database/provider configuration. Record the
   immutable deployment ID, URL, commit and nonsecret configuration fingerprint.
   Perform catalog/ACL compatibility checks on that same database before any
   provider or model execution. Reconcile different results; do not replay
   bootstrap SQL or relax access controls.

The Preview does not yet exist, the database installation closure is not yet
qualified, and items 3–5 are code boundaries. This artifact is intentionally
**not ready for hosted execution approval** while those gaps remain.

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
its existing GCP path pending restored read-only inspection and live witness.
Square, Loyverse, Zoho Books and Wix Orders still need their respective missing
unattended paths. No connector leaves scope because it is outside this first
hosted pair, and no global activation is implied by local mapping or fixtures.
