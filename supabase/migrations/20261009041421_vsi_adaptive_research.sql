begin;
-- Public research provenance belongs to the actor's private transcript and is
-- deleted with it. It never enters shared Business Memory or retained cost logs.
alter table public.vsi_exchanges add column public_research_topics jsonb not null default '[]';
alter table public.vsi_exchanges add constraint vsi_public_research_topics_bounded check (
 jsonb_typeof(public_research_topics) = 'array'
 and jsonb_array_length(public_research_topics) <= 12
 and octet_length(public_research_topics::text) <= 2500
 and not jsonb_path_exists(public_research_topics, '$[*] ? (@.type() != "string")')
);
comment on column public.vsi_exchanges.public_research_topics is
 'Server-validated public search terms explicitly supplied for public research; private conversation provenance, never shared memory.';
-- Preserve all actor/workspace/entitlement checks, atomic quotas, spending locks,
-- and idempotency. A 240-second lease covers bounded 180-second research plus
-- database settlement, preventing an in-progress request from being reclaimed.
create or replace function public.vsi_mutate_v1(p_workspace_id uuid,p_actor_user_id uuid,p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.vsi_conversations; r public.vsi_requests; e public.vsi_exchanges; n public.business_notes;
 v_now timestamptz:=clock_timestamp(); v_note uuid; v_role text; v_count integer; v_spent numeric; v_reserved numeric; v_reserve numeric; v_budget numeric;
begin
 if coalesce((select auth.role()),'')<>'service_role' then raise exception 'vsi_server_only' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vsi-actor:'||p_actor_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('vsi-workspace:'||p_workspace_id::text,0));
 select role::text into v_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' for share;
 if not found then raise exception 'vsi_access_denied' using errcode='42501'; end if;
 if not private.workspace_billing_entitled_v1(p_workspace_id) and not exists(select 1 from private.platform_admin_subscription_exemptions where user_id=p_actor_user_id) then
   raise exception 'vsi_subscription_required' using errcode='42501';
 end if;
 if p_action='create' then
   insert into public.vsi_conversations(workspace_id,actor_user_id,actor_role,title) values(p_workspace_id,p_actor_user_id,v_role,left(coalesce(nullif(btrim(p_input->>'title'),''),'New chat'),120)) returning * into c;
   return to_jsonb(c);
 end if;
 if p_action='usage' then
   return jsonb_build_object('used',(select count(*) from public.vsi_requests where actor_user_id=p_actor_user_id and accepted_at>v_now-interval '24 hours' and status='completed'),
    'resetsAt',(select min(accepted_at)+interval '24 hours' from public.vsi_requests where actor_user_id=p_actor_user_id and accepted_at>v_now-interval '24 hours' and status='completed'),
    'spentUsd',(select coalesce(sum(cost_usd),0) from public.vsi_cost_events where workspace_id=p_workspace_id and occurred_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'),
    'reservedUsd',(select coalesce(sum(reservation_usd),0) from public.vsi_requests where workspace_id=p_workspace_id and status='pending'),
    'periodStart',date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC');
 end if;
 select * into c from public.vsi_conversations where id=(p_input->>'conversationId')::uuid and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and actor_role=v_role for update;
 if not found then raise exception 'vsi_conversation_not_found' using errcode='42501'; end if;
 if p_action='rename' then
  update public.vsi_conversations set title=left(btrim(p_input->>'title'),120),updated_at=v_now where id=c.id returning * into c; return to_jsonb(c);
 elsif p_action='delete' then
  if exists(select 1 from public.vsi_requests where conversation_id=c.id and status='pending' and lease_until>v_now) then return jsonb_build_object('error','in_progress'); end if;
  delete from public.vsi_conversations where id=c.id; return jsonb_build_object('deleted',true);
 elsif p_action='continue' then
  if c.exchange_count<250 then return jsonb_build_object('error','thread_not_full'); end if;
  select * into c from public.vsi_conversations where parent_conversation_id=c.id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id;
  if found then return to_jsonb(c); end if;
  select * into c from public.vsi_conversations where id=(p_input->>'conversationId')::uuid;
  insert into public.vsi_conversations(workspace_id,actor_user_id,actor_role,title,parent_conversation_id,context_summary)
    values(p_workspace_id,p_actor_user_id,v_role,left(c.title||' (continued)',120),c.id,c.context_summary) returning * into c;
  return to_jsonb(c);
 elsif p_action='reserve' then
  select * into r from public.vsi_requests where workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and request_id=(p_input->>'requestId')::uuid;
  if found and (r.question_hash<>p_input->>'questionHash' or r.conversation_id is distinct from c.id) then return jsonb_build_object('error','idempotency_conflict'); end if;
  if found and r.status='completed' then return jsonb_build_object('state','completed','request',to_jsonb(r)); end if;
  if found and r.status='pending' and r.lease_until>v_now then return jsonb_build_object('error','in_progress'); end if;
  -- A crashed call has unknown cost: charge its reservation conservatively,
  -- free its question slot, and permit an idempotent retry.
  insert into public.vsi_cost_events(request_id,workspace_id,actor_user_id,attempt,occurred_at,cost_usd,usage_json)
   select id,workspace_id,actor_user_id,attempt,started_at,reservation_usd,jsonb_build_object('status','expired','costEstimated',true,'estimatedCostUsd',reservation_usd)
   from public.vsi_requests where status='pending' and lease_until<=v_now and (actor_user_id=p_actor_user_id or workspace_id=p_workspace_id)
   on conflict(request_id,attempt) do nothing;
  update public.vsi_requests set status='failed',cost_usd=cost_usd+reservation_usd,reservation_usd=0,
   usage_json=usage_json||jsonb_build_array(jsonb_build_object('status','expired','costEstimated',true,'estimatedCostUsd',reservation_usd))
   where status='pending' and lease_until<=v_now and (actor_user_id=p_actor_user_id or workspace_id=p_workspace_id);
  if exists(select 1 from public.vsi_requests where actor_user_id=p_actor_user_id and status='pending') then return jsonb_build_object('error','in_progress'); end if;
  if (select count(*) from public.vsi_requests where workspace_id=p_workspace_id and status='pending')>=4 then return jsonb_build_object('error','workspace_busy'); end if;
  if c.exchange_count>=250 then return jsonb_build_object('error','thread_full'); end if;
  select count(*) into v_count from public.vsi_requests where actor_user_id=p_actor_user_id and status='completed' and accepted_at>v_now-interval '24 hours';
  if v_count>=100 then return jsonb_build_object('error','daily_limit'); end if;
  if (select count(*) from public.vsi_requests where actor_user_id=p_actor_user_id and started_at>v_now-interval '1 minute')>=10 then return jsonb_build_object('error','burst_limit'); end if;
  v_reserve:=(p_input->>'reserveUsd')::numeric; v_budget:=(p_input->>'monthlyBudgetUsd')::numeric;
  if v_reserve is null or v_reserve<=0 or v_reserve>5 or v_budget is null or v_budget<=0 then raise exception 'vsi_invalid_budget'; end if;
  select coalesce(sum(cost_usd),0) into v_spent from public.vsi_cost_events where workspace_id=p_workspace_id and occurred_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC';
  select coalesce(sum(reservation_usd),0) into v_reserved from public.vsi_requests where workspace_id=p_workspace_id and status='pending';
  if v_spent+v_reserved+v_reserve>v_budget then return jsonb_build_object('error','workspace_budget'); end if;
  insert into public.vsi_requests(workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,reservation_usd,lease_until)
   values(p_workspace_id,p_actor_user_id,c.id,(p_input->>'requestId')::uuid,p_input->>'questionHash','pending',v_reserve,v_now+interval '240 seconds')
   on conflict(workspace_id,actor_user_id,request_id) do update set status='pending',attempt=public.vsi_requests.attempt+1,
    reservation_usd=v_reserve,lease_until=v_now+interval '240 seconds',started_at=v_now returning * into r;
  return jsonb_build_object('state','reserved','request',to_jsonb(r));
 elsif p_action='settle' then
  select * into r from public.vsi_requests where id=(p_input->>'id')::uuid and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and conversation_id=c.id for update;
  if not found then raise exception 'vsi_request_not_found'; end if;
  if r.status='completed' then return jsonb_build_object('state','completed'); end if;
  if r.status<>'pending' or r.attempt<>(p_input->>'attempt')::integer then return jsonb_build_object('error','stale_attempt'); end if;
  v_spent:=coalesce((p_input->'usage'->>'estimatedCostUsd')::numeric,0);
  if v_spent<0 or v_spent>10 then raise exception 'vsi_invalid_cost'; end if;
  insert into public.vsi_cost_events(request_id,workspace_id,actor_user_id,attempt,occurred_at,cost_usd,usage_json)
   values(r.id,p_workspace_id,p_actor_user_id,r.attempt,r.started_at,v_spent,coalesce(p_input->'usage','{}'));
  update public.vsi_requests set status=case when coalesce(p_input->>'answer','')<>'' then 'completed' else 'failed' end,
    accepted_at=case when coalesce(p_input->>'answer','')<>'' then v_now else null end,
    cost_usd=cost_usd+v_spent,reservation_usd=0,lease_until=null,usage_json=usage_json||jsonb_build_array(coalesce(p_input->'usage','{}')) where id=r.id;
  if coalesce(p_input->>'answer','')<>'' then
   insert into public.vsi_exchanges(id,workspace_id,actor_user_id,conversation_id,user_message,answer,citations,remember_proposal,public_research_topics)
    values(r.id,p_workspace_id,p_actor_user_id,c.id,p_input->>'question',p_input->>'answer',coalesce(p_input->'citations','[]'),p_input->'rememberProposal',coalesce(p_input->'publicResearchTopics','[]'));
   update public.vsi_conversations set exchange_count=exchange_count+1,updated_at=v_now,
    title=case when exchange_count=0 and title='New chat' then left(p_input->>'question',80) else title end,
    context_summary=left(coalesce(p_input->>'summary',context_summary),8000) where id=c.id;
  end if;
  return jsonb_build_object('state','settled');
 elsif p_action='remember' then
  if v_role not in ('owner','admin','manager','staff') then raise exception 'vsi_note_permission' using errcode='42501'; end if;
  select * into e from public.vsi_exchanges where id=(p_input->>'exchangeId')::uuid and conversation_id=c.id for update;
  if not found or e.remember_proposal is null or e.remember_proposal='null'::jsonb then raise exception 'vsi_note_proposal_missing'; end if;
  if e.remember_proposal->>'content' is distinct from p_input->>'content' then raise exception 'vsi_note_proposal_changed'; end if;
  if e.saved_note_id is not null then
   select * into n from public.business_notes where id=e.saved_note_id and workspace_id=p_workspace_id for update;
  else
   select * into n from public.business_notes where workspace_id=p_workspace_id and release_channel=p_input->>'releaseChannel'
    and source_text_hash=p_input->>'sourceHash' and source_version=1 and deleted_at is null for update;
  end if;
  -- Existing notes keep their review/lifecycle state. Re-confirming a private
  -- proposal must never silently reopen a rejected, archived or approved note.
  if n.id is not null then
   if n.deleted_at is not null or n.status='archived' or n.evidence_lifecycle_status='archived' then
    return jsonb_build_object('error','note_archived');
   elsif n.status='rejected' then return jsonb_build_object('error','note_rejected');
   elsif n.status<>'review_required' then return jsonb_build_object('error','note_already_exists');
   end if;
   v_note:=n.id;
  end if;
  if v_note is null then
   insert into public.business_notes(workspace_id,author_user_id,original_note_text,source_text_hash,release_channel,status,evidence_lifecycle_status,
    extraction_json,source_spans_json,extracted_at,policy_version,validator_version)
    values(p_workspace_id,p_actor_user_id,p_input->>'content',p_input->>'sourceHash',p_input->>'releaseChannel','review_required','inactive',
    p_input->'extraction',p_input->'spans',v_now,'vsi_explicit_note_verbatim_v1','business_note_extraction_validator_v2') returning id into v_note;
  end if;
  update public.vsi_exchanges set saved_note_id=v_note where id=e.id;
  return jsonb_build_object('noteId',v_note);
 end if;
 raise exception 'vsi_unknown_action';
end;
$$;
revoke all on function public.vsi_mutate_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.vsi_mutate_v1(uuid,uuid,text,jsonb) to service_role;
commit;
