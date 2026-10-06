# Stage 4 data/import contribution — ready for root reconciliation

Implementation worktree: `/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex`, branch `codex/workspace-audit-security`, baseline `d91be079c7beb0b6f21a4c5e6b451f90ca06e035`. No commit, merge, deployment, migration, production access/mutation, provider generation, or original-checkout edit by this agent. Root owns persistent ledger and final commits.

## Findings and disposition

- **VXA-001: implemented; bounded actual-function verification.** `lib/imports/document-text.ts:9,54,267` now caps compressed input at25MiB, selected DOCX text parts/PDF streams at8MiB each and32MiB cumulative,1000 parts/streams, and max(1MiB,200×compressed bytes) expansion allowance. Every inflate/inflateRaw invocation has zlib `maxOutputLength`; an expansion-limit error is fatal rather than falling through to model extraction. DOCX validates EOCD/directory/local header consistency, entry paths, duplicates, encryption/compression methods, and inflates only selected Word text XML. XLSX `lib/imports/spreadsheets.ts:238` retains5000 entries/16MiB declared entry/64MiB declared total/200 ratio controls, validates local/central consistency, and lazily inflates only consumed XML with8MiB per XML and64MiB cumulative actual caps. Forged declared1-byte XLSX/DOCX test records actual inflater maxOutputLength1 and no returned expanded buffer. Malformed ordinary streams can still yield no text under the existing PDF fallback; oversized streams reject. This is resource bounding, not proof that every PDF construct is correctly parsed or CPU-limited in production.
- **VXA-012: implemented; CSV and actual zipped XLSX verified.** `spreadsheets.ts:63` reserves original cleaned names before generated suffix allocation, globally tracks used identities, preserves reserved object keys with defineProperty, and supplies `columnSources` with original header/one-based column number. Amount,Amount,Amount(2) retains10/20/30 as Amount,Amount(3),Amount(2). Truncation/fallback/repeated-suffix/reserved-key cases retain all values. The original file is retained; no new UI was introduced for column lineage.
- **VXA-016: implemented; actual CSV verification.** `spreadsheets.ts:108` tracks physical record start line through blank records, leading blanks, CRLF/lone-CR and quoted multiline fields. `worksheetRowNumber` is explicitly physical start line for CSV. Quoted CRLF sample produces lines3,5,7. XLSX original row convention remains unchanged.
- **VXA-002: implemented screening and mandatory confirmation; real Auth/UI/provider end-to-end remains untested.** `lib/ai/evidence-index.ts:209` preserves signs, small numbers, currency/unit and fraction/percentage tokens, matches surrounding metric and period context, rejects unsupported numeric narrative and any unsupported fact instead of admitting one good fact. Source100/claim999, negative/positive, percent/fraction, currency mismatch, generic-label metric swap, wrong periods and reversed stated direction are rejected. Supported findings always return requiresReview:true (`:337`). `indexFileAnalysisEvidence` requires an explicit matching actor/run confirmation before any query/write (`:1065`); only existing user approval action supplies it (`files/actions.ts:2768`). Local extraction no longer exempts generated content. This is deliberately conservative lexical screening plus human confirmation, **not semantic proof**; valid paraphrases may require revised findings/reanalysis. Existing historical auto-learned rows are not deleted or reclassified. Synthetic actual-indexer write recording proves missing/mismatched confirmation and contradicted output make no writes, while a supported confirmed output reaches the memory upsert. Embeddings/provider and DB responses are synthetic; no live persistence claim.
- **VXA-015: implemented; actual helper fault injection.** `evidence-index.ts:668` throws sanitized unavailable error when file/run/note lifecycle lookup fails. It does not return normal[]. Empty successful evidence remains[]. Existing callers with catches can now distinguish partial/unavailable; direct awaiting consumers propagate failure. No raw DB message is exposed by this branch. Full browser fault presentation remains untested.
- **VXA-022: partial correction, keep concurrency/publication residual OPEN.** `evidence-index.ts:1148,1226` captures prior active IDs, then upserts and confirms every replacement chunk before retiring prior IDs. Identical retries explicitly reset archived/deleted flags and reuse hash identity. Both application archive-before-index calls were removed. Actual-function tests show failed replacement preserves previous rows byte-for-byte, successful replacement orders upsert then retirement, and identical retry leaves one active row. Residual: two concurrent approvals can both publish distinct active versions; same-content rows can have run metadata overwritten by a slower older approval. Prior-ID query also remains subject to default DB page limit after enough concurrent/failed generations, despite80 chunks/run. Full resolution requires per-file serialized atomic SQL publication with expected-generation/run-freshness validation, complete old-version selection, and DB concurrency/fault tests. No new database RPC/migration was invented in this narrow correction. Historical rows are archived, not physically deleted.
- **VXA-021: previously credible concern now narrowly VERIFIED and partially corrected.** New `scripts/audit-import-finalization.cjs --baseline` executes actual private saveWorkbookImport from git-show d91 with synthetic in-memory DB/indexing adapters. Failure at final row status/import completion/source completion produces success redirect in all3 baseline cases while1KPI persists. New `requireImportWrite` at `files/actions.ts:878` checks each final row and completion write; errors return a recoverable message, preserve accepted records, and attempt explicit failed status with acknowledged row counts (`:3865–3913`). Same3 cases now retain1KPI, recordfailed/rows_imported1, and emit error rather than success. Residual: this is not a transaction; failure of subsequent recovery updates, response loss, concurrent import retry, legacy single-sheet path, and per-worksheet structured/index writes still need SQL-backed idempotent state-machine/transaction tests. Do not mark whole VXA021 resolved.

