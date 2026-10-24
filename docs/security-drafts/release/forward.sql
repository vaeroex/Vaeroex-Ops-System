-- INACTIVE REVIEW PACKAGE. Do not apply without exact release approval.
-- Published source f2d1547466edeadd586443e0e62afe6199f700da; tree 2aefe09d06924a71b6f1417cd71a5610e1716572.
-- Atomic forward install; pause procedure 04 is intentionally EXCLUDED.
-- Locks precede audience/installation backfills and remain held through trigger installation.
-- Quiesce reporting/Katana and artifact writers before this bounded table-lock window.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table public.ai_agent_runs,public.reporting_connections,public.reporting_credentials,public.reports,public.vsi_exchanges in share row exclusive mode;

-- SOURCE: docs/security-drafts/01-legacy-evidence.sql
-- LOCAL REVIEW DRAFT ONLY. Not registered in supabase/migrations; do not apply.
-- Depends on the deployed require_live_actor_session_v1 contract and existing stores.
-- This creates owner-reviewed correspondence and change-detecting references, NOT
-- generation admission. No runtime may consume it before the manifest gate in README.

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

-- SOURCE: docs/security-drafts/02-owner-artifact-boundary.sql
-- LOCAL REVIEW DRAFT ONLY. Backfill private metadata, never rewrite historical
-- artifacts: the deployed Sheets fence treats added-column changes as content.

create table private.derived_evidence_audiences (
 artifact_kind text not null check(artifact_kind in ('ai_agent_runs','reports')),
 artifact_id uuid not null,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_kind text,source_id uuid,lineage_state text not null check(lineage_state in ('source_verified','legacy_unverified')),
 actor_private boolean not null default false,actor_id uuid,primary key(artifact_kind,artifact_id)
);
alter table private.derived_evidence_audiences enable row level security;
revoke all on private.derived_evidence_audiences from public,anon,authenticated,service_role;
create function private.owner_artifact_marker_v1(j jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(j->>'contractId'='intelligence_briefing_v1' or j->>'analysis_type' in ('weekly_briefing','monthly_briefing','vsi')
 or j#>>'{source_artifact,workflow}' in ('intelligence_briefing_v1','vsi') or j#>>'{source_artifact,contract_id}' in ('intelligence_briefing_v1','vsi_exchange_v1')
 or j#>>'{artifact,contractId}'='intelligence_briefing_v1',false)
$$;
create function private.safe_evidence_uuid_v1(v text) returns uuid language plpgsql immutable set search_path='' as $$
begin return v::uuid;exception when invalid_text_representation then return null;end $$;
insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state)
 select 'ai_agent_runs',id,workspace_id,'legacy_unverified' from public.ai_agent_runs where agent_type='intelligence_briefing_v1' or private.owner_artifact_marker_v1(output_json);
insert into private.derived_evidence_audiences
 select 'reports',r.id,r.workspace_id,r.source_data_json#>>'{source_artifact,workflow}',private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}'),
 'legacy_unverified',e.id is not null or coalesce(r.source_data_json->>'analysis_type'='vsi' or r.source_data_json#>>'{source_artifact,workflow}'='vsi'
 or r.source_data_json#>>'{source_artifact,contract_id}'='vsi_exchange_v1',false),e.actor_user_id
 from public.reports r left join public.vsi_exchanges e on e.workspace_id=r.workspace_id and e.id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}')
 where r.report_type in ('weekly_briefing','monthly_briefing') or private.owner_artifact_marker_v1(r.source_data_json) or e.id is not null
 or exists(select 1 from private.derived_evidence_audiences a where a.artifact_kind='ai_agent_runs' and a.workspace_id=r.workspace_id and a.artifact_id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}'));
-- UNION terminates cycles. Missing/ambiguous private actor stays NULL and denies
-- access; created_by is not evidence of who owned a deleted source exchange.
with recursive descendants(id,workspace_id,actor_private,actor_id) as (
 select artifact_id,workspace_id,actor_private,actor_id from private.derived_evidence_audiences where artifact_kind='reports'
 union select r.id,r.workspace_id,d.actor_private,d.actor_id from public.reports r join descendants d on d.workspace_id=r.workspace_id
 and d.id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}')
) insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state,actor_private,actor_id)
 select 'reports',id,workspace_id,'legacy_unverified',bool_or(actor_private),
 case when count(distinct actor_id) filter(where actor_private)=1 and not bool_or(actor_private and actor_id is null)
 then min(actor_id::text) filter(where actor_private)::uuid else null end from descendants group by id,workspace_id
 on conflict(artifact_kind,artifact_id) do update set actor_private=private.derived_evidence_audiences.actor_private or excluded.actor_private,
 actor_id=case when excluded.actor_private then excluded.actor_id else private.derived_evidence_audiences.actor_id end;
create function public.can_access_owner_evidence_v1(w uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin perform private.require_evidence_owner_v1(w);return true;exception when insufficient_privilege then return false;end $$;
create function public.can_access_derived_evidence_v1(w uuid,k text,i uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;
begin
 if k not in ('ai_agent_runs','reports') then return false;end if;
 select * into a from private.derived_evidence_audiences where artifact_kind=k and artifact_id=i;
 if not found then return true;end if;
 return a.workspace_id=w and public.can_access_owner_evidence_v1(w) and (not a.actor_private or coalesce(a.actor_id=auth.uid(),false));
end $$;
create function private.guard_owner_brief_run_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;protected boolean;
begin
 select * into a from private.derived_evidence_audiences where artifact_kind='ai_agent_runs' and artifact_id=new.id;
 protected:=a.artifact_id is not null or new.agent_type='intelligence_briefing_v1' or private.owner_artifact_marker_v1(new.output_json);
 if not protected then return new;end if;
 if a.artifact_id is not null and a.workspace_id is distinct from new.workspace_id then raise exception 'evidence_artifact_identity_immutable' using errcode='42501';end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by or new.agent_type is distinct from old.agent_type then raise exception 'evidence_artifact_identity_immutable' using errcode='42501';end if;
  -- Failure cleanup uses the existing live-session/ticket-validated transaction
  -- claim, even if the former owner is now another active member. No output change.
  if auth.role()='service_role' and old.status='processing' and new.status='failed'
   and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json
   and exists(select 1 from private.trusted_derived_run_commits c where c.run_id=old.id and c.workspace_id=old.workspace_id
    and c.actor_id=old.created_by and c.transition='failed' and c.transaction_id=txid_current()
    and c.read_ticket_id::text=old.input_json->>'google_sheets_read_ticket_id') then return new;end if;
  if new.status is not distinct from old.status and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json then
   perform private.require_evidence_owner_v1(new.workspace_id);return new;end if;
 end if;
 if not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.created_by and status='active' and role='owner') then raise exception 'evidence_creator_owner_required' using errcode='42501';end if;
 if auth.role()='authenticated' then
  perform private.require_evidence_owner_v1(new.workspace_id);
  if auth.uid() is distinct from new.created_by then raise exception 'evidence_actor_mismatch' using errcode='42501';end if;
 end if;
 insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state) values('ai_agent_runs',new.id,new.workspace_id,'source_verified') on conflict do nothing;
 return new; -- Existing trusted completion/privacy triggers remain unmodified.
