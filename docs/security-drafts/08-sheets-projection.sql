-- INACTIVE LOCAL DRAFT. Live comparison of the conflict predicate was denied;
-- repository contract only until approved deployed metadata qualification.
begin;
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
commit;
