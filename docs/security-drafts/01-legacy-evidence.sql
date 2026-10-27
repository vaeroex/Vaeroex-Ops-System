-- LOCAL REVIEW DRAFT ONLY. Not registered in supabase/migrations; do not apply.
-- Depends on the deployed require_live_actor_session_v1 contract and existing stores.
-- This creates owner-reviewed correspondence and change-detecting references, NOT
-- generation admission. No runtime may consume it before the manifest gate in README.
begin;

create table private.legacy_evidence_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('xero','harvest','clockify','toggl','zoho-inventory','katana','loyverse','zoho-books','wix-orders')),
  connection_id uuid not null,
  binding_version integer not null check(binding_version>0),
  business_entity_id uuid not null,
  incarnation_hash text not null check (incarnation_hash ~ '^[a-f0-9]{64}$'),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete cascade,
  unique(workspace_id,id),
  unique(workspace_id,provider,connection_id,binding_version)
);
create unique index legacy_evidence_one_active_binding on private.legacy_evidence_bindings(workspace_id,provider,connection_id) where revoked_at is null;

create table private.legacy_evidence_references (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  projection_version text not null check (projection_version = 'legacy_numeric_originals_v1'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  original_keys jsonb not null check (jsonb_typeof(original_keys) = 'array'),
  captured_by uuid not null,
  captured_session_id uuid not null,
  captured_at timestamptz not null default now(),
  check (isfinite(period_start) and isfinite(period_end) and period_end >= period_start and period_end-period_start < 366),
  foreign key(workspace_id,binding_id) references private.legacy_evidence_bindings(workspace_id,id) on delete cascade
);
alter table private.legacy_evidence_bindings enable row level security;
alter table private.legacy_evidence_references enable row level security;
revoke all on private.legacy_evidence_bindings,private.legacy_evidence_references from public,anon,authenticated,service_role;

create function private.evidence_digest_v1(p_value jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')
$$;

-- No caller actor/session parameters. PostgREST's verified JWT is the identity.
create function private.require_evidence_owner_v1(p_workspace_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_session uuid;
begin
  if auth.role() is distinct from 'authenticated' or v_actor is null then
    raise exception 'evidence_owner_required' using errcode='42501';
  end if;
  begin v_session := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'evidence_live_session_required' using errcode='42501';
  end;
  if v_session is null then raise exception 'evidence_live_session_required' using errcode='42501'; end if;
  -- The generic live-actor helper is explicitly SERVICE-ONLY in production.
  -- Reuse this already deployed role-neutral owner/session check after binding
  -- the authenticated JWT above; never impersonate service_role via set_config.
  perform private.square_production_customer_require_owner_v1(v_actor,v_session,p_workspace_id,null);
  return v_actor;
end $$;

-- Fixed dispatch, safe identity fields only. Account labels are never entity mappings.
-- Hash changes on scope/account replacement; lifecycle trigger makes revocation permanent.
create function private.legacy_evidence_connection_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' set datestyle = 'ISO, YMD' as $$
declare v_identity jsonb; v_status text;
begin
  case
  when p_provider in ('xero','harvest','clockify','toggl','zoho-inventory','katana') then
    select c.status,jsonb_build_array(c.id,c.created_at,c.account->>'id',c.account->>'parent',c.account->>'user')
      into v_status,v_identity from public.reporting_connections c
      where c.workspace_id=p_workspace_id and c.provider=p_provider and c.id=p_connection_id;
  when p_provider='loyverse' then
    select c.status,jsonb_build_array(c.id,c.created_at,c.merchant_id,c.currency_code)
      into v_status,v_identity from public.loyverse_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id;
  when p_provider='zoho-books' then
    select c.status,jsonb_build_array(c.id,c.created_at,c.organization_id,c.currency_code)
      into v_status,v_identity from public.zoho_books_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id;
  when p_provider='wix-orders' then
    select c.status,jsonb_build_array(c.id,c.created_at,c.instance_hash,c.site_id)
      into v_status,v_identity from public.wix_order_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id;
  else raise exception 'evidence_provider_unsupported' using errcode='22023';
  end case;
  if v_status is distinct from 'connected' or v_identity is null then
    raise exception 'evidence_connection_unavailable' using errcode='42501';
  end if;
  return jsonb_build_object('incarnation_hash',private.evidence_digest_v1(jsonb_build_array(p_workspace_id,p_provider,v_identity)),
    'scope',case p_provider when 'clockify' then 'connected_user' when 'harvest' then 'permission_visible_entries'
      when 'toggl' then 'visible_active_projects_lifetime' when 'zoho-inventory' then 'current_inventory_counts'
      when 'katana' then 'current_stock_counts' else 'connected_account' end);
end $$;

create function public.preview_legacy_evidence_mapping_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_evidence_owner_v1(p_workspace_id);
  return private.legacy_evidence_connection_v1(p_workspace_id,p_provider,p_connection_id);
end $$;

create function public.confirm_legacy_evidence_mapping_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid,p_business_entity_id uuid,p_expected_incarnation_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_state jsonb; v_id uuid;
begin
  v_actor := private.require_evidence_owner_v1(p_workspace_id);
  -- Serializes owner confirmations. The lifecycle trigger uses the same lock.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||p_provider||p_connection_id::text,0));
  v_state := private.legacy_evidence_connection_v1(p_workspace_id,p_provider,p_connection_id);
  if p_expected_incarnation_hash is null or p_expected_incarnation_hash <> v_state->>'incarnation_hash' then
    raise exception 'evidence_connection_changed' using errcode='40001';
  end if;
  if not exists(select 1 from public.business_entities e where e.workspace_id=p_workspace_id and e.id=p_business_entity_id and e.status='active') then
    raise exception 'evidence_entity_unavailable' using errcode='42501';
  end if;
  select id into v_id from private.legacy_evidence_bindings where workspace_id=p_workspace_id and provider=p_provider
    and connection_id=p_connection_id and revoked_at is null and business_entity_id=p_business_entity_id
    and incarnation_hash=p_expected_incarnation_hash;
  if v_id is not null then return v_id; end if;
  update private.legacy_evidence_bindings set revoked_at=now() where workspace_id=p_workspace_id and provider=p_provider and connection_id=p_connection_id and revoked_at is null;
  insert into private.legacy_evidence_bindings(workspace_id,provider,connection_id,binding_version,business_entity_id,incarnation_hash,confirmed_by)
    values(p_workspace_id,p_provider,p_connection_id,(select coalesce(max(binding_version),0)+1 from private.legacy_evidence_bindings where workspace_id=p_workspace_id and provider=p_provider and connection_id=p_connection_id),p_business_entity_id,p_expected_incarnation_hash,v_actor) returning id into v_id;
  return v_id;
end $$;

create function private.legacy_numeric_metrics_v1(p_provider text,p_metrics jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_metric jsonb; v_keys text[];
begin
  v_keys := case p_provider when 'xero' then array['invoices','billed','outstanding','bills','purchases']
    when 'harvest' then array['entries','hours','billable_hours','running'] when 'clockify' then array['entries','hours','billable_hours','running']
    when 'toggl' then array['projects','hours'] when 'zoho-inventory' then array['items','low_stock'] when 'katana' then array['stock_rows','unavailable'] end;
  if v_keys is null or jsonb_typeof(p_metrics) is distinct from 'array' then raise exception 'evidence_metrics_invalid' using errcode='22023'; end if;
  if jsonb_array_length(p_metrics)>100 then raise exception 'evidence_metrics_invalid' using errcode='22023'; end if;
  for v_metric in select value from jsonb_array_elements(p_metrics) loop
    if jsonb_typeof(v_metric) is distinct from 'object' or not(v_metric ?& array['key','value'])
      or v_metric-array['key','value','currency'] <> '{}'::jsonb or not coalesce((v_metric->>'key')=any(v_keys),false)
      or jsonb_typeof(v_metric->'value') is distinct from 'number' then raise exception 'evidence_metrics_invalid' using errcode='22023'; end if;
    if (v_metric->>'value')::numeric not between 0 and 1e12 or ((p_provider='xero')<>(v_metric ? 'currency'))
      or (v_metric ? 'currency' and coalesce(v_metric->>'currency','') !~ '^[A-Z]{3}$') then raise exception 'evidence_metrics_invalid' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_metrics) m group by m->>'key',m->>'currency' having count(*)>1) then raise exception 'evidence_metrics_invalid' using errcode='22023'; end if;
  return p_metrics;
