begin;

-- A completed receipt, not an import status or a client metadata field, selects
-- current worksheet evidence. Older chunks remain readable historical records.
create index file_import_attempts_completed_head_idx
  on private.file_import_attempts(workspace_id,file_id,completed_at desc,accepted_at desc,id desc)
  where status='completed' and completed_at is not null;

create function public.get_worksheet_publication_heads_v1(p_workspace_id uuid,p_file_ids uuid[])
returns table(file_id uuid,completed_attempt_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce((select auth.role()),'')<>'service_role' and public.is_workspace_member(p_workspace_id) is not true then
    raise exception 'Worksheet publication authority requires workspace access.' using errcode='42501';
  end if;
  if p_file_ids is null or cardinality(p_file_ids)>200 then
    raise exception 'At most 200 requested source files are supported.' using errcode='22023';
  end if;
  -- One row per distinct existing same-tenant requested file, even when no
  -- durable publication has completed. The bound stays below API row caps.
  return query
    select f.id,a.id
    from (select distinct unnest(p_file_ids) id) requested
    join public.file_uploads f on f.id=requested.id and f.workspace_id=p_workspace_id
    left join lateral (
      select receipt.id from private.file_import_attempts receipt
      where receipt.workspace_id=p_workspace_id and receipt.file_id=f.id
        and receipt.status='completed' and receipt.completed_at is not null
      order by receipt.completed_at desc,receipt.accepted_at desc,receipt.id desc limit 1
    ) a on true;
end;
$$;
revoke all on function public.get_worksheet_publication_heads_v1(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_worksheet_publication_heads_v1(uuid,uuid[]) to authenticated,service_role;

create or replace function public.match_business_memory_chunks(
  target_workspace_id uuid,
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  min_similarity double precision default 0.1
)
returns table (
  id uuid,
  workspace_id uuid,
  source_type text,
  source_id uuid,
  source_file_id uuid,
  source_title text,
  source_excerpt text,
  summary text,
  chunk_index integer,
  source_metadata jsonb,
  source_quality text,
  confidence_score integer,
  indexed_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with eligible_chunks as (
    select
      bmc.*,
      case
        when coalesce(
          bmc.source_metadata ->> 'source_run_id',
          bmc.source_metadata ->> 'run_id',
          bmc.source_metadata #>> '{metadata,analysis_run_id}',
          bmc.source_metadata #>> '{metadata,run_id}'
        ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then coalesce(
          bmc.source_metadata ->> 'source_run_id',
          bmc.source_metadata ->> 'run_id',
          bmc.source_metadata #>> '{metadata,analysis_run_id}',
          bmc.source_metadata #>> '{metadata,run_id}'
        )::uuid
        else null
      end as source_run_id
    from public.business_memory_chunks bmc
    where bmc.workspace_id = target_workspace_id
      and bmc.embedding is not null
      and bmc.deleted_at is null
      and bmc.archived_at is null
      and coalesce(
        bmc.source_metadata ->> 'evidence_classification',
        bmc.source_metadata #>> '{metadata,evidence_classification}',
        'business_evidence'
      ) = 'business_evidence'
      and coalesce(
        bmc.source_metadata ->> 'extraction_outcome',
        bmc.source_metadata #>> '{metadata,extraction_outcome}',
        'facts_extracted'
      ) in ('facts_extracted', 'completed')
      and coalesce(
        bmc.source_metadata ->> 'invalidated_at',
        bmc.source_metadata #>> '{metadata,invalidated_at}'
      ) is null
      and coalesce(
        bmc.source_metadata ->> 'invalidation_reason',
        bmc.source_metadata #>> '{metadata,invalidation_reason}'
      ) is null
  )
  select
    bmc.id,
    bmc.workspace_id,
    bmc.source_type,
    bmc.source_id,
    bmc.source_file_id,
    bmc.source_title,
    bmc.source_excerpt,
    bmc.summary,
    bmc.chunk_index,
    bmc.source_metadata,
    bmc.source_quality,
    bmc.confidence_score,
    bmc.indexed_at,
    1 - (bmc.embedding <=> query_embedding) as similarity
  from eligible_chunks bmc
  left join public.file_uploads source_file
    on source_file.workspace_id = bmc.workspace_id
   and source_file.id = coalesce(bmc.source_file_id, case when bmc.source_type in ('file', 'file_analysis') then bmc.source_id end)
  left join public.ai_agent_runs source_run
    on source_run.workspace_id = bmc.workspace_id
   and source_run.id = bmc.source_run_id
  where public.is_workspace_member(bmc.workspace_id)
    -- Apply committed worksheet generation authority before rank/limit. This
    -- predicate does not change direct historical row or citation visibility.
    and (
      bmc.source_metadata->>'indexing_method' is distinct from 'worksheet_import'
      or exists (
        select 1 from public.get_worksheet_publication_heads_v1(
          bmc.workspace_id, array[coalesce(bmc.source_file_id,bmc.source_id)]
        ) h where case when h.completed_attempt_id is null
          then nullif(bmc.source_metadata->>'import_attempt_id','') is null
          else bmc.source_metadata->>'import_attempt_id'=h.completed_attempt_id::text end
      )
    )
    and 1 - (bmc.embedding <=> query_embedding) >= min_similarity
    and (
      bmc.source_type not in ('file', 'file_analysis') and bmc.source_file_id is null
      or (
        source_file.id is not null
        and source_file.deleted_at is null
        and source_file.archived_at is null
        and coalesce(
          source_file.metadata_json ->> 'evidence_classification',
          source_file.metadata_json #>> '{metadata,evidence_classification}',
          'business_evidence'
        ) = 'business_evidence'
        and coalesce(
          source_file.metadata_json ->> 'invalidated_at',
          source_file.metadata_json #>> '{metadata,invalidated_at}'
        ) is null
        and coalesce(
          source_file.metadata_json ->> 'invalidation_reason',
          source_file.metadata_json #>> '{metadata,invalidation_reason}'
        ) is null
      )
    )
    and (
      bmc.source_type <> 'file_analysis'
      or (
        bmc.source_run_id is null
        and coalesce(
          bmc.source_metadata ->> 'evidence_classification',
          bmc.source_metadata #>> '{metadata,evidence_classification}'
        ) = 'business_evidence'
        and (
          coalesce(bmc.source_metadata ->> 'review_status', bmc.source_metadata #>> '{metadata,review_status}') in ('approved', 'auto_learned')
          or coalesce(bmc.source_metadata ->> 'trust_level', bmc.source_metadata #>> '{metadata,trust_level}') in ('trusted', 'auto_trusted')
        )
      )
      or (
        bmc.source_run_id is not null
        and source_run.id is not null
        and source_run.status = 'completed'
        and source_run.deleted_at is null
        and source_run.archived_at is null
        and coalesce(
          source_run.output_json ->> 'evidence_classification',
          source_run.output_json #>> '{metadata,evidence_classification}',
          'business_evidence'
        ) = 'business_evidence'
        and coalesce(
          source_run.input_json ->> 'evidence_classification',
          source_run.input_json #>> '{metadata,evidence_classification}',
          'business_evidence'
        ) = 'business_evidence'
        and coalesce(source_run.output_json ->> 'invalidated_at', source_run.output_json #>> '{metadata,invalidated_at}') is null
        and coalesce(source_run.output_json ->> 'invalidation_reason', source_run.output_json #>> '{metadata,invalidation_reason}') is null
        and coalesce(source_run.input_json ->> 'invalidated_at', source_run.input_json #>> '{metadata,invalidated_at}') is null
        and coalesce(source_run.input_json ->> 'invalidation_reason', source_run.input_json #>> '{metadata,invalidation_reason}') is null
        and coalesce(source_run.output_json ->> 'extraction_outcome', source_run.output_json #>> '{metadata,extraction_outcome}', 'completed') in ('facts_extracted', 'completed')
        and coalesce(source_run.input_json ->> 'extraction_outcome', source_run.input_json #>> '{metadata,extraction_outcome}', 'completed') in ('facts_extracted', 'completed')
        and (
          coalesce(source_run.output_json ->> 'evidence_classification', source_run.output_json #>> '{metadata,evidence_classification}') = 'business_evidence'
          or lower(source_run.output_json::text) !~ 'vaeroex (run|request|generation|analysis) (failed|timed out|was unavailable)'
        )
      )
    )
    and (
      bmc.source_run_id is null
      or (
        source_run.id is not null
        and source_run.status = 'completed'
        and source_run.deleted_at is null
        and source_run.archived_at is null
        and coalesce(
          source_run.output_json ->> 'evidence_classification',
          source_run.output_json #>> '{metadata,evidence_classification}',
          'business_evidence'
        ) = 'business_evidence'
        and coalesce(
          source_run.input_json ->> 'evidence_classification',
          source_run.input_json #>> '{metadata,evidence_classification}',
          'business_evidence'
        ) = 'business_evidence'
        and coalesce(source_run.output_json ->> 'invalidated_at', source_run.output_json #>> '{metadata,invalidated_at}') is null
        and coalesce(source_run.output_json ->> 'invalidation_reason', source_run.output_json #>> '{metadata,invalidation_reason}') is null
        and coalesce(source_run.input_json ->> 'invalidated_at', source_run.input_json #>> '{metadata,invalidated_at}') is null
        and coalesce(source_run.input_json ->> 'invalidation_reason', source_run.input_json #>> '{metadata,invalidation_reason}') is null
        and coalesce(source_run.output_json ->> 'extraction_outcome', source_run.output_json #>> '{metadata,extraction_outcome}', 'completed') in ('facts_extracted', 'completed')
        and coalesce(source_run.input_json ->> 'extraction_outcome', source_run.input_json #>> '{metadata,extraction_outcome}', 'completed') in ('facts_extracted', 'completed')
        and (
          coalesce(source_run.output_json ->> 'evidence_classification', source_run.output_json #>> '{metadata,evidence_classification}') = 'business_evidence'
          or lower(source_run.output_json::text) !~ 'vaeroex (run|request|generation|analysis) (failed|timed out|was unavailable)'
        )
      )
    )
  order by bmc.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;


commit;
