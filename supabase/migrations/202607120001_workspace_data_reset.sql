-- Workspace data reset foundation.
--
-- This migration is intentionally additive. It is not safe to deploy the
-- application reset controls before this migration has been applied and
-- validated in staging.
--
-- Business records are removed transactionally by the database. Storage
-- objects are never modified by SQL; the application records an exact-prefix
-- manifest and deletes objects through the Supabase Storage API.

create extension if not exists pgcrypto;

create table if not exists public.workspace_reset_operations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  storage_mode text not null check (storage_mode in ('recoverable', 'permanent')),
  setup_mode text not null check (setup_mode in ('blank', 'guided')),
  status text not null check (
    status in (
      'manifesting',
      'in_progress',
      'recoverable',
      'database_reset',
      'purging',
      'completed',
      'partial',
      'failed',
      'restoring',
      'restored',
      'expired'
    )
  ),
  setup_status text not null default 'not_requested' check (
    setup_status in ('not_requested', 'pending', 'in_progress', 'completed')
  ),
  confirmation_name text not null,
  permanent_confirmation_verified boolean not null default false,
  reauthenticated_at timestamptz not null,
  storage_prefix text not null,
  workspace_context_before jsonb not null default '{}'::jsonb,
  pre_reset_counts jsonb not null default '{}'::jsonb,
  deleted_counts jsonb not null default '{}'::jsonb,
  restored_counts jsonb not null default '{}'::jsonb,
  storage_summary jsonb not null default '{}'::jsonb,
  manifest_completed_at timestamptz,
  reset_completed_at timestamptz,
  purge_after timestamptz,
  completed_at timestamptz,
  restored_at timestamptz,
  failure_summary text,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_reset_record_backups (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.workspace_reset_operations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  table_name text not null,
  record_id uuid not null,
  row_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (operation_id, table_name, record_id)
);

create table if not exists public.workspace_reset_storage_objects (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.workspace_reset_operations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  bucket_id text not null,
  object_path text not null,
  source_file_id uuid,
  size_bytes bigint,
  content_type text,
  checksum text,
  etag text,
  retention_deadline timestamptz,
  purge_status text not null default 'pending' check (
    purge_status in ('pending', 'retained', 'purging', 'purged', 'missing', 'failed', 'restored')
  ),
  purge_attempts integer not null default 0 check (purge_attempts >= 0),
  last_attempted_at timestamptz,
  purged_at timestamptz,
  failure_summary text,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id, bucket_id, object_path)
);

alter table public.file_uploads
  add column if not exists purge_after timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists purged_at timestamptz,
  add column if not exists purge_error text;

create or replace function public.protect_file_upload_lifecycle_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_trusted boolean :=
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or current_setting('vaeroex.source_file_lifecycle', true) = 'allowed'
    or nullif(current_setting('vaeroex.workspace_reset_operation', true), '') is not null;
begin
  if v_trusted then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.archived_at is not null
       or new.deleted_at is not null
       or new.purge_after is not null
       or new.legal_hold
       or new.purged_at is not null
       or new.purge_error is not null then
      raise exception 'Source lifecycle fields require a controlled server operation';
    end if;
    return new;
  end if;

  if new.archived_at is distinct from old.archived_at
     or new.deleted_at is distinct from old.deleted_at
     or new.purge_after is distinct from old.purge_after
     or new.legal_hold is distinct from old.legal_hold
     or new.purged_at is distinct from old.purged_at
     or new.purge_error is distinct from old.purge_error then
    raise exception 'Source lifecycle fields require a controlled server operation';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_file_upload_lifecycle_fields() from public, anon, authenticated;

drop trigger if exists protect_file_upload_lifecycle_fields on public.file_uploads;
create trigger protect_file_upload_lifecycle_fields
  before insert or update on public.file_uploads
  for each row execute function public.protect_file_upload_lifecycle_fields();

create index if not exists workspace_reset_operations_workspace_created_idx
  on public.workspace_reset_operations(workspace_id, created_at desc);

drop index if exists public.workspace_reset_operations_one_active_idx;
create unique index workspace_reset_operations_one_active_idx
  on public.workspace_reset_operations(workspace_id)
  where status in ('manifesting', 'in_progress', 'recoverable', 'database_reset', 'purging', 'partial', 'restoring');

create index if not exists workspace_reset_operations_purge_idx
  on public.workspace_reset_operations(status, purge_after)
  where purge_after is not null and legal_hold = false;

create index if not exists workspace_reset_backups_operation_table_idx
  on public.workspace_reset_record_backups(operation_id, table_name);

create index if not exists workspace_reset_storage_operation_status_idx
  on public.workspace_reset_storage_objects(operation_id, purge_status);

create index if not exists workspace_reset_storage_due_idx
  on public.workspace_reset_storage_objects(retention_deadline, purge_status)
  where legal_hold = false and purge_status in ('pending', 'retained', 'failed');

create index if not exists file_uploads_purge_due_idx
  on public.file_uploads(purge_after, workspace_id)
  where deleted_at is not null and purged_at is null and legal_hold = false;

drop trigger if exists set_workspace_reset_operations_updated_at on public.workspace_reset_operations;
create trigger set_workspace_reset_operations_updated_at
  before update on public.workspace_reset_operations
  for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_reset_storage_objects_updated_at on public.workspace_reset_storage_objects;
create trigger set_workspace_reset_storage_objects_updated_at
  before update on public.workspace_reset_storage_objects
  for each row execute function public.set_updated_at();

