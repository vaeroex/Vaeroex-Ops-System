-- Optional cleanup/backfill for legacy Ask Vaeroex runs that were saved as
-- completed Operations Intelligence output even though the content was a
-- security denial.
--
-- Do not run automatically. Review the preview query first. If the preview
-- only contains security-denied runs, run the UPDATE in Supabase SQL Editor.
-- This does not delete business/customer/workspace data.

-- 1) Preview affected runs.
select
  id,
  workspace_id,
  agent_type,
  status,
  error_message,
  output_json ->> 'title' as title,
  created_at
from public.ai_agent_runs
where status <> 'blocked'
  and (
    output_json::text ~* 'request denied'
    or output_json::text ~* 'request blocked'
    or output_json::text ~* 'data deletion not permitted'
    or output_json::text ~* 'deletion not permitted'
    or output_json::text ~* 'not allowed to delete'
    or output_json::text ~* 'cannot delete'
    or output_json::text ~* 'can''t delete'
    or output_json::text ~* 'action blocked'
    or output_json::text ~* 'security requirements'
    or error_message ~* 'security requirements'
    or error_message ~* 'request denied'
  )
order by created_at desc;

-- 2) Optional backfill.
-- update public.ai_agent_runs
-- set
--   status = 'blocked',
--   error_message = 'This request cannot be performed because it conflicts with platform security requirements.',
--   output_json = jsonb_build_object(
--     'security_response', true,
--     'blocked', true,
--     'title', '🛡 Action Blocked',
--     'message', 'This request cannot be performed because it conflicts with platform security requirements.',
--     'files_modified', 0,
--     'business_memory_modified', 0,
--     'reports_modified', 0,
--     'kpis_modified', 0,
--     'workspace_modified', 0,
--     'legacy_output_preserved', output_json
--   )
-- where status <> 'blocked'
--   and (
--     output_json::text ~* 'request denied'
--     or output_json::text ~* 'request blocked'
--     or output_json::text ~* 'data deletion not permitted'
--     or output_json::text ~* 'deletion not permitted'
--     or output_json::text ~* 'not allowed to delete'
--     or output_json::text ~* 'cannot delete'
--     or output_json::text ~* 'can''t delete'
--     or output_json::text ~* 'action blocked'
--     or output_json::text ~* 'security requirements'
--     or error_message ~* 'security requirements'
--     or error_message ~* 'request denied'
--   );
