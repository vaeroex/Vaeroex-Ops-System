-- Read-only audit. This script does not update or delete reports.
with classified as (
  select
    id,
    workspace_id,
    report_type,
    title,
    created_at,
    archived_at,
    deleted_at,
    source_data_json ->> 'generated_from' as generated_from,
    case
      when source_data_json ->> 'evidence_count' ~ '^\d+$' then (source_data_json ->> 'evidence_count')::integer
      else 0
    end as evidence_count,
    source_data_json ->> 'source_href' as source_href,
    case
      when lower(report_type || ' ' || title) ~ 'file (review|analysis)|source review' then 'source_review'
      when lower(report_type || ' ' || title) ~ 'checklist|sop|meeting (agenda|brief)' then 'supporting_document'
      when lower(report_type || ' ' || title) ~ 'board|business review package' then 'board_report'
      when lower(report_type || ' ' || title) ~ 'improvement|action plan' then 'improvement_plan'
      when lower(report_type || ' ' || title) ~ 'investigation|bottleneck|accountability|risk brief|root cause|anomaly' then 'investigation_summary'
      else 'executive_brief'
    end as presentation_type
  from public.reports
), duplicates as (
  select workspace_id, lower(title) as normalized_title, count(*) as duplicate_count
  from classified
  where deleted_at is null
  group by workspace_id, lower(title)
  having count(*) > 1
)
select
  classified.*,
  coalesce(duplicates.duplicate_count, 1) as same_title_count,
  case
    when classified.deleted_at is not null then 'retain_soft_deleted'
    when classified.presentation_type in ('source_review', 'supporting_document') then 'retain_outside_primary_library'
    when classified.source_href like '/app/reports/%' then 'manual_review_generated_from_generated_output'
    when classified.generated_from is null then 'review_lineage_metadata'
    when classified.evidence_count = 0 then 'review_evidence_metadata'
    else 'retain_and_map'
  end as recommended_disposition
from classified
left join duplicates
  on duplicates.workspace_id = classified.workspace_id
 and duplicates.normalized_title = lower(classified.title)
order by classified.workspace_id, classified.created_at desc;
