begin;

-- Uploaded originals are metered independently for every workspace. Decimal GB.
-- No chat, integration, extracted text, saved analysis or derived record is billed here.
create table private.workspace_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  file_id uuid not null unique default gen_random_uuid(),
  storage_path text not null unique,
  original_name text not null,
  display_name text not null,
  extension text not null,
  mime_type text not null,
  requested_bytes bigint not null check(requested_bytes between 1 and 26214400),
  folder_id uuid,
  state text not null default 'pending' check(state in ('pending','committing','completed','aborted')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
  completed_at timestamptz,
  cleanup_attempted_at timestamptz,
  unique(workspace_id,actor_id,request_id)
);
alter table private.workspace_upload_reservations enable row level security;
revoke all on private.workspace_upload_reservations from public,anon,authenticated,service_role;
create index workspace_upload_reservations_usage on private.workspace_upload_reservations(workspace_id,expires_at) where state='pending';

alter table public.file_uploads
  add column storage_missing_at timestamptz,
  add column trash_purge_after timestamptz,
  add column trash_legacy_protected boolean not null default false,
  add column storage_purge_requested_at timestamptz,
  add column storage_purge_attempted_at timestamptz,
  add column storage_purged_at timestamptz;

-- Preserve historical deleted originals indefinitely until separately approved
-- notice/recovery/export migration. Missing source metadata is retained for its
-- derived records and explicitly labeled; a nonexistent original is not a slot.
update public.file_uploads f set trash_legacy_protected=true where deleted_at is not null;
update public.file_uploads f set storage_missing_at=clock_timestamp()
where not exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name=f.storage_path);

create function private.workspace_storage_paid_packs_v1(p_workspace_id uuid)
returns integer language sql stable security definer set search_path='' as $$ select 0; $$;
revoke all on function private.workspace_storage_paid_packs_v1(uuid) from public,anon,authenticated,service_role;

create table private.workspace_storage_mutex (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 revision bigint not null default 0
);
alter table private.workspace_storage_mutex enable row level security;
revoke all on private.workspace_storage_mutex from public,anon,authenticated,service_role;

create function private.workspace_storage_lock_v1(p_workspace_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-storage:'||p_workspace_id::text,0));
  -- Revision also forces stale repeatable-read transactions to retry.
  insert into private.workspace_storage_mutex(workspace_id) values(p_workspace_id)
    on conflict(workspace_id) do update set revision=private.workspace_storage_mutex.revision+1;
end;
$$;
revoke all on function private.workspace_storage_lock_v1(uuid) from public,anon,authenticated,service_role;

-- Use Storage's existing (bucket_id, name COLLATE C) index. Storage owns its
-- schema; no ownership changes or custom indexes on managed tables are needed.
create index workspace_original_file_object_lookup on public.file_uploads(storage_bucket,storage_path);
create index workspace_original_files_usage on public.file_uploads(workspace_id)
 where storage_missing_at is null and storage_purged_at is null;

create function private.workspace_storage_counts_v1(p_workspace_id uuid)
returns table(used_bytes bigint,used_files bigint,reserved_bytes bigint,reserved_files bigint)
language sql volatile security definer set search_path='' as $$
  select
    coalesce((select sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end)
      from storage.objects o where o.bucket_id='workspace-files' and (o.name collate "C">=p_workspace_id::text||'/' and o.name collate "C"<p_workspace_id::text||'0')),0)::bigint,
    (select count(*) from public.file_uploads f where f.workspace_id=p_workspace_id
      and f.storage_missing_at is null and f.storage_purged_at is null),
    coalesce((select sum(r.requested_bytes) from private.workspace_upload_reservations r
      where r.workspace_id=p_workspace_id and r.state='pending' and r.expires_at>clock_timestamp()
      and not exists(select 1 from storage.objects o where o.bucket_id='workspace-files' and o.name=r.storage_path)),0)::bigint,
    (select count(*) from private.workspace_upload_reservations r
      where r.workspace_id=p_workspace_id and r.state='pending' and r.expires_at>clock_timestamp());
