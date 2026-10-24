-- INACTIVE LOCAL DRAFT. Separate accounting activation remains disabled.
-- No deployment/activation authorization. Does not change any existing wrapper,
-- EXECUTE grant, transcript policy, privacy/readability check or source eligibility.
-- Bookkeeping only: token/model telemetry is intentionally omitted from this
-- fixed event. NULL provider_calls means unknown, never an invented zero.
begin;
create function public.fail_vsi_request_accounting_v1(
 p_workspace_id uuid,p_actor_user_id uuid,p_session_id uuid,
 p_conversation_id uuid,p_request_id uuid,p_attempt integer,
 p_cost_usd numeric,p_provider_calls integer,p_cost_estimated boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor_role text;conversation_role text;request_status text;request_attempt integer;
 request_started_at timestamptz;usage_value jsonb;prior_event public.vsi_cost_events;updated_rows integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'vsi_failure_server_only' using errcode='42501';end if;
 -- Privacy and authority rechecks after waits must see committed changes.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'vsi_failure_isolation_unsupported' using errcode='40001';end if;
 if p_workspace_id is null or p_actor_user_id is null or p_session_id is null
  or p_conversation_id is null or p_request_id is null or p_attempt is null or p_attempt<1
  or p_cost_usd is null or p_cost_usd::text in ('NaN','Infinity','-Infinity')
  or p_cost_usd<0 or p_cost_usd>10 or p_cost_usd<>round(p_cost_usd,8)
  or (p_provider_calls is not null and (p_provider_calls<0 or p_provider_calls>1000))
  or p_cost_estimated is null then
  raise exception 'vsi_failure_input_invalid' using errcode='22023';end if;
 -- Match v2 authority and lock order. No owner/admin exemption is introduced.
 perform private.require_live_actor_session_v1(p_workspace_id,p_actor_user_id,p_session_id,
  array['owner','admin','manager','staff','viewer']);
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 perform pg_advisory_xact_lock(hashtextextended('vsi-actor:'||p_actor_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('vsi-workspace:'||p_workspace_id::text,0));
 select role::text into v_actor_role from public.workspace_members
  where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' for share;
 if not found then raise exception 'vsi_failure_access_denied' using errcode='42501';end if;
 if not private.workspace_billing_entitled_v1(p_workspace_id)
  and not exists(select 1 from private.platform_admin_subscription_exemptions where user_id=p_actor_user_id) then
  raise exception 'vsi_subscription_required' using errcode='42501';end if;
 -- Only identity/role is selected, never title, summary or transcript contents.
 select actor_role into conversation_role from public.vsi_conversations
  where id=p_conversation_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id for update;
 if not found or conversation_role is distinct from v_actor_role then
  raise exception 'vsi_failure_conversation_denied' using errcode='42501';end if;
 select status,attempt,started_at into request_status,request_attempt,request_started_at from public.vsi_requests
  where id=p_request_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id
   and conversation_id=p_conversation_id for update;
 if not found then raise exception 'vsi_failure_request_denied' using errcode='42501';end if;
 if request_attempt<>p_attempt then raise exception 'vsi_failure_stale_attempt' using errcode='40001';end if;
 -- A competing successful settlement is never overwritten, even if inconsistent
 -- request status were observed. The existence check reads no output contents.
 if request_status='completed' or exists(select 1 from public.vsi_exchanges where id=p_request_id) then
  raise exception 'vsi_failure_already_completed' using errcode='40001';end if;
 usage_value:=jsonb_build_object('accountingContract','vsi_failure_accounting_v1',
  'failed',true,'estimatedCostUsd',p_cost_usd,'providerCalls',p_provider_calls,'costEstimated',p_cost_estimated);
 select * into prior_event from public.vsi_cost_events where request_id=p_request_id and attempt=p_attempt;
 if request_status='failed' then
  if prior_event.id is not null and prior_event.workspace_id=p_workspace_id and prior_event.actor_user_id=p_actor_user_id
   and prior_event.occurred_at=request_started_at and prior_event.cost_usd=p_cost_usd and prior_event.usage_json=usage_value then
   return jsonb_build_object('state','already_failed');end if;
  raise exception 'vsi_failure_accounting_conflict' using errcode='40001';
 end if;
 if request_status is distinct from 'pending' or prior_event.id is not null then
  raise exception 'vsi_failure_accounting_conflict' using errcode='40001';end if;
 insert into public.vsi_cost_events(request_id,workspace_id,actor_user_id,attempt,occurred_at,cost_usd,usage_json)
  values(p_request_id,p_workspace_id,p_actor_user_id,p_attempt,request_started_at,p_cost_usd,usage_value);
 update public.vsi_requests set status='failed',accepted_at=null,cost_usd=cost_usd+p_cost_usd,
  reservation_usd=0,lease_until=null,usage_json=usage_json||jsonb_build_array(usage_value)
  where id=p_request_id and workspace_id=p_workspace_id and actor_user_id=p_actor_user_id
   and conversation_id=p_conversation_id and attempt=p_attempt and status='pending';
 get diagnostics updated_rows=row_count;
 if updated_rows<>1 then raise exception 'vsi_failure_request_changed' using errcode='40001';end if;
 return jsonb_build_object('state','failed');
end $$;
revoke all on function public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean) to service_role;
commit;
