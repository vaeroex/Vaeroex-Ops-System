-- Forward-only customer attempt control. Apply after QBO customer OAuth completion
-- on either the canonical or Production baseline. No customer data is rewritten.
begin;

create function private.qbo_pending_name_v1(p_name text) returns text
language sql immutable strict set search_path = '' as $function$
  select lower(btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g')));
$function$;

create function private.qbo_pending_intent_lock_v1(
  p_workspace uuid, p_entity uuid, p_name text, p_scopes text[]
) returns void language sql volatile set search_path = '' as $function$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    jsonb_build_array('qbo_pending_intent_v1',p_workspace,p_entity,'quickbooks_online','production',
      private.qbo_pending_name_v1(p_name),p_scopes)::text,0));
$function$;

create index integration_qbo_pending_intent_lookup_v1 on private.integration_connections
  (workspace_id,business_entity_id,private.qbo_pending_name_v1(safe_display_name))
  where provider_key='quickbooks_online' and provider_environment='production'
    and status in ('pending_authorization','error') and authorized_at is null;

-- The insert guard also covers callers of the original canonical intent RPC.
-- A nonunique lookup preserves historical duplicates for explicit owner handling.
create function private.qbo_pending_intent_guard_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.provider_key<>'quickbooks_online' or new.provider_environment<>'production'
    or new.status<>'pending_authorization' then return new; end if;
  perform private.qbo_pending_intent_lock_v1(new.workspace_id,new.business_entity_id,
    new.safe_display_name,new.requested_scopes);
  if exists(select 1 from private.integration_connections n
    where n.workspace_id=new.workspace_id and n.business_entity_id=new.business_entity_id
      and n.provider_key=new.provider_key and n.provider_environment=new.provider_environment
      and private.qbo_pending_name_v1(n.safe_display_name)=private.qbo_pending_name_v1(new.safe_display_name)
      and n.requested_scopes=new.requested_scopes
      and n.status in ('pending_authorization','error') and n.authorized_at is null) then
    raise exception 'qbo_customer_pending_intent_exists' using errcode='23505';
  end if;
  return new;
end;
$function$;
create trigger qbo_pending_intent_guard_v1 before insert on private.integration_connections
  for each row execute function private.qbo_pending_intent_guard_v1();

create function public.begin_qbo_customer_connection_v1(
  p_connection jsonb, p_oauth_state jsonb, p_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare n private.integration_connections; c jsonb; s jsonb;
begin
  if auth.uid() is null then raise exception 'qbo_customer_owner_denied' using errcode='42501'; end if;
  if p_connection->>'providerKey' is distinct from 'quickbooks_online'
    or p_connection->>'providerEnvironment' is distinct from 'production'
    or p_connection->'requestedScopes' is distinct from '["com.intuit.quickbooks.accounting"]'::jsonb
    or p_oauth_state->>'connectionId' is distinct from p_connection->>'id'
    or not private.is_bounded_identifier_v1(p_request_id) then
    raise exception 'qbo_customer_pending_payload_invalid' using errcode='22023';
  end if;
  perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,
    (p_connection->>'workspaceId')::uuid,(p_connection->>'businessEntityId')::uuid);
  perform private.qbo_pending_intent_lock_v1((p_connection->>'workspaceId')::uuid,
    (p_connection->>'businessEntityId')::uuid,p_connection->>'safeDisplayName',
    array['com.intuit.quickbooks.accounting']);
  select * into n from private.integration_connections c
    where c.workspace_id=(p_connection->>'workspaceId')::uuid
      and c.business_entity_id=(p_connection->>'businessEntityId')::uuid
      and c.provider_key='quickbooks_online' and c.provider_environment='production'
      and private.qbo_pending_name_v1(c.safe_display_name)=private.qbo_pending_name_v1(p_connection->>'safeDisplayName')
      and c.requested_scopes=array['com.intuit.quickbooks.accounting']::text[]
      and c.status in ('pending_authorization','error') and c.authorized_at is null
    order by c.created_at,c.id limit 1 for update;
  if found then
    -- Canonical validation still checks descriptors and scope on a duplicate.
    c:=public.create_integration_connection_intent_v1(p_connection||jsonb_build_object(
      'id',n.id,'safeDisplayName',n.safe_display_name));
    return jsonb_build_object('connection',c->'connection','oauthState',null,
      'disposition','pending','idempotent',true);
  end if;
  c:=public.create_integration_connection_intent_v1(p_connection);
  s:=public.create_qbo_customer_oauth_state_v2(p_oauth_state,p_request_id);
  return jsonb_build_object('connection',c->'connection','oauthState',s,
    'disposition','started','idempotent',c->'idempotent');
