-- Shared synthetic native QBO fixture for disposable full-candidate databases.
-- Caller owns BEGIN/pgTAP/ROLLBACK. No guards or constraints are disabled.
-- This seeds completed prior authorization metadata; it is not OAuth proof.
create or replace function pg_temp.fingerprint(p_value text) returns text language sql immutable as $$
  select 'sha256:'||encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex');
$$;
create or replace function pg_temp.raises_sqlstate(p_sql text,p_state text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlstate=p_state; end;
$$;
create or replace function pg_temp.qbo_capability() returns jsonb language sql immutable as $$
  select jsonb_build_object('operations',jsonb_build_array('get_capabilities','get_source_record','list_entities','list_source_records'),
    'domains',jsonb_build_array('change_hints','company_configuration','financial_transactions','master_records','report_control_observations'),
    'requiredStreamKeys',jsonb_build_array('accounts','company_info','preferences','qbo_apagingsummary','qbo_aragingsummary',
      'qbo_balancesheet','qbo_bill','qbo_billpayment','qbo_cashflow','qbo_creditmemo','qbo_deposit','qbo_invoice','qbo_journalentry',
      'qbo_payment','qbo_profitandloss','qbo_purchase','qbo_refundreceipt','qbo_salesreceipt','qbo_transfer','qbo_trialbalance','qbo_vendorcredit'),
    'supportsBackfill',true,'webhookMode','change_hints','incrementalMode','cursor');
$$;

insert into auth.users(id,email) values
  ('a9f00000-0000-4000-8000-000000000001','native-qbo-a@example.test'),
  ('a9f00000-0000-4000-8000-000000000002','native-qbo-b@example.test');
insert into public.profiles(id,email) values
  ('a9f00000-0000-4000-8000-000000000001','native-qbo-a@example.test'),
  ('a9f00000-0000-4000-8000-000000000002','native-qbo-b@example.test') on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by,manually_unlocked) values
  ('b9f00000-0000-4000-8000-000000000001','Synthetic QBO A','a9f00000-0000-4000-8000-000000000001',true),
  ('b9f00000-0000-4000-8000-000000000002','Synthetic QBO B','a9f00000-0000-4000-8000-000000000002',true);
insert into public.workspace_members(workspace_id,user_id,role,status) values
  ('b9f00000-0000-4000-8000-000000000001','a9f00000-0000-4000-8000-000000000001','owner','active'),
  ('b9f00000-0000-4000-8000-000000000002','a9f00000-0000-4000-8000-000000000002','owner','active');
insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,manually_activated,status) values
  ('b9f00000-0000-4000-8000-000000000001','native-qbo-a@example.test','manual',true,'active'),
  ('b9f00000-0000-4000-8000-000000000002','native-qbo-b@example.test','manual',true,'active');
insert into auth.sessions(id,user_id,not_after) values
  ('79f00000-0000-4000-8000-000000000101','a9f00000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 hour'),
  ('79f00000-0000-4000-8000-000000000103','a9f00000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 hour');
insert into public.business_entities(id,workspace_id,contract_version,entity_key,entity_type,display_name,base_currency,
  timezone,fiscal_year_start_month,status,created_by,updated_by) values
  ('d9f00000-0000-4000-8000-000000000001','b9f00000-0000-4000-8000-000000000001','business_entity_v1','native_qbo_a',
    'operating_company','Synthetic A','USD','UTC',1,'active','a9f00000-0000-4000-8000-000000000001','a9f00000-0000-4000-8000-000000000001'),
  ('d9f00000-0000-4000-8000-000000000002','b9f00000-0000-4000-8000-000000000002','business_entity_v1','native_qbo_b',
    'operating_company','Synthetic B','USD','UTC',1,'active','a9f00000-0000-4000-8000-000000000002','a9f00000-0000-4000-8000-000000000002');
