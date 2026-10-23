// Disposable synthetic Sandbox fixture only. No remote connection, provider or policy activation.
// Exact repository observation/authority helpers run over minimum queried table shapes.
import assert from 'node:assert/strict';
import {typedSetup,sheetsFixture,read,uuid,w,other,owner,owner2,member,session,secondSession,memberSession,entity,admin,login} from './shared-evidence-sql-fixture.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
export const ids=Object.freeze({workspace:w,otherWorkspace:other,owner,otherOwner:owner2,member,session,otherSession:secondSession,memberSession,entity,
 installation:uuid(910),qboConnection:uuid(911),qboMapping:uuid(912),qboSource:uuid(913),qboVersion:uuid(914),squareConnection:uuid(915),squareCredential:uuid(916),squareTask:uuid(917),ticket:uuid(101),request:uuid(103),conversation:uuid(102)});
export const fixtureLimitations=Object.freeze([
 'Minimum synthetic Sandbox table shapes, not deployed table/constraint/trigger parity.',
 'Generic source-version payload validator is a fixture-only bounded identity assertion; Square observation, pending scope, materializer and canonical hashing are repository functions.',
 'Interpretation semantic envelope is synthetic; provider interpretation ingestion and its administrative commit workflow are not executed.',
 'PGlite single backend does not establish native table-lock concurrency.',
 'The explicit enabledPolicy helper models hypothetical activation only; setup installs no policy row.'
]);
const functionFrom=(file,name)=>{const sql=read(file),escaped=name.replaceAll('.','\\.');const match=sql.match(new RegExp(`create(?: or replace)? function ${escaped}\\([\\s\\S]*?\\bas (\\$[^$]*\\$)[\\s\\S]*?\\1;`,'i'));assert.ok(match,`Repository function missing: ${name}`);return match[0];};
const base='supabase/migrations/';
export async function sandboxLogin(db,actor=owner,sid=session,role='authenticated',patch={}){
 await login(db,actor,sid,role);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:sid,role,iss:(await db.query('select public.fixture_sandbox_issuer() issuer')).rows[0].issuer,is_anonymous:false,...patch})]);
}
export async function enabledPolicy(db,{installation=ids.installation,expiresAt,enabled=true}={}){
 await admin(db);
 await db.query("insert into private.sandbox_shared_evidence_policies(installation_id,workspace_id,business_entity_id,qbo_connection_id,qbo_generation,square_connection_id,square_generation,expected_issuer,policy_version,enabled,expires_at) values($1,$2,$3,$4,1,$5,1,private.sandbox_evidence_issuer_v1(),'sandbox_descriptive_evidence_v1',$6,coalesce($7::timestamptz,clock_timestamp()+interval '1 hour'))",[installation,w,entity,ids.qboConnection,ids.squareConnection,enabled,expiresAt??null]);
 await sandboxLogin(db);return installation;
}
export async function setupSandboxFixture(options={}){
 const {db}=await typedSetup(options);
 try{
 await admin(db);await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));
 const credentialDDL=read(base+'20261019001207_ready_account_reporting_connectors.sql').match(/create table public\.reporting_credentials \([\s\S]*?\n\);/i)?.[0];assert.ok(credentialDDL);await db.exec(credentialDDL);
 for(const file of ['07-reopen-shared-artifact.sql','09-katana-installation-boundary.sql','10-memory-semantic-receipts.sql','11-generation-discovery.sql'])await db.exec(read('docs/security-drafts/'+file));
 await installFenceFixture(db);await admin(db);
 await db.exec(`create schema if not exists extensions;
 create function extensions.digest(v bytea,algorithm text) returns bytea language plpgsql immutable as $$begin if algorithm<>'sha256' then raise exception 'fixture_digest_unsupported';end if;return sha256(v);end$$;
 alter table private.external_source_record_versions add column change_kind text,add column source_fingerprint bytea;
 alter table private.provider_entity_mappings add column provider_entity_reference_fingerprint bytea;
 create table private.square_account_configuration(environment text,application_id text,blocked boolean,approval_expires_at timestamptz,retention_policy_version text,retention_approval_fingerprint text,source_retention_seconds bigint,cursor_retention_seconds bigint,revocation_access_policy text);
 create table private.square_account_connections(connection_id uuid,workspace_id uuid,business_entity_id uuid,environment text,application_id text,generation bigint,state text,revocation_pending boolean,merchant_id text,discovery jsonb,credential_id uuid,mapped_locations jsonb);
 create table private.square_connections(connection_id uuid,workspace_id uuid,business_entity_id uuid,state text,revoked_at timestamptz,environment text,current_generation bigint,seller_id text);
 create table private.square_connection_generations(connection_id uuid,connection_generation bigint,identity_mode text,identity_evidence_fingerprint text,retention_expires_at timestamptz,retention_policy_version text,retention_approval_fingerprint text);
 create table private.square_account_enrollments(connection_id uuid,generation bigint,discovery_fingerprint text,credential_id uuid,retention_policy_version text,retention_approval_fingerprint text,source_retention_seconds bigint,cursor_retention_seconds bigint,revocation_access_policy text);
 create table private.square_account_capacity_blocks(environment text,application_id text);
 create table private.square_ingestion_resources(resource_key text,workspace_id uuid,business_entity_id uuid,connection_id uuid,current_version_key text,stream text,provider_record_type text,provider_record_id text);
 create table private.square_ingestion_versions(version_key text,resource_key text,workspace_id uuid,business_entity_id uuid,connection_id uuid,ordering text,version_id uuid,ordinal bigint,version jsonb,pending jsonb,retention_expires_at timestamptz,prior_version_id uuid);
 create table private.square_ingestion_page_receipts(scan_key text,page_id text,task_id uuid,connection_id uuid,workspace_id uuid,business_entity_id uuid,retention_expires_at timestamptz);
 create table private.square_ingestion_scans(scan_key text,stream text,connection_generation bigint);
 create table private.square_ingestion_tasks(task_id uuid,connection_id uuid,connection_generation bigint,"grant" jsonb);
 create table private.square_location_mappings(connection_id uuid,connection_generation bigint,location_id text);
 create table private.square_observation_approvals(approval_fingerprint text,approval jsonb);
 create table private.square_observation_admissions(resource_key text,version_key text,workspace_id uuid,business_entity_id uuid,connection_id uuid,generation bigint,fact jsonb,retention_expires_at timestamptz);
 create table private.square_interpretation_facts(version_key text,workspace_id uuid,business_entity_id uuid,connection_id uuid,generation bigint,fact jsonb,retention_expires_at timestamptz);
 create table private.square_interpretation_runs(connection_id uuid,generation bigint,workspace_id uuid,business_entity_id uuid,partition_fingerprint text,revision bigint,approval_fingerprint text,output jsonb,retention_expires_at timestamptz,created_at timestamptz);
 create function private.validate_source_version_payload_v1(v jsonb) returns void language plpgsql as $$begin
 if v->>'contractVersion'<>'external_source_record_version_v1' or v->>'id' is null or v->>'workspaceId' is null or v->>'sourceFingerprint' !~ '^sha256:[0-9a-f]{64}$' then raise exception 'fixture_source_shape_invalid' using errcode='22023';end if;end$$;`);
 const foundation=base+'20260820233007_external_integrations_phase_1_canonical_foundation.sql';
 for(const name of ['is_bounded_identifier_v1','jsonb_has_exact_keys_v1'])await db.exec(functionFrom(foundation,'private.'+name));
 const canonical=base+'20260821172015_external_integrations_phase_3_deterministic_dependencies.sql';
 for(const name of ['phase_3_canonical_json_v1','phase_3_contract_fingerprint_v1'])await db.exec(functionFrom(canonical,'private.'+name));
 const phase8b=base+'20260823042718_external_integrations_phase_8b_qbo_sandbox_validation.sql';
 for(const name of ['is_qbo_phase_8b_validated_projection_v1','qbo_phase_8b_realm_fingerprint_v1'])await db.exec(functionFrom(phase8b,'private.'+name));
 const pages=base+'20260907042352_square_dormant_atomic_pages.sql';
 for(const name of ['square_utf16_length_v1','square_walk_page_json_v1','square_page_canonical_tokens_v1','square_page_hash_v1','square_pending_authority_v1','square_pending_source_v1','square_materialize_source_v1'])await db.exec(functionFrom(pages,'private.'+name));
 await db.exec(functionFrom(base+'20260911151334_square_verified_provider_observations.sql','private.square_observation_fact_v1'));
 // Metadata pins are read from the repository clone; synthetic data never copies hosted rows.
 const authority=read(base+'20260911222230_square_workspace_evidence.sql');
 const application=authority.match(/application_id='([^']+)'/)?.[1];assert.ok(application);
 const issuer=authority.match(/iss' is distinct from '([^']+)'/)?.[1];assert.ok(issuer);
 await db.exec(`create function public.fixture_sandbox_issuer() returns text language sql immutable as $$select '${issuer}'::text$$;`);
 const until=new Date(Date.now()+3600000).toISOString(),observedAt=new Date(Date.now()-60000).toISOString();
 const policy='synthetic-retention-v1',fingerprint='sha256:'+'a'.repeat(64),seller='SELLER_SYNTHETIC',location='LOC_SYNTHETIC';
 await db.query('insert into private.square_account_configuration values($1,$2,false,$3,$4,$5,3600,600,$6)',['sandbox',application,until,policy,fingerprint,'deny_source_access']);
 await db.query('insert into private.square_account_connections values($1,$2,$3,$4,$5,1,$6,false,$7,$8,$9,$10)',[ids.squareConnection,w,entity,'sandbox',application,'authorized',seller,JSON.stringify({fingerprint}),ids.squareCredential,JSON.stringify([location])]);
 await db.query("insert into private.square_connections values($1,$2,$3,'active',null,'sandbox',1,$4)",[ids.squareConnection,w,entity,seller]);
 await db.query("insert into private.square_connection_generations values($1,1,'oauth_verified',$2,$3,$4,$2)",[ids.squareConnection,fingerprint,until,policy]);
 await db.query("insert into private.square_account_enrollments values($1,1,$2,$3,$4,$2,3600,600,'deny_source_access')",[ids.squareConnection,fingerprint,ids.squareCredential,policy]);
 await db.query('insert into private.square_location_mappings values($1,1,$2)',[ids.squareConnection,location]);
 const scope={workspaceId:w,businessEntityId:entity,connectionId:ids.squareConnection,environment:'sandbox',sellerId:seller,authorizedLocationIds:[location],generation:1};
 const data={id:'PAYMENT_SYNTHETIC',entityType:'payment',provider:{providerKey:'square',providerEnvironment:'sandbox',apiVersion:'2026-08-19'},authority:{providerKey:'square',providerEnvironment:'sandbox',workspaceId:w,businessEntityId:entity,connectionId:ids.squareConnection,providerEntityId:seller,providerEntityType:'merchant',providerId:'PAYMENT_SYNTHETIC',locationId:location},locationId:location,status:'COMPLETED',updatedAt:observedAt};
 const pending={resourceKey:'',versionKey:'',scope,stream:'payments',providerRecordId:data.id,providerRecordType:'square_payment',providerRevision:{version:null,updatedAt:observedAt},observedAt,deleted:false,projection:{mappingVersion:'square_pending_source_mapping_v1',stream:'payments',role:'primary',authority:'pending_provider_observation_not_economic_authority',data}};
 const sqlHash=async value=>(await db.query('select private.square_page_hash_v1($1) h',[JSON.stringify(value)])).rows[0].h;
 pending.resourceKey=await sqlHash({purpose:'square_source_resource_identity_v1',scope:Object.fromEntries(Object.entries(scope).filter(([key])=>!['authorizedLocationIds','generation'].includes(key))),stream:'payments',providerRecordType:pending.providerRecordType,providerRecordId:pending.providerRecordId});
 pending.versionKey=await sqlHash({purpose:'square_source_observed_version_v1',mappingVersion:'square_pending_source_mapping_v1',resourceKey:pending.resourceKey,providerRevision:pending.providerRevision,deleted:false,projection:pending.projection});
 const version=(await db.query('select private.square_materialize_source_v1($1,1,null) v',[JSON.stringify(pending)])).rows[0].v;
 const scan='scan-synthetic',page='page-synthetic';
 await db.query('insert into private.square_ingestion_resources values($1,$2,$3,$4,$5,$6,$7,$8)',[pending.resourceKey,w,entity,ids.squareConnection,pending.versionKey,'payments','square_payment',data.id]);
 await db.query('insert into private.square_ingestion_scans values($1,$2,1)',[scan,'payments']);
 await db.query('insert into private.square_ingestion_tasks values($1,$2,1,$3)',[ids.squareTask,ids.squareConnection,JSON.stringify({stream:'payments',scope})]);
 // The observation validator requires corroborating original xmin values.
 await db.exec('begin');
 await db.query("insert into private.square_ingestion_versions values($1,$2,$3,$4,$5,'newer',$6,1,$7,$8,$9,null)",[pending.versionKey,pending.resourceKey,w,entity,ids.squareConnection,version.id,JSON.stringify(version),JSON.stringify(pending),until]);
 await db.query('insert into private.square_ingestion_page_receipts values($1,$2,$3,$4,$5,$6,$7)',[scan,page,ids.squareTask,ids.squareConnection,w,entity,until]);await db.exec('commit');
 const manifest={resourceKey:pending.resourceKey,versionKey:pending.versionKey,sourceRecordVersionId:version.id,sourceFingerprint:version.sourceFingerprint,expectedCurrentVersionKey:pending.versionKey,receiptScanKey:scan,receiptPageId:page};
 const approval={workspaceId:w,businessEntityId:entity,connectionId:ids.squareConnection,generation:1,manifest:[manifest]};
 const approvalFingerprint=await sqlHash(approval),observation=(await db.query('select private.square_observation_fact_v1($1,$2) v',[JSON.stringify(approval),JSON.stringify(manifest)])).rows[0].v;
 await db.query('insert into private.square_observation_approvals values($1,$2)',[approvalFingerprint,JSON.stringify(approval)]);
 await db.query('insert into private.square_observation_admissions values($1,$2,$3,$4,$5,1,$6,$7)',[pending.resourceKey,pending.versionKey,w,entity,ids.squareConnection,JSON.stringify(observation),until]);
 const semantic={kind:'payment',resourceKey:pending.resourceKey,versionKey:pending.versionKey,observationFingerprint:observation.factFingerprint,status:'COMPLETED',economic:'blocked',historical:'unknown',money:{amount:{amountMinor:'12500',currency:'USD'}}};
 const fact={...observation,value:{kind:'structured',value:semantic},factFingerprint:await sqlHash(semantic)};
 const partition=await sqlHash([pending.resourceKey]);
 await db.query('insert into private.square_interpretation_facts values($1,$2,$3,$4,1,$5,$6)',[pending.versionKey,w,entity,ids.squareConnection,JSON.stringify(fact),until]);
 await db.query("insert into private.square_interpretation_runs values($1,1,$2,$3,$4,1,$5,$6,$7,now())",[ids.squareConnection,w,entity,partition,approvalFingerprint,JSON.stringify({policyVersion:'square_canonical_interpretation_v1',economic:'blocked',historical:'unknown',facts:[fact],relationships:{links:[]}}),until]);
 const day=observedAt.slice(0,10),realm='REALM_SYNTHETIC';
 const projection={contractVersion:'qbo_report_control_observation_v1',provider:{providerKey:'quickbooks_online',realmId:realm,sourceEnvironment:'sandbox'},reportType:'ProfitAndLoss',reportBasis:'accrual',sourceCurrency:'USD',periodStart:day,periodEnd:day,columns:[{columnKey:'account',title:'Account'},{columnKey:'amount',title:'Total'}],rows:[{rowType:'summary',cells:[{columnKey:'account',value:'Net Income'},{columnKey:'amount',value:'900.00'}],children:[]}],contributionFamily:'control_observation',additive:false,parserVersion:'qbo_report_parser_v1'};
 const recordId=`ProfitAndLoss:accrual:${day}:${day}:USD`;
 await db.query("insert into private.integration_connections values($1,$2,$3,'quickbooks_online','sandbox','active',1)",[ids.qboConnection,w,entity]);
 await db.query("insert into private.provider_entity_mappings(id,workspace_id,business_entity_id,connection_id,provider_key,provider_environment,status,verified_at,row_version,provider_entity_reference_fingerprint) values($1,$2,$3,$4,'quickbooks_online','sandbox','active',now(),1,private.qbo_phase_8b_realm_fingerprint_v1($5))",[ids.qboMapping,w,entity,ids.qboConnection,realm]);
 await db.query("insert into private.external_source_records values($1,$2,$3,$4,$5,'quickbooks_online','provider','active',$6,'ProfitAndLoss',$7)",[ids.qboSource,w,entity,ids.qboConnection,ids.qboMapping,ids.qboVersion,recordId]);
 await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,period_start,period_end,source_timezone,accounting_basis,accounting_currency,change_kind,source_fingerprint) values($1,$2,$3,$4,$5,'quickbooks_online','provider','ProfitAndLoss',$6,'valid',$7::jsonb,$8,$8,'UTC','accrual','USD','unchanged',sha256(convert_to(($7::jsonb)::text,'UTF8')))",[ids.qboVersion,w,entity,ids.qboConnection,ids.qboSource,recordId,JSON.stringify(projection),day]);
 await db.exec(read('docs/security-drafts/sandbox/admission.sql'));
 assert.equal((await db.query('select count(*)::int n from private.sandbox_shared_evidence_policies')).rows[0].n,0);
 const qboIdentity={kind:'qbo_sandbox_version',environment:'sandbox',installation_id:ids.installation,source_id:ids.qboSource,version_id:ids.qboVersion};
 const squareIdentity={kind:'square_sandbox_observation',environment:'sandbox',installation_id:ids.installation,resource_key:pending.resourceKey,version_key:pending.versionKey,interpretation_revision:1};
 await sandboxLogin(db);
 return {db,ids,qboIdentity,squareIdentity,day,manifest,projection,scope,pending,version,observation,interpretationFact:fact,limitations:fixtureLimitations,enabledPolicy:options=>enabledPolicy(db,options),login:(...args)=>sandboxLogin(db,...args)};
 }catch(error){await db.close();throw error;}
}