end;
$function$;

-- Only the missing never-consented terminal edge is added. Existing row mutation
-- guards continue to enforce identity, generation, row_version and history.
create or replace function private.is_integration_connection_transition_v1(p_from text,p_to text)
returns boolean language sql immutable strict set search_path = '' as $function$
  select p_from=p_to
    or (p_from='pending_authorization' and p_to=any(array['authorized_unmapped','error','deleting','disconnected']::text[]))
    or (p_from='authorized_unmapped' and p_to=any(array['initializing','reauthorization_required','disconnecting','deleting']::text[]))
    or (p_from='initializing' and p_to=any(array['active','degraded','error','reauthorization_required','disconnecting','deleting']::text[]))
    or (p_from='active' and p_to=any(array['degraded','reauthorization_required','disconnecting','deleting']::text[]))
    or (p_from='degraded' and p_to=any(array['active','error','reauthorization_required','disconnecting','deleting']::text[]))
    or (p_from='error' and p_to=any(array['pending_authorization','initializing','disconnected','deleting']::text[]))
    or (p_from='reauthorization_required' and p_to=any(array['pending_authorization','disconnecting','deleting']::text[]))
    or (p_from='disconnecting' and p_to=any(array['disconnected','deleting']::text[]))
    or (p_from='disconnected' and p_to=any(array['pending_authorization','deleting']::text[]))
    or (p_from='deleting' and p_to='deleted');
$function$;

-- This shared predicate is evaluated under the connection/state locks below.
create function private.qbo_pending_is_unconsented_v1(n private.integration_connections)
returns boolean language sql stable set search_path = '' as $function$
  select n.status in ('pending_authorization','error') and n.authorized_at is null
    and n.provider_tenant_reference_fingerprint is null and cardinality(n.granted_scopes)=0
    and not exists(select 1 from private.integration_credentials where connection_id=n.id)
    and not exists(select 1 from private.provider_entity_mappings where connection_id=n.id)
    and not exists(select 1 from private.integration_oauth_states where connection_id=n.id and (status='consumed' or consumed_at is not null))
    and not exists(select 1 from private.integration_reauthorization_states where connection_id=n.id)
    and not exists(select 1 from private.integration_qbo_customer_authorizations where connection_id=n.id
      and (outcome not in ('pending','denied') or realm_fingerprint is not null))
    and not exists(select 1 from private.integration_qbo_customer_disconnect_work where connection_id=n.id)
    and not exists(select 1 from private.integration_sync_runs where connection_id=n.id)
    and not exists(select 1 from private.integration_sync_tasks where connection_id=n.id)
    and not exists(select 1 from private.external_source_records where connection_id=n.id);
$function$;

-- The generic lifecycle predicate cannot express provider/consent authority.
-- Fence its single added edge at the row boundary, including native RPC callers.
create function private.qbo_pending_cancellation_guard_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if old.status<>'pending_authorization' or new.status<>'disconnected' then return new; end if;
  if old.provider_key<>'quickbooks_online' or old.provider_environment<>'production'
    or auth.uid() is null or not private.qbo_pending_is_unconsented_v1(old)
    or not exists(select 1 from private.integration_audit_events a
      where a.workspace_id=old.workspace_id and a.business_entity_id=old.business_entity_id
        and a.connection_id=old.id and a.action='integration_connection.pending_cancel'
        and a.outcome='succeeded' and a.actor_type='user' and a.actor_id=auth.uid()::text
        and a.request_id=new.last_transition_request_id and a.occurred_at=new.status_changed_at
        and a.metadata->>'row_version'=new.row_version::text
        and a.metadata->>'connection_generation'=old.connection_generation::text
        and a.metadata->>'connection_status'='disconnected') then
    raise exception 'qbo_customer_pending_cancel_denied' using errcode='42501';
  end if;
  perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,
    old.workspace_id,old.business_entity_id,false);
  return new;
end;
$function$;
create trigger qbo_pending_cancellation_guard_v1 before update on private.integration_connections
  for each row execute function private.qbo_pending_cancellation_guard_v1();

