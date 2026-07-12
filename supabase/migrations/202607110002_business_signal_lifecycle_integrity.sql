-- Keep Business Signal lifecycle changes and any linked learned evidence in
-- one transaction. The function runs as the caller, so existing RLS policies
-- continue to enforce workspace membership and mutation permissions.
create or replace function public.update_business_signal_lifecycle(
  p_workspace_id uuid,
  p_signal_id uuid,
  p_action text
)
returns table(signal_id uuid, affected_memory_chunks integer)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_signal_id uuid;
  v_chunks integer := 0;
begin
  if p_action not in ('archive', 'delete', 'restore') then
    raise exception 'Unsupported Business Signal lifecycle action';
  end if;

  update public.tasks
  set
    archived_at = case when p_action in ('archive', 'delete') then coalesce(archived_at, v_now) else null end,
    deleted_at = case when p_action = 'delete' then coalesce(deleted_at, v_now) else null end
  where id = p_signal_id
    and workspace_id = p_workspace_id
  returning id into v_signal_id;

  if v_signal_id is null then
    raise exception 'Business Signal not found in this workspace';
  end if;

  update public.business_memory_chunks
  set
    archived_at = case when p_action in ('archive', 'delete') then coalesce(archived_at, v_now) else null end,
    deleted_at = case when p_action = 'delete' then coalesce(deleted_at, v_now) else null end,
    updated_at = case
      when p_action = 'restore' and (archived_at is not null or deleted_at is not null) then v_now
      when p_action in ('archive', 'delete') and (archived_at is null or (p_action = 'delete' and deleted_at is null)) then v_now
      else updated_at
    end
  where workspace_id = p_workspace_id
    and source_type = 'business_signal'
    and source_id = p_signal_id;

  get diagnostics v_chunks = row_count;
  return query select v_signal_id, v_chunks;
end;
$$;

revoke all on function public.update_business_signal_lifecycle(uuid, uuid, text) from public;
grant execute on function public.update_business_signal_lifecycle(uuid, uuid, text) to authenticated;

-- Source files and their derived memory chunks have the same lifecycle
-- dependency. Keep archive, delete, and restore atomic for that boundary too.
create or replace function public.update_source_file_lifecycle(
  p_workspace_id uuid,
  p_file_id uuid,
  p_action text
)
returns table(file_id uuid, affected_memory_chunks integer)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_file_id uuid;
  v_chunks integer := 0;
begin
  if p_action not in ('archive', 'delete', 'restore') then
    raise exception 'Unsupported source file lifecycle action';
  end if;

  update public.file_uploads
  set
    archived_at = case when p_action = 'archive' then coalesce(archived_at, v_now) when p_action = 'restore' then null else archived_at end,
    deleted_at = case when p_action = 'delete' then coalesce(deleted_at, v_now) when p_action = 'restore' then null else deleted_at end,
    updated_at = v_now
  where id = p_file_id
    and workspace_id = p_workspace_id
  returning id into v_file_id;

  if v_file_id is null then
    raise exception 'Source file not found in this workspace';
  end if;

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

revoke all on function public.update_source_file_lifecycle(uuid, uuid, text) from public;
grant execute on function public.update_source_file_lifecycle(uuid, uuid, text) to authenticated;
