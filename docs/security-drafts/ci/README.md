# Disposable CI preparation — not published or executed

This is a **foundation-only** qualification target. It is ready for review and a
separately authorized branch publication, not a claim of production readiness.
The application runtime gate remains false. These files do not apply migrations
to any existing database or enable the feature.

## Exact publication scope

The proposed external action is to publish the reviewed commit on
`codex/shared-evidence-security-draft`. Its exact branch entry in `vercel.json`
disables Git deployment. The new workflow runs only on pushes to that branch:
no pull-request event, manual dispatch, main event, merge, deployment or release
step. Do not open a PR as part of this proposal; the separate existing PR workflow
has a much wider scope.

The job has read-only repository permission, disables persisted checkout
credentials, uses the repository's existing pinned actions and Supabase CLI
2.111.0, and installs the frozen lockfile. It requests no repository secrets,
environments, hosted database URLs, application sessions or provider credentials.
Dependency and container downloads plus GitHub runner minutes are its costs;
account quotas were not inspected. Nothing has been published or dispatched.

## What the workflow will run

1. Run the offline tests and validate the SHA256 manifest before starting services.
2. Initialize a fresh runner's local Supabase configuration and start its image
   with application migrations disabled. This image source is not a test target.
3. Reuse `runContainerQualification` from
   `scripts/qbo-candidate-local-container.cjs`. The helper verifies a Unix-socket
   Docker context and an existing running local Supabase image, creates a new
   PostgreSQL17 cluster in that exact image with `--pull=never`, no host mounts,
   a generated ephemeral password, and a host port bound only to127.0.0.1.
   It verifies container ID/name/image/nonce and the cluster/data-directory
   identity before creating a fresh database. The helper's generated password
   stays in process memory/container environment; it is not logged or published.
4. Apply only the minimal synthetic platform fixture, the frozen foundation
   schema/owner helper, and unchanged `01-legacy-evidence.sql`. No production
   data or full repository migration chain is copied. Three independent database
   clients exercise:
   - exact reference reads before and after a committed source change;
   - owner mapping transaction versus connection disconnection, with an observed
     advisory-lock wait and denial after revocation;
   - owner read transaction versus session deletion, with an observed row-lock
     wait and denial after session removal.
5. Close clients and remove only the verified owned container in the helper's
   `finally`. Stop runner-local Supabase in the workflow cleanup step. The job
   timeout is30minutes; assertions use bounded queries and lock waits. Forced
   cancellation also relies on GitHub's disposable-runner teardown.

Source edits are detected after commit; these tests do **not** claim that a hash
check protects a later artifact commit. The production source-writer interlock,
all-provider races, copied-artifact lifecycle, once-only settlement under true
concurrency, and full deployed trigger composition still require qualification.
This fixture uses no token verification or real Auth service. The audited owner
helper is real; its users, sessions, membership and entity rows are synthetic.

## Frozen evidence and fail-closed limits

`audited-definitions.json` contains the available exact function definitions,
trigger definitions and grants from the two already-authorized local audit
captures, without their project ID or aggregate customer counts. It is an
**incomplete evidence snapshot**, not executable installation SQL. Each function
has the SHA256 of its exact UTF-8 definition, without whitespace normalization.

`foundation.sql` uses exact CREATE TABLE excerpts from the listed repository
migrations and the audited role-neutral Square owner helper. Its small platform
tables are explicitly synthetic. The full graph is not reconstructed from stubs.
`manifest.json` hashes that fixture, audit snapshot, original input files, draft01
and owned-container/platform dependencies. Any drift stops preflight. The explicit
offline freeze script can refresh it only as a reviewed source change; CI never
regenerates hashes.

The `--full-composition` mode always exits nonzero **before Docker access**. The
currently missing audited trigger bodies are:

- `private.enforce_workspace_persisted_limit_v1`
- `private.guard_workspace_mutation_entitlement_v1`
- `private.protect_business_entity_identity_v1`
- `private.reject_explicit_regulated_business_text_v1`

Some repository versions may exist; that does not establish equality with live
definitions. Also missing are the complete relevant deployed table/constraint,
RLS/grant/trigger inventory; recursive routine dependencies; exact installed
source-writer definitions/lock order; and a reviewed dependency-ordered complete
overlay. The earlier metadata-access denial remains in force. This preparation
does not retry that operation or request credentials.

## Local checks performed

Only the following offline commands were executed during preparation:

```sh
node scripts/shared-evidence-postgres-qualification-freeze.cjs
node scripts/shared-evidence-postgres-qualification-tests.cjs
node scripts/shared-evidence-postgres-qualification.cjs --check
node scripts/shared-evidence-postgres-qualification.cjs --full-composition
```

Offline tests verify forbidden modes/environment values, hash tampering and path
escape rejection, owned-container/loopback identity checks, bounded lock-barrier
logic, pinned workflow and deployment scope, plus actual frozen fixture
DDL/seed/mapping/capture/grants in embedded PGlite. They do not start a native
database server. `--check` passes; `--full-composition` intentionally fails with
the blockers above. `--foundation` and the workflow remain **untested on real
PostgreSQL** until authorized CI runs. No live calls, installation, Docker start,
database connection, publication or paid provider test occurred here.
