-- Only after the customer qualification's disposable, committed fixture.
begin;
do $runtime_fixture$
begin
 if not exists(select from private.integration_production_provider_secrets where provider_key='square'
  and environment='production' and project_id='vaeroex-integrations-prod' and secret_purpose='database_runtime'
  and secret_version_resource='projects/vaeroex-integrations-prod/secrets/square-production-runtime-db/versions/1') then
  raise exception 'customer_read_fixture_runtime_secret_contract_mismatch';
 end if;
end $runtime_fixture$;
create role square_production_broker login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role square_production_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant square_production_broker_authority to square_production_broker with admin false,inherit true,set false;
grant square_production_runtime_authority to square_production_runtime with admin false,inherit true,set false;
update private.square_production_customer_bindings set consent_enabled=true where generation=1;
insert into private.square_production_workspace_read_bindings select generation,configuration_fingerprint,true
 from private.square_production_customer_bindings where generation=1;
-- A later connection transition must fail before any discovered location is
-- written. Restore only this disposable fixture after the native denial.
update private.square_production_customer_connections set row_version=row_version+1
 where connection_id='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';
commit;
-- customer-read-native-session:broker
do $stale_locations$
declare denied boolean:=false;
begin
 begin perform public.square_production_workspace_read_v1('store_locations',jsonb_build_object(
  'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa',
  'requestFingerprint','sha256:e37e414510d5af07acffbbc96abc3e7e9cb9240514b9cf456a4ba6bc5b80ec1b',
  'locations',jsonb_build_array(jsonb_build_object('id','location_customer_a','label','Verified customer location'))));
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_stale_location_transition_allowed';end if;
end $stale_locations$;
-- customer-read-native-session:admin
update private.square_production_customer_connections set row_version=row_version-1
 where connection_id='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';
-- customer-read-native-session:broker
do $locations$
declare state_uuid uuid:='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa'; credential_uuid uuid:='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
declare connection_uuid uuid:='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'; aad_hash text; aad jsonb; denied boolean:=false;
begin
 if pg_has_role(session_user,'square_production_broker_authority','SET') then raise exception 'customer_read_native_set_allowed'; end if;
 if public.square_production_workspace_read_v1('store_locations',jsonb_build_object('stateId',state_uuid,
  'requestFingerprint','sha256:e37e414510d5af07acffbbc96abc3e7e9cb9240514b9cf456a4ba6bc5b80ec1b',
  'locations',jsonb_build_array(jsonb_build_object('id','location_customer_a','label','Verified customer location'))))->>'stored'<>'true'
  then raise exception 'customer_read_locations_failed'; end if;
end $locations$;
-- customer-read-native-session:admin
-- Only the disposable fixture prepares encrypted synthetic data. The real
-- broker commit path is separately covered by the existing consent suite.
insert into private.square_production_customer_credentials(
 credential_id,credential_version,connection_id,oauth_state_id,generation,ciphertext_base64,aad_context,aad_digest,kms_key_resource,
 merchant_id,granted_scopes,command_fingerprint,provider_issued_at,access_expires_at,created_at)
values('aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa',1,'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa',1,
 'c3ludGhldGljIGVuY3J5cHRlZA==','{}','sha256:'||repeat('a',64),
 'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials','seller_customer_a',
 array['INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'],'sha256:'||repeat('b',64),now()-interval '2 days',now()-interval '1 day',now());
update private.square_production_customer_connections set state='mapping_required',credential_id='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa',credential_version=1,
 merchant_id='seller_customer_a',seller_label='Customer seller',row_version=row_version+1,updated_at=now()
