> Historical checkpoint. Current status is [QUALIFICATION.md](QUALIFICATION.md). Later approved captures resolved the database metadata gaps listed here, and native synthetic fence/privacy-erasure CI passed. Statements below about missing wiring, pending metadata, or unrun synthetic races describe that earlier checkpoint, not current status. Installed writer composition and live model quality are separate.

# Inactive writer fence and owner mapping checkpoint

This local increment follows `2487aa9e`. It is not included in that pending CI
publication scope. Runtime remains false; no schema/application release or
external operation occurred. Existing frozen foundation/probe files are unchanged.

## Implemented locally

`12-workspace-writer-fence.sql` adds three private functions and row/truncate
triggers on 64 explicitly listed known source, authority and artifact relations.
There are no new tables or grants. A missing relation or UUID workspace column
aborts installation rather than silently omitting protection.

- Covered mutations and final validation acquire the same exclusive transaction
  advisory key for their workspace. Cross-workspace row movement acquires both
  distinct keys in sorted order. Different workspaces have different keys.
- The key uses `pg_try_advisory_xact_lock`: a conflicting transaction raises
  `40001` and rolls back; it does not wait or continue without protection. This
  serializes covered source writes, including new rows and coverage changes,
  against final re-resolution through output commit. It does not hold a database
  transaction across a model call.
- Final validation and mapping confirmation require READ COMMITTED so they see
  the current committed source after acquiring the key. Existing writer isolation
  levels are not changed. Existing owner/session/privacy checks remain intact.
- Mapping confirmation acquires the fence before reading the connection
  incarnation and active entity. Otherwise a lifecycle change could commit between
  its read and binding insert.
- The Sheets resolver locks the approval owner's `auth.users` row FOR SHARE
  NOWAIT, translating contention to `40001`. The current actor's existing session
  check is insufficient when a different owner approved the mapping.
- TRUNCATE is explicitly rejected on the protected relations; row triggers would
  not see it. This affects maintenance and must be disclosed before application.
  No production maintenance behavior has been changed.

Ordinary SQL writes are covered only when they touch the listed tables with
triggers enabled. Administrative trigger disabling, alternate dependency stores,
and missing transitive authority helpers are not proved safe by this draft.
Known table coverage is not a complete deployed-graph certification.

The UI adds one owner-only preview/confirmation page, one server action and a
shared link from the nine legacy connector pages. It selects an existing active
workspace entity, has no default entity choice, requires an explicit checkbox,
and submits the exact reviewed connection incarnation. It never matches labels,
creates an entity, imports data, accepts actor IDs, or uses an admin client.
Square, QBO and Sheets retain their existing mapping contracts. Both page and
action are blocked by the unchanged disabled runtime gate.

## Qualification and remaining implementation limits

- Mapping action tests and static UI rendering pass: owner/workspace binding,
  duplicate/tampered fields, explicit confirmation, stale/denied RPC outcomes and
  unknown transport outcomes fail closed. TypeScript passes.
- Two PGlite fence tests cover twelve provider mutations under injected
  contention, no changed source after rejection, new coverage rows, both workspace
  keys on a move, null-workspace rejection, TRUNCATE rejection, final VSI rollback,
  stale isolation rejection, failed/successful VSI and brief settlement, and another
  owner's Sheets approval becoming unavailable after an account ban. Missing dependency tables
  are explicit minimal test placeholders, not representations of deployed DDL.
- These are single-backend contract tests, not native concurrency. The existing
  three-session foundation pass does not qualify this new fence. Full installed
  writer/trigger tests remain necessary before activation.
- Repository review of reporting/Loyverse/Zoho/Wix apply-error paths found that
  generic persistence errors preserve connected state and report sync failure;
  only explicit authorization failures request reauthorization. A contended
  cleanup can leave its short lease until expiration. QBO/Square worker retry and
  all lifecycle writer composition still require exact deployed qualification.
  No automatic retry loop or provider refetch was added.

## Business comparison boundary

The actual VSI and brief paths retain the deterministic invoice/order
non-additivity comparison with both sources and explicit entity/date/currency
restrictions. No additional numeric ratio was enabled: existing contracts do not
establish complete payments, complete labor coverage, or a measured file/note
denominator. Owner mapping cannot assert those missing facts. The next numeric
recipe needs an explicit coverage/scope/unit contract and compatible stored data;
this prerequisite is independent of the denied metadata packet.

## Exact remaining handoff and rollout constraints

See [BLOCKED-EVIDENCE-HANDOFF.md](BLOCKED-EVIDENCE-HANDOFF.md) for the minimal
metadata/status-only request. Missing deployed definitions prevent certifying
dependency coverage and installation order; provider controls require separate
authorized attestation. No denied route was retried.

Before any application: qualify the complete graph and native races, disclose
workspace write contention and TRUNCATE impact, then review the exact migration
and application candidate. A rollback must first disable/drain shared generation,
remove the added triggers, restore the three replaced definitions from drafts
01/05/08, and remove only the new private fence functions. Never remove the fence
while allowing shared generation to continue. Existing saved data is not deleted
or rewritten by this increment. Historical eligibility remains governed by the
earlier reviewed audience/lineage drafts, not a new backfill here.