create function public.cancel_qbo_customer_pending_connection_v1(
  p_workspace_id uuid,p_connection_id uuid,p_expected_row_version bigint,p_request_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare n private.integration_connections; v_now timestamptz; v_fingerprint bytea;
begin
  if auth.uid() is null then raise exception 'qbo_customer_owner_denied' using errcode='42501'; end if;
  if p_workspace_id is null or p_connection_id is null or p_expected_row_version is null
    or p_expected_row_version<1 or not private.is_bounded_identifier_v1(p_request_id) then
    raise exception 'qbo_customer_pending_payload_invalid' using errcode='22023';
  end if;
  select * into n from private.integration_connections where workspace_id=p_workspace_id
    and id=p_connection_id and provider_key='quickbooks_online' and provider_environment='production' for update;
  if not found then raise exception 'qbo_customer_pending_cancel_denied' using errcode='42501'; end if;
  perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,
    n.workspace_id,n.business_entity_id,false);
  if n.status='disconnected' and exists(select 1 from private.integration_audit_events a
    where a.workspace_id=n.workspace_id and a.connection_id=n.id
      and a.action='integration_connection.pending_cancel' and a.outcome='succeeded') then
    return jsonb_build_object('connection',private.integration_connection_summary_json_v1(n),'idempotent',true);
  end if;
  if n.row_version<>p_expected_row_version then
    raise exception 'integration_connection_row_version_stale' using errcode='40001';
  end if;
  -- Ingress locks state before connection. NOWAIT fails closed if it has begun;
  -- holding the connection prevents any new state or provider claim from racing.
  perform 1 from private.integration_oauth_states where connection_id=n.id order by id for update nowait;
  perform 1 from private.integration_reauthorization_states where connection_id=n.id order by id for update nowait;
  perform 1 from private.integration_qbo_customer_authorizations where connection_id=n.id order by state_id for update nowait;
  if not private.qbo_pending_is_unconsented_v1(n) then
    raise exception 'qbo_customer_pending_cancel_denied' using errcode='42501';
  end if;
  v_now:=greatest(clock_timestamp(),n.updated_at+interval '1 microsecond');
  v_fingerprint:=private.phase_4_request_fingerprint_v1(p_request_id,jsonb_build_object(
    'workspaceId',p_workspace_id,'connectionId',p_connection_id,'expectedRowVersion',p_expected_row_version,
    'targetStatus','disconnected','operation','pending_cancel'));
  update private.integration_oauth_states set status='expired',row_version=row_version+1
    where connection_id=n.id and status='pending';
  update private.integration_qbo_customer_authorizations set outcome='denied',updated_at=v_now
    where connection_id=n.id and outcome='pending';
  perform private.phase_5_insert_audit_v1(n.workspace_id,n.business_entity_id,n.id,
    'user',auth.uid()::text,'integration_connection.pending_cancel','succeeded','integration_connection',n.id::text,
    p_request_id,'customer_disconnect_requested',jsonb_build_object('connection_generation',n.connection_generation,
      'connection_status','disconnected','row_version',n.row_version+1,'oauth_state_status','expired','idempotent',false),v_now);
  -- Credential destruction cannot be invoked for an attempt with no credential.
  -- Use its canonical terminal fields and the existing guarded mutation/audit path.
  update private.integration_connections set status='disconnected',state_reason_code='disconnected',
    status_changed_at=v_now,disconnected_at=v_now,last_transition_request_id=p_request_id,
    last_transition_request_fingerprint=v_fingerprint,row_version=row_version+1,updated_at=v_now
    where id=n.id and workspace_id=n.workspace_id and row_version=p_expected_row_version returning * into n;
  return jsonb_build_object('connection',private.integration_connection_summary_json_v1(n),'idempotent',false);
end;
$function$;

revoke all on function private.qbo_pending_name_v1(text),
  private.qbo_pending_intent_lock_v1(uuid,uuid,text,text[]),private.qbo_pending_intent_guard_v1(),
  private.qbo_pending_is_unconsented_v1(private.integration_connections),private.qbo_pending_cancellation_guard_v1(),
  public.begin_qbo_customer_connection_v1(jsonb,jsonb,text),
  public.cancel_qbo_customer_pending_connection_v1(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_qbo_customer_connection_v1(jsonb,jsonb,text),
  public.cancel_qbo_customer_pending_connection_v1(uuid,uuid,bigint,text) to authenticated;
commit;
