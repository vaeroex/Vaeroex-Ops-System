-- Durable, task-bound Production validation. No provider calls, facts, financial
-- authority, customer KPI writes, credential grants, or sandbox backfill.
begin;

-- The same native leased read supports both environments, never cross-environment
-- authority. In particular, an old task cannot read after connection replacement.
create or replace function public.read_provider_external_source_record_state_v1(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_task private.integration_sync_tasks;
  v_mapping private.provider_entity_mappings;
  v_source private.external_source_records;
  v_version private.external_source_record_versions;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if not coalesce(private.jsonb_has_exact_keys_v1(p_command,array['contractVersion','taskId','leaseId',
      'leaseOwnerFingerprint','mappingId','providerRecordType','providerRecordId'])
    and p_command->>'contractVersion'='integration_provider_source_state_read_v1'
    and private.is_sha256_fingerprint_v1(p_command->>'leaseOwnerFingerprint')
    and private.is_bounded_identifier_v1(p_command->>'providerRecordType')
    and private.is_bounded_identifier_v1(p_command->>'providerRecordId'),false) then
    raise exception using errcode='22023',message='provider_source_state_read_payload_invalid';
  end if;
  select * into v_task from private.integration_sync_tasks where id=(p_command->>'taskId')::uuid for share;
  if not found or v_task.state<>'leased' or v_task.queue_class not in ('provider_interactive','provider_bulk')
    or v_task.lease_id is distinct from (p_command->>'leaseId')::uuid
    or v_task.lease_owner_fingerprint is distinct from private.sha256_fingerprint_bytes_v1(p_command->>'leaseOwnerFingerprint')
    or not coalesce(v_task.lease_expires_at>transaction_timestamp(),false)
    or v_task.control_metadata->>'mappingId' is distinct from p_command->>'mappingId'
    or v_task.provider_key<>'quickbooks_online' or v_task.provider_environment not in ('sandbox','production') then
    raise exception using errcode='42501',message='provider_source_state_read_denied';
  end if;
  perform c.id from private.integration_connections c where c.id=v_task.connection_id
    and c.workspace_id=v_task.workspace_id and c.business_entity_id=v_task.business_entity_id
    and c.connection_generation=v_task.connection_generation and c.provider_key=v_task.provider_key
    and c.provider_environment=v_task.provider_environment and c.status in ('initializing','active','degraded') for share;
  if not found then raise exception using errcode='42501',message='provider_source_state_read_denied'; end if;
  select * into v_mapping from private.provider_entity_mappings m where m.id=(p_command->>'mappingId')::uuid
    and m.workspace_id=v_task.workspace_id and m.business_entity_id=v_task.business_entity_id
    and m.connection_id=v_task.connection_id and m.provider_key=v_task.provider_key
    and m.provider_environment=v_task.provider_environment and m.status='active' for share;
  if not found then raise exception using errcode='42501',message='provider_source_state_read_denied'; end if;
  select * into v_source from private.external_source_records s where s.workspace_id=v_task.workspace_id
    and s.business_entity_id=v_task.business_entity_id and s.connection_id=v_task.connection_id and s.mapping_id=v_mapping.id
    and s.provider_key=v_task.provider_key and s.provider_record_type=p_command->>'providerRecordType'
    and s.provider_record_id=p_command->>'providerRecordId';
  if not found then return jsonb_build_object('state','missing'); end if;
  select * into strict v_version from private.external_source_record_versions
    where source_record_id=v_source.id and id=v_source.current_version_id;
  return jsonb_build_object('state','available','sourceRecordId',v_source.id,'currentVersionId',v_version.id,
    'immutableVersion',v_version.immutable_version,'sourceFingerprint','sha256:'||encode(v_version.source_fingerprint,'hex'),
    'validationState',v_version.validation_state,'changeKind',v_version.change_kind,
    'providerVersionReference',v_version.provider_version_reference,'normalizedProjection',v_version.normalized_projection);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='provider_source_state_read_payload_invalid';
end;
$function$;
revoke all on function public.read_provider_external_source_record_state_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_provider_external_source_record_state_v1(jsonb) to integration_provider_source_authority;

-- Production source writes use the same exact realm binding as sandbox. The
-- previous trigger admitted sandbox mappings only, even on Production sources.
create or replace function private.enforce_qbo_phase_8b_source_realm_binding_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_mapping private.provider_entity_mappings;
begin
  if new.source_kind <> 'provider' or new.provider_key <> 'quickbooks_online'
    or new.normalized_projection is null then return new; end if;
  select m.* into v_mapping from private.external_source_records s
    join private.provider_entity_mappings m on m.id = s.mapping_id and m.workspace_id = s.workspace_id
      and m.business_entity_id = s.business_entity_id and m.connection_id = s.connection_id
    where s.id = new.source_record_id and s.workspace_id = new.workspace_id
      and s.business_entity_id = new.business_entity_id and s.connection_id = new.connection_id
      and s.provider_key = 'quickbooks_online' and m.provider_key = 'quickbooks_online'
      and m.provider_environment in ('sandbox','production')
      and m.provider_environment = new.normalized_projection #>> '{provider,sourceEnvironment}'
      and m.status = 'active' for share of m;
  if not found or not coalesce(private.is_bounded_identifier_v1(new.normalized_projection #>> '{provider,realmId}'), false)
    or new.normalized_projection #>> '{provider,providerKey}' is distinct from 'quickbooks_online'
    or v_mapping.provider_entity_reference_fingerprint is distinct from
      private.qbo_phase_8b_realm_fingerprint_v1(new.normalized_projection #>> '{provider,realmId}') then
    raise exception using errcode = '42501', message = 'qbo_provider_source_realm_binding_denied';
  end if;
  return new;
end;
$function$;

create table private.qbo_production_source_validation_work (
  source_version_id uuid primary key references private.external_source_record_versions(id) on delete restrict,
  source_record_id uuid not null references private.external_source_records(id) on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  mapping_id uuid not null references private.provider_entity_mappings(id) on delete restrict,
  task_id uuid not null references private.integration_sync_tasks(id) on delete restrict,
  sync_run_id uuid not null,
  stream_key text not null,
  dispatch_generation bigint not null check (dispatch_generation > 0),
  originating_lease_id uuid not null,
  originating_owner bytea not null check (octet_length(originating_owner) = 32),
  dispatcher_task_name text not null,
  delivery_fingerprint bytea not null check (octet_length(delivery_fingerprint) = 32),
  realm_fingerprint bytea not null check (octet_length(realm_fingerprint) = 32),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'valid', 'quarantined', 'superseded')),
  claim_id uuid,
  worker_fingerprint bytea check (worker_fingerprint is null or octet_length(worker_fingerprint) = 32),
  claim_expires_at timestamptz,
  validated_version_id uuid not null default gen_random_uuid(),
  validated_at timestamptz,
  completed_version_id uuid references private.external_source_record_versions(id) on delete restrict,
  result_fingerprint bytea,
  created_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  constraint qbo_validation_claim_shape check (
    (state = 'pending' and claim_id is null and worker_fingerprint is null and claim_expires_at is null)
    or (state <> 'pending' and claim_id is not null and worker_fingerprint is not null and claim_expires_at is not null)
  ),
  constraint qbo_validation_completion_shape check (
    (state in ('pending', 'claimed') and completed_at is null)
    or (state in ('valid', 'quarantined', 'superseded') and completed_at is not null)
  ),
  foreign key (workspace_id, business_entity_id, source_record_id, source_version_id)
    references private.external_source_record_versions(workspace_id, business_entity_id, source_record_id, id) on delete restrict
);
alter table private.qbo_production_source_validation_work enable row level security;
alter table private.qbo_production_source_validation_work force row level security;
revoke all on private.qbo_production_source_validation_work from public, anon, authenticated, service_role,
  integration_provider_source_authority, integration_provider_runtime_authority, integration_provider_validation_authority;
create index qbo_production_source_validation_pending_idx
  on private.qbo_production_source_validation_work(task_id, created_at, source_version_id)
  where state in ('pending', 'claimed');

-- Native source commits already serialize on this source row. Provenance writes
-- must share that anchor: an effects check without this lock would race promotion.
create function private.assert_qbo_production_source_promotable_v1(p_workspace uuid,p_entity uuid,p_version uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare s private.external_source_records; v private.external_source_record_versions;
begin
  select * into v from private.external_source_record_versions where id=p_version;
  if not found or v.provider_key is distinct from 'quickbooks_online' then return; end if;
  if not exists(select 1 from private.integration_connections c where c.id=v.connection_id
    and c.provider_environment='production') then return; end if;
  -- Keep authority stable through the provenance write. Match the native commit
  -- lock order (connection/mapping, then source), including disconnect/remap races.
  perform c.id from private.integration_connections c
    join private.external_source_records r on r.connection_id=c.id and r.workspace_id=c.workspace_id
      and r.business_entity_id=c.business_entity_id
    join private.provider_entity_mappings m on m.id=r.mapping_id and m.connection_id=c.id
      and m.workspace_id=c.workspace_id and m.business_entity_id=c.business_entity_id
    where r.id=v.source_record_id and c.id=v.connection_id and c.workspace_id=p_workspace
      and c.business_entity_id=p_entity and c.provider_key='quickbooks_online' and c.provider_environment='production'
      and c.status in ('initializing','active','degraded') and m.status='active'
      and m.provider_key='quickbooks_online' and m.provider_environment='production'
    for share of c,m;
  if not found then raise exception using errcode='42501',message='qbo_production_source_promotion_denied'; end if;
  select r.* into strict s from private.external_source_records r where r.id=v.source_record_id for update;
  if s.workspace_id is distinct from p_workspace or s.business_entity_id is distinct from p_entity
    or v.workspace_id is distinct from p_workspace or v.business_entity_id is distinct from p_entity
    or s.current_version_id is distinct from v.id or v.validation_state<>'valid'
    or not exists(select 1 from private.integration_connections c join private.provider_entity_mappings m
      on m.connection_id=c.id and m.workspace_id=c.workspace_id and m.business_entity_id=c.business_entity_id
      where c.id=s.connection_id and c.workspace_id=s.workspace_id and c.business_entity_id=s.business_entity_id
        and c.provider_key='quickbooks_online' and c.provider_environment='production'
        and c.status in ('initializing','active','degraded') and m.id=s.mapping_id and m.status='active'
        and m.provider_key='quickbooks_online' and m.provider_environment='production'
        and exists(select 1 from private.qbo_production_source_validation_work w
          where w.completed_version_id=v.id and w.source_record_id=s.id and w.workspace_id=s.workspace_id
            and w.business_entity_id=s.business_entity_id and w.connection_id=c.id and w.mapping_id=m.id
            and w.connection_generation=c.connection_generation and w.state='valid' and w.completed_at is not null))
    or v.change_kind in ('deleted','voided') or v.normalized_projection is null
    or v.normalized_projection->>'status' in ('deleted','voided','inactive')
    or v.normalized_projection->'active'='false'::jsonb then
    raise exception using errcode='42501',message='qbo_production_source_promotion_denied';
  end if;
end;
$function$;
create function private.guard_qbo_production_source_promotion_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare edge record;
begin
  if tg_table_name='fact_contribution_events' then
    -- Retraction must remain possible; only new positive authority is fenced.
    if new.event_kind='retract' then return new; end if;
    for edge in select e.source_record_version_id from private.business_fact_sources e
      join private.external_source_record_versions v on v.id=e.source_record_version_id
      where e.fact_version_id=new.fact_version_id and e.workspace_id=new.workspace_id
        and e.business_entity_id=new.business_entity_id order by v.source_record_id,e.source_record_version_id
    loop
      perform private.assert_qbo_production_source_promotable_v1(new.workspace_id,new.business_entity_id,edge.source_record_version_id);
    end loop;
  else
    perform private.assert_qbo_production_source_promotable_v1(new.workspace_id,new.business_entity_id,new.source_record_version_id);
  end if;
  return new;
end;
$function$;
create trigger guard_qbo_production_fact_source_promotion before insert on private.business_fact_sources
  for each row execute function private.guard_qbo_production_source_promotion_v1();
create trigger guard_qbo_production_reconciliation_promotion before insert on private.reconciliation_case_members
  for each row execute function private.guard_qbo_production_source_promotion_v1();
create trigger guard_qbo_production_contribution_promotion before insert on private.fact_contribution_events
  for each row execute function private.guard_qbo_production_source_promotion_v1();

create function private.qbo_production_source_has_effects_v1(p_source uuid)
returns boolean language sql volatile security definer set search_path='' as $function$
  select exists(select 1 from private.external_source_record_versions v join private.business_fact_sources e
    on e.source_record_version_id=v.id where v.source_record_id=p_source)
    or exists(select 1 from private.external_source_record_versions v join private.reconciliation_case_members m
      on m.source_record_version_id=v.id where v.source_record_id=p_source);
$function$;
revoke all on function private.assert_qbo_production_source_promotable_v1(uuid,uuid,uuid),
  private.guard_qbo_production_source_promotion_v1(),private.qbo_production_source_has_effects_v1(uuid)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority;

-- These guards apply to canonical table transitions, including older completion
-- entry points. A skipped/leased validation page is not proof of completion.
create function private.guard_qbo_production_validation_completion_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_connection uuid; v_workspace uuid; v_entity uuid;
begin
  if tg_table_name='integration_sync_tasks' then
    if new.provider_key<>'quickbooks_online' or new.provider_environment<>'production' or new.state<>'succeeded' then return new; end if;
    if exists(select 1 from private.qbo_production_source_validation_work w where w.task_id=new.id
      and w.state not in ('valid','superseded')) then
      raise exception using errcode='42501',message='qbo_production_task_validation_incomplete';
    end if;
    return new;
  elsif tg_table_name='integration_connections' then
    if new.provider_key<>'quickbooks_online' or new.provider_environment<>'production' or new.status<>'active' then return new; end if;
    v_connection:=new.id; v_workspace:=new.workspace_id; v_entity:=new.business_entity_id;
  else
    if new.provider_key<>'quickbooks_online' or new.status not in ('current','aging') then return new; end if;
    v_connection:=new.connection_id; v_workspace:=new.workspace_id; v_entity:=new.business_entity_id;
    perform c.id from private.integration_connections c where c.id=v_connection and c.workspace_id=v_workspace
      and c.business_entity_id=v_entity and c.provider_environment='production' for share;
    if not found then return new; end if;
  end if;
  if exists(select 1 from private.external_source_records s
    join private.external_source_record_versions v on v.id=s.current_version_id and v.source_record_id=s.id
    where s.connection_id=v_connection and s.workspace_id=v_workspace and s.business_entity_id=v_entity
      and s.provider_key='quickbooks_online' and (v.validation_state<>'valid' or v.change_kind in ('deleted','voided')
        or v.normalized_projection->>'status' in ('deleted','voided'))
      and not exists(select 1 from private.qbo_production_source_validation_work w
        join private.integration_connections c on c.id=w.connection_id and c.connection_generation=w.connection_generation
        where w.source_record_id=s.id and w.workspace_id=s.workspace_id and w.business_entity_id=s.business_entity_id
          and w.connection_id=s.connection_id and w.mapping_id=s.mapping_id and w.state='valid' and w.completed_at is not null
          and ((v.change_kind='deleted' and v.normalized_projection is null and w.source_version_id=v.id and w.completed_version_id is null)
            or (v.normalized_projection->>'status'='voided' and w.completed_version_id=v.id))
          and not private.qbo_production_source_has_effects_v1(s.id)))
    or exists(select 1 from private.qbo_production_source_validation_work w
      join private.integration_connections c on c.id=w.connection_id and c.connection_generation=w.connection_generation
      join private.external_source_records s on s.id=w.source_record_id and s.workspace_id=w.workspace_id
        and s.business_entity_id=w.business_entity_id and s.connection_id=w.connection_id
        and s.current_version_id in (w.source_version_id,w.completed_version_id)
      where w.connection_id=v_connection and w.workspace_id=v_workspace and w.business_entity_id=v_entity
        and w.state in ('pending','claimed','quarantined')) then
    raise exception using errcode='42501',message='qbo_production_connection_validation_incomplete';
  end if;
  return new;
end;
$function$;
create trigger guard_qbo_production_task_validation before insert or update on private.integration_sync_tasks
  for each row execute function private.guard_qbo_production_validation_completion_v1();
create trigger guard_qbo_production_activation_validation before insert or update on private.integration_connections
  for each row execute function private.guard_qbo_production_validation_completion_v1();
create trigger guard_qbo_production_freshness_validation before insert or update on private.integration_freshness_states
  for each row execute function private.guard_qbo_production_validation_completion_v1();
revoke all on function private.guard_qbo_production_validation_completion_v1()
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority;

create function private.protect_qbo_production_validation_work_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - array['state','claim_id','worker_fingerprint','claim_expires_at',
      'validated_at','completed_version_id','result_fingerprint','completed_at'])
    is distinct from (to_jsonb(old) - array['state','claim_id','worker_fingerprint','claim_expires_at',
      'validated_at','completed_version_id','result_fingerprint','completed_at'])
    or old.state in ('valid','quarantined','superseded') then
    raise exception using errcode = '42501', message = 'qbo_source_validation_work_immutable';
  end if;
  return new;
end;
$function$;
create trigger protect_qbo_production_validation_work
  before update or delete on private.qbo_production_source_validation_work
  for each row execute function private.protect_qbo_production_validation_work_v1();

-- Preserve the reviewed native authority and source CAS implementation. The only
-- public entry point now also creates durable work in the same transaction.
alter function public.commit_provider_external_source_record_version_v1(jsonb, text) set schema private;
alter function private.commit_provider_external_source_record_version_v1(jsonb, text)
  rename to commit_provider_external_source_before_validation_v1;
revoke all on function private.commit_provider_external_source_before_validation_v1(jsonb, text)
  from public, anon, authenticated, service_role, integration_provider_source_authority;

create function public.commit_provider_external_source_record_version_v1(p_command jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_task private.integration_sync_tasks;
  v_mapping private.provider_entity_mappings;
  v_result jsonb;
  v_work private.qbo_production_source_validation_work;
begin
  perform private.assert_integration_provider_source_authority_v1();
  v_result := private.commit_provider_external_source_before_validation_v1(p_command, p_request_id);
  select * into strict v_task from private.integration_sync_tasks where id = (p_command ->> 'taskId')::uuid for share;
  if v_task.provider_environment <> 'production' then return v_result; end if;
  select * into strict v_mapping from private.provider_entity_mappings
    where id = (p_command ->> 'mappingId')::uuid and workspace_id = v_task.workspace_id
      and business_entity_id = v_task.business_entity_id and connection_id = v_task.connection_id
      and provider_key = 'quickbooks_online' and provider_environment = 'production' and status = 'active' for share;
  if v_task.state <> 'leased' or v_task.lease_id is distinct from (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint is distinct from private.sha256_fingerprint_bytes_v1(p_command ->> 'leaseOwnerFingerprint')
    or v_task.lease_expires_at <= transaction_timestamp() then
    raise exception using errcode = '42501', message = 'qbo_source_validation_origin_denied';
  end if;
  insert into private.qbo_production_source_validation_work (
    source_version_id, source_record_id, workspace_id, business_entity_id, connection_id, connection_generation,
    mapping_id, task_id, sync_run_id, stream_key, dispatch_generation, originating_lease_id, originating_owner,
    dispatcher_task_name, delivery_fingerprint, realm_fingerprint
  ) values (
    (v_result ->> 'sourceVersionId')::uuid, (v_result ->> 'sourceRecordId')::uuid, v_task.workspace_id,
    v_task.business_entity_id, v_task.connection_id, v_task.connection_generation, v_mapping.id,
    v_task.id, v_task.sync_run_id, v_task.stream_key, v_task.dispatch_generation, v_task.lease_id,
    v_task.lease_owner_fingerprint, v_task.dispatcher_task_name, v_task.last_delivery_attempt_fingerprint,
    v_mapping.provider_entity_reference_fingerprint
  ) on conflict (source_version_id) do nothing;
  select * into strict v_work from private.qbo_production_source_validation_work
    where source_version_id = (v_result ->> 'sourceVersionId')::uuid;
  if v_work.task_id <> v_task.id or v_work.workspace_id <> v_task.workspace_id
    or v_work.connection_generation <> v_task.connection_generation or v_work.mapping_id <> v_mapping.id then
    raise exception using errcode = '42501', message = 'qbo_source_validation_origin_denied';
  end if;
  return v_result;
end;
$function$;

create function private.qbo_production_validation_scope_valid_v1(p_work private.qbo_production_source_validation_work)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from private.integration_sync_tasks t
    join private.integration_connections c on c.id = t.connection_id and c.workspace_id = t.workspace_id
      and c.business_entity_id = t.business_entity_id and c.connection_generation = t.connection_generation
    join private.provider_entity_mappings m on m.id = p_work.mapping_id and m.workspace_id = t.workspace_id
      and m.business_entity_id = t.business_entity_id and m.connection_id = t.connection_id
    join private.external_source_records s on s.id = p_work.source_record_id and s.workspace_id = t.workspace_id
      and s.business_entity_id = t.business_entity_id and s.connection_id = t.connection_id and s.mapping_id = m.id
    join private.external_source_record_versions v on v.id = p_work.source_version_id and v.source_record_id = s.id
      and v.workspace_id = t.workspace_id and v.business_entity_id = t.business_entity_id
      and v.connection_id = t.connection_id and v.sync_run_id = t.sync_run_id
    where t.id = p_work.task_id and t.workspace_id = p_work.workspace_id
      and t.business_entity_id = p_work.business_entity_id and t.connection_id = p_work.connection_id
      and t.connection_generation = p_work.connection_generation and t.sync_run_id = p_work.sync_run_id
      and t.dispatch_generation=p_work.dispatch_generation and t.dispatcher_task_name=p_work.dispatcher_task_name
      and t.last_delivery_attempt_fingerprint=p_work.delivery_fingerprint
      and t.stream_key = p_work.stream_key and t.provider_key = 'quickbooks_online' and t.provider_environment = 'production'
      and c.provider_key = 'quickbooks_online' and c.provider_environment = 'production'
      and c.status in ('initializing','active','degraded')
      and m.provider_key = 'quickbooks_online' and m.provider_environment = 'production' and m.status = 'active'
      and m.provider_entity_reference_fingerprint = p_work.realm_fingerprint
      and s.provider_key = 'quickbooks_online' and v.source_kind = 'provider'
      and v.provider_key = 'quickbooks_online' and v.validation_state = 'pending'
  );
$function$;

create function public.discover_qbo_production_source_validation_tasks_v1(p_maximum_tasks integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_maximum_tasks is null or p_maximum_tasks not between 1 and 100 then
    raise exception using errcode = '22023', message = 'qbo_source_validation_page_invalid';
  end if;
  select coalesce(jsonb_agg(task_id order by task_id), '[]'::jsonb) into v_result from (
    select distinct w.task_id from private.qbo_production_source_validation_work w
    where (w.state = 'pending' or (w.state = 'claimed' and w.claim_expires_at <= transaction_timestamp()))
      and private.qbo_production_validation_scope_valid_v1(w)
      and not exists(select 1 from private.integration_sync_tasks t where t.id=w.task_id
        and t.state='leased' and t.lease_expires_at>transaction_timestamp())
    order by w.task_id limit p_maximum_tasks
  ) page;
  return v_result;
end;
$function$;

create function public.claim_qbo_production_source_validation_v1(
  p_task_id uuid, p_worker_fingerprint text, p_maximum_results integer
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_work private.qbo_production_source_validation_work;
  v_pending private.external_source_record_versions;
  v_identity bytea;
  v_result jsonb := '[]'::jsonb;
  v_now timestamptz := transaction_timestamp();
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_task_id is null or p_maximum_results is null or p_maximum_results not between 1 and 100
    or not coalesce(private.is_sha256_fingerprint_v1(p_worker_fingerprint), false) then
    raise exception using errcode = '22023', message = 'qbo_source_validation_page_invalid';
  end if;
  for v_work in select w.* from private.qbo_production_source_validation_work w
    where w.task_id = p_task_id and (w.state = 'pending' or (w.state = 'claimed' and w.claim_expires_at <= v_now))
      and private.qbo_production_validation_scope_valid_v1(w)
    order by w.created_at, w.source_version_id limit p_maximum_results for update skip locked
  loop
    update private.qbo_production_source_validation_work set state = 'claimed', claim_id = gen_random_uuid(),
      worker_fingerprint = private.sha256_fingerprint_bytes_v1(p_worker_fingerprint), claim_expires_at = v_now + interval '5 minutes',
      validated_at = v_now where source_version_id = v_work.source_version_id returning * into v_work;
    select * into strict v_pending from private.external_source_record_versions where id = v_work.source_version_id;
    select source_identity_fingerprint into strict v_identity from private.external_source_records where id = v_work.source_record_id;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'sourceVersionId', v_work.source_version_id, 'sourceRecordId', v_work.source_record_id, 'taskId', v_work.task_id,
      'workspaceId', v_work.workspace_id, 'businessEntityId', v_work.business_entity_id, 'connectionId', v_work.connection_id,
      'connectionGeneration', v_work.connection_generation, 'mappingId', v_work.mapping_id, 'syncRunId', v_work.sync_run_id,
      'streamKey', v_work.stream_key, 'sourceIdentityFingerprint', 'sha256:' || encode(v_identity, 'hex'),
      'realmFingerprint', 'sha256:' || encode(v_work.realm_fingerprint, 'hex'), 'claimId', v_work.claim_id,
      'claimExpiresAt', to_char(v_work.claim_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'validatedVersionId', v_work.validated_version_id,
      'validatedAt', to_char(v_work.validated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'pendingVersion', private.phase_8b_source_version_json_v1(v_pending)
    ));
  end loop;
  return v_result;
end;
$function$;

create function public.complete_qbo_production_source_validation_v1(
  p_source_version_id uuid, p_claim_id uuid, p_worker_fingerprint text, p_validated_version jsonb, p_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_work private.qbo_production_source_validation_work;
  v_pending private.external_source_record_versions;
  v_source private.external_source_records;
  v_validated private.external_source_record_versions;
  v_original jsonb;
  v_result_hash bytea;
  v_source_hash bytea;
  v_state text;
  v_deleted boolean;
  v_voided boolean;
  v_inactive_reference boolean;
  v_now timestamptz := transaction_timestamp();
begin
  perform private.assert_integration_provider_source_authority_v1();
  if not coalesce(private.is_bounded_identifier_v1(p_request_id), false)
    or not coalesce(private.is_sha256_fingerprint_v1(p_worker_fingerprint), false) then
    raise exception using errcode = '22023', message = 'qbo_source_validation_completion_invalid';
  end if;
  perform private.validate_source_version_payload_v1(p_validated_version);
  v_result_hash := private.phase_3_contract_fingerprint_v1(p_validated_version);
  select * into v_work from private.qbo_production_source_validation_work where source_version_id = p_source_version_id for update;
  if not found or v_work.claim_id is distinct from p_claim_id or v_work.worker_fingerprint is distinct from
    private.sha256_fingerprint_bytes_v1(p_worker_fingerprint) then
    raise exception using errcode = '42501', message = 'qbo_source_validation_completion_denied';
  end if;
  -- Serialize the commit with disconnect, generation changes and mapping changes.
  perform c.id from private.integration_connections c join private.provider_entity_mappings m
    on m.connection_id = c.id and m.workspace_id = c.workspace_id and m.business_entity_id = c.business_entity_id
    where c.id = v_work.connection_id and c.workspace_id = v_work.workspace_id
      and c.business_entity_id = v_work.business_entity_id and m.id = v_work.mapping_id for share of c,m;
  if not found or not private.qbo_production_validation_scope_valid_v1(v_work) then
    raise exception using errcode = '42501', message = 'qbo_source_validation_completion_denied';
  end if;
  if v_work.completed_at is not null then
    if v_work.result_fingerprint is distinct from v_result_hash then
      raise exception using errcode = '42501', message = 'qbo_source_validation_replay_conflict';
    end if;
    return jsonb_build_object('sourceVersionId', v_work.source_version_id, 'validatedVersionId', v_work.completed_version_id,
      'state', v_work.state, 'idempotent', true);
  end if;
  if v_work.state <> 'claimed' or v_work.claim_expires_at <= v_now then
    raise exception using errcode = '42501', message = 'qbo_source_validation_claim_stale';
  end if;
  select * into strict v_pending from private.external_source_record_versions where id = v_work.source_version_id;
  v_original := private.phase_8b_source_version_json_v1(v_pending);
  v_state := p_validated_version #>> '{validation,state}';
  v_deleted:=v_pending.change_kind='deleted' and v_pending.normalized_projection is null
    and v_pending.provider_record_type in ('Account','Customer','Vendor','Item','Invoice','SalesReceipt','Payment',
      'CreditMemo','RefundReceipt','Bill','BillPayment','Purchase','VendorCredit','Deposit','JournalEntry','Transfer')
    and (v_pending.normalized_schema_version='qbo_minimizer_v1'
      or (v_pending.normalized_schema_version='qbo_cdc_tombstone_v1' and v_work.stream_key='qbo_cdc'))
    and v_pending.provider_updated_at is not null and v_pending.temporal_basis='event'
    and v_pending.period_start is null and v_pending.period_end is null;
  v_voided:=v_pending.change_kind='voided' and v_pending.normalized_projection->>'status'='voided'
    and v_pending.provider_record_type in ('Invoice','SalesReceipt','Payment','CreditMemo','RefundReceipt','Bill',
      'BillPayment','Purchase','VendorCredit','Deposit','JournalEntry','Transfer');
  v_inactive_reference:=v_pending.provider_record_type in ('Account','Customer','Vendor','Item')
    and v_pending.normalized_projection->>'status'='inactive' and v_pending.normalized_projection->'active'='false'::jsonb;
  if (p_validated_version - array['id','immutableVersion','priorVersionId','changeKind','validation','receivedAt','sourceFingerprint'])
    is distinct from (v_original - array['id','immutableVersion','priorVersionId','changeKind','validation','receivedAt','sourceFingerprint'])
    or (p_validated_version ->> 'id')::uuid is distinct from v_work.validated_version_id
    or (p_validated_version ->> 'immutableVersion')::bigint is distinct from v_pending.immutable_version + 1
    or (p_validated_version ->> 'priorVersionId')::uuid is distinct from v_pending.id
    or (p_validated_version ->> 'receivedAt')::timestamptz is distinct from date_trunc('milliseconds', v_work.validated_at)
    or p_validated_version ->> 'changeKind' is distinct from (case when v_pending.change_kind = 'deleted' then 'deleted' else 'unchanged' end)
    or p_validated_version #>> '{validation,validatorVersion}' is distinct from 'qbo_production_source_validator_v1'
    or v_state is null or v_state not in ('valid','quarantined') then
    raise exception using errcode = '42501', message = 'qbo_source_validation_version_denied';
  end if;
  if v_state = 'valid' and (
    p_validated_version #> '{validation,issues}' <> '[]'::jsonb
    or (not coalesce(v_deleted,false) and (v_pending.normalized_projection is null
    or v_pending.normalized_projection #>> '{provider,providerKey}' is distinct from 'quickbooks_online'
    or v_pending.normalized_projection #>> '{provider,sourceEnvironment}' is distinct from 'production'
    or private.qbo_phase_8b_realm_fingerprint_v1(v_pending.normalized_projection #>> '{provider,realmId}')
      is distinct from v_work.realm_fingerprint
    or v_pending.change_kind='deleted' or v_pending.normalized_projection->>'status'='deleted'
    or ((v_pending.change_kind='voided' or v_pending.normalized_projection->>'status'='voided') and not coalesce(v_voided,false))
    or ((v_pending.normalized_projection->>'status'='inactive' or v_pending.normalized_projection->'active'='false'::jsonb)
      and not coalesce(v_inactive_reference,false))
    or not coalesce(v_pending.normalized_projection ->> 'contractVersion' in ('qbo_source_record_minimized_v1','qbo_report_control_observation_v1'), false)
    or (v_pending.normalized_projection ->> 'contractVersion' = 'qbo_report_control_observation_v1'
      and (v_pending.normalized_projection -> 'additive' is distinct from 'false'::jsonb
        or v_pending.normalized_projection ->> 'contributionFamily' is distinct from 'control_observation'))))
  ) then raise exception using errcode = '42501', message = 'qbo_source_validation_validity_denied'; end if;
  if v_state = 'quarantined' and jsonb_array_length(p_validated_version #> '{validation,issues}') = 0 then
    raise exception using errcode = '22023', message = 'qbo_source_validation_quarantine_reason_required';
  end if;
  v_source_hash := private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'fingerprintPurpose','external_source_record', 'fingerprintVersion','external_integration_fingerprint_v1',
    'payload', jsonb_build_object('contractVersion',p_validated_version -> 'contractVersion',
      'workspaceId',p_validated_version -> 'workspaceId','businessEntityId',p_validated_version -> 'businessEntityId',
      'connectionId',p_validated_version -> 'connectionId','recordKind',p_validated_version -> 'recordKind',
      'source',p_validated_version -> 'source',
      'temporal',(p_validated_version -> 'temporal') - array['synchronizedAt','ingestedAt'],
      'accounting',p_validated_version -> 'accounting','normalizedSchemaVersion',p_validated_version -> 'normalizedSchemaVersion',
      'changeKind',p_validated_version -> 'changeKind','normalizedProjection',p_validated_version -> 'normalizedProjection',
      'trust',p_validated_version -> 'trust')));
  if v_source_hash is distinct from private.sha256_fingerprint_bytes_v1(p_validated_version ->> 'sourceFingerprint') then
    raise exception using errcode = '42501', message = 'qbo_source_validation_fingerprint_denied';
  end if;
  select * into strict v_source from private.external_source_records where id = v_work.source_record_id for update;
  if v_source.current_version_id <> v_pending.id then
    v_state := 'superseded';
  elsif v_state='valid' and (coalesce(v_deleted,false) or coalesce(v_voided,false))
    and private.qbo_production_source_has_effects_v1(v_source.id) then
    raise exception using errcode='42501',message='qbo_source_validation_retraction_required';
  elsif v_pending.change_kind = 'deleted' then
    -- Its fingerprint excludes validation metadata. Retain the exact tombstone
    -- and persist only effective work validity after the serialized effects check.
    null;
  else
    v_validated := jsonb_populate_record(null::private.external_source_record_versions,
      to_jsonb(v_pending) || jsonb_build_object('id',v_work.validated_version_id,
        'immutable_version',v_pending.immutable_version + 1,'prior_version_id',v_pending.id,
        'change_kind','unchanged','validation_state',v_state,'validator_version','qbo_production_source_validator_v1',
        'validation_issues',p_validated_version #> '{validation,issues}','received_at',v_work.validated_at,
        'source_fingerprint',v_source_hash,'created_at',v_now));
    insert into private.external_source_record_versions select (v_validated).*;
    update private.external_source_records set current_version_id = v_validated.id, updated_at = v_now where id = v_source.id;
  end if;
  update private.qbo_production_source_validation_work set state = v_state, completed_at = v_now,
    result_fingerprint = v_result_hash, completed_version_id = v_validated.id where source_version_id = v_work.source_version_id;
  insert into private.integration_audit_events(workspace_id,business_entity_id,connection_id,actor_type,actor_id,
    action,outcome,target_type,target_id,request_id,metadata,retention_class)
  values(v_work.workspace_id,v_work.business_entity_id,v_work.connection_id,'service','integration_provider_source_authority',
    'external_source_record_version.validate','succeeded','external_source_record_version',v_work.source_version_id::text,
    p_request_id,jsonb_build_object('validation_state',v_state,'source_kind','provider'),'operational');
  return jsonb_build_object('sourceVersionId',v_work.source_version_id,'validatedVersionId',v_validated.id,
    'state',v_state,'idempotent',false);
end;
$function$;

revoke all on function private.protect_qbo_production_validation_work_v1(),
  private.qbo_production_validation_scope_valid_v1(private.qbo_production_source_validation_work)
  from public, anon, authenticated, service_role, integration_provider_source_authority;
revoke all on function public.commit_provider_external_source_record_version_v1(jsonb,text),
  public.discover_qbo_production_source_validation_tasks_v1(integer),
  public.claim_qbo_production_source_validation_v1(uuid,text,integer),
  public.complete_qbo_production_source_validation_v1(uuid,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_provider_external_source_record_version_v1(jsonb,text),
  public.discover_qbo_production_source_validation_tasks_v1(integer),
  public.claim_qbo_production_source_validation_v1(uuid,text,integer),
  public.complete_qbo_production_source_validation_v1(uuid,uuid,text,jsonb,text)
  to integration_provider_source_authority;

commit;
