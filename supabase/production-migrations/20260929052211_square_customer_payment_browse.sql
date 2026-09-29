-- Stored-record browsing only. No provider dispatch, credentials, checkpoint,
-- connection, activation or existing backend function is changed.
begin;
do $baseline$
begin
  if current_user <> 'postgres' or session_user <> 'postgres'
    or current_setting('server_version_num')::integer not between 170000 and 179999
    or (select count(*) from supabase_migrations.schema_migrations) <> 107
    or (select max(version) from supabase_migrations.schema_migrations) <> '20260929041048'
    or (select encode(extensions.digest(convert_to(string_agg(length(version)::text||':'||version,'' order by version),'UTF8'),'sha256'),'hex')
      from supabase_migrations.schema_migrations) <> 'b27e69b524f317bcc02980ac9a4270161233d238a97e8e960e84138532f5a53c'
    then raise exception 'square_customer_browse_requires_107_baseline' using errcode='55000'; end if;
end $baseline$;

create index square_customer_payment_browse_created
  on square_customer_private.payments(workspace_id,connection_id,created_at desc,payment_id);

create function public.square_customer_payments_v1(
  p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_connection_id uuid default null,
  p_page integer default 1,p_start_date text default null,p_end_date text default null,p_status text default 'all'
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare cid uuid; current_id uuid; zone text; zone_fallback boolean; starts date; ends date; starts_at timestamptz; ends_at timestamptz;
declare records bigint; pages bigint; selected_page integer; result_payments jsonb; options jsonb; current_connection jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null or p_session_id is null or p_workspace_id is null then
    raise exception 'square_customer_browse_denied' using errcode='42501'; end if;
  -- Same owner/session/workspace authority as status. Browsing saved records
  -- does not require an active subscription, activation gate or provider key.
  perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id);
  if p_page is null or p_page<1 or p_status is null
    or p_status not in ('all','APPROVED','PENDING','COMPLETED','CANCELED','FAILED','UNKNOWN') then
    raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;
  if p_start_date is not null then
    if p_start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;
    begin starts:=p_start_date::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end;
    if not isfinite(starts) or starts<date '1970-01-01' then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;
  end if;
  if p_end_date is not null then
    if p_end_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;
    begin ends:=p_end_date::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end;
    if not isfinite(ends) or ends<date '1970-01-01' then
      raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;
  end if;
  if starts>ends then raise exception 'square_customer_browse_filter_denied' using errcode='22023'; end if;

  select c.connection_id into current_id from square_customer_private.connections c
    where c.workspace_id=p_workspace_id and (c.state<>'disconnected' or c.revocation_pending
      or (c.authorization_uncertain and c.ciphertext is null))
    order by c.created_at desc,c.connection_id limit 1;
  if p_connection_id is null then
    select c.connection_id into cid from square_customer_private.connections c
      where c.workspace_id=p_workspace_id
      order by (c.connection_id=current_id) desc nulls last,c.created_at desc,c.connection_id limit 1;
  else
    select c.connection_id into cid from square_customer_private.connections c
      where c.workspace_id=p_workspace_id and c.connection_id=p_connection_id;
    if not found then raise exception 'square_customer_browse_connection_denied' using errcode='42501'; end if;
  end if;
  select e.timezone into zone from square_customer_private.connections c
    join public.business_entities e on e.workspace_id=c.workspace_id and e.id=c.business_entity_id
    where c.workspace_id=p_workspace_id and c.connection_id=cid;
  -- Existing business-entity validation accepts zone-shaped names that may not
  -- exist in PostgreSQL. Keep saved records browsable without editing the entity,
  -- and explicitly tell the UI when dates/filters use UTC instead.
  zone_fallback:=cid is not null and not exists(select from pg_catalog.pg_timezone_names where name=zone);
  zone:=case when zone_fallback then 'UTC' else coalesce(zone,'UTC') end;
  starts_at:=starts::timestamp at time zone zone;
  -- End is the next local midnight, not +24h; preserves 23/25-hour DST days.
  ends_at:=(ends+1)::timestamp at time zone zone;

  select count(*) into records from square_customer_private.payments p
    where p.workspace_id=p_workspace_id and p.connection_id=cid
      and (starts_at is null or p.created_at>=starts_at) and (ends_at is null or p.created_at<ends_at)
      and (p_status='all' or p.status=p_status);
  pages:=greatest(1,(records+24)/25);
  selected_page:=least(p_page,pages)::integer;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.payment_id,'locationId',p.location_id,
    'status',p.status,'createdAt',p.created_at,'updatedAt',p.updated_at,'amountMinor',p.amount_minor::text,'currency',p.currency)
    order by p.created_at desc,p.payment_id),'[]'::jsonb) into result_payments
    from (select * from square_customer_private.payments p
      where p.workspace_id=p_workspace_id and p.connection_id=cid
        and (starts_at is null or p.created_at>=starts_at) and (ends_at is null or p.created_at<ends_at)
        and (p_status='all' or p.status=p_status)
      order by p.created_at desc,p.payment_id limit 25 offset (selected_page::bigint-1)*25) p;

  -- Use the existing status projection for the one actionable connection even
  -- when newer historical attempts would push it beyond status's old 32 limit.
  -- Never include credentials; saved-payment rows belong only to the page above.
  select jsonb_build_object('connectionId',c.connection_id,'businessEntityId',c.business_entity_id,
    'state',case when c.state='syncing' and c.lease_expires_at<=clock_timestamp() then 'retry_required'
      when c.state='exchanging' and c.lease_expires_at<=clock_timestamp() then 'reauthorization_required' else c.state end,
    'sellerLabel',c.seller_label,'locations',c.locations,'locationId',c.location_id,
    'lastSyncedAt',c.last_synced_at,'lastError',c.last_error,'hasMore',c.cursor is not null,
    'revocationPending',c.revocation_pending,'recoveryRequired',c.authorization_uncertain and c.ciphertext is null,
    'checkpointAt',c.checkpoint_at,
    'activeRead',case when c.window_start is null then null else jsonb_build_object('start',c.window_start,'end',c.window_end,'kind',c.read_kind) end,
    'lastCompletedRead',case when c.last_read_completed_at is null then null else jsonb_build_object('start',c.last_read_start,'end',c.last_read_end,
      'kind',c.last_read_kind,'completedAt',c.last_read_completed_at) end,'payments','[]'::jsonb)
    into current_connection from square_customer_private.connections c
    where c.workspace_id=p_workspace_id and c.connection_id=current_id;

  -- All historical connections are lightweight options, never truncated to the
  -- status RPC's 32 connections or its embedded 100-payment compatibility page.
  select coalesce(jsonb_agg(jsonb_build_object('connectionId',c.connection_id,'businessEntityId',c.business_entity_id,
    'businessEntityLabel',e.display_name,'sellerLabel',c.seller_label,'locationLabel',
      (select l->>'label' from jsonb_array_elements(c.locations) l where l->>'id'=c.location_id limit 1),
    'state',case when c.state='syncing' and c.lease_expires_at<=clock_timestamp() then 'retry_required'
      when c.state='exchanging' and c.lease_expires_at<=clock_timestamp() then 'reauthorization_required' else c.state end,
    'timeZone',coalesce(z.name,'UTC'),'timeZoneFallback',z.name is null,'createdAt',c.created_at,
    'paymentCount',(select count(*) from square_customer_private.payments p where p.workspace_id=p_workspace_id and p.connection_id=c.connection_id))
    order by (c.state<>'disconnected') desc,c.created_at desc,c.connection_id),'[]'::jsonb) into options
    from square_customer_private.connections c
    join public.business_entities e on e.workspace_id=c.workspace_id and e.id=c.business_entity_id
    left join pg_catalog.pg_timezone_names z on z.name=e.timezone
    where c.workspace_id=p_workspace_id;
  return jsonb_build_object('connectionId',cid,'timeZone',zone,'timeZoneFallback',zone_fallback,'currentConnection',current_connection,'page',selected_page,'pageSize',25,
    'totalCount',records,'totalPages',pages,'filters',jsonb_build_object('startDate',p_start_date,'endDate',p_end_date,'status',p_status),
    'payments',result_payments,'connections',options);
end
$function$;
alter function public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text) owner to postgres;
revoke all on function public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text) to service_role;
commit;
