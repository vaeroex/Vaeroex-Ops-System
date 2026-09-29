-- Disposable PostgreSQL17 only: stored-record pagination never dispatches a provider request.
begin;
set search_path=public,extensions;
create function pg_temp.browse_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'square_backend_test_failed:%',label; end if;
  raise notice 'square_backend_test_passed:%',label;
end $$;
create function pg_temp.browse(cid uuid default null, page_number integer default 1, starts text default null,
  ends text default null, selected_status text default 'all', who text default 'a', workspace text default 'a', session_name text default 'a')
returns jsonb language sql volatile as $$
 select public.square_customer_payments_v1(
  case who when 'a' then '11111111-1111-4111-8111-111111111111'::uuid else '22222222-2222-4222-8222-222222222222'::uuid end,
  case session_name when 'a' then 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'::uuid when 'b' then 'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb'::uuid else 'cccccccc-4444-4444-8444-cccccccccccc'::uuid end,
  case workspace when 'a' then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid else 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid end,
  cid,page_number,starts,ends,selected_status)
$$;
create function pg_temp.browse_denied(label text,cid uuid default null,page_number integer default 1,starts text default null,
  ends text default null, selected_status text default 'all',who text default 'a',workspace text default 'a',session_name text default 'a',code text default '42501')
returns void language plpgsql as $$
declare rejected boolean:=false;
begin
  begin perform pg_temp.browse(cid,page_number,starts,ends,selected_status,who,workspace,session_name);
  exception when others then if sqlstate=code then rejected:=true; else raise; end if; end;
  perform pg_temp.browse_check(rejected,label);
