-- INACTIVE incremental mapping upgrade. Not executed by this assembler.
-- Existing protected evidence schema must already be installed. No bootstrap replay.
-- No table/data/source/credential updates, no change to runtime switches.
-- Loyverse's newly projected currency changes its content hash; old references fail closed as changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function private.resolve_legacy_evidence_v1(p_workspace_id uuid,p_binding_id uuid,p_start date,p_end date) returns jsonb
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

create or replace function public.discover_shared_evidence_v2(p_workspace_id uuid,p_start date,p_end date,p_preferred_providers text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;n bigint;counts jsonb;
begin
 perform private.require_evidence_owner_v1(p_workspace_id);
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 then raise exception 'shared_discovery_period_invalid' using errcode='22023';end if;
 if p_preferred_providers is null or cardinality(p_preferred_providers)>12
 or exists(select 1 from unnest(p_preferred_providers) p where p is null or p not in ('google_sheets','quickbooks_online','square','loyverse','zoho-books','wix-orders','xero','harvest','clockify','toggl','zoho-inventory','katana'))
 or (select count(distinct p) from unnest(p_preferred_providers) p)<>cardinality(p_preferred_providers)
 then raise exception 'shared_discovery_preference_invalid' using errcode='22023';end if;
 with candidates as (
 select b.provider, b.id::text key,jsonb_build_object('kind','legacy_binding','binding_id',b.id,'start',p_start,'end',p_end) identity,null::date evidence_date
 from private.legacy_evidence_bindings b where b.workspace_id=p_workspace_id and b.revoked_at is null
 union all select 'quickbooks_online',s.id::text,jsonb_build_object('kind','qbo_version','source_id',s.id,'version_id',s.current_version_id),coalesce(v.posting_date,v.period_end)
 from private.external_source_records s join private.external_source_record_versions v on v.workspace_id=s.workspace_id and v.id=s.current_version_id and v.source_record_id=s.id
 where s.workspace_id=p_workspace_id and s.provider_key='quickbooks_online' and s.lifecycle_state='active' and v.validation_state='valid'
 and ((v.period_start<=p_end and v.period_end>=p_start) or v.posting_date between p_start and p_end)
 union all select 'square',p.payment_id,jsonb_build_object('kind','square_payment','connection_id',p.connection_id,'payment_id',p.payment_id),(p.created_at at time zone 'UTC')::date
 from square_customer_private.payments p where p.workspace_id=p_workspace_id and p.status='COMPLETED' and p.created_at>=p_start::timestamptz-interval '1 day' and p.created_at<(p_end+2)::timestamptz
 union all select 'google_sheets',r.id::text,jsonb_build_object('kind','sheets_ticket_source','source_id',r.id,'version_id',r.current_version_id),(v.normalized_projection->>'date')::date
 from public.google_sheets_source_rows r join public.google_sheets_source_versions v on v.workspace_id=r.workspace_id and v.id=r.current_version_id and v.source_row_id=r.id
 where r.workspace_id=p_workspace_id and r.current and v.validation_state='valid' and v.normalized_projection->>'date' between p_start::text and p_end::text
 and public.google_sheets_record_readable_v1(p_workspace_id,'google_sheets_source_rows',r.id)
 union all select case when c.source_type='business_note' then 'business_note' else 'file' end,c.id::text,
 jsonb_build_object('kind',case when c.source_type='business_note' then 'approved_note' else 'approved_file_fact' end,'chunk_id',c.id),null::date
 from public.business_memory_chunks c where c.workspace_id=p_workspace_id and c.trusted_index and c.deleted_at is null and c.archived_at is null and c.source_type in ('file','file_analysis','business_note')
 and public.google_sheets_record_readable_v1(p_workspace_id,'business_memory_chunks',c.id)
 ), ranked as (
 select *,case when provider=any(p_preferred_providers) then 0 else 1 end priority,
 row_number() over(partition by provider order by evidence_date desc nulls last,key) ordinal from candidates
 ), bounded as (select * from ranked order by priority,ordinal,provider,key limit 96), counted as (
 select provider,count(*) total,(select count(*) from bounded b where b.provider=c.provider) returned from candidates c group by provider
 )
 select (select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'identity',identity) order by priority,ordinal,provider,key),'[]') from bounded),
 (select count(*) from candidates),
 (select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'total',total,'returned',returned) order by provider),'[]') from counted) into rows,n,counts;
 return jsonb_build_object('stage','catalog_only','candidates',rows,'truncated',n>jsonb_array_length(rows),'totalCandidates',n,'providerCounts',counts);
end $$;

create or replace function public.discover_shared_evidence_v1(p_workspace_id uuid,p_start date,p_end date) returns jsonb
language sql security definer set search_path='' as $$
 select public.discover_shared_evidence_v2(p_workspace_id,p_start,p_end,'{}'::text[])-'totalCandidates'-'providerCounts';
$$;

-- Same owner-only authority inside the new RPC; no PUBLIC/anon/service access.
revoke all on function public.discover_shared_evidence_v2(uuid,date,date,text[]) from public,anon,authenticated,service_role;
grant execute on function public.discover_shared_evidence_v2(uuid,date,date,text[]) to authenticated;
commit;
