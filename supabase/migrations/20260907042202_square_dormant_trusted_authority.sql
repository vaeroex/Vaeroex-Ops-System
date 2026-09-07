-- Dormant Square authority qualification. No production enrollment, registration,
-- OAuth verification, remote execution, credential access, or purge authority.
begin;

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'square_ingestion_runtime_authority') then
    create role square_ingestion_runtime_authority nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'square_ingestion_qualification_admin') then
    create role square_ingestion_qualification_admin nologin noinherit;
  end if;
end;
$roles$;
revoke square_ingestion_runtime_authority, square_ingestion_qualification_admin
  from anon, authenticated, service_role, external_integrations_authority,
    integration_control_plane_authority, integration_provider_runtime_authority,
    integration_provider_source_authority, integration_credential_broker_authority;
revoke all on schema private from square_ingestion_runtime_authority, square_ingestion_qualification_admin;
grant usage on schema public to square_ingestion_runtime_authority, square_ingestion_qualification_admin;

-- Only a disposable-database owner can install this marker. No callable installer
-- and no default row/grant exist. A caller-controlled GUC is never sufficient.
create table private.square_qualification_gate (
  singleton boolean primary key check (singleton),
  database_name name not null check (database_name::text ~ '^square_qualification_[a-z0-9_]+$'),
  purpose text not null check (purpose = 'disposable_local_synthetic'),
  expires_at timestamptz not null
);

