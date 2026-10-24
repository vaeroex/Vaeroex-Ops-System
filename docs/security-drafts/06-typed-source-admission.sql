-- INACTIVE LOCAL DRAFT. No runtime activation. Requires 01/02/03/05.
-- Fixed stored-source dispatch only; no provider calls or arbitrary relations.
-- Writer interlocks/full deployed trigger composition remain release blockers.
begin;
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
commit;
