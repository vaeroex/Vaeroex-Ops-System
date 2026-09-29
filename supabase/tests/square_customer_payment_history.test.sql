-- Disposable PostgreSQL17 only, after exact Production106 and the additive history migration.
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
select pg_temp.check_true(pg_temp.call_backend('stage_credential',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','ciphertext',repeat('x',48),'merchantId','merchant_a','accessExpiresAt',now()+interval '1 day'))->>'credentialVersion'='1','credential_staged_before_discovery');
select pg_temp.check_true(pg_temp.call_backend('reconcile','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa"}')->>'ciphertext'=repeat('x',48),'stage_lost_ack_readback');
select pg_temp.denied('complete_must_match_staged_credential','complete_connect',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','ciphertext',repeat('q',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'),'a','a','a','22023');
select pg_temp.call_backend('complete_connect',jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','ciphertext',repeat('x',48),'merchantId','merchant_a','sellerLabel','Seller A','locations',jsonb_build_array(jsonb_build_object('id','location_a','label','A')),'accessExpiresAt',now()+interval '1 day'));
select pg_temp.check_true((pg_temp.call_backend('status')->'connections'->0->>'state')='mapping_required'
 and not ((pg_temp.call_backend('status')->'connections'->0) ? 'ciphertext'),'status_no_credentials');
select pg_temp.check_true((pg_temp.call_backend('status')->>'available')::boolean,'paid_status_available');
select pg_temp.denied('mapping_unverified_location','map','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","locationId":"location_other"}');
select pg_temp.call_backend('map','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","locationId":"location_a"}');
select pg_temp.denied('cross_workspace_connection_read','claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb"}','b','b','b');


-- The initial update read retains its original 30-day window and establishes a checkpoint.
select pg_temp.check_true((pg_temp.call_backend('status')->>'historyAvailable')::boolean,'history_capability_visible_after_migration');
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'='null'::jsonb,'history_no_fabricated_legacy_coverage');
select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"11111111-8888-4888-8888-aaaaaaaaaaaa"}');
reset role;
select pg_temp.check_true((select read_kind='updated' and window_end-window_start=interval '30 days'
 from square_customer_private.connections where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),'history_initial_read_keeps_30_day_updates');
set local role service_role;
select pg_temp.call_backend('fail','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"11111111-8888-4888-8888-aaaaaaaaaaaa","reason":"retry_required"}');

create function pg_temp.history_payload(lease uuid, starts timestamptz default now()-interval '120 days', ends timestamptz default now()-interval '89 days')
returns jsonb language sql as $$ select jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',
 'leaseId',lease,'windowStart',starts,'windowEnd',ends) $$;
select pg_temp.denied('history_preserves_unfinished_update','claim_history',pg_temp.history_payload('22222222-8888-4888-8888-aaaaaaaaaaaa'),'a','a','a','55000');
select pg_temp.check_true(pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"22222222-8888-4888-8888-aaaaaaaaaaaa"}')->>'readKind'='updated','history_retry_keeps_update_kind');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"22222222-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"22222222-8888-4888-8888-aaaaaaaaaaaa","payments":[],"cursor":null,"cursorBindingFingerprint":null,"cursorFingerprint":null}');
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'kind'='updated'
 and pg_temp.call_backend('status')->'connections'->0->'activeRead'='null'::jsonb,'history_updates_coverage_only_on_completion');
reset role;
create temp table history_connection_before as select * from square_customer_private.connections where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;

select pg_temp.denied('history_cross_workspace_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa'),'b','b','b');
select pg_temp.denied('history_over_31_days_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa',now()-interval '121 days',now()-interval '89 days'),'a','a','a','22023');
select pg_temp.denied('history_empty_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa',now()-interval '120 days',now()-interval '120 days'),'a','a','a','22023');
select pg_temp.denied('history_reversed_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa',now()-interval '89 days',now()-interval '120 days'),'a','a','a','22023');
select pg_temp.denied('history_future_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa',now(),now()+interval '1 day'),'a','a','a','22023');
select pg_temp.denied('history_nonfinite_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa','-infinity',now()-interval '89 days'),'a','a','a','22023');
select pg_temp.denied('history_null_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa',null,now()-interval '89 days'),'a','a','a','22023');
select pg_temp.denied('history_pre_epoch_range_denied','claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa','1969-12-31T00:00:00Z','1970-01-01T00:00:00Z'),'a','a','a','22023');
select pg_temp.check_true(pg_temp.call_backend('claim_history',pg_temp.history_payload('33333333-8888-4888-8888-aaaaaaaaaaaa'))->>'readKind'='created','history_exact_31_day_range_accepted');
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->'activeRead'->>'kind'='created'
 and (pg_temp.call_backend('status')->'connections'->0->'activeRead'->>'start')::timestamptz=now()-interval '120 days'
 and (pg_temp.call_backend('status')->'connections'->0->'activeRead'->>'end')::timestamptz=now()-interval '89 days','history_active_range_visible');
