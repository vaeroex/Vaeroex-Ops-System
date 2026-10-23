# Remaining qualification contracts

Local source inventory only. No database queries, metadata retries, credentials,
runtime changes, publication or live tests were performed for this review.
“Audited” below means an exact body exists in the previously captured audit;
it does not certify the complete deployed dependency graph or current parity.

## Available and missing definitions

| Contract family | Exact audited bodies available | Repository-only or missing qualification |
| --- | --- | --- |
| Session and owner | `private.require_live_actor_session_v1`, `private.square_production_customer_require_owner_v1`, `private.qbo_customer_require_owner_v1` | Generic live-session helper is service-only. Square owner helper is the role-neutral helper used after JWT binding. Full caller/writer lock composition remains unqualified. |
| Privacy and tickets | `private.google_sheets_checked_ticket_v1`, `google_sheets_privacy_open_v1`, `google_sheets_privacy_lock_v1`, `google_sheets_ticket_actor_v1`, `google_sheets_derivative_write_v1`, `google_sheets_erasure_cascade_guard_v1`; `public.get_google_sheets_read_context_v1` | `public.bind_google_sheets_read_v1`, `public.google_sheets_record_readable_v1`, `private.google_sheets_exact_delete_allowed_v1`, `private.google_sheets_file_metadata_without_analysis_v1` have repository definitions in `supabase/migrations/20261012191836_google_sheets_restricted_erasure_retention.sql`, but no exact bodies in these audits. `private.google_sheets_unmaterialized_file_v1` is called by audited bodies but has no definition in the checked repository SQL or audit. |
| Artifact completion | `public.complete_trusted_derived_run_v1`, `public.fail_trusted_derived_run_v1`, `private.guard_trusted_derived_run_transition_v1`, `public.vsi_mutate_v1`, `public.vsi_mutate_v2`, `private.vsi_mutate_before_sheets_privacy_v1` | Full table/constraint/grant/RLS inventory for trusted commits, tickets, derivation roots and artifact/accounting tables is not captured. Draft wrappers and synthetic fixture tables are not deployed parity. `private.workspace_billing_entitled_v1` is repository-only (`20261005022017_workspace_security_boundaries.sql`). |
| QBO reads | `public.qbo_customer_source_browse_v1`, `public.read_qbo_customer_accounting_authority_v1`, `private.qbo_customer_preview_v1` plus owner helper above | Source-version commit, validation completion/quarantine/current-pointer promotion, connection generation and mapping writers are repository-only; see production migrations below. |
| Square reads | `public.square_customer_payments_v1` plus owner helper above | `public.square_customer_backend_v1` and its context/configuration/payment writer dependencies are repository-only. Read-body audit does not establish writer parity. |
| Files and notes | `public.assert_document_extraction_authority_v1`, `document_extraction_authority_is_approved_v1`, `resolve_document_extraction_file_authority_v1`, `get_worksheet_publication_heads_v1`, `match_business_memory_chunks`, `protect_business_note_evidence_boundaries`, `protect_business_note_lifecycle_provenance_v1` | `public.document_extraction_google_job_identity_is_exact_v1` is repository-only (`20260805163333_google_document_ai_enterprise_ocr_v1.sql`); `public.is_workspace_member` is repository-only (`202606170001_phase_1_schema_rls.sql`). File review/publication and note/chunk writes need their complete trigger graph, not only reader/guard bodies. |

Sources: [deployed-contracts.json](audit/deployed-contracts.json),
[typed-source-contracts.json](audit/typed-source-contracts.json). The frozen
[CI manifest](ci/manifest.json) verifies available source hashes; it is deliberately
incomplete and is not an installable full overlay.

Four trigger functions are explicitly named by the audited artifact/entity trigger
inventory but lack audited bodies:

- `private.enforce_workspace_persisted_limit_v1`: repository definition in
  `supabase/migrations/20261005022445_workspace_persisted_usage_limits.sql`.
- `private.guard_workspace_mutation_entitlement_v1`: repository definition in
  `supabase/migrations/20261005022017_workspace_security_boundaries.sql`.
- `private.protect_business_entity_identity_v1`: repository definition in
  `supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql`.
- `private.reject_explicit_regulated_business_text_v1`: no definition found in
  checked repository SQL or either audit capture.

This is a direct-dependency inventory, not an assertion that these are the only
missing transitive functions. A complete reviewed installation order, trigger
inventory and privilege map are still required.

