# Bounded qualification closure package

This local candidate connects the actual draft12 workspace fence to an executable
native CI step. It is prepared for review, not published or run. The earlier
foundation-only CI success on `4245e655` does not cover these changes. Runtime
remains false; no production schema, provider, or settings changes are included.

## Exact executable workflow

`.github/workflows/shared-evidence-qualification.yml` remains push-only on
`codex/shared-evidence-security-draft`, with read-only repository permissions,
no persisted checkout credentials, no production credentials, no PR/dispatch,
no Vercel deployment, and a 30-minute job limit. Its offline checks cover the
adapter, consumer, relationship, SQL, owner-mapping UI, and fence helpers plus
TypeScript. It preserves the original foundation native step and then runs:

```sh
env -u SUPABASE_INTERNAL_IMAGE_REGISTRY node scripts/shared-evidence-writer-qualification.cjs --fence
```

The existing owned-container helper creates an isolated empty database from the
pinned local Supabase image. It accepts neither a remote URL nor credentials.
Three independent PostgreSQL sessions execute the native scenarios. Container
and local Supabase cleanup run on success or failure. No AI/provider calls occur.
The older `--source-write-probes` diagnostic mode remains available but is not the
workflow's fence qualification step.

## What the new runner actually checks

* Installs draft12 unchanged, including all 64 explicit relation fences. Checks
  all 128 trigger definitions: table, function, event mask, enabled state and
  workspace-key arguments. A writer against each relation must fail with40001
  while final completion holds the workspace fence.
* For each of twelve providers, creates separate VSI and brief manifests using
  that provider's own evidence identity and roots. An actual source DML statement
  held uncommitted must make final completion fail closed.
* Pauses the real completion path after final validation and before output at a
  test-only commit-claim trigger. The observer requires the exact advisory lock
  key and controller backend PID. It never treats a generic wait as proof.
  Source DML must fail with40001 in that window; a real other-workspace connection
  update must succeed. No saved output may exist before the barrier is released.
* A competing same-attempt completion must fail while the first is uncommitted.
  The committed result has one saved manifest and, for VSI, one cost event.
* Reopens each exact saved revision. Committing its source mutation must then
  invalidate both saved consumers and reject a fresh pending stale completion.
  Failure settlement called twice must leave failed status, no answer or saved
  artifact, cost0.03 and exactly one cost event.
* Rolls back actual VSI and brief completion transactions and requires zero
  output-manifest links, commit claims and VSI cost events.

The twelve direct synthetic source mutations cover Harvest, Xero, Clockify,
Toggl, Zoho Inventory, Katana, Loyverse, Zoho Books, Wix, Square, QuickBooks and
Google Sheets. These are stored-record DML probes, not deployed ingestion RPCs.
The driver emits `releaseQualified:false`, `fullComposition:'unavailable'`, and
`ingestionWriters:'not_exercised'` even if all bounded assertions pass.

## Explicit fixture limits

The fixture reuses the audited definitions and existing SQL suite. Some ticket,
entitlement, readability and document-authority helpers remain synthetic. It
creates minimal workspace/id tables for exactly these 16 missing relations:

```
private.file_import_attempts
private.google_sheets_connection_root_links
private.google_sheets_derivation_roots
private.google_sheets_retention_roots
private.google_sheets_source_root_links
public.business_health_snapshots
public.intelligence_card_lifecycle
public.intelligence_card_lifecycle_events
public.file_processing_jobs
public.kpi_settings
public.document_extraction_cache
public.document_extraction_file_bindings
public.document_extraction_jobs
public.document_extraction_reviews
public.document_extraction_workspace_settings
public.file_imports
```

This frozen allowlist fails if an additional placeholder is needed. Testing the
actual fence trigger on a placeholder proves that trigger's conflict behavior;
it does not establish the relation's full production constraints, RLS, other
triggers or writer behavior. Hash manifests freeze the input SQL, fixtures,
driver, workflow and tests. PGlite executes the native SQL helpers sequentially
and injected-contention scenarios locally; it cannot establish native races.

## Application work included in this unpublished candidate

The prior owner-mapping UI is wired to the reviewed mapping RPC behind the false
runtime gate. It requires explicit owner selection and confirmation of an
existing canonical entity and exact connection incarnation. No label matching
or automatic backfill occurs. The fence draft also serializes mapping and final
validation; neither SQL nor UI has been activated.

Shared readers cover twelve source observations. The implemented relationship
is qualified invoice/order non-additivity with matching entity, period labels
and currency. It does not prove matched transactions, complete payment/labor
coverage, common business-day boundaries or causation. Processed files and
approved notes remain contextual evidence, not invented numeric denominators.

## Remaining release blockers and bounded next actions

1. **Run the prepared native workflow only after scoped publication approval.**
   No local native PostgreSQL/Docker runtime is available. The new native runner
   is unexecuted; offline helper success is not a concurrency pass. The proposed
   run consumes GitHub minutes and pinned dependency/image downloads only.
2. **Close the deployed metadata graph.** The exact relation, guard and writer
   metadata request is in `BLOCKED-EVIDENCE-HANDOFF.md`. Twenty-seven audited
   bodies are reusable; missing installed definitions cannot be replaced by
   guesses. The expanded metadata approval remains pending. Do not retry the
   denied Sheets definition or Vercel route. Full deployed trigger composition,
   installed ingestion writers and their retry/lock order remain unqualified.
3. **Verify provider configuration with safe statuses.** An authorized owner
   must confirm the dedicated Sheets destination/key configuration and intended
   provider data controls without disclosing secrets. Mocked policy tests do not
   attest deployed settings or Zero Data Retention.
4. **After the evidence is complete, review one exact release.** Qualify the
   full dependency graph, writer contention/retry behavior, source lifecycle and
   provider policy before proposing schema/application activation. Historical
   owner/private-source impact and rollback remain part of that review. Native
   fence success alone is insufficient. Only a separately authorized bounded
   live VSI and brief check can establish current model output quality.

No new seats, fixed plugin cap, demo work, imports, OAuth, live database access,
publication, workflow run or deployment is authorized by this local package.
