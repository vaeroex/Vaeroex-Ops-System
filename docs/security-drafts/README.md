# Shared evidence: inactive local security drafts

These drafts remain outside `supabase/migrations`; the runtime gate is false.
The candidate branch has been published for separately approved disposable CI,
which passed at `2376030b697367adffa3b14e9c8983455de5f206`. It has not been
merged, deployed, applied to production, or activated.

Actual VSI and briefing generation now discover protected stored evidence, perform
mandatory admission, preserve dependencies, settle manifests, and reopen exact
citations. Deterministic provider fixtures exercise five plugins plus a processed
file and approved note. This is not evidence of live model answer quality.
All twelve connector projections are present; their coverage and units still
limit which comparisons are justified. Ratios must not be inferred from unknown
coverage or incompatible scopes.

The current status and finite release conditions are in [QUALIFICATION.md](QUALIFICATION.md).
Older dated checkpoint documents are historical evidence only. Native CI qualifies
the actual workspace fence with synthetic writes and privacy/erasure races;
installed writer/trigger composition remains a separate requirement. Private
metadata captures are not public fixture inputs.

## Verified production contract audit

After explicit read-only approval, the one permitted retry of the previously
rejected Supabase metadata operation succeeded for the approved production target.
Scope: function definitions, grants, triggers and aggregate historical-impact checks. No customer records, secrets, mutation RPCs or credentials
were retrieved. The local evidence is `audit/deployed-contracts.json`.

Important differences from assumptions in the earlier draft:

* `private.require_live_actor_session_v1` is explicitly service-role-only. The
  authenticated reader now derives actor/session from JWT and reuses the deployed,
  role-neutral `private.square_production_customer_require_owner_v1`. That helper
  locks and checks the live session, undeleted/unbanned account, active owner and
  exact workspace/entity. No role impersonation or new grant to the helper.
* Public VSI v1 remains deliberately revoked. VSI v2 calls the live-session fence
  before v1; the new draft v3 delegates through v2 and preserves that chain.
* Trusted run completion/failure requires the existing transaction claim and live
  session/read ticket. The draft completion wrapper composes with the actual v1
  function and transition trigger; it does not replace or weaken them.
* The Sheets derivative trigger treats changes to added artifact columns as
  content writes. Historical classification therefore uses a **private metadata
  table**, with no updates to historical artifact rows.
* Historical-impact details remain in private audit records. Marker-based checks
  do not prove the absence of malformed or unmarked historical copies.

The earlier metadata denial is resolved for this scoped audit. The separate
Vercel provider-configuration metadata 403 remains respected and unverified.

## Draft files and exact added contracts

### 01 — stored evidence and explicit entity correspondence

New private tables:

* `legacy_evidence_bindings`: exact workspace/provider/connection, monotonic
  mapping version, active canonical business entity, nonsecret installation/account
  fingerprint, reviewing owner/time and permanent revocation state.
* `legacy_evidence_references`: immutable reference UUID, binding, inclusive UTC
  selection dates, projection version, original composite keys, safe projection
  hash, capturing actor/session/time. No duplicate retained payload snapshot.

Authenticated-only public RPCs, SECURITY DEFINER with empty search path:

```
preview_legacy_evidence_mapping_v1(uuid,text,uuid) -> jsonb
confirm_legacy_evidence_mapping_v1(uuid,text,uuid,uuid,text) -> uuid
capture_legacy_evidence_v1(uuid,uuid,date,date) -> jsonb
reopen_legacy_evidence_v1(uuid,uuid) -> jsonb
```

All private helpers and tables deny direct application-role access. No arbitrary
relation name, query or caller-supplied eligibility/hash establishes authority.
Only existing stored numeric facts/coverage are projected; no provider fetching.

