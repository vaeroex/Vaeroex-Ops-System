-- Dormant Production customer connection authority. This is not an activation.
-- The reviewed foundation's false-only gates remain unchanged. A later, separately
-- approved activation must evolve them before prepare/callback/commit can succeed.
begin;

do $baseline$
declare v_count integer; v_fingerprint text;
begin
  if current_user::text <> 'postgres' or session_user::text <> 'postgres'
    or current_setting('server_version_num')::integer < 170000
    or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'square_production_customer_requires_postgres_17_owner' using errcode='55000';
  end if;
  select count(*)::integer,
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(pg_catalog.length(version)::text||':'||version,'' order by version),
      'UTF8'),'sha256'),'hex')
    into v_count,v_fingerprint from supabase_migrations.schema_migrations;
  if v_count <> 104 or v_fingerprint <> 'sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f'
    or (select count(*) from supabase_migrations.schema_migrations where version='20260902191325') <> 1
    or to_regclass('private.square_production_internal_permits') is null
    or to_regclass('private.square_account_configuration') is not null
    or to_regclass('private.square_production_customer_connections') is not null then
    raise exception 'square_production_customer_requires_exact_104_baseline' using errcode='55000';
  end if;
end
$baseline$;

create table private.square_production_customer_connections (
  connection_id uuid primary key,
  provider_key text not null default 'square' check(provider_key='square'),
  environment text not null default 'production' check(environment='production'),
  project_id text not null default 'vaeroex-integrations-prod' check(project_id='vaeroex-integrations-prod'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  actor_id uuid not null,
  session_id uuid not null,
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  row_version bigint not null default 1 check(row_version between 1 and 9007199254740991),
  state text not null check(state in (
    'authorization_required','consent_pending','mapping_required','recovery_required','disconnected'
  )),
  merchant_id text check(merchant_id is null or merchant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  seller_label text check(seller_label is null or length(seller_label) between 1 and 255),
  credential_id uuid,
  credential_version bigint check(credential_version between 1 and 9007199254740991),
  created_at timestamptz not null check(isfinite(created_at)),
  updated_at timestamptz not null check(isfinite(updated_at)),
  disconnected_at timestamptz check(disconnected_at is null or isfinite(disconnected_at)),
  foreign key(workspace_id,business_entity_id)
    references public.business_entities(workspace_id,id) on update restrict on delete restrict,
  foreign key(provider_key,environment,project_id,generation,configuration_fingerprint)
    references private.square_production_runtime_bindings(provider_key,environment,project_id,generation,configuration_fingerprint)
    on update restrict on delete restrict,
  check((credential_id is null)=(credential_version is null)),
  check((merchant_id is null)=(seller_label is null)),
  check((merchant_id is null)=(credential_id is null)),
  check((state='mapping_required')=(credential_id is not null) or state in ('recovery_required','disconnected')),
  check((state='disconnected')=(disconnected_at is not null))
);
create unique index square_production_customer_one_live_workspace
  on private.square_production_customer_connections(workspace_id) where state <> 'disconnected';
create index square_production_customer_entity_idx
  on private.square_production_customer_connections(workspace_id,business_entity_id);

create table private.square_production_customer_oauth_states (
  state_id uuid primary key,
  connection_id uuid not null references private.square_production_customer_connections(connection_id) on delete restrict,
  state_hash text not null unique check(state_hash ~ '^sha256:[a-f0-9]{64}$'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  connection_row_version bigint not null check(connection_row_version between 1 and 9007199254740991),
  actor_id uuid not null,
  session_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  consume_fingerprint text check(consume_fingerprint is null or consume_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  exchange_fingerprint text check(exchange_fingerprint is null or exchange_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  commit_fingerprint text check(commit_fingerprint is null or commit_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  status text not null check(status in ('pending','consumed','exchanging','stored','denied','uncertain','cancelled')),
  created_at timestamptz not null check(isfinite(created_at)),
  expires_at timestamptz not null check(isfinite(expires_at) and expires_at > created_at),
  consumed_at timestamptz check(consumed_at is null or isfinite(consumed_at)),
  stored_at timestamptz check(stored_at is null or isfinite(stored_at)),
  check((status in ('pending','denied','cancelled'))=(consumed_at is null)),
  check((status in ('consumed','exchanging','stored','uncertain'))=(consume_fingerprint is not null)),
  check(status='uncertain' or (status in ('exchanging','stored'))=(exchange_fingerprint is not null)),
  check((status='stored')=(stored_at is not null and commit_fingerprint is not null))
);
create unique index square_production_customer_one_open_state
  on private.square_production_customer_oauth_states(connection_id,generation)
  where status in ('pending','exchanging');

create table private.square_production_customer_credentials (
  credential_id uuid not null,
  credential_version bigint not null check(credential_version between 1 and 9007199254740991),
  connection_id uuid not null references private.square_production_customer_connections(connection_id) on delete restrict,
  oauth_state_id uuid not null unique references private.square_production_customer_oauth_states(state_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  ciphertext_base64 text not null check(length(ciphertext_base64) between 16 and 131072 and ciphertext_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  aad_context jsonb not null check(jsonb_typeof(aad_context)='object' and pg_catalog.pg_column_size(aad_context)<=4096),
  aad_digest text not null check(aad_digest ~ '^sha256:[a-f0-9]{64}$'),
  kms_key_resource text not null check(kms_key_resource ~ '^projects/vaeroex-integrations-prod/locations/us-west1/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$'),
  merchant_id text not null check(merchant_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  granted_scopes text[] not null check(granted_scopes=array[
    'INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'
  ]::text[]),
  command_fingerprint text not null check(command_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  provider_issued_at timestamptz not null check(isfinite(provider_issued_at)),
  access_expires_at timestamptz not null check(isfinite(access_expires_at) and access_expires_at>provider_issued_at),
  created_at timestamptz not null check(isfinite(created_at)),
  primary key(credential_id,credential_version),
  unique(connection_id,generation,command_fingerprint)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'square_production_customer_connections','square_production_customer_oauth_states',
    'square_production_customer_credentials'
  ] loop
    execute pg_catalog.format('alter table private.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table private.%I force row level security',relation_name);
    execute pg_catalog.format('revoke all on table private.%I from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority',relation_name);
  end loop;
end
$rls$;

create function private.square_production_customer_fingerprint_v1(p_parts text[])
returns text language sql immutable strict parallel safe security invoker set search_path=''
as $function$
  select private.integration_production_fingerprint_v1(p_parts)
$function$;

create function private.square_production_customer_require_keys_v1(p_payload jsonb,p_keys text[])
returns void language plpgsql immutable security invoker set search_path=''
as $function$
declare observed text[];
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or pg_catalog.pg_column_size(p_payload)>262144 then
    raise exception 'square_production_customer_payload_denied' using errcode='22023';
  end if;
  select array_agg(key order by key) into observed from jsonb_object_keys(p_payload) key;
  if observed is distinct from (select array_agg(key order by key) from unnest(p_keys) key)
    or cardinality(p_keys)<>(select count(distinct key) from unnest(p_keys) key) then
    raise exception 'square_production_customer_payload_denied' using errcode='22023';
  end if;
end
$function$;

create function private.square_production_customer_require_login_v1(p_capability text)
returns void language plpgsql stable security definer set search_path=''
as $function$
begin
  if p_capability not in ('oauth','broker') then
    raise exception 'square_production_customer_login_denied' using errcode='42501';
  end if;
  perform private.square_production_internal_require_login_v1(p_capability);
end
$function$;

create function private.square_production_customer_require_owner_v1(
  p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_business_entity_id uuid default null
)
returns void language plpgsql volatile security definer set search_path=''
as $function$
declare expires_at timestamptz; member_role text; member_status text; entity_status text; now_at timestamptz;
begin
  if p_actor_id is null or p_session_id is null or p_workspace_id is null then
    raise exception 'square_production_customer_owner_denied' using errcode='42501';
  end if;
  perform 1 from public.workspaces where id=p_workspace_id for share;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  select s.not_after into expires_at from auth.sessions s
    join auth.users u on u.id=s.user_id
    where s.id=p_session_id and s.user_id=p_actor_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
    for share of s,u;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  select m.role,m.status into member_role,member_status from public.workspace_members m
    where m.user_id=p_actor_id and m.workspace_id=p_workspace_id for share;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  if p_business_entity_id is not null then
    select e.status into entity_status from public.business_entities e
      where e.id=p_business_entity_id and e.workspace_id=p_workspace_id for share;
    if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  end if;
  now_at:=clock_timestamp();
  if expires_at is null or expires_at<=now_at or member_role<>'owner'
    or member_status<>'active' or (p_business_entity_id is not null and entity_status<>'active') then
    raise exception 'square_production_customer_owner_denied' using errcode='42501';
  end if;
end
$function$;

create function private.square_production_customer_require_eligible_v1(p_workspace_id uuid)
returns void language plpgsql volatile security definer set search_path=''
as $function$
declare workspace_row public.workspaces; subscription_row public.customer_subscriptions;
declare manual_allowed boolean:=false; now_at timestamptz;
begin
  select w.* into workspace_row from public.workspaces w where w.id=p_workspace_id for share;
  if not found then raise exception 'square_production_customer_entitlement_denied' using errcode='42501'; end if;
  select s.* into subscription_row from public.customer_subscriptions s
    where s.workspace_id=p_workspace_id and s.billing_provider='stripe'
    order by s.created_at desc,s.id desc limit 1 for share;
  now_at:=clock_timestamp();
  if found then
    if subscription_row.manually_activated or subscription_row.status not in ('active','trialing')
      or subscription_row.current_period_end is null or subscription_row.current_period_end<=now_at
      or subscription_row.stripe_customer_id is null or subscription_row.stripe_subscription_id is null then
      raise exception 'square_production_customer_entitlement_denied' using errcode='42501';
    end if;
    return;
  end if;
  select exists(select 1 from public.customer_subscriptions s
    where s.workspace_id=p_workspace_id and s.billing_provider='manual'
      and s.manually_activated and s.status in ('active','trialing')) into manual_allowed;
  if not (workspace_row.manually_unlocked and manual_allowed) then
    raise exception 'square_production_customer_entitlement_denied' using errcode='42501';
  end if;
end
$function$;

create function private.square_production_customer_require_gate_v1(
  p_generation bigint,p_configuration_fingerprint text,p_capability text
)
returns private.square_production_configuration_generations
language plpgsql volatile security definer set search_path=''
as $function$
declare configuration private.square_production_configuration_generations;
declare binding private.square_production_runtime_bindings;
declare provider_binding private.integration_production_provider_bindings;
declare platform_binding private.integration_production_platform_bindings;
begin
  if p_capability in ('oauth','broker') then
    perform private.square_production_customer_require_login_v1(p_capability);
  elsif p_capability<>'owner' then
    raise exception 'square_production_customer_gate_closed' using errcode='42501';
  end if;
  select b.* into binding from private.square_production_runtime_bindings b
    where b.provider_key='square' and b.environment='production'
      and b.project_id='vaeroex-integrations-prod'
    order by b.generation desc limit 1 for share;
  if not found or binding.generation is distinct from p_generation
    or binding.configuration_fingerprint is distinct from p_configuration_fingerprint
    or exists(select 1 from private.square_production_generation_fences f
      where f.provider_key='square' and f.environment='production'
        and f.project_id='vaeroex-integrations-prod' and f.generation=p_generation)
    then raise exception 'square_production_customer_generation_denied' using errcode='42501'; end if;
  select c.* into configuration from private.square_production_configuration_generations c
    where c.provider_key='square' and c.environment='production'
      and c.project_id='vaeroex-integrations-prod'
      and c.generation=p_generation and c.configuration_fingerprint=p_configuration_fingerprint
    for share;
  if not found then raise exception 'square_production_customer_generation_denied' using errcode='42501'; end if;
  select pb.* into provider_binding from private.integration_production_provider_bindings pb
    where pb.provider_key='square' and pb.environment='production'
      and pb.project_id='vaeroex-integrations-prod' for share;
  if not found then raise exception 'square_production_customer_gate_closed' using errcode='42501'; end if;
  select platform.* into platform_binding from private.integration_production_platform_bindings platform
    where platform.binding_key=provider_binding.platform_binding_key
      and platform.project_id='vaeroex-integrations-prod' for share;
  if not found or not platform_binding.infrastructure_provisioned
    or not platform_binding.runtime_enabled or not provider_binding.enabled
    or not provider_binding.provider_calls_enabled or not provider_binding.customer_onboarding_enabled
    or not configuration.runtime_enabled or not configuration.provider_calls_enabled
    or not configuration.customer_onboarding_enabled
    or configuration.webhook_intake_enabled or configuration.economic_contributions_enabled
    or configuration.ai_dispatch_enabled or provider_binding.webhook_intake_enabled
    or provider_binding.economic_contributions_enabled or provider_binding.ai_dispatch_enabled
    then raise exception 'square_production_customer_gate_closed' using errcode='42501'; end if;
  return configuration;
end
$function$;

create function private.square_production_customer_immutable_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin raise exception 'square_production_customer_history_immutable' using errcode='55000'; end
$function$;
create trigger square_production_customer_credential_immutable
  before update or delete on private.square_production_customer_credentials
  for each row execute function private.square_production_customer_immutable_v1();

create function public.square_production_customer_v1(p_operation text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare connection_row private.square_production_customer_connections;
declare state_row private.square_production_customer_oauth_states;
declare configuration_row private.square_production_configuration_generations;
declare actor_uuid uuid; session_uuid uuid; workspace_uuid uuid; entity_uuid uuid;
declare connection_uuid uuid; state_uuid uuid; credential_uuid uuid; credential_version_number bigint;
declare generation_number bigint; configuration_hash text; state_digest text; request_hash text;
declare expected_hash text; aad jsonb; now_at timestamptz; expires_at timestamptz;
begin
  if p_operation is null or p_operation not in (
    'status','prepare','create_state','lookup_state','consume_state',
    'acquire_exchange','authorize_exchange','deny_state','commit_credential','authorization_failed','disconnect'
  ) then raise exception 'square_production_customer_operation_denied' using errcode='42501'; end if;
  if p_operation in ('status','prepare','create_state','disconnect') then
    -- These are the only browser-session operations. The supplied payload has
    -- no actor or session claims; PostgREST's checked JWT is revalidated against
    -- the live session and owner membership below.
    if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated'
      or auth.jwt()->>'is_anonymous'='true'
      or auth.jwt()->>'session_id' is null
      or session_user::text in ('square_production_oauth','square_production_broker') then
      raise exception 'square_production_customer_owner_denied' using errcode='42501';
    end if;
  else
    perform private.square_production_customer_require_login_v1(
      case when p_operation in ('acquire_exchange','authorize_exchange','commit_credential') then 'broker' else 'oauth' end);
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_catalog.pg_column_size(p_payload)>262144 then
    raise exception 'square_production_customer_payload_denied' using errcode='22023';
  end if;

  if p_operation in ('status','prepare','create_state','disconnect') then
    actor_uuid:=auth.uid();
    session_uuid:=(auth.jwt()->>'session_id')::uuid;
    workspace_uuid:=(p_payload->>'workspaceId')::uuid;
  end if;

  if p_operation='status' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['workspaceId']);
    perform private.square_production_customer_require_owner_v1(actor_uuid,session_uuid,workspace_uuid);
    return jsonb_build_object(
      'canManage',true,
      'businessEntities',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',display_name) order by id),'[]'::jsonb)
        from (select id,display_name from public.business_entities
          where workspace_id=workspace_uuid and status='active' order by id limit 1000) entities),
      'connections',(select coalesce(jsonb_agg(jsonb_build_object(
        'connectionId',connection_id,'businessEntityId',business_entity_id,'state',state,
        'sellerLabel',seller_label,'locations','[]'::jsonb,'mappedLocationIds','[]'::jsonb,
        'retentionApproved',false,'revocationPending',false) order by (state='disconnected'),updated_at desc,connection_id),'[]'::jsonb)
        from (select * from private.square_production_customer_connections
          where workspace_id=workspace_uuid order by (state='disconnected'),updated_at desc,connection_id limit 32) scoped)
    );
  end if;

  if p_operation='prepare' then
    perform private.square_production_customer_require_keys_v1(p_payload,
      array['workspaceId','businessEntityId','connectionId']);
    entity_uuid:=(p_payload->>'businessEntityId')::uuid;
    connection_uuid:=(p_payload->>'connectionId')::uuid;
    perform private.square_production_customer_require_owner_v1(actor_uuid,session_uuid,workspace_uuid,entity_uuid);
    perform private.square_production_customer_require_eligible_v1(workspace_uuid);
    select b.generation,b.configuration_fingerprint into generation_number,configuration_hash
      from private.square_production_runtime_bindings b
      where b.provider_key='square' and b.environment='production'
        and b.project_id='vaeroex-integrations-prod'
      order by b.generation desc limit 1;
    configuration_row:=private.square_production_customer_require_gate_v1(generation_number,configuration_hash,'owner');
    now_at:=clock_timestamp();
    insert into private.square_production_customer_connections(
      connection_id,workspace_id,business_entity_id,actor_id,session_id,
      generation,configuration_fingerprint,state,created_at,updated_at
    ) values (
      connection_uuid,workspace_uuid,entity_uuid,actor_uuid,session_uuid,
      generation_number,configuration_hash,'authorization_required',now_at,now_at
    ) returning * into connection_row;
    return jsonb_build_object('connectionId',connection_row.connection_id,
      'businessEntityId',connection_row.business_entity_id,'generation',connection_row.generation,
      'configurationFingerprint',connection_row.configuration_fingerprint,
      'applicationId',configuration_row.application_id,'rowVersion',connection_row.row_version);
  end if;

  if p_operation in ('lookup_state','consume_state','deny_state') then
    state_digest:=p_payload->>'stateHash';
    if state_digest is null or state_digest !~ '^sha256:[a-f0-9]{64}$' then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    select s.* into state_row from private.square_production_customer_oauth_states s
      where s.state_hash=state_digest;
    if not found then return jsonb_build_object('accepted',false); end if;
    connection_uuid:=state_row.connection_id;
  else
    connection_uuid:=(p_payload->>'connectionId')::uuid;
  end if;

  if p_operation in ('acquire_exchange','authorize_exchange','commit_credential','authorization_failed') then
    state_uuid:=(p_payload->>'stateId')::uuid;
    select s.* into state_row from private.square_production_customer_oauth_states s
      where s.state_id=state_uuid;
    if not found then raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    connection_uuid:=state_row.connection_id;
  end if;

  -- Revalidate the original owner and session for callbacks; a callback never
  -- accepts replacement actor/workspace claims from its query string.
  select c.* into connection_row from private.square_production_customer_connections c
    where c.connection_id=connection_uuid;
  if not found then raise exception 'square_production_customer_connection_denied' using errcode='42501'; end if;
  if p_operation='create_state' and
    (connection_row.actor_id<>actor_uuid or connection_row.session_id<>session_uuid
      or connection_row.workspace_id<>workspace_uuid) then
    raise exception 'square_production_customer_connection_denied' using errcode='42501'; end if;
  if p_operation='disconnect' then
    if connection_row.workspace_id<>workspace_uuid then
      raise exception 'square_production_customer_connection_denied' using errcode='42501'; end if;
    perform private.square_production_customer_require_owner_v1(
      actor_uuid,session_uuid,workspace_uuid);
  else
    perform private.square_production_customer_require_owner_v1(
      connection_row.actor_id,connection_row.session_id,
      connection_row.workspace_id,connection_row.business_entity_id);
  end if;

  if p_operation<>'disconnect' then
    perform private.square_production_customer_require_eligible_v1(connection_row.workspace_id);
  end if;
  select c.* into connection_row from private.square_production_customer_connections c
    where c.connection_id=connection_uuid for update;
  if p_operation in ('lookup_state','consume_state','deny_state','acquire_exchange','authorize_exchange','commit_credential','authorization_failed') then
    select s.* into state_row from private.square_production_customer_oauth_states s
      where s.state_id=state_row.state_id for update;
    if not found or state_row.connection_id<>connection_row.connection_id
      or state_row.generation<>connection_row.generation
      or state_row.actor_id<>connection_row.actor_id
      or state_row.session_id<>connection_row.session_id then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
  end if;

  if p_operation='disconnect' then
    perform private.square_production_customer_require_keys_v1(p_payload,
      array['workspaceId','connectionId','confirmation']);
    if p_payload->>'confirmation'<>'disconnect' then
      raise exception 'square_production_customer_disconnect_denied' using errcode='42501'; end if;
    if connection_row.state<>'disconnected' then
      update private.square_production_customer_oauth_states
        set status='cancelled' where connection_id=connection_uuid and status='pending';
      update private.square_production_customer_connections
        set state='disconnected',disconnected_at=clock_timestamp(),updated_at=clock_timestamp(),
          row_version=row_version+1 where connection_id=connection_uuid;
    end if;
    return jsonb_build_object('fenced',true);
  end if;

  configuration_row:=private.square_production_customer_require_gate_v1(
    connection_row.generation,connection_row.configuration_fingerprint,
    case when p_operation in ('acquire_exchange','authorize_exchange','commit_credential') then 'broker'
      when p_operation='create_state' then 'owner' else 'oauth' end);
  now_at:=clock_timestamp();
  if connection_row.state='disconnected' then
    raise exception 'square_production_customer_connection_fenced' using errcode='42501'; end if;

  if p_operation='create_state' then
    perform private.square_production_customer_require_keys_v1(p_payload,array[
      'workspaceId','connectionId','stateId','stateHash','requestFingerprint','expiresAt'
    ]);
    state_uuid:=(p_payload->>'stateId')::uuid;
    state_digest:=p_payload->>'stateHash';
    request_hash:=p_payload->>'requestFingerprint';
    expires_at:=(p_payload->>'expiresAt')::timestamptz;
    expected_hash:=private.square_production_customer_fingerprint_v1(array[
      'square-production-customer-state-v1',connection_uuid::text,state_uuid::text,state_digest,
      actor_uuid::text,session_uuid::text,connection_row.generation::text,connection_row.row_version::text
    ]);
    if connection_row.state<>'authorization_required'
      or state_digest !~ '^sha256:[a-f0-9]{64}$' or request_hash is distinct from expected_hash
      or expires_at<=now_at or expires_at>now_at+interval '10 minutes' then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    insert into private.square_production_customer_oauth_states(
      state_id,connection_id,state_hash,generation,connection_row_version,actor_id,session_id,
      request_fingerprint,status,created_at,expires_at
    ) values (state_uuid,connection_uuid,state_digest,connection_row.generation,
      connection_row.row_version,actor_uuid,session_uuid,request_hash,'pending',now_at,expires_at);
    update private.square_production_customer_connections
      set state='consent_pending',row_version=row_version+1,updated_at=now_at
      where connection_id=connection_uuid;
    return jsonb_build_object('stateId',state_uuid,'expiresAt',expires_at,
      'workspaceId',connection_row.workspace_id,'actorId',actor_uuid,'sessionId',session_uuid,
      'businessEntityId',connection_row.business_entity_id,'generation',connection_row.generation,
      'configurationFingerprint',connection_row.configuration_fingerprint,
      'applicationId',configuration_row.application_id);
  end if;

  if p_operation='lookup_state' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['stateHash']);
    if state_row.status<>'pending' or state_row.expires_at<=now_at
      or connection_row.state<>'consent_pending' then return jsonb_build_object('accepted',false); end if;
    return jsonb_build_object('accepted',true,'stateId',state_row.state_id,
      'connectionId',connection_row.connection_id,'workspaceId',connection_row.workspace_id,
      'businessEntityId',connection_row.business_entity_id,'actorId',connection_row.actor_id,
      'sessionId',connection_row.session_id,'generation',connection_row.generation,
      'rowVersion',connection_row.row_version,'configurationFingerprint',connection_row.configuration_fingerprint,
      'applicationId',configuration_row.application_id);
  end if;

  if p_operation='consume_state' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['stateHash','requestFingerprint']);
    request_hash:=p_payload->>'requestFingerprint';
    expected_hash:=private.square_production_customer_fingerprint_v1(array[
      'square-production-customer-consume-v1',state_row.state_id::text,state_digest,connection_row.generation::text
    ]);
    if request_hash is distinct from expected_hash then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    if state_row.status in ('consumed','exchanging','stored') and state_row.consume_fingerprint=request_hash then
      return jsonb_build_object('status','replayed','stateId',state_row.state_id,
        'connectionId',connection_uuid,'generation',connection_row.generation);
    end if;
    if state_row.status<>'pending' or state_row.expires_at<=now_at
      or connection_row.state<>'consent_pending' then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    update private.square_production_customer_oauth_states
      set status='consumed',consume_fingerprint=request_hash,consumed_at=now_at
      where state_id=state_row.state_id;
    return jsonb_build_object('status','acquired','stateId',state_row.state_id,
      'connectionId',connection_uuid,'generation',connection_row.generation);
  end if;

  if p_operation='authorize_exchange' then
    perform private.square_production_customer_require_keys_v1(p_payload,
      array['stateId','connectionId','generation','requestFingerprint']);
    if (p_payload->>'connectionId')::uuid is distinct from connection_uuid
      or (p_payload->>'generation')::bigint is distinct from connection_row.generation
      or p_payload->>'requestFingerprint' is distinct from state_row.exchange_fingerprint
      or state_row.status<>'exchanging' or state_row.expires_at<=now_at
      or connection_row.state<>'consent_pending' then
      raise exception 'square_production_customer_exchange_denied' using errcode='42501'; end if;
    return jsonb_build_object('authorized',true,'stateId',state_row.state_id,
      'connectionId',connection_uuid,'generation',connection_row.generation);
  end if;

  if p_operation='acquire_exchange' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['stateId','requestFingerprint']);
    request_hash:=p_payload->>'requestFingerprint';
    expected_hash:=private.square_production_customer_fingerprint_v1(array[
      'square-production-customer-acquire-v1',state_row.state_id::text,
      connection_uuid::text,connection_row.generation::text
    ]);
    if request_hash is distinct from expected_hash then
      raise exception 'square_production_customer_exchange_denied' using errcode='42501'; end if;
    if state_row.status in ('exchanging','stored') and state_row.exchange_fingerprint=request_hash then
      return jsonb_build_object('status',case when state_row.status='stored' then 'stored' else 'replayed' end,
        'stateId',state_row.state_id,'connectionId',connection_uuid,'generation',connection_row.generation);
    end if;
    if state_row.status<>'consumed' or connection_row.state<>'consent_pending' then
      raise exception 'square_production_customer_exchange_denied' using errcode='42501'; end if;
    update private.square_production_customer_oauth_states
      set status='exchanging',exchange_fingerprint=request_hash where state_id=state_row.state_id;
    return jsonb_build_object('status','acquired','stateId',state_row.state_id,
      'connectionId',connection_uuid,'workspaceId',connection_row.workspace_id,
      'businessEntityId',connection_row.business_entity_id,'actorId',connection_row.actor_id,
      'sessionId',connection_row.session_id,'generation',connection_row.generation,
      'configurationFingerprint',connection_row.configuration_fingerprint,
      'applicationId',configuration_row.application_id,
      'kmsKeyResource',configuration_row.kms_key_resource);
  end if;

  if p_operation='deny_state' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['stateHash']);
    if state_row.status<>'pending' or state_row.expires_at<=now_at then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    update private.square_production_customer_oauth_states set status='denied'
      where state_id=state_row.state_id;
    update private.square_production_customer_connections
      set state='recovery_required',row_version=row_version+1,updated_at=now_at
      where connection_id=connection_uuid;
    return jsonb_build_object('accepted',true);
  end if;

  if p_operation='authorization_failed' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['stateId']);
    if state_row.status not in ('consumed','exchanging') then
      raise exception 'square_production_customer_state_denied' using errcode='42501'; end if;
    update private.square_production_customer_oauth_states set status='uncertain'
      where state_id=state_row.state_id;
    update private.square_production_customer_connections
      set state='recovery_required',row_version=row_version+1,updated_at=now_at
      where connection_id=connection_uuid;
    return jsonb_build_object('fenced',true);
  end if;

  if p_operation='commit_credential' then
    perform private.square_production_customer_require_keys_v1(p_payload,array[
      'stateId','requestFingerprint','credentialId','credentialVersion','ciphertextBase64',
      'aadContext','aadDigest','kmsKeyResource','merchantId','merchantLabel','scopes',
      'providerIssuedAt','accessExpiresAt'
    ]);
    credential_uuid:=(p_payload->>'credentialId')::uuid;
    credential_version_number:=(p_payload->>'credentialVersion')::bigint;
    aad:=p_payload->'aadContext';
    request_hash:=p_payload->>'requestFingerprint';
    expected_hash:=private.square_production_customer_fingerprint_v1(array[
      'square-production-customer-commit-v1',state_row.state_id::text,credential_uuid::text,
      credential_version_number::text,p_payload->>'aadDigest',p_payload->>'merchantId'
    ]);
    if credential_uuid is null or credential_version_number is null
      or credential_version_number not between 1 and 9007199254740991
      or p_payload->>'ciphertextBase64' is null
      or p_payload->>'merchantId' is null
      or p_payload->>'merchantLabel' is null
      or p_payload->>'providerIssuedAt' is null
      or p_payload->>'accessExpiresAt' is null
      or request_hash is distinct from expected_hash
      or p_payload->>'aadDigest' is distinct from private.square_production_customer_fingerprint_v1(array[
        'square-production-customer-aad-v1',connection_row.workspace_id::text,connection_uuid::text,
        connection_row.generation::text,credential_uuid::text,credential_version_number::text
      ])
      or aad is distinct from jsonb_build_object(
        'providerKey','square','environment','production','projectId','vaeroex-integrations-prod',
        'workspaceId',connection_row.workspace_id,'connectionId',connection_uuid,
        'generation',connection_row.generation,'credentialId',credential_uuid,
        'credentialVersion',credential_version_number)
      or p_payload->>'kmsKeyResource' is distinct from configuration_row.kms_key_resource
      or p_payload->>'merchantId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
      or p_payload->>'merchantLabel' is null or length(p_payload->>'merchantLabel') not between 1 and 255
      or p_payload->'scopes' is distinct from to_jsonb(configuration_row.requested_scopes)
      or (p_payload->>'providerIssuedAt')::timestamptz>now_at+interval '5 minutes'
      or (p_payload->>'accessExpiresAt')::timestamptz<=now_at
      or connection_row.state not in ('consent_pending','mapping_required') then
      raise exception 'square_production_customer_credential_denied' using errcode='42501'; end if;
    if state_row.status='stored' and state_row.commit_fingerprint=request_hash then
      return jsonb_build_object('status','stored','connectionId',connection_uuid,
        'generation',connection_row.generation,'replayed',true);
    end if;
    if state_row.status<>'exchanging' then
      raise exception 'square_production_customer_credential_denied' using errcode='42501'; end if;
    if connection_row.state<>'consent_pending' then
      raise exception 'square_production_customer_credential_denied' using errcode='42501'; end if;
    insert into private.square_production_customer_credentials(
      credential_id,credential_version,connection_id,oauth_state_id,generation,
      ciphertext_base64,aad_context,aad_digest,kms_key_resource,merchant_id,
      granted_scopes,command_fingerprint,provider_issued_at,access_expires_at,created_at
    ) values (
      credential_uuid,credential_version_number,connection_uuid,state_row.state_id,
      connection_row.generation,p_payload->>'ciphertextBase64',aad,p_payload->>'aadDigest',
      p_payload->>'kmsKeyResource',p_payload->>'merchantId',configuration_row.requested_scopes,
      request_hash,(p_payload->>'providerIssuedAt')::timestamptz,
      (p_payload->>'accessExpiresAt')::timestamptz,now_at
    );
    update private.square_production_customer_oauth_states
      set status='stored',stored_at=now_at,commit_fingerprint=request_hash
      where state_id=state_row.state_id;
    update private.square_production_customer_connections
      set state='mapping_required',merchant_id=p_payload->>'merchantId',
        seller_label=p_payload->>'merchantLabel',credential_id=credential_uuid,
        credential_version=credential_version_number,row_version=row_version+1,updated_at=now_at
      where connection_id=connection_uuid;
    return jsonb_build_object('status','stored','connectionId',connection_uuid,
      'generation',connection_row.generation,'replayed',false);
  end if;

  raise exception 'square_production_customer_operation_denied' using errcode='42501';
end
$function$;

revoke all on function private.square_production_customer_fingerprint_v1(text[]),
  private.square_production_customer_require_keys_v1(jsonb,text[]),
  private.square_production_customer_require_login_v1(text),
  private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid),
  private.square_production_customer_require_eligible_v1(uuid),
  private.square_production_customer_require_gate_v1(bigint,text,text),
  private.square_production_customer_immutable_v1()
  from public,anon,authenticated,service_role,square_production_oauth_authority,
    square_production_broker_authority,square_production_runtime_authority,
    square_production_evidence_authority,square_production_scheduler_authority,
    square_production_webhook_authority;
revoke all on function public.square_production_customer_v1(text,jsonb)
  from public,anon,authenticated,service_role,square_production_oauth_authority,
    square_production_broker_authority,square_production_runtime_authority,
    square_production_evidence_authority,square_production_scheduler_authority,
    square_production_webhook_authority;
grant execute on function public.square_production_customer_v1(text,jsonb)
  to authenticated,square_production_oauth_authority,square_production_broker_authority;

commit;
