-- Disposable PostgreSQL17 only, after exact Production105 and the direct backend candidate.
begin;
set search_path=public,extensions;

create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'square_backend_test_failed:%',label; end if;
  raise notice 'square_backend_test_passed:%',label;
end $$;
create function pg_temp.call_backend(op text,payload jsonb default '{}'::jsonb,actor text default 'a',workspace text default 'a',session_name text default 'a',application text default 'sq0idp-direct-fixture')
returns jsonb language sql volatile as $$
  select public.square_customer_backend_v1(op,
    case actor when 'a' then '11111111-1111-4111-8111-111111111111'::uuid else '22222222-2222-4222-8222-222222222222'::uuid end,
    case session_name when 'a' then 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'::uuid when 'b' then 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb'::uuid else 'cccccccc-4444-4444-8444-cccccccccccc'::uuid end,
    case workspace when 'a' then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid else 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid end,
    application,payload)
$$;
create function pg_temp.denied(label text,op text,payload jsonb default '{}'::jsonb,actor text default 'a',workspace text default 'a',session_name text default 'a',code text default '42501')
returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin perform pg_temp.call_backend(op,payload,actor,workspace,session_name);
  exception when others then if sqlstate=code then rejected:=true; else raise; end if; end;
  perform pg_temp.check_true(rejected,label);
end $$;