end $$;

-- Only retained numeric reporting columns; no names, descriptions, credentials or raw payloads.
-- Records have composite original keys, not invented UUIDs. UTC date selection follows
-- each existing store's import semantics; snapshots retain their own temporal metadata.
create function private.legacy_evidence_originals_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid,p_start date,p_end date) returns jsonb
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' set datestyle = 'ISO, YMD' as $$
declare v_rows jsonb; v_coverage jsonb; v_keys jsonb;
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_end-p_start>=366 then
    raise exception 'evidence_period_invalid' using errcode='22023';
  end if;
  case
  when p_provider in ('xero','harvest','clockify') then
    select coalesce(jsonb_agg(jsonb_build_object('key',jsonb_build_array(p_provider,p_connection_id,f.record_id),'day',f.day,'metrics',private.legacy_numeric_metrics_v1(p_provider,f.metrics)) order by f.record_id),'[]')
      into v_rows from (select record_id,day,metrics from public.reporting_history_facts where workspace_id=p_workspace_id and provider=p_provider and connection_id=p_connection_id and day between p_start and p_end order by record_id limit 2001) f;
    select coalesce(jsonb_agg(jsonb_build_array(day,currencies,covered_through,imported_at) order by day),'[]') into v_coverage
      from public.reporting_history_days where workspace_id=p_workspace_id and provider=p_provider and connection_id=p_connection_id and day between p_start and p_end;
  when p_provider in ('toggl','zoho-inventory','katana') then
    select jsonb_build_array(jsonb_build_object('key',jsonb_build_array(p_provider,p_connection_id,'snapshot'),'snapshot',
      jsonb_build_object('start',(c.snapshot->>'start')::timestamptz,'end',(c.snapshot->>'end')::timestamptz,'metrics',private.legacy_numeric_metrics_v1(p_provider,c.snapshot->'metrics')),'last_sync_at',c.last_sync_at)) into v_rows
      from public.reporting_connections c where c.workspace_id=p_workspace_id and c.provider=p_provider and c.id=p_connection_id;
    v_coverage := '[]';
  when p_provider='loyverse' then
    select coalesce(jsonb_agg(jsonb_build_object('key',jsonb_build_array(p_provider,p_connection_id,f.receipt_number),'store_id',f.store_id,
      'created_at',f.created_at,'receipt_date',f.receipt_date,'updated_at',f.updated_at,'receipt_type',f.receipt_type,'total_money',f.total_money,
      'total_tax',f.total_tax,'total_discount',f.total_discount,'cancelled',f.cancelled) order by f.receipt_number),'[]') into v_rows
      from (select receipt_number,store_id,created_at,receipt_date,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled
        from public.loyverse_receipt_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
        and created_at >= p_start::timestamp at time zone 'UTC' and created_at < (p_end+1)::timestamp at time zone 'UTC' order by receipt_number limit 2001) f;
    select coalesce(jsonb_agg(jsonb_build_array(day,covered_through,imported_at) order by day),'[]') into v_coverage from public.loyverse_import_days
      where workspace_id=p_workspace_id and connection_id=p_connection_id and day between p_start and p_end;
  when p_provider='zoho-books' then
    select coalesce(jsonb_agg(jsonb_build_object('key',jsonb_build_array(p_provider,p_connection_id,f.kind,f.source_id),'day',f.day,
      'counted',f.counted,'currency',f.currency,'total',f.total,'outstanding',f.outstanding) order by f.kind,f.source_id),'[]') into v_rows
      from (select kind,source_id,day,counted,currency,total,outstanding from public.zoho_books_history_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
        and day between p_start and p_end order by kind,source_id limit 2001) f;
    select coalesce(jsonb_agg(jsonb_build_array(day,covered_through,imported_at) order by day),'[]') into v_coverage from public.zoho_books_history_coverage
      where workspace_id=p_workspace_id and connection_id=p_connection_id and day between p_start and p_end;
  when p_provider='wix-orders' then
    select coalesce(jsonb_agg(jsonb_build_object('key',jsonb_build_array(p_provider,p_connection_id,f.order_id),'created_at',f.created_at,
      'total_amount',f.total_amount,'currency_code',f.currency_code,'payment_status',f.payment_status) order by f.order_id),'[]') into v_rows
      from (select order_id,created_at,total_amount,currency_code,payment_status from public.wix_order_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
        and created_at >= p_start::timestamp at time zone 'UTC' and created_at < (p_end+1)::timestamp at time zone 'UTC' order by order_id limit 2001) f;
    select coalesce(jsonb_agg(jsonb_build_array(day,imported_through,imported_at) order by day),'[]') into v_coverage from public.wix_order_import_days
      where workspace_id=p_workspace_id and connection_id=p_connection_id and day between p_start and p_end;
  else raise exception 'evidence_provider_unsupported' using errcode='22023';
  end case;
  if v_rows is null or jsonb_array_length(v_rows)>2000 or octet_length(v_rows::text)>2000000 then
    raise exception 'evidence_read_budget_exceeded' using errcode='54000';
  end if;
  select coalesce(jsonb_agg(r->'key' order by r->'key'),'[]') into v_keys from jsonb_array_elements(v_rows) r;
  return jsonb_build_object('projection_version','legacy_numeric_originals_v1','workspace_id',p_workspace_id,'provider',p_provider,
    'connection_id',p_connection_id,'period_start',p_start,'period_end',p_end,'time_zone','UTC','records',v_rows,'coverage',v_coverage,'original_keys',v_keys);
