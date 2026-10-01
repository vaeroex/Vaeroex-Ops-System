-- Standalone native pgTAP suite after the complete canonical+candidate chain.
-- Only a disposable qualification database: fixtures and assertions roll back.
-- No triggers, constraints, RLS, authority helpers or source guards are disabled.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/qbo-production-native.sql
do $test$
declare f regprocedure := 'public.qbo_customer_source_browse_v1(uuid,uuid,uuid,uuid,text)'::regprocedure;
declare r text; p record;
begin
  select * into p from pg_catalog.pg_proc where oid=f;
  if not p.prosecdef or p.provolatile<>'s' or not ('search_path=""'=any(p.proconfig))
    or p.proowner<>(select oid from pg_catalog.pg_roles where rolname='postgres') then
    raise exception 'qbo browse function security contract failed'; end if;
  if not has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE')
    or has_function_privilege('service_role',f,'EXECUTE')
    or exists(select from pg_catalog.aclexplode(p.proacl) where grantee=0 and privilege_type='EXECUTE') then
    raise exception 'qbo browse execution grants failed'; end if;
  if has_function_privilege('authenticated','private.qbo_customer_preview_v1(jsonb,text,text)','EXECUTE') then
    raise exception 'private preview exposed'; end if;
  foreach r in array array['public.business_entities','private.integration_connections',
    'private.provider_entity_mappings','private.external_source_records','private.external_source_record_versions',
    'private.qbo_production_source_validation_work'] loop
    if not exists(select from pg_catalog.pg_class where oid=r::regclass and relrowsecurity and relforcerowsecurity) then
      raise exception 'forced RLS missing'; end if;
  end loop;
  if has_table_privilege('authenticated','private.external_source_records','SELECT')
    or has_table_privilege('authenticated','private.external_source_record_versions','SELECT') then
    raise exception 'source tables directly exposed'; end if;
end $test$;

select ok(true,'SECURITY DEFINER, empty search_path, narrow execute and forced RLS catalog guards passed');

create function pg_temp.browse_source_hash(v jsonb) returns text language sql immutable as $$
  select 'sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'fingerprintPurpose','external_source_record','fingerprintVersion','external_integration_fingerprint_v1',
    'payload',jsonb_build_object('contractVersion',v->'contractVersion','workspaceId',v->'workspaceId',
      'businessEntityId',v->'businessEntityId','connectionId',v->'connectionId','recordKind',v->'recordKind',
      'source',v->'source','temporal',(v->'temporal')-array['synchronizedAt','ingestedAt'],
      'accounting',v->'accounting','normalizedSchemaVersion',v->'normalizedSchemaVersion',
      'changeKind',v->'changeKind','normalizedProjection',v->'normalizedProjection','trust',v->'trust'))),'hex');