| Connector | Stored originals and interpretation |
| --- | --- |
| Xero | Reporting history facts/days; invoice and bill values, currency/coverage preserved. |
| Harvest | Reporting history facts/days; permission-visible entries, not assumed payroll. |
| Clockify | Reporting history facts/days; connected user's entries, not total workforce. |
| Toggl | Stored connection snapshot; lifetime project hours, not period labor. |
| Zoho Inventory | Stored connection snapshot; current stock, not inventory movement. |
| Katana | Stored connection snapshot; current stock, not inventory movement. Installation identity qualification remains required. |
| Loyverse | Receipt facts/import-day coverage and composite identity; verified merchant currency is unavailable, so money comparisons are excluded. |
| Zoho Books | History facts/coverage; composite document identity and currency. |
| Wix Orders | Order facts/import-day coverage; composite order identity and currency. |

Reads fail on over-budget or unsupported shapes; they do not truncate silently.
Current safety budgets are 366 selection days, 2,000 stored rows and 2 MB. These
are evidence payload budgets, not new five/ten-connection product caps.

Owner mapping UX is a small review on existing connection details: show the
account's stable scope and factual limitations, choose an existing active business
entity, confirm the preview fingerprint. Do not infer entity from names, labels,
amounts or creator. Changed fingerprints require renewed review. Rebind/reconnect
revokes prior references, never rewrites old source history.

### 02 — necessary derived-content audiences

New private table `derived_evidence_audiences` classifies `ai_agent_runs` and
`reports` by exact artifact/workspace, source kind/ID, legacy/source-verified state
and optional source actor. No new public artifact columns. Metadata-only backfill
follows explicit briefing/VSI markers and recursive saved-report ancestry.

Restrictive policies compose with existing RLS on those two tables:

* Briefs and their copies require a current live owner of that workspace.
* VSI saved copies and copies of those copies additionally require their original
  actor. Another owner cannot read them. Missing historical actor denies access;
  `created_by` is never guessed as the source actor.
* Unrelated reports retain existing policy behavior. Existing VSI transcripts
  retain their actor-private controls; no blanket transcript role-policy rewrite.

`can_access_owner_evidence_v1(uuid)` and
`can_access_derived_evidence_v1(uuid,text,uuid)` expose only boolean predicates.
The latter is available to anon for restrictive-policy composition but denies
classified content. There is no anonymous table grant.

Private guards preserve immutable identity/payload of structured copies, require
actual same-workspace source payloads and propagate strict audience/lineage state.
Owner lifecycle changes remain possible after the creator is demoted. Failure
cleanup after demotion requires the exact existing trusted transaction claim and
unchanged output/input, not an owner exemption.

### 03 — private immutable manifest storage

Four private tables, no direct application grants:

* `shared_evidence_manifests`: workspace/actor/session/target/attempt/ticket/input
  hash/parser contract and seal hash; one seal per attempt.
* `shared_evidence_manifest_sources`: ordered typed original identities and hashes.
* `shared_evidence_artifact_manifests`: lineage for exact exchange, conversation
  context, briefing and saved-report revisions.
* `shared_evidence_commit_claims`: transaction-bound exact completion claim.

Seals, sources and output links are immutable; authorized workspace erasure
cascades. No indefinite payload copy. These tables alone admit nothing.

### 05 — legacy admission, inheritance and terminal fencing

Implemented draft entry points:

```
seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]) -> jsonb
validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer) -> boolean
vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid) -> jsonb
complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid) -> uuid
```

Seal/validate EXECUTE is authenticated-only; terminal wrappers are service-only.
All private helpers remain revoked. The seal checks live owner/session, exact
pending request/lease/attempt or processing run, actor-bound bound ticket,
current attribution, original identities and exact hashes. It returns
`stage: database_bound` and `provider_policy_required: true`, **not permission to
send data to a provider**. Unsupported typed originals fail closed.

The draft retains every inherited manifest from ticket sources and existing
conversation context, not only cited sources. It persists and rechecks immutable
parent output revisions, saved-report identities, intermediate copy ancestors,
existence, audience and current privacy readability. Conversation summaries retain
their immutable originating exchanges and are separately hashed as target input.
Owner-wide briefs reject actor-private VSI/report dependencies rather than inventing
a new private-to-generating-user briefing subsystem.