end $$;

create function private.resolve_legacy_evidence_v1(p_workspace_id uuid,p_binding_id uuid,p_start date,p_end date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_binding private.legacy_evidence_bindings; v_state jsonb; v_data jsonb;
begin
  select * into v_binding from private.legacy_evidence_bindings where id=p_binding_id and workspace_id=p_workspace_id and revoked_at is null;
  if not found then raise exception 'evidence_binding_unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.business_entities where id=v_binding.business_entity_id and workspace_id=p_workspace_id and status='active') then
    raise exception 'evidence_entity_unavailable' using errcode='42501';
  end if;
  v_state := private.legacy_evidence_connection_v1(p_workspace_id,v_binding.provider,v_binding.connection_id);
  if v_state->>'incarnation_hash' <> v_binding.incarnation_hash then raise exception 'evidence_binding_changed' using errcode='42501'; end if;
  v_data := private.legacy_evidence_originals_v1(p_workspace_id,v_binding.provider,v_binding.connection_id,p_start,p_end);
  -- Currency is protected connection metadata already included in the reviewed
  -- incarnation above, not a label or a currency guessed from receipt amounts.
  -- Keep NULL explicit when the retained connection has no established currency.
  -- This intentionally changes Loyverse projection hashes; old references must
  -- report changed rather than silently acquiring new monetary semantics.
  if v_binding.provider='loyverse' then
    v_data := v_data || jsonb_build_object('currency',(select c.currency_code from public.loyverse_connections c
      where c.workspace_id=p_workspace_id and c.id=v_binding.connection_id));
  end if;
  return v_data || jsonb_build_object('binding_id',p_binding_id,'binding_version',v_binding.binding_version,'business_entity_id',v_binding.business_entity_id,'incarnation_hash',v_binding.incarnation_hash,'scope',v_state->>'scope');
end $$;

create function public.capture_legacy_evidence_v1(p_workspace_id uuid,p_binding_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_data jsonb; v_id uuid;
begin
  v_actor := private.require_evidence_owner_v1(p_workspace_id);
  v_data := private.resolve_legacy_evidence_v1(p_workspace_id,p_binding_id,p_start,p_end);
  insert into private.legacy_evidence_references(binding_id,workspace_id,period_start,period_end,projection_version,source_hash,original_keys,captured_by,captured_session_id)
    values(p_binding_id,p_workspace_id,p_start,p_end,'legacy_numeric_originals_v1',private.evidence_digest_v1(v_data),v_data->'original_keys',v_actor,(auth.jwt()->>'session_id')::uuid) returning id into v_id;
  return jsonb_build_object('stage','unadmitted','reference_id',v_id,'source_hash',private.evidence_digest_v1(v_data),'data',v_data);
end $$;

create function public.reopen_legacy_evidence_v1(p_workspace_id uuid,p_reference_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ref private.legacy_evidence_references; v_data jsonb;
begin
  perform private.require_evidence_owner_v1(p_workspace_id);
  select * into v_ref from private.legacy_evidence_references where id=p_reference_id and workspace_id=p_workspace_id;
  if not found then raise exception 'evidence_reference_unavailable' using errcode='42501'; end if;
  v_data := private.resolve_legacy_evidence_v1(p_workspace_id,v_ref.binding_id,v_ref.period_start,v_ref.period_end);
  if private.evidence_digest_v1(v_data) <> v_ref.source_hash then return jsonb_build_object('status','changed','reference_id',p_reference_id); end if;
  return jsonb_build_object('status','current','reference_id',p_reference_id,'data',v_data);
end $$;

create function private.revoke_legacy_evidence_binding_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_provider text; v_revoke boolean;
begin
  v_provider := case tg_table_name when 'reporting_connections' then to_jsonb(old)->>'provider' when 'loyverse_connections' then 'loyverse'
    when 'zoho_books_connections' then 'zoho-books' when 'wix_order_connections' then 'wix-orders' end;
  v_revoke := tg_op='DELETE';
  if tg_op='UPDATE' then
    v_revoke := new.status is distinct from 'connected' or old.workspace_id is distinct from new.workspace_id or old.id is distinct from new.id or old.created_at is distinct from new.created_at;
    -- Compare only account identity, never transient sync/lease metadata.
    if tg_table_name='reporting_connections' then
      v_revoke := v_revoke or old.provider is distinct from new.provider or
        jsonb_build_array(old.account->>'id',old.account->>'parent',old.account->>'user') is distinct from jsonb_build_array(new.account->>'id',new.account->>'parent',new.account->>'user');
    elsif tg_table_name='loyverse_connections' then v_revoke := v_revoke or old.merchant_id is distinct from new.merchant_id or old.currency_code is distinct from new.currency_code;
    elsif tg_table_name='zoho_books_connections' then v_revoke := v_revoke or old.organization_id is distinct from new.organization_id or old.currency_code is distinct from new.currency_code;
    else v_revoke := v_revoke or old.instance_hash is distinct from new.instance_hash or old.site_id is distinct from new.site_id;
    end if;
  end if;
  if v_revoke then
    perform pg_advisory_xact_lock(hashtextextended(old.workspace_id::text||v_provider||old.id::text,0));
    update private.legacy_evidence_bindings set revoked_at=now() where workspace_id=old.workspace_id and provider=v_provider and connection_id=old.id and revoked_at is null;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger legacy_evidence_revoke before update or delete on public.reporting_connections for each row execute function private.revoke_legacy_evidence_binding_v1();
create trigger legacy_evidence_revoke before update or delete on public.loyverse_connections for each row execute function private.revoke_legacy_evidence_binding_v1();
create trigger legacy_evidence_revoke before update or delete on public.zoho_books_connections for each row execute function private.revoke_legacy_evidence_binding_v1();
create trigger legacy_evidence_revoke before update or delete on public.wix_order_connections for each row execute function private.revoke_legacy_evidence_binding_v1();

-- Make a reference immutable even for ordinary definer/application writes.
create function private.reject_legacy_reference_change_v1() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Authorized parent erasure may cascade; ordinary reference rewrites cannot.
  if tg_op='DELETE' and (not exists(select 1 from public.workspaces where id=old.workspace_id)
    or not exists(select 1 from private.legacy_evidence_bindings where id=old.binding_id)) then return old; end if;
  raise exception 'evidence_reference_immutable' using errcode='42501';
end $$;
create trigger legacy_evidence_immutable before update or delete on private.legacy_evidence_references for each row execute function private.reject_legacy_reference_change_v1();
create function private.guard_legacy_binding_version_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at'
   or old.revoked_at is not null or new.revoked_at is null then
   raise exception 'evidence_binding_version_immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger legacy_binding_version_immutable before update on private.legacy_evidence_bindings for each row execute function private.guard_legacy_binding_version_v1();

revoke all on function private.evidence_digest_v1(jsonb),private.require_evidence_owner_v1(uuid),private.legacy_evidence_connection_v1(uuid,text,uuid),private.legacy_numeric_metrics_v1(text,jsonb),
 private.legacy_evidence_originals_v1(uuid,text,uuid,date,date),private.resolve_legacy_evidence_v1(uuid,uuid,date,date),
 private.revoke_legacy_evidence_binding_v1(),private.reject_legacy_reference_change_v1(),private.guard_legacy_binding_version_v1() from public,anon,authenticated,service_role;
revoke all on function public.preview_legacy_evidence_mapping_v1(uuid,text,uuid),public.confirm_legacy_evidence_mapping_v1(uuid,text,uuid,uuid,text),
 public.capture_legacy_evidence_v1(uuid,uuid,date,date),public.reopen_legacy_evidence_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_legacy_evidence_mapping_v1(uuid,text,uuid),public.confirm_legacy_evidence_mapping_v1(uuid,text,uuid,uuid,text),
 public.capture_legacy_evidence_v1(uuid,uuid,date,date),public.reopen_legacy_evidence_v1(uuid,uuid) to authenticated;
commit;
