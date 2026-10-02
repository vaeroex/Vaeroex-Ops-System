-- Disposable PostgreSQL17 only. The focused runner starts the transaction with
-- square_customer_payment_browse.test.sql's original helpers and synthetic seed.
update square_customer_private.connections set merchant_id='merchant_a'
  where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
update square_customer_private.connections set merchant_id='merchant_a',location_id='location_a',
  locations='[{"id":"location_a","label":"Renamed location"}]',seller_label='Renamed seller',
  last_read_start='2026-05-04T00:00:00Z',last_read_end='2026-05-05T00:00:00Z',
  last_read_kind='created',last_read_completed_at='2026-09-29T04:00:00Z'
  where connection_id='aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';
update square_customer_private.payments set location_id='location_a'
  where connection_id='aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa';
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone) values
  ('aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','another-entity','Another entity','USD','UTC');

-- Same labels are intentionally reused across different authorities.
update square_customer_private.connections set merchant_id='merchant_a',seller_label='Current seller',
  location_id='location_a',locations='[{"id":"location_a","label":"Current location"}]'
  where connection_id::text like 'cccccccc-0000-4000-8000-%';
update square_customer_private.connections set merchant_id='merchant_b' where connection_id='cccccccc-0000-4000-8000-000000000002';
update square_customer_private.connections set location_id='location_b',locations='[{"id":"location_b","label":"Current location"}]'
  where connection_id='cccccccc-0000-4000-8000-000000000003';
update square_customer_private.connections set business_entity_id='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa'
  where connection_id='cccccccc-0000-4000-8000-000000000004';
update square_customer_private.connections set application_id='sq0idp-other-application' where connection_id='cccccccc-0000-4000-8000-000000000005';
update square_customer_private.connections set merchant_id=null where connection_id='cccccccc-0000-4000-8000-000000000006';
update square_customer_private.connections set seller_label=null where connection_id='cccccccc-0000-4000-8000-000000000007';
update square_customer_private.connections set location_id=null where connection_id='cccccccc-0000-4000-8000-000000000008';
update square_customer_private.connections set locations='[]' where connection_id='cccccccc-0000-4000-8000-000000000009';
update square_customer_private.connections set generation=2,created_at='2026-09-29T05:00:00Z'
  where connection_id='cccccccc-0000-4000-8000-000000000010';
update square_customer_private.connections set authorization_uncertain=true,merchant_id=null,seller_label=null,location_id=null,locations='[]'
  where connection_id='cccccccc-0000-4000-8000-000000000011';
update square_customer_private.connections set last_read_start='2026-09-01T00:00:00Z',last_read_end='2026-09-02T00:00:00Z',
  last_read_kind='created',last_read_completed_at='2026-09-29T05:00:00Z'
  where connection_id='cccccccc-0000-4000-8000-000000000012';
update square_customer_private.connections set state='disconnected',merchant_id='merchant_a',seller_label='Current seller',
  location_id='location_a',locations='[{"id":"location_a","label":"Current location"}]'
  where connection_id='bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb';

create function pg_temp.identity_option(cid uuid) returns jsonb language sql volatile as $$
  select row from jsonb_array_elements(pg_temp.browse()->'connections') row where row->>'connectionId'=cid::text
$$;
create temp table identity_before as select
  (select jsonb_agg(to_jsonb(c) order by connection_id) from square_customer_private.connections c) as connections,
  (select jsonb_agg(to_jsonb(p) order by connection_id,payment_id) from square_customer_private.payments p) as payments;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $identity$
