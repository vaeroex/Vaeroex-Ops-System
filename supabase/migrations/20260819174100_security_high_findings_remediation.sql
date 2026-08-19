-- Remediate the four high-severity authorization findings without changing
-- existing customer data or trusted service-role workflows.

begin;

-- Staff retain the contribution workflows documented by the application.
-- Viewer is intentionally excluded from every workspace mutation below.
create or replace function public.can_contribute_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager', 'staff')
  );
$$;

revoke all on function public.can_contribute_workspace(uuid) from public, anon, authenticated;
grant execute on function public.can_contribute_workspace(uuid) to authenticated;

-- Workspace creation and entitlement state are server-controlled. The signed
-- agreement RPC, Stripe webhook, and Vaeroex-admin/manual-activation paths use
-- service_role and remain unchanged.
drop policy if exists "authenticated users can create workspaces" on public.workspaces;
revoke insert on table public.workspaces from authenticated;

revoke update on table public.workspaces from authenticated;
grant update (
  name,
  industry,
  size,
  logo_url,
  primary_contact_name,
  primary_contact_email
) on table public.workspaces to authenticated;

drop policy if exists "workspace managers can manage subscriptions" on public.customer_subscriptions;
revoke insert, update, delete on table public.customer_subscriptions from authenticated;

-- Workspace membership is still owner/admin managed, but only an owner may
-- create, edit, or remove an Owner membership.
drop policy if exists "workspace creator can add owner membership" on public.workspace_members;
drop policy if exists "owners and admins can invite members" on public.workspace_members;
drop policy if exists "owners and admins can update members" on public.workspace_members;
drop policy if exists "owners and admins can delete members" on public.workspace_members;

create policy "owners can invite members"
  on public.workspace_members for insert
  to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner']));

create policy "admins can invite non-owner members"
  on public.workspace_members for insert
  to authenticated
  with check (
    role <> 'owner'
    and public.has_workspace_role(workspace_id, array['admin'])
  );

create policy "owners can update members"
  on public.workspace_members for update
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']))
  with check (public.has_workspace_role(workspace_id, array['owner']));

create policy "admins can update non-owner members"
  on public.workspace_members for update
  to authenticated
  using (
    role <> 'owner'
    and public.has_workspace_role(workspace_id, array['admin'])
  )
  with check (
    role <> 'owner'
    and public.has_workspace_role(workspace_id, array['admin'])
  );

create policy "owners can delete members"
  on public.workspace_members for delete
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner']));

create policy "admins can delete non-owner members"
  on public.workspace_members for delete
  to authenticated
  using (
    role <> 'owner'
    and public.has_workspace_role(workspace_id, array['admin'])
  );

-- These tables intentionally allow Staff contributions. Replace the old
-- member-only predicates so Viewer can read but cannot create or update rows.
do $workspace_contributor_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'form_submissions',
    'asset_checks',
    'file_uploads',
    'file_imports',
    'file_import_rows',
    'crm_leads',
    'operational_metrics'
  ]
  loop
    execute format('drop policy if exists "%s members create" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s members update" on public.%I', table_name, table_name);
    execute format(
      'create policy "%s contributors create" on public.%I for insert to authenticated with check (public.can_contribute_workspace(workspace_id))',
      table_name,
      table_name
    );
    execute format(
      'create policy "%s contributors update" on public.%I for update to authenticated using (public.can_contribute_workspace(workspace_id)) with check (public.can_contribute_workspace(workspace_id))',
      table_name,
      table_name
    );
  end loop;
end;
$workspace_contributor_policies$;

-- Remove older permissive policies whose names predate the generic policies.
drop policy if exists "members can create form submissions" on public.form_submissions;
drop policy if exists "members can create asset checks" on public.asset_checks;

drop policy if exists "assigned users can complete checklist runs" on public.checklist_runs;
create policy "assigned contributors can complete checklist runs"
  on public.checklist_runs for update
  to authenticated
  using (
    public.can_contribute_workspace(workspace_id)
    and assigned_to = auth.uid()
  )
  with check (
    public.can_contribute_workspace(workspace_id)
    and assigned_to = auth.uid()
  );

