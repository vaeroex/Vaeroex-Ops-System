-- Owner-private financial artifacts; qualified on an isolated native database.
-- No public table or shared analysis-run payload contains financial prose.
begin;
create table private.owner_financial_briefings_v1 (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade, session_id uuid not null,
 generation_key text not null check(generation_key ~ '^[a-f0-9]{64}$'),
 dependencies jsonb not null check(jsonb_typeof(dependencies)='array' and jsonb_array_length(dependencies) between 1 and 2),
 status text not null check(status in ('processing','completed','failed')),
 lease_id uuid not null default gen_random_uuid(), artifact jsonb,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check(artifact is null or octet_length(artifact::text)<=2000000),
 unique(workspace_id,owner_id,generation_key)
);
alter table private.owner_financial_briefings_v1 enable row level security;
revoke all on private.owner_financial_briefings_v1 from public,anon,authenticated,service_role;

create function private.verify_owner_brief_dependencies_v1(p_actor uuid,p_session uuid,p_workspace uuid,p_dependencies jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare d jsonb; r jsonb;
begin
 if p_actor is null or p_session is null or jsonb_typeof(p_dependencies) is distinct from 'array'
   or jsonb_array_length(p_dependencies) not between 1 and 2 then raise exception 'financial_brief_access_denied' using errcode='42501'; end if;
 for d in select value from jsonb_array_elements(p_dependencies) loop
  r:=private.read_qbo_journal_period_for_actor_v2(p_actor,p_session,(d->>'connectionId')::uuid,(d->>'periodStart')::date,(d->>'periodEnd')::date);
  if r is null or r->>'workspaceId' is distinct from p_workspace::text
   or r->>'receiptHash' is distinct from d->>'receiptHash' then raise exception 'financial_brief_evidence_changed' using errcode='42501'; end if;
 end loop;
end $f$;
revoke all on function private.verify_owner_brief_dependencies_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.claim_owner_financial_brief_v1(p_workspace_id uuid,p_dependencies jsonb,p_generation_key text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid:=auth.uid(); v_session uuid:=(auth.jwt()->>'session_id')::uuid; r private.owner_financial_briefings_v1;
begin
 perform private.verify_owner_brief_dependencies_v1(v_actor,v_session,p_workspace_id,p_dependencies);
 if p_generation_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_generation_key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('owner-financial-brief:'||p_workspace_id::text||':'||v_actor::text,0));
 select * into r from private.owner_financial_briefings_v1 where workspace_id=p_workspace_id and owner_id=v_actor and generation_key=p_generation_key for update;
 if found then
  if r.dependencies is distinct from p_dependencies then raise exception 'financial_brief_dependency_mismatch' using errcode='42501'; end if;
  return jsonb_build_object('status',r.status,'id',r.id);
 end if;
 if exists(select 1 from private.owner_financial_briefings_v1 where workspace_id=p_workspace_id and owner_id=v_actor and status='processing' and created_at>clock_timestamp()-interval '10 minutes')
  then return jsonb_build_object('status','processing'); end if;
 if (select count(*) from private.owner_financial_briefings_v1 where workspace_id=p_workspace_id and owner_id=v_actor and created_at>clock_timestamp()-interval '24 hours')>=10
  then raise exception 'financial_brief_daily_limit'; end if;
 insert into private.owner_financial_briefings_v1(workspace_id,owner_id,session_id,generation_key,dependencies,status)
  values(p_workspace_id,v_actor,v_session,p_generation_key,p_dependencies,'processing') returning * into r;
 return jsonb_build_object('status','claimed','id',r.id,'leaseId',r.lease_id);
end $f$;
revoke all on function public.claim_owner_financial_brief_v1(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.claim_owner_financial_brief_v1(uuid,jsonb,text) to authenticated;

create function public.finish_owner_financial_brief_v1(p_run_id uuid,p_lease_id uuid,p_artifact jsonb)
returns boolean language plpgsql security definer set search_path='' as $f$
declare r private.owner_financial_briefings_v1;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'financial_brief_server_only' using errcode='42501'; end if;
 select * into r from private.owner_financial_briefings_v1 where id=p_run_id and lease_id=p_lease_id and status='processing' for update;
 if not found then return false; end if;
 if p_artifact is null then
  update private.owner_financial_briefings_v1 set status='failed',updated_at=clock_timestamp() where id=r.id; return true;
 end if;
 perform private.verify_owner_brief_dependencies_v1(r.owner_id,r.session_id,r.workspace_id,r.dependencies);
 if p_artifact->>'workspaceId' is distinct from r.workspace_id::text or p_artifact->>'generationKey' is distinct from r.generation_key
  or p_artifact->>'contractId' is distinct from 'intelligence_briefing_v1' then raise exception 'financial_brief_artifact_mismatch'; end if;
 update private.owner_financial_briefings_v1 set status='completed',artifact=p_artifact,updated_at=clock_timestamp() where id=r.id;
 return true;
end $f$;
revoke all on function public.finish_owner_financial_brief_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_owner_financial_brief_v1(uuid,uuid,jsonb) to service_role;

create function public.read_owner_financial_brief_v1(p_workspace_id uuid,p_generation_key text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare r private.owner_financial_briefings_v1; v_actor uuid:=auth.uid(); v_session uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 if v_actor is null or v_session is null then raise exception 'financial_brief_access_denied' using errcode='42501'; end if;
 select * into r from private.owner_financial_briefings_v1 where workspace_id=p_workspace_id and owner_id=v_actor and generation_key=p_generation_key;
 if not found then return null; end if;
 perform private.verify_owner_brief_dependencies_v1(v_actor,v_session,p_workspace_id,r.dependencies);
 return jsonb_build_object('id',r.id,'status',r.status,'artifact',case when r.status='completed' then r.artifact else null end);
end $f$;
revoke all on function public.read_owner_financial_brief_v1(uuid,text) from public,anon,service_role;
grant execute on function public.read_owner_financial_brief_v1(uuid,text) to authenticated;
commit;
