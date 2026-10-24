# Inactive release preparation

The VSI-only application is consolidated onto production
`710bfa5ed93b6f4b01d233c94d5a3a4829fd6b73`. Its SQL is the unchanged reviewed
package derived from published candidate `f2d1547466edeadd586443e0e62afe6199f700da`,
tree `2aefe09d06924a71b6f1417cd71a5610e1716572`. The source identifiers in SQL
headers describe package provenance, not the current application base.
Shared evidence, qualitative synthesis and failure-accounting gates remain false.
No production migration, grant, deployment or activation is performed here.

There are no active users according to the owner. Use one operator maintenance
window, without a cohort rollout. Stored records and scheduled/background writers
still exist or may exist: do not infer an empty database, delete data, or skip locks.

## Exact forward package

`forward.sql` assembles drafts 01, 02, 03, 05, 06, 07, 08, 09, 10, 11, 12 and 13
in that order. Procedure 04 is excluded. The assembler removes only the individual
outer transactions, retains their function bodies and applies one atomic outer
transaction. `manifest.json` records every source digest and the output digest.
Generate/check with `node scripts/shared-evidence-release-package.cjs --write`
or `--check`. These commands do not apply SQL.

Forward SHA256: `75ad92aba5ebef782d48c15799d7ab70b313a8a0bd0bd6ecac9648bd8223faf6`.
Pause SHA256: `a184644ea4d27e3c946d2dfb96c55b53ae7453be0a4864e3a1cab385a880e00f`.

The package takes SHARE ROW EXCLUSIVE locks on `ai_agent_runs`, `reports` and
`vsi_exchanges` before audience classification. They prevent an insert or actor
source change from landing between the historical scan and boundary-trigger
installation. The same transaction locks `reporting_connections` and
`reporting_credentials` before Katana nonce initialization. Those table locks
affect all reporting providers, not just Katana. Normal reads remain possible.
The locks remain held through commit. Lock timeout is five seconds; statement
timeout is two minutes. A timeout aborts the package; it is not permission to
increase timeouts or bypass a guard.

## Installation evidence and limits

The local installer restores the captured columns, defaults, constraints, indexes,
RLS/policies, trigger bindings and function execution ACLs for all 55 existing
relations in the 64-table target. It uses saved screened bodies or matching public
repository definitions; private captures are not copied into Git. The nine new
target relations are created by the forward package. SQL function-body checking
is enabled for that package.

The rehearsal is PGlite single-backend PostgreSQL/WASM. It is separate from the
already-passed native concurrency tests; those tests are not rerun. Supporting
foreign-key targets use only referenced key fields, and the existing reporting
credential table uses its public repository DDL. Existing supporting-table policy
captures with unnamed numeric role OIDs are not guessed. The uncaptured intake
INSERT screen trigger is outside the target and cannot fire during these drafts;
its other captured guards remain installed. These limits prohibit a claim of
whole-database or OCR/intake-writer parity. No permissive replacement is created.

The local test also injects failure after the final draft, rolls back and verifies
the old policy/trigger layout and absence of new audience/accounting objects. A
successful installation verifies all 128 new fence triggers, preservation of the
existing target policies/triggers, service-only access to the new accounting RPC,
and continued denial of direct execution of old VSI v1.

## Deployment sequence requiring separate approval

1. Review the local consolidated build and focused results in
   [LOCAL-VALIDATION.md](LOCAL-VALIDATION.md). The production build passed with
   empty service environment and outbound transport blocked; the older Mac SWC
   mismatch is not a current blocker. Publication/CI on the new exact application
   head still needs approval. No new native concurrency campaign is proposed for
   the byte-identical SQL. No private captures or service credentials go to CI.
2. Review the exact application head and SQL digest, installation result, provider
   statuses and data checklist. The approval must cover the new owner/private-copy
   restrictions, protected readers/mappings, manifests, semantic receipts,
   completion wrappers, writer fences and accounting RPC. It must also disclose
   the brief/report/Katana quiet period and the pause procedure. No old VSI grant
   is restored, and no exemption is added.
3. Keep the shared gate false and check/drain any in-flight requests before the
   single migration window. Pause artifact writers and reporting account-selection,
   refresh, disconnect and credential writers, particularly Katana. Use the
   existing operator controls; do not invent a success signal or alter authority.
   Hold that quiet period through the package commit and checks. Table locks are
   the final transactional protection, not proof that the operator paused workers.
4. Apply the exact atomic package once using the reviewed migration route. If
   execution is uncertain, inspect migration/object state before any retry. If a
   statement fails, roll back the transaction; no partial backfill is accepted.
   Verify the reviewed object/ACL/trigger invariants. Release the quiet period only
   after confirmed commit or rollback. Do not extract credential values.
5. Deploy the reviewed application while all three gates are still false. Confirm the
   intended production release and baseline owner access, then enable only the gates covered by a separately reviewed activation change.
   Qualitative model behavior requires bounded real-model acceptance; mocked
   fixtures are not that proof. The three gates are distinct. Source/admission/provider controls
   stay enforced throughout.
6. With eligible existing owner data, request one useful brief/comparison in VSI;
   save/reopen that answer and every supporting citation. Separate briefing
   generation is retired in the current candidate and is not a canary target. Stop on a concrete denial or missing
   input. No imports, new connections or manufactured records are part of this
   canary. Mocked fixture success does not prove live model quality.

## Operational handling of 40001

The new fence uses a nonblocking transaction lock. Contention intentionally raises
40001 rather than allowing validation/save to race a source change. The failed SQL
transaction must roll back in full. Do not retry only its last statement, reuse an
old evidence packet/ticket, or automatically call the provider again.

For generation, preserve the answer error, reconcile uncertain completion before
failure bookkeeping, and account incurred cost once. Ask for a fresh normal read
only after the previous attempt's outcome is known. For ingestion, retain the
existing task/lease/idempotency contract: retry the entire existing transaction
only through a documented retryable task state; do not duplicate provider fetches
or mark a rejected write successful. If a worker's handling is unknown, leave its
task paused for operator review. Monitor conflict frequency and failed/leased task
status without exposing record contents. Sustained contention is a reason to pause
new shared admission, not remove source/session/privacy checks.

## Rollback / safe pause

Before commit, any package error rolls back all its schema/backfill changes.
After commit, the default rollback is an application pause, not destructive SQL:

1. Stop new shared requests and revert the shared runtime gate to false. Preserve
   terminal handlers until in-flight attempts are reconciled and settled safely.
2. If SQL entry-point pause is needed, apply the separately reviewed `pause.sql`.
   It extends procedure 04 to later discovery/preview entry points. It keeps
   terminal/failure handlers and protected saved-target reopening available.
3. Retain owner restrictions, original-actor boundaries, source/session/privacy
   controls, immutable provenance/manifests and all cost events. Never restore v1
   grants, erase accounting, regenerate lineage or relax historical classifications.
4. If the new fence itself causes an ingestion outage after admission is stopped
   and shared operations are drained, a separately approved targeted rollback may
   remove only this release's named fence/no-truncate triggers from its 64-table
   manifest. Restore the captured prior trigger layout; keep audience and privacy
   guards. Do not use broad CASCADE drops.
5. Before removing the new accounting function, disable its separate gate, drain
   calls, then revoke/drop only its exact nine-argument signature if specifically
   approved. Preserve request and ledger rows. Reverting that path retains the old
   expired-lineage accounting limitation; it never restores evidence access.

Historical briefs and copies become owner-only; saved VSI copies remain private
to their original actor, including copies of copies. Ambiguous historical sources
stay unavailable for new reasoning. The release does not rewrite their content.
