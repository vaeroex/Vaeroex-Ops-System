-- LOCAL INACTIVE DRAFT ONLY. Known dependency coverage, NOT a verified complete
-- deployed graph. Missing live helpers/writers still block application/activation.
-- Exclusive workspace transaction fence: ordinary writes and final validation use
-- the same key. Contention aborts with 40001; there is no automatic retry here.
-- No fence is held during provider calls. No session/role/privacy control changes.
begin;
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
commit;
