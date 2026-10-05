begin;

-- Durable acceptance, not an expiring lease. An uncertain worker must never be
-- replayed automatically. Historical records and preparation generations remain.
create table private.file_import_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null,
  import_id uuid not null,
  preparation_key text not null,
  actor_id uuid not null,
  approved_mapping jsonb not null,
  approved_row_ids uuid[] not null,
  prior_imported_at timestamptz,
  status text not null default 'running' check(status in ('running','reconciliation_required','completed')),
  accepted_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(workspace_id,import_id,preparation_key)
);
create unique index file_import_attempts_unresolved_source_idx on private.file_import_attempts(workspace_id,file_id)
  where status<>'completed';
alter table private.file_import_attempts enable row level security;
revoke all on private.file_import_attempts from public,anon,authenticated,service_role;
alter table public.file_imports add column recovery_status text not null default 'not_started'
  check(recovery_status in ('not_started','running','reconciliation_required','completed'));

create function private.guard_file_import_recovery_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_ids uuid[]; workspace_ids uuid[]; unresolved boolean;
begin
  source_ids:=case when tg_op='DELETE' then array[old.file_upload_id]
    when tg_op='INSERT' then array[new.file_upload_id] else array[old.file_upload_id,new.file_upload_id] end;
  workspace_ids:=case when tg_op='DELETE' then array[old.workspace_id]
    when tg_op='INSERT' then array[new.workspace_id] else array[old.workspace_id,new.workspace_id] end;
  -- Lock the source so claiming and preparing cannot pass each other. Updates
  -- retain current row status/diagnostics, but freeze approved source identity.
  perform 1 from public.file_uploads where id=any(source_ids) and workspace_id=any(workspace_ids) order by id for update;
  if not found and tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  select exists(select 1 from private.file_import_attempts a where a.file_id=any(source_ids) and a.workspace_id=any(workspace_ids) and a.status<>'completed') into unresolved;
  if unresolved then
    if tg_op in ('INSERT','DELETE') then
      raise exception 'Accepted import work requires reconciliation before preparing or retrying this source.' using errcode='55000';
    end if;
    if tg_table_name='file_import_rows' then
      if new.workspace_id is distinct from old.workspace_id or new.file_upload_id is distinct from old.file_upload_id
        or new.import_id is distinct from old.import_id or new.row_number is distinct from old.row_number
        or new.data_json is distinct from old.data_json or new.mapped_data_json is distinct from old.mapped_data_json then
        raise exception 'Accepted import source rows are frozen pending reconciliation.' using errcode='55000';
      end if;
    else
      if new.workspace_id is distinct from old.workspace_id or new.file_upload_id is distinct from old.file_upload_id
        or new.mapping_json->>'preparation_id' is distinct from old.mapping_json->>'preparation_id' then
        raise exception 'Accepted import preparation is frozen pending reconciliation.' using errcode='55000';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_table_name='file_imports' then
    -- This UI projection cannot be forged through an ordinary table update.
    select coalesce((select a.status from private.file_import_attempts a where a.workspace_id=new.workspace_id
      and a.import_id=new.id and a.preparation_key=coalesce(new.mapping_json->>'preparation_id',new.id::text)),'not_started') into new.recovery_status;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_file_import_recovery_v1() from public,anon,authenticated,service_role;
create trigger guard_file_import_recovery before insert or update or delete on public.file_imports
  for each row execute function private.guard_file_import_recovery_v1();
create trigger guard_file_import_row_recovery before insert or update or delete on public.file_import_rows
  for each row execute function private.guard_file_import_recovery_v1();