alter table public.workspace_reset_operations enable row level security;
alter table public.workspace_reset_record_backups enable row level security;
alter table public.workspace_reset_storage_objects enable row level security;

drop policy if exists "workspace reset managers read operations" on public.workspace_reset_operations;
create policy "workspace reset managers read operations"
  on public.workspace_reset_operations for select
  to authenticated
  using (public.can_manage_workspace(workspace_id));

drop policy if exists "workspace reset managers read storage manifest" on public.workspace_reset_storage_objects;
create policy "workspace reset managers read storage manifest"
  on public.workspace_reset_storage_objects for select
  to authenticated
  using (public.can_manage_workspace(workspace_id));

-- Recovery rows contain the removed business content. They are intentionally
-- not exposed through the Data API. Only the controlled restore RPC may read
-- them; the service role may remove them after purge.
revoke all on public.workspace_reset_operations from public, anon, authenticated;
revoke all on public.workspace_reset_record_backups from public, anon, authenticated;
revoke all on public.workspace_reset_storage_objects from public, anon, authenticated;
grant select on public.workspace_reset_operations to authenticated;
grant select on public.workspace_reset_storage_objects to authenticated;

create or replace function public.enforce_workspace_reset_mutation_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_active_operation_id uuid;
  v_session_operation_id text := current_setting('vaeroex.workspace_reset_operation', true);
begin
  if tg_op = 'DELETE' then
    v_workspace_id := nullif(to_jsonb(old) ->> 'workspace_id', '')::uuid;
  else
    v_workspace_id := nullif(to_jsonb(new) ->> 'workspace_id', '')::uuid;
  end if;

  if v_workspace_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select op.id into v_active_operation_id
  from public.workspace_reset_operations op
  where op.workspace_id = v_workspace_id
    and (
      (op.status = 'manifesting' and op.updated_at >= now() - interval '30 minutes')
      or op.status in ('in_progress', 'restoring')
    )
  order by op.created_at desc
  limit 1;

  if v_active_operation_id is not null
     and v_session_operation_id is distinct from v_active_operation_id::text then
    raise exception 'Workspace business data is temporarily locked for reset';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_workspace_reset_mutation_guard() from public, anon, authenticated;

create or replace function public.workspace_reset_allows_storage_write(
  p_workspace_id uuid,
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_workspace_member(p_workspace_id)
    and not exists (
      select 1
      from public.file_uploads f
      where f.workspace_id = p_workspace_id
        and f.storage_bucket = 'workspace-files'
        and f.storage_path = p_object_path
        and f.deleted_at is not null
    )
    and not exists (
      select 1
      from public.workspace_reset_operations op
      where op.workspace_id = p_workspace_id
        and (
          (op.status = 'manifesting' and op.updated_at >= now() - interval '30 minutes')
          or op.status in ('in_progress', 'restoring')
        )
    );
$$;

create or replace function public.workspace_reset_allows_storage_object_access(
  p_workspace_id uuid,
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_workspace_member(p_workspace_id)
    and not exists (
      select 1
      from public.file_uploads f
      where f.workspace_id = p_workspace_id
        and f.storage_bucket = 'workspace-files'
        and f.storage_path = p_object_path
        and f.deleted_at is not null
    )
    and not exists (
      select 1
      from public.workspace_reset_storage_objects so
      join public.workspace_reset_operations op on op.id = so.operation_id
      where so.workspace_id = p_workspace_id
        and so.bucket_id = 'workspace-files'
        and so.object_path = p_object_path
        and so.purge_status <> 'restored'
        and op.status in ('in_progress', 'recoverable', 'database_reset', 'purging', 'partial', 'restoring')
    );
$$;

revoke all on function public.workspace_reset_allows_storage_write(uuid, text) from public, anon, authenticated;
revoke all on function public.workspace_reset_allows_storage_object_access(uuid, text) from public, anon, authenticated;
grant execute on function public.workspace_reset_allows_storage_write(uuid, text) to authenticated;
grant execute on function public.workspace_reset_allows_storage_object_access(uuid, text) to authenticated;

-- Preserve the existing private workspace-prefix policy while preventing
-- direct Storage API clients from racing an exact-prefix reset manifest.
drop policy if exists "workspace files members read" on storage.objects;
create policy "workspace files members read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.workspace_reset_allows_storage_object_access(split_part(name, '/', 1)::uuid, name)
      else false
    end
  );

drop policy if exists "workspace files members insert" on storage.objects;
create policy "workspace files members insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspace-files'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.workspace_reset_allows_storage_write(split_part(name, '/', 1)::uuid, name)
          and public.workspace_reset_allows_storage_object_access(split_part(name, '/', 1)::uuid, name)
      else false
    end
  );

drop policy if exists "workspace files members update" on storage.objects;
create policy "workspace files members update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.workspace_reset_allows_storage_object_access(split_part(name, '/', 1)::uuid, name)
      else false
    end
  )
  with check (
    bucket_id = 'workspace-files'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.workspace_reset_allows_storage_write(split_part(name, '/', 1)::uuid, name)
          and public.workspace_reset_allows_storage_object_access(split_part(name, '/', 1)::uuid, name)
      else false
    end
  );

