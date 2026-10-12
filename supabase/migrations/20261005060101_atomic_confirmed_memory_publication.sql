begin;

-- Confirmed file-analysis publication is one transaction. SECURITY INVOKER
-- preserves existing tenant, contributor, subscription and extraction guards.
-- No old chunk is deleted or relabelled: every new run has its own content key.
create function public.publish_confirmed_file_memory_v1(
  p_workspace_id uuid, p_file_id uuid, p_run_id uuid, p_confirmed_by uuid,
  p_chunks jsonb, p_summary text, p_embedding_error text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  f public.file_uploads;
  r public.ai_agent_runs;
  item jsonb;
  chunk public.business_memory_chunks;
  ids uuid[] := array[]::uuid[];
  inserted_id uuid;
  fingerprint text;
  published_at timestamptz;
  receipt jsonb;
  ordinal integer := 0;
  expected_count integer;
begin
  if auth.uid() is null or p_confirmed_by is distinct from auth.uid()
    or not public.can_edit_operations(p_workspace_id) then
    raise exception 'Confirmed publication requires an active workspace operator.' using errcode='42501';
  end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception 'Invalid publication chunks.' using errcode='22023';
  end if;
  expected_count := jsonb_array_length(p_chunks);
  if expected_count not between 1 and 80 or p_summary is null or length(p_summary)>4000 then
    raise exception 'Invalid publication size.' using errcode='22023';
  end if;
  -- All participating approvals serialize here, including an ambiguous-response
  -- retry. A stale REPEATABLE READ snapshot fails rather than replacing a winner.
  select * into f from public.file_uploads
    where id=p_file_id and workspace_id=p_workspace_id for update;
  if not found or f.archived_at is not null or f.deleted_at is not null then
    raise exception 'The source is unavailable.' using errcode='42501';
  end if;
  if f.processing_status='processing' then
    raise exception 'This source is still processing. Reload after it finishes before confirming.' using errcode='40001';
  end if;
  if f.metadata_json->>'latest_analysis_run_id' is distinct from p_run_id::text then
    raise exception 'This analysis is no longer current. Reload and review the current analysis.' using errcode='40001';
  end if;
  select * into r from public.ai_agent_runs
    where id=p_run_id and workspace_id=p_workspace_id for share;
  if not found or r.agent_type<>'file_analysis' or r.status<>'completed'
    or r.archived_at is not null or r.deleted_at is not null
    or coalesce(r.input_json#>>'{evidence_lineage,source_file_id}',r.input_json#>>'{extra_inputs,file,id}') is distinct from p_file_id::text
    or r.output_json->>'evidence_classification' is distinct from 'business_evidence'
    or r.output_json->>'extraction_outcome' is distinct from 'facts_extracted' then
    raise exception 'The confirmed source analysis is unavailable or ineligible.' using errcode='42501';
  end if;
  published_at := clock_timestamp();
  -- The receipt excludes variable embedding responses so a lost acknowledgement
  -- can be reconciled without changing the committed content or citation IDs.
  select encode(sha256(convert_to(jsonb_build_object('run',p_run_id,'summary',p_summary,
    'chunks',jsonb_agg(value->>'source_excerpt' order by ordinality))::text,'UTF8')),'hex')
    into fingerprint from jsonb_array_elements(p_chunks) with ordinality;
  receipt := f.metadata_json->'business_memory';
  if receipt->>'publication_version'='file_analysis_v2' and receipt->>'run_id'=p_run_id::text then
    if receipt->>'publication_fingerprint' is distinct from fingerprint then
      raise exception 'This analysis was already confirmed with different content. Reload before changing it.' using errcode='40001';
    end if;
    select array_agg(b.id order by b.chunk_index) into ids from public.business_memory_chunks b
      where b.workspace_id=p_workspace_id and b.source_type='file_analysis' and b.source_file_id=p_file_id
      and b.source_metadata->>'publication_fingerprint'=fingerprint
      and b.source_metadata->>'run_id'=p_run_id::text and b.archived_at is null and b.deleted_at is null;
    if coalesce(cardinality(ids),0)<>expected_count then
      raise exception 'Published memory lifecycle has changed. Reload before confirming again.' using errcode='40001';
    end if;
    return jsonb_build_object('indexed_chunks',expected_count,'chunk_ids',ids,'replayed',true);
  end if;
  for item in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'source_excerpt') is distinct from 'string'
      or length(item->>'source_excerpt') not between 81 and 1400 then
      raise exception 'Invalid publication chunk.' using errcode='22023';
    end if;
    -- Populate only the existing typed value columns. The caller cannot supply
    -- a tenant, source, citation ID, timestamp, lifecycle or approval identity.
    chunk := jsonb_populate_record(null::public.business_memory_chunks,item);
    insert into public.business_memory_chunks(
      workspace_id,source_type,source_id,source_file_id,source_title,source_excerpt,summary,chunk_index,content_hash,
      embedding,embedding_model,source_metadata,source_quality,confidence_score,token_estimate,indexed_at,updated_at
    ) values (
      p_workspace_id,'file_analysis',p_file_id,p_file_id,f.display_name,chunk.source_excerpt,p_summary,ordinal,
      encode(sha256(convert_to(p_file_id::text||':'||p_run_id::text||':'||ordinal::text||':'||chunk.source_excerpt,'UTF8')),'hex'),
      chunk.embedding,chunk.embedding_model,coalesce(chunk.source_metadata,'{}'::jsonb)||jsonb_build_object(
        'run_id',p_run_id,'source_run_id',p_run_id,'source_file_id',p_file_id,
        'source_record_type','file_upload','source_record_id',p_file_id,
        'evidence_classification','business_evidence','extraction_outcome','facts_extracted',
        'publication_version','file_analysis_v2','publication_fingerprint',fingerprint,
        'approved_by',p_confirmed_by,'approved_at',published_at),
      chunk.source_quality,chunk.confidence_score,chunk.token_estimate,published_at,published_at
    ) returning id into inserted_id;
    ids := array_append(ids,inserted_id);
    ordinal := ordinal+1;
  end loop;
  -- Server-side retirement has no PostgREST response/page limit. Source and run
  -- guards still apply to every changed row; any error rolls everything back.
  update public.business_memory_chunks set archived_at=published_at,updated_at=published_at
    where workspace_id=p_workspace_id and source_type='file_analysis' and source_file_id=p_file_id
      and archived_at is null and deleted_at is null and not(id=any(ids));
  update public.file_uploads set index_status='ready',index_error=p_embedding_error,indexed_at=published_at,
    indexed_chunk_count=expected_count,processing_status='ready',processing_error=null,processed_at=published_at,
    metadata_json=f.metadata_json||jsonb_build_object(
      'latest_analysis_status','approved','analysis_review_status','approved','business_memory_trust_level','trusted',
      'analysis_review_updated_at',published_at,'analysis_approved_at',published_at,'analysis_approved_by',p_confirmed_by,
      'business_memory',jsonb_build_object('saved',true,'saved_at',published_at,'saved_by',p_confirmed_by,
        'source','file_analysis_approval','source_file_id',p_file_id,'source_file_name',f.display_name,
        'run_id',p_run_id,'summary',p_summary,'indexed_chunk_count',expected_count,
        'publication_version','file_analysis_v2','publication_fingerprint',fingerprint))
    where id=p_file_id and workspace_id=p_workspace_id;
  if not found then raise exception 'Publication completion was denied.' using errcode='42501'; end if;
  insert into public.file_processing_jobs(workspace_id,file_upload_id,job_type,status,attempts,started_at,completed_at,created_by,error_message,metadata_json)
    values(p_workspace_id,p_file_id,'index','completed',1,published_at,published_at,p_confirmed_by,p_embedding_error,
      jsonb_build_object('source','file_analysis','run_id',p_run_id,'chunk_count',expected_count,'publication_version','file_analysis_v2'));
  return jsonb_build_object('indexed_chunks',expected_count,'chunk_ids',ids,'replayed',false);
end;
$$;
revoke all on function public.publish_confirmed_file_memory_v1(uuid,uuid,uuid,uuid,jsonb,text,text) from public,anon,service_role;
grant execute on function public.publish_confirmed_file_memory_v1(uuid,uuid,uuid,uuid,jsonb,text,text) to authenticated;

commit;