$$;
create function pg_temp.browse_source_version(t private.integration_sync_tasks,n integer) returns jsonb language plpgsql as $$
declare v jsonb; projection jsonb; record_type text; record_id text; is_report boolean;
declare stamp text:=to_char((transaction_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  record_type:=case t.stream_key when 'qbo_payment' then 'Payment' when 'qbo_deposit' then 'Deposit'
    when 'qbo_profitandloss' then 'ProfitAndLoss' else 'Invoice' end;
  is_report:=record_type='ProfitAndLoss';
  record_id:=case when is_report then 'ProfitAndLoss:accrual:2026-09-01:2026-09-28:USD' else 'browse-'||record_type||'-'||n end;
  if is_report then
    projection:=jsonb_build_object('contractVersion','qbo_report_control_observation_v1','reportType',record_type,
      'reportBasis','accrual','sourceCurrency','USD','periodStart','2026-09-01','periodEnd','2026-09-28',
      'columns',jsonb_build_array(jsonb_build_object('columnKey','label','title','Account','type','Account'),
        jsonb_build_object('columnKey','amount','title','Total','type','Money')),
      'rows',jsonb_build_array(jsonb_build_object('rowType','summary','group','Income','children','[]'::jsonb,
        'cells',jsonb_build_array(jsonb_build_object('columnKey','label','value','QBO-reported income','id','internal-cell'),
          jsonb_build_object('columnKey','amount','value','100.00','id',null)))),
      'contributionFamily','control_observation','additive',false,'parserVersion','qbo_report_parser_v1');
  else
    projection:=jsonb_build_object('contractVersion','qbo_source_record_minimized_v1','recordType',record_type,
      'id',record_id,'displayName',null,'active',null,'status',case when n=26 then 'voided' else 'active' end,
      'metadata',jsonb_build_object('providerCreatedAt',stamp,'providerUpdatedAt',stamp,'syncToken','internal-sync'),
      'temporal',jsonb_build_object('postingDate','2026-09-01','providerCreatedAt',stamp,'providerUpdatedAt',stamp),
      'accounting',jsonb_build_object('basis','unknown','sourceCurrency','USD','homeCurrency',null,'exchangeRate',null),
      'relationships','{}'::jsonb,'amounts',jsonb_build_object('total',jsonb_build_object('amount','100','currency','USD')),
      'lines','[]'::jsonb,'providerVersionReference','1','minimizationVersion','qbo_minimizer_v1');
  end if;
  projection:=projection||jsonb_build_object('provider',jsonb_build_object('providerKey','quickbooks_online',
    'sourceEnvironment','production','realmId',case when t.connection_generation=1 then 'synthetic-production-realm-a' else 'synthetic-production-realm-b' end));
  v:=jsonb_build_object('contractVersion','external_source_record_version_v1','id',gen_random_uuid(),
    'workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,'connectionId',t.connection_id,
    'immutableVersion',1,'priorVersionId',null,'recordKind',case when is_report then 'qbo_report_profitandloss' else t.stream_key end,
    'source',jsonb_build_object('kind','provider','providerKey','quickbooks_online','providerRecordType',record_type,
      'providerRecordId',record_id,'providerVersionReference','1'),
    'temporal',jsonb_build_object('basis',case when is_report then 'period' else 'event' end,
      'providerCreatedAt',case when is_report then null else stamp end,'providerUpdatedAt',case when is_report then null else stamp end,
      'observedAt',stamp,'synchronizedAt',stamp,'ingestedAt',stamp,'effectiveAt',case when is_report then null else '2026-09-01T00:00:00.000Z' end,
      'postingDate',case when is_report then null else '2026-09-01' end,'periodStart',case when is_report then '2026-09-01' else null end,
      'periodEnd',case when is_report then '2026-09-28' else null end,'sourceTimeZone',null),
    'accounting',jsonb_build_object('basis',case when is_report then 'accrual' else 'unknown' end,'currency','USD'),
    'normalizedSchemaVersion',case when is_report then 'qbo_report_parser_v1' else 'qbo_minimizer_v1' end,
    'changeKind',case when n=27 then 'deleted' when n=26 then 'voided' else 'created' end,
    'normalizedProjection',case when n=27 then null else projection end,
    'trust','untrusted_external_input','validation',jsonb_build_object('state','pending',
      'validatorVersion','qbo_phase_7_contract_validator_v1','issues','[]'::jsonb),'receivedAt',stamp);
  return v||jsonb_build_object('sourceFingerprint',pg_temp.browse_source_hash(v));
end;
$$;
create function pg_temp.browse_validation_result(claim jsonb,quarantine boolean) returns jsonb language plpgsql as $$
declare v jsonb:=claim->'pendingVersion';
begin
  v:=v||jsonb_build_object('id',claim->'validatedVersionId','priorVersionId',v->'id',
    'immutableVersion',(v->>'immutableVersion')::int+1,'changeKind',case when v->>'changeKind'='deleted' then 'deleted' else 'unchanged' end,
    'receivedAt',claim->'validatedAt','validation',jsonb_build_object('state',case when quarantine then 'quarantined' else 'valid' end,
      'validatorVersion','qbo_production_source_validator_v1','issues',case when quarantine then jsonb_build_array(
        jsonb_build_object('code','qbo_inactive_source_requires_review','severity','error','field',null,'detail','Synthetic bounded issue.')) else '[]'::jsonb end));
  return v||jsonb_build_object('sourceFingerprint',pg_temp.browse_source_hash(v));
end;
$$;

-- Real role/JWT/session checks run inside the public RPC. This temporary wrapper
-- only supplies test JWTs, captures denials and restores the test runner role.
create function pg_temp.browse_as(claims jsonb,w uuid default 'b9f00000-0000-4000-8000-000000000001',
  c uuid default 'e9f00000-0000-4000-8000-000000000101',a uuid default null,s uuid default null,k text default 'all')
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims',claims::text,true);
  set local role authenticated;
  result:=public.qbo_customer_source_browse_v1(w,c,a,s,k);
  reset role;
  return result;
exception when others then
  reset role;
  return jsonb_build_object('testErrorState',sqlstate,'testErrorMessage',sqlerrm);
end;
$$;
create function pg_temp.owner_claims() returns jsonb language sql immutable as $$
  select '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000001","session_id":"79f00000-0000-4000-8000-000000000101"}'::jsonb;
$$;
select is(pg_temp.browse_as(pg_temp.owner_claims())#>>'{metrics,currentSources}','0','empty current connection reports zero stored records');
select is(pg_temp.browse_as(pg_temp.owner_claims())->>'coverage','unknown','empty import does not claim complete coverage');
select is(pg_temp.browse_as(pg_temp.owner_claims()-'session_id')->>'testErrorState','42501','missing session denied');
select is(pg_temp.browse_as(pg_temp.owner_claims()||'{"session_id":"79f00000-0000-4000-8000-000000000103"}') ->>'testErrorState',
  '42501','another user session denied');
select is(pg_temp.browse_as(pg_temp.owner_claims(),'b9f00000-0000-4000-8000-000000000002')->>'testErrorState','42501','foreign workspace denied');
select is(pg_temp.browse_as(pg_temp.owner_claims(),c=>'e9f00000-0000-4000-8000-000000000103')->>'testErrorState','42501','foreign connection denied');
update public.workspace_members set role='manager' where user_id='a9f00000-0000-4000-8000-000000000001';
select is(pg_temp.browse_as(pg_temp.owner_claims())->>'testErrorState','42501','manager cannot browse');
update public.workspace_members set role='owner' where user_id='a9f00000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='79f00000-0000-4000-8000-000000000101';
select is(pg_temp.browse_as(pg_temp.owner_claims())->>'testErrorState','42501','expired session denied');
update auth.sessions set not_after=null where id='79f00000-0000-4000-8000-000000000101';
select is(pg_temp.browse_as(pg_temp.owner_claims())#>>'{metrics,currentSources}','0','live session without absolute expiry is accepted');
update public.business_entities set status='inactive' where id='d9f00000-0000-4000-8000-000000000001';
select is(pg_temp.browse_as(pg_temp.owner_claims())->>'testErrorState','42501','inactive entity denied');
update public.business_entities set status='active' where id='d9f00000-0000-4000-8000-000000000001';

-- Obtain real initialization tasks. Their ordinary transition guards stay on.
select set_config('request.jwt.claims','{}',true);
select public.schedule_qbo_initialization_v2(2,'browse_fixture_schedule');
update private.integration_sync_tasks set state='dispatched',dispatcher_task_name=encode(extensions.digest(convert_to(id::text,'UTF8'),'sha256'),'hex'),
  dispatch_generation=1,row_version=row_version+1,updated_at=clock_timestamp()
  where stream_key in ('qbo_invoice','qbo_payment','qbo_deposit','qbo_profitandloss');
update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),lease_owner_fingerprint=decode(repeat('a',64),'hex'),
  lease_expires_at=clock_timestamp()+interval '1 hour',heartbeat_at=clock_timestamp(),
  delivery_attribution_state='attributed',last_delivery_dispatch_generation=1,last_delivery_retry_count=0,
  last_delivery_execution_count=0,last_delivery_attempt_fingerprint=decode(repeat('b',64),'hex'),
  row_version=row_version+1,updated_at=clock_timestamp()
  where stream_key in ('qbo_invoice','qbo_payment','qbo_deposit','qbo_profitandloss');
create temporary table browse_commands as
select t.id task_id,t.connection_id,n,v.value version,jsonb_build_object('contractVersion','integration_provider_source_commit_v1',
  'taskId',t.id,'leaseId',t.lease_id,'leaseOwnerFingerprint','sha256:'||repeat('a',64),'mappingId',t.control_metadata->>'mappingId',
  'sourceIdentityFingerprint','sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'identityVersion','external_source_identity_v1','workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
    'connectionId',t.connection_id,'source',(v.value->'source')-'providerVersionReference')),'hex'),'version',v.value) command