drop policy if exists "workspace files managers delete" on storage.objects;
create policy "workspace files managers delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_edit_operations(split_part(name, '/', 1)::uuid)
          and public.workspace_reset_allows_storage_object_access(split_part(name, '/', 1)::uuid, name)
      else false
    end
  );

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'record_folders',
    'file_uploads',
    'file_imports',
    'file_import_rows',
    'file_processing_jobs',
    'business_memory_chunks',
    'business_health_snapshots',
    'crm_leads',
    'crm_lead_history',
    'operational_metrics',
    'business_intakes',
    'workflow_maps',
    'forms',
    'form_submissions',
    'checklists',
    'checklist_runs',
    'tasks',
    'kpis',
    'kpi_settings',
    'issues',
    'assets',
    'asset_checks',
    'people',
    'sops',
    'reports',
    'ai_agent_runs',
    'notifications',
    'record_shares',
    'operational_assignments',
    'business_decisions',
    'vaeroex_recommendation_outcomes',
    'kpi_alert_rules',
    'kpi_alert_events',
    'report_subscription_preferences',
    'scheduled_report_runs'
  ]
  loop
    execute format('drop trigger if exists enforce_workspace_reset_mutation_guard on public.%I', v_table);
    execute format(
      'create trigger enforce_workspace_reset_mutation_guard before insert or update or delete on public.%I for each row execute function public.enforce_workspace_reset_mutation_guard()',
      v_table
    );
  end loop;
end;
$$;

create or replace function public.workspace_reset_has_recent_auth()
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_iat text := auth.jwt() ->> 'iat';
begin
  if v_iat is null or v_iat !~ '^\d+$' then
    return false;
  end if;

  return to_timestamp(v_iat::double precision) >= now() - interval '10 minutes';
end;
$$;

revoke all on function public.workspace_reset_has_recent_auth() from public, anon, authenticated;