## Denied Sheets verification and provider handoff

The read-only metadata lookup for
`public.read_google_sheets_operational_conflicts_v1` and
`private.guard_google_sheets_kpi_authority_v1` was **denied**, did not execute,
and was not retried. Their repository definitions are in
`supabase/migrations/20261002040024_google_sheets_complete.sql`; deployed equality
remains unverified. Draft08 also relies on the repository-only
`private.google_sheets_operational_source_current_v1` and record-readability
predicate. Do not substitute repository code for the denied live comparison.
See the exact denial record in [QUALIFICATION.md](QUALIFICATION.md#new-denied-read-only-metadata-operation).

`lib/ai/providers/google-data-policy.ts` rechecks the server-created ticket before
transport, denies unattributed derived evidence, restricts Sheets data to OpenAI,
and requires the verified project/organization configuration. The offline bridge
tests replace that provider boundary; they do not verify its deployment or project
controls. Before activation, qualify mixed-source classification, inherited ticket
roots, provider retries/fallbacks, minimization and revocation through the actual
policy path. Never use an empty/refreshed ticket to evade a failed classification;
do not inspect credentials as part of this handoff. Source-writer freshness and
provider destination policy are separate checks.

## Writer families and observed lock order

| Sources | Repository writer boundary to qualify | Reader/final-validation gap |
| --- | --- | --- |
| Xero, Harvest, Clockify | `public.apply_reporting_history` takes connection `FOR UPDATE`, then mutates facts/coverage (`20261019070945_reporting_import_history.sql`). | Draft01 reads facts, coverage and binding by hash without locking those source rows until output commit. Date moves, zero/void replacements and newly inserted rows require coverage, not just existing-row locks. |
| Toggl, Zoho Inventory, Katana | `apply_reporting_snapshot` updates the connection; `select_reporting_account` and `save_reporting_refresh` lock connection then credentials (`20261019033506_reporting_supported_jwt_role.sql`). | Snapshot replacement and account identity changes race with plain readers. Katana draft09 adds a nonce and terminal installation lifecycle, but no final-save interlock. Its metadata-only backfill requires quiescent rollout qualification. |
| Loyverse | `apply_loyverse_receipts` locks connection then receipt facts/coverage; disconnect updates connection before deleting credentials/facts/coverage (`20261019070953_loyverse_import_history.sql`). | Equal-ID edits, cancellation, coverage replacement and disconnect must invalidate/serialize. No verified merchant currency is supplied by current shared projection. |
| Zoho Books | `apply_zoho_books_history` locks connection then invoice/expense history and coverage (`20261019070949_zoho_books_import_history.sql`). | Date/status/currency changes, voided invoices and coverage writes must participate. |
| Wix Orders | `apply_wix_order_snapshot` locks connection then orders/coverage; disconnect updates connection then deletes dependent state (`20261019071008_wix_orders_import_history.sql`). | Equal-timestamp amount/status edits and timestamp-date movement must participate. |
| QBO | `commit_provider_external_source_record_version_v1`, `complete_qbo_production_source_validation_v1`, `assert_qbo_production_source_promotable_v1`, related promotion/validation guards in `supabase/production-migrations/20260930004000_qbo_production_source_validation.sql`. Validation completion locks work row, then connection/mapping `FOR SHARE`, then canonical source `FOR UPDATE`. | Draft06 checks current pointer, valid version, mapping/generation and validation work through plain reads. Do not introduce source-before-work/connection locking without qualifying every writer path. |
| Square | `public.square_customer_backend_v1` in `supabase/production-migrations/20260929041048_square_customer_payment_history.sql`: configuration share, connection update lock, owner/session checks for relevant operations, then payment upserts/connection progress. | Draft06 reads current connection/payment state and hashes equal-timestamp changes, but does not hold a shared writer interlock through completion. |
| Files, worksheets, notes | `app/app/files/actions.ts` uses file/chunk writes, `begin_file_import_attempt_v1`, `reconcile_file_import_attempt_v1`, `update_source_file_lifecycle`; `app/app/sources/business-notes/actions.ts` writes approval/version and chunks. Worksheet head reader is in `20261005070311_worksheet_import_publication_heads.sql`. | These are multiple writes/transactions plus lifecycle triggers. Test publication-head change, review revocation, parent-run invalidation, note reapproval/version and chunk replacement; a semantic receipt is valid only for unchanged authority and does not itself serialize writers. |

Paths in the table are repository evidence, not proof of live writer bodies.
The nine legacy reader branches are fixed in draft01
`legacy_evidence_originals_v1`/`resolve_legacy_evidence_v1`; typed branches are in
draft06 and draft08. Draft05 `validate_shared_evidence_manifest_v1` re-resolves
sources in ordinal order, then wrappers delegate to existing completion paths.

**Lock-order correction:** an initial review hypothesis that old brief completion
locked the run before privacy was wrong. The complete audited bodies of both
`complete_trusted_derived_run_v1` and `fail_trusted_derived_run_v1` take live-session
share locks, then checked-ticket/privacy advisory lock, then run `FOR UPDATE`.
Draft05 also takes privacy before target run. No old/new brief inversion was
established. Still test competing old/new completion, because denial must preserve
rollback and accounting.

Confirmed VSI order is live actor/session check, privacy lock, actor advisory,
workspace advisory, conversation update lock, request update lock, then settlement
and once-only cost event. Preserve it. The legacy lifecycle writer takes a
connection row lock before its binding advisory lock; owner mapping takes that
advisory lock before a plain connection read. Adding a connection row lock after
that advisory lock would create an inversion with the existing writer. Draft09
explicitly avoids credential-to-connection locking. These are constraints for a
new interlock design, not claims that a deadlock was reproduced.

## Minimal next race groups

Use real independent transactions and deterministic barriers; parameterize the
shared groups across all providers rather than treating one connector as proof
for twelve. For each relevant mutation, exercise writer-commit-before-validation
and writer-between-final-validation-and-artifact-commit.

1. Legacy history/coverage (Xero, Harvest, Clockify, Loyverse, Zoho Books, Wix):
   update, insert/phantom, date move, delete/void and coverage-only change.
2. Snapshot/installation (Toggl, Zoho Inventory, Katana): snapshot/account change,
   nonce rotation, reconnect rejection, credential/connection cascade; test the
   nonce backfill separately as rollout behavior.
3. Typed monetary sources: QBO quarantine/current-version/mapping/generation;
   Square equal-timestamp payment replacement, state/generation and disconnect.
4. Sheets: accepted-link/version/mapping replacement, source/KPI privacy,
   operational overlap insertion and epoch change. Live parity remains denied.
5. File/note evidence: review/head/parent-run changes, approval/version/chunk
   replacement; semantic receipt before/after source change.
6. Common authority and artifacts: demotion/session/entity/binding revocation,
   saved-copy ancestor deletion, simultaneous same-attempt settle, old-wrapper
   bypass attempt, completion-versus-failure and rollback after claim insertion.

Success requires a documented serial order or fail-closed retry, no stale saved
output, audience widening, duplicate cost event or deadlock. Probes that expose
missing serialization are diagnostics, not qualification passes. The existing
three-session CI foundation stays narrower and must not be relabeled full parity.

## Business comparisons supported and blocked

The smallest implemented cross-plugin contract is
`lib/ai/shared-evidence/financial-boundaries.ts`: admitted Xero/Zoho invoice and
Wix order observations with the same protected entity, currency and **stored date
label** establish only a non-additivity boundary. Invoice time zone, matched
transaction, same business day, complete coverage, shortfall and causation remain
explicitly unproven. Both saved source dependencies must remain inspectable.

Current shared reads can also support individual qualified observations and
separate reviewed-file/note context. They cannot establish numeric productivity,
waste, cash/revenue reconciliation, inventory turnover or causes:

- `relationships.ts` has pure `payment_per_tracked_hour` and `waste_share`
  prototypes, but requires complete same-scope, same-period/time-zone, active,
  versioned evidence. Runtime coverage is unknown/partial; Harvest is permission
  visible, Clockify is connected-user scope, and neither establishes payroll.
- Square shared values are explicit minor units; no generic currency exponent or
  complete payment total is established. QBO accounting and payments/invoices/
  orders are different stages and cannot be added.
- Files/notes have no trusted entity correspondence or measured numeric contract;
  reported text cannot supply the waste denominator or a causal explanation.
- Toggl lifetime projects and current inventory/stock snapshots do not establish
  comparable historical period totals; Loyverse currency remains unavailable.

Do not manufacture missing mappings, coverage, units or sandbox records to expand
that result. Full business-comparison qualification requires additional explicit
semantic contracts independently of the database race work.
