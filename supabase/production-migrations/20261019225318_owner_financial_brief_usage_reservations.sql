-- Opaque shared-quota slots; all financial content and receipt dependencies stay private.
-- Uses the established persisted usage trigger, mutex and UTC-month semantics.
begin;
alter table private.owner_financial_briefings_v1
 add column usage_run_id uuid not null default gen_random_uuid();

-- Preserve every existing attempt (including failures) at its original timestamp.
-- This deliberately fails closed if admitting current-month history exceeds quota.
insert into public.ai_agent_runs(id,workspace_id,agent_type,input_json,output_json,status,created_by,created_at)
 select usage_run_id,workspace_id,'private_analysis_reservation_v1','{}'::jsonb,'{}'::jsonb,status,owner_id,created_at
 from private.owner_financial_briefings_v1 order by created_at,id;
alter table private.owner_financial_briefings_v1
 add constraint owner_financial_brief_usage_unique unique(usage_run_id),
 add constraint owner_financial_brief_usage_fk foreign key(usage_run_id) references public.ai_agent_runs(id)
 deferrable initially deferred;

alter table public.ai_agent_runs add constraint private_analysis_reservation_content_empty
 check(agent_type <> 'private_analysis_reservation_v1' or
  (input_json='{}'::jsonb and output_json='{}'::jsonb and error_message is null));

create function private.reserve_owner_financial_brief_usage_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 -- Called only by insertion into the inaccessible private table, after native
 -- claim authentication, receipt fencing and idempotency checks. INSERT fires
 -- the same workspace mutex/quota trigger as every existing public workflow.
 insert into public.ai_agent_runs(id,workspace_id,agent_type,input_json,output_json,status,created_by,created_at)
  values(new.usage_run_id,new.workspace_id,'private_analysis_reservation_v1','{}'::jsonb,'{}'::jsonb,new.status,new.owner_id,new.created_at)
  returning created_at into new.created_at;
 return new;
end $f$;
revoke all on function private.reserve_owner_financial_brief_usage_v1() from public,anon,authenticated,service_role;
create trigger reserve_owner_financial_brief_usage before insert on private.owner_financial_briefings_v1
 for each row execute function private.reserve_owner_financial_brief_usage_v1();

create function private.sync_owner_financial_brief_usage_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 update public.ai_agent_runs set status=new.status where id=new.usage_run_id;
 return new;
end $f$;
revoke all on function private.sync_owner_financial_brief_usage_v1() from public,anon,authenticated,service_role;
create trigger sync_owner_financial_brief_usage after update of status on private.owner_financial_briefings_v1
 for each row when(old.status is distinct from new.status) execute function private.sync_owner_financial_brief_usage_v1();

create function private.protect_private_analysis_reservation_v1()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if old.agent_type <> 'private_analysis_reservation_v1' then
  if tg_op='UPDATE' and new.agent_type='private_analysis_reservation_v1' then
   raise exception 'private_analysis_reservation_immutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  -- Workspace erasure still cascades. Deleting an individual reservation,
  -- even after its owner is erased, must never recover a monthly quota slot.
  if exists(select 1 from public.workspaces where id=old.workspace_id) then
   raise exception 'private_analysis_reservation_immutable' using errcode='23514';
  end if;
  return old;
 end if;
 -- Permit only private-lifecycle status changes and profile ON DELETE SET NULL.
 -- Comparing the complete row also protects future payload/lineage columns.
 if (to_jsonb(new)-array['status','updated_at','created_by']) is distinct from
    (to_jsonb(old)-array['status','updated_at','created_by'])
  or (new.created_by is distinct from old.created_by and
    (new.created_by is not null or exists(select 1 from public.profiles where id=old.created_by)))
  or (new.status is distinct from old.status and not exists(
    select 1 from private.owner_financial_briefings_v1 where usage_run_id=old.id and status=new.status)) then
  raise exception 'private_analysis_reservation_immutable' using errcode='23514';
 end if;
 return new;
end $f$;
revoke all on function private.protect_private_analysis_reservation_v1() from public,anon,authenticated,service_role;
create trigger protect_private_analysis_reservation before update or delete on public.ai_agent_runs
 for each row execute function private.protect_private_analysis_reservation_v1();
commit;