do $catalog$
declare n text;
begin
  foreach n in array array['configuration','connections','oauth_states','payments'] loop
    perform pg_temp.check_true(exists(select from pg_class c join pg_namespace s on s.oid=c.relnamespace
      where s.nspname='square_customer_private' and c.relname=n and c.relowner='postgres'::regrole
        and c.relrowsecurity and c.relforcerowsecurity and c.relkind='r'),'force_rls_owner_'||n);
    perform pg_temp.check_true(not has_table_privilege('service_role','square_customer_private.'||n,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated','square_customer_private.'||n,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('anon','square_customer_private.'||n,'SELECT,INSERT,UPDATE,DELETE'),'no_table_grants_'||n);
  end loop;
  perform pg_temp.check_true(not has_schema_privilege('service_role','square_customer_private','USAGE')
    and not has_schema_privilege('authenticated','square_customer_private','USAGE'),'private_schema_closed');
  perform pg_temp.check_true(has_function_privilege('service_role','public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('anon','public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('square_production_oauth_authority','public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','EXECUTE'),'only_existing_backend_execute');
  perform pg_temp.check_true(not (select enabled from square_customer_private.configuration),'installation_closed');
end $catalog$;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
 ('11111111-1111-4111-8111-111111111111','square-direct-a@example.invalid','{}','{}',now(),now()),
 ('22222222-2222-4222-8222-222222222222','square-direct-b@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,email,full_name) values
 ('11111111-1111-4111-8111-111111111111','square-direct-a@example.invalid','Direct A'),
 ('22222222-2222-4222-8222-222222222222','square-direct-b@example.invalid','Direct B') on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Direct A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Direct B','22222222-2222-4222-8222-222222222222');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner','active');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by) values
 ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','direct-a','Direct A','USD','UTC','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','direct-b','Direct B','USD','UTC','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
insert into auth.sessions(id,user_id,not_after) values
 ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
 ('bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',now()+interval '1 day'),
 ('cccccccc-4444-4444-8444-cccccccccccc','11111111-1111-4111-8111-111111111111',now()-interval '1 second');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.denied('authenticated_cannot_call_backend','status');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.denied('backend_claim_required','status');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.denied('workspace_isolation','status','{}','a','b','a');
select pg_temp.denied('actor_session_binding','status','{}','b','b','a');
select pg_temp.denied('expired_session','status','{}','a','a','expired');
select pg_temp.denied('unpaid_owner_denied','begin',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','stateHash','sha256:'||repeat('a',64)));
reset role;
insert into public.customer_subscriptions(user_id,workspace_id,customer_email,status,billing_provider,current_period_end,stripe_customer_id,stripe_subscription_id,manually_activated) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','square-direct-a@example.invalid','active','stripe',now()+interval '1 month','cus_direct_a','sub_direct_a',false),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','square-direct-b@example.invalid','active','stripe',now()+interval '1 month','cus_direct_b','sub_direct_b',false);
set local role service_role;
select pg_temp.denied('gate_closed','begin',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','stateHash','sha256:'||repeat('a',64)));
reset role;
update square_customer_private.configuration set enabled=true,application_id='sq0idp-direct-fixture';
set local role service_role;
select pg_temp.check_true(pg_temp.call_backend('begin',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','stateHash','sha256:'||repeat('a',64)))->>'state'='consent_pending','begin_owner_bound');
select pg_temp.denied('one_live_workspace','begin',jsonb_build_object('connectionId','aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa','businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','stateHash','sha256:'||repeat('c',64)),'a','a','a','23505');
select pg_temp.denied('callback_cross_workspace','consume',jsonb_build_object('stateHash','sha256:'||repeat('a',64),'leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa'),'b','b','b');
select pg_temp.check_true(pg_temp.call_backend('consume',jsonb_build_object('stateHash','sha256:'||repeat('a',64),'leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa'))->>'state'='exchanging','state_consumed_once');
select pg_temp.denied('callback_replay_denied','consume',jsonb_build_object('stateHash','sha256:'||repeat('a',64),'leaseId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'));
select pg_temp.denied('unauthorized_commit_denied','complete_connect',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','ciphertext',repeat('x',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'));
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa"}');
select pg_temp.call_backend('complete_connect',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','ciphertext',repeat('x',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'));
select pg_temp.check_true((pg_temp.call_backend('status')->'connections'->0->>'state')='mapping_required'
 and not ((pg_temp.call_backend('status')->'connections'->0) ? 'ciphertext'),'status_no_credentials');
select pg_temp.denied('mapping_unverified_location','map','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","locationId":"location_other"}');
select pg_temp.call_backend('map','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","locationId":"location_a"}');
select pg_temp.denied('cross_workspace_connection_read','claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb"}','b','b','b');

select pg_temp.call_backend('begin',jsonb_build_object('connectionId','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','businessEntityId','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','stateHash','sha256:'||repeat('b',64)),'b','b','b');
select pg_temp.call_backend('consume',jsonb_build_object('stateHash','sha256:'||repeat('b',64),'leaseId','bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb'),'b','b','b');
select pg_temp.call_backend('authorize','{"connectionId":"bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb","leaseId":"bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb"}','b','b','b');
select pg_temp.denied('seller_exclusive_across_workspaces','complete_connect',jsonb_build_object('connectionId','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','leaseId','bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb','ciphertext',repeat('b',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'),'b','b','b','23505');

select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.denied('concurrent_claim_blocked','claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa"}','a','a','a','55000');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.check_true((pg_temp.call_backend('commit_refresh',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','credentialVersion',2,'ciphertext',repeat('y',48),'accessExpiresAt',now()+interval '1 day'))->>'credentialVersion')::integer=2,'refresh_version_2');
select pg_temp.denied('stale_refresh_cas','commit_refresh',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','credentialVersion',2,'ciphertext',repeat('z',48),'accessExpiresAt',now()+interval '1 day'));
select pg_temp.check_true((pg_temp.call_backend('commit_refresh',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','credentialVersion',3,'ciphertext',repeat('z',48),'accessExpiresAt',now()+interval '1 day'))->>'credentialVersion')::integer=3,'renewal_not_limited_to_version_2');
select pg_temp.check_true(pg_temp.call_backend('reconcile','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}')->>'ciphertext'=repeat('z',48),'lost_ack_reconciles_exact_stored_ciphertext');
select pg_temp.call_backend('commit_page',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa',
 'payments',jsonb_build_array(
   jsonb_build_object('id','payment_1','locationId','location_a','status','COMPLETED','createdAt',now()-interval '1 day','updatedAt',now()-interval '1 hour','amountMinor','1234','currency','USD'),
   jsonb_build_object('id','payment_2','locationId','location_a','status','UNKNOWN','createdAt',now()-interval '1 day','updatedAt',now()-interval '1 hour','amountMinor',null,'currency',null)),
 'cursor','cursor_page_2','cursorBindingFingerprint','sha256:'||repeat('c',64),'cursorFingerprint','sha256:'||repeat('d',64)));
select pg_temp.denied('page_commit_replay_fenced','commit_page','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa","payments":[],"cursor":null,"cursorBindingFingerprint":null,"cursorFingerprint":null}');
reset role;
select pg_temp.check_true((select checkpoint_at is null and cursor='cursor_page_2' from square_customer_private.connections where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'checkpoint_not_advanced_before_final_page');
set local role service_role;
select pg_temp.check_true(pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa"}')->>'cursor'='cursor_page_2','pagination_resumes_same_cursor');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa',
 'payments',jsonb_build_array(jsonb_build_object('id','payment_1','locationId','location_a','status','COMPLETED','createdAt',now()-interval '1 day','updatedAt',now()-interval '1 hour','amountMinor','1234','currency','USD')),
 'cursor',null,'cursorBindingFingerprint',null,'cursorFingerprint',null));
select pg_temp.check_true(jsonb_array_length(pg_temp.call_backend('status')->'connections'->0->'payments')=2,'overlap_payments_idempotent');
select pg_temp.check_true(exists(select from jsonb_array_elements(pg_temp.call_backend('status')->'connections'->0->'payments') p
  where p->>'id'='payment_2' and p->>'status'='UNKNOWN' and p->'amountMinor'='null'::jsonb and p->'currency'='null'::jsonb),'missing_provider_fields_remain_unknown');
select pg_temp.check_true(jsonb_array_length(pg_temp.call_backend('status','{}','b','b','b')->'connections'->0->'payments')=0,'payments_workspace_isolation');
reset role;
select pg_temp.check_true((select checkpoint_at is not null and window_start is null and cursor is null from square_customer_private.connections where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'checkpoint_advanced_final_page');
update square_customer_private.connections set checkpoint_at=now()-interval '70 days'
 where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"cccccccc-9999-4999-8999-cccccccccccc"}');
reset role;
select pg_temp.check_true((select window_end-window_start=interval '31 days' and window_end<now()-interval '30 days'
 from square_customer_private.connections where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'long_absence_catches_up_bounded_window');
update square_customer_private.connections set lease_expires_at=now()-interval '1 second'
 where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->>'state'='retry_required','expired_read_lease_actionable');
reset role;
set local role service_role;
select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"dddddddd-9999-4999-8999-dddddddddddd"}');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"dddddddd-9999-4999-8999-dddddddddddd"}');
reset role;
update public.customer_subscriptions set current_period_end=now()-interval '1 day' where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.denied('expiry_blocks_provider_dispatch','authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"dddddddd-9999-4999-8999-dddddddddddd"}');
select pg_temp.check_true(pg_temp.call_backend('disconnect','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"eeeeeeee-9999-4999-8999-eeeeeeeeeeee"}')->>'state'='disconnected','expired_subscription_disconnect_fences_live_work');
select pg_temp.denied('old_commit_after_disconnect_denied','commit_refresh',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','dddddddd-9999-4999-8999-dddddddddddd','credentialVersion',4,'ciphertext',repeat('q',48),'accessExpiresAt',now()+interval '1 day'));
select pg_temp.call_backend('authorize_disconnect','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"eeeeeeee-9999-4999-8999-eeeeeeeeeeee"}');
select pg_temp.denied('pending_revoke_keeps_merchant_reserved','complete_connect',jsonb_build_object('connectionId','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','leaseId','bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb','ciphertext',repeat('b',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'),'b','b','b','23505');
select pg_temp.denied('duplicate_disconnect_lease_busy','disconnect','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"ffffffff-9999-4999-8999-ffffffffffff"}','a','a','a','55000');
select pg_temp.call_backend('complete_disconnect','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"eeeeeeee-9999-4999-8999-eeeeeeeeeeee"}');
reset role;
select pg_temp.check_true((select ciphertext is null and not revocation_pending and lease_id is null from square_customer_private.connections where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'revoke_ack_clears_ciphertext_and_lease');
select pg_temp.check_true(not exists(select from private.square_production_customer_connections)
 and not exists(select from private.square_production_customer_bindings),'native_customer_contract_unchanged');
rollback;
