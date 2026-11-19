-- Disposable PostgreSQL17 after the exact original backend/history and the
-- incremental recurring overlay. No provider calls, hosted data or fake Auth
-- sessions are used by scheduled operations. Every fixture mutation rolls back.
begin;
set search_path=public,extensions;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.recurring_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'square_recurring_test_failed:%',label; end if;
  raise notice 'square_recurring_test_passed:%',label;
end $$;
create function pg_temp.recurring_call(op text,payload jsonb) returns jsonb language sql volatile as $$
 select public.square_customer_recurring_v1(op,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','sq0idp-native-recurring',payload)
$$;
create function pg_temp.recurring_denied(op text,payload jsonb,code text,label text) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin perform pg_temp.recurring_call(op,payload);
  exception when others then if sqlstate=code then denied:=true; else raise; end if; end;
  perform pg_temp.recurring_check(denied,label);
end $$;
do $acl$
declare signature text;
begin
  foreach signature in array array[
    'square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)',
    'square_customer_recurring_status_v1(uuid,uuid,uuid,text,uuid)',
    'square_customer_set_recurring_v1(uuid,uuid,uuid,text,uuid,boolean)',
    'square_customer_recurring_v1(text,uuid,text,jsonb)',
    'square_customer_due_recurring_v1(integer,uuid[],text)',
    'square_customer_recover_recurring_v1(integer,uuid[],text)'] loop
    perform pg_temp.recurring_check(has_function_privilege('service_role','public.'||signature,'execute')
      and not has_function_privilege('anon','public.'||signature,'execute')
      and not has_function_privilege('authenticated','public.'||signature,'execute'),
      'service_only_'||split_part(signature,'(',1));
  end loop;
  perform pg_temp.recurring_check(not has_function_privilege('service_role',
    'square_customer_private.backend_before_recurring_v1(text,uuid,uuid,uuid,text,jsonb)','execute')
    and not has_function_privilege('service_role',
    'square_customer_private.commit_read_v1(text,uuid,jsonb,square_customer_private.connections)','execute'),'no_private_bypass');
  perform pg_temp.recurring_check(not has_table_privilege('service_role','square_customer_private.connections','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','square_customer_private.payments','SELECT,INSERT,UPDATE,DELETE'),'private_tables_closed');
  perform pg_temp.recurring_check(not (select enabled from square_customer_private.configuration),'installation_stays_closed');
end $acl$;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
 ('dddddddd-1111-4111-8111-dddddddddddd','recurring-native@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,email,full_name) values
 ('dddddddd-1111-4111-8111-dddddddddddd','recurring-native@example.invalid','Fictional recurring owner') on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Fictional recurring workspace','dddddddd-1111-4111-8111-dddddddddddd');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','dddddddd-1111-4111-8111-dddddddddddd','owner','active');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by) values
 ('dddddddd-2222-4222-8222-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd','native-recurring','Fictional seller','USD','UTC',
  'dddddddd-1111-4111-8111-dddddddddddd','dddddddd-1111-4111-8111-dddddddddddd');
insert into auth.sessions(id,user_id,not_after) values
 ('dddddddd-3333-4333-8333-dddddddddddd','dddddddd-1111-4111-8111-dddddddddddd',now()+interval '1 day');
insert into public.customer_subscriptions(user_id,workspace_id,customer_email,status,billing_provider,current_period_end,stripe_customer_id,stripe_subscription_id,manually_activated) values
 ('dddddddd-1111-4111-8111-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd','recurring-native@example.invalid',
  'active','stripe',now()+interval '1 month','cus_fictional_recurring','sub_fictional_recurring',false);
update square_customer_private.configuration set enabled=true,application_id='sq0idp-native-recurring';
insert into square_customer_private.connections(connection_id,workspace_id,business_entity_id,application_id,state,
  credential_version,ciphertext,merchant_id,seller_label,access_expires_at,locations,location_id) values
 ('dddddddd-4444-4444-8444-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd','dddddddd-2222-4222-8222-dddddddddddd',
  'sq0idp-native-recurring','connected',1,repeat('x',64),'fictional-merchant','Fictional seller',now()+interval '1 day',
  '[{"id":"location-1","label":"Main"}]','location-1');

