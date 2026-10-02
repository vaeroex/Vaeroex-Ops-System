begin;
-- This suite crosses real RPC transaction boundaries. Run only in a disposable
-- database owned by the qualification harness, which drops it after the test.
do $$ begin
  if current_setting('vaeroex.disposable_database_test',true) is distinct from 'qbo_customer_oauth_completion' then
    raise exception 'disposable qualification database required';
  end if;
end $$;
create extension if not exists pgtap with schema extensions;
-- Test-only access to pgTAP under native roles; rolled back with this fixture.
grant usage on schema extensions to integration_oauth_ingress_authority;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.denied(p_sql text,p_state text default '42501') returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlstate=p_state; end; $$;
create function pg_temp.fp(p_value text) returns text language sql immutable as $$
  select 'sha256:'||encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex'); $$;
create function pg_temp.intent(p_id uuid,p_entity uuid default '0b930000-0000-4000-8000-000000000001') returns jsonb language sql as $$
  select jsonb_build_object('contractVersion','integration_connection_control_v1','id',p_id,
    'workspaceId','0a930000-0000-4000-8000-000000000001','businessEntityId',p_entity,
    'providerKey','quickbooks_online','providerEnvironment','production','safeDisplayName','Synthetic company '||p_id::text,
    'requestedScopes',jsonb_build_array('com.intuit.quickbooks.accounting'),
    'providerDescriptorRegistryVersion','vaeroex_provider_descriptors_v1',
    'providerDescriptorRegistryFingerprint','sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad',
    'providerDescriptorFingerprint','sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f',
    'adapterVersion','qbo_provider_adapter_v1','configurationVersion',1,'requestedAt',transaction_timestamp(),
    'capabilitySnapshot',jsonb_build_object('operations',jsonb_build_array('get_capabilities','get_source_record','list_entities','list_source_records'),
      'domains',jsonb_build_array('change_hints','company_configuration','financial_transactions','master_records','report_control_observations'),
      'requiredStreamKeys',jsonb_build_array('accounts','company_info','preferences','qbo_apagingsummary','qbo_aragingsummary',
        'qbo_balancesheet','qbo_bill','qbo_billpayment','qbo_cashflow','qbo_creditmemo','qbo_deposit','qbo_invoice','qbo_journalentry',
        'qbo_payment','qbo_profitandloss','qbo_purchase','qbo_refundreceipt','qbo_salesreceipt','qbo_transfer','qbo_trialbalance','qbo_vendorcredit'),
      'supportsBackfill',true,'webhookMode','change_hints','incrementalMode','cursor'));
$$;
create function pg_temp.state(p_id uuid,p_connection uuid,p_hash text) returns jsonb language sql as $$
  select jsonb_build_object('contractVersion','qbo_customer_oauth_state_v2','stateId',p_id,'connectionId',p_connection,
    'expectedConnectionGeneration',1,'expectedConnectionRowVersion',1,
    'requestedScopes',jsonb_build_array('com.intuit.quickbooks.accounting'),
    'redirectUri','https://integrations.vaeroex.com/oauth/callback','returnIntent','/app/settings',
    'stateHash',pg_temp.fp(p_hash),'requestedAt',transaction_timestamp(),'expiresAt',transaction_timestamp()+interval '10 minutes');
$$;
create function pg_temp.consume(p_hash text) returns jsonb language sql as $$
  select public.consume_qbo_customer_oauth_state_v2(jsonb_build_object('contractVersion','qbo_customer_oauth_state_consume_v2',
    'stateHash',pg_temp.fp(p_hash),'redirectUri','https://integrations.vaeroex.com/oauth/callback'),'oauth_test_consume_'||p_hash);
$$;

insert into auth.users(id,email) values('09930000-0000-4000-8000-000000000001','qbo-oauth-owner@example.test'),
  ('09930000-0000-4000-8000-000000000002','qbo-oauth-manager@example.test');
insert into public.profiles(id,email) values('09930000-0000-4000-8000-000000000001','qbo-oauth-owner@example.test'),
  ('09930000-0000-4000-8000-000000000002','qbo-oauth-manager@example.test') on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by,manually_unlocked) values
  ('0a930000-0000-4000-8000-000000000001','Synthetic OAuth workspace','09930000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(workspace_id,user_id,role,status) values
  ('0a930000-0000-4000-8000-000000000001','09930000-0000-4000-8000-000000000001','owner','active'),
  ('0a930000-0000-4000-8000-000000000001','09930000-0000-4000-8000-000000000002','manager','active');
insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,manually_activated,status)
  values('0a930000-0000-4000-8000-000000000001','qbo-oauth-owner@example.test','manual',true,'active');
