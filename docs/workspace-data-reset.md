# Workspace Data Reset

## Safety status

This capability is implemented but must remain unavailable until
`202607120001_workspace_data_reset.sql` is applied and validated in a
non-production Supabase environment. The application has no fallback path when
the migration is absent. Never use the staging harness with production keys or
the production project reference.

## Architecture

The reset is split into three deliberate boundaries:

1. `begin_workspace_data_reset` authenticates the caller, verifies owner/admin
   membership, checks recent authentication and exact confirmations, acquires a
   workspace advisory transaction lock, and creates an idempotent operation.
2. Server-only code enumerates only `workspace-files/<workspace-id>/...` through
   the Supabase Storage API and stores an exact object manifest.
3. `reset_workspace_data` copies recoverable rows into a private RLS-protected
   recovery table, removes business rows in dependency order, and clears only
   business-specific workspace context. Permanent storage purge then runs
   through the Storage API and is independently verified.

No reset SQL reads or writes `storage.objects`. Service-role use is limited to
exact-prefix manifesting, deterministic Storage API deletion, purge state, and
retention cleanup. User authorization is still performed before any service
operation.

The migration also hardens the existing private Storage RLS policies. Direct
authenticated uploads are denied during manifesting, database reset, and
restore. Manifested retained objects are quarantined by exact object path;
new files created after a recoverable reset remain usable and are not confused
with the retained snapshot. Application uploads perform the same capability
check before and after the Storage API call and remove an uploaded object if its
metadata transaction cannot be committed.

## Modes

### Recoverable for 30 days

- Business rows are copied transactionally into
  `workspace_reset_record_backups`, then removed from active tables.
- Private objects remain in their existing private paths and are recorded as
  retained until the deadline.
- Restore is available to an owner/admin after password reauthentication.
- Restore is refused if any new business content exists, preventing an old
  snapshot from being merged into a newer workspace state.
- After expiry, the daily scheduled purge removes exact-manifest objects through the
  Storage API, verifies absence, removes recovery rows and exact paths, and
  scrubs recovery-only workspace context before retaining only the operation/audit summary.

Recovery is transactional for the database rows covered by the explicit table
inventory. It is not a general point-in-time database backup. Changes to the
schema during the retention window can make row restoration incompatible and
must be evaluated before deploying later migrations.

### Permanently delete now

- No business-row recovery copy is created.
- The database reset completes first so deleted business content immediately
  leaves every active product surface.
- Exact-manifest objects are removed through the Storage API and absence is
  verified.
- Any storage or finalization failure leaves a `partial` operation and the
  original manifest available for an idempotent retry.
- Successful finalization atomically removes recovery rows, exact object paths,
  and recovery-only workspace context from the database ledger.
- Successful completion cannot be restored.

Database-first is intentional for permanent mode. A storage-first design could
destroy the only file copy and then roll back the database transaction. The
chosen order can temporarily leave inaccessible private objects after a partial
failure, but it never presents those objects as active business evidence and it
retains the exact retry manifest.

Interactive manifests are capped at 10,000 objects. Each purge invocation
processes at most 2,000 manifest rows in Storage API batches of 500; remaining
rows keep the operation in a visible, retryable `partial` state and the daily
worker continues deterministically. Larger workspaces require a controlled
support runbook rather than a long interactive request.

The database RPC similarly refuses an interactive reset above 100,000 explicit
workspace business rows. The transaction rolls back and the pre-reset manifest
is minimized; larger datasets require a separately reviewed support runbook.
Permanent reset also stops before database deletion when the operation or any
manifested source object is under legal hold.

## Reset inventory

The migration explicitly resets:

- `record_folders` except support-request folders
- `file_uploads`, `file_imports`, `file_import_rows`, `file_processing_jobs`
- `business_memory_chunks`, `business_health_snapshots`
- `crm_leads`, `crm_lead_history`, `operational_metrics`
- `business_intakes`, `workflow_maps`
- `forms`, `form_submissions`, `checklists`, `checklist_runs`
- `tasks`, `kpis`, `kpi_settings`, `issues`, `assets`, `asset_checks`, `people`, `sops`
- `reports`, `ai_agent_runs`, `notifications`, `record_shares`, `operational_assignments`
- `business_decisions`, `vaeroex_recommendation_outcomes`
- `kpi_alert_rules`, `kpi_alert_events`
- `report_subscription_preferences`, `scheduled_report_runs`

The workspace `industry` and `size` fields are cleared. Workspace identity and
billing fields are not changed.