$$;
revoke all on function private.workspace_storage_counts_v1(uuid) from public,anon,authenticated,service_role;

create function public.reserve_workspace_upload_v1(
 p_workspace_id uuid,p_request_id uuid,p_original_name text,p_extension text,p_mime_type text,p_bytes bigint,p_folder_id uuid default null,p_display_name text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations; c record; packs integer; rid uuid:=gen_random_uuid();
begin
 if (select auth.uid()) is null or not public.can_contribute_workspace(p_workspace_id) then
   raise exception 'workspace_storage_writer_denied' using errcode='42501'; end if;
 if not private.workspace_entitlement_active_v1(p_workspace_id) then raise exception 'workspace_subscription_required' using errcode='42501'; end if;
 if (p_display_name is not null and (char_length(p_display_name) not between 1 and 255 or p_display_name ~ '[[:cntrl:]]')) or p_request_id is null or p_bytes is null or p_bytes not between 1 and 26214400
   or p_original_name is null or char_length(p_original_name) not between 1 and 255
   or p_original_name ~ '[[:cntrl:]]' or p_extension is null or p_extension not in ('csv','xlsx','xls','pdf','png','jpg','jpeg','docx')
   or p_mime_type is null or char_length(p_mime_type)>150 then raise exception 'workspace_upload_invalid' using errcode='22023'; end if;
 if p_folder_id is not null and not exists(select 1 from public.record_folders where id=p_folder_id and workspace_id=p_workspace_id and collection_type='files') then
   raise exception 'workspace_upload_folder_invalid' using errcode='23503'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 if exists(select 1 from storage.objects where bucket_id='workspace-files' and (name collate "C">=p_workspace_id::text||'/' and name collate "C"<p_workspace_id::text||'0') and (metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$')) then raise exception 'workspace_storage_reconciliation_required' using errcode='23514'; end if;
 select * into r from private.workspace_upload_reservations where workspace_id=p_workspace_id and actor_id=(select auth.uid()) and request_id=p_request_id;
 if found then
   if (r.original_name,r.extension,r.mime_type,r.requested_bytes,r.folder_id,r.display_name) is distinct from (p_original_name,p_extension,p_mime_type,p_bytes,p_folder_id,coalesce(p_display_name,p_original_name)) then
     raise exception 'workspace_upload_request_mismatch' using errcode='23514'; end if;
   if r.state='aborted' or (r.state='pending' and r.expires_at<=clock_timestamp()) then raise exception 'workspace_upload_expired' using errcode='23514'; end if;
 else
   select * into c from private.workspace_storage_counts_v1(p_workspace_id);
   packs:=private.workspace_storage_paid_packs_v1(p_workspace_id);
   if c.used_files+c.reserved_files+1>500+packs*500 then raise exception 'workspace_file_slots_reached' using errcode='23514'; end if;
   if c.used_bytes+c.reserved_bytes+p_bytes>15000000000::bigint+packs*10000000000::bigint then raise exception 'workspace_storage_bytes_reached' using errcode='23514'; end if;
   insert into private.workspace_upload_reservations(id,workspace_id,request_id,actor_id,storage_path,original_name,display_name,extension,mime_type,requested_bytes,folder_id)
     values(rid,p_workspace_id,p_request_id,(select auth.uid()),p_workspace_id::text||'/reserved/'||rid::text||'.'||p_extension,p_original_name,coalesce(p_display_name,p_original_name),p_extension,p_mime_type,p_bytes,p_folder_id) returning * into r;
 end if;
 return jsonb_build_object('reservation_id',r.id,'file_id',r.file_id,'storage_path',r.storage_path,'expires_at',r.expires_at,'bytes',r.requested_bytes,'state',r.state);
end;
$$;
revoke all on function public.reserve_workspace_upload_v1(uuid,uuid,text,text,text,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_workspace_upload_v1(uuid,uuid,text,text,text,bigint,uuid,text) to authenticated;

-- Storage signed upload tokens bypass RLS. Database triggers therefore validate
-- the immutable reserved path, actual bytes, lease and tombstone for every writer.
create function private.guard_workspace_original_object_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations; bytes bigint; workspace uuid;
begin
 if tg_op='DELETE' then
   if old.bucket_id<>'workspace-files' then return old; end if;
   if exists(select 1 from public.file_uploads f where f.storage_bucket=old.bucket_id and f.storage_path=old.name
      and (f.storage_purge_requested_at is null or f.deleted_at is null or f.trash_legacy_protected)) then
     raise exception 'workspace_original_delete_requires_purge' using errcode='42501'; end if;
   return old;
 end if;
 if new.bucket_id<>'workspace-files' then
   if tg_op='UPDATE' and old.bucket_id='workspace-files' then raise exception 'workspace_original_immutable' using errcode='23514'; end if;
   return new;
 end if;
 if tg_op='UPDATE' then
   if (new.bucket_id,new.name,new.metadata,new.version) is distinct from (old.bucket_id,old.name,old.metadata,old.version) then
     raise exception 'workspace_original_immutable' using errcode='23514'; end if;
   return new;
 end if;
 if new.metadata->>'size' is not null then
   if new.metadata->>'size' !~ '^[0-9]+$' then raise exception 'workspace_original_size_missing' using errcode='23514'; end if;
   bytes:=(new.metadata->>'size')::bigint;
 end if;
 select * into r from private.workspace_upload_reservations where storage_path=new.name;
 if not found then raise exception 'workspace_upload_reservation_required' using errcode='23514'; end if;
 perform private.workspace_storage_lock_v1(r.workspace_id);
 select * into r from private.workspace_upload_reservations where id=r.id;
 if r.state<>'pending' or r.expires_at<=clock_timestamp() or (bytes is not null and bytes<>r.requested_bytes) then
   raise exception 'workspace_upload_reservation_invalid' using errcode='23514'; end if;
 if (select auth.uid()) is not null and (select auth.role())='authenticated' and (select auth.uid())<>r.actor_id then
   raise exception 'workspace_upload_actor_denied' using errcode='42501'; end if;
 -- Storage runs a rolled-back INSERT without metadata when checking permission
 -- before signing/uploading. The reservation still authorizes that probe. Actual
 -- publication must include exact bytes, enforced again by the finalize RPC.
 return new;
end;
$$;
revoke all on function private.guard_workspace_original_object_v1() from public,anon,authenticated,service_role;
create trigger workspace_original_admission before insert or update or delete on storage.objects
 for each row execute function private.guard_workspace_original_object_v1();

-- Preserve the existing source lifecycle RPC and derived-memory propagation.
-- These invariants apply equally to direct REST updates and every definer RPC.
drop trigger workspace_persisted_usage_limit on public.file_uploads;
create function private.guard_workspace_original_file_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations; c record; packs integer;
begin
 if tg_op='DELETE' then
   if not exists(select 1 from public.workspaces where id=old.workspace_id) then return old; end if;
   -- Customer permanent deletion removes the original, never the source row:
   -- deleting this row would cascade to imported/derived records.
   if (select auth.role())='authenticated' then raise exception 'workspace_source_metadata_retained' using errcode='42501'; end if;
   if exists(select 1 from storage.objects where bucket_id=old.storage_bucket and name=old.storage_path) then
     raise exception 'workspace_original_retention_required' using errcode='23514'; end if;
   return old;
 end if;
 perform private.workspace_storage_lock_v1(new.workspace_id);
 if tg_op='INSERT' then
   select * into r from private.workspace_upload_reservations where file_id=new.id and workspace_id=new.workspace_id;
   if not found or r.state<>'committing' or (new.storage_path,new.storage_bucket,new.file_size_bytes,new.created_by) is distinct from (r.storage_path,'workspace-files'::text,r.requested_bytes,r.actor_id) then
     raise exception 'workspace_file_commit_required' using errcode='23514'; end if;
   if new.deleted_at is not null or new.storage_missing_at is not null or new.storage_purged_at is not null or new.trash_legacy_protected then raise exception 'workspace_file_commit_invalid' using errcode='23514'; end if;
   return new;
 end if;
 if (new.workspace_id,new.storage_bucket,new.storage_path,new.file_size_bytes,new.created_by) is distinct from (old.workspace_id,old.storage_bucket,old.storage_path,old.file_size_bytes,old.created_by) then
   raise exception 'workspace_original_identity_immutable' using errcode='23514'; end if;
 if (select auth.role())='authenticated' and (new.deleted_at,new.archived_at) is distinct from (old.deleted_at,old.archived_at)
   and not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=(select auth.uid()) and status='active' and role in ('owner','admin','manager')) then
   raise exception 'workspace_storage_retention_manager_required' using errcode='42501'; end if;
 if (select auth.role())='authenticated' and (new.storage_missing_at,new.storage_purged_at,new.storage_purge_requested_at,new.storage_purge_attempted_at,new.trash_legacy_protected,new.trash_purge_after) is distinct from (old.storage_missing_at,old.storage_purged_at,old.storage_purge_requested_at,old.storage_purge_attempted_at,old.trash_legacy_protected,old.trash_purge_after) then
   raise exception 'workspace_storage_lifecycle_server_only' using errcode='42501'; end if;
 if old.deleted_at is null and new.deleted_at is not null then
   new.deleted_at:=clock_timestamp(); new.trash_purge_after:=new.deleted_at+interval '30 days';
   new.trash_legacy_protected:=false;
 elsif old.deleted_at is not null and new.deleted_at is null then
   if old.storage_purge_requested_at is not null or old.storage_purged_at is not null or old.storage_missing_at is not null
      or not exists(select 1 from storage.objects where bucket_id=old.storage_bucket and name=old.storage_path) then
     raise exception 'workspace_source_unavailable' using errcode='23514'; end if;
   -- Retained originals in Trash already consume both bytes and a slot.
   -- Restoring one adds no stored object or slot and is allowed after downgrade.
   new.trash_purge_after:=null; new.trash_legacy_protected:=false;
 elsif old.deleted_at is not null then new.deleted_at:=old.deleted_at;
 end if;
 return new;
end;
$$;
revoke all on function private.guard_workspace_original_file_v1() from public,anon,authenticated,service_role;
create trigger workspace_original_admission before insert or update or delete on public.file_uploads
 for each row execute function private.guard_workspace_original_file_v1();

create function public.inspect_workspace_upload_v1(p_workspace_id uuid,p_reservation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_upload_server_only' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and status='active' and role in ('owner','admin','manager','staff')) then raise exception 'workspace_upload_actor_denied' using errcode='42501'; end if;
 select * into r from private.workspace_upload_reservations where workspace_id=p_workspace_id and id=p_reservation_id and actor_id=p_actor_id;
 if not found then raise exception 'workspace_upload_missing' using errcode='23514'; end if;
 return jsonb_build_object('reservation_id',r.id,'state',r.state,'storage_path',r.storage_path,'bytes',r.requested_bytes,'original_name',r.original_name,'display_name',r.display_name,'extension',r.extension,'mime_type',r.mime_type,'folder_id',r.folder_id,'file_id',r.file_id,'expires_at',r.expires_at);
end;
$$;
revoke all on function public.inspect_workspace_upload_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_workspace_upload_v1(uuid,uuid,uuid) to service_role;

create function public.finalize_workspace_upload_v1(p_workspace_id uuid,p_reservation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations; actual_bytes bigint; c record; packs integer;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_upload_server_only' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and status='active' and role in ('owner','admin','manager','staff')) then
   raise exception 'workspace_upload_actor_denied' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 select * into r from private.workspace_upload_reservations where id=p_reservation_id and workspace_id=p_workspace_id and actor_id=p_actor_id;
 if not found then raise exception 'workspace_upload_missing' using errcode='23514'; end if;
 if r.state='completed' then return jsonb_build_object('file_id',r.file_id,'storage_path',r.storage_path,'completed',true); end if;
 if r.state<>'pending' or r.expires_at<=clock_timestamp() then raise exception 'workspace_upload_expired' using errcode='23514'; end if;
 select (metadata->>'size')::bigint into actual_bytes from storage.objects where bucket_id='workspace-files' and name=r.storage_path;
 if actual_bytes is distinct from r.requested_bytes then raise exception 'workspace_upload_object_mismatch' using errcode='23514'; end if;
 -- Recheck after paid capacity expired/cancelled while this upload was in flight.
 select * into c from private.workspace_storage_counts_v1(p_workspace_id);
 packs:=private.workspace_storage_paid_packs_v1(p_workspace_id);
 if c.used_files+c.reserved_files>500+packs*500 or c.used_bytes+c.reserved_bytes>15000000000::bigint+packs*10000000000::bigint then
   raise exception 'workspace_upload_allowance_changed' using errcode='23514'; end if;
 update private.workspace_upload_reservations set state='committing' where id=r.id;
 insert into public.file_uploads(id,workspace_id,folder_id,original_name,display_name,file_extension,mime_type,file_size_bytes,storage_bucket,storage_path,created_by,import_status,metadata_json)
 values(r.file_id,r.workspace_id,r.folder_id,r.original_name,r.display_name,r.extension,r.mime_type,r.requested_bytes,'workspace-files',r.storage_path,r.actor_id,
   case when r.extension in ('csv','xlsx') then 'ready' else 'not_imported' end,
   jsonb_build_object('upload_method','direct_reserved_upload','can_import',r.extension in ('csv','xlsx'),
    'can_analyze',r.extension in ('csv','xlsx','pdf','docx','png','jpg','jpeg'),
    'supported_import_types',case when r.extension in ('csv','xlsx') then '["kpi","metrics"]'::jsonb else '[]'::jsonb end,
    'extraction_support',case when r.extension in ('csv','xlsx') then 'Spreadsheet rows can be parsed, analyzed, and imported after review.'
      when r.extension in ('pdf','docx') then 'Text can be extracted for analysis and report creation when the document contains readable text.'
      else 'Image OCR and visual analysis are supported through Vaeroex.' end));
 update private.workspace_upload_reservations set state='completed',completed_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('file_id',r.file_id,'storage_path',r.storage_path,'completed',true);
end;
$$;
revoke all on function public.finalize_workspace_upload_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.finalize_workspace_upload_v1(uuid,uuid,uuid) to service_role;

create function public.abort_workspace_upload_v1(p_workspace_id uuid,p_reservation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r private.workspace_upload_reservations;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_upload_server_only' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and status='active') then raise exception 'workspace_upload_actor_denied' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 update private.workspace_upload_reservations set state='aborted' where id=p_reservation_id and workspace_id=p_workspace_id and actor_id=p_actor_id and state='pending' returning * into r;
 return jsonb_build_object('storage_path',r.storage_path,'aborted',r.id is not null);
end;
$$;
revoke all on function public.abort_workspace_upload_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.abort_workspace_upload_v1(uuid,uuid,uuid) to service_role;

-- Purge is a durable request followed by Storage API removal and finalization.
-- Never DELETE storage.objects directly: the Storage API deletes actual bytes.
create function public.request_workspace_file_purge_v1(p_workspace_id uuid,p_file_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare f public.file_uploads;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=(select auth.uid()) and status='active' and role in ('owner','admin','manager')) then raise exception 'workspace_purge_manager_required' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 select * into f from public.file_uploads where workspace_id=p_workspace_id and id=p_file_id for update;
 if not found or f.deleted_at is null then raise exception 'workspace_purge_trash_required' using errcode='23514'; end if;
 if f.trash_legacy_protected then raise exception 'workspace_historical_trash_protected' using errcode='23514'; end if;
 -- authenticated cannot forge protected lifecycle columns even inside this RPC;
 -- service finalizer records the durable authorization below.
 return jsonb_build_object('file_id',f.id,'storage_path',f.storage_path,'deleted_at',f.deleted_at);
end;
$$;
revoke all on function public.request_workspace_file_purge_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_workspace_file_purge_v1(uuid,uuid) to authenticated;

create function public.mark_workspace_file_purge_v1(p_workspace_id uuid,p_file_id uuid,p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare f public.file_uploads;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_purge_server_only' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_id and status='active' and role in ('owner','admin','manager')) then raise exception 'workspace_purge_actor_denied' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 select * into f from public.file_uploads where workspace_id=p_workspace_id and id=p_file_id for update;
 if not found or f.deleted_at is null or f.trash_legacy_protected then raise exception 'workspace_purge_unavailable' using errcode='23514'; end if;
 update public.file_uploads set storage_purge_requested_at=coalesce(storage_purge_requested_at,clock_timestamp()),storage_purge_attempted_at=clock_timestamp() where id=f.id;
 return jsonb_build_object('file_id',f.id,'storage_path',f.storage_path);
end;
$$;
revoke all on function public.mark_workspace_file_purge_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.mark_workspace_file_purge_v1(uuid,uuid,uuid) to service_role;

create function public.finalize_workspace_file_purge_v1(p_workspace_id uuid,p_file_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare f public.file_uploads;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_purge_server_only' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 select * into f from public.file_uploads where workspace_id=p_workspace_id and id=p_file_id for update;
 if not found or f.storage_purge_requested_at is null or f.deleted_at is null or f.trash_legacy_protected then raise exception 'workspace_purge_unavailable' using errcode='23514'; end if;
 if exists(select 1 from storage.objects where bucket_id=f.storage_bucket and name=f.storage_path) then return false; end if;
 update public.file_uploads set storage_purged_at=coalesce(storage_purged_at,clock_timestamp()),storage_missing_at=coalesce(storage_missing_at,clock_timestamp()) where id=f.id;
 return true;
end;
$$;
revoke all on function public.finalize_workspace_file_purge_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.finalize_workspace_file_purge_v1(uuid,uuid) to service_role;

create function public.workspace_storage_cleanup_batch_v1(p_limit integer default 100)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare item record; files jsonb:='[]'; uploads jsonb:='[]';
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_cleanup_server_only' using errcode='42501'; end if;
 if p_limit not between 1 and 100 then raise exception 'workspace_cleanup_limit_invalid' using errcode='22023'; end if;
 for item in select f.workspace_id,f.id,f.storage_path from public.file_uploads f
   where f.deleted_at is not null and not f.trash_legacy_protected and f.storage_purged_at is null
    and (f.trash_purge_after<=clock_timestamp() or f.storage_purge_requested_at is not null)
   order by f.storage_purge_attempted_at nulls first,f.trash_purge_after,f.id limit p_limit
 loop
   perform private.workspace_storage_lock_v1(item.workspace_id);
   update public.file_uploads set storage_purge_requested_at=coalesce(storage_purge_requested_at,clock_timestamp()),storage_purge_attempted_at=clock_timestamp()
    where id=item.id and deleted_at is not null and not trash_legacy_protected and storage_purged_at is null
      and (trash_purge_after<=clock_timestamp() or storage_purge_requested_at is not null);
   if found then files:=files||jsonb_build_array(to_jsonb(item)); end if;
 end loop;
 for item in select r.workspace_id,r.id,r.storage_path from private.workspace_upload_reservations r
   where (r.state='aborted' or (r.state='pending' and r.expires_at<=clock_timestamp()))
    and exists(select 1 from storage.objects o where o.bucket_id='workspace-files' and o.name=r.storage_path)
   order by r.cleanup_attempted_at nulls first,r.created_at,r.id limit p_limit
 loop
   perform private.workspace_storage_lock_v1(item.workspace_id);
   update private.workspace_upload_reservations set state='aborted',cleanup_attempted_at=clock_timestamp() where id=item.id and (state='aborted' or (state='pending' and expires_at<=clock_timestamp()));
   uploads:=uploads||jsonb_build_array(to_jsonb(item));
 end loop;
 return jsonb_build_object('files',files,'uploads',uploads);
end;
$$;
revoke all on function public.workspace_storage_cleanup_batch_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.workspace_storage_cleanup_batch_v1(integer) to service_role;

create function public.reconcile_workspace_storage_v1(p_workspace_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare missing integer; restored integer; unknown_sizes integer;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'workspace_reconcile_server_only' using errcode='42501'; end if;
 perform private.workspace_storage_lock_v1(p_workspace_id);
 update public.file_uploads f set storage_missing_at=coalesce(storage_missing_at,clock_timestamp()) where workspace_id=p_workspace_id
   and not exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name=f.storage_path);
 get diagnostics missing=row_count;
 update public.file_uploads f set storage_missing_at=null where workspace_id=p_workspace_id and storage_missing_at is not null and storage_purged_at is null
   and exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name=f.storage_path);
 get diagnostics restored=row_count;
 select count(*) into unknown_sizes from storage.objects o where o.bucket_id='workspace-files' and (o.name collate "C">=p_workspace_id::text||'/' and o.name collate "C"<p_workspace_id::text||'0')
  and (o.metadata->>'size' is null or o.metadata->>'size' !~ '^[0-9]+$');
 return jsonb_build_object('missing_files',missing,'recovered_files',restored,'unknown_size_objects',unknown_sizes,'measured_at',clock_timestamp());
end;
$$;
revoke all on function public.reconcile_workspace_storage_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_workspace_storage_v1(uuid) to service_role;

create function public.workspace_storage_usage_v1(p_workspace_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c record; packs integer; breakdown jsonb; largest jsonb; separate jsonb:='[]'; item record; size_estimate bigint; records bigint;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=(select auth.uid()) and status='active') then
   raise exception 'workspace_storage_member_denied' using errcode='42501'; end if;
 select * into c from private.workspace_storage_counts_v1(p_workspace_id);
 packs:=private.workspace_storage_paid_packs_v1(p_workspace_id);
 with entries as (
   select f.*,coalesce((o.metadata->>'size')::bigint,0) bytes,case when f.deleted_at is not null and f.trash_legacy_protected then 'historical_trash'
    when f.deleted_at is not null then 'trash' when f.archived_at is not null then 'archived' else 'active' end state
   from public.file_uploads f left join storage.objects o on o.bucket_id=f.storage_bucket and o.name=f.storage_path
   where f.workspace_id=p_workspace_id and f.storage_purged_at is null
 ), grouped as (select state,jsonb_build_object('bytes',sum(bytes),'files',count(*) filter(where bytes>0)) v from entries group by state)
 select coalesce(jsonb_object_agg(state,v),'{}') into breakdown from grouped;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into largest from (
  select f.id,f.display_name,coalesce((o.metadata->>'size')::bigint,0) bytes,
    case when f.deleted_at is not null and f.trash_legacy_protected then 'historical_trash' when f.deleted_at is not null then 'trash' when f.archived_at is not null then 'archived' else 'active' end state,
    f.deleted_at,f.trash_purge_after purge_after,f.trash_legacy_protected legacy_protected,f.storage_missing_at is not null storage_missing,
    f.storage_purge_requested_at is not null deletion_pending
  from public.file_uploads f left join storage.objects o on o.bucket_id=f.storage_bucket and o.name=f.storage_path
  where f.workspace_id=p_workspace_id and f.storage_purged_at is null order by coalesce((o.metadata->>'size')::bigint,0) desc,f.id limit 50
 ) t;
 -- pg_column_size estimates logical row payload only, excluding indexes/TOAST
 -- overhead/free space. Separate labels deliberately are not a quota or invoice.
 for item in select * from (values
   ('public','google_sheets_source_rows','Google Sheets source rows'),('public','google_sheets_source_versions','Google Sheets version history'),
   ('public','vsi_exchanges','Private chat history'),('public','ai_agent_runs','Saved analyses'),
   ('public','business_memory_chunks','Business Memory'),
   ('square_customer_private','payments','Square synced payments'),
   ('private','external_source_records','QuickBooks synced source records'),
   ('private','external_source_record_versions','QuickBooks synced version history'),('public','file_import_rows','Imported and derived rows')
 ) v(schema_name,table_name,label)
 loop
  if exists(select 1 from information_schema.columns where table_schema=item.schema_name and table_name=item.table_name and column_name='workspace_id') then
   execute format('select coalesce(sum(pg_column_size(t)),0)::bigint,count(*) from %I.%I t where workspace_id=$1%s',item.schema_name,item.table_name,case when item.schema_name='private' and item.table_name in ('external_source_records','external_source_record_versions') then ' and provider_key=''quickbooks_online'' and source_kind=''provider''' else '' end)
     into size_estimate,records using p_workspace_id;
   separate:=separate||jsonb_build_array(jsonb_build_object('label',item.label,'estimated_bytes',size_estimate,'records',records,'estimate',true));
  else
   separate:=separate||jsonb_build_array(jsonb_build_object('label',item.label,'estimated_bytes',null,'records',null,'estimate',true,'explanation','This connection or data type is not currently measurable in this environment. It remains outside uploaded-file capacity.'));
  end if;
 end loop;
 return jsonb_build_object('workspace_id',p_workspace_id,'included_bytes',15000000000::bigint,'included_files',500,'paid_packs',packs,
   'allowance_bytes',15000000000::bigint+packs*10000000000::bigint,'allowance_files',500+packs*500,
   'used_bytes',c.used_bytes,'used_files',c.used_files,'reserved_bytes',c.reserved_bytes,'reserved_files',c.reserved_files,
   'available_bytes',greatest(0,15000000000::bigint+packs*10000000000::bigint-c.used_bytes-c.reserved_bytes),
   'available_files',greatest(0,500+packs*500-c.used_files-c.reserved_files),
   'active',coalesce(breakdown->'active','{"bytes":0,"files":0}'), 'archived',coalesce(breakdown->'archived','{"bytes":0,"files":0}'),
   'trash',coalesce(breakdown->'trash','{"bytes":0,"files":0}'),'historical_trash',coalesce(breakdown->'historical_trash','{"bytes":0,"files":0}'),
   'unlinked_bytes',(select coalesce(sum((o.metadata->>'size')::bigint),0) from storage.objects o where o.bucket_id='workspace-files' and (o.name collate "C">=p_workspace_id::text||'/' and o.name collate "C"<p_workspace_id::text||'0')
     and not exists(select 1 from public.file_uploads f where f.storage_bucket=o.bucket_id and f.storage_path=o.name)),
   'missing_files',(select count(*) from public.file_uploads where workspace_id=p_workspace_id and storage_missing_at is not null and storage_purged_at is null),
   'largest_files',largest,'separate_data',separate,'measured_at',clock_timestamp());
end;
$$;
revoke all on function public.workspace_storage_usage_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.workspace_storage_usage_v1(uuid) to authenticated;

create function public.workspace_storage_trash_v1(p_workspace_id uuid,p_page integer default 1)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare entries jsonb; total bigint;
begin
 if (select auth.uid()) is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=(select auth.uid()) and status='active') then raise exception 'workspace_storage_member_denied' using errcode='42501'; end if;
 if p_page is null or p_page not between 1 and 100000 then raise exception 'workspace_trash_page_invalid' using errcode='22023'; end if;
 select count(*) into total from public.file_uploads where workspace_id=p_workspace_id and deleted_at is not null and storage_purged_at is null;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into entries from (
  select f.id,f.display_name,coalesce((o.metadata->>'size')::bigint,0) bytes,
   case when f.trash_legacy_protected then 'historical_trash' else 'trash' end state,
   f.deleted_at,f.trash_purge_after purge_after,f.trash_legacy_protected legacy_protected,
   f.storage_missing_at is not null storage_missing,f.storage_purge_requested_at is not null deletion_pending
  from public.file_uploads f left join storage.objects o on o.bucket_id=f.storage_bucket and o.name=f.storage_path
  where f.workspace_id=p_workspace_id and f.deleted_at is not null and f.storage_purged_at is null
  order by f.deleted_at desc,f.id limit 25 offset (p_page-1)*25
 ) t;
 return jsonb_build_object('files',entries,'total',total,'page',p_page,'page_size',25);
end;
$$;
revoke all on function public.workspace_storage_trash_v1(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.workspace_storage_trash_v1(uuid,integer) to authenticated;

commit;
