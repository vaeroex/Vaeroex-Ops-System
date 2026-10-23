# Isolated PostgreSQL qualification proposal — not executed

## Verified local options

No `postgres`, `initdb`/`pg_ctl`, Docker, Supabase CLI or Postgres.app runtime was
found in PATH or the previously checked standard installation locations. The
available PGlite0.3.14 environment cannot prove independent-session races.
No installer, server, container, workflow or hosted database was started.

Two existing repository patterns can be reused:

* `scripts/run-square-durable-page-qualification.js:createNativeTarget` creates
  a private temporary native cluster with TCP disabled and a0700 Unix socket,
  validates exact data directory, cluster nonce, OS owner and server identity,
  and stops only that owned cluster. It is not currently an exported helper.
* `.github/workflows/ci.yml:security-database` uses Node24 and pinned Supabase
  CLI2.111.0 to build a disposable local database, apply production-shaped
  migrations, and run isolation/concurrency suites. No workflow was dispatched.

Do not reuse the generic isolated-database runner's hosted fallback or discover
credentials. Do not use the paused demo database or production for these tests.

## Smallest proposed local setup

1. Obtain explicit authorization for installing an official PostgreSQL17 runtime
   in a specified location and starting a temporary local test cluster. Inspect
   the installer/source and exact filesystem scope before that action. No system
   service, login item, firewall or OS protection changes are needed.
2. Adapt the existing native target helper for this qualification only. Require
   an explicit absolute binary directory, reject inherited hosted DB settings,
   initialize a new0700 temporary directory under `/tmp`, disable TCP, and verify
   server identity before creating any test objects. Existing Node `pg` is enough
   for two independently connected clients; no new application dependencies.
3. Use synthetic tenants, users, sessions and source records only. Apply reviewed
   source contracts and inactive drafts to this disposable database. No import of
   customer records, auth sessions, credentials or production secrets.
4. Bound the first run to15minutes, two transaction clients plus one controller,
   short statement/lock timeouts, and deterministic barriers. Stop the owned
   cluster in finally; leave only redacted pass/fail metadata and owned scratch
   files for inspection/explicit cleanup. Never stop an existing user server.

An official native runtime **would suffice for focused multi-session concurrency**.
It may not include pgvector or every Supabase extension required to apply the
complete production ledger. Full trigger composition requires the existing
Supabase disposable CI setup or a separately approved Docker+Supabase local setup.
Do not substitute stubs and label that full composition.

Costs: no hosted database, model, OAuth or provider charges. Local disk/download
and CPU are required; installer footprint depends on the selected distribution.
CI alternative consumes GitHub runner/build quota under the account's plan;
current quota/pricing was not inspected. No production credentials are required.
Publication/CI use would need its own scoped approval because this branch has not
been approved for external publication.

## Required deterministic transaction cases

Run both interleavings: writer commits before validation; writer attempts a change
between final validation and output commit. Cover legacy facts and connection
state; Katana credential/nonce initialization and cascade; binding/entity
revocation; Square equal-timestamp edits/generation; QBO quarantine/current-version
replacement; Sheets accepted-link/mapping/source privacy changes; file review and
worksheet-head replacement; note reapproval; inherited output deletion; concurrent
same-attempt completion; terminal rollback and once-only cost accounting.

Expected behavior is a documented serial order or fail-closed retry, with no stale
saved answer, duplicate settlement, audience widening or deadlock. Hash rechecks
alone do not establish that property. Source-writer interlocks must be completed
and independently reviewed before these tests can qualify the release.

## Decision requested from parent, not executed here

The minimum infrastructure action is the named PostgreSQL17 installation plus
permission to run the owned, TCP-disabled synthetic cluster. No broad cloud or
production authority is needed. Prefer this focused option over enabling a hosted
fallback; use disposable Supabase CI only for the later full-ledger composition.

## Branch-specific CI alternative — exact proposed scope, not published

A CI-only path can avoid installing software on Isaac's Mac. Before any approved
push, the reviewed change must disable Vercel Git deployments for the exact branch
`codex/shared-evidence-security-draft` in `vercel.json`. It is currently not listed,
so publishing the present branch could otherwise create a preview.

Proposed new workflow: `.github/workflows/shared-evidence-qualification.yml`,
triggered only by a push to that branch, with `contents: read`, checkout credential
persistence disabled, a30-minute timeout, existing pinned Node24/pnpm actions and
Supabase CLI2.111.0. No secrets, environments, cloud project IDs, provider keys,
production URLs, pull-request trigger, main trigger, deployment or merge step.
Normal existing CI applies only if its existing branch filters match; do not
broaden those filters.

Proposed runner: `scripts/shared-evidence-postgres-qualification.cjs`, reusing
`runContainerQualification` in `scripts/qbo-candidate-local-container.cjs`.
Start the disposable Supabase image only within that fresh GitHub runner, then
create an owned fresh PostgreSQL17 container with a generated disposable password,
loopback-only host port and verified container/cluster identity. Use two database
clients plus a controller, synthetic records and deterministic barriers. Reject
external database URLs and linked projects. Cleanup the owned container in finally
and run `supabase stop --no-backup` in an always step. No hosted fallback.

Before writing a runnable full-composition job, freeze the missing live-contract
SQL overlay and hash manifest, identify every trigger dependency, and implement
the source-writer interlocks. A smaller synthetic fixture run may qualify its
explicit contracts but must not be reported as the full deployed trigger graph.
No workflow or runner has yet been created or executed for this proposal.

External action for eventual approval: publish the exact reviewed inactive branch
(with deployment disabled) to Vaeroex/Vaeroex-Ops-System and run this isolated
synthetic workflow. No PR/merge/production release is needed for that action.
Cost is GitHub runner minutes plus container download/storage under the existing
account plan; no hosted DB or AI/provider usage and no new credentials. Current
quota was not queried. Local development remains possible while this is pending.
