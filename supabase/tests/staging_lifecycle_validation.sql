-- STAGING ONLY. Do not run against production.
-- Requires 202607110002_business_signal_lifecycle_integrity.sql.
-- The transaction rolls back all disposable fixtures at completion.

begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace_a uuid := gen_random_uuid();
  workspace_b uuid := gen_random_uuid();
  signal_id uuid := gen_random_uuid();
  file_id uuid := gen_random_uuid();
begin
  insert into public.profiles (id, email, full_name) values
    (owner_id, 'staging-lifecycle-owner@example.invalid', 'Lifecycle owner'),
    (other_owner_id, 'staging-lifecycle-other@example.invalid', 'Lifecycle other owner'),
    (outsider_id, 'staging-lifecycle-outsider@example.invalid', 'Lifecycle outsider');
  insert into public.workspaces (id, name, created_by) values
    (workspace_a, 'Lifecycle staging workspace A', owner_id),
    (workspace_b, 'Lifecycle staging workspace B', other_owner_id);
  insert into public.workspace_members (workspace_id, user_id, role, status) values
    (workspace_a, owner_id, 'owner', 'active'),
    (workspace_b, other_owner_id, 'owner', 'active');
  insert into public.tasks (id, workspace_id, title, description, status, priority, created_by)
    values (signal_id, workspace_a, 'STAGING lifecycle signal', 'Disposable lifecycle evidence.', 'Business Signal', 'Context', owner_id);
  insert into public.file_uploads (id, workspace_id, original_name, display_name, file_extension, mime_type, storage_path, created_by)
    values (file_id, workspace_a, 'staging-lifecycle.csv', 'STAGING lifecycle source', 'csv', 'text/csv', workspace_a::text || '/staging-lifecycle.csv', owner_id);
  insert into public.business_memory_chunks (workspace_id, source_type, source_id, source_title, source_excerpt, content_hash, chunk_index, source_metadata) values
    (workspace_a, 'business_signal', signal_id, 'STAGING lifecycle signal', 'Signal-linked staging evidence.', 'staging-signal-lifecycle-hash', 0, '{"evidence_classification":"business_evidence"}'::jsonb),
    (workspace_a, 'file', file_id, 'STAGING lifecycle source', 'File-linked staging evidence.', 'staging-file-lifecycle-hash', 0, '{"evidence_classification":"business_evidence"}'::jsonb);
  perform set_config('vaeroex.lifecycle.owner_id', owner_id::text, true);
  perform set_config('vaeroex.lifecycle.other_owner_id', other_owner_id::text, true);
  perform set_config('vaeroex.lifecycle.outsider_id', outsider_id::text, true);
  perform set_config('vaeroex.lifecycle.workspace_a', workspace_a::text, true);
  perform set_config('vaeroex.lifecycle.workspace_b', workspace_b::text, true);
  perform set_config('vaeroex.lifecycle.signal_id', signal_id::text, true);
  perform set_config('vaeroex.lifecycle.file_id', file_id::text, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('vaeroex.lifecycle.owner_id'), true);

-- Archive, repeat safely, restore, then soft-delete the signal.
select * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'archive');
select * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'archive');
select * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'restore');
select * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'delete');

do $$
begin
  if (select count(*) from public.tasks where id = current_setting('vaeroex.lifecycle.signal_id')::uuid and deleted_at is not null) <> 1 then raise exception 'Signal was not soft-deleted'; end if;
  if exists (select 1 from public.business_memory_chunks where source_id = current_setting('vaeroex.lifecycle.signal_id')::uuid and (archived_at is null or deleted_at is null)) then raise exception 'Deleted signal chunk remained eligible'; end if;
end;
$$;

-- Archive, restore, then soft-delete the source file and its linked chunk.
select * from public.update_source_file_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.file_id')::uuid, 'archive');
select * from public.update_source_file_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.file_id')::uuid, 'restore');
select * from public.update_source_file_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.file_id')::uuid, 'delete');

do $$
begin
  if (select count(*) from public.file_uploads where id = current_setting('vaeroex.lifecycle.file_id')::uuid and deleted_at is not null) <> 1 then raise exception 'File was not soft-deleted'; end if;
  if exists (select 1 from public.business_memory_chunks where source_id = current_setting('vaeroex.lifecycle.file_id')::uuid and (archived_at is null or deleted_at is null)) then raise exception 'Deleted file chunk remained eligible'; end if;
end;
$$;

-- Cross-workspace, outsider, and invalid action calls must not succeed.
do $$
begin
  perform * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_b')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'restore');
  raise exception 'Cross-workspace mutation unexpectedly succeeded';
exception when others then if sqlerrm = 'Cross-workspace mutation unexpectedly succeeded' then raise; end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('vaeroex.lifecycle.outsider_id'), true);
do $$
begin
  perform * from public.update_source_file_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.file_id')::uuid, 'restore');
  raise exception 'Unauthorized mutation unexpectedly succeeded';
exception when others then if sqlerrm = 'Unauthorized mutation unexpectedly succeeded' then raise; end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('vaeroex.lifecycle.owner_id'), true);
do $$
begin
  perform * from public.update_business_signal_lifecycle(current_setting('vaeroex.lifecycle.workspace_a')::uuid, current_setting('vaeroex.lifecycle.signal_id')::uuid, 'purge');
  raise exception 'Invalid action unexpectedly succeeded';
exception when others then if sqlerrm = 'Invalid action unexpectedly succeeded' then raise; end if;
end;
$$;

reset role;
select 'PASS: staging lifecycle validation complete; rolling back fixtures.' as result;
rollback;