do $flow$
declare cid uuid:='dddddddd-4444-4444-8444-dddddddddddd'; wid uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  actor uuid:='dddddddd-1111-4111-8111-dddddddddddd'; sid uuid:='dddddddd-3333-4333-8333-dddddddddddd';
  lid uuid:='dddddddd-5555-4555-8555-dddddddddddd'; lid2 uuid:='dddddddd-6666-4666-8666-dddddddddddd';
  scope jsonb; context jsonb; payload jsonb; initial_end timestamptz; previous_success timestamptz; denied boolean:=false;
begin
  scope:=jsonb_build_object('connectionId',cid,'leaseId',lid);
  perform pg_temp.recurring_check(not (select recurring_enabled from square_customer_private.connections where connection_id=cid)
    and not exists(select from public.square_customer_due_recurring_v1(20,array[wid],'sq0idp-native-recurring')),'existing_connection_not_authorized');
  perform pg_temp.recurring_denied('claim',scope,'42501','claim_without_consent_denied');
  begin perform public.square_customer_set_recurring_v1(actor,null,wid,'sq0idp-native-recurring',cid,true);
  exception when insufficient_privilege then denied:=true; end;
  perform pg_temp.recurring_check(denied,'consent_requires_live_owner_session');
  perform public.square_customer_set_recurring_v1(actor,sid,wid,'sq0idp-native-recurring',cid,true);
  delete from auth.sessions where id=sid;
  context:=pg_temp.recurring_call('claim',scope);
  perform pg_temp.recurring_check((select lease_session_id is null and lease_actor_id=actor and lease_kind='scheduled'
    from square_customer_private.connections where connection_id=cid) and not exists(select from auth.sessions where id=sid),
    'scheduled_claim_without_session_fabrication');
  perform pg_temp.recurring_check((context->>'windowEnd')::timestamptz-(context->>'windowStart')::timestamptz=interval '30 days','initial_supported_window');
  initial_end:=(context->>'windowEnd')::timestamptz;
  perform pg_temp.recurring_call('authorize',scope);
  payload:=scope||jsonb_build_object('payments',jsonb_build_array(jsonb_build_object('id','payment-1','locationId','location-1',
    'status','COMPLETED','createdAt',context->'windowStart','updatedAt',context->'windowStart','amountMinor','1200','currency','USD')),
    'cursor','cursor-1','cursorBindingFingerprint','sha256:'||repeat('a',64),'cursorFingerprint','sha256:'||repeat('b',64));
  perform pg_temp.recurring_check((pg_temp.recurring_call('commit_page',payload)->>'hasMore')::boolean,'partial_page_committed');
  perform pg_temp.recurring_check((select last_synced_at is null and checkpoint_at is null and last_read_completed_at is null
    and cursor='cursor-1' from square_customer_private.connections where connection_id=cid),'partial_is_not_completed_freshness');
  scope:=jsonb_build_object('connectionId',cid,'leaseId',lid2);
  context:=pg_temp.recurring_call('claim',scope);
  perform pg_temp.recurring_check(context->>'cursor'='cursor-1' and (context->>'windowEnd')::timestamptz=initial_end,'cursor_window_resumed');
  perform pg_temp.recurring_call('authorize',scope);
  payload:=payload||scope;
  perform pg_temp.recurring_denied('commit_page',payload,'22023','duplicate_cursor_denied');
  perform pg_temp.recurring_check((select count(*)=1 from square_customer_private.payments where connection_id=cid),'failed_page_preserves_prior_facts');
  denied:=false;
  begin perform public.square_customer_recurring_v1('reconcile','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','sq0idp-native-recurring',scope);
  exception when insufficient_privilege then denied:=true; end;
  perform pg_temp.recurring_check(denied,'foreign_workspace_denied');
  payload:=jsonb_set(payload,'{payments,0,id}','"payment-2"')||jsonb_build_object('cursor',null,'cursorBindingFingerprint',null,'cursorFingerprint',null);
  perform pg_temp.recurring_check(not (pg_temp.recurring_call('commit_page',payload)->>'hasMore')::boolean,'final_page_committed');
  select last_synced_at into previous_success from square_customer_private.connections where connection_id=cid;
  perform pg_temp.recurring_check((select checkpoint_at=initial_end and last_synced_at is not null and last_read_kind='updated'
    and cursor is null and recurring_next_refresh_at>=last_synced_at+interval '59 minutes'
    from square_customer_private.connections where connection_id=cid),'only_completion_advances_success_and_hourly_schedule');
  perform pg_temp.recurring_check((select count(*)=2 and sum(amount_minor)=2400 from square_customer_private.payments where connection_id=cid),'payment_amounts_preserved_without_overlap_sum');
  perform pg_temp.recurring_denied('commit_page',payload,'42501','duplicate_commit_denied');
  perform pg_temp.recurring_check(not exists(select from public.square_customer_due_recurring_v1(20,array[wid],'sq0idp-native-recurring')),'hourly_delay_enforced');

  update square_customer_private.connections set recurring_next_refresh_at=clock_timestamp()-interval '1 second' where connection_id=cid;
  scope:=jsonb_build_object('connectionId',cid,'leaseId',lid);
  context:=pg_temp.recurring_call('claim',scope);
  perform pg_temp.recurring_check((context->>'windowStart')::timestamptz=initial_end-interval '5 minutes','next_window_has_bounded_overlap');
  perform pg_temp.recurring_call('authorize',scope);
  update public.workspace_members set status='disabled' where workspace_id=wid and user_id=actor;
  perform pg_temp.recurring_denied('authorize',scope,'42501','owner_revocation_blocks_provider_access');
  perform pg_temp.recurring_denied('commit_refresh',scope||jsonb_build_object('credentialVersion',1,'ciphertext',repeat('y',64),
    'accessExpiresAt',now()+interval '2 days'),'42501','owner_revocation_blocks_token_write');
  payload:=scope||jsonb_build_object('payments','[]'::jsonb,'cursor',null,'cursorBindingFingerprint',null,'cursorFingerprint',null);
  perform pg_temp.recurring_denied('commit_page',payload,'42501','owner_revocation_blocks_page_write');
  perform pg_temp.recurring_check((pg_temp.recurring_call('fail',scope||jsonb_build_object('reason','retry_required','retryAfterSeconds',7200))->>'recorded')::boolean,'revoked_work_cleanup_allowed');
  perform pg_temp.recurring_check((select last_synced_at=previous_success and credential_version=1 and ciphertext=repeat('x',64)
    and recurring_failure_count=1 and refresh_not_before>clock_timestamp()+interval '119 minutes'
    from square_customer_private.connections where connection_id=cid),'failure_retains_data_credentials_and_retry_after');
  update public.workspace_members set status='active' where workspace_id=wid and user_id=actor;
  insert into auth.sessions(id,user_id,not_after) values(sid,actor,now()+interval '1 day');
  denied:=false;
  begin perform public.square_customer_backend_v1('claim',actor,sid,wid,'sq0idp-native-recurring',scope);
  exception when sqlstate '55000' then denied:=true; end;
  perform pg_temp.recurring_check(denied,'manual_cannot_bypass_provider_backoff');
  update square_customer_private.connections set recurring_next_refresh_at=clock_timestamp()-interval '1 second',
    refresh_not_before=clock_timestamp()-interval '1 second' where connection_id=cid;
  perform pg_temp.recurring_call('claim',scope);
  update square_customer_private.connections set lease_expires_at=clock_timestamp()-interval '1 second' where connection_id=cid;
  perform pg_temp.recurring_check(public.square_customer_recover_recurring_v1(20,array[wid],'sq0idp-native-recurring')=1,'expired_scheduled_lease_recovers');
  perform pg_temp.recurring_check((select last_synced_at=previous_success and lease_id is null and recurring_failure_count=2
    from square_customer_private.connections where connection_id=cid),'recovery_does_not_mark_fresh');
  update public.business_entities set status='inactive' where id='dddddddd-2222-4222-8222-dddddddddddd';
  perform pg_temp.recurring_check(public.square_customer_recurring_status_v1(actor,sid,wid,'sq0idp-native-recurring',cid)->>'reason'='connection_unavailable','inactive_entity_status_inspectable');
  perform pg_temp.recurring_check(not (public.square_customer_set_recurring_v1(actor,sid,wid,'sq0idp-native-recurring',cid,false)->>'recurring_enabled')::boolean,'inactive_entity_can_disable');
end $flow$;
rollback;
