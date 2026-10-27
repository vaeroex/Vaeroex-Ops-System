-- INACTIVE fixed owner-only metadata discovery. No arbitrary relation/provider SQL.
begin;
create function public.preview_shared_legacy_evidence_v1(p_workspace_id uuid,p_binding_id uuid,p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
 perform private.require_evidence_owner_v1(p_workspace_id);d:=private.resolve_legacy_evidence_v1(p_workspace_id,p_binding_id,p_start,p_end);
 return jsonb_build_object('stage','unadmitted','resolved',jsonb_build_object('identity',jsonb_build_object('kind','legacy_binding','binding_id',p_binding_id,'start',p_start,'end',p_end),'hash',private.evidence_digest_v1(d),'data',d));
end $$;
-- v2 preference is a bounded ranking hint only. Every candidate still requires
-- the same protected preview/read and later immutable manifest admission.
create function public.discover_shared_evidence_v2(p_workspace_id uuid,p_start date,p_end date,p_preferred_providers text[]) returns jsonb
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
-- Preserve existing callers and its original result fields; no new authority.
create function public.discover_shared_evidence_v1(p_workspace_id uuid,p_start date,p_end date) returns jsonb
language sql security definer set search_path='' as $$
 select public.discover_shared_evidence_v2(p_workspace_id,p_start,p_end,'{}'::text[])-'totalCandidates'-'providerCounts';
$$;
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
revoke all on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),public.discover_shared_evidence_v1(uuid,date,date),public.discover_shared_evidence_v2(uuid,date,date,text[]),public.shared_evidence_dependencies_v1(uuid,uuid),public.reopen_shared_evidence_target_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),public.discover_shared_evidence_v1(uuid,date,date),public.discover_shared_evidence_v2(uuid,date,date,text[]),public.shared_evidence_dependencies_v1(uuid,uuid),public.reopen_shared_evidence_target_v1(uuid,text,uuid) to authenticated;
commit;