drop policy if exists "assigned users can update assigned tasks" on public.tasks;
create policy "assigned contributors can update assigned tasks"
  on public.tasks for update
  to authenticated
  using (
    public.can_contribute_workspace(workspace_id)
    and assigned_to = auth.uid()
  )
  with check (
    public.can_contribute_workspace(workspace_id)
    and assigned_to = auth.uid()
  );

drop policy if exists "record folder members insert" on public.record_folders;
drop policy if exists "record folder members update" on public.record_folders;
create policy "record folder contributors insert"
  on public.record_folders for insert
  to authenticated
  with check (public.can_contribute_workspace(workspace_id));
create policy "record folder contributors update"
  on public.record_folders for update
  to authenticated
  using (public.can_contribute_workspace(workspace_id))
  with check (public.can_contribute_workspace(workspace_id));

drop policy if exists "crm lead history members create" on public.crm_lead_history;
drop policy if exists "crm lead history members update" on public.crm_lead_history;
create policy "crm lead history contributors create"
  on public.crm_lead_history for insert
  to authenticated
  with check (public.can_contribute_workspace(workspace_id));
create policy "crm lead history contributors update"
  on public.crm_lead_history for update
  to authenticated
  using (public.can_contribute_workspace(workspace_id))
  with check (public.can_contribute_workspace(workspace_id));

drop policy if exists "file processing jobs members create" on public.file_processing_jobs;
drop policy if exists "file processing jobs members update" on public.file_processing_jobs;
create policy "file processing jobs contributors create"
  on public.file_processing_jobs for insert
  to authenticated
  with check (public.can_contribute_workspace(workspace_id));
create policy "file processing jobs contributors update"
  on public.file_processing_jobs for update
  to authenticated
  using (public.can_contribute_workspace(workspace_id))
  with check (public.can_contribute_workspace(workspace_id));

drop policy if exists "business memory chunks members create" on public.business_memory_chunks;
drop policy if exists "business memory chunks members update" on public.business_memory_chunks;
create policy "business memory chunks contributors create"
  on public.business_memory_chunks for insert
  to authenticated
  with check (
    public.can_contribute_workspace(workspace_id)
    and source_type <> 'business_note'
  );
create policy "business memory chunks contributors update"
  on public.business_memory_chunks for update
  to authenticated
  using (
    public.can_contribute_workspace(workspace_id)
    and source_type <> 'business_note'
  )
  with check (
    public.can_contribute_workspace(workspace_id)
    and source_type <> 'business_note'
  );

drop policy if exists "business notes members create" on public.business_notes;
drop policy if exists "business notes authors update" on public.business_notes;
create policy "business notes contributors create"
  on public.business_notes for insert
  to authenticated
  with check (
    public.can_contribute_workspace(workspace_id)
    and author_user_id = auth.uid()
  );
create policy "business notes contributors update"
  on public.business_notes for update
  to authenticated
  using (
    public.can_contribute_workspace(workspace_id)
    and (author_user_id = auth.uid() or public.can_edit_operations(workspace_id))
  )
  with check (
    public.can_contribute_workspace(workspace_id)
    and (author_user_id = auth.uid() or public.can_edit_operations(workspace_id))
  );

drop policy if exists "kpis members create" on public.kpis;
create policy "kpis contributors create"
  on public.kpis for insert
  to authenticated
  with check (public.can_contribute_workspace(workspace_id));

drop policy if exists "business health snapshots members create" on public.business_health_snapshots;
drop policy if exists "business health snapshots members update" on public.business_health_snapshots;
create policy "business health snapshots contributors create"
  on public.business_health_snapshots for insert
  to authenticated
  with check (public.can_contribute_workspace(workspace_id));
create policy "business health snapshots contributors update"
  on public.business_health_snapshots for update
  to authenticated
  using (public.can_contribute_workspace(workspace_id))
  with check (public.can_contribute_workspace(workspace_id));