end $$;
create function private.guard_owner_saved_copy_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;sa private.derived_evidence_audiences;sid uuid;k text;sw uuid;actor uuid;priv boolean:=false;lineage text:='source_verified';protected boolean;
begin
 select * into a from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=new.id;
 if tg_op='UPDATE' and a.artifact_id is not null then
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by or new.source_data_json is distinct from old.source_data_json
   or new.body_markdown is distinct from old.body_markdown or new.report_type is distinct from old.report_type then raise exception 'evidence_saved_copy_immutable' using errcode='42501';end if;
  if not public.can_access_derived_evidence_v1(new.workspace_id,'reports',new.id) then raise exception 'evidence_saved_copy_denied' using errcode='42501';end if;
  return new;
 end if;
 if a.artifact_id is not null then raise exception 'evidence_artifact_identity_reused' using errcode='42501';end if;
 sid:=private.safe_evidence_uuid_v1(new.source_data_json#>>'{source_artifact,id}');k:=new.source_data_json#>>'{source_artifact,workflow}';
 select * into sa from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=sid;
 protected:=new.report_type in ('weekly_briefing','monthly_briefing') or private.owner_artifact_marker_v1(new.source_data_json) or sa.artifact_id is not null
 or exists(select 1 from private.derived_evidence_audiences where artifact_kind='ai_agent_runs' and artifact_id=sid) or exists(select 1 from public.vsi_exchanges where id=sid);
 if not protected then return new;end if;
 perform private.require_evidence_owner_v1(new.workspace_id);
 if auth.uid() is distinct from new.created_by then raise exception 'evidence_actor_mismatch' using errcode='42501';end if;
 if k='intelligence_briefing_v1' then
  select workspace_id into sw from public.ai_agent_runs where id=sid and agent_type='intelligence_briefing_v1' and status='completed' and archived_at is null and deleted_at is null and output_json=new.source_data_json->'artifact';
 elsif k='vsi' then
  select workspace_id,actor_user_id into sw,actor from public.vsi_exchanges where id=sid and actor_user_id=auth.uid()
  and new.source_data_json#>>'{artifact,exchangeId}'=id::text and new.source_data_json#>'{artifact,citations}'=citations
  and new.source_data_json#>>'{display,summary}'=user_message and new.source_data_json#>>'{display,sections,0,body}'=answer and new.body_markdown='# '||new.title||E'\n\n'||answer;
  priv:=true;
 elsif k='saved_report' then
  if sa.artifact_id is null or not public.can_access_derived_evidence_v1(new.workspace_id,'reports',sid) then raise exception 'evidence_saved_copy_denied' using errcode='42501';end if;
  select workspace_id into sw from public.reports where id=sid and deleted_at is null and body_markdown=new.body_markdown;
  priv:=sa.actor_private;actor:=sa.actor_id;lineage:=sa.lineage_state;
 else raise exception 'evidence_saved_source_required' using errcode='42501';end if;
 if sw is distinct from new.workspace_id then raise exception 'evidence_saved_source_unavailable' using errcode='42501';end if;
 insert into private.derived_evidence_audiences values('reports',new.id,new.workspace_id,k,sid,lineage,priv,actor);
 return new;
end $$;
create trigger owner_brief_run_boundary before insert or update on public.ai_agent_runs for each row execute function private.guard_owner_brief_run_v1();
create trigger owner_saved_copy_boundary before insert or update on public.reports for each row execute function private.guard_owner_saved_copy_v1();
create policy owner_brief_runs_boundary on public.ai_agent_runs as restrictive for all to public
 using(public.can_access_derived_evidence_v1(workspace_id,'ai_agent_runs',id)) with check(public.can_access_derived_evidence_v1(workspace_id,'ai_agent_runs',id));
create policy owner_saved_copies_boundary on public.reports as restrictive for all to public
 using(public.can_access_derived_evidence_v1(workspace_id,'reports',id)) with check(public.can_access_derived_evidence_v1(workspace_id,'reports',id));
-- No blanket owner policies on existing actor-private VSI transcripts.
revoke all on function private.owner_artifact_marker_v1(jsonb),private.safe_evidence_uuid_v1(text),private.guard_owner_brief_run_v1(),private.guard_owner_saved_copy_v1() from public,anon,authenticated,service_role;
revoke all on function public.can_access_owner_evidence_v1(uuid),public.can_access_derived_evidence_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_access_owner_evidence_v1(uuid) to authenticated;
-- Boolean policy predicate grants no table access. Classified content returns
-- false to anon; ordinary rows remain subject to the existing permissive RLS.
grant execute on function public.can_access_derived_evidence_v1(uuid,text,uuid) to authenticated,anon;

-- SOURCE: docs/security-drafts/03-generation-manifest-schema.sql
-- LOCAL REVIEW DRAFT ONLY. Storage foundation; partial admission is in 05.
-- Do not register/apply without the protected functions and trigger contracts in
-- README.md. No application role can read or mutate these tables directly.

create table private.shared_evidence_manifests (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null,
 session_id uuid not null,
 target_kind text not null check(target_kind in ('vsi_request','briefing_run')),
 target_id uuid not null,
 attempt integer not null check(attempt>0),
 google_sheets_read_ticket_id uuid not null,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 parser_contract text not null check(parser_contract='shared_evidence_v1'),
 sealed_at timestamptz not null default now(),
 unique(workspace_id,target_kind,target_id,attempt),
 unique(workspace_id,id)
);
create table private.shared_evidence_manifest_sources (
 workspace_id uuid not null,
 manifest_id uuid not null,
 ordinal integer not null check(ordinal>=0),
 source_kind text not null check(source_kind in ('legacy_reference','qbo_version','square_payment','sheets_ticket_source','approved_file_fact','approved_note','inherited_artifact')),
 original_identity jsonb not null check(jsonb_typeof(original_identity)='object'),
 authority_hash text not null check(authority_hash ~ '^[a-f0-9]{64}$'),
 primary key(manifest_id,ordinal),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
-- Exact typed original_identity variants are documented in README and must be
-- constructed by protected dispatch, never accepted as caller-authorized JSON.
-- Hashing an unverified caller payload is NOT source authorization.
create table private.shared_evidence_artifact_manifests (
 workspace_id uuid not null,
 artifact_kind text not null check(artifact_kind in ('vsi_exchange','vsi_conversation_context','briefing_run','report')),
 artifact_id uuid not null,
 artifact_revision text not null,
 manifest_id uuid not null,
 primary key(artifact_kind,artifact_id,artifact_revision,manifest_id),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
-- Transaction-bound claim complements, and does not replace, trusted run claims.
create table private.shared_evidence_commit_claims (
 transaction_id xid8 not null,
 workspace_id uuid not null,
 manifest_id uuid not null,
 target_kind text not null check(target_kind in ('vsi_request','briefing_run')),
 target_id uuid not null,
 attempt integer not null check(attempt>0),
 primary key(transaction_id,manifest_id),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
alter table private.shared_evidence_manifests enable row level security;
alter table private.shared_evidence_manifest_sources enable row level security;
alter table private.shared_evidence_artifact_manifests enable row level security;
alter table private.shared_evidence_commit_claims enable row level security;
revoke all on private.shared_evidence_manifests,private.shared_evidence_manifest_sources,
 private.shared_evidence_artifact_manifests,private.shared_evidence_commit_claims from public,anon,authenticated,service_role;
-- Rows are inserted only after a complete protected resolution in one transaction.
-- These triggers protect sealed provenance against later application rewrites.
create function private.reject_shared_manifest_change_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=old.workspace_id) then return old; end if;
 raise exception 'evidence_manifest_immutable' using errcode='42501';
end $$;
revoke all on function private.reject_shared_manifest_change_v1() from public,anon,authenticated,service_role;
create trigger shared_manifest_immutable before update or delete on private.shared_evidence_manifests
 for each row execute function private.reject_shared_manifest_change_v1();
create trigger shared_manifest_sources_immutable before update or delete on private.shared_evidence_manifest_sources
 for each row execute function private.reject_shared_manifest_change_v1();
create trigger shared_artifact_manifest_immutable before update or delete on private.shared_evidence_artifact_manifests
 for each row execute function private.reject_shared_manifest_change_v1();

-- SOURCE: docs/security-drafts/05-manifest-admission.sql
-- LOCAL INACTIVE DRAFT. Implements legacy-reference admission/terminal fencing.
-- Other typed source resolvers deliberately fail closed, pending their contracts.
-- Provider policy and actual multi-session writer-lock qualification remain gates.

alter table public.vsi_requests add column shared_evidence_required boolean not null default false;
alter table private.shared_evidence_commit_claims add column output_hash text;
alter table private.shared_evidence_commit_claims add column context_hash text;
alter table private.shared_evidence_commit_claims add column conversation_id uuid;

create function private.require_shared_evidence_actor_v1(w uuid,a uuid,s uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='service_role' then perform private.require_live_actor_session_v1(w,a,s,array['owner']);
 elsif auth.role()='authenticated' and auth.uid()=a and (auth.jwt()->>'session_id')::uuid=s then perform private.require_evidence_owner_v1(w);
 else raise exception 'shared_evidence_actor_denied' using errcode='42501';end if;
end $$;

create function private.shared_evidence_ticket_v1(w uuid,a uuid,ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets;context jsonb;
begin
 t:=private.google_sheets_checked_ticket_v1(ticket,w);
 if t.actor_id is distinct from a or not t.bound then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 context:=public.get_google_sheets_read_context_v1(ticket);
 if (context->>'hasUnattributedDerivedSources')::boolean is distinct from false then raise exception 'shared_evidence_unattributed_source' using errcode='42501';end if;
 return jsonb_build_object('sources',t.sources,'context',context);
end $$;

-- Lock order matches the audited VSI path: privacy, actor, workspace, conversation,
-- request. Briefing completion uses privacy then the exact run row.
create function private.shared_evidence_target_v1(w uuid,a uuid,k text,i uuid,attempt integer,ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.vsi_requests;b public.ai_agent_runs;c public.vsi_conversations;
begin
 perform private.google_sheets_privacy_open_v1(w);
 if k='vsi_request' then
  perform pg_advisory_xact_lock(hashtextextended('vsi-actor:'||a::text,0));
  perform pg_advisory_xact_lock(hashtextextended('vsi-workspace:'||w::text,0));
  select * into r from public.vsi_requests where id=i and workspace_id=w and actor_user_id=a;
  select * into c from public.vsi_conversations where id=r.conversation_id and workspace_id=w and actor_user_id=a for update;
  if not found then raise exception 'shared_evidence_target_denied' using errcode='42501';end if;
  select * into r from public.vsi_requests where id=i and workspace_id=w and actor_user_id=a for update;
  if r.status is distinct from 'pending' or r.attempt is distinct from attempt or r.lease_until is null or r.lease_until<=clock_timestamp() then
   raise exception 'shared_evidence_stale_attempt' using errcode='40001';end if;
  return jsonb_build_object('question_hash',r.question_hash,'conversation_id',c.id,'context_hash',private.evidence_digest_v1(to_jsonb(c.context_summary)));
 elsif k='briefing_run' then
  select * into b from public.ai_agent_runs where id=i and workspace_id=w and created_by=a and agent_type='intelligence_briefing_v1'
   and trusted_source and archived_at is null and deleted_at is null for update;
  if not found or b.status<>'processing' or attempt<>1 or b.input_json->>'google_sheets_read_ticket_id' is distinct from ticket::text
   or b.input_json->>'shared_evidence_contract' is distinct from 'shared_evidence_v1' then raise exception 'shared_evidence_target_denied' using errcode='42501';end if;
  return b.input_json;
 end if;
 raise exception 'shared_evidence_target_kind_invalid' using errcode='22023';
end $$;

-- Exact artifact existence, revision, audience and original privacy are rechecked.
create function private.shared_evidence_inherited_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare am private.shared_evidence_artifact_manifests;pm private.shared_evidence_manifests;revision text;table_name text;ancestor uuid;visited uuid[];pa private.derived_evidence_audiences;link private.shared_evidence_artifact_manifests;
begin
 if j-array['kind','parent_manifest_id','artifact_kind','artifact_id','artifact_revision']<>'{}'::jsonb then raise exception 'shared_evidence_inherited_identity_invalid' using errcode='22023';end if;
 select * into am from private.shared_evidence_artifact_manifests where workspace_id=w and manifest_id=private.safe_evidence_uuid_v1(j->>'parent_manifest_id')
  and artifact_kind=j->>'artifact_kind' and artifact_id=private.safe_evidence_uuid_v1(j->>'artifact_id') and artifact_revision=j->>'artifact_revision';
 if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
 select * into pm from private.shared_evidence_manifests where id=am.manifest_id and workspace_id=w;
 if pm.target_kind='vsi_request' and pm.actor_id<>a then raise exception 'shared_evidence_inherited_actor_denied' using errcode='42501';end if;
 if am.artifact_kind='briefing_run' then
  table_name:='ai_agent_runs';select private.evidence_digest_v1(b.output_json) into revision from public.ai_agent_runs b
   where b.id=am.artifact_id and b.workspace_id=w and b.status='completed' and b.archived_at is null and b.deleted_at is null;
 elsif am.artifact_kind='report' then
  table_name:='reports';select private.evidence_digest_v1(jsonb_build_array(r.body_markdown,r.source_data_json)) into revision from public.reports r
   join private.derived_evidence_audiences da on da.artifact_kind='reports' and da.artifact_id=r.id and da.workspace_id=w
   where r.id=am.artifact_id and r.workspace_id=w and r.archived_at is null and r.deleted_at is null and (not da.actor_private or da.actor_id=a);
  ancestor:=am.artifact_id;visited:=array[]::uuid[];
  loop
   if ancestor=any(visited) or cardinality(visited)>=24 then raise exception 'shared_evidence_copy_ancestry_invalid' using errcode='42501';end if;
   visited:=array_append(visited,ancestor);
   select * into pa from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=ancestor and workspace_id=w;
   if not found or (pa.actor_private and pa.actor_id is distinct from a) then raise exception 'shared_evidence_inherited_actor_denied' using errcode='42501';end if;
   exit when pa.source_kind is distinct from 'saved_report';
   ancestor:=pa.source_id;
   select * into link from private.shared_evidence_artifact_manifests where workspace_id=w and artifact_kind='report' and artifact_id=ancestor and manifest_id=am.manifest_id;
   if not found or not exists(select 1 from public.reports r where r.id=ancestor and r.workspace_id=w and r.deleted_at is null and r.archived_at is null
    and private.evidence_digest_v1(jsonb_build_array(r.body_markdown,r.source_data_json))=link.artifact_revision)
    or not public.google_sheets_record_readable_v1(w,'reports',ancestor) then raise exception 'shared_evidence_inherited_artifact_changed' using errcode='42501';end if;
  end loop;
  -- Copying does not outlive the original generated output's eligibility.
  select * into link from private.shared_evidence_artifact_manifests where workspace_id=w and manifest_id=am.manifest_id and artifact_id=pm.target_id
   and artifact_kind=case pm.target_kind when 'vsi_request' then 'vsi_exchange' else 'briefing_run' end;
  if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
  perform private.shared_evidence_inherited_v1(w,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,
   'artifact_kind',link.artifact_kind,'artifact_id',link.artifact_id,'artifact_revision',link.artifact_revision));
 elsif am.artifact_kind='vsi_exchange' then
  table_name:='vsi_exchanges';select private.evidence_digest_v1(jsonb_build_array(e.user_message,e.answer,coalesce(e.citations,'[]'::jsonb))) into revision
   from public.vsi_exchanges e join public.vsi_conversations c on c.id=e.conversation_id and c.workspace_id=e.workspace_id
   where e.id=am.artifact_id and e.workspace_id=w and e.actor_user_id=a and c.actor_user_id=a and c.actor_role='owner';
 else raise exception 'shared_evidence_inherited_kind_unsupported' using errcode='42501';end if;
 if revision is distinct from am.artifact_revision or not public.google_sheets_record_readable_v1(w,table_name,am.artifact_id) then
  raise exception 'shared_evidence_inherited_artifact_changed' using errcode='42501';end if;
 return jsonb_build_object('identity',j,'hash',private.evidence_digest_v1(j),'data',jsonb_build_object('artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'revision',revision));
end $$;

create function private.shared_evidence_original_v1(w uuid,source jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.legacy_evidence_references;data jsonb;
begin
 if source->>'kind'='inherited_artifact' then return private.shared_evidence_inherited_v1(w,a,source);end if;
 if source->>'kind' is distinct from 'legacy_reference' or source-array['kind','reference_id']<>'{}'::jsonb then
  raise exception 'shared_evidence_source_kind_unimplemented' using errcode='22023';end if;
 select * into r from private.legacy_evidence_references where id=private.safe_evidence_uuid_v1(source->>'reference_id') and workspace_id=w;
 if not found then raise exception 'shared_evidence_reference_denied' using errcode='42501';end if;
 data:=private.resolve_legacy_evidence_v1(w,r.binding_id,r.period_start,r.period_end);
 if private.evidence_digest_v1(data)<>r.source_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
 return jsonb_build_object('identity',jsonb_build_object('kind','legacy_reference','reference_id',r.id),'hash',r.source_hash,'data',data);
end $$;

create function public.seal_shared_evidence_manifest_v1(p_workspace_id uuid,p_target_kind text,p_target_id uuid,p_attempt integer,p_read_ticket_id uuid,p_sources jsonb,p_inherited_manifest_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;s uuid;target jsonb;ticket jsonb;source jsonb;resolved jsonb;projections jsonb:='[]';identities jsonb:='[]';m uuid;ordinal integer:=0;parent uuid;required uuid;src record;dependency jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);s:=(auth.jwt()->>'session_id')::uuid;
 target:=private.shared_evidence_target_v1(p_workspace_id,a,p_target_kind,p_target_id,p_attempt,p_read_ticket_id);
 ticket:=private.shared_evidence_ticket_v1(p_workspace_id,a,p_read_ticket_id);
 if p_target_kind='briefing_run' and exists(select 1 from jsonb_array_elements(ticket->'sources') ts
  join private.derived_evidence_audiences da on da.workspace_id=p_workspace_id and da.artifact_kind='reports'
  and da.artifact_id=private.safe_evidence_uuid_v1(ts->>'id') where ts->>'table'='reports' and da.actor_private) then
  raise exception 'shared_evidence_private_brief_input_denied' using errcode='42501';end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or p_inherited_manifest_ids is null then raise exception 'shared_evidence_sources_invalid' using errcode='22023';end if;
 if jsonb_array_length(p_sources)>24 or cardinality(p_inherited_manifest_ids)>24 then raise exception 'shared_evidence_budget_exceeded' using errcode='54000';end if;
 -- Every inherited artifact read via the existing ticket must retain its seals.
 for required in select distinct am.manifest_id from private.shared_evidence_artifact_manifests am
  join jsonb_array_elements(ticket->'sources') ts on am.artifact_id=private.safe_evidence_uuid_v1(ts->>'id')
  where am.workspace_id=p_workspace_id and am.artifact_kind=case ts->>'table' when 'reports' then 'report' when 'ai_agent_runs' then 'briefing_run'
   when 'vsi_exchanges' then 'vsi_exchange' when 'vsi_conversations' then 'vsi_conversation_context' end
  union select am.manifest_id from private.shared_evidence_artifact_manifests am where p_target_kind='vsi_request'
   and am.workspace_id=p_workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=private.safe_evidence_uuid_v1(target->>'conversation_id')
 loop
  if not(required=any(p_inherited_manifest_ids)) then raise exception 'shared_evidence_inherited_dependency_missing' using errcode='42501';end if;
 end loop;
 for source in select value from jsonb_array_elements(p_sources) loop
  if source->>'kind' is null or source->>'kind' not in ('legacy_reference','qbo_version','square_payment','sheets_ticket_source','approved_file_fact','approved_note') then
   raise exception 'shared_evidence_direct_source_kind_denied' using errcode='42501';end if;
  resolved:=private.shared_evidence_original_v1(p_workspace_id,source,a);
  for dependency in select value from jsonb_array_elements(coalesce(resolved#>'{data,read_sources}','[]'::jsonb)) loop
   if not (ticket->'sources') @> jsonb_build_array(dependency) then raise exception 'shared_evidence_ticket_dependency_missing' using errcode='42501';end if;
  end loop;
  if source->>'kind'='legacy_reference' and not exists(select 1 from private.legacy_evidence_references where id=(source->>'reference_id')::uuid and captured_by=a and captured_session_id=s) then raise exception 'shared_evidence_capture_actor_mismatch' using errcode='42501';end if;
  if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
 end loop;
 foreach parent in array p_inherited_manifest_ids loop
  -- Owner-wide briefs cannot consume actor-private VSI history, including copies.
  if p_target_kind='briefing_run' and exists(select 1 from private.shared_evidence_manifests pm
   where pm.id=parent and pm.workspace_id=p_workspace_id and pm.target_kind='vsi_request') then
   raise exception 'shared_evidence_private_brief_input_denied' using errcode='42501';end if;
  -- Retain the immutable output identity behind context, plus each saved report
  -- actually present in the ticket. Mutable context is separately input-hashed.
  for src in select am.* from private.shared_evidence_artifact_manifests am
   join private.shared_evidence_manifests pm on pm.id=am.manifest_id and pm.workspace_id=am.workspace_id
   where am.manifest_id=parent and am.workspace_id=p_workspace_id and
    ((am.artifact_id=pm.target_id and am.artifact_kind=case pm.target_kind when 'vsi_request' then 'vsi_exchange' else 'briefing_run' end)
     or (am.artifact_kind='report' and exists(select 1 from jsonb_array_elements(ticket->'sources') ts where ts->>'table'='reports' and private.safe_evidence_uuid_v1(ts->>'id')=am.artifact_id)))
  loop
   resolved:=private.shared_evidence_inherited_v1(p_workspace_id,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',parent,
    'artifact_kind',src.artifact_kind,'artifact_id',src.artifact_id,'artifact_revision',src.artifact_revision));
   if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
  end loop;
  if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
  for src in select ms.original_identity from private.shared_evidence_manifest_sources ms where ms.manifest_id=parent and ms.workspace_id=p_workspace_id order by ms.ordinal loop
   resolved:=private.shared_evidence_original_v1(p_workspace_id,src.original_identity,a);
   for dependency in select value from jsonb_array_elements(coalesce(resolved#>'{data,read_sources}','[]'::jsonb)) loop
    if not (ticket->'sources') @> jsonb_build_array(dependency) then raise exception 'shared_evidence_ticket_dependency_missing' using errcode='42501';end if;
   end loop;
   if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
  end loop;
 end loop;
 if jsonb_array_length(projections)>24 or octet_length(projections::text)>2000000 then raise exception 'shared_evidence_budget_exceeded' using errcode='54000';end if;
 insert into private.shared_evidence_manifests(workspace_id,actor_id,session_id,target_kind,target_id,attempt,google_sheets_read_ticket_id,input_hash,manifest_hash,parser_contract)
 values(p_workspace_id,a,s,p_target_kind,p_target_id,p_attempt,p_read_ticket_id,private.evidence_digest_v1(jsonb_build_array(target,ticket)),private.evidence_digest_v1(projections),'shared_evidence_v1') returning id into m;
 for resolved in select value from jsonb_array_elements(projections) loop
  insert into private.shared_evidence_manifest_sources values(p_workspace_id,m,ordinal,resolved#>>'{identity,kind}',resolved->'identity',resolved->>'hash');ordinal:=ordinal+1;
 end loop;
 if p_target_kind='vsi_request' then update public.vsi_requests set shared_evidence_required=true where id=p_target_id and workspace_id=p_workspace_id;end if;
 return jsonb_build_object('stage','database_bound','manifest_id',m,'projections',projections,'provider_policy_required',true);
end $$;

create function private.validate_shared_evidence_manifest_v1(w uuid,m uuid,k text,i uuid,attempt integer,a uuid,s uuid) returns void
language plpgsql security definer set search_path='' as $$
declare manifest private.shared_evidence_manifests;target jsonb;ticket jsonb;src record;resolved jsonb;projections jsonb:='[]';
begin
 perform private.require_shared_evidence_actor_v1(w,a,s);
 select * into manifest from private.shared_evidence_manifests where id=m and workspace_id=w;
 if not found or manifest.actor_id<>a or manifest.session_id<>s or manifest.target_kind<>k or manifest.target_id<>i or manifest.attempt<>attempt then raise exception 'shared_evidence_manifest_denied' using errcode='42501';end if;
 target:=private.shared_evidence_target_v1(w,a,k,i,attempt,manifest.google_sheets_read_ticket_id);
 ticket:=private.shared_evidence_ticket_v1(w,a,manifest.google_sheets_read_ticket_id);
 if private.evidence_digest_v1(jsonb_build_array(target,ticket))<>manifest.input_hash then raise exception 'shared_evidence_input_changed' using errcode='40001';end if;
 for src in select * from private.shared_evidence_manifest_sources where workspace_id=w and manifest_id=m order by ordinal loop
  resolved:=private.shared_evidence_original_v1(w,src.original_identity,a);
  if resolved->>'hash'<>src.authority_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
  projections:=projections||jsonb_build_array(resolved);
 end loop;
 if private.evidence_digest_v1(projections)<>manifest.manifest_hash then raise exception 'shared_evidence_manifest_changed' using errcode='40001';end if;
end $$;
create function public.validate_shared_evidence_manifest_v1(p_workspace_id uuid,p_manifest_id uuid,p_target_kind text,p_target_id uuid,p_attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_evidence_owner_v1(p_workspace_id);
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,p_target_kind,p_target_id,p_attempt,auth.uid(),(auth.jwt()->>'session_id')::uuid);return true;
end $$;

create function private.shared_evidence_exchange_hash_v1(q text,a text,c jsonb) returns text language sql immutable set search_path='' as $$
 select private.evidence_digest_v1(jsonb_build_array(q,a,coalesce(c,'[]'::jsonb)))
$$;
-- Derive the gate from server-issued ticket dependencies, not caller opt-in.
create function private.shared_evidence_ticket_requires_manifest_v1(w uuid,t uuid) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from private.google_sheets_read_tickets ticket
 cross join lateral jsonb_array_elements(ticket.sources) src
 where ticket.id=t and ticket.workspace_id=w and
 (exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=w and am.artifact_id=private.safe_evidence_uuid_v1(src->>'id')
  and am.artifact_kind=case src->>'table' when 'reports' then 'report' when 'ai_agent_runs' then 'briefing_run' when 'vsi_exchanges' then 'vsi_exchange' when 'vsi_conversations' then 'vsi_conversation_context' end)
 or (src->>'table'='reports' and exists(select 1 from private.derived_evidence_audiences da where da.workspace_id=w and da.artifact_kind='reports'
  and da.artifact_id=private.safe_evidence_uuid_v1(src->>'id') and da.actor_private))))
$$;
create function private.guard_shared_evidence_terminal_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare required boolean;claim private.shared_evidence_commit_claims;r public.vsi_requests;
begin
 if tg_table_name='vsi_requests' then
  if tg_op='INSERT' then
   new.shared_evidence_required:=new.shared_evidence_required or exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=new.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=new.conversation_id);return new;
  end if;
  -- Existing conversation deletion uses FK SET NULL, retaining billed requests.
  if old.conversation_id is not null and new.conversation_id is null
   and to_jsonb(new)-'conversation_id'=to_jsonb(old)-'conversation_id'
   and not exists(select 1 from public.vsi_conversations c where c.id=old.conversation_id and c.workspace_id=old.workspace_id) then return new;end if;
  if old.shared_evidence_required and not new.shared_evidence_required then raise exception 'shared_evidence_downgrade_denied' using errcode='42501';end if;
  required:=old.shared_evidence_required or private.shared_evidence_ticket_requires_manifest_v1(new.workspace_id,private.safe_evidence_uuid_v1(current_setting('vaeroex.google_sheets_read_ticket_id',true))) or exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=new.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=new.conversation_id);
  if not required or new.status<>'completed' then return new;end if;
  if new.workspace_id<>old.workspace_id or new.actor_user_id<>old.actor_user_id or new.conversation_id is distinct from old.conversation_id or new.attempt<>old.attempt then raise exception 'shared_evidence_target_changed' using errcode='42501';end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=old.workspace_id and target_kind='vsi_request' and target_id=old.id and attempt=old.attempt;
 elsif tg_table_name='ai_agent_runs' then
  required:=old.input_json->>'shared_evidence_contract'='shared_evidence_v1' or private.shared_evidence_ticket_requires_manifest_v1(old.workspace_id,private.safe_evidence_uuid_v1(old.input_json->>'google_sheets_read_ticket_id')) or exists(select 1 from private.shared_evidence_manifests where target_kind='briefing_run' and target_id=old.id);
  if not coalesce(required,false) or new.status<>'completed' then return new;end if;
  if old.status='completed' and new.id=old.id and new.workspace_id=old.workspace_id and new.created_by=old.created_by
   and new.agent_type=old.agent_type and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=old.workspace_id and target_kind='briefing_run' and target_id=old.id and attempt=1;
  if claim.output_hash is distinct from private.evidence_digest_v1(new.output_json) then raise exception 'shared_evidence_output_changed' using errcode='42501';end if;
 elsif tg_table_name='vsi_exchanges' then
  if tg_op='UPDATE' and exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=old.workspace_id and am.artifact_kind='vsi_exchange' and am.artifact_id=old.id) then
   raise exception 'shared_evidence_exchange_immutable' using errcode='42501';end if;
  select * into r from public.vsi_requests where id=new.id and workspace_id=new.workspace_id;
  if not coalesce(r.shared_evidence_required,false) then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=new.workspace_id and target_kind='vsi_request' and target_id=new.id and attempt=r.attempt;
  if claim.output_hash is distinct from private.shared_evidence_exchange_hash_v1(new.user_message,new.answer,new.citations) then raise exception 'shared_evidence_output_changed' using errcode='42501';end if;
 else
  if tg_op='INSERT' then
   if new.parent_conversation_id is not null and exists(select 1 from private.shared_evidence_artifact_manifests where artifact_kind='vsi_conversation_context' and artifact_id=new.parent_conversation_id) then raise exception 'shared_evidence_continuation_unimplemented' using errcode='42501';end if;
   return new;
  end if;
  if exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=old.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=old.id)
   and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.actor_user_id<>old.actor_user_id or new.actor_role<>old.actor_role) then raise exception 'shared_evidence_context_identity_changed' using errcode='42501';end if;
  if new.context_summary is not distinct from old.context_summary then return new;end if;
  if not exists(select 1 from private.shared_evidence_artifact_manifests where artifact_kind='vsi_conversation_context' and artifact_id=old.id)
   and not exists(select 1 from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and conversation_id=old.id) then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=new.workspace_id and conversation_id=new.id;
  if claim.context_hash is distinct from private.evidence_digest_v1(to_jsonb(new.context_summary)) then raise exception 'shared_evidence_context_changed' using errcode='42501';end if;
 end if;
 if claim.manifest_id is null then raise exception 'shared_evidence_commit_required' using errcode='42501';end if;
 return new;
end $$;
create trigger shared_evidence_terminal before insert or update on public.vsi_requests for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before update on public.ai_agent_runs for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before insert or update on public.vsi_exchanges for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before insert or update on public.vsi_conversations for each row execute function private.guard_shared_evidence_terminal_v1();

create function public.complete_trusted_derived_run_v2(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_session_id uuid,p_read_ticket_id uuid,p_agent_type text,p_output_json jsonb,p_manifest_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;m private.shared_evidence_manifests;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'shared_evidence_server_only' using errcode='42501';end if;
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,'briefing_run',p_run_id,1,p_actor_id,p_session_id);
 select * into m from private.shared_evidence_manifests where id=p_manifest_id;
 if m.google_sheets_read_ticket_id is distinct from p_read_ticket_id or p_agent_type<>'intelligence_briefing_v1' then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 insert into private.shared_evidence_commit_claims(transaction_id,workspace_id,manifest_id,target_kind,target_id,attempt,output_hash)
 values(pg_current_xact_id(),p_workspace_id,p_manifest_id,'briefing_run',p_run_id,1,private.evidence_digest_v1(p_output_json));
 result:=public.complete_trusted_derived_run_v1(p_workspace_id,p_run_id,p_actor_id,p_session_id,p_read_ticket_id,p_agent_type,p_output_json);
 insert into private.shared_evidence_artifact_manifests values(p_workspace_id,'briefing_run',p_run_id,private.evidence_digest_v1(p_output_json),p_manifest_id);
 delete from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and manifest_id=p_manifest_id;
 return result;
end $$;
create function public.vsi_mutate_v3(p_workspace_id uuid,p_actor_user_id uuid,p_action text,p_input jsonb,p_session_id uuid,p_manifest_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;m private.shared_evidence_manifests;output_hash text;context_hash text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'shared_evidence_server_only' using errcode='42501';end if;
 if p_action<>'settle' or coalesce(p_input->>'answer','')='' then
  -- Failure settlement keeps the original cost/accounting/session/privacy path.
  return public.vsi_mutate_v2(p_workspace_id,p_actor_user_id,p_action,p_input,p_session_id);
 end if;
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,'vsi_request',(p_input->>'id')::uuid,(p_input->>'attempt')::integer,p_actor_user_id,p_session_id);
 select * into m from private.shared_evidence_manifests where id=p_manifest_id;
 if p_input->>'readTicketId' is distinct from m.google_sheets_read_ticket_id::text then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 if not exists(select 1 from public.vsi_requests where id=m.target_id and workspace_id=p_workspace_id
  and conversation_id=(p_input->>'conversationId')::uuid and question_hash=encode(sha256(convert_to(p_input->>'question','UTF8')),'hex')) then
  raise exception 'shared_evidence_question_changed' using errcode='42501';end if;
 output_hash:=private.shared_evidence_exchange_hash_v1(p_input->>'question',p_input->>'answer',p_input->'citations');
 context_hash:=private.evidence_digest_v1(to_jsonb(left(p_input->>'summary',8000)));
 if p_input->>'summary' is null then raise exception 'shared_evidence_summary_required' using errcode='22023';end if;
 insert into private.shared_evidence_commit_claims values(pg_current_xact_id(),p_workspace_id,p_manifest_id,'vsi_request',m.target_id,m.attempt,output_hash,context_hash,(p_input->>'conversationId')::uuid);
 result:=public.vsi_mutate_v2(p_workspace_id,p_actor_user_id,p_action,p_input,p_session_id);
 if result->>'state' is distinct from 'settled' then raise exception 'shared_evidence_settlement_changed' using errcode='40001';end if;
 insert into private.shared_evidence_artifact_manifests values(p_workspace_id,'vsi_exchange',m.target_id,output_hash,p_manifest_id),
  (p_workspace_id,'vsi_conversation_context',(p_input->>'conversationId')::uuid,context_hash,p_manifest_id);
 delete from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and manifest_id=p_manifest_id;
 return result;
end $$;

-- Save-copy lineage is attached in the same transaction as the checked payload.
create function private.attach_shared_evidence_copy_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare audience private.derived_evidence_audiences;am record;src record;identity jsonb;revision text;k text;
begin
 select * into audience from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=new.id and workspace_id=new.workspace_id;
 if not found then return new;end if;
 k:=case audience.source_kind when 'vsi' then 'vsi_exchange' when 'intelligence_briefing_v1' then 'briefing_run' when 'saved_report' then 'report' end;
 revision:=private.evidence_digest_v1(jsonb_build_array(new.body_markdown,new.source_data_json));
 for am in select * from private.shared_evidence_artifact_manifests where workspace_id=new.workspace_id and artifact_kind=k and artifact_id=audience.source_id loop
  identity:=jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,'artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'artifact_revision',am.artifact_revision);
  perform private.shared_evidence_inherited_v1(new.workspace_id,auth.uid(),identity);
  for src in select * from private.shared_evidence_manifest_sources where workspace_id=new.workspace_id and manifest_id=am.manifest_id loop
   perform private.shared_evidence_original_v1(new.workspace_id,src.original_identity,auth.uid());
  end loop;
  insert into private.shared_evidence_artifact_manifests values(new.workspace_id,'report',new.id,revision,am.manifest_id);
 end loop;
 return new;
end $$;
create trigger shared_evidence_copy after insert on public.reports for each row execute function private.attach_shared_evidence_copy_v1();
revoke all on function private.attach_shared_evidence_copy_v1() from public,anon,authenticated,service_role;

revoke all on function private.require_shared_evidence_actor_v1(uuid,uuid,uuid),private.shared_evidence_ticket_v1(uuid,uuid,uuid),private.shared_evidence_target_v1(uuid,uuid,text,uuid,integer,uuid),
 private.shared_evidence_inherited_v1(uuid,uuid,jsonb),private.shared_evidence_original_v1(uuid,jsonb,uuid),private.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer,uuid,uuid),private.shared_evidence_exchange_hash_v1(text,text,jsonb),private.guard_shared_evidence_terminal_v1(),private.shared_evidence_ticket_requires_manifest_v1(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]),public.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer),
 public.complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid),public.vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]),public.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer) to authenticated;
