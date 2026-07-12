-- Read-only review for legacy setup and derived records.
-- Replace '<workspace-id>' in the Supabase SQL editor before running.
-- This script intentionally performs no updates, archives, or deletes.

with candidate_records as (
  select 'tasks' as record_type, id, title, created_at,
    case
      when lower(coalesce(category, '')) = 'setup' and lower(concat_ws(' ', title, description)) ~ '(starter|generated|configured)' then 'setup_context'
      else null
    end as review_reason
  from public.tasks where workspace_id = '<workspace-id>'::uuid

  union all

  select 'issues', id, title, created_at,
    case when lower(coalesce(root_cause, '')) ~ '(starter|initial) category; confirm with real workspace activity' then 'setup_context' end
  from public.issues where workspace_id = '<workspace-id>'::uuid

  union all

  select 'reports', id, title, created_at,
    case when source_data_json ? 'generated_from' or source_data_json ? 'generatedFrom' then 'derived_report' end
  from public.reports where workspace_id = '<workspace-id>'::uuid

  union all

  select 'sops', id, title, created_at,
    case when lower(coalesce(category, '')) ~ '^(starter|initial) sop$' then 'setup_context' end
  from public.sops where workspace_id = '<workspace-id>'::uuid
)
select record_type, id, title, created_at, review_reason
from candidate_records
where review_reason is not null
order by created_at, record_type;

-- Before any future cleanup, review the result with the workspace owner.
-- Generated reports and setup placeholders should be archived or marked as
-- non-evidence only after that review; never hard-delete historical data here.
