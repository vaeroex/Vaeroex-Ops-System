-- Customer location mapping and one owner-requested Payments page only.
-- No internal-seller permits, raw provider payloads, money, cursors or AI work.
begin;
do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or current_setting('server_version_num')::integer not between 170000 and 179999
    or (select count(*) from supabase_migrations.schema_migrations)<>105
    or (select max(version) from supabase_migrations.schema_migrations)<>'20260925032300'
    or (select 'sha256:'||encode(extensions.digest(convert_to(string_agg(length(version)::text||':'||version,'' order by version),'UTF8'),'sha256'),'hex') from supabase_migrations.schema_migrations)
      <>'sha256:33bb3e49ae22026172264da954a02a869afcc878b33a57a78f0258e20d9a5d16' then
    raise exception 'square_customer_read_requires_exact_105_baseline' using errcode='55000';
  end if;
end $baseline$;

create table private.square_production_workspace_read_bindings (
  generation bigint primary key check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  read_enabled boolean not null default false
);
create table private.square_production_workspace_locations (
  connection_id uuid not null, generation bigint not null,
  location_fingerprint text not null check(location_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  provider_location_id text not null check(provider_location_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  label text not null check(length(label) between 1 and 255),
  discovered_at timestamptz not null check(isfinite(discovered_at)),
  primary key(connection_id,generation,location_fingerprint),
  unique(connection_id,generation,provider_location_id)
);
create table private.square_production_workspace_mappings (
  connection_id uuid not null, generation bigint not null,
  location_fingerprint text not null,
  mapping_fingerprint text not null check(mapping_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  mapped_at timestamptz not null check(isfinite(mapped_at)),
  primary key(connection_id,generation),
  foreign key(connection_id,generation,location_fingerprint)
    references private.square_production_workspace_locations on update restrict on delete restrict
);
create table private.square_production_workspace_scans (
  scan_id uuid primary key, connection_id uuid not null, generation bigint not null,
  workspace_id uuid not null, business_entity_id uuid not null, actor_id uuid not null, session_id uuid not null,
  connection_row_version bigint not null, mapping_fingerprint text not null,
  window_start timestamptz not null, window_end timestamptz not null,
  status text not null check(status in ('ready','leased','committed','uncertain')),
  lease_id uuid unique, lease_fingerprint text, lease_expires_at timestamptz,
  provider_started_at timestamptz, provider_authorized boolean not null default false,
  response_fingerprint text, command_fingerprint text,
  observation_count integer check(observation_count between 0 and 100),
  has_more boolean, verified_at timestamptz,
  created_at timestamptz not null,
  unique(connection_id,generation),
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on update restrict on delete restrict,
  foreign key(connection_id,generation) references private.square_production_workspace_mappings on update restrict on delete restrict,
  check(isfinite(window_start) and isfinite(window_end) and window_end>window_start and window_end-window_start<=interval '24 hours'),
  check(status='ready' or (lease_id is not null and lease_fingerprint is not null and lease_fingerprint ~ '^sha256:[a-f0-9]{64}$' and lease_expires_at is not null and isfinite(lease_expires_at))),
  check((status='committed')=(command_fingerprint is not null and response_fingerprint is not null and observation_count is not null and has_more is not null and verified_at is not null))
);
create index square_workspace_read_queue on private.square_production_workspace_scans(created_at,scan_id) where status='ready';
create table private.square_production_workspace_payment_observations (
  connection_id uuid not null, generation bigint not null, scan_id uuid not null references private.square_production_workspace_scans(scan_id) on delete restrict,
  ordinal integer not null check(ordinal between 1 and 100),
  payment_fingerprint text not null check(payment_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  version_fingerprint text not null check(version_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  payment_status text not null check(payment_status in ('approved','completed','canceled','failed','pending','unknown')),
  occurred_at timestamptz not null check(isfinite(occurred_at)), observed_at timestamptz not null check(isfinite(observed_at)),
  source_fingerprint text not null check(source_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  primary key(connection_id,generation,payment_fingerprint,version_fingerprint), unique(scan_id,ordinal),
  check(occurred_at<=observed_at)
);
do $rls$
declare relation_name text;
begin
  foreach relation_name in array array['square_production_workspace_read_bindings','square_production_workspace_locations',
    'square_production_workspace_mappings','square_production_workspace_scans','square_production_workspace_payment_observations'] loop
    execute format('alter table private.%I enable row level security',relation_name);
    execute format('alter table private.%I force row level security',relation_name);
    execute format('revoke all on table private.%I from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority',relation_name);
  end loop;
end $rls$;
create trigger square_workspace_location_immutable before update or delete on private.square_production_workspace_locations
 for each row execute function private.square_production_customer_immutable_v1();
create trigger square_workspace_mapping_immutable before update or delete on private.square_production_workspace_mappings
 for each row execute function private.square_production_customer_immutable_v1();
create trigger square_workspace_payment_immutable before update or delete on private.square_production_workspace_payment_observations
 for each row execute function private.square_production_customer_immutable_v1();

create function private.square_production_workspace_read_context_v1(p_connection uuid,p_generation bigint,p_actor uuid,p_session uuid,p_row_version bigint default null)
returns private.square_production_customer_connections language plpgsql volatile security definer set search_path=''
as $function$
declare c private.square_production_customer_connections;
begin
  select * into c from private.square_production_customer_connections where connection_id=p_connection for share;
  if not found or c.generation is distinct from p_generation or c.state<>'mapping_required'
    or c.credential_id is null or (p_row_version is not null and c.row_version<>p_row_version) then
    raise exception 'square_customer_read_authority_denied' using errcode='42501';
  end if;
  perform private.square_production_customer_require_owner_v1(p_actor,p_session,c.workspace_id,c.business_entity_id);
  perform private.square_production_customer_require_eligible_v1(c.workspace_id);
  perform private.square_production_customer_require_gate_v1(c.generation,c.configuration_fingerprint,'owner');
  perform 1 from private.square_production_workspace_read_bindings b where b.generation=c.generation
    and b.configuration_fingerprint=c.configuration_fingerprint and b.read_enabled for share;
  if not found then raise exception 'square_customer_read_gate_closed' using errcode='42501'; end if;
  if not exists(select from private.integration_production_provider_secrets s where s.provider_key='square'
    and s.environment='production' and s.project_id='vaeroex-integrations-prod' and s.secret_purpose='database_runtime'
    and s.secret_version_resource='projects/vaeroex-integrations-prod/secrets/square-production-runtime-db/versions/1')
    or not exists(select from private.integration_production_provider_capabilities p where p.provider_key='square'
      and p.environment='production' and p.project_id='vaeroex-integrations-prod' and p.capability='runtime'
      and p.database_login::text='square_production_runtime' and p.database_secret_purpose='database_runtime'
      and p.service_account='sq-prod-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com') then
    raise exception 'square_customer_read_gate_closed' using errcode='42501'; end if;
  return c;
end $function$;

create function public.square_production_workspace_read_v1(p_operation text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare c private.square_production_customer_connections; s private.square_production_workspace_scans;
declare m private.square_production_workspace_mappings; st private.square_production_customer_oauth_states;
declare credential private.square_production_customer_credentials;
declare actor_uuid uuid; session_uuid uuid; workspace_uuid uuid; connection_uuid uuid; generation_number bigint;
declare location_row jsonb; observation jsonb; expected text; count_rows integer; ordinal_number integer;
declare now_at timestamptz; start_at timestamptz; end_at timestamptz; mapping_hash text; row_hashes text[]:=array[]::text[];
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>131072
    or p_operation is null or p_operation not in ('store_locations','status','map','start','claim','credential','authorize_page','commit','reconcile','fail') then
    raise exception 'square_customer_read_command_denied' using errcode='22023'; end if;
  if exists(select from jsonb_each(p_payload) where value='null'::jsonb) then
    raise exception 'square_customer_read_command_denied' using errcode='22023'; end if;
  if p_operation in ('status','map','start') then
    if auth.uid() is null or session_user in ('square_production_oauth','square_production_broker','square_production_runtime','square_production_evidence') then
      raise exception 'square_customer_read_owner_denied' using errcode='42501'; end if;
    actor_uuid:=auth.uid(); session_uuid:=(auth.jwt()->>'session_id')::uuid;
    workspace_uuid:=(p_payload->>'workspaceId')::uuid; connection_uuid:=(p_payload->>'connectionId')::uuid;
    select * into c from private.square_production_customer_connections where connection_id=connection_uuid for share;
    if not found or c.workspace_id is distinct from workspace_uuid then raise exception 'square_customer_read_owner_denied' using errcode='42501'; end if;
    c:=private.square_production_workspace_read_context_v1(c.connection_id,c.generation,actor_uuid,session_uuid);
  else
    perform private.square_production_internal_require_login_v1(case when p_operation in ('store_locations','credential','authorize_page') then 'broker' else 'runtime' end);
  end if;
  now_at:=clock_timestamp();

  if p_operation='store_locations' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['locations','requestFingerprint','stateId']);
    select * into st from private.square_production_customer_oauth_states where state_id=(p_payload->>'stateId')::uuid for share;
    if not found or st.status<>'exchanging' or st.expires_at<=clock_timestamp() or st.exchange_fingerprint is distinct from p_payload->>'requestFingerprint' then
      raise exception 'square_customer_locations_denied' using errcode='42501'; end if;
    select * into c from private.square_production_customer_connections where connection_id=st.connection_id for share;
    if not found or c.state<>'consent_pending' or c.generation<>st.generation or c.row_version<>st.connection_row_version then
      raise exception 'square_customer_locations_denied' using errcode='42501'; end if;
    perform private.square_production_customer_require_owner_v1(st.actor_id,st.session_id,c.workspace_id,c.business_entity_id);
    perform private.square_production_customer_require_eligible_v1(c.workspace_id);
    perform private.square_production_customer_require_gate_v1(c.generation,c.configuration_fingerprint,'broker');
    if jsonb_typeof(p_payload->'locations') is distinct from 'array' or jsonb_array_length(p_payload->'locations') not between 1 and 1000
      or exists(select 1 from private.square_production_workspace_locations where connection_id=c.connection_id and generation=c.generation) then
      raise exception 'square_customer_locations_denied' using errcode='42501'; end if;
    for location_row in select value from jsonb_array_elements(p_payload->'locations') loop
      perform private.square_production_customer_require_keys_v1(location_row,array['id','label']);
      if location_row->>'id' is null or location_row->>'label' is null then raise exception 'square_customer_locations_denied' using errcode='42501'; end if;
      insert into private.square_production_workspace_locations values(c.connection_id,c.generation,
        private.square_production_customer_fingerprint_v1(array['square-customer-location-v1',c.connection_id::text,c.generation::text,location_row->>'id']),
        location_row->>'id',location_row->>'label',now_at);
    end loop;
    return jsonb_build_object('stored',true);
  elsif p_operation='status' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['connectionId','workspaceId']);
    select * into m from private.square_production_workspace_mappings where connection_id=c.connection_id and generation=c.generation;
    select * into s from private.square_production_workspace_scans where connection_id=c.connection_id and generation=c.generation;
    return jsonb_build_object('locations',coalesce((select jsonb_agg(jsonb_build_object('fingerprint',l.location_fingerprint,'label',l.label) order by l.label,l.location_fingerprint)
      from private.square_production_workspace_locations l where l.connection_id=c.connection_id and l.generation=c.generation),'[]'::jsonb),
      'mappedLocation',m.location_fingerprint,'readStatus',coalesce(s.status,'not_requested'),
      'observationCount',case when s.status='committed' then s.observation_count else null end,
      'verifiedAt',case when s.status='committed' then s.verified_at else null end,
      'hasMore',case when s.status='committed' then s.has_more else null end,
      'source','Square Production','historicalCompleteness','unknown','nonEconomic',true);
  elsif p_operation='map' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['connectionId','locationFingerprint','workspaceId']);
    perform 1 from private.square_production_workspace_locations where connection_id=c.connection_id and generation=c.generation
      and location_fingerprint=p_payload->>'locationFingerprint' for share;
    if not found then raise exception 'square_customer_mapping_denied' using errcode='42501'; end if;
    mapping_hash:=private.square_production_customer_fingerprint_v1(array['square-customer-mapping-v1',c.connection_id::text,c.generation::text,p_payload->>'locationFingerprint']);
    insert into private.square_production_workspace_mappings values(c.connection_id,c.generation,p_payload->>'locationFingerprint',mapping_hash,now_at) on conflict do nothing;
    select * into m from private.square_production_workspace_mappings where connection_id=c.connection_id and generation=c.generation for share;
    if m.mapping_fingerprint is distinct from mapping_hash then raise exception 'square_customer_mapping_requires_reconciliation' using errcode='42501'; end if;
    return jsonb_build_object('mapped',true);
  elsif p_operation='start' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['connectionId','scanId','windowEnd','windowStart','workspaceId']);
    start_at:=(p_payload->>'windowStart')::timestamptz; end_at:=(p_payload->>'windowEnd')::timestamptz;
    if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or end_at>now_at
      or end_at<=start_at or end_at-start_at>interval '24 hours' then raise exception 'square_customer_window_denied' using errcode='22023'; end if;
    select * into m from private.square_production_workspace_mappings where connection_id=c.connection_id and generation=c.generation for share;
    if not found then raise exception 'square_customer_mapping_denied' using errcode='42501'; end if;
    insert into private.square_production_workspace_scans(scan_id,connection_id,generation,workspace_id,business_entity_id,actor_id,session_id,
      connection_row_version,mapping_fingerprint,window_start,window_end,status,created_at)
      values((p_payload->>'scanId')::uuid,c.connection_id,c.generation,c.workspace_id,c.business_entity_id,actor_uuid,session_uuid,
        c.row_version,m.mapping_fingerprint,start_at,end_at,'ready',now_at) on conflict(connection_id,generation) do nothing;
    select * into s from private.square_production_workspace_scans where connection_id=c.connection_id and generation=c.generation;
    -- A repeated owner request only reads the existing first-page state; it
    -- cannot change its window, authority subject or cause a second fetch.
    if s.actor_id<>actor_uuid or s.session_id<>session_uuid then raise exception 'square_customer_scan_requires_reconciliation' using errcode='42501'; end if;
    return jsonb_build_object('status',s.status,'nonEconomic',true,'historicalCompleteness','unknown');
  elsif p_operation='claim' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['leaseFingerprint','leaseId']);
    select * into s from private.square_production_workspace_scans where status='ready' order by created_at,scan_id for update skip locked limit 1;
    if not found then return jsonb_build_object('status','idle'); end if;
    c:=private.square_production_workspace_read_context_v1(s.connection_id,s.generation,s.actor_id,s.session_id,s.connection_row_version);
    update private.square_production_workspace_scans set status='leased',lease_id=(p_payload->>'leaseId')::uuid,
      lease_fingerprint=p_payload->>'leaseFingerprint',lease_expires_at=clock_timestamp()+interval '60 seconds' where scan_id=s.scan_id returning * into s;
    return jsonb_build_object('status','leased','scanId',s.scan_id,'connectionId',s.connection_id,'generation',s.generation,
      'workspaceId',s.workspace_id,'businessEntityId',s.business_entity_id,'actorId',s.actor_id,'sessionId',s.session_id,
      'leaseId',s.lease_id,'leaseFingerprint',s.lease_fingerprint,'windowStart',s.window_start,'windowEnd',s.window_end);
  end if;

  perform private.square_production_customer_require_keys_v1(p_payload,case when p_operation='commit'
    then array['commandFingerprint','hasMore','leaseFingerprint','leaseId','observations','responseFingerprint','scanId']
    else array['leaseFingerprint','leaseId','scanId'] end);
  select * into s from private.square_production_workspace_scans where scan_id=(p_payload->>'scanId')::uuid for update;
  if not found or s.lease_id is distinct from (p_payload->>'leaseId')::uuid
    or s.lease_fingerprint is distinct from p_payload->>'leaseFingerprint' then
    raise exception 'square_customer_lease_denied' using errcode='42501'; end if;
  c:=private.square_production_workspace_read_context_v1(s.connection_id,s.generation,s.actor_id,s.session_id,s.connection_row_version);
  select * into m from private.square_production_workspace_mappings where connection_id=s.connection_id and generation=s.generation for share;
  if not found or m.mapping_fingerprint<>s.mapping_fingerprint then raise exception 'square_customer_mapping_denied' using errcode='42501'; end if;
  if p_operation='reconcile' then
    return jsonb_build_object('status',s.status,'nonEconomic',true,'historicalCompleteness','unknown');
  end if;
  if s.status<>'leased' or s.lease_expires_at<=clock_timestamp() then raise exception 'square_customer_lease_denied' using errcode='42501'; end if;
  if p_operation='fail' then
    update private.square_production_workspace_scans set status='uncertain' where scan_id=s.scan_id;
    return jsonb_build_object('status','uncertain');
  elsif p_operation='authorize_page' then
    if s.provider_started_at is null or s.provider_authorized then raise exception 'square_customer_provider_replay_denied' using errcode='42501'; end if;
    update private.square_production_workspace_scans set provider_authorized=true where scan_id=s.scan_id;
    return jsonb_build_object('authorized',true);
  elsif p_operation='credential' then
    if s.provider_started_at is not null then raise exception 'square_customer_provider_replay_denied' using errcode='42501'; end if;
    select * into credential from private.square_production_customer_credentials where connection_id=c.connection_id
      and generation=c.generation and credential_id=c.credential_id and credential_version=c.credential_version for share;
    if not found or credential.access_expires_at<=clock_timestamp() then raise exception 'square_customer_credential_denied' using errcode='42501'; end if;
    update private.square_production_workspace_scans set provider_started_at=clock_timestamp() where scan_id=s.scan_id;
    return jsonb_build_object('credentialId',credential.credential_id,'credentialVersion',credential.credential_version,
      'ciphertextBase64',credential.ciphertext_base64,'aadContext',credential.aad_context,'aadDigest',credential.aad_digest,
      'kmsKeyResource',credential.kms_key_resource,'merchantId',credential.merchant_id,'accessExpiresAt',credential.access_expires_at,
      'providerLocationId',(select provider_location_id from private.square_production_workspace_locations where connection_id=m.connection_id
        and generation=m.generation and location_fingerprint=m.location_fingerprint),'locationFingerprint',m.location_fingerprint,
      'windowStart',s.window_start,'windowEnd',s.window_end,'workspaceId',s.workspace_id,'connectionId',s.connection_id,'generation',s.generation);
  elsif p_operation='commit' then
    if not s.provider_authorized then raise exception 'square_customer_page_denied' using errcode='42501'; end if;
    if jsonb_typeof(p_payload->'observations') is distinct from 'array' or jsonb_array_length(p_payload->'observations')>100
      or jsonb_typeof(p_payload->'hasMore') is distinct from 'boolean'
      or p_payload->>'responseFingerprint' is null or p_payload->>'responseFingerprint' !~ '^sha256:[a-f0-9]{64}$' then
      raise exception 'square_customer_page_denied' using errcode='22023'; end if;
    ordinal_number:=0;
    for observation in select value from jsonb_array_elements(p_payload->'observations') loop
      ordinal_number:=ordinal_number+1;
      perform private.square_production_customer_require_keys_v1(observation,array['observedAt','occurredAt','paymentFingerprint','paymentStatus','sourceFingerprint','versionFingerprint']);
      if exists(select 1 from jsonb_each(observation) where value='null'::jsonb)
        or (observation->>'occurredAt')::timestamptz<s.window_start or (observation->>'occurredAt')::timestamptz>s.window_end
        or (observation->>'observedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then
        raise exception 'square_customer_page_denied' using errcode='42501'; end if;
      if observation->>'sourceFingerprint' is distinct from private.square_production_customer_fingerprint_v1(array[
        'square-customer-observation-v1',s.scan_id::text,observation->>'paymentFingerprint',observation->>'versionFingerprint',
        m.location_fingerprint,observation->>'paymentStatus',observation->>'occurredAt',observation->>'observedAt']) then
        raise exception 'square_customer_page_denied' using errcode='42501'; end if;
      row_hashes:=array_append(row_hashes,observation->>'sourceFingerprint');
      insert into private.square_production_workspace_payment_observations values(s.connection_id,s.generation,s.scan_id,ordinal_number,
        observation->>'paymentFingerprint',observation->>'versionFingerprint',observation->>'paymentStatus',
        (observation->>'occurredAt')::timestamptz,(observation->>'observedAt')::timestamptz,observation->>'sourceFingerprint');
    end loop;
    expected:=private.square_production_customer_fingerprint_v1(array['square-customer-page-v1',s.scan_id::text,s.lease_id::text,
      p_payload->>'responseFingerprint',array_to_string(row_hashes,','),p_payload->>'hasMore']);
    if p_payload->>'commandFingerprint' is distinct from expected then raise exception 'square_customer_page_denied' using errcode='42501'; end if;
    update private.square_production_workspace_scans set status='committed',response_fingerprint=p_payload->>'responseFingerprint',
      command_fingerprint=expected,observation_count=ordinal_number,has_more=(p_payload->>'hasMore')::boolean,verified_at=clock_timestamp()
      where scan_id=s.scan_id;
    return jsonb_build_object('status','committed','observationCount',ordinal_number,'nonEconomic',true,'historicalCompleteness','unknown');
  end if;
  raise exception 'square_customer_read_command_denied' using errcode='42501';
end $function$;
alter function private.square_production_workspace_read_context_v1(uuid,bigint,uuid,uuid,bigint) owner to postgres;
alter function public.square_production_workspace_read_v1(text,jsonb) owner to postgres;
revoke all on function private.square_production_workspace_read_context_v1(uuid,bigint,uuid,uuid,bigint) from public,anon,authenticated,service_role,
 square_production_oauth_authority,square_production_broker_authority,square_production_runtime_authority,square_production_evidence_authority,
 square_production_scheduler_authority,square_production_webhook_authority;
revoke all on function public.square_production_workspace_read_v1(text,jsonb) from public,anon,authenticated,service_role,
 square_production_oauth_authority,square_production_broker_authority,square_production_runtime_authority,square_production_evidence_authority,
 square_production_scheduler_authority,square_production_webhook_authority;
grant execute on function public.square_production_workspace_read_v1(text,jsonb) to authenticated,square_production_broker_authority,square_production_runtime_authority;
commit;
