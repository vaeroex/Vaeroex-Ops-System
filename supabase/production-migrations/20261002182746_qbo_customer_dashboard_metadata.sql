-- Saved customer metadata only; no provider calls, scheduling or state changes.
-- Ongoing cadence remains defined by schedule_qbo_production_streams_v1 in 020:
-- CDC 15 minutes, reports 1 hour, reference streams 6 hours.
begin;

create function public.read_qbo_dashboard_metadata_v1(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare actor uuid; session_id uuid; connections jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' or p_workspace_id is null then
    raise exception 'qbo_customer_dashboard_read_denied' using errcode='42501';
  end if;
  begin
    actor := auth.uid();
    session_id := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'qbo_customer_dashboard_read_denied' using errcode='42501';
  end;
  -- Same live owner/session boundary as the saved customer browse projection;
  -- validate even an empty workspace, without taking write locks or entitlement.
  if actor is null or session_id is null or not exists (
    select from auth.sessions s join auth.users u on u.id=s.user_id
    join public.workspace_members m on m.user_id=u.id and m.workspace_id=p_workspace_id
    join public.workspaces w on w.id=m.workspace_id
    where s.id=session_id and s.user_id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and (s.not_after is null or s.not_after>statement_timestamp())
      and m.role='owner' and m.status='active'
  ) then raise exception 'qbo_customer_dashboard_read_denied' using errcode='42501'; end if;

  with established as materialized (
    select c.*,e.status as entity_status
    from private.integration_connections c
    join public.business_entities e on e.id=c.business_entity_id and e.workspace_id=c.workspace_id
    where c.workspace_id=p_workspace_id and c.provider_key='quickbooks_online'
      and c.provider_environment='production'
      and c.status not in ('pending_authorization','deleting','deleted')
      and c.authorized_at is not null and isfinite(c.authorized_at)
      and c.authorized_at<=statement_timestamp()
      and c.granted_scopes @> array['com.intuit.quickbooks.accounting']::text[]
    order by c.created_at desc,c.id limit 101
  ), projected as (
    select c.id,c.created_at,jsonb_build_object(
      'connectionId',c.id,
      'logicalIdentityKey',encode(extensions.digest(convert_to(
        jsonb_build_array(c.workspace_id,c.business_entity_id,c.provider_key,c.provider_environment,
          case when c.provider_tenant_reference_fingerprint is not null
            then 'realm:'||encode(c.provider_tenant_reference_fingerprint,'hex')
            else 'connection:'||c.id::text end)::text,'UTF8'),'sha256'),'hex'),
      'lastSuccessfulRefreshAt',case when coverage.complete then
        to_char(coverage.last_success at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end,
      'currentUntil',case when coverage.complete then
        to_char(coverage.current_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end,
      'freshness',case
        when c.status not in ('active','degraded') or c.entity_status<>'active' then 'unknown'
        when coverage.complete and coverage.all_current and coverage.current_until>=statement_timestamp() then 'current'
        when coverage.complete and coverage.current_until<statement_timestamp() then 'stale'
        else 'unknown' end
    ) as payload
    from established c
    cross join lateral (
      select count(*)>0 and bool_and(coalesce(f.id is not null and isfinite(f.last_successful_sync_at)
          and isfinite(f.calculated_at) and f.last_successful_sync_at<=f.calculated_at
          and f.calculated_at<=statement_timestamp() and f.current_max_age_seconds between 60 and 86400,false)) as complete,
        bool_and(coalesce(f.status='current' and f.blocking_level='none',false)) as all_current,
        min(f.last_successful_sync_at) as last_success,
        min(case when isfinite(f.last_successful_sync_at) and f.current_max_age_seconds between 60 and 86400
          then f.last_successful_sync_at+make_interval(secs=>f.current_max_age_seconds::double precision) end) as current_until
      -- This is the production activation gate's exact required stream/domain
      -- mapping. Domain-only presence would incorrectly cover missing streams.
      from jsonb_array_elements_text(c.capability_snapshot->'requiredStreamKeys') required(stream_key)
      left join private.provider_entity_mappings m
        on m.workspace_id=c.workspace_id and m.business_entity_id=c.business_entity_id and m.connection_id=c.id
        and m.provider_key=c.provider_key and m.provider_environment=c.provider_environment
        and m.provider_entity_type='company' and m.status='active'
        and m.verification_mode='qbo_realm_mapping_v1' and m.verification_fingerprint is not null
        and m.verified_at is not null and isfinite(m.verified_at) and m.verified_at<=statement_timestamp()
        and m.provider_entity_reference_fingerprint=c.provider_tenant_reference_fingerprint
      left join private.integration_freshness_states f
        on f.workspace_id=c.workspace_id and f.business_entity_id=c.business_entity_id and f.connection_id=c.id
        and f.mapping_id=m.id and f.provider_key=c.provider_key
        and f.domain=private.integration_stream_freshness_domain_v1(c.provider_key,required.stream_key)
        and f.scope_key=required.stream_key
      -- Connection IDs have immutable generations; joining c.id and the active
      -- mapping ID excludes prior generations and replaced mapping freshness.
    ) coverage
  )
  select coalesce(jsonb_agg(payload order by created_at desc,id),'[]'::jsonb) into connections from projected;
  if jsonb_array_length(connections)>100 then
    raise exception 'qbo_customer_dashboard_connection_limit' using errcode='54000';
  end if;
  -- No no-change claim: neither task counts nor record counts prove that outcome.
  return connections;
end;
$function$;
alter function public.read_qbo_dashboard_metadata_v1(uuid) owner to postgres;
revoke all on function public.read_qbo_dashboard_metadata_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_qbo_dashboard_metadata_v1(uuid) to authenticated;

commit;
