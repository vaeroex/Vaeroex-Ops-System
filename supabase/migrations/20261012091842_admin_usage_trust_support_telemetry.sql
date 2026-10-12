begin;
-- Keep the existing provider/security private-schema boundary unchanged.
-- Only these new telemetry helpers and content-free receipts use this schema.
create schema admin_telemetry;
revoke all on schema admin_telemetry from public,anon,authenticated,service_role;
grant usage on schema admin_telemetry to service_role;
-- Complete-period aggregation is database-side. Only explicitly constructed
-- scalar telemetry leaves PostgreSQL; transcripts and opaque payloads never do.
-- SECURITY INVOKER + explicit ACLs keep this an internal service-role API.
create index if not exists admin_ai_usage_period_idx on public.ai_usage(created_at desc,id);
create index if not exists admin_vsi_cost_period_idx on public.vsi_cost_events(occurred_at desc,id);
create index if not exists admin_vsi_requests_period_idx on public.vsi_requests(created_at desc,id);
create index if not exists admin_ai_runs_period_idx on public.ai_agent_runs(created_at desc,id);
create index if not exists admin_support_active_period_idx on public.support_requests(created_at desc,id desc) where archived_at is null and deleted_at is null;

create or replace function admin_telemetry.admin_nonnegative_number_v1(p_value jsonb)
returns numeric language sql immutable security invoker set search_path='' as $$
 select case when jsonb_typeof(p_value)='number' and length(p_value::text)<32
 then case when p_value::numeric between 0 and 9007199254740991 then p_value::numeric else null end else null end;
$$;
revoke all on function admin_telemetry.admin_nonnegative_number_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_nonnegative_number_v1(jsonb) to service_role;