from private.integration_sync_tasks t cross join lateral generate_series(1,case when t.connection_generation=1 and t.stream_key='qbo_invoice' then 27 else 1 end) n
cross join lateral (select pg_temp.browse_source_version(t,n) value) v
where (t.connection_generation=1 and t.stream_key in ('qbo_invoice','qbo_payment','qbo_deposit','qbo_profitandloss'))
  or (t.connection_generation=2 and t.stream_key='qbo_invoice');
select is((select count(*)::int from browse_commands),31,'fixture includes 30 A sources and one foreign source');
grant select on browse_commands to integration_provider_source_authority;
set local role integration_provider_source_authority;
select public.commit_provider_external_source_record_version_v1(command,'browse_commit_'||(version->>'id')) from browse_commands;
select public.commit_provider_external_source_record_version_v1(command,'browse_replay_'||(version->>'id')) from browse_commands;
reset role;
select is((select count(*)::int from private.external_source_records),31,'native replay preserves source identity');
select is((select count(*)::int from private.external_source_record_versions),31,'native replay creates no duplicate version');

create temporary table browse_page as select pg_temp.browse_as(pg_temp.owner_claims()) value;
select is((select value#>>'{metrics,currentSources}' from browse_page),'30','counts are exact for authorized connection across pages');
select is((select value#>>'{metrics,transactionRecords}' from browse_page),'29','transaction count is not economic sales count');
select is((select value#>>'{metrics,reportObservations}' from browse_page),'1','report observations counted separately');
select is((select jsonb_array_length(value->'sources') from browse_page),25,'source page is bounded at 25');
select is(pg_temp.browse_as(pg_temp.owner_claims(),a=>(select (value->>'nextAfter')::uuid from browse_page))#>>'{metrics,currentSources}',
  '30','second page retains whole-selection count');
select is(jsonb_array_length(pg_temp.browse_as(pg_temp.owner_claims(),a=>(select (value->>'nextAfter')::uuid from browse_page))->'sources'),
  5,'next cursor returns remaining source identities');
select is(pg_temp.browse_as(pg_temp.owner_claims(),k=>'reports')#>>'{metrics,transactionRecords}','0','report filter excludes transaction records');
select is(pg_temp.browse_as(pg_temp.owner_claims(),k=>'records')#>>'{metrics,reportObservations}','0','record filter excludes report observations');
select is(pg_temp.browse_as(pg_temp.owner_claims(),k=>'malformed')->>'testErrorState','22023','invalid category denied');
select is(pg_temp.browse_as(pg_temp.owner_claims(),s=>(select id from private.external_source_records where
  workspace_id='b9f00000-0000-4000-8000-000000000002' limit 1))->>'testErrorState','42501','foreign source detail denied');
select is(pg_temp.browse_as(pg_temp.owner_claims(),a=>gen_random_uuid())->>'testErrorState','42501','unbound cursor denied');
select is((select value->>'additive' from browse_page),'false','browse has no additive revenue authority');
select ok(not (select (value->'metrics') ?| array['revenue','sales','profit','amount','combinedRevenue'] from browse_page),
  'metrics contain no synthesized or cross-provider financial totals');
select is((select value#>>'{metrics,missingSourceTimeZone}' from browse_page),'30','unknown source time zones are counted, not inferred from entity');
select is((select value#>>'{metrics,unknownAccountingBasis}' from browse_page),'29','unknown source bases remain explicit');

create temporary table browse_report as select pg_temp.browse_as(pg_temp.owner_claims(),s=>(select id from private.external_source_records
  where workspace_id='b9f00000-0000-4000-8000-000000000001' and provider_record_type='ProfitAndLoss')) value;
select is((select value#>>'{detail,preview,value,rows,0,cells,1,value}' from browse_report),'100.00','QBO report value is retained verbatim, not computed');
select is((select value#>>'{detail,preview,value,reportBasis}' from browse_report),'accrual','report basis preserved');
select is((select value#>>'{detail,preview,value,sourceCurrency}' from browse_report),'USD','report currency preserved');
select is((select value#>>'{detail,source,periodStart}' from browse_report),'2026-09-01','source reporting period preserved');
select ok((select value#>>'{detail,source,observedAt}' is not null and value#>>'{detail,source,synchronizedAt}' is not null from browse_report),
  'observation and stored synchronization timestamps accompany values');
select ok((select value::text !~ 'realmId|synthetic-production-realm|internal-cell|syncToken|credential|Fingerprint|claimId|taskId' from browse_report),
  'customer response strips realm, credentials, fingerprints, sync tokens and work internals');

create temporary table browse_claims as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('c',64),100)) value from (select distinct task_id from browse_commands where
    connection_id='e9f00000-0000-4000-8000-000000000101' and version#>>'{source,providerRecordType}'='Invoice') tasks;
select public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('c',64),pg_temp.browse_validation_result(value,value#>>'{pendingVersion,source,providerRecordId}'<>'browse-Invoice-1'),
  'browse_validate_'||(value->>'sourceVersionId')) from browse_claims
  where value#>>'{pendingVersion,source,providerRecordId}' in ('browse-Invoice-1','browse-Invoice-26','browse-Invoice-27');
create temporary table browse_tombstone as select pg_temp.browse_as(pg_temp.owner_claims(),s=>(select id from private.external_source_records
  where connection_id='e9f00000-0000-4000-8000-000000000101' and provider_record_id='browse-Invoice-27')) value;
select is((select value#>>'{detail,source,lifecycle}' from browse_tombstone),'deleted','tombstone is the current source');
select is((select value#>>'{detail,source,validation}' from browse_tombstone),'quarantined','work quarantine overrides immutable pending tombstone');
select is((select value#>>'{detail,source,validationWork}' from browse_tombstone),'quarantined','safe effective review status shown');
select is((select value#>>'{detail,preview,state}' from browse_tombstone),'restricted','no stale pre-deletion values are displayed');
select ok((select completed_version_id is null from private.qbo_production_source_validation_work w join private.external_source_records s
  on s.id=w.source_record_id where s.connection_id='e9f00000-0000-4000-8000-000000000101' and s.provider_record_id='browse-Invoice-27'),
  'native tombstone has no fabricated validated version');
select is(pg_temp.browse_as(pg_temp.owner_claims(),s=>(select id from private.external_source_records where
  connection_id='e9f00000-0000-4000-8000-000000000101' and provider_record_id='browse-Invoice-26'))#>>'{detail,preview,state}',
  'restricted','voided quarantine cannot present active document values');
select is(pg_temp.browse_as(pg_temp.owner_claims(),s=>(select id from private.external_source_records where
  connection_id='e9f00000-0000-4000-8000-000000000101' and provider_record_id='browse-Invoice-1'))#>>'{detail,source,validation}',
  'valid','completed validated current version is read through its exact work lineage');

create temporary table browse_before as select (select count(*) from private.external_source_record_versions) versions,
  (select count(*) from private.integration_audit_events) audits,(select count(*) from private.integration_sync_checkpoints) checkpoints,
  (select count(*) from private.canonical_business_facts) facts;
select pg_temp.browse_as(pg_temp.owner_claims());
select ok((select versions=(select count(*) from private.external_source_record_versions)
  and audits=(select count(*) from private.integration_audit_events) and checkpoints=(select count(*) from private.integration_sync_checkpoints)
  and facts=(select count(*) from private.canonical_business_facts) from browse_before),'browsing changes no source, audit, checkpoint or economic fact');
select is((select count(*)::int from private.canonical_business_facts),0,'validation and browsing do not promote economic facts');
delete from auth.sessions where id='79f00000-0000-4000-8000-000000000101';
select is(pg_temp.browse_as(pg_temp.owner_claims())->>'testErrorState','42501','revoked session denied after data exists');
select * from finish();
rollback;
