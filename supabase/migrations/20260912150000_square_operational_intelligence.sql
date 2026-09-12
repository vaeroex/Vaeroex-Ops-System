-- Sanitized operational projection over the already authority-checked card.
-- No application role receives schema or table privileges.
begin;
create function private.square_workspace_operational_v1(p_workspace_name text,p_kind text,p_status text,p_location text,p_from text,p_to text,p_sort text,p_page integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public
set statement_timeout='5s' set lock_timeout='2s' set timezone='UTC' as $$
declare card jsonb; actor uuid; w public.workspaces; ac private.square_account_connections;
  r private.square_interpretation_runs; op jsonb; rows jsonb; total integer; page_size integer:=25; partition text;
begin
  if p_page not between 1 and 40 or (p_kind is not null and p_kind not in ('payment','refund','order','catalog','inventory'))
    or (p_status is not null and (length(p_status) not between 1 and 80 or p_status!~'^[A-Za-z0-9_-]+$'))
    or (p_location is not null and p_location not in ('mapped_location','seller_scoped','explicitly_unresolved'))
    or (p_from is not null and p_from!~'^\d{4}-\d{2}-\d{2}$') or (p_to is not null and p_to!~'^\d{4}-\d{2}-\d{2}$')
    or (p_from is not null and p_to is not null and p_from>p_to) or p_sort not in ('newest','oldest') then return null; end if;
  -- This performs and locks the complete session, membership, subscription,
  -- entity, generation, mapping, source-version and retention authority chain.
  card:=private.square_workspace_card_v1(p_workspace_name);
  if card is null then return null; end if;
  actor:=auth.uid();
  select ws.* into strict w from public.workspaces ws join public.workspace_members m on m.workspace_id=ws.id
    where ws.name=p_workspace_name and m.user_id=actor and m.status='active' for share of ws,m;
  select * into strict ac from private.square_account_connections where workspace_id=w.id and environment='sandbox'
    and application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw' for share;
  select private.square_page_hash_v1(jsonb_agg(resource_key order by resource_key)) into partition from
    (select distinct resource_key from private.square_observation_admissions where workspace_id=w.id
      and business_entity_id=ac.business_entity_id and connection_id=ac.connection_id and generation=ac.generation) resources;
  select * into r from private.square_interpretation_runs where workspace_id=w.id and business_entity_id=ac.business_entity_id
    and connection_id=ac.connection_id and generation=ac.generation and partition_fingerprint=partition
    and revision=(card->>'checkpointRevision')::bigint limit 1 for share;
  op:=r.output->'operational';
  if op is null or op->>'policyVersion' is distinct from 'square_operational_intelligence_v1'
    or op->>'economic' is distinct from 'blocked' or op->>'historical' is distinct from 'unknown'
    or op->>'aiDispatch' is distinct from 'disabled' or jsonb_typeof(op->'activity') is distinct from 'array'
    or jsonb_array_length(op->'activity')>1000 then return null; end if;
  select count(*)::integer into total from jsonb_array_elements(op->'activity') value
    where (p_kind is null or value->>'kind'=p_kind) and (p_status is null or value->>'status'=p_status)
      and (p_location is null or value->>'location'=p_location)
      and (p_from is null or (value->>'occurredAt')::timestamptz >= (p_from||'T00:00:00Z')::timestamptz)
      and (p_to is null or (value->>'occurredAt')::timestamptz < (p_to||'T00:00:00Z')::timestamptz+interval '1 day');
  select coalesce(jsonb_agg(value order by
    case when p_sort='newest' then (value->>'occurredAt')::timestamptz end desc nulls last,
    case when p_sort='oldest' then (value->>'occurredAt')::timestamptz end asc nulls last,
    case when p_sort='newest' then value->>'occurredAt' end desc nulls last,
    case when p_sort='oldest' then value->>'occurredAt' end asc nulls last,value->>'evidenceRef'),'[]'::jsonb) into rows from
    (select value from jsonb_array_elements(op->'activity') value
      where (p_kind is null or value->>'kind'=p_kind) and (p_status is null or value->>'status'=p_status)
        and (p_location is null or value->>'location'=p_location)
        and (p_from is null or (value->>'occurredAt')::timestamptz >= (p_from||'T00:00:00Z')::timestamptz)
        and (p_to is null or (value->>'occurredAt')::timestamptz < (p_to||'T00:00:00Z')::timestamptz+interval '1 day')
      order by case when p_sort='newest' then (value->>'occurredAt')::timestamptz end desc nulls last,
        case when p_sort='oldest' then (value->>'occurredAt')::timestamptz end asc nulls last,
        case when p_sort='newest' then value->>'occurredAt' end desc nulls last,
        case when p_sort='oldest' then value->>'occurredAt' end asc nulls last,value->>'evidenceRef' offset (p_page-1)*page_size limit page_size) page_rows;
  return jsonb_build_object('version','square_workspace_operational_v1','evidence',card,'calculation',jsonb_build_object(
    'policyVersion',op->'policyVersion','economic',op->'economic','historical',op->'historical','aiDispatch',op->'aiDispatch',
    'payment',op->'payment','refund',op->'refund','order',op->'order','groups',op->'groups','refundRate',op->'refundRate','statusMix',op->'statusMix','orderStatusMix',op->'orderStatusMix','kpiEvidence',op->'kpiEvidence',
    'catalog',op->'catalog','inventory',op->'inventory','fulfillment',op->'fulfillment','insights',op->'insights'),
    'page',jsonb_build_object('rows',rows,'page',p_page,'pageSize',page_size,'total',total,'pages',greatest(1,ceil(total::numeric/page_size)::integer)));
exception when others then return null;
end $$;
revoke all on function private.square_workspace_operational_v1(text,text,text,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function private.square_workspace_operational_v1(text,text,text,text,text,text,text,integer) to authenticated;
create function public.read_square_workspace_operational_v1(p_workspace_name text,p_kind text default null,p_status text default null,p_location text default null,p_from text default null,p_to text default null,p_sort text default 'newest',p_page integer default 1)
returns jsonb language sql security invoker set search_path=''
begin atomic; select private.square_workspace_operational_v1(p_workspace_name,p_kind,p_status,p_location,p_from,p_to,p_sort,p_page); end;
revoke all on function public.read_square_workspace_operational_v1(text,text,text,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_square_workspace_operational_v1(text,text,text,text,text,text,text,integer) to authenticated;
commit;
