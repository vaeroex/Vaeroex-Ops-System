# Bounded qualification closure package

Local preparation after successful foundation CI on `4245e655`. Nothing in this
package is published or connected to a workflow. Runtime remains false. The
existing foundation pass is unchanged; this is a larger, separately scoped test
proposal, not a production-ready claim.

## Executable local package

`shared-evidence-sql-fixture.mjs` extracts the existing 32-case suite's fixture
without changing its SQL semantics. It accepts an explicitly supplied local
database adapter. It still contains disclosed synthetic ticket/readability,
entitlement and document-authority helpers; it is not the full deployed graph.

`shared-evidence-writer-cases.mjs` supplies twelve exact stored-write probes:
Xero/Harvest/Clockify history; Toggl/Zoho Inventory/Katana snapshots; Loyverse
receipt value; Zoho Books invoice total; Wix order amount; equal-timestamp Square
payment amount; QBO quarantine; and Sheets accepted KPI change. These are direct
synthetic fixture writes, not calls to installed provider ingestion functions.

`shared-evidence-writer-qualification.cjs` is restricted to the existing verified
owned disposable container. It accepts no database URL or arbitrary fixture.
It opens three sessions and observes whether a writer commits before a reader
ends or waits on an actual lock, then verifies a fresh read rejects changed
evidence. It also prepares actual wrapper tests for rolled-back VSI completion,
simultaneous same-attempt VSI settlement, and simultaneous brief completion.
Output always reports `releaseQualified:false`. A successful diagnostic run is
not a safe-final-commit proof; these probes do not pause inside the final output
write or exercise every installed writer, phantom, parent lifecycle or trigger.

The shared container helper adds only a closed `empty` fixture option; existing
callers retain the original platform fixture. No host/URL/credentials options
were added. Two hash manifests freeze helper, fixture, audit and SQL inputs.

Local commands already passed:

```sh
node --test scripts/shared-evidence-security-draft-tests.mjs
node --test scripts/shared-evidence-writer-probe-tests.mjs
node scripts/shared-evidence-postgres-qualification-tests.cjs
node scripts/qbo-production-candidate-runner-tests.cjs
node scripts/google-sheets-provider-policy-tests.cjs
node scripts/shared-evidence-writer-qualification.cjs --check
```

Results: 32 existing cases; two expanded tests covering twelve real SQL mutation
projections and mode/barrier controls; 456 existing container-runner assertions;
actual provider-policy code with mocked transport. No remote requests or native
expanded execution. `--source-write-probes` is prepared but unexecuted. Its native
test assertions must be reviewed and run under a new scoped CI proposal before
any concurrency result can be claimed.

## Five remaining work packets, with explicit exit criteria

1. **Close metadata, once.** Obtain the safe metadata listed in
   [REMAINING-QUALIFICATION-CONTRACTS.md](REMAINING-QUALIFICATION-CONTRACTS.md).
   Twenty-seven audited bodies are reusable. Repository-only definitions may
   populate a candidate overlay only after equality/compatibility is established.
   Missing audited triggers, `google_sheets_unmaterialized_file_v1`, dependency
   tables/policies/grants, and source-writer bodies cannot be fabricated. The
   denied Sheets definition lookup must not be retried with unchanged evidence.
   Exit: a reviewed, hash-frozen dependency graph and installation order with no
   synthetic helper presented as deployed parity.
2. **Complete one writer/terminal interlock design.** Account for connection,
   mapping, session, privacy, actor/workspace, source/version and target locks in
   their existing order. Row locks alone do not cover new rows, date moves,
   coverage edits or alternate writers. Add the minimum shared interlock in a
   reviewed local migration/writer patch; do not guess a lock key and activate
   it. Exit: six parameterized race groups from the inventory pass on the exact
   graph, including the final-validation-to-output-commit window, rollback,
   same-attempt accounting, old-wrapper rejection and file/note/copy lifecycle.
3. **Finish owner mapping and minimum comparison semantics.** The draft mapping
   RPCs have no application caller in `app/` or `lib/`; the owner confirmation UI
   is still missing. Show exact connection/incarnation and selected canonical
   entity, preview, then confirm, with no label matching or automatic backfill.
   Shared readers support all twelve source observations, but only closed
   invoice/order non-additivity is wired as a relationship. Choose the first
   useful comparison supported by authoritative coverage/period/unit evidence;
   payment-per-tracked-hour cannot assume complete payments or complete labor,
   and reported file/note text cannot supply a measured denominator. Exit: a
   meaningful qualified comparison in actual VSI and briefs with both originals,
   compatible period/entity/unit rules and explicit insufficient-data behavior.
4. **Qualify configuration and transport without exposing credentials.** An
   authorized administrator supplies booleans/statuses only: dedicated Sheets
   key configured for the production deployment; organization/project settings
   configured and matching the key's issuing project; intended provider data
   controls verified; classification/revalidation/fallback behavior matches the
   reviewed app. Do not send key values, tokens or secret exports. The existing
   Vercel403 is not bypassed by another tool. Local provider-policy tests pass;
   that does not establish deployed settings or Zero Data Retention. Exit: safe
   configuration attestation plus policy-path qualification using actual tickets.
5. **Bundle release review, then a bounded live acceptance.** Only after the
   preceding exits, propose one exact migration/application release with rollback
   and historical owner/private-source impact. A separate approved isolated CI
   run qualifies full composition and deterministic five-plugin/file/note saved
   VSI and brief behavior. Production application/schema activation and at most
   one initial VSI plus one initial brief live-model acceptance are separate
   actions requiring scoped authorization. No repeated campaign, new OAuth,
   imports, fabricated sandbox data, new seats or fixed plugin cap.

## Next action requiring new scope

The ready diagnostic package can be published to the same CI-only branch with a
workflow step for `--source-write-probes`, retaining no secrets, no Vercel deploy,
owned container cleanup and a bounded job timeout. This expands beyond the
already-approved foundation run and has **not** been published or run. It would
consume runner minutes and download the same pinned image/dependencies; it needs
no production data, credentials or provider calls. It can expose races but cannot
close missing deployed metadata or implement the interlock by itself.

For the shortest path, resolve packet1's metadata while reviewing packet2's exact
writer ordering, then run the expanded probes/full-graph tests as one scoped CI
batch. Do not request a production rollout while those exits remain open.