-- Coordinate normal source retention purges with workspace resets. The claim
-- uses the same workspace advisory lock as reset preparation and is callable
-- only by the service role. A short stale window lets a later cron invocation
-- recover after a terminated worker without permitting concurrent deletion.
create or replace function public.claim_source_file_purge(
  p_workspace_id uuid,
  p_file_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claimed_id uuid;
begin
  if p_workspace_id is null or p_file_id is null then
    return false;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    return false;
  end if;

  if exists (
    select 1
    from public.workspace_reset_operations op
    where op.workspace_id = p_workspace_id
      and (
        (op.status = 'manifesting' and op.updated_at >= now() - interval '30 minutes')
        or op.status in ('in_progress', 'recoverable', 'database_reset', 'purging', 'partial', 'restoring')
      )
  ) then
    return false;
  end if;

  update public.file_uploads
  set
    purge_error = '__vaeroex_source_purge_in_progress__',
    updated_at = now()
  where id = p_file_id
    and workspace_id = p_workspace_id
    and deleted_at is not null
    and purge_after is not null
    and purge_after <= now()
    and purged_at is null
    and legal_hold = false
    and (
      purge_error is distinct from '__vaeroex_source_purge_in_progress__'
      or updated_at < now() - interval '15 minutes'
    )
  returning id into v_claimed_id;

  return v_claimed_id is not null;
end;
$$;

-- Finalize the database side only after the Storage API has confirmed object
-- absence. File state and both retained audit records commit atomically.
create or replace function public.finalize_source_file_purge(
  p_workspace_id uuid,
  p_file_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_finalized_id uuid;
begin
  update public.file_uploads
  set
    purged_at = now(),
    purge_error = null,
    updated_at = now()
  where id = p_file_id
    and workspace_id = p_workspace_id
    and deleted_at is not null
    and purged_at is null
    and purge_error = '__vaeroex_source_purge_in_progress__'
  returning id into v_finalized_id;

  if v_finalized_id is null then
    raise exception 'Source file purge claim is not active';
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    null,
    'source_file_storage_purged',
    'file_upload',
    p_file_id,
    jsonb_build_object('retention_policy_days', 30, 'storage_object_purged', true)
  );

  insert into public.security_audit_events (
    workspace_id,
    user_id,
    action_name,
    operation_type,
    target_table,
    target_record_id,
    initiated_by,
    required_confirmation,
    confirmation_received,
    allowed,
    metadata_json
  ) values (
    p_workspace_id,
    null,
    'system.source_file_retention_purge',
    'SYSTEM',
    'file_uploads',
    p_file_id::text,
    'system',
    false,
    false,
    true,
    jsonb_build_object('retention_policy_days', 30)
  );

  return true;
end;
$$;

revoke all on function public.claim_source_file_purge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_source_file_purge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_source_file_purge(uuid, uuid) to service_role;
grant execute on function public.finalize_source_file_purge(uuid, uuid) to service_role;

create or replace function public.begin_workspace_data_reset(
  p_workspace_id uuid,
  p_confirmation_name text,
  p_storage_mode text,
  p_setup_mode text,
  p_operation_id uuid,
  p_permanent_phrase text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace public.workspaces%rowtype;
  v_existing public.workspace_reset_operations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_operation_id is null or p_workspace_id is null then
    raise exception 'Workspace and operation identifiers are required';
  end if;

  if p_storage_mode not in ('recoverable', 'permanent') then
    raise exception 'Unsupported storage mode';
  end if;

  if p_setup_mode not in ('blank', 'guided') then
    raise exception 'Unsupported setup mode';
  end if;

  if not public.workspace_reset_has_recent_auth() then
    raise exception 'Recent authentication is required';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    raise exception 'Another workspace reset is already running';
  end if;

  if exists (
    select 1
    from public.file_uploads f
    where f.workspace_id = p_workspace_id
      and f.purge_error = '__vaeroex_source_purge_in_progress__'
      and f.updated_at >= now() - interval '15 minutes'
  ) then
    raise exception 'A source-file retention purge is currently running for this workspace';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = p_workspace_id
  for update;

  if not found then
    raise exception 'Workspace not found';
  end if;

  if p_confirmation_name is distinct from v_workspace.name then
    raise exception 'Workspace name confirmation does not match';
  end if;

  if p_storage_mode = 'permanent'
     and p_permanent_phrase is distinct from ('PERMANENTLY RESET ' || v_workspace.name) then
    raise exception 'Permanent reset confirmation phrase does not match';
  end if;

  -- A terminated request can leave only the pre-database manifest phase
  -- committed. Reclaim that state after a conservative timeout so it cannot
  -- block the workspace forever. Database-reset and purge states are never
  -- auto-reclaimed because they require an exact-manifest retry.
  update public.workspace_reset_operations
  set
    status = 'failed',
    failure_summary = 'The storage manifest did not complete before the operation timeout.'
  where workspace_id = p_workspace_id
    and status = 'manifesting'
    and updated_at < now() - interval '30 minutes';

  delete from public.workspace_reset_storage_objects so
  using public.workspace_reset_operations op
  where so.operation_id = op.id
    and so.workspace_id = p_workspace_id
    and op.workspace_id = p_workspace_id
    and op.status = 'failed'
    and op.reset_completed_at is null;

  select * into v_existing
  from public.workspace_reset_operations
  where id = p_operation_id;

  if found then
    if v_existing.workspace_id <> p_workspace_id
       or v_existing.initiated_by <> v_user_id
       or v_existing.storage_mode <> p_storage_mode
       or v_existing.setup_mode <> p_setup_mode
       or v_existing.confirmation_name <> p_confirmation_name then
      raise exception 'Operation identifier is already used by a different reset request';
    end if;

    return jsonb_build_object(
      'operation_id', v_existing.id,
      'status', v_existing.status,
      'storage_mode', v_existing.storage_mode,
      'setup_mode', v_existing.setup_mode,
      'idempotent', true
    );
  end if;

  if exists (
    select 1
    from public.workspace_reset_operations op
    where op.workspace_id = p_workspace_id
      and op.status in ('manifesting', 'in_progress', 'recoverable', 'database_reset', 'purging', 'partial', 'restoring')
  ) then
    raise exception 'Another workspace reset is already active';
  end if;

  insert into public.workspace_reset_operations (
    id,
    workspace_id,
    initiated_by,
    storage_mode,
    setup_mode,
    status,
    setup_status,
    confirmation_name,
    permanent_confirmation_verified,
    reauthenticated_at,
    storage_prefix,
    workspace_context_before
  ) values (
    p_operation_id,
    p_workspace_id,
    v_user_id,
    p_storage_mode,
    p_setup_mode,
    'manifesting',
    case when p_setup_mode = 'guided' then 'pending' else 'not_requested' end,
    p_confirmation_name,
    p_storage_mode = 'permanent',
    now(),
    p_workspace_id::text || '/',
    jsonb_build_object('industry', v_workspace.industry, 'size', v_workspace.size)
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    v_user_id,
    'workspace_reset_started',
    'workspace_reset_operation',
    p_operation_id,
    jsonb_build_object('storage_mode', p_storage_mode, 'setup_mode', p_setup_mode, 'status', 'manifesting')
  );

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'manifesting',
    'storage_mode', p_storage_mode,
    'setup_mode', p_setup_mode,
    'idempotent', false
  );
end;
$$;

create or replace function public.reset_workspace_data(
  p_workspace_id uuid,
  p_confirmation_name text,
  p_storage_mode text,
  p_setup_mode text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation public.workspace_reset_operations%rowtype;
  v_workspace_name text;
  v_table text;
  v_count bigint;
  v_total_records bigint := 0;
  v_counts jsonb := '{}'::jsonb;
  v_deleted jsonb := '{}'::jsonb;
  v_predicate text;
  v_unknown_table text;
  v_preserved_workspace_tables constant text[] := array[
    'workspace_members',
    'legal_acceptances',
    'security_audit_events',
    'audit_logs',
    'ai_usage',
    'customer_subscriptions',
    'support_requests',
    'workspace_reset_operations',
    'workspace_reset_record_backups',
    'workspace_reset_storage_objects'
  ];
  v_backup_tables constant text[] := array[
    'record_folders',
    'file_uploads',
    'file_imports',
    'file_import_rows',
    'file_processing_jobs',
    'business_memory_chunks',
    'business_health_snapshots',
    'crm_leads',
    'crm_lead_history',
    'operational_metrics',
    'business_intakes',
    'workflow_maps',
    'forms',
    'form_submissions',
    'checklists',
    'checklist_runs',
    'tasks',
    'kpis',
    'kpi_settings',
    'issues',
    'assets',
    'asset_checks',
    'people',
    'sops',
    'reports',
    'ai_agent_runs',
    'notifications',
    'record_shares',
    'operational_assignments',
    'business_decisions',
    'vaeroex_recommendation_outcomes',
    'kpi_alert_rules',
    'kpi_alert_events',
    'report_subscription_preferences',
    'scheduled_report_runs'
  ];
  v_delete_tables constant text[] := array[
    'kpi_alert_events',
    'scheduled_report_runs',
    'vaeroex_recommendation_outcomes',
    'business_decisions',
    'report_subscription_preferences',
    'record_shares',
    'operational_assignments',
    'crm_lead_history',
    'asset_checks',
    'checklist_runs',
    'form_submissions',
    'business_memory_chunks',
    'file_processing_jobs',
    'kpis',
    'crm_leads',
    'operational_metrics',
    'file_import_rows',
    'file_imports',
    'kpi_alert_rules',
    'notifications',
    'ai_agent_runs',
    'business_health_snapshots',
    'reports',
    'sops',
    'issues',
    'tasks',
    'assets',
    'checklists',
    'forms',
    'people',
    'workflow_maps',
    'business_intakes',
    'kpi_settings',
    'file_uploads',
    'record_folders'
  ];
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not public.workspace_reset_has_recent_auth() then
    raise exception 'Recent authentication is required';
  end if;

  select * into v_operation
  from public.workspace_reset_operations
  where id = p_operation_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Reset operation not found for this workspace';
  end if;

  if v_operation.initiated_by <> v_user_id then
    raise exception 'Only the initiating owner or admin may continue this reset';
  end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    raise exception 'Another workspace reset is already running';
  end if;

  if v_operation.storage_mode <> p_storage_mode
     or v_operation.setup_mode <> p_setup_mode
     or v_operation.confirmation_name <> p_confirmation_name then
    raise exception 'Reset parameters do not match the prepared operation';
  end if;

  if p_storage_mode = 'permanent' and v_operation.legal_hold then
    raise exception 'Permanent reset is blocked because this operation is under legal hold';
  end if;

  select name into v_workspace_name from public.workspaces where id = p_workspace_id;
  if p_confirmation_name is distinct from v_workspace_name then
    raise exception 'Workspace name confirmation does not match';
  end if;

  if v_operation.status in ('recoverable', 'database_reset', 'purging', 'completed', 'partial', 'expired') then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'status', v_operation.status,
      'counts', v_operation.deleted_counts,
      'idempotent', true
    );
  end if;

  if v_operation.status <> 'manifesting' or v_operation.manifest_completed_at is null then
    raise exception 'Storage manifest is not complete';
  end if;

  if exists (
    select 1
    from public.workspace_reset_storage_objects so
    where so.operation_id = p_operation_id
      and (
        so.workspace_id <> p_workspace_id
        or so.bucket_id <> 'workspace-files'
        or left(so.object_path, length(p_workspace_id::text || '/')) <> p_workspace_id::text || '/'
      )
  ) then
    raise exception 'Storage manifest contains an out-of-scope object';
  end if;

  if p_storage_mode = 'permanent' and exists (
    select 1
    from public.workspace_reset_storage_objects so
    where so.operation_id = p_operation_id
      and so.workspace_id = p_workspace_id
      and so.legal_hold
  ) then
    raise exception 'Permanent reset is blocked by a private object under legal hold';
  end if;

  if exists (
    select 1
    from public.file_uploads f
    where f.workspace_id = p_workspace_id
      and not exists (
        select 1
        from public.workspace_reset_storage_objects so
        where so.operation_id = p_operation_id
          and so.workspace_id = p_workspace_id
          and so.bucket_id = f.storage_bucket
          and so.object_path = f.storage_path
      )
  ) then
    raise exception 'Storage manifest does not cover every source file row';
  end if;

  select c.table_name into v_unknown_table
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.column_name = 'workspace_id'
    and not (c.table_name = any(v_backup_tables))
    and not (c.table_name = any(v_preserved_workspace_tables))
  order by c.table_name
  limit 1;

  if v_unknown_table is not null then
    raise exception 'Workspace reset inventory requires review for table %', v_unknown_table;
  end if;

  perform set_config('vaeroex.workspace_reset_operation', p_operation_id::text, true);

  update public.workspace_reset_operations
  set status = 'in_progress', failure_summary = null
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  foreach v_table in array v_backup_tables
  loop
    v_predicate := case
      when v_table = 'record_folders' then 'workspace_id = $1 and collection_type <> ''support_requests'''
      else 'workspace_id = $1'
    end;

    execute format('select count(*) from public.%I where %s', v_table, v_predicate)
      into v_count using p_workspace_id;
    v_total_records := v_total_records + v_count;
    if v_total_records > 100000 then
      raise exception 'This workspace has too much business content for an interactive reset';
    end if;
    v_counts := v_counts || jsonb_build_object(v_table, v_count);

    if p_storage_mode = 'recoverable' and v_count > 0 then
      execute format(
        'insert into public.workspace_reset_record_backups (operation_id, workspace_id, table_name, record_id, row_data)
         select $1, $2, %L, t.id, to_jsonb(t)
         from public.%I t
         where %s
         on conflict (operation_id, table_name, record_id) do nothing',
        v_table,
        v_table,
        replace(v_predicate, '$1', '$2')
      ) using p_operation_id, p_workspace_id;
    end if;
  end loop;

  update public.workspace_reset_operations
  set pre_reset_counts = v_counts
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  foreach v_table in array v_delete_tables
  loop
    v_predicate := case
      when v_table = 'record_folders' then 'workspace_id = $1 and collection_type <> ''support_requests'''
      else 'workspace_id = $1'
    end;

    execute format('delete from public.%I where %s', v_table, v_predicate) using p_workspace_id;
    get diagnostics v_count = row_count;
    v_deleted := v_deleted || jsonb_build_object(v_table, coalesce((v_deleted ->> v_table)::bigint, 0) + v_count);
  end loop;

  update public.workspaces
  set industry = null,
      size = null,
      updated_at = now()
  where id = p_workspace_id;

  update public.workspace_reset_operations
  set
    status = case when p_storage_mode = 'recoverable' then 'recoverable' else 'database_reset' end,
    deleted_counts = v_deleted,
    reset_completed_at = now(),
    purge_after = case when p_storage_mode = 'recoverable' then now() + interval '30 days' else now() end,
    completed_at = case when p_storage_mode = 'recoverable' then now() else null end,
    storage_summary = jsonb_build_object(
      'object_count', (
        select count(*)
        from public.workspace_reset_storage_objects
        where operation_id = p_operation_id
          and workspace_id = p_workspace_id
      ),
      'retention_days', case when p_storage_mode = 'recoverable' then 30 else 0 end
    )
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  if p_storage_mode = 'recoverable' then
    update public.workspace_reset_storage_objects
    set purge_status = case when purge_status = 'missing' then 'missing' else 'retained' end,
        retention_deadline = now() + interval '30 days'
    where operation_id = p_operation_id
      and workspace_id = p_workspace_id;
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    v_user_id,
    'workspace_reset_database_completed',
    'workspace_reset_operation',
    p_operation_id,
    jsonb_build_object(
      'storage_mode', p_storage_mode,
      'setup_mode', p_setup_mode,
      'status', case when p_storage_mode = 'recoverable' then 'recoverable' else 'database_reset' end,
      'deleted_counts', v_deleted
    )
  );

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'status', case when p_storage_mode = 'recoverable' then 'recoverable' else 'database_reset' end,
    'counts', v_deleted,
    'purge_after', case when p_storage_mode = 'recoverable' then now() + interval '30 days' else now() end,
    'idempotent', false
  );