select public.register_qbo_runtime_configuration_v2(jsonb_build_object('contractVersion','qbo_runtime_configuration_v2',
  'providerEnvironment','production','deploymentTier','production','configurationVersion',1,
  'authorizationRedirectUri','https://integrations.vaeroex.com/oauth/callback','authorizationReturnIntent','/app/settings',
  'providerApiOrigin','https://quickbooks.api.intuit.com','queueName','qbo-production','queueAudience','https://qbo-runtime.vaeroex.com'),
  'native_qbo_configuration');

do $fixture$
<<seed>>
declare f record; realm bytea; connection_row private.integration_connections; state_id uuid; credential_id uuid; mapping_id uuid;
begin
  for f in select * from (values
    ('a9f00000-0000-4000-8000-000000000001'::uuid,'b9f00000-0000-4000-8000-000000000001'::uuid,
      'd9f00000-0000-4000-8000-000000000001'::uuid,'e9f00000-0000-4000-8000-000000000101'::uuid,
      '79f00000-0000-4000-8000-000000000101'::uuid,1,'101','synthetic-production-realm-a'),
    ('a9f00000-0000-4000-8000-000000000002'::uuid,'b9f00000-0000-4000-8000-000000000002'::uuid,
      'd9f00000-0000-4000-8000-000000000002'::uuid,'e9f00000-0000-4000-8000-000000000103'::uuid,
      '79f00000-0000-4000-8000-000000000103'::uuid,2,'103','synthetic-production-realm-b')
  ) as v(actor,workspace,entity,connection,session,generation,suffix,realm_name)
  loop
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',f.actor,'session_id',f.session)::text,true);
    realm:=private.qbo_phase_8b_realm_fingerprint_v1(f.realm_name);
    connection_row:=jsonb_populate_record(null::private.integration_connections,jsonb_build_object(
      'id',f.connection,'contract_version','integration_connection_v1','control_contract_version','integration_connection_control_v1',
      'workspace_id',f.workspace,'business_entity_id',f.entity,'connection_series_id',f.connection,'connection_generation',f.generation,
      'provider_key','quickbooks_online','provider_environment','production','provider_tenant_reference_fingerprint',realm,
      'status','initializing','state_reason_code','initial_sync_pending',
      'requested_scopes',array['com.intuit.quickbooks.accounting'],'granted_scopes',array['com.intuit.quickbooks.accounting'],
      'safe_display_name','Synthetic QBO','provider_descriptor_registry_version','vaeroex_provider_descriptors_v1',
      'provider_descriptor_registry_fingerprint',decode('2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad','hex'),
      'provider_descriptor_fingerprint',decode('1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f','hex'),
      'adapter_version','qbo_provider_adapter_v1','capability_snapshot',pg_temp.qbo_capability(),'configuration_version',1,
      'authorized_at',transaction_timestamp(),'status_changed_at',transaction_timestamp(),'row_version',1,'created_by',f.actor,
      'created_at',transaction_timestamp(),'updated_at',transaction_timestamp()));
    if f.generation=2 then
      connection_row.id:='e9f00000-0000-4000-8000-000000000102';
      connection_row.connection_series_id:=connection_row.id; connection_row.connection_generation:=1;
      connection_row.status:='disconnected'; connection_row.state_reason_code:='disconnected';
      connection_row.disconnected_at:=transaction_timestamp();
      insert into private.integration_connections select connection_row.*;
      connection_row.replaces_connection_id:=connection_row.id; connection_row.id:=f.connection;
      connection_row.connection_generation:=2; connection_row.status:='initializing';
      connection_row.state_reason_code:='initial_sync_pending'; connection_row.disconnected_at:=null;
    end if;
    insert into private.integration_connections select connection_row.*;
    state_id:=('59f00000-0000-4000-8000-000000000'||f.suffix)::uuid;
    credential_id:=('69f00000-0000-4000-8000-000000000'||f.suffix)::uuid;
    mapping_id:=('f9f00000-0000-4000-8000-000000000'||f.suffix)::uuid;
    insert into private.integration_oauth_states(id,contract_version,workspace_id,business_entity_id,connection_id,connection_generation,
      provider_key,provider_environment,initiated_by,requested_scopes,return_intent,state_hash,status,creation_request_id,
      creation_request_fingerprint,consume_request_id,consume_request_fingerprint,created_at,expires_at,consumed_at,row_version)
    values(state_id,'integration_oauth_state_v1',f.workspace,f.entity,f.connection,f.generation,'quickbooks_online','production',f.actor,
      array['com.intuit.quickbooks.accounting'],'/app/settings',realm,'consumed','native_state_'||f.suffix,realm,
      'native_consume_'||f.suffix,realm,transaction_timestamp()-interval '1 minute',transaction_timestamp()+interval '9 minutes',transaction_timestamp(),2);
    -- The INSERT trigger derives the real owner/session binding. Seed the prior
    -- exchange state explicitly, then let the credential guard and completion RPC
    -- validate every binding and advance stored/completed normally.
    update private.integration_qbo_customer_authorizations a
      set credential_id=seed.credential_id,realm_fingerprint=realm,outcome='exchanging'
      where a.state_id=seed.state_id;
    insert into private.integration_credentials(id,contract_version,oauth_state_id,workspace_id,business_entity_id,connection_id,
      connection_generation,provider_key,provider_environment,initiated_by,credential_version,envelope_schema_version,aad_schema_version,
      aad_digest,kms_key_resource,credential_ciphertext,access_expires_at,refresh_expires_at,granted_scopes,
      external_entity_reference_fingerprint,status,last_request_id,last_request_fingerprint,row_version,created_at,updated_at)
    values(credential_id,'integration_credential_authority_v1',state_id,f.workspace,f.entity,f.connection,f.generation,
      'quickbooks_online','production',f.actor,1,'oauth_credential_envelope_v1','oauth_credential_aad_v1',
      private.phase_5_credential_aad_digest_v1('production',f.workspace,f.connection,f.generation,'quickbooks_online',credential_id),
      'projects/synthetic-prod/locations/us-central1/keyRings/credentials/cryptoKeys/qbo',decode(repeat('ab',32),'hex'),
      transaction_timestamp()+interval '1 hour',transaction_timestamp()+interval '90 days',array['com.intuit.quickbooks.accounting'],
      realm,'active','native_credential_'||f.suffix,realm,1,transaction_timestamp(),transaction_timestamp());
    insert into private.provider_entity_mappings(id,contract_version,workspace_id,business_entity_id,connection_id,mapping_series_id,
      mapping_version,provider_key,provider_environment,provider_entity_type,provider_entity_reference_fingerprint,safe_display_name,
      mapping_role,status,verification_mode,verification_fingerprint,verified_at,mapped_by,mapped_at,row_version,created_at,updated_at)
    values(mapping_id,'provider_entity_mapping_v1',f.workspace,f.entity,f.connection,mapping_id,1,'quickbooks_online','production',
      'company',realm,'Synthetic company','primary','active','qbo_realm_mapping_v1',realm,transaction_timestamp(),f.actor,
      transaction_timestamp(),1,transaction_timestamp(),transaction_timestamp());
    perform public.finish_qbo_customer_authorization_v1(state_id,'completed');
    insert into private.integration_workspace_policies(id,contract_version,workspace_id,provider_key,provider_environment,state,sync_enabled,
      history_horizon_days,maximum_concurrency,freshness_policy_version,retention_policy_version,row_version,last_request_id,
      last_request_fingerprint,created_at,updated_at)
    values(gen_random_uuid(),'integration_workspace_policy_v1',f.workspace,'quickbooks_online','production','enabled',true,365,2,
      'qbo_control_plane_freshness_policy_v1','qbo_metadata_retention_v1',1,'native_policy_'||f.suffix,realm,transaction_timestamp(),transaction_timestamp());
  end loop;
end;
$fixture$;
select set_config('request.jwt.claims','{}',true);
-- qbo-production-native-fixture-end