## Preserved inventory

The reset intentionally preserves:

- Supabase Auth users and `profiles`
- `workspaces` and `workspace_members`
- `legal_acceptances`
- `security_audit_events` and `audit_logs`
- `ai_usage` accounting telemetry
- `customer_subscriptions`, `subscription_events`, and `subscription_plans`
- `support_requests` and support-request folders
- `manual_activation_requests`
- `request_rate_limits`
- the reset operation and its minimal retained audit summary

Retention of support records, security records, billing events, AI accounting,
and legal acceptances is conservative. Legal counsel and the data-retention
policy should determine their final production retention periods. They are not
silently deleted by a business-data reset.

## Normal source deletion

`update_source_file_lifecycle` now sets `purge_after` to 30 days for a soft
delete and immediately excludes the file and linked memory chunks. Restore
clears the deletion and purge deadline unless the object was already purged.
The daily purge skips legal holds, validates the exact workspace prefix, uses
Storage API removal, verifies object absence, records `purged_at`, and emits a
security audit event. Before Storage deletion, a service-role-only RPC acquires
the same workspace advisory lock used by reset preparation and claims the file.
This prevents a scheduled source purge from racing a workspace reset. After
object absence is verified, a second service-role-only RPC atomically records
the file purge and its retained operational/security audit entries.

The source row remains as an excluded lifecycle/audit record after object purge.
It is not returned by active file, memory, search, Ask, Intelligence, or
Business Health paths. A future retention-policy pass may minimize old source
metadata further after legal requirements are finalized.

## Guided setup

Guided setup starts only after reset. The user may leave without creating any
record. Completing the wizard creates one `business_intakes` row classified as
`setup_bootstrap`; it creates no sample KPIs, signals, reports, CRM rows, files,
or health snapshots. Existing evidence-lineage rules keep setup context from
counting as original evidence.

Blank mode creates nothing and leaves Business Health unavailable until
eligible original evidence exists.

## Staging requirements

Use a separate disposable Supabase project or branch with Auth and the private
`workspace-files` bucket configured like production. Configure these variables
only in the local shell used for staging validation:

```text
VAEROEX_STAGING_CONFIRM=RUN_WORKSPACE_RESET_STAGING
VAEROEX_STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
VAEROEX_STAGING_SERVICE_ROLE_KEY=<staging-only-service-role>
VAEROEX_STAGING_PUBLISHABLE_KEY=<staging-publishable-key>
VAEROEX_STAGING_PROJECT_REF=<staging-ref>
VAEROEX_PRODUCTION_PROJECT_REF=<production-ref>
```

The harness derives the connected project reference from the URL and refuses
to run unless staging and production references are both present and different.
If standard production Supabase URL or service-role variables are present in
the same shell, the harness also refuses credentials that match them.
It creates disposable users, two isolated workspaces, one record in every
resettable table, representative preserved records, and private storage objects.
It validates authorization, idempotency, concurrency, recoverable reset,
restore, permanent reset, and cross-workspace isolation, then removes fixtures.

After applying all migrations through `202607120001` to staging, run:

```bash
pnpm test:workspace-reset:staging
```

Do not run this command with production credentials.

## Deployment order

1. Back up the production database and confirm Supabase Storage backups/retention.
2. Apply and validate the migration in staging.
3. Run the full regression suite and staging harness.
4. Review Security Advisor output, RLS policies, function grants, cron limits,
   and exact storage-prefix behavior.
5. Apply the migration to production during a controlled maintenance window.
6. Verify tables, RLS, grants, functions, indexes, and the private bucket without
   running a reset.
7. Deploy application code and the authenticated daily purge route.
8. Confirm Settings shows the control only to owners/admins and that regular
   file lifecycle operations still work.
9. Perform the first real reset only with a separately approved runbook,
   verified backups, exact workspace inventory, and a named recovery owner.

Migration-first is required for a functional deployment. Code deployed before
the migration fails closed: Settings reports the capability unavailable and
crafted server-action calls cannot reach missing RPCs, but the purge cron would
return an error until the schema exists.

## Rollback

Before any reset executes, application rollback is a normal code rollback and
the additive tables/functions may remain unused. Reverting the migration should
be done only through a separately reviewed migration after confirming there are
no operations or recovery rows.

After a recoverable reset, use the controlled restore action before `purge_after`
and only while the workspace remains blank. After successful permanent purge or
expired recoverable purge, application rollback cannot restore business data or
objects; recovery would require an independently verified infrastructure backup.