declare original jsonb; history jsonb; attempt jsonb; key text; n integer;
begin
  original:=pg_temp.identity_option('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa');
  history:=pg_temp.identity_option('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa');
  key:=original->>'logicalIdentityKey';
  perform pg_temp.browse_check(key ~ '^[a-f0-9]{64}$','identity_sha256_shape');
  perform pg_temp.browse_check(history->>'logicalIdentityKey'=key,'identity_reconnect_and_renames_keep_lineage');
  perform pg_temp.browse_check(pg_temp.identity_option('cccccccc-0000-4000-8000-000000000001')->>'logicalIdentityKey'=key
    and pg_temp.identity_option('cccccccc-0000-4000-8000-000000000010')->>'logicalIdentityKey'=key,'identity_ignores_attempt_age_and_generation');
  for n in 2..5 loop
    attempt:=pg_temp.identity_option(('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
    perform pg_temp.browse_check(attempt->>'logicalIdentityKey'<>key,'identity_distinct_authority_'||n);
  end loop;
  for n in 6..9 loop
    attempt:=pg_temp.identity_option(('cccccccc-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
    perform pg_temp.browse_check(attempt->'logicalIdentityKey'='null'::jsonb,'identity_incomplete_discovery_'||n);
  end loop;
  perform pg_temp.browse_check(original->>'paymentCount'='375' and history->>'paymentCount'='1'
    and pg_temp.identity_option('cccccccc-0000-4000-8000-000000000001')->>'paymentCount'='0','identity_never_combines_saved_results');
  perform pg_temp.browse_check(history->'lastSyncedAt'='null'::jsonb and history->'checkpointAt'='null'::jsonb
    and history->'lastCompletedRead'->>'kind'='created'
    and (history->'lastCompletedRead'->>'completedAt')::timestamptz='2026-09-29T04:00:00Z','identity_history_own_success_without_update_checkpoint');
  attempt:=pg_temp.identity_option('cccccccc-0000-4000-8000-000000000012');
  perform pg_temp.browse_check(attempt->>'paymentCount'='0' and attempt->'lastCompletedRead'<>'null'::jsonb
    and pg_temp.identity_option('cccccccc-0000-4000-8000-000000000001')->'lastCompletedRead'='null'::jsonb,
    'identity_completed_empty_distinct_from_never_checked');
  perform pg_temp.browse_check(pg_temp.identity_option('cccccccc-0000-4000-8000-000000000011')->>'recoveryRequired'='true',
    'identity_historical_recovery_projected');
  perform pg_temp.browse_check(not exists(select from jsonb_array_elements(pg_temp.browse()->'connections') row
    where row ?| array['merchantId','locationId','applicationId','ciphertext','credentialVersion','cursor','leaseId','noChanges','changeCount']),
    'identity_no_raw_authority_credentials_or_invented_changes');
  perform pg_temp.browse_check(pg_temp.browse()::text not like '%merchant_a%'
    and pg_temp.browse()::text not like '%sq0idp-%','identity_raw_merchant_and_application_not_disclosed');
  select row into attempt from jsonb_array_elements(pg_temp.browse(null,1,null,null,'all','b','b','b')->'connections') row;
  perform pg_temp.browse_check(attempt->>'logicalIdentityKey'<>key,'identity_other_workspace_has_distinct_key');
end $identity$;
reset role;
select pg_temp.browse_check((select connections=(select jsonb_agg(to_jsonb(c) order by connection_id) from square_customer_private.connections c)
  and payments=(select jsonb_agg(to_jsonb(p) order by connection_id,payment_id) from square_customer_private.payments p)
  from identity_before),'identity_browse_does_not_mutate');

-- Completion and lifecycle metadata must match the existing current projection.
update square_customer_private.connections set authorization_uncertain=false where connection_id='cccccccc-0000-4000-8000-000000000011';
update square_customer_private.connections set window_start='2026-09-29T00:00:00Z',window_end='2026-09-29T01:00:00Z',
  cursor='page_two',cursor_binding_fingerprint='sha256:'||repeat('a',64),cursor_fingerprint='sha256:'||repeat('b',64),
  last_error='retry_required'
  where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
do $parity$
declare current_row jsonb; option_row jsonb; field text;
begin
  current_row:=pg_temp.browse()->'currentConnection';
  option_row:=pg_temp.identity_option('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa');
  foreach field in array array['lastSyncedAt','checkpointAt','lastCompletedRead','activeRead','hasMore','lastError','revocationPending','recoveryRequired'] loop
    perform pg_temp.browse_check(option_row->field is not distinct from current_row->field,'identity_current_parity_'||lower(field));
  end loop;
  perform pg_temp.browse_check(option_row->>'hasMore'='true' and option_row->'activeRead'->>'kind'='updated'
    and option_row->>'lastError'='retry_required','identity_partial_failed_read_not_success');
end $parity$;
reset role;
update square_customer_private.connections set state='disconnected',revocation_pending=true,ciphertext=repeat('x',64),
  credential_version=1,access_expires_at=now()+interval '1 day'
  where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.identity_option('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa')->>'revocationPending'='true'
  and pg_temp.browse()->'currentConnection'->>'connectionId'='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa',
  'identity_pending_revocation_remains_actionable');
reset role;
update square_customer_private.connections set state='disconnected',window_start=null,window_end=null,
  cursor=null,cursor_binding_fingerprint=null,cursor_fingerprint=null,revocation_pending=false,ciphertext=null,access_expires_at=null
  where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
set local role service_role;
select pg_temp.browse_check(pg_temp.browse()->'currentConnection'='null'::jsonb
  and pg_temp.identity_option('aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa')->'lastCompletedRead'<>'null'::jsonb
  and pg_temp.identity_option('aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa')->'lastSyncedAt'<>'null'::jsonb,
  'identity_fully_disconnected_keeps_per_attempt_success');
select pg_temp.browse_denied('identity_other_workspace_connection_denied','bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb');
select pg_temp.browse_denied('identity_wrong_session_denied',null,1,null,null,'all','a','a','b');
reset role;
update public.workspace_members set role='viewer' where user_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select pg_temp.browse_denied('identity_nonowner_denied');
reset role;
rollback;
