# Staging Lifecycle Test Plan

## Recommended strategy

Use a dedicated Supabase staging project or Supabase Database Branch paired with a Vercel Preview environment. Do not point a Vercel Preview deployment at production Supabase.

This repository has migrations and a seed file but no `supabase/config.toml`, local Docker setup, or configured staging project. A managed Supabase branch is preferred when available; otherwise create a separate staging project.

## Preview environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` set to the staging/preview URL
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, and `VAEROEX_MAX_EVIDENCE_CHUNKS` when Ask/retrieval is tested
- `CRON_SECRET`
- staging-only `VAEROEX_ADMIN_EMAILS`
- Resend and Stripe test-mode variables only if those flows are included

Never reuse production service-role, OpenAI, Resend, or Stripe live keys in staging.

Add these Supabase Auth redirect URLs:

- `https://<staging-host>/auth/callback`
- `https://<staging-host>/reset-password`

The `workspace-files` bucket must remain private and retain the workspace-scoped policies from `202606180004_files_imports.sql`.

## Migration preflight

Confirm the project name and reference are not production. Record migration state and prior function definitions:

```sql
select version from supabase_migrations.schema_migrations order by version;
select to_regprocedure('public.update_business_signal_lifecycle(uuid,uuid,text)');
select to_regprocedure('public.update_source_file_lifecycle(uuid,uuid,text)');
select pg_get_functiondef('public.update_business_signal_lifecycle(uuid,uuid,text)'::regprocedure);
select pg_get_functiondef('public.update_source_file_lifecycle(uuid,uuid,text)'::regprocedure);
```

`search_path = public` is correct for the lifecycle RPCs. They reference only `public` tables and built-in PostgreSQL functions; `extensions` is unnecessary. The separate vector matcher still uses the `extensions.vector` type.

Apply `202607110002_business_signal_lifecycle_integrity.sql` only after this preflight.

## Database validation

Run the disposable transaction harness after migration application:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staging_lifecycle_validation.sql
```

It creates two isolated workspaces and three fixture identities, tests archive/restore/delete, repeated lifecycle calls, linked chunks, wrong-workspace denial, unaffiliated caller denial, and invalid action rejection, then rolls back.

## Preview UI validation

1. Create a Business Signal in a disposable workspace.
2. Confirm it appears in Signals, Search, Intelligence, and applicable active memory/context.
3. Archive once: it must leave active views and appear only under Archived Signals.
4. Restore once: it must return exactly once without creating a chunk or link.
5. Delete once: it must leave active and archived views, remain soft-deleted for audit, and remain absent after refresh.
6. Repeat for a source file and its linked memory chunk.
7. Confirm Home, Search, Ask, Intelligence, coverage, snapshots, and vector retrieval exclude inactive evidence.
8. Repeat lifecycle actions from a different workspace and unaffiliated account; both must fail without a success message.

## Application checks

```bash
pnpm typecheck
pnpm build
pnpm test:deletion-integrity
pnpm test:intelligence
pnpm test:homepage
pnpm test:evidence-boundary
pnpm test:adversarial
pnpm security:check
git diff --check
```

## Rollback

Before deploying application code, remove the staging functions if validation fails:

```sql
revoke all on function public.update_business_signal_lifecycle(uuid, uuid, text) from authenticated;
revoke all on function public.update_source_file_lifecycle(uuid, uuid, text) from authenticated;
drop function if exists public.update_business_signal_lifecycle(uuid, uuid, text);
drop function if exists public.update_source_file_lifecycle(uuid, uuid, text);
```

After the application code is deployed, roll back the application release before dropping either function.