end;
$$;

create or replace function public.restore_workspace_data(
  p_workspace_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation public.workspace_reset_operations%rowtype;
  v_table text;
  v_conflicts bigint;
  v_count bigint;
  v_predicate text;
  v_restored jsonb := '{}'::jsonb;
  v_restore_tables constant text[] := array[
    'record_folders',
    'file_uploads',
    'file_imports',
    'file_import_rows',
    'people',
    'forms',
    'checklists',
    'assets',
    'reports',
    'sops',
    'issues',
    'tasks',
    'kpi_settings',
    'kpi_alert_rules',
    'business_intakes',
    'workflow_maps',
    'ai_agent_runs',
    'notifications',
    'operational_metrics',
    'crm_leads',
    'kpis',
    'file_processing_jobs',
    'business_memory_chunks',
    'business_health_snapshots',
    'form_submissions',
    'checklist_runs',
    'asset_checks',
    'crm_lead_history',
    'record_shares',
    'operational_assignments',
    'business_decisions',
    'vaeroex_recommendation_outcomes',
    'kpi_alert_events',
    'report_subscription_preferences',
    'scheduled_report_runs'
  ];
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not public.workspace_reset_has_recent_auth() then
    raise exception 'Recent authentication is required';
  end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    raise exception 'Another workspace reset is already running';
  end if;

  select * into v_operation
  from public.workspace_reset_operations
  where id = p_operation_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Recoverable reset operation not found';
  end if;

  if v_operation.status = 'restored' then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'status', 'restored',
      'counts', v_operation.restored_counts,
      'idempotent', true
    );
  end if;

  if v_operation.storage_mode <> 'recoverable' or v_operation.status <> 'recoverable' then
    raise exception 'This reset is not available for restoration';
  end if;

  if v_operation.purge_after is null or v_operation.purge_after <= now() then
    raise exception 'The 30-day recovery period has expired';
  end if;

  if exists (
    select 1
    from public.workspace_reset_storage_objects so
    where so.operation_id = p_operation_id
      and so.purge_status in ('purged', 'purging', 'failed', 'missing')
  ) then
    raise exception 'One or more retained storage objects are unavailable for restoration';
  end if;

  perform set_config('vaeroex.workspace_reset_operation', p_operation_id::text, true);

  -- Never merge an old snapshot into business content created after reset.
  -- Self-service restore is intentionally limited to an otherwise blank
  -- workspace; support can review exceptional recoveries separately.
  foreach v_table in array v_restore_tables
  loop
    v_predicate := case
      when v_table = 'record_folders' then 'workspace_id = $1 and collection_type <> ''support_requests'''
      else 'workspace_id = $1'
    end;

    execute format('select count(*) from public.%I where %s', v_table, v_predicate)
      into v_count using p_workspace_id;

    if v_count > 0 then
      raise exception 'Workspace contains business content created after reset; controlled recovery review is required';
    end if;
  end loop;

  update public.workspace_reset_operations
  set status = 'restoring', failure_summary = null
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  foreach v_table in array v_restore_tables
  loop
    execute format(
      'select count(*)
       from public.workspace_reset_record_backups b
       join public.%I existing on existing.id = b.record_id
       where b.operation_id = $1 and b.workspace_id = $2 and b.table_name = %L',
      v_table,
      v_table
    ) into v_conflicts using p_operation_id, p_workspace_id;

    if v_conflicts > 0 then
      raise exception 'Restore conflict detected for table %', v_table;
    end if;

    execute format(
      'insert into public.%I
       select (jsonb_populate_record(null::public.%I, b.row_data)).*
       from public.workspace_reset_record_backups b
       where b.operation_id = $1 and b.workspace_id = $2 and b.table_name = %L',
      v_table,
      v_table,
      v_table
    ) using p_operation_id, p_workspace_id;

    get diagnostics v_count = row_count;
    v_restored := v_restored || jsonb_build_object(v_table, v_count);
  end loop;

  update public.workspaces
  set
    industry = v_operation.workspace_context_before ->> 'industry',
    size = v_operation.workspace_context_before ->> 'size',
    updated_at = now()
  where id = p_workspace_id;

  update public.workspace_reset_storage_objects
  set purge_status = 'restored', retention_deadline = null
  where operation_id = p_operation_id
    and workspace_id = p_workspace_id;

  delete from public.workspace_reset_record_backups
  where operation_id = p_operation_id
    and workspace_id = p_workspace_id;

  delete from public.workspace_reset_storage_objects
  where operation_id = p_operation_id
    and workspace_id = p_workspace_id;

  update public.workspace_reset_operations
  set
    status = 'restored',
    restored_counts = v_restored,
    restored_at = now(),
    purge_after = null,
    completed_at = now(),
    workspace_context_before = '{}'::jsonb
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    v_user_id,
    'workspace_reset_restored',
    'workspace_reset_operation',
    p_operation_id,
    jsonb_build_object('restored_counts', v_restored)
  );

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'status', 'restored',
    'counts', v_restored,
    'idempotent', false
  );
