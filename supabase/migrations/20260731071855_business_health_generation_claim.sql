begin;

-- The generation-policy field separates new durable claims from legacy run history.
-- Hidden completed rows intentionally keep their claim so lifecycle changes cannot
-- force another provider-backed generation for unchanged inputs.
create unique index if not exists ai_agent_runs_business_health_generation_claim_uidx
  on public.ai_agent_runs (
    workspace_id,
    ((input_json ->> 'fingerprint'))
  )
  where agent_type = 'business_health_explanation_v1'
    and status in ('processing', 'completed')
    and nullif(input_json ->> 'generation_policy_version', '') is not null
    and nullif(input_json ->> 'fingerprint', '') is not null;

comment on index public.ai_agent_runs_business_health_generation_claim_uidx is
  'Allows at most one processing or completed Business Health generation for a workspace and versioned package fingerprint, including archived or otherwise hidden runs.';

commit;