end $$;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
 ('11111111-1111-4111-8111-111111111111','browse-a@example.invalid','{}','{}',now(),now()),
 ('22222222-2222-4222-8222-222222222222','browse-b@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,email,full_name) values
 ('11111111-1111-4111-8111-111111111111','browse-a@example.invalid','Browse A'),
 ('22222222-2222-4222-8222-222222222222','browse-b@example.invalid','Browse B') on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Browse A','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Browse B','22222222-2222-4222-8222-222222222222');
insert into public.workspace_members(workspace_id,user_id,role,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner','active');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by) values
 ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','browse-a','Browse A','USD','America/Los_Angeles','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','browse-b','Browse B','USD','UTC','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
insert into auth.sessions(id,user_id,not_after) values
 ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
 ('bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',now()+interval '1 day'),
 ('cccccccc-4444-4444-8444-cccccccccccc','11111111-1111-4111-8111-111111111111',now()-interval '1 second');

insert into square_customer_private.connections(connection_id,workspace_id,business_entity_id,application_id,state,
  seller_label,location_id,locations,checkpoint_at,last_synced_at,created_at) values
 ('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','sq0idp-browse-fixture','connected',
  'Current seller','location_a','[{"id":"location_a","label":"Current location"}]','2026-09-29T03:56:39Z','2026-09-29T03:56:40Z','2026-01-01T00:00:00Z'),
 ('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','sq0idp-browse-fixture','disconnected',
  'Previous seller','location_history','[{"id":"location_history","label":"Previous location"}]',null,null,'2026-08-01T00:00:00Z'),
 ('bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','sq0idp-browse-fixture','connected',
  'Other workspace seller','location_b','[{"id":"location_b","label":"Other location"}]',null,null,'2026-09-01T00:00:00Z');
-- 40 disconnected attempts exercise history beyond the old status limit of 32.
insert into square_customer_private.connections(connection_id,workspace_id,business_entity_id,application_id,state,created_at)
 select ('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','sq0idp-browse-fixture','disconnected','2026-07-01T00:00:00Z'::timestamptz+n*interval '1 minute'
 from generate_series(1,40) n;

-- 375 rows: tied creation times span many pages. Updated times deliberately vary
-- independently, proving the browser sorts the displayed payment date.
insert into square_customer_private.payments(workspace_id,connection_id,payment_id,location_id,status,created_at,updated_at,amount_minor,currency)
 select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','payment_'||lpad(n::text,4,'0'),'location_a',
 case when n%3=0 then 'FAILED' else 'COMPLETED' end,'2026-05-05T04:43:11Z'::timestamptz+(n/50)*interval '1 day',
 '2026-09-01T00:00:00Z'::timestamptz+n*interval '1 minute',case when n%3=0 then 400000 else n*100 end,'USD'
 from generate_series(1,375) n;
insert into square_customer_private.payments(workspace_id,connection_id,payment_id,location_id,status,created_at,updated_at,amount_minor,currency) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa','historic_saved','location_history','COMPLETED','2025-01-01T12:00:00Z','2025-01-01T12:00:00Z',12345,'USD'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb','other_workspace_payment','location_b','COMPLETED','2026-05-05T04:43:11Z','2026-05-05T04:43:11Z',76543,'USD');
create temp table browse_before as select
 (select jsonb_agg(to_jsonb(c) order by connection_id) from square_customer_private.connections c) as connections,
 (select jsonb_agg(to_jsonb(p) order by connection_id,payment_id) from square_customer_private.payments p) as payments,
 (select jsonb_agg(to_jsonb(s) order by state_hash) from square_customer_private.oauth_states s) as oauth,
 (select to_jsonb(c) from square_customer_private.configuration c) as configuration;

select pg_temp.browse_check(has_function_privilege('service_role','public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)','EXECUTE'),'browse_service_only_grant');
select pg_temp.browse_check(not has_table_privilege('service_role','square_customer_private.payments','SELECT')
 and (select relrowsecurity and relforcerowsecurity from pg_class where oid='square_customer_private.payments'::regclass),'browse_private_table_stays_closed');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.browse_denied('browse_authenticated_cannot_call');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.browse_denied('browse_service_claim_required');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.browse_denied('browse_owner_workspace_isolation',null,1,null,null,'all','a','b','a');
select pg_temp.browse_denied('browse_session_actor_binding',null,1,null,null,'all','b','b','a');
select pg_temp.browse_denied('browse_expired_session',null,1,null,null,'all','a','a','expired');
select pg_temp.browse_denied('browse_cross_workspace_connection','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb');
select pg_temp.browse_denied('browse_null_page',null,null,null,null,'all','a','a','a','22023');
select pg_temp.browse_denied('browse_zero_page',null,0,null,null,'all','a','a','a','22023');
select pg_temp.browse_denied('browse_negative_page',null,-1,null,null,'all','a','a','a','22023');
select pg_temp.browse_denied('browse_bad_status',null,1,null,null,'success','a','a','a','22023');
select pg_temp.browse_denied('browse_null_status',null,1,null,null,null,'a','a','a','22023');
select pg_temp.browse_denied('browse_bad_date_format',null,1,'05/04/2026',null,'all','a','a','a','22023');
select pg_temp.browse_denied('browse_nonexistent_calendar_day',null,1,'2026-02-30',null,'all','a','a','a','22023');
select pg_temp.browse_denied('browse_reversed_dates',null,1,'2026-05-06','2026-05-04','all','a','a','a','22023');
select pg_temp.browse_denied('browse_pre_epoch_date',null,1,null,'1969-12-31','all','a','a','a','22023');

do $pages$
declare result jsonb; seen text[]:='{}'; expected text[]; n integer;
begin
 result:=pg_temp.browse();
 perform pg_temp.browse_check(result->>'connectionId'='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','browse_current_before_newer_disconnected');
 perform pg_temp.browse_check(result->'currentConnection'->>'connectionId'='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
  and result->'currentConnection'->'payments'='[]'::jsonb,'browse_actionable_current_outside_old_status_32_limit');
 perform pg_temp.browse_check(result->>'timeZone'='America/Los_Angeles','browse_business_timezone');
 perform pg_temp.browse_check(result->>'totalCount'='375' and result->>'totalPages'='15' and jsonb_array_length(result->'payments')=25,'browse_375_records_15_pages');
 perform pg_temp.browse_check(jsonb_array_length(result->'connections')=42,'browse_all_connection_history_not_truncated');
 perform pg_temp.browse_check(result::text not like '%Other workspace%' and result::text not like '%other_workspace_payment%' and result::text not like '%ciphertext%','browse_no_other_workspace_or_credentials');
 for n in 1..15 loop
   result:=pg_temp.browse(null,n);
   perform pg_temp.browse_check(jsonb_array_length(result->'payments')=25,'browse_page_'||n||'_25_rows');
   select seen||array_agg(p->>'id' order by ord) into seen from jsonb_array_elements(result->'payments') with ordinality t(p,ord);
 end loop;
 perform pg_temp.browse_check(cardinality(seen)=375 and (select count(distinct value) from unnest(seen) value)=375,'browse_pages_no_duplicates_or_omissions');
 perform pg_temp.browse_check(pg_temp.browse(null,2147483647)->>'page'='15','browse_stale_page_clamps_to_last');
 perform pg_temp.browse_check(pg_temp.browse(null,1,null,null,'COMPLETED')->>'totalCount'='250'
  and pg_temp.browse(null,1,null,null,'FAILED')->>'totalCount'='125','browse_status_filter_across_all_375');
 perform pg_temp.browse_check(pg_temp.browse(null,1,'2026-05-04','2026-05-04')->>'totalCount'='49','browse_inclusive_business_local_date');
 perform pg_temp.browse_check(pg_temp.browse(null,1,'2026-05-04','2026-05-04','FAILED')->>'totalCount'='16','browse_combined_date_status_before_pagination');
 perform pg_temp.browse_check(pg_temp.browse(null,1,'2026-05-20','2026-05-20')->>'totalCount'='0'
  and pg_temp.browse(null,999,'2026-05-20','2026-05-20')->>'page'='1','browse_empty_date_range_keeps_filters');
 result:=pg_temp.browse('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa');
 perform pg_temp.browse_check(result->>'totalCount'='1' and result->'payments'->0->>'id'='historic_saved','browse_disconnected_saved_records');
 perform pg_temp.browse_check(result->>'pageSize'='25' and result->'filters'->>'status'='all','browse_fixed_size_and_filter_contract');
end $pages$;
reset role;
-- Prove deterministic order against the full SQL result, not static markup.
do $order$
declare actual text[]:='{}'; expected text[]; result jsonb; n integer;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 for n in 1..15 loop
   result:=pg_temp.browse(null,n);
   select actual||array_agg(p->>'id' order by ord) into actual from jsonb_array_elements(result->'payments') with ordinality t(p,ord);
 end loop;
 select array_agg(payment_id order by created_at desc,payment_id) into expected
   from square_customer_private.payments where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
 perform pg_temp.browse_check(actual=expected,'browse_tie_breaker_matches_full_dataset');
end $order$;
select pg_temp.browse_check((select connections=(select jsonb_agg(to_jsonb(c) order by connection_id) from square_customer_private.connections c)
 and payments=(select jsonb_agg(to_jsonb(p) order by connection_id,payment_id) from square_customer_private.payments p)
 and oauth is not distinct from (select jsonb_agg(to_jsonb(s) order by state_hash) from square_customer_private.oauth_states s)
 and configuration=(select to_jsonb(c) from square_customer_private.configuration c) from browse_before),'browse_no_connection_checkpoint_credential_or_data_mutation');

-- Spring and fall day bounds use configured local midnights, including their
-- unequal UTC lengths. Adjacent-day boundary rows must not leak into results.
insert into square_customer_private.payments(workspace_id,connection_id,payment_id,location_id,status,created_at,updated_at,amount_minor,currency)
 select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',id,'location_a','PENDING',ts,ts,1,'USD'
 from (values ('spring_before','2026-03-08T07:59:59Z'::timestamptz),('spring_start','2026-03-08T08:00:00Z'::timestamptz),
 ('spring_end','2026-03-09T06:59:59Z'::timestamptz),('spring_after','2026-03-09T07:00:00Z'::timestamptz),
 ('fall_before','2026-11-01T06:59:59Z'::timestamptz),('fall_start','2026-11-01T07:00:00Z'::timestamptz),
 ('fall_end','2026-11-02T07:59:59Z'::timestamptz),('fall_after','2026-11-02T08:00:00Z'::timestamptz)) t(id,ts);
set local role service_role;
select pg_temp.browse_check(pg_temp.browse(null,1,'2026-03-08','2026-03-08','PENDING')->>'totalCount'='2','browse_spring_dst_23_hour_day');
select pg_temp.browse_check(pg_temp.browse(null,1,'2026-11-01','2026-11-01','PENDING')->>'totalCount'='2','browse_fall_dst_25_hour_day');
reset role;
-- Bring the same current row into the existing status window solely to compare
-- the exact sanitized projection. Entitlement and activation remain disabled.
update square_customer_private.connections set created_at=clock_timestamp(),
 last_read_start='2026-05-04T00:00:00Z',last_read_end='2026-05-06T00:00:00Z',last_read_kind='created',last_read_completed_at='2026-09-29T03:58:00Z',
 window_start='2026-09-29T00:00:00Z',window_end='2026-09-29T01:00:00Z'
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'=
 ((public.square_customer_backend_v1('status','11111111-1111-4111-8111-111111111111','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sq0idp-browse-fixture','{}')->'connections'->0)-'payments')||jsonb_build_object('payments','[]'::jsonb),
 'browse_current_projection_matches_existing_status_without_credential_or_payment_payload');
reset role;
update square_customer_private.connections set state='syncing',lease_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 lease_expires_at=clock_timestamp()-interval '1 minute',lease_actor_id='11111111-1111-4111-8111-111111111111',lease_session_id='aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'->>'state'='retry_required','browse_current_expired_read_status_parity');
reset role;
update square_customer_private.connections set state='exchanging' where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'->>'state'='reauthorization_required','browse_current_expired_oauth_status_parity');
reset role;
update square_customer_private.connections set state='disconnected',authorization_uncertain=true,lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'->>'recoveryRequired'='true'
 and pg_temp.browse()->>'connectionId'='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','browse_unconfirmed_disconnected_recovery_remains_actionable_context');
reset role;
update square_customer_private.connections set authorization_uncertain=false,created_at='2026-01-01T00:00:00Z'
 where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
update square_customer_private.connections set state='disconnected' where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->>'connectionId'='aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa','browse_default_latest_when_all_disconnected');
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'='null'::jsonb,'browse_no_actionable_context_when_fully_disconnected');
reset role;
update public.workspace_members set role='member' where user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select pg_temp.browse_denied('browse_nonowner_denied');
reset role;
rollback;