end;
$$;

create or replace function public.finalize_workspace_data_reset(
  p_workspace_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation public.workspace_reset_operations%rowtype;
  v_total bigint;
  v_purged bigint;
  v_failed bigint;
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if not public.workspace_reset_has_recent_auth() then
    raise exception 'Recent authentication is required';
  end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    raise exception 'Another workspace reset is already running';
  end if;

  select * into v_operation
  from public.workspace_reset_operations
  where id = p_operation_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Reset operation not found';
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'status', 'completed',
      'storage_object_count', coalesce((v_operation.storage_summary ->> 'object_count')::bigint, 0),
      'purged_or_missing', coalesce((v_operation.storage_summary ->> 'purged_or_missing')::bigint, 0),
      'failed', coalesce((v_operation.storage_summary ->> 'failed')::bigint, 0),
      'idempotent', true
    );
  end if;

  if v_operation.reset_completed_at is null or v_operation.manifest_completed_at is null then
    raise exception 'Database reset and storage manifest must complete before finalization';
  end if;

  if v_operation.storage_mode = 'permanent'
     and v_operation.status not in ('database_reset', 'purging', 'partial') then
    raise exception 'Permanent reset is not ready for finalization';
  end if;

  if v_operation.storage_mode = 'recoverable' and v_operation.status <> 'recoverable' then
    raise exception 'Recoverable reset is not ready for finalization';
  end if;

  select
    count(*),
    count(*) filter (where purge_status in ('purged', 'missing')),
    count(*) filter (where purge_status = 'failed')
  into v_total, v_purged, v_failed
  from public.workspace_reset_storage_objects
  where operation_id = p_operation_id
    and workspace_id = p_workspace_id;

  if v_operation.storage_mode = 'recoverable' then
    v_status := 'recoverable';
  elsif v_failed > 0 or v_purged < v_total then
    v_status := 'partial';
  else
    v_status := 'completed';
  end if;

  update public.workspace_reset_operations
  set
    status = v_status,
    completed_at = case when v_status in ('completed', 'recoverable') then now() else completed_at end,
    failure_summary = case when v_status = 'partial' then 'One or more storage objects could not be permanently deleted.' else null end,
    storage_summary = jsonb_build_object('object_count', v_total, 'purged_or_missing', v_purged, 'failed', v_failed),
    workspace_context_before = case when v_status = 'completed' then '{}'::jsonb else workspace_context_before end
  where id = p_operation_id
    and workspace_id = p_workspace_id;

  if v_status = 'completed' then
    delete from public.workspace_reset_record_backups
    where operation_id = p_operation_id
      and workspace_id = p_workspace_id;

    delete from public.workspace_reset_storage_objects
    where operation_id = p_operation_id
      and workspace_id = p_workspace_id;
  end if;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    v_user_id,
    'workspace_reset_finalized',
    'workspace_reset_operation',
    p_operation_id,
    jsonb_build_object('status', v_status, 'storage_object_count', v_total, 'storage_failed', v_failed)
  );

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'status', v_status,
    'storage_object_count', v_total,
    'purged_or_missing', v_purged,
    'failed', v_failed
  );