Terminal triggers protect requests, runs, exchanges and context. Requirement is
derived from sealed context and **bound ticket dependencies**, not merely an
optional caller marker. Old wrappers cannot complete these targets without a
transaction claim. New outputs and context links are inserted in the same
transaction as the existing trusted completion/accounting paths. Failed VSI
settlement records actual incurred cost once without saving an answer.

Saved-report insertion validates and attaches all source manifest links in the
same transaction. Copy-of-copy ancestry is retained and rechecked. Sealed exchange
updates, including “remember as note,” fail closed until note lineage is implemented.
Continuation into a new conversation is also explicitly blocked until it can carry
lineage. Normal conversation deletion retains billed request records; archive and
workspace-erasure paths retain existing controls.

This implements an atomic **claim/output transaction**, not proof that source
eligibility cannot race with independent writers. The source-writer interlock
qualification below is mandatory before activation.

### 06 and 07 — typed provenance and saved-output reopening

`06-typed-source-admission.sql` adds no tables. Its fixed private dispatcher
resolves exact QBO canonical version/validation/mapping and Square payment plus
installation identity. Reuses the audited QBO minimizer; no arbitrary table names,
provider fetches, raw credentials or service-role reader grants. Canonical and
projected currency/basis/period must match. Square amounts retain minor units and
coverage remains unknown. Exact projection hashes detect equal-timestamp edits.

`read_shared_typed_evidence_v1(uuid,jsonb)` is authenticated-only and returns an
unadmitted projection. File/note previews preserve reviewed provenance, current
source version and required ticket roots, but their originals explicitly fail
with `shared_typed_semantic_admission_unqualified` during seal, inheritance,
completion and reopening. Provenance alone does not replace full existing memory
eligibility. Note reconstruction reuses the canonical validator, formatter and
chunker in an inactive TypeScript helper, with no change to indexing behavior.

`07-reopen-shared-artifact.sql` adds authenticated-only
`reopen_shared_evidence_artifact_v1(uuid,text,uuid,text)`. It checks exact saved
revision, current owner/source-actor audience, parent lifecycle and every original
hash. The local `/app/sources/evidence/[kind]/[id]` route reopens exact saved
revisions through this RPC, checks the active owner workspace, and strips internal
eligibility metadata. It is gated off and is not yet linked from generated output.

## Tests and independent review

`node --test scripts/shared-evidence-security-draft-tests.mjs`: current results
are recorded in `QUALIFICATION.md` (the prior committed checkpoint passed 20/20).
The fixture executes the audited owner/session, ticket, privacy-lock, trusted-run
and VSI mutation function bodies unchanged. It uses actual legacy/VSI table DDL
and synthetic rows. Narrow fixtures stand in for the full Sheets binder, billing
entitlement/record readability and some artifact tables. Not every production
trigger is instantiated; it is not a real PostgreSQL multi-session environment.

Coverage includes all nine readers, exact grants, cross-workspace/actor/session
rejection, mapping/reconnection/entity revocation, immutable references, historical
metadata-only classification, private VSI copies, recursive copy lifecycle,
wrong attempt/ticket, deleted inherited outputs, old-wrapper bypass attempts,
subsequent turns, completed-brief archive, demoted creator failure cleanup,
conversation deletion, workspace erasure and actual failed-settlement cost.
Source mutation between validation and completion is tested sequentially. This is
not a concurrent transaction race test.

Independent reviewer `/root/review_vsi_session_fix` reproduced defects rather than
only checking the supplied tests. Fixes cover ambiguous SQL ordering, later-turn
bypass, private-to-owner audience widening, missing artifact/copy lineage, demotion
cleanup, archive/deletion regressions, and omitted-marker old-wrapper completion.
Final independent review reran all 20 tests and cleared the last ticket-derived
gate for the inactive draft scope. No remaining blocker was found in that change;
this is not production approval.

`node scripts/shared-evidence-adapter-tests.cjs` also passes all twelve pure
parsers and both draft consumers, including five plugins + processed file +
approved note, sixth-source and all-twelve cases. Zero paid/provider/database calls.
It proves deterministic unadmitted projections, not saved production answers,
actual citation navigation or model-quality cross-reasoning.