grant execute on function public.complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid),public.vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid) to service_role;

-- SOURCE: docs/security-drafts/06-typed-source-admission.sql
-- INACTIVE LOCAL DRAFT. No runtime activation. Requires 01/02/03/05.
-- Fixed stored-source dispatch only; no provider calls or arbitrary relations.
-- Writer interlocks/full deployed trigger composition remain release blockers.

create function private.shared_evidence_typed_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare data jsonb;identity jsonb;h text;preview jsonb;authority jsonb;chunk public.business_memory_chunks;
 note public.business_notes;file public.file_uploads;source record;head uuid;run_id uuid;run_text text;run public.ai_agent_runs;read_sources jsonb;heads jsonb:='[]';
begin
 -- Private-only: callers already checked exact live owner/session and workspace.
 if j->>'kind'='qbo_version' then
  if j-array['kind','source_id','version_id','authority_hash']<>'{}'::jsonb then raise exception 'shared_typed_identity_invalid' using errcode='22023';end if;
  if not exists(select 1 from pg_class where oid=to_regclass('private.qbo_production_source_validation_work') and relrowsecurity and relforcerowsecurity) then
   raise exception 'shared_typed_validation_unavailable' using errcode='42501';end if;
  select s.id,s.current_version_id,s.connection_id,s.business_entity_id,s.mapping_id,s.provider_record_type,s.provider_record_id,
   m.row_version mapping_version,c.connection_generation,v.normalized_projection,v.temporal_basis,v.posting_date,v.period_start,v.period_end,
   v.source_timezone,v.accounting_basis,v.accounting_currency,v.observed_at,v.synchronized_at into source
   from private.external_source_records s
   join private.integration_connections c on c.id=s.connection_id and c.workspace_id=s.workspace_id and c.business_entity_id=s.business_entity_id
   join public.business_entities e on e.id=c.business_entity_id and e.workspace_id=c.workspace_id and e.status='active'
   join private.provider_entity_mappings m on m.id=s.mapping_id and m.workspace_id=s.workspace_id and m.business_entity_id=s.business_entity_id
    and m.connection_id=s.connection_id and m.provider_key=s.provider_key and m.provider_environment='production' and m.status='active' and m.verified_at is not null
   join private.external_source_record_versions v on v.id=s.current_version_id and v.source_record_id=s.id and v.workspace_id=s.workspace_id
    and v.business_entity_id=s.business_entity_id and v.connection_id=s.connection_id and v.provider_key=s.provider_key
    and v.provider_record_type=s.provider_record_type and v.provider_record_id=s.provider_record_id
   cross join lateral(select count(*) n,min(work.state) state from private.qbo_production_source_validation_work work
    where work.workspace_id=s.workspace_id and work.business_entity_id=s.business_entity_id and work.connection_id=s.connection_id
    and work.mapping_id=s.mapping_id and work.source_record_id=s.id
    and (work.source_version_id=v.id or (work.completed_version_id=v.id and work.source_version_id=v.prior_version_id))) validation
   where s.workspace_id=w and s.id=private.safe_evidence_uuid_v1(j->>'source_id') and s.provider_key='quickbooks_online'
    and s.source_kind='provider' and s.lifecycle_state='active' and c.provider_key='quickbooks_online' and c.provider_environment='production'
    and c.status='active' and v.source_kind='provider' and v.validation_state='valid' and validation.n=1 and validation.state='valid';
  if not found or (j ? 'version_id' and j->>'version_id' is distinct from source.current_version_id::text) then raise exception 'shared_typed_qbo_denied' using errcode='42501';end if;
  preview:=private.qbo_customer_preview_v1(source.normalized_projection,source.provider_record_type,source.provider_record_id);
  if preview->>'state' is distinct from 'available' or coalesce((preview#>>'{value,truncated}')::boolean,false) then raise exception 'shared_typed_qbo_projection_unavailable' using errcode='42501';end if;
  if preview#>>'{value,kind}'='report' then
   if preview#>>'{value,sourceCurrency}' is distinct from source.accounting_currency or source.accounting_currency is null
    or preview#>>'{value,reportBasis}' is distinct from source.accounting_basis or source.accounting_basis not in ('cash','accrual')
    or preview#>>'{value,periodStart}' is distinct from source.period_start::text or preview#>>'{value,periodEnd}' is distinct from source.period_end::text
    or source.period_start is null or source.period_end is null or source.period_start>source.period_end then
    raise exception 'shared_typed_qbo_scope_mismatch' using errcode='42501';end if;
  else
   if preview#>>'{value,accounting,sourceCurrency}' is distinct from source.accounting_currency or source.accounting_currency is null
    or preview#>>'{value,accounting,basis}' is distinct from source.accounting_basis
    or preview#>>'{value,temporal,postingDate}' is distinct from source.posting_date::text then
    raise exception 'shared_typed_qbo_scope_mismatch' using errcode='42501';end if;
  end if;
  data:=jsonb_build_object('provider','quickbooks_online','workspace_id',w,'entity_id',source.business_entity_id,'connection_id',source.connection_id,
   'mapping_id',source.mapping_id,'mapping_version',source.mapping_version,'connection_generation',source.connection_generation,
   'source_id',source.id,'version_id',source.current_version_id,'record_type',source.provider_record_type,
   'temporal_basis',source.temporal_basis,'posting_date',source.posting_date,'period_start',source.period_start,'period_end',source.period_end,
   'time_zone',source.source_timezone,'basis',source.accounting_basis,'currency',source.accounting_currency,'observed_at',source.observed_at,
   'synchronized_at',source.synchronized_at,'coverage','unknown','additive',false,'preview',preview->'value');
  identity:=jsonb_build_object('kind','qbo_version','source_id',source.id,'version_id',source.current_version_id);
 elsif j->>'kind'='square_payment' then
  if j-array['kind','connection_id','payment_id','authority_hash']<>'{}'::jsonb then raise exception 'shared_typed_identity_invalid' using errcode='22023';end if;
  select jsonb_build_object('provider','square','workspace_id',w,'entity_id',c.business_entity_id,'connection_id',c.connection_id,
   'generation',c.generation,'logical_identity_hash',private.evidence_digest_v1(jsonb_build_array(c.application_id,c.merchant_id,c.location_id,c.business_entity_id)),
   'payment_id',p.payment_id,'location_id',p.location_id,'status',p.status,'created_at',p.created_at,'updated_at',p.updated_at,
   'amount_minor',p.amount_minor::text,'currency',p.currency,'time_zone',e.timezone,'coverage','unknown',
   'last_read_start',c.last_read_start,'last_read_end',c.last_read_end,'last_read_completed_at',c.last_read_completed_at)
   into data from square_customer_private.payments p join square_customer_private.connections c on c.connection_id=p.connection_id and c.workspace_id=p.workspace_id
   join public.business_entities e on e.id=c.business_entity_id and e.workspace_id=c.workspace_id and e.status='active'
   where p.workspace_id=w and p.connection_id=private.safe_evidence_uuid_v1(j->>'connection_id') and p.payment_id=j->>'payment_id'
    and c.state='connected' and not c.revocation_pending and not c.authorization_uncertain and c.merchant_id is not null
    and c.location_id=p.location_id and p.status='COMPLETED' and exists(select 1 from pg_timezone_names where name=e.timezone);
  if data is null then raise exception 'shared_typed_square_denied' using errcode='42501';end if;
  identity:=jsonb_build_object('kind','square_payment','connection_id',j->>'connection_id','payment_id',j->>'payment_id');
 elsif j->>'kind' in ('approved_file_fact','approved_note') then
  if j-array['kind','chunk_id','authority_hash']<>'{}'::jsonb then raise exception 'shared_typed_identity_invalid' using errcode='22023';end if;
  select * into chunk from public.business_memory_chunks where workspace_id=w and id=private.safe_evidence_uuid_v1(j->>'chunk_id')
   and trusted_index and deleted_at is null and archived_at is null;
  if not found or not public.google_sheets_record_readable_v1(w,'business_memory_chunks',chunk.id) then raise exception 'shared_typed_chunk_denied' using errcode='42501';end if;
  read_sources:=jsonb_build_array(jsonb_build_object('table','business_memory_chunks','id',chunk.id));
  if j->>'kind'='approved_note' then
   select * into note from public.business_notes where workspace_id=w and id=chunk.source_id and status='approved' and evidence_lifecycle_status='active'
    and trusted_approval and lifecycle_provenance_id is not null and release_channel='production' and approved_at<=clock_timestamp()
    and deleted_at is null and archived_at is null;
   if not found or chunk.source_type<>'business_note' or chunk.source_metadata->>'source_version' is distinct from note.source_version::text
    or chunk.source_metadata->>'release_channel' is distinct from note.release_channel
    or chunk.source_metadata->>'review_status' is distinct from 'approved'
    or chunk.content_hash is distinct from encode(sha256(convert_to(note.id::text||':'||note.source_version::text||':'||chunk.chunk_index::text||':'||chunk.source_excerpt,'UTF8')),'hex')
    or not public.google_sheets_record_readable_v1(w,'business_notes',note.id) then raise exception 'shared_typed_note_denied' using errcode='42501';end if;
   read_sources:=read_sources||jsonb_build_array(jsonb_build_object('table','business_notes','id',note.id));
   if note.original_file_id is not null then
    select * into file from public.file_uploads where workspace_id=w and id=note.original_file_id and deleted_at is null and archived_at is null;
    if not found or not public.google_sheets_record_readable_v1(w,'file_uploads',file.id) then raise exception 'shared_typed_file_denied' using errcode='42501';end if;
    read_sources:=read_sources||jsonb_build_array(jsonb_build_object('table','file_uploads','id',note.original_file_id));
    authority:=public.resolve_document_extraction_file_authority_v1(w,note.original_file_id);
    if authority->>'eligible' is distinct from 'true' then raise exception 'shared_typed_file_authority_denied' using errcode='42501';end if;
   end if;
   data:=jsonb_build_object('provider','business_note','workspace_id',w,'entity_id',null,'note_id',note.id,'source_version',note.source_version,
    'source_text_hash',note.source_text_hash,'original_note_text',note.original_note_text,'extraction',note.extraction_json,'user_reporting_period_start',note.user_reporting_period_start,'user_reporting_period_end',note.user_reporting_period_end,'reviewed_extraction',note.reviewed_extraction_json,
    'source_spans',note.source_spans_json,'user_corrections',note.user_corrections_json,'approved_at',note.approved_at,'approved_by',note.approved_by,
    'lifecycle_provenance_id',note.lifecycle_provenance_id,'release_channel',note.release_channel,'file_authority',authority,
    'chunk_id',chunk.id,'chunk_index',chunk.chunk_index,'content_hash',chunk.content_hash,'treatment','supporting_context');
  else
   if chunk.source_type not in ('file','file_analysis') then raise exception 'shared_typed_file_denied' using errcode='42501';end if;
   select * into file from public.file_uploads where workspace_id=w and id=coalesce(chunk.source_file_id,chunk.source_id) and deleted_at is null and archived_at is null;
   if not found or not public.google_sheets_record_readable_v1(w,'file_uploads',file.id) then raise exception 'shared_typed_file_denied' using errcode='42501';end if;
   read_sources:=read_sources||jsonb_build_array(jsonb_build_object('table','file_uploads','id',file.id));
   -- Match application runIdForChunk precedence; conflicting aliases fail closed.
   if chunk.source_metadata ?& array['source_run_id','run_id'] and chunk.source_metadata->>'source_run_id' is distinct from chunk.source_metadata->>'run_id' then
    raise exception 'shared_typed_parent_run_denied' using errcode='42501';end if;
   run_text:=coalesce(chunk.source_metadata->>'run_id',chunk.source_metadata->>'source_run_id',chunk.source_metadata#>>'{metadata,analysis_run_id}',chunk.source_metadata#>>'{metadata,run_id}');
   if run_text is not null then
    run_id:=private.safe_evidence_uuid_v1(run_text);
    select * into run from public.ai_agent_runs where workspace_id=w and id=run_id and status='completed' and deleted_at is null and archived_at is null;
    if not found or coalesce(run.output_json->>'evidence_classification',run.output_json#>>'{metadata,evidence_classification}','business_evidence')<>'business_evidence'
     or coalesce(run.input_json->>'evidence_classification',run.input_json#>>'{metadata,evidence_classification}','business_evidence')<>'business_evidence'
     or coalesce(run.output_json->>'invalidated_at',run.output_json#>>'{metadata,invalidated_at}',run.input_json->>'invalidated_at',run.input_json#>>'{metadata,invalidated_at}') is not null
     or coalesce(run.output_json->>'invalidation_reason',run.output_json#>>'{metadata,invalidation_reason}',run.input_json->>'invalidation_reason',run.input_json#>>'{metadata,invalidation_reason}') is not null
     or coalesce(run.output_json->>'extraction_outcome',run.output_json#>>'{metadata,extraction_outcome}','completed') not in ('facts_extracted','completed')
     or coalesce(run.input_json->>'extraction_outcome',run.input_json#>>'{metadata,extraction_outcome}','completed') not in ('facts_extracted','completed')
     or not public.google_sheets_record_readable_v1(w,'ai_agent_runs',run_id) then raise exception 'shared_typed_parent_run_denied' using errcode='42501';end if;
    read_sources:=read_sources||jsonb_build_array(jsonb_build_object('table','ai_agent_runs','id',run_id));
   end if;
   authority:=public.resolve_document_extraction_file_authority_v1(w,file.id);
   if authority->>'eligible' is distinct from 'true' or authority->>'mode' not in ('reviewed_document_extraction','existing_native_file_analysis')
    or (authority->>'mode'='reviewed_document_extraction' and chunk.source_metadata->'document_extraction_authority' is distinct from authority-array['eligible','mode','reason'])
    or chunk.source_metadata->>'evidence_classification' is distinct from 'business_evidence'
    or chunk.source_metadata->>'invalidated_at' is not null or chunk.source_metadata->>'invalidation_reason' is not null then
    raise exception 'shared_typed_file_authority_denied' using errcode='42501';end if;
   data:=jsonb_build_object('provider','file','workspace_id',w,'entity_id',null,'file_id',file.id,'chunk_id',chunk.id,
    'content_hash',chunk.content_hash,'excerpt',chunk.source_excerpt,'summary',chunk.summary,'parent_run_id',run_id,'parent_run_hash',case when run_id is not null then private.evidence_digest_v1(jsonb_build_array(run.input_json,run.output_json)) end,'authority',authority,'treatment','reviewed_extracted_context');
  end if;
  if chunk.source_metadata->>'indexing_method'='worksheet_import' then
   select h.completed_attempt_id into head from public.get_worksheet_publication_heads_v1(w,array[file.id]) h where h.file_id=file.id;
   if not found or (head is null and nullif(chunk.source_metadata->>'import_attempt_id','') is not null)
    or (head is not null and chunk.source_metadata->>'import_attempt_id' is distinct from head::text) then raise exception 'shared_typed_worksheet_head_denied' using errcode='42501';end if;
   heads:=jsonb_build_array(jsonb_build_array(file.id,head));
  end if;
  -- Hash the complete eligibility inputs, but never send this snapshot to a model.
  -- The application calls filterEligibleMemoryRows on exactly these values.
  data:=data||jsonb_build_object('read_sources',read_sources,'eligibility',jsonb_build_object(
   'chunk',jsonb_build_object('id',chunk.id,'workspace_id',w,'source_type',chunk.source_type,'source_id',chunk.source_id,'source_file_id',chunk.source_file_id,
    'deleted_at',chunk.deleted_at,'archived_at',chunk.archived_at,'source_metadata',chunk.source_metadata),
   'files',case when file.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',file.id,'deleted_at',file.deleted_at,'archived_at',file.archived_at,'metadata_json',file.metadata_json)) end,
   'runs',case when run.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',run.id,'status',run.status,'deleted_at',run.deleted_at,'archived_at',run.archived_at,'input_json',run.input_json,'output_json',run.output_json)) end,
   'notes',case when note.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',note.id,'workspace_id',w,'release_channel',note.release_channel,'status',note.status,'evidence_lifecycle_status',note.evidence_lifecycle_status,'deleted_at',note.deleted_at,'archived_at',note.archived_at)) end,
   'worksheetHeads',heads));
  identity:=jsonb_build_object('kind',j->>'kind','chunk_id',chunk.id);
 else raise exception 'shared_evidence_source_kind_unimplemented' using errcode='22023';end if;
 if octet_length(data::text)>131072 then raise exception 'shared_typed_budget_exceeded' using errcode='54000';end if;
 h:=private.evidence_digest_v1(data);identity:=identity||jsonb_build_object('authority_hash',h);
 return jsonb_build_object('identity',identity,'hash',h,'data',data);
end $$;

-- An authenticated preview returns identities; only sealing admits a generation.
create function public.read_shared_typed_evidence_v1(p_workspace_id uuid,p_identity jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;r jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);
 r:=private.shared_evidence_typed_v1(p_workspace_id,a,p_identity);
 if p_identity ? 'authority_hash' and p_identity is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 return jsonb_build_object('stage','unadmitted','resolved',r);
end $$;
alter function private.shared_evidence_original_v1(uuid,jsonb,uuid) rename to shared_evidence_legacy_original_v1;
create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare resolved jsonb;
begin
 if j->>'kind' in ('legacy_reference','inherited_artifact') then return private.shared_evidence_legacy_original_v1(w,j,a);end if;
 -- These projections establish provenance only. The full existing memory
 -- eligibility predicate and reviewed-text validator are not yet required by a
 -- consumer bridge. Do not let an authenticated seal imply semantic admission.
 if j->>'kind' in ('approved_file_fact','approved_note') then
  raise exception 'shared_typed_semantic_admission_unqualified' using errcode='42501';end if;
 resolved:=private.shared_evidence_typed_v1(w,a,j);
 if j is distinct from resolved->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 return resolved;
end $$;
revoke all on function private.shared_evidence_typed_v1(uuid,uuid,jsonb),private.shared_evidence_original_v1(uuid,jsonb,uuid),public.read_shared_typed_evidence_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_shared_typed_evidence_v1(uuid,jsonb) to authenticated;

-- SOURCE: docs/security-drafts/07-reopen-shared-artifact.sql
-- INACTIVE LOCAL DRAFT. Exact saved-output/citation reopening only.

create function public.reopen_shared_evidence_artifact_v1(p_workspace_id uuid,p_artifact_kind text,p_artifact_id uuid,p_expected_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;am record;src record;resolved jsonb;projections jsonb:='[]';identities jsonb:='[]';parents jsonb:='[]';
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);
 if p_artifact_kind not in ('report','briefing_run','vsi_exchange') or p_expected_revision is null or p_expected_revision!~'^[a-f0-9]{64}$' then
  raise exception 'shared_reopen_identity_invalid' using errcode='22023';end if;
 for am in select * from private.shared_evidence_artifact_manifests where workspace_id=p_workspace_id and artifact_kind=p_artifact_kind
  and artifact_id=p_artifact_id and artifact_revision=p_expected_revision order by manifest_id
 loop
  perform private.shared_evidence_inherited_v1(p_workspace_id,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,
   'artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'artifact_revision',am.artifact_revision));
  parents:=parents||jsonb_build_array(am.manifest_id);
  for src in select * from private.shared_evidence_manifest_sources where workspace_id=p_workspace_id and manifest_id=am.manifest_id order by ordinal loop
   resolved:=private.shared_evidence_original_v1(p_workspace_id,src.original_identity,a);
   if resolved->>'hash' is distinct from src.authority_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
   if not identities @> jsonb_build_array(resolved->'identity') then
    identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);
   end if;
  end loop;
 end loop;
 if parents='[]'::jsonb then raise exception 'shared_reopen_unavailable' using errcode='42501';end if;
 if jsonb_array_length(projections)>24 or octet_length(projections::text)>2000000 then raise exception 'shared_reopen_budget_exceeded' using errcode='54000';end if;
 return jsonb_build_object('stage','revalidated_saved_evidence','artifact_kind',p_artifact_kind,'artifact_id',p_artifact_id,
  'artifact_revision',p_expected_revision,'manifest_ids',parents,'projections',projections);
end $$;
revoke all on function public.reopen_shared_evidence_artifact_v1(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reopen_shared_evidence_artifact_v1(uuid,text,uuid,text) to authenticated;

-- SOURCE: docs/security-drafts/08-sheets-projection.sql
-- INACTIVE LOCAL DRAFT. Live comparison of the conflict predicate was denied;
-- repository contract only until approved deployed metadata qualification.

alter function private.shared_evidence_typed_v1(uuid,uuid,jsonb) rename to shared_evidence_typed_before_sheets_v1;
create function private.shared_evidence_typed_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare data jsonb;identity jsonb;h text;s record;metrics jsonb;roots jsonb;
begin
 if j->>'kind'<>'sheets_ticket_source' then return private.shared_evidence_typed_before_sheets_v1(w,a,j);end if;
 if j-array['kind','source_id','version_id','authority_hash']<>'{}'::jsonb then raise exception 'shared_typed_identity_invalid' using errcode='22023';end if;
 select r.id,r.current_version_id,r.business_entity_id,r.connection_id,v.normalized_projection,v.source_fingerprint,
  c.generation,c.active_approval_id,c.last_sync_at,e.timezone,c.field_mapping into s
 from public.google_sheets_source_rows r
 join public.google_sheets_source_versions v on v.workspace_id=r.workspace_id and v.connection_id=r.connection_id and v.source_row_id=r.id and v.id=r.current_version_id and v.validation_state='valid'
 join public.google_sheets_connections c on c.workspace_id=r.workspace_id and c.id=r.connection_id and c.business_entity_id=r.business_entity_id
 join public.business_entities e on e.workspace_id=r.workspace_id and e.id=r.business_entity_id and e.status='active'
 join public.google_sheets_mapping_approvals m on m.workspace_id=c.workspace_id and m.connection_id=c.id and m.id=c.active_approval_id
 join public.workspace_members member on member.workspace_id=c.workspace_id and member.user_id=m.approved_by and member.status='active' and member.role='owner'
 join auth.users approver on approver.id=member.user_id and approver.deleted_at is null and (approver.banned_until is null or approver.banned_until<=clock_timestamp())
 where r.workspace_id=w and r.id=private.safe_evidence_uuid_v1(j->>'source_id') and r.current
  and c.status='connected' and not c.authorization_uncertain and not c.revocation_pending
  and m.field_mapping=c.field_mapping and m.headers=c.headers and m.spreadsheet_id=c.spreadsheet_id and m.sheet_id=c.sheet_id and m.header_row=c.header_row
  and exists(select 1 from pg_timezone_names where name=e.timezone)
  and public.google_sheets_record_readable_v1(w,'google_sheets_source_rows',r.id);
 if not found or (j ? 'version_id' and j->>'version_id' is distinct from s.current_version_id::text) then raise exception 'shared_typed_sheets_denied' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('metric',metric->>'name','value',metric->>'value','unit',metric->>'unit') order by f.metric_column),
  jsonb_agg(jsonb_build_object('table','kpis','id',k.id) order by f.metric_column) into metrics,roots
 from public.google_sheets_fact_links f join public.kpis k on k.workspace_id=f.workspace_id and k.id=f.kpi_id
 cross join lateral jsonb_array_elements(s.normalized_projection->'metrics') metric
 where f.workspace_id=w and f.connection_id=s.connection_id and f.source_row_id=s.id and f.source_version_id=s.current_version_id
  and f.approval_id=s.active_approval_id and f.admission_state='accepted' and k.deleted_at is null and k.archived_at is null
  and metric->>'column'=f.metric_column::text and k.actual_value::numeric=(metric->>'value')::numeric and k.metric_date::text=s.normalized_projection->>'date'
  and public.google_sheets_record_readable_v1(w,'kpis',k.id)
  -- Same operational-overlap exclusion used by the existing KPI loader.
  and not exists(select 1 from public.operational_metrics o where o.workspace_id=w and o.metric_date=k.metric_date and o.value is not null
   and o.archived_at is null and o.deleted_at is null and private.google_sheets_operational_source_current_v1(o.workspace_id,o.source_file_id,o.import_id)
   and lower(regexp_replace(o.metric_name,'[^[:alnum:]]','','g')) in (lower(regexp_replace(k.name,'[^[:alnum:]]','','g')),lower(regexp_replace(k.raw_data_json#>>'{googleSheets,metricName}','[^[:alnum:]]','','g'))));
 if metrics is null then raise exception 'shared_typed_sheets_no_admitted_metrics' using errcode='42501';end if;
 roots:=roots||jsonb_build_array(jsonb_build_object('table','google_sheets_connections','id',s.connection_id));
 data:=jsonb_build_object('provider','google_sheets','workspace_id',w,'entity_id',s.business_entity_id,'connection_id',s.connection_id,
  'generation',s.generation,'source_id',s.id,'version_id',s.current_version_id,'approval_id',s.active_approval_id,'source_fingerprint',s.source_fingerprint,
  'date',s.normalized_projection->>'date','location',s.normalized_projection->>'location','time_zone',s.timezone,'observed_at',s.last_sync_at,
  'metrics',metrics,'coverage','unknown','currency',null,'read_sources',roots);
 h:=private.evidence_digest_v1(data);identity:=jsonb_build_object('kind','sheets_ticket_source','source_id',s.id,'version_id',s.current_version_id,'authority_hash',h);
 return jsonb_build_object('identity',identity,'hash',h,'data',data);
end $$;
revoke all on function private.shared_evidence_typed_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- SOURCE: docs/security-drafts/09-katana-installation-boundary.sql
-- INACTIVE LOCAL DRAFT. Katana has no token-refresh operation in this app.
-- Installation identity is a random, non-secret nonce, never derived from key
-- bytes or the provider's non-identifying key-account display marker.
-- ROLLOUT PRECONDITION: quiesce Katana connection/credential writers through
-- commit. Backfill and trigger installation are not safe against a concurrent
-- credential insertion; the missing nonce would fail closed, not establish identity.
-- This window and writer concurrency must be qualified before applying the draft.

create table private.katana_evidence_installations (
 connection_id uuid primary key references public.reporting_connections(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 nonce uuid not null default gen_random_uuid()
);
alter table private.katana_evidence_installations enable row level security;
revoke all on private.katana_evidence_installations from public,anon,authenticated,service_role;
-- Metadata-only initialization; this establishes a new boundary, not historical
-- identity. No ciphertext is selected, compared, hashed or logged.
insert into private.katana_evidence_installations(connection_id,workspace_id)
 select connection_id,workspace_id from public.reporting_credentials where provider='katana';
create function private.guard_katana_installation_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare state text; conn uuid; ws uuid; provider_name text;
begin
 if tg_table_name='reporting_connections' then
  if old.provider='katana' and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.provider is distinct from old.provider
   or (old.status='connected' and new.status in ('pending','choose_account'))
   or (old.status='reauthorization_required' and new.status not in ('reauthorization_required','disconnected'))
   or (old.status='disconnected' and new.status<>'disconnected')) then
   raise exception 'katana_new_installation_required' using errcode='42501';end if;
  if old.provider<>'katana' and new.provider='katana' then raise exception 'katana_new_installation_required' using errcode='42501';end if;
  return new;
 end if;
 if tg_op='DELETE' then conn:=old.connection_id;ws:=old.workspace_id;provider_name:=old.provider;
 else conn:=new.connection_id;ws:=new.workspace_id;provider_name:=new.provider;end if;
 if tg_op='UPDATE' and (old.provider='katana' or new.provider='katana') and
  (new.connection_id is distinct from old.connection_id or new.workspace_id is distinct from old.workspace_id or new.provider is distinct from old.provider) then
   raise exception 'katana_credential_identity_immutable' using errcode='42501';end if;
 if provider_name='katana' then
  -- Do not acquire a connection row lock while holding a credential row lock:
  -- normal setup/disconnect RPCs take connection then credential. The nonce
  -- detects every credential mutation independently of the observed state.
  select status into state from public.reporting_connections where workspace_id=ws and provider='katana' and id=conn;
  if (tg_op='INSERT' and state is distinct from 'pending')
   or (tg_op='UPDATE' and state is distinct from 'choose_account')
   or (tg_op='DELETE' and state is not null and state not in ('pending','choose_account','reauthorization_required','disconnected')) then
   raise exception 'katana_new_installation_required' using errcode='42501';end if;
  if tg_op='DELETE' then delete from private.katana_evidence_installations where connection_id=conn and workspace_id=ws;
  else insert into private.katana_evidence_installations(connection_id,workspace_id,nonce) values(conn,ws,gen_random_uuid())
   on conflict(connection_id) do update set nonce=excluded.nonce;end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger shared_katana_connection_identity before update on public.reporting_connections
 for each row execute function private.guard_katana_installation_v1();
create trigger shared_katana_key_identity before insert or update or delete on public.reporting_credentials
 for each row execute function private.guard_katana_installation_v1();
alter function private.legacy_evidence_connection_v1(uuid,text,uuid) rename to legacy_evidence_connection_before_katana_v1;
create function private.legacy_evidence_connection_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;installation uuid;
begin
 result:=private.legacy_evidence_connection_before_katana_v1(p_workspace_id,p_provider,p_connection_id);
 if p_provider='katana' then
  select nonce into installation from private.katana_evidence_installations where workspace_id=p_workspace_id and connection_id=p_connection_id;
  if not found then raise exception 'katana_installation_unavailable' using errcode='42501';end if;
  result:=jsonb_set(result,'{incarnation_hash}',to_jsonb(private.evidence_digest_v1(jsonb_build_array(result->>'incarnation_hash',installation))));
 end if;
 return result;
end $$;
revoke all on function private.guard_katana_installation_v1(),private.legacy_evidence_connection_v1(uuid,text,uuid),private.legacy_evidence_connection_before_katana_v1(uuid,text,uuid) from public,anon,authenticated,service_role;

-- Rollback must disable shared Katana admission first. Dropping this boundary
-- while retaining its references would remove installation-change detection.
-- Source-writer versus completion races still require multi-session qualification.

-- SOURCE: docs/security-drafts/10-memory-semantic-receipts.sql
-- INACTIVE. New privileged attestation authority; requires reviewed server callsites.

create table private.shared_memory_semantic_receipts (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_kind text not null check(source_kind in ('approved_file_fact','approved_note')),
 original_identity jsonb not null, authority_hash text not null check(authority_hash ~ '^[a-f0-9]{64}$'),
 validator_contract text not null check(validator_contract='canonical_memory_semantics_v1'),
 certified_by uuid not null, certified_session uuid not null, created_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,source_kind,authority_hash,validator_contract),
 check(original_identity->>'kind'=source_kind and original_identity->>'authority_hash'=authority_hash)
);
alter table private.shared_memory_semantic_receipts enable row level security;
revoke all on private.shared_memory_semantic_receipts from public,anon,authenticated,service_role;
create function private.guard_shared_semantic_receipt_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=old.workspace_id) then return old;end if;
 raise exception 'shared_semantic_receipt_immutable' using errcode='42501';
end $$;
create trigger shared_semantic_receipt_immutable before update or delete on private.shared_memory_semantic_receipts for each row execute function private.guard_shared_semantic_receipt_v1();
create function public.certify_shared_memory_semantics_v1(p_workspace_id uuid,p_actor_id uuid,p_session_id uuid,p_identity jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501';end if;
 perform private.require_shared_evidence_actor_v1(p_workspace_id,p_actor_id,p_session_id);
 if p_identity->>'kind' is null or p_identity->>'kind' not in ('approved_file_fact','approved_note') then raise exception 'shared_semantic_kind_denied' using errcode='42501';end if;
 r:=private.shared_evidence_typed_v1(p_workspace_id,p_actor_id,p_identity);
 if p_identity is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 insert into private.shared_memory_semantic_receipts(workspace_id,source_kind,original_identity,authority_hash,validator_contract,certified_by,certified_session)
 values(p_workspace_id,p_identity->>'kind',p_identity,r->>'hash','canonical_memory_semantics_v1',p_actor_id,p_session_id) on conflict do nothing;
 return true;
end $$;
alter function private.shared_evidence_original_v1(uuid,jsonb,uuid) rename to shared_evidence_before_memory_receipts_v1;
create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if j->>'kind' not in ('approved_file_fact','approved_note') then return private.shared_evidence_before_memory_receipts_v1(w,j,a);end if;
 r:=private.shared_evidence_typed_v1(w,a,j);
 if j is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 if not exists(select 1 from private.shared_memory_semantic_receipts where workspace_id=w and source_kind=j->>'kind' and original_identity=j
  and authority_hash=r->>'hash' and validator_contract='canonical_memory_semantics_v1') then raise exception 'shared_semantic_receipt_required' using errcode='42501';end if;
 return r;
end $$;
revoke all on function private.guard_shared_semantic_receipt_v1(),private.shared_evidence_original_v1(uuid,jsonb,uuid),private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid),public.certify_shared_memory_semantics_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.certify_shared_memory_semantics_v1(uuid,uuid,uuid,jsonb) to service_role;

-- The server-owned contract must change when canonical validators/formatters change.
-- A receipt proves the trusted server attested to these exact bytes; it is not a
-- claim that PostgreSQL executed TypeScript. Source authority is still rechecked.

-- SOURCE: docs/security-drafts/11-generation-discovery.sql
-- INACTIVE fixed owner-only metadata discovery. No arbitrary relation/provider SQL.

create function public.preview_shared_legacy_evidence_v1(p_workspace_id uuid,p_binding_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
 perform private.require_evidence_owner_v1(p_workspace_id);d:=private.resolve_legacy_evidence_v1(p_workspace_id,p_binding_id,p_start,p_end);
 return jsonb_build_object('stage','unadmitted','resolved',jsonb_build_object('identity',jsonb_build_object('kind','legacy_binding','binding_id',p_binding_id,'start',p_start,'end',p_end),'hash',private.evidence_digest_v1(d),'data',d));
end $$;
create function public.discover_shared_evidence_v1(p_workspace_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;n integer;
begin
 perform private.require_evidence_owner_v1(p_workspace_id);
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 then raise exception 'shared_discovery_period_invalid' using errcode='22023';end if;
 with candidates as (
 select b.provider, b.id::text key,jsonb_build_object('kind','legacy_binding','binding_id',b.id,'start',p_start,'end',p_end) identity
 from private.legacy_evidence_bindings b where b.workspace_id=p_workspace_id and b.revoked_at is null
 union all select 'quickbooks_online',s.id::text,jsonb_build_object('kind','qbo_version','source_id',s.id,'version_id',s.current_version_id)
 from private.external_source_records s join private.external_source_record_versions v on v.workspace_id=s.workspace_id and v.id=s.current_version_id and v.source_record_id=s.id
 where s.workspace_id=p_workspace_id and s.provider_key='quickbooks_online' and s.lifecycle_state='active' and v.validation_state='valid'
 and ((v.period_start<=p_end and v.period_end>=p_start) or v.posting_date between p_start and p_end)
 union all select 'square',p.payment_id,jsonb_build_object('kind','square_payment','connection_id',p.connection_id,'payment_id',p.payment_id)
 from square_customer_private.payments p where p.workspace_id=p_workspace_id and p.status='COMPLETED' and p.created_at>=p_start::timestamptz-interval '1 day' and p.created_at<(p_end+2)::timestamptz
 union all select 'google_sheets',r.id::text,jsonb_build_object('kind','sheets_ticket_source','source_id',r.id,'version_id',r.current_version_id)
 from public.google_sheets_source_rows r join public.google_sheets_source_versions v on v.workspace_id=r.workspace_id and v.id=r.current_version_id and v.source_row_id=r.id
 where r.workspace_id=p_workspace_id and r.current and v.validation_state='valid' and v.normalized_projection->>'date' between p_start::text and p_end::text
 and public.google_sheets_record_readable_v1(p_workspace_id,'google_sheets_source_rows',r.id)
 union all select case when c.source_type='business_note' then 'business_note' else 'file' end,c.id::text,
 jsonb_build_object('kind',case when c.source_type='business_note' then 'approved_note' else 'approved_file_fact' end,'chunk_id',c.id)
 from public.business_memory_chunks c where c.workspace_id=p_workspace_id and c.trusted_index and c.deleted_at is null and c.archived_at is null and c.source_type in ('file','file_analysis','business_note')
 and public.google_sheets_record_readable_v1(p_workspace_id,'business_memory_chunks',c.id)
 ), ranked as (select *,row_number() over(partition by provider order by key) ordinal from candidates), bounded as (select * from ranked order by ordinal,provider,key limit 97)
 select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'identity',identity) order by ordinal,provider,key),'[]'),count(*) into rows,n from bounded;
 return jsonb_build_object('stage','catalog_only','candidates',rows,'truncated',n>96);
end $$;
create function public.shared_evidence_dependencies_v1(p_workspace_id uuid,p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ticket jsonb;result uuid[];a uuid;src record;r jsonb;roots jsonb:='[]';
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);ticket:=private.shared_evidence_ticket_v1(p_workspace_id,a,p_ticket_id);
 select coalesce(array_agg(distinct am.manifest_id),'{}'::uuid[]) into result from private.shared_evidence_artifact_manifests am
 join jsonb_array_elements(ticket->'sources') ticket_source on am.artifact_id=private.safe_evidence_uuid_v1(ticket_source->>'id')
 where am.workspace_id=p_workspace_id and am.artifact_kind=case ticket_source->>'table' when 'reports' then 'report' when 'ai_agent_runs' then 'briefing_run' when 'vsi_exchanges' then 'vsi_exchange' when 'vsi_conversations' then 'vsi_conversation_context' end;
 for src in select original_identity from private.shared_evidence_manifest_sources where workspace_id=p_workspace_id and manifest_id=any(result) loop
  r:=private.shared_evidence_original_v1(p_workspace_id,src.original_identity,a);roots:=roots||coalesce(r#>'{data,read_sources}','[]'::jsonb);
 end loop;
 return jsonb_build_object('manifestIds',result,'readSources',roots);
end $$;
-- Stable URLs use immutable target identity. Resolve its immutable saved link,
-- then invoke exact-revision reopening; never substitute a mutable latest row.
create function public.reopen_shared_evidence_target_v1(p_workspace_id uuid,p_artifact_kind text,p_artifact_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare revision text;n integer;
begin
 perform private.require_evidence_owner_v1(p_workspace_id);
 if p_artifact_kind not in ('vsi_exchange','briefing_run') then raise exception 'shared_target_kind_denied' using errcode='42501';end if;
 select count(*),min(artifact_revision) into n,revision from private.shared_evidence_artifact_manifests where workspace_id=p_workspace_id and artifact_kind=p_artifact_kind and artifact_id=p_artifact_id;
 if n<>1 then raise exception 'shared_target_unavailable' using errcode='42501';end if;
 return public.reopen_shared_evidence_artifact_v1(p_workspace_id,p_artifact_kind,p_artifact_id,revision);
end $$;
revoke all on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),public.discover_shared_evidence_v1(uuid,date,date),public.shared_evidence_dependencies_v1(uuid,uuid),public.reopen_shared_evidence_target_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),public.discover_shared_evidence_v1(uuid,date,date),public.shared_evidence_dependencies_v1(uuid,uuid),public.reopen_shared_evidence_target_v1(uuid,text,uuid) to authenticated;

-- SOURCE: docs/security-drafts/12-workspace-writer-fence.sql
-- LOCAL INACTIVE DRAFT ONLY. Known dependency coverage, NOT a verified complete
-- deployed graph. Missing live helpers/writers still block application/activation.
-- Exclusive workspace transaction fence: ordinary writes and final validation use
-- the same key. Contention aborts with 40001; there is no automatic retry here.
-- No fence is held during provider calls. No session/role/privacy control changes.

create function private.shared_evidence_write_fence_v1(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if w is null then raise exception 'shared_evidence_workspace_required' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('shared-evidence-write-v1:'||w::text,0)) then
  raise exception 'shared_evidence_write_conflict' using errcode='40001';
 end if;
end $$;
create function private.shared_evidence_writer_fence_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_workspace uuid;after_workspace uuid;w uuid;
begin
 if tg_nargs<>1 or tg_argv[0] not in ('id','workspace_id') then raise exception 'shared_evidence_fence_configuration_invalid' using errcode='42501';end if;
 if tg_op<>'INSERT' then
  if tg_argv[0]='id' then before_workspace:=old.id;else before_workspace:=old.workspace_id;end if;
  if before_workspace is null then raise exception 'shared_evidence_workspace_required' using errcode='42501';end if;end if;
 if tg_op<>'DELETE' then
  if tg_argv[0]='id' then after_workspace:=new.id;else after_workspace:=new.workspace_id;end if;
  if after_workspace is null then raise exception 'shared_evidence_workspace_required' using errcode='42501';end if;end if;
 for w in select distinct value from unnest(array[before_workspace,after_workspace]) value where value is not null order by value loop
  perform private.shared_evidence_write_fence_v1(w);
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create function private.shared_evidence_truncate_denied_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin raise exception 'shared_evidence_truncate_denied' using errcode='42501';end $$;
revoke all on function private.shared_evidence_write_fence_v1(uuid),private.shared_evidence_writer_fence_v1(),private.shared_evidence_truncate_denied_v1() from public,anon,authenticated,service_role;
create or replace function private.validate_shared_evidence_manifest_v1(w uuid,m uuid,k text,i uuid,attempt integer,a uuid,s uuid) returns void
language plpgsql security definer set search_path='' as $$
declare manifest private.shared_evidence_manifests;target jsonb;ticket jsonb;src record;resolved jsonb;projections jsonb:='[]';
begin
 perform private.require_shared_evidence_actor_v1(w,a,s);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'shared_evidence_isolation_unsupported' using errcode='40001';end if;
 perform private.shared_evidence_write_fence_v1(w);
 select * into manifest from private.shared_evidence_manifests where id=m and workspace_id=w;
 if not found or manifest.actor_id<>a or manifest.session_id<>s or manifest.target_kind<>k or manifest.target_id<>i or manifest.attempt<>attempt then raise exception 'shared_evidence_manifest_denied' using errcode='42501';end if;
 target:=private.shared_evidence_target_v1(w,a,k,i,attempt,manifest.google_sheets_read_ticket_id);
 ticket:=private.shared_evidence_ticket_v1(w,a,manifest.google_sheets_read_ticket_id);
 if private.evidence_digest_v1(jsonb_build_array(target,ticket))<>manifest.input_hash then raise exception 'shared_evidence_input_changed' using errcode='40001';end if;
 for src in select * from private.shared_evidence_manifest_sources where workspace_id=w and manifest_id=m order by ordinal loop
  resolved:=private.shared_evidence_original_v1(w,src.original_identity,a);
  if resolved->>'hash'<>src.authority_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
  projections:=projections||jsonb_build_array(resolved);
 end loop;
 if private.evidence_digest_v1(projections)<>manifest.manifest_hash then raise exception 'shared_evidence_manifest_changed' using errcode='40001';end if;
end $$;

create or replace function public.confirm_legacy_evidence_mapping_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid,p_business_entity_id uuid,p_expected_incarnation_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_state jsonb; v_id uuid;
begin
  v_actor := private.require_evidence_owner_v1(p_workspace_id);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'shared_evidence_isolation_unsupported' using errcode='40001';end if;
  perform private.shared_evidence_write_fence_v1(p_workspace_id);
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

-- Preserve another owner's Sheets approval authority through final resolution.
create or replace function private.shared_evidence_typed_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare data jsonb;identity jsonb;h text;s record;metrics jsonb;roots jsonb;
begin
 if j->>'kind'<>'sheets_ticket_source' then return private.shared_evidence_typed_before_sheets_v1(w,a,j);end if;
 if j-array['kind','source_id','version_id','authority_hash']<>'{}'::jsonb then raise exception 'shared_typed_identity_invalid' using errcode='22023';end if;
 select r.id,r.current_version_id,r.business_entity_id,r.connection_id,v.normalized_projection,v.source_fingerprint,
  c.generation,c.active_approval_id,c.last_sync_at,e.timezone,c.field_mapping into s
 from public.google_sheets_source_rows r
 join public.google_sheets_source_versions v on v.workspace_id=r.workspace_id and v.connection_id=r.connection_id and v.source_row_id=r.id and v.id=r.current_version_id and v.validation_state='valid'
 join public.google_sheets_connections c on c.workspace_id=r.workspace_id and c.id=r.connection_id and c.business_entity_id=r.business_entity_id
 join public.business_entities e on e.workspace_id=r.workspace_id and e.id=r.business_entity_id and e.status='active'
 join public.google_sheets_mapping_approvals m on m.workspace_id=c.workspace_id and m.connection_id=c.id and m.id=c.active_approval_id
 join public.workspace_members member on member.workspace_id=c.workspace_id and member.user_id=m.approved_by and member.status='active' and member.role='owner'
 join auth.users approver on approver.id=member.user_id and approver.deleted_at is null and (approver.banned_until is null or approver.banned_until<=clock_timestamp())
 where r.workspace_id=w and r.id=private.safe_evidence_uuid_v1(j->>'source_id') and r.current
  and c.status='connected' and not c.authorization_uncertain and not c.revocation_pending
  and m.field_mapping=c.field_mapping and m.headers=c.headers and m.spreadsheet_id=c.spreadsheet_id and m.sheet_id=c.sheet_id and m.header_row=c.header_row
  and exists(select 1 from pg_timezone_names where name=e.timezone)
  and public.google_sheets_record_readable_v1(w,'google_sheets_source_rows',r.id)
 for share of approver nowait;
 if not found or (j ? 'version_id' and j->>'version_id' is distinct from s.current_version_id::text) then raise exception 'shared_typed_sheets_denied' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('metric',metric->>'name','value',metric->>'value','unit',metric->>'unit') order by f.metric_column),
  jsonb_agg(jsonb_build_object('table','kpis','id',k.id) order by f.metric_column) into metrics,roots
 from public.google_sheets_fact_links f join public.kpis k on k.workspace_id=f.workspace_id and k.id=f.kpi_id
 cross join lateral jsonb_array_elements(s.normalized_projection->'metrics') metric
 where f.workspace_id=w and f.connection_id=s.connection_id and f.source_row_id=s.id and f.source_version_id=s.current_version_id
  and f.approval_id=s.active_approval_id and f.admission_state='accepted' and k.deleted_at is null and k.archived_at is null
  and metric->>'column'=f.metric_column::text and k.actual_value::numeric=(metric->>'value')::numeric and k.metric_date::text=s.normalized_projection->>'date'
  and public.google_sheets_record_readable_v1(w,'kpis',k.id)
  -- Same operational-overlap exclusion used by the existing KPI loader.
  and not exists(select 1 from public.operational_metrics o where o.workspace_id=w and o.metric_date=k.metric_date and o.value is not null
   and o.archived_at is null and o.deleted_at is null and private.google_sheets_operational_source_current_v1(o.workspace_id,o.source_file_id,o.import_id)
   and lower(regexp_replace(o.metric_name,'[^[:alnum:]]','','g')) in (lower(regexp_replace(k.name,'[^[:alnum:]]','','g')),lower(regexp_replace(k.raw_data_json#>>'{googleSheets,metricName}','[^[:alnum:]]','','g'))));
 if metrics is null then raise exception 'shared_typed_sheets_no_admitted_metrics' using errcode='42501';end if;
 roots:=roots||jsonb_build_array(jsonb_build_object('table','google_sheets_connections','id',s.connection_id));
 data:=jsonb_build_object('provider','google_sheets','workspace_id',w,'entity_id',s.business_entity_id,'connection_id',s.connection_id,
  'generation',s.generation,'source_id',s.id,'version_id',s.current_version_id,'approval_id',s.active_approval_id,'source_fingerprint',s.source_fingerprint,
  'date',s.normalized_projection->>'date','location',s.normalized_projection->>'location','time_zone',s.timezone,'observed_at',s.last_sync_at,
  'metrics',metrics,'coverage','unknown','currency',null,'read_sources',roots);
 h:=private.evidence_digest_v1(data);identity:=jsonb_build_object('kind','sheets_ticket_source','source_id',s.id,'version_id',s.current_version_id,'authority_hash',h);
 return jsonb_build_object('identity',identity,'hash',h,'data',data);
exception when lock_not_available then raise exception 'shared_evidence_authority_conflict' using errcode='40001';
end $$;

-- Closed installation set. Missing table or UUID workspace column aborts the
-- entire draft, never silently skips an unprotected dependency. Installation
-- must be qualified against actual trigger ordering and source writers.
do $$
declare relation_name text;relation_id regclass;workspace_column text;
begin
 foreach relation_name in array array[
  'private.derived_evidence_audiences',
  'private.external_source_record_versions',
  'private.external_source_records',
  'private.file_import_attempts',
  'private.google_sheets_connection_root_links',
  'private.google_sheets_derivation_roots',
  'private.google_sheets_privacy_epochs',
  'private.google_sheets_read_tickets',
  'private.google_sheets_retention_roots',
  'private.google_sheets_source_root_links',
  'private.integration_connections',
  'private.katana_evidence_installations',
  'private.legacy_evidence_bindings',
  'private.legacy_evidence_references',
  'private.provider_entity_mappings',
  'private.qbo_production_source_validation_work',
  'private.shared_evidence_artifact_manifests',
  'private.shared_evidence_commit_claims',
  'private.shared_evidence_manifest_sources',
  'private.shared_evidence_manifests',
  'private.shared_memory_semantic_receipts',
  'public.ai_agent_runs',
  'public.business_entities',
  'public.business_health_snapshots',
  'public.intelligence_card_lifecycle',
  'public.intelligence_card_lifecycle_events',
  'public.file_processing_jobs',
  'public.kpi_settings',
  'public.business_memory_chunks',
  'public.business_notes',
  'public.document_extraction_cache',
  'public.document_extraction_file_bindings',
  'public.document_extraction_jobs',
  'public.document_extraction_reviews',
  'public.document_extraction_workspace_settings',
  'public.file_imports',
  'public.file_uploads',
  'public.google_sheets_connections',
  'public.google_sheets_fact_links',
  'public.google_sheets_mapping_approvals',
  'public.google_sheets_source_rows',
  'public.google_sheets_source_versions',
  'public.kpis',
  'public.loyverse_connections',
  'public.loyverse_import_days',
  'public.loyverse_receipt_facts',
  'public.operational_metrics',
  'public.reporting_connections',
  'public.reporting_history_days',
  'public.reporting_history_facts',
  'public.reports',
  'public.vsi_conversations',
  'public.vsi_exchanges',
  'public.vsi_requests',
  'public.wix_order_connections',
  'public.wix_order_facts',
  'public.wix_order_import_days',
  'public.workspace_members',
  'public.workspaces',
  'public.zoho_books_connections',
  'public.zoho_books_history_coverage',
  'public.zoho_books_history_facts',
  'square_customer_private.connections',
  'square_customer_private.payments'
 ] loop
  relation_id:=to_regclass(relation_name);workspace_column:=case when relation_name='public.workspaces' then 'id' else 'workspace_id' end;
  if relation_id is null or not exists(select 1 from pg_attribute where attrelid=relation_id and attname=workspace_column and atttypid='uuid'::regtype and not attisdropped) then
   raise exception 'shared_evidence_fence_dependency_missing: %',relation_name using errcode='42501';
  end if;
  execute format('create trigger aaa_shared_evidence_writer_fence before insert or update or delete on %s for each row execute function private.shared_evidence_writer_fence_v1(%L)',relation_id,workspace_column);
  execute format('create trigger shared_evidence_no_truncate before truncate on %s for each statement execute function private.shared_evidence_truncate_denied_v1()',relation_id);
 end loop;
end $$;

-- SOURCE: docs/security-drafts/13-vsi-failure-accounting.sql
-- INACTIVE LOCAL DRAFT. Separate accounting activation remains disabled.
-- No deployment/activation authorization. Does not change any existing wrapper,
-- EXECUTE grant, transcript policy, privacy/readability check or source eligibility.
-- Bookkeeping only: token/model telemetry is intentionally omitted from this
-- fixed event. NULL provider_calls means unknown, never an invented zero.

create function public.fail_vsi_request_accounting_v1(
 p_workspace_id uuid,p_actor_user_id uuid,p_session_id uuid,
 p_conversation_id uuid,p_request_id uuid,p_attempt integer,
 p_cost_usd numeric,p_provider_calls integer,p_cost_estimated boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_role text;conversation_role text;request_status text;request_attempt integer;
 request_started_at timestamptz;usage_value jsonb;prior_event public.vsi_cost_events;updated_rows integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'vsi_failure_server_only' using errcode='42501';end if;
 -- Privacy and authority rechecks after waits must see committed changes.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'vsi_failure_isolation_unsupported' using errcode='40001';end if;
 if p_workspace_id is null or p_actor_user_id is null or p_session_id is null
  or p_conversation_id is null or p_request_id is null or p_attempt is null or p_attempt<1
  or p_cost_usd is null or p_cost_usd::text in ('NaN','Infinity','-Infinity')
  or p_cost_usd<0 or p_cost_usd>10 or p_cost_usd<>round(p_cost_usd,8)
  or (p_provider_calls is not null and (p_provider_calls<0 or p_provider_calls>1000))
  or p_cost_estimated is null then
  raise exception 'vsi_failure_input_invalid' using errcode='22023';end if;
 -- Match v2 authority and lock order. No owner/admin exemption is introduced.
 perform private.require_live_actor_session_v1(p_workspace_id,p_actor_user_id,p_session_id,
  array['owner','admin','manager','staff','viewer']);
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 perform pg_advisory_xact_lock(hashtextextended('vsi-actor:'||p_actor_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('vsi-workspace:'||p_workspace_id::text,0));
 select role::text into v_actor_role from public.workspace_members
  where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' for share;
 if not found then raise exception 'vsi_failure_access_denied' using errcode='42501';end if;
 if not private.workspace_billing_entitled_v1(p_workspace_id)
  and not exists(select 1 from private.platform_admin_subscription_exemptions where user_id=p_actor_user_id) then
  raise exception 'vsi_subscription_required' using errcode='42501';end if;
 -- Only identity/role is selected, never title, summary or transcript contents.
 select actor_role into conversation_role from public.vsi_conversations
  where id=p_conversation_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id for update;
 if not found or conversation_role is distinct from v_actor_role then
  raise exception 'vsi_failure_conversation_denied' using errcode='42501';end if;
 select status,attempt,started_at into request_status,request_attempt,request_started_at from public.vsi_requests
  where id=p_request_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id
   and conversation_id=p_conversation_id for update;
 if not found then raise exception 'vsi_failure_request_denied' using errcode='42501';end if;
 if request_attempt<>p_attempt then raise exception 'vsi_failure_stale_attempt' using errcode='40001';end if;
 -- A competing successful settlement is never overwritten, even if inconsistent
 -- request status were observed. The existence check reads no output contents.
 if request_status='completed' or exists(select 1 from public.vsi_exchanges where id=p_request_id) then
  raise exception 'vsi_failure_already_completed' using errcode='40001';end if;
 usage_value:=jsonb_build_object('accountingContract','vsi_failure_accounting_v1',
  'failed',true,'estimatedCostUsd',p_cost_usd,'providerCalls',p_provider_calls,'costEstimated',p_cost_estimated);
 select * into prior_event from public.vsi_cost_events where request_id=p_request_id and attempt=p_attempt;
 if request_status='failed' then
  if prior_event.id is not null and prior_event.workspace_id=p_workspace_id and prior_event.actor_user_id=p_actor_user_id
   and prior_event.occurred_at=request_started_at and prior_event.cost_usd=p_cost_usd and prior_event.usage_json=usage_value then
   return jsonb_build_object('state','already_failed');end if;
  raise exception 'vsi_failure_accounting_conflict' using errcode='40001';
 end if;
 if request_status is distinct from 'pending' or prior_event.id is not null then
  raise exception 'vsi_failure_accounting_conflict' using errcode='40001';end if;
 insert into public.vsi_cost_events(request_id,workspace_id,actor_user_id,attempt,occurred_at,cost_usd,usage_json)
  values(p_request_id,p_workspace_id,p_actor_user_id,p_attempt,request_started_at,p_cost_usd,usage_value);
 update public.vsi_requests set status='failed',accepted_at=null,cost_usd=cost_usd+p_cost_usd,
  reservation_usd=0,lease_until=null,usage_json=usage_json||jsonb_build_array(usage_value)
  where id=p_request_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id
   and conversation_id=p_conversation_id and attempt=p_attempt and status='pending';
 get diagnostics updated_rows=row_count;
 if updated_rows<>1 then raise exception 'vsi_failure_request_changed' using errcode='40001';end if;
 return jsonb_build_object('state','failed');
end $$;
revoke all on function public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean) to service_role;

commit;