end;
$$;

create or replace function public.complete_workspace_reset_guided_setup(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_business_name text,
  p_industry text,
  p_team_size text,
  p_locations text,
  p_current_tools text,
  p_main_problem text,
  p_organization_description text,
  p_missed_often text,
  p_managed_items text,
  p_desired_focus text,
  p_raw_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_intake_id uuid;
begin
  if v_user_id is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = v_user_id
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if length(trim(p_business_name)) = 0
     or length(trim(p_industry)) = 0
     or length(trim(p_team_size)) = 0
     or length(trim(p_locations)) = 0
     or length(trim(p_organization_description)) = 0
     or length(trim(p_main_problem)) = 0
     or length(trim(p_missed_often)) = 0
     or length(trim(p_managed_items)) = 0
     or length(trim(p_desired_focus)) = 0 then
    raise exception 'Guided setup fields are incomplete';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended(p_workspace_id::text, 0)) then
    raise exception 'Another workspace operation is already running';
  end if;

  update public.workspace_reset_operations
  set setup_status = 'in_progress'
  where id = p_operation_id
    and workspace_id = p_workspace_id
    and setup_mode = 'guided'
    and setup_status in ('pending', 'in_progress')
    and status in ('recoverable', 'completed', 'partial');

  if not found then
    raise exception 'Guided setup reset operation is not active';
  end if;

  update public.workspaces
  set name = trim(p_business_name),
      industry = trim(p_industry),
      size = trim(p_team_size),
      updated_at = now()
  where id = p_workspace_id;

  insert into public.business_intakes (
    workspace_id,
    company_name,
    industry,
    team_size,
    locations,
    current_tools,
    biggest_operational_problems,
    repeated_missed_tasks,
    employee_accountability_process,
    reporting_process,
    ideal_outcome,
    raw_answers_json,
    ai_summary,
    ai_recommendations,
    created_by
  ) values (
    p_workspace_id,
    trim(p_business_name),
    trim(p_industry),
    trim(p_team_size),
    trim(p_locations),
    nullif(trim(p_current_tools), ''),
    trim(p_main_problem),
    trim(p_missed_often),
    trim(p_managed_items),
    trim(p_desired_focus),
    trim(p_desired_focus),
    coalesce(p_raw_answers, '{}'::jsonb) || jsonb_build_object(
      'evidence_classification', 'setup_bootstrap',
      'generated_from', 'workspace_reset_guided_setup',
      'reset_operation_id', p_operation_id
    ),
    'Guided setup context. Confirm with original business evidence before using it for intelligence.',
    null,
    v_user_id
  ) returning id into v_intake_id;

  update public.workspace_reset_operations
  set setup_status = 'completed'
  where id = p_operation_id and workspace_id = p_workspace_id;

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json
  ) values (
    p_workspace_id,
    v_user_id,
    'workspace_reset_guided_setup_completed',
    'workspace_reset_operation',
    p_operation_id,
    jsonb_build_object('setup_mode', 'guided', 'starter_records_created', false)
  );

  return v_intake_id;
