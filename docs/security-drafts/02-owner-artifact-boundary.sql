-- LOCAL REVIEW DRAFT ONLY. Backfill private metadata, never rewrite historical
-- artifacts: the deployed Sheets fence treats added-column changes as content.
begin;
create table private.derived_evidence_audiences (
 artifact_kind text not null check(artifact_kind in ('ai_agent_runs','reports')),
 artifact_id uuid not null,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_kind text,source_id uuid,lineage_state text not null check(lineage_state in ('source_verified','legacy_unverified')),
 actor_private boolean not null default false,actor_id uuid,primary key(artifact_kind,artifact_id)
);
alter table private.derived_evidence_audiences enable row level security;
revoke all on private.derived_evidence_audiences from public,anon,authenticated,service_role;
create function private.owner_artifact_marker_v1(j jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(j->>'contractId'='intelligence_briefing_v1' or j->>'analysis_type' in ('weekly_briefing','monthly_briefing','vsi')
 or j#>>'{source_artifact,workflow}' in ('intelligence_briefing_v1','vsi') or j#>>'{source_artifact,contract_id}' in ('intelligence_briefing_v1','vsi_exchange_v1')
 or j#>>'{artifact,contractId}'='intelligence_briefing_v1',false)
$$;
create function private.safe_evidence_uuid_v1(v text) returns uuid language plpgsql immutable set search_path='' as $$
begin return v::uuid;exception when invalid_text_representation then return null;end $$;
insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state)
 select 'ai_agent_runs',id,workspace_id,'legacy_unverified' from public.ai_agent_runs where agent_type='intelligence_briefing_v1' or private.owner_artifact_marker_v1(output_json);
insert into private.derived_evidence_audiences
 select 'reports',r.id,r.workspace_id,r.source_data_json#>>'{source_artifact,workflow}',private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}'),
 'legacy_unverified',e.id is not null or coalesce(r.source_data_json->>'analysis_type'='vsi' or r.source_data_json#>>'{source_artifact,workflow}'='vsi'
 or r.source_data_json#>>'{source_artifact,contract_id}'='vsi_exchange_v1',false),e.actor_user_id
 from public.reports r left join public.vsi_exchanges e on e.workspace_id=r.workspace_id and e.id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}')
 where r.report_type in ('weekly_briefing','monthly_briefing') or private.owner_artifact_marker_v1(r.source_data_json) or e.id is not null
 or exists(select 1 from private.derived_evidence_audiences a where a.artifact_kind='ai_agent_runs' and a.workspace_id=r.workspace_id and a.artifact_id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}'));
-- UNION terminates cycles. Missing/ambiguous private actor stays NULL and denies
-- access; created_by is not evidence of who owned a deleted source exchange.
with recursive descendants(id,workspace_id,actor_private,actor_id) as (
 select artifact_id,workspace_id,actor_private,actor_id from private.derived_evidence_audiences where artifact_kind='reports'
 union select r.id,r.workspace_id,d.actor_private,d.actor_id from public.reports r join descendants d on d.workspace_id=r.workspace_id
 and d.id=private.safe_evidence_uuid_v1(r.source_data_json#>>'{source_artifact,id}')
) insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state,actor_private,actor_id)
 select 'reports',id,workspace_id,'legacy_unverified',bool_or(actor_private),
 case when count(distinct actor_id) filter(where actor_private)=1 and not bool_or(actor_private and actor_id is null)
 then min(actor_id::text) filter(where actor_private)::uuid else null end from descendants group by id,workspace_id
 on conflict(artifact_kind,artifact_id) do update set actor_private=private.derived_evidence_audiences.actor_private or excluded.actor_private,
 actor_id=case when excluded.actor_private then excluded.actor_id else private.derived_evidence_audiences.actor_id end;
create function public.can_access_owner_evidence_v1(w uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin perform private.require_evidence_owner_v1(w);return true;exception when insufficient_privilege then return false;end $$;
create function public.can_access_derived_evidence_v1(w uuid,k text,i uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;
begin
 if k not in ('ai_agent_runs','reports') then return false;end if;
 select * into a from private.derived_evidence_audiences where artifact_kind=k and artifact_id=i;
 if not found then return true;end if;
 return a.workspace_id=w and public.can_access_owner_evidence_v1(w) and (not a.actor_private or coalesce(a.actor_id=auth.uid(),false));
end $$;
create function private.guard_owner_brief_run_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;protected boolean;
begin
 select * into a from private.derived_evidence_audiences where artifact_kind='ai_agent_runs' and artifact_id=new.id;
 protected:=a.artifact_id is not null or new.agent_type='intelligence_briefing_v1' or private.owner_artifact_marker_v1(new.output_json);
 if not protected then return new;end if;
 if a.artifact_id is not null and a.workspace_id is distinct from new.workspace_id then raise exception 'evidence_artifact_identity_immutable' using errcode='42501';end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by or new.agent_type is distinct from old.agent_type then raise exception 'evidence_artifact_identity_immutable' using errcode='42501';end if;
  -- Failure cleanup uses the existing live-session/ticket-validated transaction
  -- claim, even if the former owner is now another active member. No output change.
  if auth.role()='service_role' and old.status='processing' and new.status='failed'
   and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json
   and exists(select 1 from private.trusted_derived_run_commits c where c.run_id=old.id and c.workspace_id=old.workspace_id
    and c.actor_id=old.created_by and c.transition='failed' and c.transaction_id=txid_current()
    and c.read_ticket_id::text=old.input_json->>'google_sheets_read_ticket_id') then return new;end if;
  if new.status is not distinct from old.status and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json then
   perform private.require_evidence_owner_v1(new.workspace_id);return new;end if;
 end if;
 if not exists(select 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.created_by and status='active' and role='owner') then raise exception 'evidence_creator_owner_required' using errcode='42501';end if;
 if auth.role()='authenticated' then
  perform private.require_evidence_owner_v1(new.workspace_id);
  if auth.uid() is distinct from new.created_by then raise exception 'evidence_actor_mismatch' using errcode='42501';end if;
 end if;
 insert into private.derived_evidence_audiences(artifact_kind,artifact_id,workspace_id,lineage_state) values('ai_agent_runs',new.id,new.workspace_id,'source_verified') on conflict do nothing;
 return new; -- Existing trusted completion/privacy triggers remain unmodified.
end $$;
create function private.guard_owner_saved_copy_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.derived_evidence_audiences;sa private.derived_evidence_audiences;sid uuid;k text;sw uuid;actor uuid;priv boolean:=false;lineage text:='source_verified';protected boolean;
begin
 select * into a from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=new.id;
 if tg_op='UPDATE' and a.artifact_id is not null then
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.created_by is distinct from old.created_by or new.source_data_json is distinct from old.source_data_json
   or new.body_markdown is distinct from old.body_markdown or new.report_type is distinct from old.report_type then raise exception 'evidence_saved_copy_immutable' using errcode='42501';end if;
  if not public.can_access_derived_evidence_v1(new.workspace_id,'reports',new.id) then raise exception 'evidence_saved_copy_denied' using errcode='42501';end if;
  return new;
 end if;
 if a.artifact_id is not null then raise exception 'evidence_artifact_identity_reused' using errcode='42501';end if;
 sid:=private.safe_evidence_uuid_v1(new.source_data_json#>>'{source_artifact,id}');k:=new.source_data_json#>>'{source_artifact,workflow}';
 select * into sa from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=sid;
 protected:=new.report_type in ('weekly_briefing','monthly_briefing') or private.owner_artifact_marker_v1(new.source_data_json) or sa.artifact_id is not null
 or exists(select 1 from private.derived_evidence_audiences where artifact_kind='ai_agent_runs' and artifact_id=sid) or exists(select 1 from public.vsi_exchanges where id=sid);
 if not protected then return new;end if;
 perform private.require_evidence_owner_v1(new.workspace_id);
 if auth.uid() is distinct from new.created_by then raise exception 'evidence_actor_mismatch' using errcode='42501';end if;
 if k='intelligence_briefing_v1' then
  select workspace_id into sw from public.ai_agent_runs where id=sid and agent_type='intelligence_briefing_v1' and status='completed' and archived_at is null and deleted_at is null and output_json=new.source_data_json->'artifact';
 elsif k='vsi' then
  select workspace_id,actor_user_id into sw,actor from public.vsi_exchanges where id=sid and actor_user_id=auth.uid()
  and new.source_data_json#>>'{artifact,exchangeId}'=id::text and new.source_data_json#>'{artifact,citations}'=citations
  and new.source_data_json#>>'{display,summary}'=user_message and new.source_data_json#>>'{display,sections,0,body}'=answer and new.body_markdown='# '||new.title||E'\n\n'||answer;
  priv:=true;
 elsif k='saved_report' then
  if sa.artifact_id is null or not public.can_access_derived_evidence_v1(new.workspace_id,'reports',sid) then raise exception 'evidence_saved_copy_denied' using errcode='42501';end if;
  select workspace_id into sw from public.reports where id=sid and deleted_at is null and body_markdown=new.body_markdown;
  priv:=sa.actor_private;actor:=sa.actor_id;lineage:=sa.lineage_state;
 else raise exception 'evidence_saved_source_required' using errcode='42501';end if;
 if sw is distinct from new.workspace_id then raise exception 'evidence_saved_source_unavailable' using errcode='42501';end if;
 insert into private.derived_evidence_audiences values('reports',new.id,new.workspace_id,k,sid,lineage,priv,actor);
 return new;
end $$;
create trigger owner_brief_run_boundary before insert or update on public.ai_agent_runs for each row execute function private.guard_owner_brief_run_v1();
create trigger owner_saved_copy_boundary before insert or update on public.reports for each row execute function private.guard_owner_saved_copy_v1();
create policy owner_brief_runs_boundary on public.ai_agent_runs as restrictive for all to public
 using(public.can_access_derived_evidence_v1(workspace_id,'ai_agent_runs',id)) with check(public.can_access_derived_evidence_v1(workspace_id,'ai_agent_runs',id));
create policy owner_saved_copies_boundary on public.reports as restrictive for all to public
 using(public.can_access_derived_evidence_v1(workspace_id,'reports',id)) with check(public.can_access_derived_evidence_v1(workspace_id,'reports',id));
-- No blanket owner policies on existing actor-private VSI transcripts.
revoke all on function private.owner_artifact_marker_v1(jsonb),private.safe_evidence_uuid_v1(text),private.guard_owner_brief_run_v1(),private.guard_owner_saved_copy_v1() from public,anon,authenticated,service_role;
revoke all on function public.can_access_owner_evidence_v1(uuid),public.can_access_derived_evidence_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_access_owner_evidence_v1(uuid) to authenticated;
-- Boolean policy predicate grants no table access. Classified content returns
-- false to anon; ordinary rows remain subject to the existing permissive RLS.
grant execute on function public.can_access_derived_evidence_v1(uuid,text,uuid) to authenticated,anon;
commit;