create table private.square_connections (
  connection_id uuid primary key,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  seller_id text not null check (seller_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  environment text not null check (environment in ('sandbox', 'production')),
  current_generation bigint not null check (current_generation between 1 and 9007199254740991),
  state text not null check (state in ('active', 'revoked')),
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason in ('qualification_revoked', 'generation_replaced')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (workspace_id, business_entity_id, connection_id),
  foreign key (workspace_id, business_entity_id)
    references public.business_entities(workspace_id, id) on delete restrict
);
create table private.square_connection_generations (
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation between 1 and 9007199254740991),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  identity_mode text not null check (identity_mode = 'synthetic_local_qualification'),
  identity_evidence_fingerprint text not null check (identity_evidence_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  default_location_id text check (default_location_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  default_discovery_fingerprint text check (default_discovery_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  retention_policy_version text not null check (retention_policy_version ~ '^[a-zA-Z0-9._:-]{1,200}$'),
  retention_approval_fingerprint text not null check (retention_approval_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  retention_expires_at timestamptz not null,
  enrolled_by name not null,
  enrolled_at timestamptz not null,
  primary key (connection_id, connection_generation),
  unique (workspace_id, business_entity_id, connection_id, connection_generation),
  foreign key (workspace_id, business_entity_id, connection_id)
    references private.square_connections(workspace_id, business_entity_id, connection_id) on delete restrict,
  check ((default_location_id is null) = (default_discovery_fingerprint is null)),
  check (retention_expires_at > enrolled_at)
);
create table private.square_location_mappings (
  connection_id uuid not null,
  connection_generation bigint not null,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  location_id text not null check (location_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  verification_fingerprint text not null check (verification_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  mapped_by name not null,
  mapped_at timestamptz not null,
  primary key (connection_id, connection_generation, location_id),
  foreign key (workspace_id, business_entity_id, connection_id, connection_generation)
    references private.square_connection_generations(workspace_id, business_entity_id, connection_id, connection_generation) on delete restrict
);
create table private.square_ingestion_tasks (
  task_id uuid primary key,
  connection_id uuid not null,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_generation bigint not null,
  runtime_login name not null,
  lease_owner_fingerprint text not null check (lease_owner_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  "grant" jsonb not null,
  binding jsonb not null,
  expires_at timestamptz not null,
  retention_policy_version text not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null,
  unique (workspace_id, business_entity_id, connection_id, connection_generation, task_id),
  foreign key (workspace_id, business_entity_id, connection_id, connection_generation)
    references private.square_connection_generations(workspace_id, business_entity_id, connection_id, connection_generation) on delete restrict,
  check (expires_at > created_at and expires_at <= retention_expires_at)
);
create index square_ingestion_tasks_connection_idx
  on private.square_ingestion_tasks(connection_id, connection_generation);
create index square_connection_generations_entity_idx
  on private.square_connection_generations(workspace_id, business_entity_id, connection_id, connection_generation);
create index square_location_mappings_entity_idx
  on private.square_location_mappings(workspace_id, business_entity_id, connection_id, connection_generation);

create function private.assert_square_qualification_gate_v1()
returns void language plpgsql security invoker set search_path = '' as $function$
begin
  if not exists (
    select 1 from private.square_qualification_gate
    where singleton and database_name = pg_catalog.current_database()
      and purpose = 'disposable_local_synthetic'
      and expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'square_qualification_gate_closed';
  end if;
end;
$function$;
create function private.assert_square_qualification_admin_v1()
returns void language plpgsql security invoker set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'square_ingestion_qualification_admin', 'MEMBER') then
    raise exception using errcode = '42501', message = 'square_qualification_admin_required';
  end if;
  perform private.assert_square_qualification_gate_v1();
end;
$function$;
create function private.protect_square_authority_history_v1()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'square_authority_history_immutable';
end;
$function$;
create trigger square_generation_history_immutable before update or delete
  on private.square_connection_generations for each row execute function private.protect_square_authority_history_v1();
create trigger square_location_history_immutable before update or delete
  on private.square_location_mappings for each row execute function private.protect_square_authority_history_v1();
create trigger square_task_history_immutable before update or delete
  on private.square_ingestion_tasks for each row execute function private.protect_square_authority_history_v1();
create function private.protect_square_connection_identity_v1()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='55000',message='square_connection_history_immutable';
  end if;
  if new.connection_id is distinct from old.connection_id
    or new.workspace_id is distinct from old.workspace_id
    or new.business_entity_id is distinct from old.business_entity_id
    or new.seller_id is distinct from old.seller_id
    or new.environment is distinct from old.environment
    or new.created_at is distinct from old.created_at
    or new.current_generation < old.current_generation
    or new.current_generation > old.current_generation + 1
    or (old.state='revoked' and new.state='active' and new.current_generation=old.current_generation) then
    raise exception using errcode='55000',message='square_connection_identity_immutable';
  end if;
  return new;
end;
$function$;
create trigger square_connection_identity_immutable before update or delete
  on private.square_connections for each row execute function private.protect_square_connection_identity_v1();

-- Enrollment consumes explicit synthetic verified-identity inputs only. No runtime
-- user can turn Merchant/Location data, seller IDs, or arbitrary grants into evidence.
create function public.enroll_square_qualification_connection_v1(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_connection private.square_connections;
  v_now timestamptz;
  v_retention_expiry timestamptz;
  v_generation bigint;
  v_location jsonb;
begin
  perform private.assert_square_qualification_admin_v1();
  if p_command is null or pg_catalog.pg_column_size(p_command) > 524288
    or not private.jsonb_has_exact_keys_v1(p_command, array['workspaceId','businessEntityId','connectionId','sellerId','environment','generation','expectedGeneration','verifiedIdentity','locations','defaultLocation','retention'])
    or not private.jsonb_has_exact_keys_v1(p_command->'verifiedIdentity', array['mode','evidenceFingerprint'])
    or p_command#>>'{verifiedIdentity,mode}' is distinct from 'synthetic_local_qualification'
    or not coalesce((p_command#>>'{verifiedIdentity,evidenceFingerprint}') ~ '^sha256:[a-f0-9]{64}$', false)
    or not coalesce((p_command->>'sellerId') ~ '^[A-Za-z0-9._:-]{1,100}$', false)
    or not coalesce(p_command->>'environment' in ('sandbox','production'),false)
    or not private.jsonb_has_exact_keys_v1(p_command->'retention', array['policyVersion','approvalFingerprint','seconds'])
    or not coalesce((p_command#>>'{retention,policyVersion}') ~ '^[a-zA-Z0-9._:-]{1,200}$', false)
    or not coalesce((p_command#>>'{retention,approvalFingerprint}') ~ '^sha256:[a-f0-9]{64}$', false)
    or not coalesce((p_command#>>'{retention,seconds}') ~ '^[0-9]{1,5}$', false)
    or pg_catalog.jsonb_typeof(p_command#>'{retention,seconds}') is distinct from 'number'
    or (p_command#>>'{retention,seconds}')::integer not between 1 and 86400
    or not coalesce((p_command->>'generation') ~ '^[0-9]{1,16}$', false)
    or pg_catalog.jsonb_typeof(p_command->'generation') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_command->'expectedGeneration') not in ('null','number')
    or pg_catalog.jsonb_typeof(p_command->'locations') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_command->'locations') not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'square_qualification_enrollment_invalid';
  end if;
  v_generation := (p_command->>'generation')::bigint;
  if v_generation not between 1 and 9007199254740991 then
    raise exception using errcode = '22023', message = 'square_qualification_enrollment_invalid';
  end if;
  for v_location in select value from pg_catalog.jsonb_array_elements(p_command->'locations') loop
    if not private.jsonb_has_exact_keys_v1(v_location, array['locationId','businessEntityId','verificationFingerprint'])
      or not coalesce((v_location->>'locationId') ~ '^[A-Za-z0-9._:-]{1,100}$', false)
      or v_location->>'businessEntityId' is distinct from p_command->>'businessEntityId'
      or not coalesce((v_location->>'verificationFingerprint') ~ '^sha256:[a-f0-9]{64}$', false) then
      raise exception using errcode = '22023', message = 'square_qualification_mapping_invalid';
    end if;
  end loop;
  if (select count(distinct value->>'locationId') from pg_catalog.jsonb_array_elements(p_command->'locations'))
    <> pg_catalog.jsonb_array_length(p_command->'locations') then
    raise exception using errcode = '22023', message = 'square_qualification_mapping_invalid';
  end if;
  if p_command->'defaultLocation' <> 'null'::jsonb and (
    not private.jsonb_has_exact_keys_v1(p_command->'defaultLocation', array['locationId','discoveryFingerprint'])
    or not coalesce((p_command#>>'{defaultLocation,discoveryFingerprint}') ~ '^sha256:[a-f0-9]{64}$', false)
    or not exists (select 1 from pg_catalog.jsonb_array_elements(p_command->'locations') as item(value)
      where item.value->>'locationId' = p_command#>>'{defaultLocation,locationId}')
  ) then
    raise exception using errcode = '22023', message = 'square_qualification_default_discovery_invalid';
  end if;

  -- Serialize first enrollment too. This advisory key is connection-specific and
  -- is never used by runtime; existing connections always share the row fence.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((p_command->>'connectionId')::uuid::text, 350));
  select * into v_connection from private.square_connections
    where connection_id = (p_command->>'connectionId')::uuid for update;
  if found then
    if v_connection.workspace_id::text is distinct from p_command->>'workspaceId'
      or v_connection.business_entity_id::text is distinct from p_command->>'businessEntityId'
      or v_connection.seller_id is distinct from p_command->>'sellerId'
      or v_connection.environment is distinct from p_command->>'environment'
      or v_connection.current_generation is distinct from (p_command->>'expectedGeneration')::bigint
      or v_generation <> v_connection.current_generation + 1 then
      raise exception using errcode = '42501', message = 'square_qualification_generation_denied';
    end if;
  elsif v_generation <> 1 or p_command->'expectedGeneration' is distinct from 'null'::jsonb then
    raise exception using errcode = '42501', message = 'square_qualification_generation_denied';
  end if;
  perform 1 from public.business_entities
    where workspace_id = (p_command->>'workspaceId')::uuid
      and id = (p_command->>'businessEntityId')::uuid and status = 'active' for share;
  if not found then
    raise exception using errcode = '42501', message = 'square_qualification_entity_denied';
  end if;
  perform private.assert_square_qualification_gate_v1();
  v_now := pg_catalog.clock_timestamp();
  v_retention_expiry := v_now + pg_catalog.make_interval(secs => (p_command#>>'{retention,seconds}')::integer);
  insert into private.square_connections(connection_id,workspace_id,business_entity_id,seller_id,environment,current_generation,state,created_at,updated_at)
    values ((p_command->>'connectionId')::uuid,(p_command->>'workspaceId')::uuid,(p_command->>'businessEntityId')::uuid,
      p_command->>'sellerId',p_command->>'environment',v_generation,'active',v_now,v_now)
    on conflict(connection_id) do update set current_generation=excluded.current_generation,state='active',revoked_at=null,revocation_reason=null,updated_at=v_now;
  insert into private.square_connection_generations(connection_id,connection_generation,workspace_id,business_entity_id,identity_mode,
    identity_evidence_fingerprint,default_location_id,default_discovery_fingerprint,retention_policy_version,retention_approval_fingerprint,retention_expires_at,enrolled_by,enrolled_at)
    values ((p_command->>'connectionId')::uuid,v_generation,(p_command->>'workspaceId')::uuid,(p_command->>'businessEntityId')::uuid,
      'synthetic_local_qualification',p_command#>>'{verifiedIdentity,evidenceFingerprint}',p_command#>>'{defaultLocation,locationId}',
      p_command#>>'{defaultLocation,discoveryFingerprint}',p_command#>>'{retention,policyVersion}',p_command#>>'{retention,approvalFingerprint}',v_retention_expiry,session_user,v_now);
  insert into private.square_location_mappings(connection_id,connection_generation,workspace_id,business_entity_id,location_id,verification_fingerprint,mapped_by,mapped_at)
    select (p_command->>'connectionId')::uuid,v_generation,(p_command->>'workspaceId')::uuid,(p_command->>'businessEntityId')::uuid,
      value->>'locationId',value->>'verificationFingerprint',session_user,v_now
    from pg_catalog.jsonb_array_elements(p_command->'locations');
  return pg_catalog.jsonb_build_object('connectionId',p_command->>'connectionId','generation',v_generation,
    'retentionExpiresAt',pg_catalog.floor(extract(epoch from v_retention_expiry)*1000)::bigint);
end;
$function$;

create function public.enroll_square_qualification_task_v1(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_grant jsonb := p_command->'grant';
  v_binding jsonb := p_command->'binding';
  v_scope jsonb := p_command#>'{grant,scope}';
  v_now timestamptz;
  v_expiry timestamptz;
  v_locations jsonb;
  v_operation text;
begin
  perform private.assert_square_qualification_admin_v1();
  if p_command is null or pg_catalog.pg_column_size(p_command)>2097152
    or not private.jsonb_has_exact_keys_v1(p_command,array['taskId','connectionId','generation','runtimeLogin','leaseOwnerFingerprint','grant','binding'])
    or not coalesce((p_command->>'leaseOwnerFingerprint') ~ '^sha256:[a-f0-9]{64}$',false)
    or not coalesce((p_command->>'generation') ~ '^[0-9]{1,16}$',false)
    or pg_catalog.jsonb_typeof(p_command->'generation') is distinct from 'number'
    or not coalesce((p_command->>'runtimeLogin') ~ '^[a-zA-Z0-9_]{1,63}$',false)
    or not (private.jsonb_has_exact_keys_v1(v_grant,array['scope','stream','operation','scanId','request','expiresAt'])
      or private.jsonb_has_exact_keys_v1(v_grant,array['scope','stream','operation','scanId','request','expiresAt','resolvedDefaultLocationId']))
    or not private.jsonb_has_exact_keys_v1(v_scope,array['workspaceId','businessEntityId','connectionId','sellerId','environment','authorizedLocationIds','generation'])
    or not private.jsonb_has_exact_keys_v1(v_grant->'request',array['method','url','body'])
    or not coalesce(v_grant#>>'{request,method}' in ('GET','POST'),false)
    or pg_catalog.jsonb_typeof(v_grant#>'{request,url}') is distinct from 'string'
    or length(v_grant#>>'{request,url}')>16384
    or pg_catalog.jsonb_typeof(v_grant#>'{request,body}') not in ('null','string')
    or coalesce(length(v_grant#>>'{request,body}'),0)>1048576
    or not coalesce((v_grant->>'expiresAt') ~ '^[0-9]{1,16}$',false)
    or pg_catalog.jsonb_typeof(v_grant->'expiresAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v_grant->'scanId') is distinct from 'string'
    or not private.jsonb_has_exact_keys_v1(v_binding,array['scanKey','scopeFingerprint','queryFingerprint','cursorBindingFingerprint','generation'])
    or exists (select 1 from pg_catalog.jsonb_each(v_binding) where key<>'generation'
      and (pg_catalog.jsonb_typeof(value)<>'string' or not coalesce((value#>>'{}') ~ '^sha256:[a-f0-9]{64}$',false)))
    or v_binding->'generation' is distinct from p_command->'generation'
    or v_scope->'generation' is distinct from p_command->'generation'
    or pg_catalog.jsonb_typeof(v_scope->'authorizedLocationIds') is distinct from 'array' then
    raise exception using errcode='22023',message='square_qualification_task_invalid';
  end if;
  perform (v_grant->>'scanId')::uuid;
  v_operation := v_grant->>'operation';
  if not coalesce(case v_grant->>'stream'
    when 'order_core' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_line_items' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_adjustments' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_tenders' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'payments' then v_operation in ('list_payments','retrieve_payment')
    when 'refunds' then v_operation in ('list_payment_refunds','retrieve_payment_refund')
    when 'catalog' then v_operation in ('list_catalog','retrieve_catalog_object','catalog_search','catalog_batch_retrieve')
    when 'inventory' then v_operation in ('retrieve_inventory_count','retrieve_inventory_adjustment','retrieve_inventory_physical_count','inventory_counts_batch_retrieve','inventory_changes_batch_retrieve')
    else false end,false) then
    raise exception using errcode='22023',message='square_qualification_task_invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname=p_command->>'runtimeLogin'
    and rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication)
    or not pg_catalog.pg_has_role(p_command->>'runtimeLogin','square_ingestion_runtime_authority','MEMBER')
    or pg_catalog.pg_has_role(p_command->>'runtimeLogin','square_ingestion_qualification_admin','MEMBER') then
    raise exception using errcode='42501',message='square_qualification_runtime_login_denied';
  end if;
  select * into v_connection from private.square_connections
    where connection_id=(p_command->>'connectionId')::uuid for update;
  if not found or v_connection.state<>'active'
    or v_connection.current_generation<>(p_command->>'generation')::bigint
    or v_scope->>'connectionId' is distinct from v_connection.connection_id::text
    or v_scope->>'workspaceId' is distinct from v_connection.workspace_id::text
    or v_scope->>'businessEntityId' is distinct from v_connection.business_entity_id::text
    or v_scope->>'sellerId' is distinct from v_connection.seller_id
    or v_scope->>'environment' is distinct from v_connection.environment then
    raise exception using errcode='42501',message='square_qualification_task_scope_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_connection.connection_id and connection_generation=v_connection.current_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations
    from private.square_location_mappings where connection_id=v_connection.connection_id and connection_generation=v_connection.current_generation;
  if v_scope->'authorizedLocationIds' is distinct from v_locations
    or (v_grant ? 'resolvedDefaultLocationId' and v_grant->>'resolvedDefaultLocationId' is distinct from v_generation.default_location_id) then
    raise exception using errcode='42501',message='square_qualification_task_mapping_denied';
  end if;
  if v_binding->>'scopeFingerprint' is distinct from private.phase_4_fingerprint_text_v1(
      private.phase_3_contract_fingerprint_v1((v_scope-'generation') || pg_catalog.jsonb_build_object('purpose','square_ingestion_scope_v1')))
    or v_binding->>'scanKey' is distinct from private.phase_4_fingerprint_text_v1(
      private.phase_3_contract_fingerprint_v1(pg_catalog.jsonb_build_object(
        'purpose','square_ingestion_scan_v1','workspaceId',v_connection.workspace_id,
        'businessEntityId',v_connection.business_entity_id,'connectionId',v_connection.connection_id,
        'stream',v_grant->>'stream','scanId',v_grant->>'scanId'))) then
    raise exception using errcode='42501',message='square_qualification_task_binding_denied';
  end if;
  -- queryFingerprint/cursorBindingFingerprint are the immutable read-plan outputs
  -- of the unchanged Square request validators, supplied only by trusted fixture
  -- enrollment. SQL does not duplicate all 25 pinned request normalizers. Runtime
  -- must match this exact binding; the adapter independently validates the grant's
  -- exact request and recomputes both before acquiring a page or reading transport.
  perform 1 from public.business_entities where workspace_id=v_connection.workspace_id and id=v_connection.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_qualification_entity_denied'; end if;
  perform private.assert_square_qualification_gate_v1();
  v_now:=pg_catalog.clock_timestamp();
  v_expiry:=pg_catalog.to_timestamp((v_grant->>'expiresAt')::numeric/1000);
  if v_expiry<=v_now or v_expiry>v_now+interval '1 hour' or v_expiry>v_generation.retention_expires_at then
    raise exception using errcode='42501',message='square_qualification_task_expiry_denied';
  end if;
  insert into private.square_ingestion_tasks(task_id,connection_id,workspace_id,business_entity_id,connection_generation,runtime_login,
    lease_owner_fingerprint,"grant",binding,expires_at,retention_policy_version,retention_expires_at,created_at)
    values ((p_command->>'taskId')::uuid,v_connection.connection_id,v_connection.workspace_id,v_connection.business_entity_id,
      v_connection.current_generation,(p_command->>'runtimeLogin')::name,p_command->>'leaseOwnerFingerprint',v_grant,v_binding,v_expiry,
      v_generation.retention_policy_version,v_generation.retention_expires_at,v_now);
  return pg_catalog.jsonb_build_object('taskId',p_command->>'taskId','grant',v_grant,'binding',v_binding);
end;
$function$;

create function private.lock_square_ingestion_authority_v1(p_task_id uuid,p_lease_owner_fingerprint text)
returns private.square_ingestion_tasks language plpgsql security invoker set search_path = '' as $function$
declare
  v_task private.square_ingestion_tasks;
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_now timestamptz;
  v_locations jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'square_ingestion_runtime_authority','MEMBER') then
    raise exception using errcode='42501',message='square_ingestion_runtime_authority_required';
  end if;
  perform private.assert_square_qualification_gate_v1();
  -- This first read locates the fence only. Tasks are immutable; no authority is
  -- established until connection and task locks are held and DB time reread.
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  select * into v_connection from private.square_connections where connection_id=v_task.connection_id for share;
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id for share;
  perform 1 from public.business_entities where workspace_id=v_task.workspace_id and id=v_task.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_qualification_gate_v1();
  if v_connection.state<>'active' or v_connection.current_generation<>v_task.connection_generation
    or v_connection.workspace_id<>v_task.workspace_id or v_connection.business_entity_id<>v_task.business_entity_id
    or v_task.runtime_login is distinct from session_user::name
    or v_task.lease_owner_fingerprint is distinct from p_lease_owner_fingerprint
    or v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations from private.square_location_mappings
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  if v_generation.identity_mode<>'synthetic_local_qualification'
    or v_generation.retention_expires_at<=v_now
    or v_task.retention_policy_version<>v_generation.retention_policy_version
    or v_task.retention_expires_at<>v_generation.retention_expires_at
    or v_task.grant#>'{scope,authorizedLocationIds}' is distinct from v_locations
    or v_task.grant#>>'{scope,sellerId}' is distinct from v_connection.seller_id
    or v_task.grant#>>'{scope,environment}' is distinct from v_connection.environment then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  return v_task;
end;
$function$;
create function public.resolve_square_ingestion_authority_v1(p_task_id uuid,p_lease_owner_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_task private.square_ingestion_tasks;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  return v_task.grant;
end;
$function$;
create function public.revoke_square_qualification_connection_v1(p_connection_id uuid,p_expected_generation bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_connection private.square_connections; v_now timestamptz;
begin
  perform private.assert_square_qualification_admin_v1();
  if p_reason is distinct from 'qualification_revoked' then
    raise exception using errcode='22023',message='square_qualification_revocation_invalid';
  end if;
  select * into v_connection from private.square_connections where connection_id=p_connection_id for update;
  if not found or v_connection.current_generation is distinct from p_expected_generation then
    raise exception using errcode='42501',message='square_qualification_revocation_denied';
  end if;
  perform private.assert_square_qualification_gate_v1();
  v_now:=pg_catalog.clock_timestamp();
  update private.square_connections set state='revoked',revoked_at=coalesce(revoked_at,v_now),revocation_reason=p_reason,updated_at=v_now
    where connection_id=p_connection_id;
  -- Historical generations, mappings, tasks, pending versions and receipts remain.
  return pg_catalog.jsonb_build_object('connectionId',p_connection_id,'generation',p_expected_generation,'state','revoked');
end;
$function$;

alter table private.square_qualification_gate enable row level security;
alter table private.square_qualification_gate force row level security;
alter table private.square_connections enable row level security;
alter table private.square_connections force row level security;
alter table private.square_connection_generations enable row level security;
alter table private.square_connection_generations force row level security;
alter table private.square_location_mappings enable row level security;
alter table private.square_location_mappings force row level security;
alter table private.square_ingestion_tasks enable row level security;
alter table private.square_ingestion_tasks force row level security;
revoke all on table private.square_qualification_gate,private.square_connections,private.square_connection_generations,
  private.square_location_mappings,private.square_ingestion_tasks from public,anon,authenticated,service_role,
  square_ingestion_runtime_authority,square_ingestion_qualification_admin;
revoke all on function private.assert_square_qualification_gate_v1(),private.assert_square_qualification_admin_v1(),
  private.protect_square_authority_history_v1(),private.protect_square_connection_identity_v1(),private.lock_square_ingestion_authority_v1(uuid,text)
  from public,anon,authenticated,service_role,square_ingestion_runtime_authority,square_ingestion_qualification_admin;
revoke all on function public.enroll_square_qualification_connection_v1(jsonb),public.enroll_square_qualification_task_v1(jsonb),
  public.revoke_square_qualification_connection_v1(uuid,bigint,text),public.resolve_square_ingestion_authority_v1(uuid,text)
  from public,anon,authenticated,service_role,square_ingestion_runtime_authority,square_ingestion_qualification_admin;
grant execute on function public.enroll_square_qualification_connection_v1(jsonb),public.enroll_square_qualification_task_v1(jsonb),
  public.revoke_square_qualification_connection_v1(uuid,bigint,text) to square_ingestion_qualification_admin;
grant execute on function public.resolve_square_ingestion_authority_v1(uuid,text) to square_ingestion_runtime_authority;

commit;