insert into auth.sessions(id,user_id,not_after) values
  ('0c930000-0000-4000-8000-000000000001','09930000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 hour'),
  ('0c930000-0000-4000-8000-000000000002','09930000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 hour');
insert into public.business_entities(id,workspace_id,contract_version,entity_key,entity_type,display_name,base_currency,timezone,
  fiscal_year_start_month,status,created_by,updated_by) values
  ('0b930000-0000-4000-8000-000000000001','0a930000-0000-4000-8000-000000000001','business_entity_v1','qbo_oauth_test',
   'operating_company','Synthetic entity','USD','UTC',1,'active','09930000-0000-4000-8000-000000000001','09930000-0000-4000-8000-000000000001');
select public.register_qbo_runtime_configuration_v2(jsonb_build_object('contractVersion','qbo_runtime_configuration_v2',
  'providerEnvironment','production','deploymentTier','production','configurationVersion',1,
  'authorizationRedirectUri','https://integrations.vaeroex.com/oauth/callback','authorizationReturnIntent','/app/settings',
  'providerApiOrigin','https://quickbooks.api.intuit.com','queueName','qbo-production','queueAudience','https://qbo-runtime.vaeroex.com'),
  'qbo_customer_oauth_config');

select ok(not has_function_privilege('service_role','public.begin_qbo_customer_authorization_v1(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_qbo_customer_disconnect_v1(text)','EXECUTE'),
  'customer and service roles have no native-broker shortcut');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.integration_qbo_customer_authorizations'::regclass),'authorization completion has forced RLS');
select ok(not has_table_privilege('integration_credential_broker_authority','private.integration_qbo_customer_authorizations','UPDATE'),
  'broker cannot forge session bindings through table access');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"09930000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select ok(pg_temp.denied($$select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000001'))$$),
  'missing session cannot create a connection');
reset role;
select is((select count(*) from private.integration_connections where workspace_id='0a930000-0000-4000-8000-000000000001'),0::bigint,
  'denied intent creates zero connections');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"09930000-0000-4000-8000-000000000002","session_id":"0c930000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select ok(pg_temp.denied($$select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000001'))$$),
  'management membership cannot substitute for ownership');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"09930000-0000-4000-8000-000000000001","session_id":"0c930000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select lives_ok($$select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000001'))$$,
  'live entitled owner can create exact-workspace intent');
select lives_ok($$select public.create_qbo_customer_oauth_state_v2(pg_temp.state('0e930000-0000-4000-8000-000000000001',
  '0d930000-0000-4000-8000-000000000001','initial'),'oauth_test_state')$$,'live session is bound atomically to state');
reset role;
select is((select session_id::text from private.integration_qbo_customer_authorizations where state_id='0e930000-0000-4000-8000-000000000001'),
  '0c930000-0000-4000-8000-000000000001','state session is server-derived');
delete from auth.sessions where id='0c930000-0000-4000-8000-000000000001';
set local role integration_oauth_ingress_authority;
select ok(pg_temp.denied($$select pg_temp.consume('initial')$$),'revoked issuing session prevents callback consumption');
reset role;
select is((select status from private.integration_oauth_states where id='0e930000-0000-4000-8000-000000000001'),'pending',
  'denied callback leaves state and audit unchanged');
insert into auth.sessions(id,user_id,not_after) values('0c930000-0000-4000-8000-000000000001',
  '09930000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 second');
set local role integration_oauth_ingress_authority;
select ok(pg_temp.denied($$select pg_temp.consume('initial')$$),'expired issuing session prevents callback consumption');
reset role;
update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id='0c930000-0000-4000-8000-000000000001';
update public.workspace_members set role='manager' where user_id='09930000-0000-4000-8000-000000000001';
set local role integration_oauth_ingress_authority;
select ok(pg_temp.denied($$select pg_temp.consume('initial')$$),'owner downgrade during consent prevents consumption');
reset role;
update public.workspace_members set role='owner' where user_id='09930000-0000-4000-8000-000000000001';
set local role integration_oauth_ingress_authority;
select is(pg_temp.consume('initial')->>'accepted','true','live owner callback consumed once');
select is(pg_temp.consume('initial')->>'reasonCode','state_replayed','replayed callback cannot exchange another code');
reset role;
create temporary table qbo_oauth_claim as select public.begin_qbo_customer_authorization_v1(
  '0e930000-0000-4000-8000-000000000001',pg_temp.fp('realm')) as value;