select pg_temp.denied('history_live_lease_blocks_updates','claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"44444444-8888-4888-8888-aaaaaaaaaaaa"}','a','a','a','55000');
select pg_temp.denied('history_live_lease_blocks_new_history','claim_history',pg_temp.history_payload('44444444-8888-4888-8888-aaaaaaaaaaaa'),'a','a','a','55000');
select pg_temp.denied('history_commit_requires_dispatch_authority','commit_page','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"33333333-8888-4888-8888-aaaaaaaaaaaa","payments":[],"cursor":null,"cursorBindingFingerprint":null,"cursorFingerprint":null}');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"33333333-8888-4888-8888-aaaaaaaaaaaa"}');

create function pg_temp.history_page(lease uuid, payment_id text, created timestamptz, updated timestamptz, amount text default '12345', page_cursor text default null)
returns jsonb language sql as $$ select jsonb_build_object('connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','leaseId',lease,
 'payments',jsonb_build_array(jsonb_build_object('id',payment_id,'locationId','location_a','status','COMPLETED',
   'createdAt',created,'updatedAt',updated,'amountMinor',amount,'currency','USD')),
 'cursor',page_cursor,'cursorBindingFingerprint',case when page_cursor is not null then 'sha256:'||repeat('c',64) end,
 'cursorFingerprint',case when page_cursor is not null then 'sha256:'||repeat('d',64) end) $$;
select pg_temp.denied('history_created_before_start_denied','commit_page',pg_temp.history_page('33333333-8888-4888-8888-aaaaaaaaaaaa','before_range',now()-interval '120 days 1 microsecond',now()-interval '1 hour'),'a','a','a','22023');
select pg_temp.denied('history_created_at_end_denied','commit_page',pg_temp.history_page('33333333-8888-4888-8888-aaaaaaaaaaaa','at_range_end',now()-interval '89 days',now()-interval '1 hour'),'a','a','a','22023');
select pg_temp.denied('history_created_after_end_denied','commit_page',pg_temp.history_page('33333333-8888-4888-8888-aaaaaaaaaaaa','after_range',now()-interval '89 days'+interval '1 microsecond',now()-interval '1 hour'),'a','a','a','22023');
select pg_temp.call_backend('commit_page',pg_temp.history_page('33333333-8888-4888-8888-aaaaaaaaaaaa','historical_payment',now()-interval '120 days',now()-interval '1 hour','12345','history_page_2'));
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'kind'='updated','history_partial_page_not_complete_coverage');
select pg_temp.denied('history_partial_window_not_replaceable','claim_history',pg_temp.history_payload('44444444-8888-4888-8888-aaaaaaaaaaaa'),'a','a','a','55000');
select pg_temp.denied('history_stale_page_replay_denied','commit_page',pg_temp.history_page('33333333-8888-4888-8888-aaaaaaaaaaaa','historical_payment',now()-interval '120 days',now()-interval '1 hour'));
select pg_temp.check_true(pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"44444444-8888-4888-8888-aaaaaaaaaaaa"}')->>'cursor'='history_page_2','history_default_read_resumes_cursor');
select pg_temp.call_backend('fail','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"44444444-8888-4888-8888-aaaaaaaaaaaa","reason":"retry_required"}');
select pg_temp.check_true(pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"55555555-8888-4888-8888-aaaaaaaaaaaa"}')->>'readKind'='created','history_failed_page_keeps_created_kind');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"55555555-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page',pg_temp.history_page('55555555-8888-4888-8888-aaaaaaaaaaaa','historical_payment',now()-interval '120 days',now()-interval '2 hours','11111','history_page_3'));
select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"66666666-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"66666666-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page',pg_temp.history_page('66666666-8888-4888-8888-aaaaaaaaaaaa','history_end_boundary',now()-interval '89 days 1 microsecond',now()-interval '1 hour'));
select pg_temp.check_true(pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'kind'='created'
 and (pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'start')::timestamptz=now()-interval '120 days'
 and (pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'end')::timestamptz=now()-interval '89 days'
 and pg_temp.call_backend('status')->'connections'->0->'activeRead'='null'::jsonb,'history_final_page_records_exact_coverage');