create or replace function admin_telemetry.admin_usage_facts_v1(p_start timestamptz,p_end timestamptz,p_workspace_id uuid)
returns table(id uuid,workspace_id uuid,feature text,source text,status text,occurred_at timestamptz,metrics jsonb)
language sql stable security invoker set search_path='' as $$
with ai as (
 select a.id,a.workspace_id,a.created_at,a.status,
 case when a.agent_type in ('business_health_explanation_v1','finding_explanation_v1','file_analysis','business_note_extraction_v1','intelligence_briefing_v1','global_search_or_ask') then a.agent_type else 'other_recorded_workflow' end feature,
 greatest(a.input_tokens,0) input_tokens,greatest(a.output_tokens,0) output_tokens,
 case when a.latency_ms>=0 then a.latency_ms end latency_ms,
 case when jsonb_typeof(a.metadata_json->'provider_attempts')='array' then jsonb_array_length(a.metadata_json->'provider_attempts') else null end attempts,
 case when a.metadata_json#>'{cost_estimate,schema_version}'='1'::jsonb
 and jsonb_typeof(a.metadata_json#>'{cost_estimate,version}')='string' and a.metadata_json#>>'{cost_estimate,currency}'='USD'
 and admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}') is not null
 and trunc(admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}'))=admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}')
 then admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}')/100000000
 else greatest(a.estimated_cost_cents,0)::numeric/100 end cost,
 (not coalesce((a.metadata_json#>'{cost_estimate,schema_version}'='1'::jsonb
 and jsonb_typeof(a.metadata_json#>'{cost_estimate,version}')='string' and a.metadata_json#>>'{cost_estimate,currency}'='USD'
 and admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}') is not null
 and trunc(admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}'))=admin_telemetry.admin_nonnegative_number_v1(a.metadata_json#>'{cost_estimate,amount_microcents}')),false)
 or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.metadata_json#>'{cost_estimate,attempts}')='array' then a.metadata_json#>'{cost_estimate,attempts}' else '[]'::jsonb end) x where x->>'rate_basis'='conservative_unknown' or x->>'input_rate_basis'='conservative_unknown' or x->>'output_rate_basis'='conservative_unknown')) uncertain
 from public.ai_usage a
 where a.created_at>=p_start and a.created_at<p_end and (p_workspace_id is null or a.workspace_id=p_workspace_id)
 -- VSI has its own authoritative attempt ledger. Exclude explicitly named
 -- mirrors and matching request ids; never add request.cost_usd to event costs.
 and coalesce(a.agent_type,'') not in ('vsi','vsi_v1','vsi_chat','vaeroex_super_intelligence')
 and not exists(select 1 from public.vsi_requests r where r.workspace_id=a.workspace_id and (a.request_id=r.id::text or a.request_id=r.request_id::text))
), vsi as (
 select e.id,e.workspace_id,e.occurred_at,e.cost_usd,e.attempt,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'retries') provider_retries,
 case when e.usage_json->>'failed'='true' or e.usage_json->>'status'='expired' then 'failed' else 'completed' end status,
 e.usage_json->>'costEstimated'='true' or e.usage_json->>'status'='expired' or (e.cost_usd>0 and (admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'inputTokens') is null or admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'outputTokens') is null)) uncertain,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'inputTokens') input_tokens,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'outputTokens') output_tokens,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'cachedInputTokens') cached_tokens,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'providerCalls') calls,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'webSearchCalls') searches,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'webOpenCalls') opens,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'webFindCalls') finds,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'latencyMs') latency_ms,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'providerFailures') provider_failures,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'outputValidationFailures') output_validation_failures,
 admin_telemetry.admin_nonnegative_number_v1(e.usage_json->'citationValidationFailures') citation_validation_failures,
 e.usage_json->>'telemetryVersion'='1' measured,
 e.usage_json->>'outcomeFailure' failure,
 e.usage_json->>'researchStatus' research,
 e.usage_json->>'citationStatus' citation,
 e.usage_json->>'evidenceLimitations'='true' limitations,
 e.usage_json->>'noteProposal'='true' note_proposal
 from public.vsi_cost_events e where e.occurred_at>=p_start and e.occurred_at<p_end and (p_workspace_id is null or e.workspace_id=p_workspace_id)
)
select id,workspace_id,feature,'ai_usage',case when status in ('completed','failed','pending','processing') then status else 'unknown' end,created_at,jsonb_build_object('estimatedSpendUsd',case when not uncertain then cost else 0 end,'uncertainEstimateUsd',case when uncertain then cost else 0 end,'unknownCostCount',case when cost=0 and (uncertain or (status='failed' and input_tokens+output_tokens=0)) then 1 else 0 end,'usageRecords',1,'providerAttempts',coalesce(attempts,case when input_tokens+output_tokens>0 then 1 else 0 end),'providerAttemptSamples',case when attempts is not null then 1 else 0 end,'inputTokens',input_tokens,'outputTokens',output_tokens,'latencySamples',case when latency_ms is not null then 1 else 0 end,'latencyTotalMs',coalesce(latency_ms,0)) from ai
union all
select id,workspace_id,'vsi','vsi_cost_events',status,occurred_at,jsonb_build_object('estimatedSpendUsd',case when not coalesce(uncertain,false) then cost_usd else 0 end,'uncertainEstimateUsd',case when coalesce(uncertain,false) then cost_usd else 0 end,'unknownCostCount',case when input_tokens is null and output_tokens is null and cost_usd=0 then 1 else 0 end,'usageRecords',0,'providerAttempts',coalesce(calls,0),'providerAttemptSamples',case when calls is not null then 1 else 0 end,'inputTokens',coalesce(input_tokens,0),'outputTokens',coalesce(output_tokens,0),'cachedInputTokens',coalesce(cached_tokens,0),'webSearchCalls',coalesce(searches,0),'webOpenCalls',coalesce(opens,0),'webFindCalls',coalesce(finds,0),'researchToolUsd',coalesce(searches,0)*0.01,'latencySamples',case when latency_ms is not null then 1 else 0 end,'latencyTotalMs',coalesce(latency_ms,0),'vsiSettledAttempts',1,'vsiRetryAttempts',case when attempt>1 then 1 else 0 end,'vsiProviderRetries',coalesce(provider_retries,0),'vsiTelemetrySamples',case when measured then 1 else 0 end,'vsiApplicationFailures',case when measured and failure='application' then 1 else 0 end,'vsiProviderFailures',case when measured then coalesce(provider_failures,case when failure='provider' then 1 else 0 end) else 0 end,'vsiTimeouts',case when measured and failure='timeout' then 1 else 0 end,'vsiOutputValidationFailures',case when measured then coalesce(output_validation_failures,case when failure='output_validation' then 1 else 0 end) else 0 end,'vsiCitationValidationFailures',case when measured then coalesce(citation_validation_failures,case when failure='citation_validation' then 1 else 0 end) else 0 end,'vsiBudgetBlocks',case when measured and failure='budget_block' then 1 else 0 end,'vsiContextBlocks',case when measured and failure='context_block' then 1 else 0 end,'vsiEvidenceUnavailable',case when measured and failure='evidence_unavailable' then 1 else 0 end,'vsiResearchCompleted',case when measured and research='completed' then 1 else 0 end,'vsiResearchPartial',case when measured and research='partial' then 1 else 0 end,'vsiResearchFailed',case when measured and research='failed' then 1 else 0 end,'vsiResearchNotRequired',case when measured and research='not_required' then 1 else 0 end,'vsiCitationsValidated',case when measured and citation='validated' then 1 else 0 end,'vsiCitationsNotRequired',case when measured and citation='not_required' then 1 else 0 end,'vsiEvidenceLimitations',case when measured and limitations then 1 else 0 end,'vsiNoteProposals',case when measured and note_proposal then 1 else 0 end) from vsi
union all
select r.id,r.workspace_id,'vsi','vsi_requests',r.status,r.created_at,jsonb_build_object('vsiQuestions',1,'vsiCompleted',case when r.status='completed' then 1 else 0 end,'vsiFailed',case when r.status='failed' then 1 else 0 end,'vsiPending',case when r.status='pending' then 1 else 0 end) from public.vsi_requests r where r.created_at>=p_start and r.created_at<p_end and (p_workspace_id is null or r.workspace_id=p_workspace_id)
union all
select r.id,r.workspace_id,case when r.agent_type in ('business_health_explanation_v1','finding_explanation_v1','file_analysis','intelligence_briefing_v1') then r.agent_type else 'other_recorded_workflow' end,'ai_agent_runs',case when r.status in ('completed','failed','pending','processing') then r.status else 'unknown' end,r.created_at,jsonb_build_object('artifactRuns',1) from public.ai_agent_runs r where r.agent_type in ('business_health_explanation_v1','finding_explanation_v1','file_analysis','intelligence_briefing_v1') and r.created_at>=p_start and r.created_at<p_end and (p_workspace_id is null or r.workspace_id=p_workspace_id)
union all
select r.id,r.workspace_id,'saved_analysis','reports','saved',r.created_at,jsonb_build_object('savedAnalyses',1) from public.reports r where r.report_type='Saved Analysis' and r.created_at>=p_start and r.created_at<p_end and (p_workspace_id is null or r.workspace_id=p_workspace_id);
$$;
revoke all on function admin_telemetry.admin_usage_facts_v1(timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_usage_facts_v1(timestamptz,timestamptz,uuid) to service_role;

create or replace function public.admin_usage_snapshot_v1(p_start timestamptz,p_end timestamptz,p_workspace_id uuid default null,p_page integer default 1,p_page_size integer default 25,p_workspace_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; v_month timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '93 days' or p_page is null or p_page<1 or p_page>100000 or p_page_size is null or p_page_size<1 or p_page_size>50 or p_workspace_page is null or p_workspace_page<1 or p_workspace_page>100000 then raise exception 'invalid_admin_report_parameters' using errcode='22023'; end if;
 with facts as materialized(select * from admin_telemetry.admin_usage_facts_v1(p_start,p_end,p_workspace_id)),
 previous as materialized(select * from admin_telemetry.admin_usage_facts_v1(p_start-(p_end-p_start),p_start,p_workspace_id)),
 workspace_groups as (select f.workspace_id,jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0)) totals from facts f group by f.workspace_id),
 workspace_page as (select w.id,w.name,coalesce(g.totals,'{"estimatedSpendUsd":0,"uncertainEstimateUsd":0,"unknownCostCount":0,"usageRecords":0,"providerAttempts":0,"providerAttemptSamples":0,"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"webSearchCalls":0,"webOpenCalls":0,"webFindCalls":0,"researchToolUsd":0,"latencySamples":0,"latencyTotalMs":0,"vsiQuestions":0,"vsiSettledAttempts":0,"vsiRetryAttempts":0,"vsiProviderRetries":0,"vsiCompleted":0,"vsiFailed":0,"vsiPending":0,"artifactRuns":0,"savedAnalyses":0,"vsiTelemetrySamples":0,"vsiApplicationFailures":0,"vsiProviderFailures":0,"vsiTimeouts":0,"vsiOutputValidationFailures":0,"vsiCitationValidationFailures":0,"vsiBudgetBlocks":0,"vsiContextBlocks":0,"vsiEvidenceUnavailable":0,"vsiResearchCompleted":0,"vsiResearchPartial":0,"vsiResearchFailed":0,"vsiResearchNotRequired":0,"vsiCitationsValidated":0,"vsiCitationsNotRequired":0,"vsiEvidenceLimitations":0,"vsiNoteProposals":0}'::jsonb) totals
 from public.workspaces w left join workspace_groups g on g.workspace_id=w.id
 where (p_workspace_id is null or w.id=p_workspace_id)
 order by coalesce((g.totals->>'estimatedSpendUsd')::numeric,0)+coalesce((g.totals->>'uncertainEstimateUsd')::numeric,0) desc,w.id
 offset (p_workspace_page-1)*p_page_size limit p_page_size),
 detail_page as (select f.id,f.workspace_id,f.feature,f.source,f.status,f.occurred_at,f.metrics from facts f
 order by f.occurred_at desc,f.source,f.id offset (p_page-1)*p_page_size limit p_page_size)
 select jsonb_build_object(
 'start',p_start,'end',p_end,'previousStart',p_start-(p_end-p_start),'page',p_page,'pageSize',p_page_size,'workspacePage',p_workspace_page,'workspacePageSize',p_page_size,
 'totals',(select jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0)) from facts f),
 'previous',(select jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0)) from previous f),
 'unassignedTotals',(select jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0)) from facts f where f.workspace_id is null),
 'outstandingReservedUsd',(select coalesce(sum(r.reservation_usd),0) from public.vsi_requests r where r.status='pending' and (p_workspace_id is null or r.workspace_id=p_workspace_id)),
 'trend',coalesce((select jsonb_agg(x.row order by x.bucket_day) from (select date_trunc('day',f.occurred_at at time zone 'UTC') as bucket_day,jsonb_build_object('day',date_trunc('day',f.occurred_at at time zone 'UTC') at time zone 'UTC','totals',jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0))) row from facts f group by 1)x),'[]'::jsonb),
 'features',coalesce((select jsonb_agg(x.row order by x.feature) from (select f.feature,jsonb_build_object('feature',f.feature)||jsonb_build_object('estimatedSpendUsd',coalesce(sum((f.metrics->>'estimatedSpendUsd')::numeric),0),'uncertainEstimateUsd',coalesce(sum((f.metrics->>'uncertainEstimateUsd')::numeric),0),'unknownCostCount',coalesce(sum((f.metrics->>'unknownCostCount')::numeric),0),'usageRecords',coalesce(sum((f.metrics->>'usageRecords')::numeric),0),'providerAttempts',coalesce(sum((f.metrics->>'providerAttempts')::numeric),0),'providerAttemptSamples',coalesce(sum((f.metrics->>'providerAttemptSamples')::numeric),0),'inputTokens',coalesce(sum((f.metrics->>'inputTokens')::numeric),0),'outputTokens',coalesce(sum((f.metrics->>'outputTokens')::numeric),0),'cachedInputTokens',coalesce(sum((f.metrics->>'cachedInputTokens')::numeric),0),'webSearchCalls',coalesce(sum((f.metrics->>'webSearchCalls')::numeric),0),'webOpenCalls',coalesce(sum((f.metrics->>'webOpenCalls')::numeric),0),'webFindCalls',coalesce(sum((f.metrics->>'webFindCalls')::numeric),0),'researchToolUsd',coalesce(sum((f.metrics->>'researchToolUsd')::numeric),0),'latencySamples',coalesce(sum((f.metrics->>'latencySamples')::numeric),0),'latencyTotalMs',coalesce(sum((f.metrics->>'latencyTotalMs')::numeric),0),'vsiQuestions',coalesce(sum((f.metrics->>'vsiQuestions')::numeric),0),'vsiSettledAttempts',coalesce(sum((f.metrics->>'vsiSettledAttempts')::numeric),0),'vsiRetryAttempts',coalesce(sum((f.metrics->>'vsiRetryAttempts')::numeric),0),'vsiProviderRetries',coalesce(sum((f.metrics->>'vsiProviderRetries')::numeric),0),'vsiCompleted',coalesce(sum((f.metrics->>'vsiCompleted')::numeric),0),'vsiFailed',coalesce(sum((f.metrics->>'vsiFailed')::numeric),0),'vsiPending',coalesce(sum((f.metrics->>'vsiPending')::numeric),0),'artifactRuns',coalesce(sum((f.metrics->>'artifactRuns')::numeric),0),'savedAnalyses',coalesce(sum((f.metrics->>'savedAnalyses')::numeric),0),'vsiTelemetrySamples',coalesce(sum((f.metrics->>'vsiTelemetrySamples')::numeric),0),'vsiApplicationFailures',coalesce(sum((f.metrics->>'vsiApplicationFailures')::numeric),0),'vsiProviderFailures',coalesce(sum((f.metrics->>'vsiProviderFailures')::numeric),0),'vsiTimeouts',coalesce(sum((f.metrics->>'vsiTimeouts')::numeric),0),'vsiOutputValidationFailures',coalesce(sum((f.metrics->>'vsiOutputValidationFailures')::numeric),0),'vsiCitationValidationFailures',coalesce(sum((f.metrics->>'vsiCitationValidationFailures')::numeric),0),'vsiBudgetBlocks',coalesce(sum((f.metrics->>'vsiBudgetBlocks')::numeric),0),'vsiContextBlocks',coalesce(sum((f.metrics->>'vsiContextBlocks')::numeric),0),'vsiEvidenceUnavailable',coalesce(sum((f.metrics->>'vsiEvidenceUnavailable')::numeric),0),'vsiResearchCompleted',coalesce(sum((f.metrics->>'vsiResearchCompleted')::numeric),0),'vsiResearchPartial',coalesce(sum((f.metrics->>'vsiResearchPartial')::numeric),0),'vsiResearchFailed',coalesce(sum((f.metrics->>'vsiResearchFailed')::numeric),0),'vsiResearchNotRequired',coalesce(sum((f.metrics->>'vsiResearchNotRequired')::numeric),0),'vsiCitationsValidated',coalesce(sum((f.metrics->>'vsiCitationsValidated')::numeric),0),'vsiCitationsNotRequired',coalesce(sum((f.metrics->>'vsiCitationsNotRequired')::numeric),0),'vsiEvidenceLimitations',coalesce(sum((f.metrics->>'vsiEvidenceLimitations')::numeric),0),'vsiNoteProposals',coalesce(sum((f.metrics->>'vsiNoteProposals')::numeric),0)) row from facts f group by f.feature)x),'[]'::jsonb),
 'workspaceCount',(select count(*) from public.workspaces w where p_workspace_id is null or w.id=p_workspace_id),
 'workspaceOptions',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name) order by w.name,w.id) from (select id,name from public.workspaces order by name,id limit 1001)w),'[]'::jsonb),
 'workspaces',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)||w.totals||jsonb_build_object(
 'monthAiTokens',(select coalesce(sum(a.tokens_used),0) from public.ai_usage a where a.workspace_id=w.id and a.created_at>=v_month and a.created_at<now()),
 'monthVsiSpendUsd',(select coalesce(sum(e.cost_usd),0) from public.vsi_cost_events e where e.workspace_id=w.id and e.occurred_at>=v_month and e.occurred_at<now()),
 'outstandingVsiReservedUsd',(select coalesce(sum(r.reservation_usd),0) from public.vsi_requests r where r.workspace_id=w.id and r.status='pending')) order by coalesce((w.totals->>'estimatedSpendUsd')::numeric,0)+coalesce((w.totals->>'uncertainEstimateUsd')::numeric,0) desc,w.id) from workspace_page w),'[]'::jsonb),
 'detailCount',(select count(*) from facts),
 'details',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'workspaceId',d.workspace_id,'feature',d.feature,'source',d.source,'status',d.status,'createdAt',d.occurred_at)||'{"estimatedSpendUsd":0,"uncertainEstimateUsd":0,"unknownCostCount":0,"usageRecords":0,"providerAttempts":0,"providerAttemptSamples":0,"inputTokens":0,"outputTokens":0,"cachedInputTokens":0,"webSearchCalls":0,"webOpenCalls":0,"webFindCalls":0,"researchToolUsd":0,"latencySamples":0,"latencyTotalMs":0,"vsiQuestions":0,"vsiSettledAttempts":0,"vsiRetryAttempts":0,"vsiProviderRetries":0,"vsiCompleted":0,"vsiFailed":0,"vsiPending":0,"artifactRuns":0,"savedAnalyses":0,"vsiTelemetrySamples":0,"vsiApplicationFailures":0,"vsiProviderFailures":0,"vsiTimeouts":0,"vsiOutputValidationFailures":0,"vsiCitationValidationFailures":0,"vsiBudgetBlocks":0,"vsiContextBlocks":0,"vsiEvidenceUnavailable":0,"vsiResearchCompleted":0,"vsiResearchPartial":0,"vsiResearchFailed":0,"vsiResearchNotRequired":0,"vsiCitationsValidated":0,"vsiCitationsNotRequired":0,"vsiEvidenceLimitations":0,"vsiNoteProposals":0}'::jsonb||d.metrics order by d.occurred_at desc,d.source,d.id) from detail_page d),'[]'::jsonb),
 'budgetPeriodStart',v_month,'budgetResetsAt',(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC') into result;
 return result;
end;
$$;
revoke all on function public.admin_usage_snapshot_v1(timestamptz,timestamptz,uuid,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_usage_snapshot_v1(timestamptz,timestamptz,uuid,integer,integer,integer) to service_role;

-- Durable receipts make repeated support actions safe even after a network
-- retry. Message bodies are never copied into receipts or the audit ledger.
create table admin_telemetry.admin_support_operation_receipts (
 actor_user_id uuid not null references public.profiles(id),
 operation_id uuid not null,
 arguments jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_user_id,operation_id)
);
alter table admin_telemetry.admin_support_operation_receipts enable row level security;
revoke all on admin_telemetry.admin_support_operation_receipts from public,anon,authenticated,service_role;
grant select,insert on admin_telemetry.admin_support_operation_receipts to service_role;

create or replace function public.admin_manage_support_requests_v1(p_actor_user_id uuid,p_request_ids uuid[],p_action text,p_operation_id uuid,p_status text default null,p_priority text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_ids uuid[]; v_changed uuid[]; v_args jsonb; v_receipt admin_telemetry.admin_support_operation_receipts; v_now timestamptz:=clock_timestamp(); v_result jsonb;
begin
 if p_actor_user_id is null or p_operation_id is null or p_request_ids is null or cardinality(p_request_ids) not between 1 and 50
 or array_position(p_request_ids,null) is not null or p_action is null or p_action not in ('delete','archive','restore','update')
 or (p_action='update' and (p_status is null or p_priority is null or p_status not in ('open','in_review','waiting_on_customer','resolved','closed') or p_priority not in ('Low','Medium','High','Urgent')))
 or (p_action<>'update' and (p_status is not null or p_priority is not null)) then raise exception 'invalid_support_operation' using errcode='22023'; end if;
 select array_agg(id order by id) into v_ids from (select distinct unnest(p_request_ids) id)x;
 if cardinality(v_ids)<>cardinality(p_request_ids) then raise exception 'duplicate_support_ids' using errcode='22023'; end if;
 v_args:=jsonb_build_object('ids',to_jsonb(v_ids),'action',p_action,'status',p_status,'priority',p_priority);
 perform pg_advisory_xact_lock(hashtextextended('admin-support:'||p_actor_user_id::text||':'||p_operation_id::text,0));
 select * into v_receipt from admin_telemetry.admin_support_operation_receipts where actor_user_id=p_actor_user_id and operation_id=p_operation_id;
 if found then
  if v_receipt.arguments<>v_args then raise exception 'support_operation_reuse_mismatch' using errcode='22023'; end if;
  return v_receipt.result||jsonb_build_object('replayed',true);
 end if;
 perform id from public.support_requests where id=any(v_ids) order by id for update;
 with changed as (
 update public.support_requests set
 deleted_at=case when p_action='delete' then v_now when p_action='restore' then null else deleted_at end,
 archived_at=case when p_action='archive' then v_now when p_action='restore' then null else archived_at end,
 status=case when p_action in ('delete','archive') then 'closed' when p_action='restore' then 'open' else p_status end,
 priority=case when p_action='update' then p_priority else priority end,
 updated_at=v_now
 where id=any(v_ids) and (
 (p_action='delete' and deleted_at is null)
 or (p_action='archive' and deleted_at is null and archived_at is null)
 or (p_action='restore' and (deleted_at is not null or archived_at is not null))
 or (p_action='update' and archived_at is null and deleted_at is null and (status is distinct from p_status or priority is distinct from p_priority)))
 returning id)
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_changed from changed;
 v_result:=jsonb_build_object('changed_count',cardinality(v_changed),'changed_ids',to_jsonb(v_changed),'requested_count',cardinality(v_ids),'replayed',false);
 insert into public.security_audit_events(workspace_id,user_id,action_name,operation_type,target_table,initiated_by,required_confirmation,confirmation_received,allowed,request_id,metadata_json)
 values(null,p_actor_user_id,'admin.'||p_action||'_support_request','ADMIN','support_requests','user',true,true,true,p_operation_id::text,
 jsonb_build_object('source','admin_support_request_action','requested_ids',to_jsonb(v_ids),'affected_ids',to_jsonb(v_changed),'requested_count',cardinality(v_ids),'changed_count',cardinality(v_changed)));
 insert into admin_telemetry.admin_support_operation_receipts(actor_user_id,operation_id,arguments,result) values(p_actor_user_id,p_operation_id,v_args,v_result);
 return v_result;
end;
$$;
revoke all on function public.admin_manage_support_requests_v1(uuid,uuid[],text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_manage_support_requests_v1(uuid,uuid[],text,uuid,text,text) to service_role;
-- Values are reconstructed inside PostgreSQL; nested provider JSON never reaches the admin server.
create or replace function admin_telemetry.admin_trust_scalar_v1(p_value jsonb, p_kind text)
returns jsonb language sql immutable security invoker set search_path = '' as $fn$
 select case
 when p_kind='number' then case when jsonb_typeof(p_value)='number' then case when p_value::numeric between 0 and 1000000000000 then p_value else 'null'::jsonb end else 'null'::jsonb end
 when p_kind='boolean' and jsonb_typeof(p_value)='boolean' then p_value
 when p_kind='hash' and (p_value#>>'{}') ~ '^(sha256:)?[a-fA-F0-9]{16,128}$' then p_value
 when p_kind='model' and length(p_value#>>'{}')<=100 and ((p_value#>>'{}') ~ '^(gpt-(5\.6|6|6\.1)-(sol|terra|luna|astra)|gpt-5\.4-mini|gpt-4o(-mini)?|gpt-4\.1(-mini|-nano)?|claude-(sonnet|haiku|opus)-[0-9-]+)(-[0-9]{4}-[0-9]{2}-[0-9]{2})?$' or p_value#>>'{}'=any(array['nvidia/llama-3.3-nemotron-super-49b-v1.5', 'nvidia/nemotron-3-nano-30b-a3b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b', 'meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-v4-flash', 'deepseek-ai/deepseek-v4-pro', 'openai/gpt-oss-20b', 'z-ai/glm-5.2'])) then p_value
 when p_kind='provider' and p_value#>>'{}'=any(array['openai','nvidia','anthropic','google','unknown']) then p_value
 else 'null'::jsonb end
$fn$;
create or replace function admin_telemetry.admin_trust_enum_v1(p_value jsonb, p_allowed text[])
returns jsonb language sql immutable security invoker set search_path = '' as $fn$
 select case when jsonb_typeof(p_value)='string' and p_value#>>'{}'=any(p_allowed) then p_value else 'null'::jsonb end
$fn$;
create or replace function admin_telemetry.admin_trust_attempts_v1(p_value jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object(
 'provider', admin_telemetry.admin_trust_scalar_v1(a->'provider','provider'),
 'runtime_model',admin_telemetry.admin_trust_scalar_v1(coalesce(a->'runtime_model',a->'runtimeModel',a->'model',a->'requested_model',a->'requestedModel'),'model'),
 'success',admin_telemetry.admin_trust_scalar_v1(a->'success','boolean'),
 'fallback',admin_telemetry.admin_trust_scalar_v1(a->'fallback','boolean'),
 'role',admin_telemetry.admin_trust_enum_v1(a->'role',array['primary','fallback']),
 'latency_ms',admin_telemetry.admin_trust_scalar_v1(coalesce(a->'latency_ms',a->'latencyMs'),'number'),
 'failure_type',admin_telemetry.admin_trust_enum_v1(coalesce(a->'failure_type',a->'failureType'),array['transport','structured_output','unsupported_input','deadline']),
 'validation_reason_code',admin_telemetry.admin_trust_enum_v1(coalesce(a->'validation_reason_code',a->'validationReasonCode'),array['response_not_json', 'root_not_object', 'missing_analysis', 'invalid_analysis_shape', 'missing_findings', 'findings_not_array', 'insufficient_required_findings', 'unknown_signal_id', 'duplicate_signal_id', 'missing_required_signal', 'invalid_relationship', 'unsupported_relationship', 'invalid_action', 'invalid_citation_id', 'missing_summary_signal_ids', 'invalid_summary_signal_ids', 'executive_summary_missing', 'executive_summary_signal_coverage_failed', 'invalid_overall_confidence', 'confidence_ceiling_exceeded', 'evidence_sufficiency_invalid', 'agreement_invalid', 'uncertainty_invalid', 'schema_field_type_mismatch', 'unexpected_truncation', 'unsupported_inference', 'numeric_integrity_failed', 'contextual_validation_failed', 'ambiguous_extraction', 'source_quote_missing', 'source_quote_not_found', 'unsupported_entity', 'contextual_inconsistency', 'reasoning_leakage', 'unsafe_generated_output', 'unknown_validation_failure']::text[])
 )), '[]'::jsonb) from (select a from jsonb_array_elements(case when jsonb_typeof(p_value)='array' then p_value else '[]'::jsonb end) a limit 16) bounded
$fn$;
create or replace function admin_telemetry.admin_trust_shadow_v1(p_value jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $fn$
 select case when jsonb_typeof(p_value)='object' then jsonb_build_object(
'event',admin_telemetry.admin_trust_enum_v1(p_value->'event',array['trust_shadow_evaluation', 'trust_shadow_internal_failure']::text[]),
'mode',admin_telemetry.admin_trust_enum_v1(p_value->'mode',array['shadow']::text[]),
'workflow_id',admin_telemetry.admin_trust_enum_v1(p_value->'workflow_id',array['business_health_explanation_v1', 'intelligence_briefing_v1']::text[]),
'release_channel',admin_telemetry.admin_trust_enum_v1(p_value->'release_channel',array['production', 'preview', 'development']::text[]),
'ruleset_version',admin_telemetry.admin_trust_enum_v1(p_value->'ruleset_version',array['business_health_trust_rules_v1', 'intelligence_briefing_trust_rules_v1']::text[]),
'output_contract_version',admin_telemetry.admin_trust_enum_v1(p_value->'output_contract_version',array['business_health_explanation_v1', 'intelligence_briefing_v1']::text[]),
'validator_version',admin_telemetry.admin_trust_enum_v1(p_value->'validator_version',array['business_health_explanation_validator_v1', 'intelligence_briefing_validator_v1']::text[]),
'cache_state',admin_telemetry.admin_trust_enum_v1(p_value->'cache_state',array['hit', 'miss', 'not_applicable']::text[]),
'shadow_status',admin_telemetry.admin_trust_enum_v1(p_value->'shadow_status',array['accepted', 'qualifier_required', 'unresolved', 'would_omit', 'would_reject', 'internal_failure']::text[]),
'provider',admin_telemetry.admin_trust_scalar_v1(p_value->'provider','provider'),
'model',admin_telemetry.admin_trust_scalar_v1(p_value->'model','model'),
'snapshot_fingerprint',admin_telemetry.admin_trust_scalar_v1(p_value->'snapshot_fingerprint','hash'),
'projection_fingerprint',admin_telemetry.admin_trust_scalar_v1(p_value->'projection_fingerprint','hash'),
'manifest_identity',admin_telemetry.admin_trust_scalar_v1(p_value->'manifest_identity','hash'),
'response_hash',admin_telemetry.admin_trust_scalar_v1(p_value->'response_hash','hash'),
'trust_fingerprint',admin_telemetry.admin_trust_scalar_v1(p_value->'trust_fingerprint','hash'),
'validation_latency_ms',admin_telemetry.admin_trust_scalar_v1(p_value->'validation_latency_ms','number'),
'repair_count',admin_telemetry.admin_trust_scalar_v1(p_value->'repair_count','number'),
'additional_provider_calls',admin_telemetry.admin_trust_scalar_v1(p_value->'additional_provider_calls','number'),
'total_claims',admin_telemetry.admin_trust_scalar_v1(p_value->'total_claims','number'),
'fallback_used',admin_telemetry.admin_trust_scalar_v1(p_value->'fallback_used','boolean'),
'stale',admin_telemetry.admin_trust_scalar_v1(p_value->'stale','boolean'),
'provider_request_ref',case when (p_value->>'provider_request_ref') ~ '^provider_request_[a-f0-9]{24}$' then p_value->'provider_request_ref' else 'null'::jsonb end,
'claims_by_taxonomy',(select coalesce(jsonb_object_agg(k,admin_telemetry.admin_trust_scalar_v1(p_value->'claims_by_taxonomy'->k,'number')),'{}'::jsonb) from unnest(array['deterministic_fact', 'supported_evidence_fact', 'contextual_business_note_fact', 'comparison', 'inference', 'causal_claim', 'recommendation', 'prediction', 'assumption', 'limitation', 'uncertainty_statement', 'citation_bearing_claim', 'connective_language', 'unknown_material_claim', 'non_material_language']::text[]) k where p_value->'claims_by_taxonomy' ? k),
'reason_frequencies',(select coalesce(jsonb_object_agg(k,admin_telemetry.admin_trust_scalar_v1(p_value->'reason_frequencies'->k,'number')),'{}'::jsonb) from unnest(array['actual_target_role_reversed', 'bounded_contradiction_not_visible', 'business_note_claim_not_attributed', 'causal_relationship_not_authorized', 'citation_identity_not_in_manifest', 'claim_level_evidence_support_unresolved', 'confidence_language_exceeds_deterministic_ceiling', 'date_or_reporting_period_not_in_bounded_input', 'inference_requires_qualifier', 'kpi_direction_or_semantic_meaning_reversed', 'material_claim_kpi_identity_unresolved', 'numeric_binding_ambiguous', 'numeric_precision_mismatch', 'numeric_unit_mismatch', 'numeric_value_not_in_bounded_input', 'projection_fingerprint_mismatch', 'recommendation_rationale_unresolved', 'required_limitation_not_visible_in_generated_prose', 'shadow_save_eligibility_blocked', 'snapshot_fingerprint_mismatch', 'stale_input_described_as_current', 'trust_projection_binding_missing', 'workflow_contract_mismatch', 'workspace_scope_mismatch', 'trust_shadow_internal_failure']::text[]) k where p_value->'reason_frequencies' ? k),
'claim_refs',(select coalesce(jsonb_agg(jsonb_build_object(
 'claim_id','claim_'||md5(coalesce(c->>'claim_id','')),
 'section_id','section_'||md5(coalesce(c->>'section_id','')),
 'claim_text_hash',admin_telemetry.admin_trust_scalar_v1(c->'claim_text_hash','hash'),
 'claim_type',admin_telemetry.admin_trust_enum_v1(c->'claim_type',array['deterministic_fact', 'supported_evidence_fact', 'contextual_business_note_fact', 'comparison', 'inference', 'causal_claim', 'recommendation', 'prediction', 'assumption', 'limitation', 'uncertainty_statement', 'citation_bearing_claim', 'connective_language', 'unknown_material_claim', 'non_material_language']::text[]),
 'outcomes',(select coalesce(jsonb_agg(o),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(c->'outcomes')='array' then c->'outcomes' else '[]'::jsonb end) o where o#>>'{}'=any(array['accepted','qualifier_required','unresolved','would_omit','would_reject']))
 )),'[]'::jsonb) from (select c from jsonb_array_elements(case when jsonb_typeof(p_value->'claim_refs')='array' then p_value->'claim_refs' else '[]'::jsonb end) c limit 500) bounded)
) else 'null'::jsonb end
$fn$;
create or replace function public.admin_ai_trust_rows_v1(p_start timestamptz,p_end timestamptz,p_workspace_id uuid default null,p_limit integer default 5000)
returns jsonb language plpgsql stable security invoker set search_path = '' as $fn$
begin
 if p_end is null or (p_start is not null and p_start>=p_end) or p_limit is null or p_limit<1 or p_limit>5000 then raise exception 'Invalid admin telemetry scope' using errcode='22023'; end if;
 return (
 with usage_scope as materialized (
  select id,agent_type,status,model,latency_ms,created_at,metadata_json from public.ai_usage
  where agent_type=any(array['business_health_explanation_v1','finding_explanation_v1','file_analysis','intelligence_briefing_v1'])
  and (p_start is null or created_at>=p_start) and created_at<p_end and (p_workspace_id is null or workspace_id=p_workspace_id)
 ),run_scope as materialized (
  select id,agent_type,status,created_at from public.ai_agent_runs
  where agent_type=any(array['finding_explanation_v1','file_analysis','intelligence_briefing_v1'])
  and (p_start is null or created_at>=p_start) and created_at<p_end and (p_workspace_id is null or workspace_id=p_workspace_id)
 ),note_scope as materialized (
  select id,status,evidence_lifecycle_status,provider_name,model_used,fallback_used,provider_attempts_json,release_channel,latency_ms,extracted_at,approved_at,archived_at,deleted_at,created_at,
   extraction_json->'extractionConfidence' as extraction_confidence,user_corrections_json->'correction_count' as correction_count from public.business_notes
  where (p_start is null or created_at>=p_start) and created_at<p_end and (p_workspace_id is null or workspace_id=p_workspace_id)
 )
 select jsonb_build_object(
 'usage',(select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'agent_type',agent_type,'status',admin_telemetry.admin_trust_enum_v1(to_jsonb(status),array['completed','failed','pending','running','blocked']),
  'model',admin_telemetry.admin_trust_scalar_v1(to_jsonb(model),'model'),'latency_ms',latency_ms,'created_at',created_at,
  'provider',admin_telemetry.admin_trust_scalar_v1(metadata_json->'provider','provider'),
  'fallback_used',admin_telemetry.admin_trust_scalar_v1(metadata_json->'fallback_used','boolean'),
  'provider_attempts',admin_telemetry.admin_trust_attempts_v1(metadata_json->'provider_attempts'),
  'trust_shadow',admin_telemetry.admin_trust_shadow_v1(metadata_json->'trust_shadow'))),'[]'::jsonb)
   from (select * from usage_scope order by created_at desc,id desc limit p_limit) u),
 'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'agent_type',agent_type,'status',admin_telemetry.admin_trust_enum_v1(to_jsonb(status),array['completed','failed','pending','running','blocked']),'created_at',created_at)),'[]'::jsonb) from (select * from run_scope order by created_at desc,id desc limit p_limit) r),
 'notes',(select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'status',admin_telemetry.admin_trust_enum_v1(to_jsonb(status),array['draft','extracting','review_required','approved','rejected','extraction_failed','archived']),
  'evidence_lifecycle_status',admin_telemetry.admin_trust_enum_v1(to_jsonb(evidence_lifecycle_status),array['active','inactive','archived','deleted']),
  'provider_name',admin_telemetry.admin_trust_scalar_v1(to_jsonb(provider_name),'provider'),'model_used',admin_telemetry.admin_trust_scalar_v1(to_jsonb(model_used),'model'),
  'fallback_used',fallback_used,'provider_attempts_json',admin_telemetry.admin_trust_attempts_v1(provider_attempts_json),
  'release_channel',admin_telemetry.admin_trust_enum_v1(to_jsonb(release_channel),array['production','preview','development']),
  'latency_ms',latency_ms,'extracted_at',extracted_at,'approved_at',approved_at,'archived_at',archived_at,'deleted_at',deleted_at,'created_at',created_at,
  'extraction_confidence',admin_telemetry.admin_trust_scalar_v1(extraction_confidence,'number'),'correction_count',admin_telemetry.admin_trust_scalar_v1(correction_count,'number'))),'[]'::jsonb) from (select * from note_scope order by created_at desc,id desc limit p_limit) n),
 'counts',jsonb_build_object('usage',(select count(*) from usage_scope),'runs',(select count(*) from run_scope),'notes',(select count(*) from note_scope),
 'saved_analyses',(select count(*) from public.reports where report_type='Saved Analysis' and source_data_json @> '{"record_kind":"saved_analysis","analysis_type":"finding_explanation"}'::jsonb and (p_start is null or created_at>=p_start) and created_at<p_end and (p_workspace_id is null or workspace_id=p_workspace_id))))
 );
end
$fn$;
revoke all on function admin_telemetry.admin_trust_scalar_v1(jsonb,text) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_trust_scalar_v1(jsonb,text) to service_role;
revoke all on function admin_telemetry.admin_trust_enum_v1(jsonb,text[]) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_trust_enum_v1(jsonb,text[]) to service_role;
revoke all on function admin_telemetry.admin_trust_attempts_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_trust_attempts_v1(jsonb) to service_role;
revoke all on function admin_telemetry.admin_trust_shadow_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function admin_telemetry.admin_trust_shadow_v1(jsonb) to service_role;
revoke all on function public.admin_ai_trust_rows_v1(timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_ai_trust_rows_v1(timestamptz,timestamptz,uuid,integer) to service_role;

commit;
