# Local qualification checkpoint — 2026-10-23

Inactive local work only. No new migration registered, production change,
publication, provider call, import or secret read. This is not a complete release
candidate. The implementation intentionally stops short of activating incomplete
admission contracts.

| Source | Current local implementation | Qualification limit |
| --- | --- | --- |
| Xero, Harvest, Clockify, Toggl, Zoho Inventory, Katana, Loyverse, Zoho Books, Wix Orders | Nine fixed legacy readers, owner-reviewed mapping, immutable references and manifest dispatch | Sequential synthetic tests; writer interlocks outstanding; Katana now has a nonsecret installation nonce; rollout and concurrent writers still unqualified |
| QBO | Current valid version + unique valid validation work + live canonical mapping/connection; canonical currency/basis/period correspondence; audited minimized preview | Synthetic fixture; coverage unknown; no financial aggregation inference |
| Square | Exact current payment/connection/entity, installation generation, full projected-field hash, minor-unit preservation | Synthetic fixture; equal-timestamp mutation rejected; coverage unknown |
| Google Sheets | Shared exact source/version/mapping projection; accepted fact/KPI correspondence; independent source-row and KPI privacy checks | Repository-contract fixture; live conflict/authority comparison denied; coverage remains unknown |
| Reviewed file facts | Current native/reviewed authority, parent-run and worksheet-head preview; complete eligibility snapshot; canonical `filterEligibleMemoryRows` validator | Admission remains blocked until this validator is mandatory in generation and safe inherited completion |
| Approved Business Notes | Current approval/version/chunk provenance; canonical memory eligibility, reviewed-text reconstruction and original/chunk hash validation | Admission blocked: validators are not yet mandatory in generation bridge |

Neither production VSI nor production briefs imports these adapters. The existing
pure draft consumers accept unadmitted synthetic fixtures only. There is no new
claim of production multi-plugin readiness.

## Tests

* PGlite SQL contract suite: 28/28 passed. Includes exact QBO scope mismatch,
  Square equal-timestamp edits, same-tenant ownership, direct inherited-artifact
  bypass rejection, file/note admission rejection even with bound roots and via
  historical manifest inheritance, deterministic VSI/brief completion and exact
  reopening, actor-private VSI, changed citation source rejection, and prior
  legacy/terminal/accounting cases.
* Canonical note semantic suite: 8 checks passed; malformed original/review,
  changed review/index, wrong chunk index and bad user context are rejected.
* All-12 pure adapter fixture suite passed: 5 plugins + file + note, sixth source,
  all twelve, both draft consumers, no model/database calls. It remains unadmitted.
* Business Notes regression passed. Full TypeScript `--noEmit --incremental false`
  passed. Business Notes contextual integration now passes. Its fixture asserted
  `Holding steady` without a previous stored snapshot, contrary to the existing
  movement guard. Only the fixture trend was changed to null; production behavior
  and the guard are unchanged.
* Canonical memory eligibility: 13 checks passed. Citation reopening tests passed
  (exact revision, protected RPC, cross-workspace mismatch, no fallback, internal
  snapshot stripping). The new citation page exits through a constant-false gate.
* Independent reviewer cleared the inactive checkpoint after finding and fixing
  missing ticket roots, parent-run checks, canonical QBO correspondence, and
  unqualified file/note admission. Reviewer ran the earlier 25 SQL cases plus the
  8 note checks; the additional inherited-admission regression was then added.

Tests use audited owner/session/privacy/trusted-completion/VSI bodies, but stub
the full Sheets binder, some readability/entitlement behavior and document
authority. They do not prove the complete deployed trigger graph or concurrent
Postgres behavior. Saved-output/citation verification is at the database-contract
level; it is not a browser citation click or a generated answer quality test.

## Infrastructure and concurrency blocker

No local `postgres`, `psql`, `pg_ctl`, Docker or Postgres.app was found in PATH or
the supported common installation locations. No software was installed and no
remote database was substituted. Status: **unavailable infrastructure**, not a
denied production test. PGlite is single-process synthetic qualification; sequential
mutation/revalidation is not multi-session race coverage.

Before runtime activation, source writers and terminal validation need a shared,
reviewed ordering/version interlock. Relevant existing writer families include
`apply_reporting_history`, `apply_reporting_snapshot`, `select_reporting_account`,
`save_reporting_refresh`, their disconnect path; `apply_loyverse_receipts`,
`apply_zoho_books_history`, `apply_wix_order_snapshot` and their disconnect paths;
QBO canonical validation/current-version publication; Square payment upsert and
connection generation transitions; file/review publication, note approval,
mapping/entity lifecycle and inherited output lifecycle. Reader-only locks are
insufficient while an independent writer can commit between final revalidation
and output persistence. No new unqualified lock order was introduced.

