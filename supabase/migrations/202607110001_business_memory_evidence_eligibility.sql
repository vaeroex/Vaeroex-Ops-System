-- Filter inactive or invalid source lineage before vector-match limits are applied.
-- This keeps the existing RPC signature and remains backward compatible with callers.

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

grant execute on function public.match_business_memory_chunks(uuid, extensions.vector(1536), integer, double precision) to authenticated;