drop policy if exists "security audit events members create" on public.security_audit_events;
create policy "security audit events contributors create"
  on public.security_audit_events for insert
  to authenticated
  with check (
    workspace_id is not null
    and public.can_contribute_workspace(workspace_id)
  );

drop policy if exists "workspace members can insert non-trust ai usage" on public.ai_usage;
create policy "workspace contributors can insert non-trust ai usage"
  on public.ai_usage for insert
  to authenticated
  with check (
    workspace_id is not null
    and public.can_contribute_workspace(workspace_id)
    and not (coalesce(metadata_json, '{}'::jsonb) ? 'trust_shadow')
  );

-- A Viewer may still mark their own notification read; membership alone no
-- longer permits changing another member's notification.
drop policy if exists "members can update notifications" on public.notifications;
create policy "users can update own notifications"
  on public.notifications for update
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = auth.uid()
  );

drop policy if exists "workspace files members insert" on storage.objects;
drop policy if exists "workspace files members update" on storage.objects;
create policy "workspace files contributors insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_contribute_workspace(split_part(name, '/', 1)::uuid)
  );
create policy "workspace files contributors update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_contribute_workspace(split_part(name, '/', 1)::uuid)
  )
  with check (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_contribute_workspace(split_part(name, '/', 1)::uuid)
  );

-- Public-facing writes now enter through validated server handlers using the
-- service role. Authenticated in-workspace form submissions remain available
-- through the contributor policy above.
drop policy if exists "anyone can create support requests" on public.support_requests;
drop policy if exists "users can create activation requests" on public.manual_activation_requests;
drop policy if exists "public can submit public forms" on public.form_submissions;

revoke insert, update, delete on table public.support_requests from anon, authenticated;
revoke insert, update, delete on table public.manual_activation_requests from anon, authenticated;
revoke insert, update, delete on table public.form_submissions from anon;

-- Consume a quota in one statement. The conflict UPDATE is conditional, so
-- concurrent callers cannot all pass after the configured limit is reached.
create or replace function public.consume_request_rate_limit_v1(
  p_action_key text,
  p_identifier_hash text,
  p_window_start timestamptz,
  p_limit integer,
  p_metadata_json jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  request_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  consumed_count integer;
begin
  if p_action_key is null
    or length(p_action_key) not between 1 and 120
    or p_identifier_hash is null
    or p_identifier_hash !~ '^[0-9a-f]{64}$'
    or p_window_start is null
    or p_limit is null
    or p_limit not between 1 and 10000
    or jsonb_typeof(coalesce(p_metadata_json, '{}'::jsonb)) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'Invalid request-rate-limit input.';
  end if;

  insert into public.request_rate_limits as rate_limit (
    action_key,
    identifier_hash,
    window_start,
    count,
    first_seen_at,
    last_seen_at,
    metadata_json
  ) values (
    p_action_key,
    p_identifier_hash,
    p_window_start,
    1,
    statement_timestamp(),
    statement_timestamp(),
    coalesce(p_metadata_json, '{}'::jsonb)
  )
  on conflict on constraint request_rate_limits_unique_window
  do update
    set count = rate_limit.count + 1,
        last_seen_at = statement_timestamp(),
        metadata_json = excluded.metadata_json
    where rate_limit.count < p_limit
  returning count into consumed_count;

  if consumed_count is null then
    return query select false, p_limit;
    return;
  end if;

  return query select true, consumed_count;
end;
$$;

revoke all on table public.request_rate_limits from public, anon, authenticated;
grant select, insert, update on table public.request_rate_limits to service_role;

revoke all on function public.consume_request_rate_limit_v1(text, text, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_request_rate_limit_v1(text, text, timestamptz, integer, jsonb)
  to service_role;

comment on function public.can_contribute_workspace(uuid) is
  'RLS helper for owner/admin/manager/staff contributions; Viewer remains read-only.';
comment on function public.consume_request_rate_limit_v1(text, text, timestamptz, integer, jsonb) is
  'Service-role-only atomic quota consumption for validated public ingress.';

commit;