Required two-session cases: writer commits before validation; writer attempts
commit after validation before output; disconnect/reconnect and entity/mapping
revocation in both orders; equal-timestamp Square update; QBO quarantine/current
version replacement; file review/head replacement; note reapproval; parent output
deletion; simultaneous same-attempt completion; rollback after failed completion.
Expected result is serialization or fail-closed retry, no stale saved output,
no duplicate settlement and no deadlock. This suite has not been executed.

Draft09 adds a private random Katana installation nonce initialized from credential
identity metadata only and rotated on credential INSERT/UPDATE. DELETE removes it.
The reader includes it in the incarnation hash. Credentials remain unread.
Initial pending/choose-account setup is supported; reauthorization and disconnect
are terminal for the connection ID. A replacement requires a new installation.
The explicit credential-to-connection row-lock inversion was removed.

Independent review confirmed the old reauthorization bypass is closed and verified
workspace cascade with a separate synthetic FK fixture. It identified a rollout
window: a credential insert between backfill and trigger installation could miss
initialization and fail closed. Draft09 therefore explicitly requires quiescing
Katana writers through the migration commit; that rollout and real concurrency
are not yet qualified. No live writer is paused by this local work.

See `ISOLATED-POSTGRES-PROPOSAL.md` for the smallest supported test setup. Native
PostgreSQL17 would suffice for focused two-session tests, but does not by itself
establish the full Supabase extension/trigger composition.

## Full deployed-trigger composition and next bounded work

The approved audit records actual trigger names/bodies in
`audit/deployed-contracts.json`, plus typed readers in
`audit/typed-source-contracts.json`. Current fixtures execute the trusted-run
transition guard, but do not compose all of these deployed guards:
`aa_google_sheets_erasure_cascade_guard`, `audit_workspace_entitlement`,
`reject_explicit_regulated_business_text_v1`, `workspace_persisted_usage_limit`,
`set_*_updated_at`, `zz_google_sheets_derivative_fence`, entity identity protection.
Audit success is not execution success. Preserve their real alphabetic firing
order and transaction claims when expanding qualification.

Next code work: make canonical file/note eligibility mandatory before lifting their
dispatcher rejection; qualify Sheets typed identity; normalize typed projections
through the existing parsers with explicit entity/period/unit semantics; retain
all source roots in both VSI and brief bridge; connect the now-implemented gated saved citation
route to persisted consumer output. Gate activation on full-trigger and real writer-concurrency qualification.
Then use deterministic 5-plugin/file/note save/reopen fixtures in both consumers,
plus sixth/all-twelve cases, with financial overlap deduplication and no hard
five/ten-source cap. No live generation is needed for that step.

Separate unresolved denial: Vercel provider-configuration metadata returned 403
earlier. It was not retried or bypassed. Provider-policy readiness remains
unverified. No production approval is requested at this checkpoint.

## Explicit integration status and next implementation boundary

Actual VSI and briefing generation wiring is **not complete**. No new claim of
5-plugin/file/note saved end-to-end behavior follows from these tests. The code
needed next is concrete:

1. Add protected discovery of already owner-confirmed binding IDs and typed
   identities. The current mapping RPC returns a binding ID only during explicit
   owner confirmation; there is no authenticated list endpoint. Do not query its
   private table with service-role authority or infer mapping from account labels.
2. Convert exact protected projections into the existing normalized adapters.
   Keep Square minor units and unknown coverage; do not treat raw file text as
   reviewed numeric facts or treat missing entity correspondence as confirmed.
3. VSI: pass reserved **database request ID and attempt** from `lib/vsi/http.ts`
   to the engine. Seal after ticket binding, validate canonical file/note semantics
   before provider input, retain dependency groups during budget selection, and
   settle the exact manifest through v3. Preserve actual incurred-cost failure
   settlement and all inherited conversation sources.
4. Briefs: build the shared evidence package before computing generationKey and
   trust fingerprints in `workspace-context.ts` / `briefing-projection.ts`; seal
   the same identities after the normal run claim. Complete through the trusted
   lifecycle plus manifest wrapper. Appending raw shared JSON after package
   fingerprinting would invalidate the trust contract and is not implemented.
5. Only after semantic validation is mandatory across both consumers should the
   explicit file/note dispatcher rejection be replaced. Keep reopening and saved
   copies bound to the exact output revision and all original sources.

The infrastructure gap blocks race qualification, not all local coding. Consumer
wiring remains unfinished implementation work, separately from that blocker.

## New denied read-only metadata operation

An attempted production SELECT of the definitions of
`read_google_sheets_operational_conflicts_v1` and
`guard_google_sheets_kpi_authority_v1` in `mdiianhfrojmxqpwrflh` was rejected by
automatic approval review. Its reason was that database access was prohibited by
the initial browser-only instructions. It did not execute and was not retried or
reached through another route. Draft08's deployed-contract comparison is therefore
**denied/unverified**, despite the earlier successful, separately approved audit.
The prior Vercel403 metadata boundary remains unchanged.
