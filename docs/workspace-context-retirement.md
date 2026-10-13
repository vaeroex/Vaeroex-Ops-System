# Workspace context feature retirement — PR #495

This customer-authorized change retires Decision journal / Log Decision, metadata-only Share / Distribute, and the remaining assignment interface. Business Notes remains the customer workflow for business context and decisions. No replacement task, reminder, decision-management or sharing feature is introduced.

## Removed product paths

- Intelligence review-context section and both component modules.
- Dedicated decision and share server-action modules, including their insert paths. No other application module depends on these actions.
- Performance share recipient form, Shares metadata, and people/share-only reads and errors. KPI details, edits, targets, comparisons, folders and unrelated exports remain.
- Global-search assignment and decision providers and Review Signals result group. The command palette uses this same search. Exact retired source identities are filtered from derived-memory candidates and stale responses; ordinary Business Notes/files/KPIs/Saved Analyses are preserved even when their text mentions decisions or sharing.
- Search fetches and successful search responses use no-store. Search directly queries workspace-scoped tables, with no separate persisted search-result cache or external search index to rebuild. Current production has no memory chunks with decision/assignment/share source types. Historical database indexes and rows are retained, not purged.

Legacy `/app?view=Intelligence%20View#decision-journal`, `#leadership-decisions`, and Operations View URLs still pass the existing workspace/subscription guard and reach the current Intelligence landing. Obsolete query/hash values cannot reopen deleted components. KPI records links still open normal KPI management without metadata-sharing controls. Deleted action exports are absent from new builds; no compatibility writer remains. This PR does not claim to revoke direct Data API table grants: historical table access policies and schema remain unchanged, while the obsolete application endpoints are removed.

## Production inventory (read-only aggregate check, October 13, 2026 UTC)

Project: `mdiianhfrojmxqpwrflh`. No titles, contents, customer names or identifiers were retrieved. No customer rows were changed.

| Historical table | Rows | Workspaces | Nondeleted | Relevant findings |
| --- | ---: | ---: | ---: | --- |
| business_decisions | 6 | 1 | 6 | All six belong to a legacy demo workspace using the existing demo predicate. None archived. All contain reason, expected outcome and outcome summary; all retain creator references. Created April 5–May 8, 2026. No related report/issue/SOP foreign-key values. |
| record_shares | 3 | 1 | 3 | All source_type=report; zero KPI share records. |
| operational_assignments | 7 | 2 | 7 | Retain all historical rows. |

No dependent views or incoming foreign keys were found. Outgoing workspace/creator/person/related-record foreign keys, entitlement-audit and updated-at triggers remain. Decision records also retain the Google Sheets erasure cascade guard. Private `google_sheets_allowed_source_v1` and `google_sheets_erasure_table_v1` reference the tables; preserve these integration/retention dependencies.

Existing decision reads in Intelligence coverage, workspace-health loading and Briefing context remain where they feed established coverage/read-authority behavior. This intentionally preserves current business calculations and integration erasure safeguards; it does not expose a customer journal, search result, or creation endpoint. Generated database types and historical migrations remain unchanged.

## Business Notes migration proposal — not implemented

Current eligible non-demo decision count is **zero**. Do not duplicate the six demo decisions into customer Business Notes. Keep them in historical tables.

If a later approved inventory identifies real customer decisions to migrate, use a separately reviewed, idempotent per-workspace migration with a unique source-table/source-row mapping. Preserve workspace_id and original author attribution (subject to existing membership rules), original created/updated timestamps in provenance, and the original creation date as the note observation date. Copy the title plus complete reason, expected outcome, related KPI/record references, responsible leader, review date, status and outcome summary as labeled text. Preserve original content and dates rather than treating the migration date as observation time. Respect the note length bound: partition deterministically only after review, with stable part identifiers; never truncate silently. Preserve lifecycle/deletion state and mark imported notes for the normal evidence review/approval process. Do not automatically approve evidence, run paid extraction, alter original decisions or change quotas. Dry-run counts, workspace ownership checks, transactional writes and unique provenance constraints must prevent duplicates and allow reconciliation before any separately approved execution.

## Verification and release boundary

Focused tests exercise actual search GET with synthetic current/retired sources, cross-workspace scoping and auth/subscription denial; stale-response filtering; absence of obsolete modules/controls; legacy authorized redirects; preserved KPI helpers, seven mutation forms, Business Notes and rendered workspace states. Desktop/mobile preview uses fictional data and has no persistent write endpoints.

No migration, table deletion, production deployment or data-copy operation is included. Main auto-deployment remains held. Stop for preview review.
