# Stage 4 narrow form-parent and entitlement cross-review

Recorded 2026-10-05. Implementation worktree `/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex`; baseline `d91be079c7beb0b6f21a4c5e6b451f90ca06e035`. No live requests, production data, migrations, or independent security migration edits.

## VXA-005 form-parent extension verified

Harness `/tmp/vaeroex-form-parent-proof.cjs`, result `/tmp/vaeroex-form-parent-proof.json`. Run with `/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --max-old-space-size=512 /tmp/vaeroex-form-parent-proof.cjs`.

All 8 actual selected-DDL/policy assertions passed in isolated in-memory PGlite (0.75s shell wall time):

1. Synthetic staff A cannot SELECT private form B (0 rows).
2. Same-workspace submission persists.
3. `form_submissions(workspace_id=A, form_id=B)` persists despite invisible private B parent.
4. Inserting directly into workspace B fails `42501`.
5. Viewer A submission fails `42501`.
6. `pg_get_constraintdef` confirms `FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE`.
7. Fixture-owner deletion of B parent cascades into A submission.
8. Same-workspace control submission remains.

Source: `202606170001_phase_1_schema_rls.sql:120–152,535–557`; `20260819174100_security_high_findings_remediation.sql:7–26,99–131,319`. Neither baseline source was modified in the implementation worktree. Result includes SHA-256 for both. Actual functions and dynamic policy templates are extracted, not reimplemented; fixture supplies synthetic authenticated grants and JWT GUC. This proves the SQL boundary defect, not hosted Auth/PostgREST behavior or contents disclosure. A foreign parent UUID is assumed known. New entitlement migration is not applied by this baseline-only proof; entitlement does not bind the parent.

Security agent accepted extension under existing VXA-005: unique `forms(workspace_id,id)`, composite `form_submissions(workspace_id,form_id)` FK `NOT VALID`, remove original single-column FK, retain old mismatches, block new/changed mismatches, and native PostgreSQL before/after/history tests. This subagent did not edit the migration.

## Read-only entitlement review

Regular-member Stripe/manual/demo/trial branches align between `lib/billing/get-subscription-status.ts:153–195` and `20261005022017_workspace_security_boundaries.sql:7–27`. Linked Stripe denial precedes other fallbacks.

Billing and setup use `createSupabaseAdminClient` with service credential (`lib/supabase/admin.ts`), and signed-agreement-v2 is service-only (`20260820053955_customer_1_billing_entitlement_remediation.sql:781–790`). `app/app/setup/actions.ts:60–123` invokes this service RPC; original JWT-role trigger correctly skips its create-first-membership/link-later writes. Subscription and checkout recovery tables are excluded. Existing native tests cover service bootstrap and billing writes, not full signed-agreement provider flow.

Private connection lifecycle transition writes connection and freshness UPDATE plus private audit INSERT (`20260827033058_qbo_production_convergence.sql:3455–3560`). The new private guards apply to INSERT of connection/OAuth/reauthorization records, so no disconnect recovery block was found statically. This is a scoped call-graph review, not real OAuth/provider verification.

Material alignment issue sent to root/security: `getSubscriptionStatus.ts:114` returns allowed/manual_review/null entitlement for configured Vaeroex-admin emails. `setup/actions.ts:105–112` consequently creates an admin workspace with required=true/manual_review/no entitlement. New database entitlement has no equivalent exemption, so bootstrap succeeds via service but ordinary authenticated operational mutations then fail for that admin member. Existing service-bootstrap test does not cover subsequent admin-bypass workspace usage. Root/security should align this intentionally; do not infer a safe DB admin bypass from user-controlled email or replicate arbitrary client data. No change made by this review.