select ok((select value->>'credentialId' is not null from qbo_oauth_claim),'database generates the exact credential identity');
select ok(pg_temp.denied($$select public.begin_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000001',pg_temp.fp('realm'))$$),
  'duplicate exchange authority denied');
select is(public.read_qbo_customer_authorization_completion_v1('0e930000-0000-4000-8000-000000000001')->>'stored','false',
  'uncertain exchange cannot be mistaken for a stored credential');
select is(public.finish_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000001','recovery_required')->>'outcome',
  'recovery_required','uncertain exchange receives explicit durable recovery status');
select is(public.finish_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000001','recovery_required')->>'idempotent','true',
  'identical failure completion is idempotent');
select is((select status from private.integration_connections where id='0d930000-0000-4000-8000-000000000001'),'error',
  'uncertain exchange never leaves a schedulable connection');
select is((select count(*) from private.integration_credentials where workspace_id='0a930000-0000-4000-8000-000000000001'),0::bigint,
  'uncertain exchange creates no fabricated credential');
select ok(pg_temp.denied($$select public.finish_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000001','completed')$$,'40001'),
  'recovery-required outcome cannot be rewritten as successful');

-- A separate exact state exercises storage-before-discovery and the complete
-- native disconnect path with inert ciphertext (no provider/KMS calls in SQL).
set local role authenticated;
select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000002'));
select public.create_qbo_customer_oauth_state_v2(pg_temp.state('0e930000-0000-4000-8000-000000000002',
  '0d930000-0000-4000-8000-000000000002','stored'),'oauth_test_stored');
reset role;
select pg_temp.consume('stored');
create temporary table qbo_stored_claim as select public.begin_qbo_customer_authorization_v1(
  '0e930000-0000-4000-8000-000000000002',pg_temp.fp('stored_realm')) as value;
create temporary table qbo_store_command as select jsonb_build_object(
  'contractVersion','integration_credential_authority_v1','id',value->>'credentialId',
  'oauthStateId','0e930000-0000-4000-8000-000000000002','workspaceId','0a930000-0000-4000-8000-000000000001',
  'businessEntityId','0b930000-0000-4000-8000-000000000001','connectionId','0d930000-0000-4000-8000-000000000002',
  'connectionGeneration',1,'providerKey','quickbooks_online','providerEnvironment','production',
  'initiatedBy','09930000-0000-4000-8000-000000000001','expectedConnectionRowVersion',1,'credentialVersion',1,
  'envelopeSchemaVersion','oauth_credential_envelope_v1','aadSchemaVersion','oauth_credential_aad_v1',
  'aadDigest',private.phase_5_fingerprint_text_v1(private.phase_5_credential_aad_digest_v1('production',
    '0a930000-0000-4000-8000-000000000001','0d930000-0000-4000-8000-000000000002',1,'quickbooks_online',(value->>'credentialId')::uuid)),
  'kmsKeyResource','projects/synthetic-prod/locations/us-central1/keyRings/credentials/cryptoKeys/qbo',
  'ciphertextBase64',replace(encode(convert_to(repeat('synthetic',8),'UTF8'),'base64'),E'\n',''),
  'accessExpiresAt',transaction_timestamp()+interval '1 hour','refreshExpiresAt',transaction_timestamp()+interval '90 days',
  'grantedScopes',jsonb_build_array('com.intuit.quickbooks.accounting'),
  'externalEntityReferenceFingerprint',pg_temp.fp('stored_realm'),'authorizedAt',transaction_timestamp()) as value from qbo_stored_claim;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='0c930000-0000-4000-8000-000000000001';
select ok(pg_temp.denied($$select public.store_integration_credential_v1((select value from qbo_store_command),'oauth_test_expired_store')$$),
  'session revocation after exchange authority still prevents credential storage');
select is((select outcome from private.integration_qbo_customer_authorizations where state_id='0e930000-0000-4000-8000-000000000002'),'exchanging',
  'denied credential storage cannot fabricate a stored acknowledgement');
update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id='0c930000-0000-4000-8000-000000000001';
select lives_ok($$select public.store_integration_credential_v1((select value from qbo_store_command),'oauth_test_store')$$,
  'canonical KMS credential store commits before discovery');
select is(public.read_qbo_customer_authorization_completion_v1('0e930000-0000-4000-8000-000000000002')->>'stored','true',
  'read-only acknowledgement reconciliation finds the exact stored credential');
select is((select outcome from private.integration_qbo_customer_authorizations where state_id='0e930000-0000-4000-8000-000000000002'),'stored',
  'credential insert atomically records durable storage');
select ok(pg_temp.denied($$select public.finish_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000002','completed')$$),
  'stored credential alone cannot report successful company discovery');

set local role authenticated;
select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000003'));
select public.create_qbo_customer_oauth_state_v2(pg_temp.state('0e930000-0000-4000-8000-000000000003',
  '0d930000-0000-4000-8000-000000000003','duplicate_company'),'oauth_test_duplicate');
select public.create_integration_connection_intent_v1(pg_temp.intent('0d930000-0000-4000-8000-000000000004'));
select public.create_qbo_customer_oauth_state_v2(pg_temp.state('0e930000-0000-4000-8000-000000000004',
  '0d930000-0000-4000-8000-000000000004','denied'),'oauth_test_denied');
reset role;
select pg_temp.consume('duplicate_company');
select ok(pg_temp.denied($$select public.begin_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000003',pg_temp.fp('stored_realm'))$$),
  'another connection cannot claim an already bound company before code exchange');
select is((select outcome from private.integration_qbo_customer_authorizations where state_id='0e930000-0000-4000-8000-000000000003'),'pending',
  'company conflict creates no exchange or revocation authority');
select ok(pg_temp.denied($$select private.qbo_customer_require_owner_v1('09930000-0000-4000-8000-000000000001',
  '0c930000-0000-4000-8000-000000000001','0a930000-0000-4000-8000-000000000001','0b930000-0000-4000-8000-000000000099')$$),
  'same owner cannot substitute an entity outside the exact workspace binding');
select ok(pg_temp.denied($$select private.qbo_customer_require_owner_v1('09930000-0000-4000-8000-000000000001',
  '0c930000-0000-4000-8000-000000000002','0a930000-0000-4000-8000-000000000001','0b930000-0000-4000-8000-000000000001')$$),
  'another actor session cannot substitute for the issuing owner session');
set local role integration_oauth_ingress_authority;
select is(public.deny_qbo_customer_authorization_v1(pg_temp.fp('denied'),'initial','https://integrations.vaeroex.com/oauth/callback')->>'outcome',
  'denied','bounded consent denial terminates only its exact pending state');
select ok(pg_temp.denied($$select public.deny_qbo_customer_authorization_v1(pg_temp.fp('denied'),'initial',
  'https://integrations.vaeroex.com/oauth/callback')$$),'denied callback cannot replay');
reset role;
select is((select status from private.integration_oauth_states where id='0e930000-0000-4000-8000-000000000004'),'expired',
  'denied state cannot later consume a code');
select is((select count(*) from private.integration_credentials where connection_id='0d930000-0000-4000-8000-000000000004'),0::bigint,
  'denied consent creates zero credentials');

-- Paid access may lapse without preventing the owner from disconnecting.
update public.customer_subscriptions set status='expired' where workspace_id='0a930000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.request_integration_disconnect_v1('0d930000-0000-4000-8000-000000000002',2,'oauth_test_disconnect')$$,
  'owner can disconnect without paid entitlement');
reset role;
create temporary table qbo_disconnect_claim as select public.claim_qbo_customer_disconnect_v1('oauth_test_revoke') as value;
select is((select value->>'acquired' from qbo_disconnect_claim),'true','native broker claims canonical disconnect');
select ok((select (value->>'ciphertextBase64') !~ '[[:space:]]' from qbo_disconnect_claim),
  'native broker ciphertext serialization is single-line canonical base64');
select is(public.claim_qbo_customer_disconnect_v1('oauth_test_revoke_loser')->>'acquired','false',
  'second worker cannot claim the same pending disconnect');
select is((select status from private.integration_credentials where id=(select (value->>'credentialId')::uuid from qbo_disconnect_claim)),
  'revoked','local credential is fenced before provider revocation');
select ok(public.authorize_qbo_customer_revocation_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002'),'exact live revocation claim is authorized');
select ok(not public.authorize_qbo_customer_revocation_v1(gen_random_uuid(),'0d930000-0000-4000-8000-000000000002'),
  'wrong revocation claim is fenced');
-- Canonical destruction records the RPC transaction timestamp. The request,
-- remote revocation, and completion are separate transactions in the runtime.
commit;
begin;
set local search_path=public,extensions;
select is(public.complete_qbo_customer_disconnect_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002','failed')->>'disconnected','false','unconfirmed provider failure is not a completed disconnect');
select ok((select status='revoked' and credential_ciphertext is not null and provider_revocation_status='pending'
  from private.integration_credentials where id=(select (value->>'credentialId')::uuid from qbo_disconnect_claim)),
  'failure retains revoked ciphertext exclusively for bounded revocation retry');
select is((select status from private.integration_connections where id='0d930000-0000-4000-8000-000000000002'),'disconnecting',
  'failed revocation remains locally inaccessible and truthfully disconnecting');
select is(public.complete_qbo_customer_disconnect_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002','succeeded')->>'providerOutcome','failed','same attempt cannot replay a failure into success');
select is((select count(*) from private.integration_audit_events where
  request_id='qbo_revoke_attempt_'||(select value->>'claimId' from qbo_disconnect_claim)),1::bigint,
  'failed-attempt replay creates only one audit');
select is(public.claim_qbo_customer_disconnect_v1('oauth_test_retry_cooldown')->>'acquired','false','five minute retry cooldown prevents hot loops');
select ok(not public.authorize_qbo_customer_revocation_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002'),'completed failed claim loses provider authority');
update public.customer_subscriptions set status='active' where workspace_id='0a930000-0000-4000-8000-000000000001';
select throws_ok($$select public.begin_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000003',pg_temp.fp('stored_realm'))$$,
  '42501','qbo_customer_company_already_bound',
  'unconfirmed remote revocation cannot release the realm claim');
select ok(not has_table_privilege('authenticated','private.integration_credentials','SELECT')
  and not has_function_privilege('integration_provider_runtime_authority','public.claim_qbo_customer_disconnect_v1(text)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_qbo_customer_disconnect_v1(text)','EXECUTE'),
  'retention grants no customer task or service-role credential access');
-- Synthetic time passage in this disposable fixture, never an operational bypass.
update private.integration_qbo_customer_disconnect_work set lease_until=clock_timestamp()-interval '1 second'
  where connection_id='0d930000-0000-4000-8000-000000000002';
create temporary table qbo_disconnect_old_claim as select * from qbo_disconnect_claim;
update qbo_disconnect_claim set value=public.claim_qbo_customer_disconnect_v1('oauth_test_revoke_retry');
select ok((select value->>'acquired'='true' and value->>'claimId'<>(select value->>'claimId' from qbo_disconnect_old_claim)
  and value->>'credentialId'=(select value->>'credentialId' from qbo_disconnect_old_claim) from qbo_disconnect_claim),
  'retry obtains a fresh claim for the exact retained revoked credential');
select ok(pg_temp.denied(format('select public.complete_qbo_customer_disconnect_v1(%L,%L,%L)',
  (select value->>'claimId' from qbo_disconnect_old_claim),'0d930000-0000-4000-8000-000000000002','succeeded'),'40001'),
  'previous worker cannot complete after retry ownership changes');
select is(public.claim_qbo_customer_disconnect_v1('oauth_test_retry_loser')->>'acquired','false','concurrent retry owner is fenced');
select is(public.complete_qbo_customer_disconnect_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002','succeeded')->>'providerOutcome','succeeded','canonical revocation completes');
select is(public.complete_qbo_customer_disconnect_v1((select (value->>'claimId')::uuid from qbo_disconnect_claim),
  '0d930000-0000-4000-8000-000000000002','succeeded')->>'idempotent','true','revocation completion replay is idempotent');
select is((select status from private.integration_connections where id='0d930000-0000-4000-8000-000000000002'),'disconnected',
  'disconnect reaches canonical terminal connection state');
select ok((select status='destroyed' and credential_ciphertext is null from private.integration_credentials
  where id=(select (value->>'credentialId')::uuid from qbo_disconnect_claim)),'canonical destruction removes local ciphertext, not history');
select is((select count(*) from private.integration_oauth_states where id='0e930000-0000-4000-8000-000000000002'),1::bigint,
  'disconnect preserves OAuth history');
select ok((select count(*)>0 from private.integration_audit_events where connection_id='0d930000-0000-4000-8000-000000000002'),
  'disconnect preserves audit history');
update public.customer_subscriptions set status='active' where workspace_id='0a930000-0000-4000-8000-000000000001';
select lives_ok($$select public.begin_qbo_customer_authorization_v1('0e930000-0000-4000-8000-000000000003',pg_temp.fp('stored_realm'))$$,
  'confirmed revocation and canonical disconnect release the old company claim for a fresh connection');

select * from finish();
rollback;