## Files changed by this agent

- lib/imports/spreadsheets.ts
- lib/imports/document-text.ts
- lib/ai/evidence-index.ts
- app/app/files/actions.ts (review confirmation, remove pre-index archival, checked workbook finalization)
- scripts/audit-import-evidence-fixes.cjs (new)
- scripts/audit-import-finalization.cjs (new)
- scripts/audit-bounded-run.cjs (new)
- scripts/file-analysis-regression-tests.js (obsolete archive-before-index assertion replaced; behavioral coverage in new actual-function script)
- docs/security/audit-evidence/stage-4/components/* (copied stage3 harness/plan with sourceRoot updated; new outputs only)
- docs/security/audit-evidence/stage-4/data/* (raw regression evidence, component comparison, source hashes)

No package/CI/ledger edits by this agent. Root should register new scripts in test commands as appropriate.

## Tests and evidence

Runtime: `/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (v24.19.0). Workdir implementation worktree.

Commands (all executed, successful unless noted):

```
$NODE scripts/audit-import-evidence-fixes.cjs
$NODE scripts/audit-import-finalization.cjs --baseline
$NODE scripts/audit-import-finalization.cjs
$NODE scripts/audit-bounded-run.cjs audit-import-evidence-fixes.cjs /tmp/NEW-RESULT.json --limits
$NODE docs/security/audit-evidence/stage-4/components/run-components.cjs
$NODE scripts/spreadsheet-ingestion-regression-tests.js
$NODE scripts/platform-failure-evidence-regression-tests.js
$NODE scripts/file-analysis-regression-tests.js
$NODE scripts/source-upload-action-tests.js
$NODE scripts/lifecycle-consistency-regression-tests.js
git diff --check
```

The final default regression has23 named checks, including three memory replacement cases; one named numeric table covers11 adversarial claims. Earlier bounded `--limits` run had24 checks (20 primary+4large-limit checks) before the additional3 replacement checks; parser bytes unchanged since that run. Bounded output:909ms, sampled RSS307101696bytes,256MiB V8 heap,512MiB RSS watchdog/100ms,60s deadline. DOCX stopped before the fifth7MiB part after28MiB expanded; PDF bounded fifth stream to remaining4MiB and rejected; XLSX70MiB declared cumulative expansion rejected before inflation. No complete output allocation from the adversarial forged inputs.

Two expected development corrections preserved in context, not final failures: initial forged XLSX fixture lacked relationships and was rejected before lazy inflation, then fixture was corrected; old file-analysis suite asserted insecure archive-before-index and was updated to the new contract, then passed. One initial node command failed because shell PATH has no node; subsequent commands use absolute runtime. Supabase changelog markdown URL could not be rendered by web tool; no Supabase API/schema changes depended on it. Node zlib official options docs checked; runtime tests directly prove enforced bounds.

Persistent raw evidence: `docs/security/audit-evidence/stage-4/data/import-evidence-regression.json`, `bounded-expansion-regression.json`, `import-finalization-before.json`, `import-finalization-after.json`, `component-comparison.json`, `source-manifest.json`. Before/after import harness is actual function + synthetic adapter, not actual SQL.

## Bounded component replay

Same stage3 datasets,5 samples/import and3/source case;21 samples total. Sequential child256MiB heap, RSS512MiB external ps watchdog100ms,60s wall; CSV<=10MiB. All counts/checksums/IDs/current-value checks as applicable and deterministic result digests passed. Values are local component measurements, not user capacity. Small-sample p95/p99 equal maximum and are not tail guarantees. Source cases include root's new authoritative eligibility inputs.

| Dataset | Stage3 p50/p95 ms | Stage4 p50/p95 ms | Stage4 sampled RSS bytes | Child wall ms |
|---|---:|---:|---:|---:|
| CSV1k |3.815/6.328|4.6515/7.0930|160907264|397|
| CSV10k |32.242/36.803|35.1105/39.1622|206815232|617|
| CSV50k |142.485/170.488|184.0970/210.0503|340754432|1712|
|200files/2400KPIs|44.793/60.309|46.5110/62.4655|217874432|517|
|2000files/48000KPIs|960.382/1028.947|1044.2593/1112.8110|382484480|3672|

All remain inside predeclared5s import/10s source diagnostic budgets. CSV50k additional provenance/property allocation is slower in this local sample; do not advertise a speed improvement. Peak stays below512MiB. No HTTP/provider/DBload or full concurrent-user test was run; stage3 gaps remain.

## Independent VXA038 review requested by root

Read-only reviewed `lib/ai/usage.ts` and `scripts/audit-cost-regression.cjs`. Microcents arithmetic, preserved legacy-cent fallback, per-attempt rate/version stamping and overwrite of caller-provided cost_estimate are coherent. Official Luna/Terra/Sol pages independently confirm current20/120,200/1200,400/2000 cents/M and >272k full-request2xinput/1.5xoutput. No blocking issue found. Scope must remain standard uncached text estimate; excludes cache-write surcharges as well as discounts, tools, service tier, region and unreported attempts. Missing provider-attempt token counts become0, so this is not invoice-grade completeness. No code/test edits for cost review.