end;
$$;

-- Normal source deletion remains recoverable for 30 days. Object removal is
-- handled later through the Storage API by the purge worker.
create or replace function public.update_source_file_lifecycle(
  p_workspace_id uuid,
  p_file_id uuid,
  p_action text
)
returns table(file_id uuid, affected_memory_chunks integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_file_id uuid;
  v_chunks integer := 0;
  v_purged_at timestamptz;
begin
  if p_action not in ('archive', 'delete', 'restore') then
    raise exception 'Unsupported source file lifecycle action';
  end if;

  if p_action in ('archive', 'delete') and not public.can_manage_workspace(p_workspace_id) then
    raise exception 'Workspace owner or admin access is required';
  end if;

  if p_action = 'restore' and not public.can_edit_operations(p_workspace_id) then
    raise exception 'Workspace manager access is required';
  end if;

  perform set_config('vaeroex.source_file_lifecycle', 'allowed', true);

  select purged_at into v_purged_at
  from public.file_uploads
  where id = p_file_id and workspace_id = p_workspace_id;

  if not found then
    raise exception 'Source file not found in this workspace';
  end if;

  if p_action = 'restore' and v_purged_at is not null then
    raise exception 'This source file has already been permanently purged';
  end if;

  update public.file_uploads
  set
    archived_at = case when p_action = 'archive' then coalesce(archived_at, v_now) when p_action = 'restore' then null else archived_at end,
    deleted_at = case when p_action = 'delete' then coalesce(deleted_at, v_now) when p_action = 'restore' then null else deleted_at end,
    purge_after = case when p_action = 'delete' then v_now + interval '30 days' when p_action = 'restore' then null else purge_after end,
    purge_error = case when p_action in ('delete', 'restore') then null else purge_error end,
    updated_at = v_now
  where id = p_file_id
    and workspace_id = p_workspace_id
  returning id into v_file_id;

  update public.business_memory_chunks
  set
    archived_at = case when p_action = 'archive' then coalesce(archived_at, v_now) when p_action = 'restore' then null else archived_at end,
    deleted_at = case when p_action = 'delete' then coalesce(deleted_at, v_now) when p_action = 'restore' then null else deleted_at end,
    updated_at = case
      when p_action = 'restore' and (archived_at is not null or deleted_at is not null) then v_now
      when p_action = 'archive' and archived_at is null then v_now
      when p_action = 'delete' and deleted_at is null then v_now
      else updated_at
    end
  where workspace_id = p_workspace_id
    and source_file_id = p_file_id;

  get diagnostics v_chunks = row_count;
  return query select v_file_id, v_chunks;
end;
$$;

revoke all on function public.begin_workspace_data_reset(uuid, text, text, text, uuid, text) from public, anon;
revoke all on function public.reset_workspace_data(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.restore_workspace_data(uuid, uuid) from public, anon;
revoke all on function public.finalize_workspace_data_reset(uuid, uuid) from public, anon;
revoke all on function public.complete_workspace_reset_guided_setup(uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.update_source_file_lifecycle(uuid, uuid, text) from public, anon;

grant execute on function public.begin_workspace_data_reset(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.reset_workspace_data(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.restore_workspace_data(uuid, uuid) to authenticated;
grant execute on function public.finalize_workspace_data_reset(uuid, uuid) to authenticated;
grant execute on function public.complete_workspace_reset_guided_setup(uuid, uuid, text, text, text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.update_source_file_lifecycle(uuid, uuid, text) to authenticated;

comment on table public.workspace_reset_operations is
  'Retained audit and state ledger for owner/admin workspace business-data resets.';
comment on table public.workspace_reset_record_backups is
  'Private 30-day recovery rows for recoverable workspace resets; not exposed to authenticated clients.';
comment on table public.workspace_reset_storage_objects is
  'Exact-prefix Storage API manifest for workspace reset retention and purge.';