select pg_temp.check_true(jsonb_array_length(pg_temp.call_backend('status','{}','b','b','b')->'connections')=0,'history_saved_payment_not_visible_in_other_workspace');
reset role;
select pg_temp.check_true((select created_at=now()-interval '120 days' from square_customer_private.payments
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and payment_id='historical_payment')
 and (select created_at=now()-interval '89 days 1 microsecond' from square_customer_private.payments
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and payment_id='history_end_boundary'),'history_start_and_last_microsecond_included');
select pg_temp.check_true((select a.checkpoint_at=b.checkpoint_at and a.last_synced_at=b.last_synced_at
 and a.connection_id=b.connection_id and a.generation=b.generation and a.credential_version=b.credential_version
 and a.ciphertext=b.ciphertext and a.merchant_id=b.merchant_id and a.location_id=b.location_id
 and a.access_expires_at=b.access_expires_at
 from square_customer_private.connections a join history_connection_before b using(connection_id)),'history_preserves_connection_and_update_checkpoint');
select pg_temp.check_true((select count(*)=2 from square_customer_private.payments where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa')
 and (select amount_minor=12345 and updated_at=now()-interval '1 hour' from square_customer_private.payments
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa' and payment_id='historical_payment'),'history_repeated_older_payment_cannot_regress_newer_record');
set local role service_role;
select pg_temp.check_true(pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"77777777-8888-4888-8888-aaaaaaaaaaaa"}')->>'readKind'='updated','history_finished_import_returns_to_updates');
reset role;
select pg_temp.check_true((select a.window_start=b.checkpoint_at-interval '5 minutes' and a.checkpoint_at=b.checkpoint_at
 from square_customer_private.connections a join history_connection_before b using(connection_id)),'history_updates_resume_original_checkpoint');
set local role service_role;
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"77777777-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"77777777-8888-4888-8888-aaaaaaaaaaaa","payments":[],"cursor":null,"cursorBindingFingerprint":null,"cursorFingerprint":null}');
reset role;
update square_customer_private.connections set checkpoint_at=null,last_synced_at=null where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.call_backend('claim_history',pg_temp.history_payload('88888888-8888-4888-8888-aaaaaaaaaaaa'));
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"88888888-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"88888888-8888-4888-8888-aaaaaaaaaaaa","payments":[],"cursor":null,"cursorBindingFingerprint":null,"cursorFingerprint":null}');
reset role;
select pg_temp.check_true((select checkpoint_at is null and last_synced_at is null and last_read_kind='created' and last_read_completed_at is not null
 from square_customer_private.connections where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'),'history_empty_import_cannot_initialize_update_checkpoint');

-- A requested UTC calendar day includes every instant before the next midnight.
set local role service_role;
select pg_temp.call_backend('claim_history',pg_temp.history_payload('99999999-8888-4888-8888-aaaaaaaaaaaa','2026-05-04T00:00:00Z','2026-05-05T00:00:00Z'));
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"99999999-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.denied('history_next_midnight_excluded','commit_page',pg_temp.history_page('99999999-8888-4888-8888-aaaaaaaaaaaa','next_day_payment','2026-05-05T00:00:00Z','2026-05-05T12:00:00Z'),'a','a','a','22023');
select pg_temp.call_backend('commit_page',pg_temp.history_page('99999999-8888-4888-8888-aaaaaaaaaaaa','day_start_payment','2026-05-04T00:00:00Z','2026-05-05T12:00:00Z','12345','day_page_2'));
select pg_temp.call_backend('claim','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"bbbbbbbb-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('authorize','{"connectionId":"aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa","leaseId":"bbbbbbbb-8888-4888-8888-aaaaaaaaaaaa"}');
select pg_temp.call_backend('commit_page',pg_temp.history_page('bbbbbbbb-8888-4888-8888-aaaaaaaaaaaa','day_final_payment','2026-05-04T23:59:59.999999Z','2026-05-05T12:00:00Z'));
select pg_temp.check_true((pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'start')::timestamptz='2026-05-04T00:00:00Z'::timestamptz
 and (pg_temp.call_backend('status')->'connections'->0->'lastCompletedRead'->>'end')::timestamptz='2026-05-05T00:00:00Z'::timestamptz,'history_full_utc_day_coverage_recorded');
reset role;
select pg_temp.check_true((select count(*)=2 from square_customer_private.payments where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
 and payment_id in ('day_start_payment','day_final_payment'))
 and not exists(select from square_customer_private.payments where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
 and payment_id='next_day_payment'),'history_full_utc_day_boundary_payments_saved');
rollback;
