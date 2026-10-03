-- Paginated, owner-authorized read-only access to minimized stored QBO sources.
-- No history replay, provider access, credential access, data backfill or gate change.
begin;

do $dependencies$
declare relation_name text; relation_id regclass;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'qbo_customer_browse_requires_postgres' using errcode='55000';
  end if;
  -- FORCE RLS remains in place. The definer bypass makes the explicit tenant,
  -- owner/session and entity checks below mandatory, not an RLS substitute.
  foreach relation_name in array array['public.business_entities','private.integration_connections',
    'private.provider_entity_mappings','private.external_source_records','private.external_source_record_versions'] loop
    relation_id := pg_catalog.to_regclass(relation_name);
    if relation_id is null or not exists (select from pg_catalog.pg_class
      where oid=relation_id and relrowsecurity and relforcerowsecurity) then
      raise exception 'qbo_customer_browse_requires_forced_rls' using errcode='55000';
    end if;
  end loop;
end $dependencies$;

-- Allowlist an already-minimized projection. Never return the provider object,
-- realm, metadata, sync token, relationships, native cell IDs or arbitrary keys.
create function private.qbo_customer_preview_v1(p jsonb, record_type text, record_id text)
returns jsonb language plpgsql immutable security invoker set search_path=''
as $function$
declare columns_json jsonb; rows_json jsonb; truncated boolean; malformed boolean; amount_json jsonb;
begin
  if p is null or p='null'::jsonb then return jsonb_build_object('state','missing'); end if;
  if pg_catalog.octet_length(p::text)>131072 then return jsonb_build_object('state','oversized'); end if;
  if p#>>'{provider,providerKey}' is distinct from 'quickbooks_online'
    or p#>>'{provider,sourceEnvironment}' is distinct from 'production' then
    return jsonb_build_object('state','unsupported'); end if;
  if p->>'contractVersion'='qbo_source_record_minimized_v1' and p->>'recordType'=record_type
    and p->>'minimizationVersion'='qbo_minimizer_v1'
    and p->>'id'=record_id
    and record_type=any(array['Invoice','Payment','CreditMemo','SalesReceipt','RefundReceipt','Bill',
      'BillPayment','VendorCredit','Purchase','Deposit','Transfer','JournalEntry']) then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('amount',p#>>array['amounts',k,'amount'],
      'currency',p#>>array['amounts',k,'currency'])),'{}'::jsonb) into amount_json
      from unnest(array['total','balance']) k where p->'amounts' ? k;
    return jsonb_build_object('state','available','value',jsonb_build_object('kind','record','status',p->>'status',
      'temporal',jsonb_build_object('postingDate',p#>>'{temporal,postingDate}',
        'providerCreatedAt',p#>>'{temporal,providerCreatedAt}','providerUpdatedAt',p#>>'{temporal,providerUpdatedAt}'),
      'accounting',jsonb_build_object('basis',p#>>'{accounting,basis}','sourceCurrency',p#>>'{accounting,sourceCurrency}'),
      'amounts',amount_json));
  end if;
  if p->>'contractVersion' is distinct from 'qbo_report_control_observation_v1'
    or p->>'reportType' is distinct from record_type
    or record_type<>all(array['ProfitAndLoss','BalanceSheet','CashFlow','ARAgingSummary','APAgingSummary','TrialBalance'])
    or p->'additive' is distinct from 'false'::jsonb
    or p->>'contributionFamily' is distinct from 'control_observation'
    or p->>'parserVersion' is distinct from 'qbo_report_parser_v1'
    -- Exact existing qboReportProviderRecordId identity, not economic matching.
    or record_id is distinct from concat_ws(':',p->>'reportType',p->>'reportBasis',coalesce(p->>'periodStart','open'),
      coalesce(p->>'periodEnd','open'),coalesce(p->>'sourceCurrency','currency_unspecified'))
    or jsonb_typeof(p->'columns') is distinct from 'array' or jsonb_typeof(p->'rows') is distinct from 'array' then
    return jsonb_build_object('state','unsupported'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('columnKey',c->>'columnKey','title',c->>'title') order by n),'[]'::jsonb)
    into columns_json from jsonb_array_elements(p->'columns') with ordinality as cols(c,n) where n<=16;
  with recursive tree as (
    select r, array[n] as path, 0 as depth from jsonb_array_elements(p->'rows') with ordinality as roots(r,n)
    union all
    select child.r,t.path||child.n,t.depth+1 from tree t
      cross join lateral jsonb_array_elements(case when jsonb_typeof(t.r->'children')='array'
        then t.r->'children' else '[]'::jsonb end) with ordinality as child(r,n) where t.depth<12
  ), limited as (select * from tree order by path limit 200)
  select coalesce((select jsonb_agg(jsonb_build_object('depth',t.depth,'rowType',t.r->>'rowType',
    'cells',coalesce((select jsonb_agg(jsonb_build_object('columnKey',c->>'columnKey','value',c->>'value') order by n)
      from jsonb_array_elements(case when jsonb_typeof(t.r->'cells')='array' then t.r->'cells' else '[]'::jsonb end)
        with ordinality as cells(c,n)
      where n<=16 and exists(select from jsonb_array_elements(columns_json) col where col->>'columnKey'=c->>'columnKey')),'[]'::jsonb))
    order by t.path) from limited t),'[]'::jsonb),
    jsonb_array_length(p->'columns')>16 or (select count(*) from tree)>200
      or exists(select from tree where depth=12 and case when jsonb_typeof(r->'children')='array' then jsonb_array_length(r->'children') else 0 end>0)
      or exists(select from tree where case when jsonb_typeof(r->'cells')='array' then jsonb_array_length(r->'cells') else 0 end>16),
    exists(select from tree where jsonb_typeof(r->'children') is distinct from 'array'
      or jsonb_typeof(r->'cells') is distinct from 'array' or not coalesce(r->>'rowType' in ('data','section','summary'),false))
    into rows_json,truncated,malformed;
  if malformed then return jsonb_build_object('state','unsupported'); end if;
  return jsonb_build_object('state','available','value',jsonb_build_object('kind','report',
    'reportType',p->>'reportType','reportBasis',p->>'reportBasis','sourceCurrency',p->>'sourceCurrency',
    'periodStart',p->>'periodStart','periodEnd',p->>'periodEnd','columns',columns_json,'rows',rows_json,'truncated',truncated));
end
$function$;
alter function private.qbo_customer_preview_v1(jsonb,text,text) owner to postgres;
revoke all on function private.qbo_customer_preview_v1(jsonb,text,text) from public,anon,authenticated,service_role;

create function public.qbo_customer_source_browse_v1(
  p_workspace_id uuid, p_connection_id uuid default null, p_after_id uuid default null,
  p_source_id uuid default null, p_kind text default 'all'
) returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare actor uuid; session_id uuid; cid uuid; options jsonb; records jsonb; selected jsonb; next_id uuid;
declare has_more boolean; cursor_valid boolean; metrics jsonb;
declare reports constant text[] := array['ProfitAndLoss','BalanceSheet','CashFlow','ARAgingSummary','APAgingSummary','TrialBalance'];
declare transactions constant text[] := array['Invoice','Payment','CreditMemo','SalesReceipt','RefundReceipt','Bill',
  'BillPayment','VendorCredit','Purchase','Deposit','Transfer','JournalEntry'];
begin
  if auth.role() is distinct from 'authenticated' or p_workspace_id is null then
    raise exception 'qbo_customer_browse_denied' using errcode='42501'; end if;
  actor := auth.uid();
  begin session_id := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'qbo_customer_browse_denied' using errcode='42501'; end;
  if actor is null or session_id is null or not exists (
    select from auth.sessions s join auth.users u on u.id=s.user_id
    join public.workspace_members m on m.user_id=u.id and m.workspace_id=p_workspace_id
    join public.workspaces w on w.id=m.workspace_id
    where s.id=session_id and s.user_id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and (s.not_after is null or s.not_after>statement_timestamp())
      and m.role='owner' and m.status='active'
  ) then raise exception 'qbo_customer_browse_denied' using errcode='42501'; end if;
  -- 030 installs before the separately owned 040 validator migration. Fail
  -- closed at read time until its review state is available with FORCE RLS;
  -- never fall back to a stale immutable validation label for tombstones.
  if not exists(select from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('private.qbo_production_source_validation_work') and relrowsecurity and relforcerowsecurity) then
    raise exception 'qbo_customer_validation_status_unavailable' using errcode='55000'; end if;
  if p_kind is null or p_kind not in ('all','reports','records')
    or (p_connection_id is null and (p_after_id is not null or p_source_id is not null)) then
    raise exception 'qbo_customer_browse_filter_denied' using errcode='22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('connectionId',c.id,'label',c.safe_display_name,
    'entityLabel',c.entity_label,'state',c.status) order by c.created_at desc,c.id),'[]'::jsonb) into options
    from (select c.id,c.safe_display_name,c.status,c.created_at,e.display_name as entity_label
      from private.integration_connections c join public.business_entities e on e.id=c.business_entity_id and e.workspace_id=c.workspace_id
      where c.workspace_id=p_workspace_id and c.provider_key='quickbooks_online' and c.provider_environment='production'
        and c.status not in ('deleting','deleted') and e.status='active'
      order by c.created_at desc,c.id limit 101) c;
  if jsonb_array_length(options)>100 then
    raise exception 'qbo_customer_browse_connection_limit' using errcode='54000'; end if;
  cid := coalesce(p_connection_id,(options->0->>'connectionId')::uuid);
  if cid is not null and not exists(select from jsonb_array_elements(options) c where (c->>'connectionId')::uuid=cid) then
    raise exception 'qbo_customer_browse_denied' using errcode='42501'; end if;

  -- Join the source's exact mapping and current version. Historical mappings may
  -- be browsed, but pending/unverified mappings and cross-scope rows cannot pass.
  with eligible as not materialized (
    select s.id,v.normalized_projection,validation.effective as validation_state,w.state as work_state,s.lifecycle_state,s.provider_record_type,s.provider_record_id,
      jsonb_build_object('sourceId',s.id,'recordType',s.provider_record_type,
        'providerRecordId',case when s.provider_record_type=any(transactions) then s.provider_record_id else null end,
        'lifecycle',s.lifecycle_state,'validation',validation.effective,'validationWork',w.state,'changeKind',v.change_kind,'mappingStatus',m.status,
        'temporalBasis',v.temporal_basis,'postingDate',v.posting_date,'periodStart',v.period_start,'periodEnd',v.period_end,
        'effectiveAt',v.effective_at,'sourceTimeZone',v.source_timezone,'accountingBasis',v.accounting_basis,
        'currency',v.accounting_currency,'observedAt',v.observed_at,'synchronizedAt',v.synchronized_at) as summary
    from private.external_source_records s
    join private.integration_connections c on c.id=s.connection_id and c.workspace_id=s.workspace_id and c.business_entity_id=s.business_entity_id
    join public.business_entities e on e.id=c.business_entity_id and e.workspace_id=c.workspace_id
    join private.provider_entity_mappings m on m.id=s.mapping_id and m.workspace_id=s.workspace_id
      and m.business_entity_id=s.business_entity_id and m.connection_id=s.connection_id
    join private.external_source_record_versions v on v.id=s.current_version_id and v.source_record_id=s.id
      and v.workspace_id=s.workspace_id and v.business_entity_id=s.business_entity_id and v.connection_id=s.connection_id
      and v.provider_key=s.provider_key and v.provider_record_type=s.provider_record_type and v.provider_record_id=s.provider_record_id
    cross join lateral (
      select case when count(*)=0 then 'absent' when count(*)>1 then 'conflict' else min(work.state) end as state
      from private.qbo_production_source_validation_work work
      where work.workspace_id=s.workspace_id and work.business_entity_id=s.business_entity_id
        and work.connection_id=s.connection_id and work.mapping_id=s.mapping_id and work.source_record_id=s.id
        and (work.source_version_id=v.id or (work.completed_version_id=v.id and work.source_version_id=v.prior_version_id))
    ) w
    cross join lateral (
      select case when w.state in ('quarantined','conflict') then 'quarantined'
        when w.state in ('pending','claimed','superseded') then 'pending'
        else v.validation_state end as effective
    ) validation
    where s.workspace_id=p_workspace_id and s.connection_id=cid and s.provider_key='quickbooks_online' and s.source_kind='provider'
      and v.source_kind='provider' and c.provider_key='quickbooks_online' and c.provider_environment='production'
      and c.status not in ('deleting','deleted') and e.status='active'
      and m.provider_key='quickbooks_online' and m.provider_environment='production'
      and m.status in ('active','inactive','replaced') and m.verified_at is not null
      and ((p_kind in ('all','reports') and s.provider_record_type=any(reports))
        or (p_kind in ('all','records') and s.provider_record_type=any(transactions)))
  ), page as materialized (
    select id,summary from eligible where p_after_id is null or id>p_after_id order by id limit 26
  )
  select coalesce((select jsonb_agg(summary order by id) from (select * from page order by id limit 25) visible),'[]'::jsonb),
    (select id from page order by id offset 24 limit 1),
    (select jsonb_build_object('source',summary,'preview',case
      when validation_state not in ('pending','valid') or work_state in ('quarantined','superseded','conflict') or lifecycle_state in ('deleted','unavailable')
        then jsonb_build_object('state','restricted')
      else private.qbo_customer_preview_v1(normalized_projection,provider_record_type,provider_record_id) end)
      from eligible where id=p_source_id),
    (select count(*) from page)>25,
    p_after_id is null or exists(select from eligible where id=p_after_id),
    (select jsonb_build_object('scope','selected_connection_and_category_current_sources',
      'currentSources',count(*)::text,
      'reportObservations',count(*) filter(where provider_record_type=any(reports))::text,
      'transactionRecords',count(*) filter(where provider_record_type=any(transactions))::text,
      'validation',jsonb_build_object('pending',count(*) filter(where validation_state='pending')::text,
        'valid',count(*) filter(where validation_state='valid')::text,'invalid',count(*) filter(where validation_state='invalid')::text,
        'quarantined',count(*) filter(where validation_state='quarantined')::text),
      'validationWork',jsonb_build_object('absent',count(*) filter(where work_state='absent')::text,
        'pending',count(*) filter(where work_state='pending')::text,'claimed',count(*) filter(where work_state='claimed')::text,
        'valid',count(*) filter(where work_state='valid')::text,'quarantined',count(*) filter(where work_state='quarantined')::text,
        'superseded',count(*) filter(where work_state='superseded')::text,'conflict',count(*) filter(where work_state='conflict')::text),
      'lifecycle',jsonb_build_object('active',count(*) filter(where lifecycle_state='active')::text,
        'voided',count(*) filter(where lifecycle_state='voided')::text,'deleted',count(*) filter(where lifecycle_state='deleted')::text,
        'unavailable',count(*) filter(where lifecycle_state='unavailable')::text),
      'missingCurrency',count(*) filter(where summary->>'currency' is null)::text,
      'unknownAccountingBasis',count(*) filter(where summary->>'accountingBasis'='unknown')::text,
      'missingSourceTimeZone',count(*) filter(where summary->>'sourceTimeZone' is null)::text,
      'missingTransactionPostingDate',count(*) filter(where provider_record_type=any(transactions) and summary->>'postingDate' is null)::text,
      'earliestPostingDate',min(summary->>'postingDate'),'latestPostingDate',max(summary->>'postingDate'),
      'earliestObservedAt',min((summary->>'observedAt')::timestamptz),'latestObservedAt',max((summary->>'observedAt')::timestamptz),
      'latestSynchronizedAt',max((summary->>'synchronizedAt')::timestamptz),
      'byType',coalesce((select jsonb_agg(jsonb_build_object('recordType',provider_record_type,'count',n) order by provider_record_type)
        from (select provider_record_type,count(*)::text as n from eligible group by provider_record_type) counts),'[]'::jsonb)
    ) from eligible)
    into records,next_id,selected,has_more,cursor_valid,metrics;
  if not cursor_valid or (p_source_id is not null and selected is null) then
    raise exception 'qbo_customer_browse_denied' using errcode='42501'; end if;
  return jsonb_build_object('contractVersion','qbo_customer_source_browse_v1','provider','quickbooks_online',
    'environment','production','additive',false,'coverage','unknown','readAt',statement_timestamp(),
    'connectionId',cid,'kind',p_kind,'pageSize',25,'nextAfter',case when has_more then next_id else null end,
    'connections',options,'sources',records,'detail',selected,'metrics',metrics);
end
$function$;
alter function public.qbo_customer_source_browse_v1(uuid,uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.qbo_customer_source_browse_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.qbo_customer_source_browse_v1(uuid,uuid,uuid,uuid,text) to authenticated;
comment on function public.qbo_customer_source_browse_v1(uuid,uuid,uuid,uuid,text) is
  'Owner/session-bound read-only QBO stored observations and exact source counts; no economic promotion, reconciliation or import-coverage claim.';
commit;