create function public.begin_file_import_attempt_v1(p_workspace_id uuid,p_file_id uuid,p_import_id uuid,p_approved_mapping jsonb,p_row_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.file_uploads; i public.file_imports; a private.file_import_attempts; preparation text;
begin
  if (select auth.role()) is distinct from 'authenticated' or auth.uid() is null
    or not public.can_edit_operations(p_workspace_id) or not private.workspace_entitlement_active_v1(p_workspace_id) then
    raise exception 'Import approval requires an entitled workspace operator.' using errcode='42501';
  end if;
  perform 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()
    and status='active' and role in ('owner','admin','manager') for share;
  if not found then raise exception 'Import authority was withdrawn.' using errcode='42501'; end if;
  select * into f from public.file_uploads where id=p_file_id and workspace_id=p_workspace_id for update;
  if not found or f.archived_at is not null or f.deleted_at is not null or f.processing_status='processing' then
    raise exception 'The import source is unavailable or already processing.' using errcode='42501';
  end if;
  select * into i from public.file_imports where id=p_import_id and file_upload_id=p_file_id and workspace_id=p_workspace_id for update;
  if not found or i.import_type not in ('kpi','metrics') then raise exception 'Import unavailable.' using errcode='42501'; end if;
  preparation:=coalesce(i.mapping_json->>'preparation_id',i.id::text);
  select * into a from private.file_import_attempts where workspace_id=p_workspace_id and file_id=p_file_id
    and (status<>'completed' or (import_id=p_import_id and preparation_key=preparation))
    order by accepted_at desc,id desc limit 1;
  if found then return jsonb_build_object('admitted',false,'status',a.status,'attempt_id',a.id); end if;
  if jsonb_typeof(p_approved_mapping) is distinct from 'object' or cardinality(p_row_ids) is null
    or cardinality(p_row_ids) not between 1 and 1000
    or (select count(distinct x) from unnest(p_row_ids) x)<>cardinality(p_row_ids)
    or (select count(*) from public.file_import_rows r where r.workspace_id=p_workspace_id and r.file_upload_id=p_file_id
      and r.import_id=p_import_id and r.id=any(p_row_ids) and r.status='staged')<>cardinality(p_row_ids) then
    raise exception 'Reviewed import rows could not be verified.' using errcode='22023';
  end if;
  insert into private.file_import_attempts(workspace_id,file_id,import_id,preparation_key,actor_id,approved_mapping,approved_row_ids,prior_imported_at)
    values(p_workspace_id,p_file_id,p_import_id,preparation,auth.uid(),p_approved_mapping,p_row_ids,i.imported_at) returning * into a;
  update public.file_imports set recovery_status='running' where id=i.id and workspace_id=p_workspace_id;
  return jsonb_build_object('admitted',true,'status',a.status,'attempt_id',a.id);
end;
$$;

create function public.reconcile_file_import_attempt_v1(p_workspace_id uuid,p_file_id uuid,p_import_id uuid default null,p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.file_uploads; i public.file_imports; a private.file_import_attempts; states jsonb; kpis integer; metrics integer; memory integer; complete boolean;
begin
  -- Recovery remains readable after subscription expiry. It never submits data,
  -- clears a partial attempt, or grants a new admission.
  if (select auth.role()) is distinct from 'authenticated' or auth.uid() is null or not public.can_edit_operations(p_workspace_id) then
    raise exception 'Import reconciliation requires a workspace operator.' using errcode='42501';
  end if;
  perform 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid()
    and status='active' and role in ('owner','admin','manager') for share;
  if not found then raise exception 'Import authority was withdrawn.' using errcode='42501'; end if;
  select * into f from public.file_uploads where id=p_file_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Import source unavailable.' using errcode='42501'; end if;
  select * into a from private.file_import_attempts where workspace_id=p_workspace_id and file_id=p_file_id
    and (p_import_id is null or import_id=p_import_id) order by accepted_at desc,id desc limit 1 for update;
  if not found then return jsonb_build_object('status','not_started'); end if;
  select * into i from public.file_imports where id=a.import_id and workspace_id=p_workspace_id;
  select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) into states from
    (select status,count(*) n from public.file_import_rows where workspace_id=p_workspace_id and import_id=a.import_id and id=any(a.approved_row_ids) group by status) s;
  select count(*) into kpis from public.kpis where workspace_id=p_workspace_id and source_file_id=p_file_id and import_id=a.import_id;
  select count(*) into metrics from public.operational_metrics where workspace_id=p_workspace_id and source_file_id=p_file_id and import_id=a.import_id;
  select count(*) into memory from public.business_memory_chunks where workspace_id=p_workspace_id and source_file_id=p_file_id
    and source_type='file' and source_metadata->>'import_id'=a.import_id::text and archived_at is null and deleted_at is null;
  complete:=i.status='completed' and i.imported_at is not null and i.imported_at is distinct from a.prior_imported_at
    and f.import_status='imported' and f.metadata_json#>>'{last_import,import_id}'=a.import_id::text
    and nullif(f.metadata_json#>>'{last_import,imported_at}','')::timestamptz=i.imported_at
    and (select count(*) from public.file_import_rows r where r.workspace_id=p_workspace_id and r.import_id=a.import_id
      and r.id=any(a.approved_row_ids) and r.status in ('imported','indexed','skipped_duplicate'))=cardinality(a.approved_row_ids);
  if a.status<>'completed' then
    if complete then
      update private.file_import_attempts set status='completed',completed_at=clock_timestamp() where id=a.id returning * into a;
    elsif p_failed then
      update private.file_import_attempts set status='reconciliation_required' where id=a.id returning * into a;
    end if;
    -- The normal public entitlement trigger deliberately blocks expired writes.
    -- Receipt state/readback remains authoritative even if this UI projection
    -- cannot be refreshed until billing recovery is completed.
    if private.workspace_entitlement_active_v1(p_workspace_id) then
      update public.file_imports set recovery_status=a.status where id=a.import_id and workspace_id=p_workspace_id;
    end if;
  end if;
  return jsonb_build_object('status',a.status,'attempt_id',a.id,'accepted_at',a.accepted_at,'completed_at',a.completed_at,
    'approved_rows',cardinality(a.approved_row_ids),'row_outcomes',states,'kpi_records',kpis,'metric_records',metrics,'active_memory_chunks',memory,
    'requires_operator_review',a.status<>'completed');
end;
$$;
revoke all on function public.begin_file_import_attempt_v1(uuid,uuid,uuid,jsonb,uuid[]),public.reconcile_file_import_attempt_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.begin_file_import_attempt_v1(uuid,uuid,uuid,jsonb,uuid[]),public.reconcile_file_import_attempt_v1(uuid,uuid,uuid,boolean) to authenticated;
commit;