## Exact remaining release blockers

1. **Complete typed eligibility and source-use policy.** QBO/Square fixture
   resolution now exists; file/note admission remains deliberately blocked until
   canonical memory eligibility and note semantics are mandatory. Native file and
   worksheet publication lineage now have synthetic tests but still need full
   composition qualification. Sheets has an inactive shared projection; its live
   authority/conflict comparison was denied.
2. **Writer/validator concurrency.** Specify and test a consistent lock/version
   interlock across legacy source facts, connection lifecycle, mapping, entity,
   parent artifacts and final settlement on real PostgreSQL with multiple
   sessions. Hash revalidation alone is insufficient. Do not introduce unreviewed
   lock order that could recreate known financial-reader deadlocks.
3. **Full deployed trigger composition.** Compose actual Sheets derivative binder,
   entitlement, regulated-content, persistence limits, erasure and lifecycle
   triggers with every new write path; test rollback and same-attempt contention.
   Metadata audit succeeded; full execution qualification is not complete.
4. **Stable installation and citations.** Qualify the new Katana nonsecret installation
   nonce and quiescent rollout. Protected reopening and a gated application route
   exist; wire exact citations into each persisted consumer.
5. **Runtime integration behind admission.** Wire the existing twelve parsers into
   both consumers only after these gates. Retain whole dependency groups within
   budgets, financial overlap deduplication, entity/period/currency semantics,
   and honest absence/causation limits. Persist/reopen deterministic five-plugin +
   file + note outputs in both consumers, then sixth/all-twelve cases.
6. **Provider configuration remains unverified.** Do not retry or route around the
   Vercel metadata 403. A successful stored-data read does not establish authorized
   provider use or production answer quality.

The separate lifecycle application patch
`4d23c9601131a0746f4732200c70baf12f3703ba` remains a required dependency. Existing
saved-report/citation repairs remain separable. No bulk recovery/demo cherry-pick.

## Historical impact, pause and eventual approval scope

No deletion, regeneration, guessed entity mapping or fabricated version history.
Current owners retain briefs subject to all prior controls; nonowners lose access
to classified derived content. Saved VSI copies keep their source actor boundary.
Ambiguous historical sources are not upgraded into newly eligible evidence.

The eventual single approval scope is exact protected readers/mapping tables,
private provenance/manifest storage, owner/private audience policies and terminal
wrappers/triggers, plus the reviewed consumer integration. It is **not ready for
an action-time apply request** until the blockers above are resolved.

`04-pause-new-readers.sql` revokes only the newly added authenticated mapping,
retrieval and seal entry points. Keep validation/terminal/failure routes available
for in-flight settlement, preserve incurred cost, and preserve source/session/RLS
fences and provenance. Never restore v1, drop restrictions or delete manifests as
automatic rollback. Runtime activation would be rolled back by stopping new shared
retrieval first, settling/failing in-flight attempts safely, then reverting the
feature route. Destructive/security rollback needs separate review.

## Latest inactive additions:08/09 and application helpers

08 adds the Sheets typed source branch with independent source-row and KPI privacy
checks, current mapping/version/accepted facts, ticket dependencies and unknown
coverage. No public grant is added. Production comparison of its authority/conflict
predicate was denied; do not apply it on repository assumptions.

09 adds `private.katana_evidence_installations`, credential/connection triggers and
a private legacy reader wrapper. The private table has no application grants.
It records only workspace/connection/random nonce, never key material. Connected
credentials cannot be replaced; reauthorization/disconnect require a new
connection. Existing credential identity metadata initializes the nonce with no
claim about past installation history. Quiesce Katana writers during initialization.
Rollback must disable shared Katana admission before removing its identity boundary.

`memory-eligibility.ts` reuses canonical memory filtering and note reconstruction.
`citation-reopen.ts` and the gated page implement exact output-revision reopening.
Neither makes unadmitted projections available to VSI or briefing generation.