where connection_id='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa';
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
do $owner$
declare location_hash text; view jsonb; denied boolean:=false;
begin
 view:=public.square_production_workspace_read_v1('status','{"workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","connectionId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
 if view::text like '%location_customer_a%' or jsonb_array_length(view->'locations')<>1 then raise exception 'customer_read_location_privacy_failed'; end if;
 location_hash:=view->'locations'->0->>'fingerprint';
 if public.square_production_workspace_read_v1('map',jsonb_build_object('workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','locationFingerprint',location_hash))->>'mapped'<>'true' then raise exception 'customer_read_map_failed'; end if;
 perform public.square_production_workspace_read_v1('map',jsonb_build_object('workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','locationFingerprint',location_hash));
 begin
  perform public.square_production_workspace_read_v1('status','{"workspaceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","connectionId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'customer_read_cross_workspace_allowed'; end if;
 view:=public.square_production_workspace_read_v1('start',jsonb_build_object('workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','scanId','aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa','windowStart',now()-interval '24 hours','windowEnd',now()));
 if view->>'status'<>'ready' then raise exception 'customer_read_start_failed'; end if;
 perform public.square_production_workspace_read_v1('start',jsonb_build_object('workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','scanId','bbbbbbbb-abcd-4bcd-8bcd-bbbbbbbbbbbb','windowStart',now()-interval '1 hour','windowEnd',now()));
end $owner$;
reset role;commit;
-- A different workspace's older queued request loses session authority.
-- Only this disposable admin fixture seeds its formerly admitted state.
update private.square_production_customer_connections set state='mapping_required',
 credential_id='bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb',credential_version=1,merchant_id='seller_customer_b',seller_label='Customer B'
 where connection_id='bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb';
insert into private.square_production_workspace_locations values('bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb',1,
 'sha256:'||repeat('b',64),'location_customer_b','Customer B location',now());
insert into private.square_production_workspace_mappings values('bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb',1,
 'sha256:'||repeat('b',64),'sha256:'||repeat('b',64),now());
insert into private.square_production_workspace_scans(scan_id,connection_id,generation,workspace_id,business_entity_id,actor_id,session_id,
 connection_row_version,mapping_fingerprint,window_start,window_end,status,created_at)
 select 'bbbbbbbb-abcd-4bcd-8bcd-bbbbbbbbbbbb',connection_id,generation,workspace_id,business_entity_id,actor_id,session_id,
 row_version,'sha256:'||repeat('b',64),now()-interval '1 hour',now(),'ready',now()-interval '1 day'
 from private.square_production_customer_connections where connection_id='bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb';
update auth.sessions set not_after=now()-interval '1 second' where id='bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb';
-- customer-read-native-session:runtime
do $claim$
declare result jsonb; denied boolean:=false;
begin
 result:=public.square_production_workspace_read_v1('claim','{"leaseId":"cccccccc-eeee-4eee-8eee-cccccccccccc","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
 if result is distinct from '{"status":"quarantined"}'::jsonb then raise exception 'customer_read_expired_claim_not_quarantined';end if;
 result:=public.square_production_workspace_read_v1('claim','{"leaseId":"aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
 if result->>'status'<>'leased' or result->>'scanId'<>'aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa' then raise exception 'customer_read_claim_failed'; end if;
 if public.square_production_workspace_read_v1('claim','{"leaseId":"bbbbbbbb-eeee-4eee-8eee-bbbbbbbbbbbb","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}')->>'status'<>'idle' then raise exception 'customer_read_claim_replayed'; end if;
 begin perform public.square_production_workspace_read_v1('credential','{}');exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'customer_read_runtime_credential_allowed'; end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_refresh','{}');exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'customer_read_runtime_refresh_allowed'; end if;
end $claim$;
-- customer-read-native-session:admin
-- Simulate a claimed request whose session and lease both expired. It must
-- remain fenceable by only its matching runtime lease, not any owner/broker.
update private.square_production_workspace_scans set status='leased',lease_expires_at=now()-interval '1 second'
 where scan_id='bbbbbbbb-abcd-4bcd-8bcd-bbbbbbbbbbbb' and status='uncertain';
-- customer-read-native-session:runtime
do $expired_failure_fence$
declare command jsonb:='{"scanId":"bbbbbbbb-abcd-4bcd-8bcd-bbbbbbbbbbbb","leaseId":"cccccccc-eeee-4eee-8eee-cccccccccccc","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'; denied boolean:=false;
begin
 begin perform public.square_production_workspace_read_v1('fail',command||'{"leaseFingerprint":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_failure_wrong_lease_allowed';end if;
 if public.square_production_workspace_read_v1('fail',command) is distinct from '{"status":"uncertain"}'::jsonb
 then raise exception 'customer_read_expired_revoked_failure_not_fenced';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('fail',command);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_failure_replayed';end if;
end $expired_failure_fence$;
-- customer-read-native-session:broker
do $page_authority$
declare command jsonb:='{"scanId":"aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa","leaseId":"aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}';
declare result jsonb; denied boolean:=false; renewal jsonb; issued text; expires text; aad_hash text; renewal_hash text;
begin
 result:=public.square_production_workspace_read_v1('credential',command);
 if result->>'providerLocationId'<>'location_customer_a' or result->>'refreshRequired'<>'true' then raise exception 'customer_read_broker_location_failed'; end if;
 begin perform public.square_production_workspace_read_v1('credential',command);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_provider_replay_allowed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_page',command);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_expired_page_authorized';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_refresh',command||jsonb_build_object('phase','token','leaseId','bbbbbbbb-eeee-4eee-8eee-bbbbbbbbbbbb'));
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_foreign_refresh_lease_allowed';end if;
 if public.square_production_workspace_read_v1('authorize_refresh',command||'{"phase":"token"}'::jsonb)->>'authorized'<>'true' then raise exception 'customer_read_refresh_token_failed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_refresh',command||'{"phase":"token"}'::jsonb);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_refresh_token_replayed';end if;
 if public.square_production_workspace_read_v1('authorize_refresh',command||'{"phase":"status"}'::jsonb)->>'authorized'<>'true' then raise exception 'customer_read_refresh_status_failed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_refresh',command||'{"phase":"status"}'::jsonb);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_refresh_status_replayed';end if;
 issued:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 -- Reproduce the original fixture's precedence defect before checking the fix:
 -- AT TIME ZONE binds above + and otherwise targets the interval, not the sum.
 denied:=false;
 begin perform to_char(issued::timestamptz+interval '24 hours' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 exception when undefined_function then denied:=true;end;
 if not denied then raise exception 'customer_read_fixture_original_timezone_failure_not_reproduced';end if;
 expires:=to_char((issued::timestamptz+interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 if expires::timestamptz<>issued::timestamptz+interval '24 hours' then raise exception 'customer_read_fixture_exact_refresh_expiry_failed';end if;
 select 'sha256:'||encode(sha256(convert_to(string_agg(length(v)::text||':'||v,'' order by ordinal),'UTF8')),'hex') into aad_hash
 from unnest(array['square-production-customer-aad-v1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa','1','aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','2']) with ordinality as parts(v,ordinal);
 select 'sha256:'||encode(sha256(convert_to(string_agg(length(v)::text||':'||v,'' order by ordinal),'UTF8')),'hex') into renewal_hash
 from unnest(array['square-customer-refresh-v1','aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa','aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa',
 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','2',aad_hash,expires]) with ordinality as parts(v,ordinal);
 renewal:=command||jsonb_build_object('credentialId','aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','credentialVersion',2,
 'ciphertextBase64','c3ludGhldGljIHJlbmV3ZWQ=','aadDigest',aad_hash,'aadContext',jsonb_build_object('providerKey','square','environment','production',
 'projectId','vaeroex-integrations-prod','workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa',
 'generation',1,'credentialId','aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa','credentialVersion',2),'merchantId','seller_customer_a',
 'grantedScopes',to_jsonb(array['INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ']),
 'providerIssuedAt',issued,'accessExpiresAt',expires,'commandFingerprint',renewal_hash);
 denied:=false;
 begin perform public.square_production_workspace_read_v1('commit_refresh',jsonb_set(renewal,'{aadContext,workspaceId}','"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"'));
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_cross_workspace_refresh_allowed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('commit_refresh',renewal||'{"merchantId":"seller_customer_b"}'::jsonb);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_changed_seller_refresh_allowed';end if;
 result:=public.square_production_workspace_read_v1('commit_refresh',renewal);
 if result->>'stored'<>'true' or result->>'credentialVersion'<>'2' then raise exception 'customer_read_refresh_commit_failed';end if;
 if public.square_production_workspace_read_v1('reconcile_refresh',command) is distinct from result then raise exception 'customer_read_refresh_lost_ack_failed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('commit_refresh',renewal);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_refresh_commit_replayed';end if;
 denied:=false;
 begin perform 1 from private.square_production_workspace_read_refreshes;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_refresh_direct_table_allowed';end if;
 if public.square_production_workspace_read_v1('authorize_page',command)->>'authorized'<>'true' then raise exception 'customer_read_page_authority_failed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('authorize_page',command);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_authorize_replay_allowed';end if;
end $page_authority$;
-- customer-read-native-session:admin
do $quarantine_receipt$
begin
 if not exists(select from private.square_production_workspace_scans
   where scan_id='bbbbbbbb-abcd-4bcd-8bcd-bbbbbbbbbbbb' and status='uncertain'
   and provider_started_at is null and not provider_authorized and observation_count is null)
   then raise exception 'customer_read_quarantine_not_terminal_or_provider_started';end if;
end $quarantine_receipt$;
update public.workspace_members set status='disabled' where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- customer-read-native-session:broker
do $revoked_refresh$
declare denied boolean:=false;
begin
 begin perform public.square_production_workspace_read_v1('reconcile_refresh',
 '{"scanId":"aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa","leaseId":"aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_revoked_refresh_reconcile_allowed';end if;
end $revoked_refresh$;
-- customer-read-native-session:admin
update public.workspace_members set status='active' where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- Supply canonical six-field observations after the native broker boundary.
do $prepare_page$
declare scan_uuid uuid:='aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa'; observation jsonb; source_hash text; command_hash text; now_text text;
begin
 now_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 source_hash:=private.square_production_customer_fingerprint_v1(array['square-customer-observation-v1',scan_uuid::text,
 'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),
 (select location_fingerprint from private.square_production_workspace_mappings where connection_id='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'),
 'completed',now_text,now_text]);
 -- Place the observation within the already queued request's creation window.
 now_text:=(select to_char(window_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from private.square_production_workspace_scans where scan_id=scan_uuid);
 source_hash:=private.square_production_customer_fingerprint_v1(array['square-customer-observation-v1',scan_uuid::text,
 'sha256:'||repeat('d',64),'sha256:'||repeat('e',64),
 (select location_fingerprint from private.square_production_workspace_mappings where connection_id='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'),'completed',now_text,now_text]);
 observation:=jsonb_build_object('paymentFingerprint','sha256:'||repeat('d',64),'versionFingerprint','sha256:'||repeat('e',64),
 'paymentStatus','completed','occurredAt',now_text,'observedAt',now_text,'sourceFingerprint',source_hash);
 command_hash:=private.square_production_customer_fingerprint_v1(array['square-customer-page-v1',scan_uuid::text,
 'aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa','sha256:'||repeat('f',64),source_hash,'true']);
 create table public.square_read_fixture_page(payload jsonb);
 insert into public.square_read_fixture_page values(jsonb_build_object('scanId',scan_uuid,'leaseId','aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa',
 'leaseFingerprint','sha256:'||repeat('c',64),'observations',jsonb_build_array(observation),'responseFingerprint','sha256:'||repeat('f',64),'hasMore',true,'commandFingerprint',command_hash));
end $prepare_page$;
-- customer-read-native-session:runtime
do $commit_page$
declare result jsonb; denied boolean:=false;
begin
 result:=public.square_production_workspace_read_v1('commit',current_setting('vaeroex.test.page')::jsonb);
 if result->>'observationCount'<>'1' or result->>'status'<>'committed' then raise exception 'customer_read_commit_failed'; end if;
 if public.square_production_workspace_read_v1('reconcile','{"scanId":"aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa","leaseId":"aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}')->>'status'<>'committed' then raise exception 'customer_read_reconcile_failed';end if;
 begin perform public.square_production_workspace_read_v1('fail','{"scanId":"aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa","leaseId":"aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa","leaseFingerprint":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_committed_failure_allowed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('commit',current_setting('vaeroex.test.page')::jsonb);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_duplicate_commit_allowed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('reconcile','{"scanId":"aaaaaaaa-abcd-4bcd-8bcd-aaaaaaaaaaaa","leaseId":null,"leaseFingerprint":null}');exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'customer_read_null_lease_allowed';end if;
end $commit_page$;
-- customer-read-native-session:admin
drop table public.square_read_fixture_page;
begin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa","role":"authenticated"}',true);
set local role authenticated;
do $evidence$
declare view jsonb;
begin
 view:=public.square_production_workspace_read_v1('status','{"workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","connectionId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
 if view->>'observationCount'<>'1' or view->>'hasMore'<>'true' or view->>'historicalCompleteness'<>'unknown'
  or view::text like '%location_customer_a%' or view::text like '%seller_customer_a%' or view::text like '%ciphertext%'
  then raise exception 'customer_read_evidence_privacy_failed';end if;
end $evidence$;
reset role;
update public.workspace_members set status='disabled' where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $revoked$
declare denied boolean:=false;
begin
 begin perform public.square_production_workspace_read_v1('status','{"workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","connectionId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_revoked_authority_allowed';end if;
end $revoked$;
reset role;rollback;
begin;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb","role":"authenticated"}',true);
set local role authenticated;
do $unmapped$
declare denied boolean:=false;
begin
 begin perform public.square_production_workspace_read_v1('status','{"workspaceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","connectionId":"bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb"}');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_unmapped_workspace_allowed';end if;
 denied:=false;
 begin perform public.square_production_workspace_read_v1('status','{"workspaceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","connectionId":"aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"}');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'customer_read_foreign_connection_allowed';end if;
end $unmapped$;
reset role;rollback;
update private.square_production_customer_bindings set consent_enabled=false;
update private.square_production_workspace_read_bindings set read_enabled=false;
drop role square_production_broker;drop role square_production_runtime;
