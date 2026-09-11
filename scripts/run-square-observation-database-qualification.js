/* Actual PostgreSQL, owned disposable local database only; synthetic trusted seed rows. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");
let stage="startup", assertions=0;
const eq=(a,b,label)=>{assertions++;assert.deepEqual(a,b,label);};
async function qualify(runtime) {
  runtime.installTypescriptLoader();
  const {contractSha256}=require("../lib/integrations/contracts/canonical.ts");
  const mapping=require("../lib/integrations/providers/square/ingestion-mapping.ts");
  const policy=require("../lib/integrations/providers/square/observation-admission.ts");
  const db=await runtime.createDatabase("observations"), c=db.client;
  const files=runtime.migrationFiles();
  eq(files.length,111,"full canonical chain, including admission migration");
  stage="migrations";
  await runtime.applyMigrations(c,files.slice(0,-1));
  const schemaBefore=await runtime.sourceSchemaFingerprint(c);
  await runtime.applyMigrations(c,files.slice(-1));
  eq(await runtime.sourceSchemaFingerprint(c),schemaBefore,"additive migration preserves canonical/QBO schema");
  const genericCounts=async()=>{const counts={};for(const table of ["external_source_records","external_source_record_versions","canonical_business_facts","canonical_business_fact_versions","business_fact_sources","fact_contribution_batches","fact_contribution_events"])counts[table]=(await c.query(`select count(*)::int n from private.${table}`)).rows[0].n;return counts;};
  const genericBefore=await genericCounts();
  const id=()=>crypto.randomUUID(), fp=contractSha256({synthetic:"observation"});
  const actor=id(),workspace=id(),entity=id(),connection=id(),session=id(),credential=id();
  const now=new Date().toISOString(), later=new Date(Date.now()+86400000).toISOString();
  const scope={workspaceId:workspace,businessEntityId:entity,connectionId:connection,sellerId:"SELLER_SYNTHETIC",environment:"sandbox",authorizedLocationIds:["LOC_SYNTHETIC"],generation:4};
  // Fixed table names supplied exclusively by this local test, never external input.
  async function insert(table,row) {
    stage="seed_"+table.replaceAll(".","_");
    const keys=Object.keys(row);
    await c.query(`insert into ${table} (${keys.map(k=>'"'+k+'"').join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]&&typeof row[k]==="object"?JSON.stringify(row[k]):row[k]));
  }
  stage="synthetic_authority";
  await insert("auth.users",{id:actor,email:"observation@example.invalid"});
  await insert("auth.sessions",{id:session,user_id:actor,not_after:later});
  await insert("public.workspaces",{id:workspace,name:"Synthetic observations",created_by:actor});
  await c.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active') on conflict(workspace_id,user_id) where user_id is not null do update set role='owner',status='active'",[workspace,actor]);
  await insert("public.business_entities",{id:entity,workspace_id:workspace,entity_key:"observations",display_name:"Synthetic observations",base_currency:"USD",timezone:"UTC",status:"active",created_by:actor,updated_by:actor});
  await insert("private.square_account_configuration",{environment:"sandbox",application_id:"sandbox-observation-synthetic",redirect_uri:"https://sandbox.example.invalid/callback",broker_login:"postgres",enrollment_login:"postgres",webhook_login:"postgres",kms_key_resource:"synthetic-unused",surface_enabled:false,enrollment_enabled:false,blocked:false,approval_expires_at:later,retention_policy_version:"synthetic_observation_v1",retention_approval_fingerprint:fp,source_retention_seconds:86400,cursor_retention_seconds:3600,revocation_access_policy:"deny_source_access"});
  await insert("private.square_account_connections",{connection_id:connection,workspace_id:workspace,business_entity_id:entity,environment:"sandbox",application_id:"sandbox-observation-synthetic",merchant_id:scope.sellerId,generation:4,row_version:1,state:"authorized",authorization_operation:"connect",initiating_actor:actor,initiating_session:session,credential_id:credential,credential_version:1,discovery:{fingerprint:fp},mapped_locations:["LOC_SYNTHETIC"],created_at:now,updated_at:now});
  await insert("private.square_connections",{connection_id:connection,workspace_id:workspace,business_entity_id:entity,seller_id:scope.sellerId,environment:"sandbox",current_generation:4,state:"active",created_at:now,updated_at:now});
  const scopeCols={connection_id:connection,workspace_id:workspace,business_entity_id:entity};
  await insert("private.square_ingestion_capacity",scopeCols);
  await insert("private.square_connection_generations",{...scopeCols,connection_generation:4,identity_mode:"oauth_verified",identity_evidence_fingerprint:fp,default_location_id:"LOC_SYNTHETIC",default_discovery_fingerprint:fp,retention_policy_version:"synthetic_observation_v1",retention_approval_fingerprint:fp,retention_expires_at:later,enrolled_by:"postgres",enrolled_at:now});
  await insert("private.square_account_enrollments",{connection_id:connection,generation:4,credential_id:credential,discovery_fingerprint:fp,retention_policy_version:"synthetic_observation_v1",retention_approval_fingerprint:fp,source_retention_seconds:86400,cursor_retention_seconds:3600,revocation_access_policy:"deny_source_access",confirmed_by:actor,confirmed_session:session,enrolled_by:"postgres",enrolled_at:now});
  const inputs=[],manifest=[];
  stage="synthetic_immutable_sources";
  for(const type of policy.SQUARE_OBSERVATION_RECORD_TYPES) {
    const stream=type.startsWith("square_catalog")?"catalog":type.startsWith("square_inventory")?"inventory":type==="square_payment"?"payments":type==="square_refund"?"refunds":"order_tenders";
    // Minimal synthetic checked-source fixture, not a claim of full provider parser coverage.
    const provider={providerKey:"square",providerEnvironment:"sandbox",apiVersion:"2026-08-19"};
    const authority={providerKey:"square",providerEnvironment:"sandbox",connectionId:connection,providerEntityId:scope.sellerId,providerEntityType:"merchant",workspaceId:workspace,providerId:"SYNTHETIC",locationId:"LOC_SYNTHETIC"};
    const core={id:"SYNTHETIC",provider,authority,locationId:"LOC_SYNTHETIC",updatedAt:null};
    let data=core;
    if(stream==="catalog")data={...core,catalogObjectType:"ITEM_VARIATION",catalogVersion:"1",isDeleted:false,availability:{kind:"all_locations_except",absentLocationIds:[]}};
    if(stream==="order_tenders")data={adjustmentDetail:{lineItemDetail:{core:{...core,entityType:"order_core",providerVersion:"1"}}}};
    if(stream==="inventory")data={...core,entityType:type.slice(7),calculatedAt:null,...(type==="square_inventory_count_snapshot"?{authority:{...authority,snapshotIdentityFingerprint:"SYNTHETIC"}}:{})};
    const stableScope={...scope};delete stableScope.authorizedLocationIds;delete stableScope.generation;
    const pending={resourceKey:contractSha256({purpose:"square_source_resource_identity_v1",scope:stableScope,stream,providerRecordType:type,providerRecordId:"SYNTHETIC"}),scope,stream,providerRecordId:"SYNTHETIC",providerRecordType:type,providerRevision:{version:["catalog","order_tenders"].includes(stream)?"1":null,updatedAt:null},observedAt:now,deleted:false,projection:{mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,stream,role:"primary",authority:"pending_provider_observation_not_economic_authority",data}};
    pending.versionKey=contractSha256({purpose:"square_source_observed_version_v1",mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,resourceKey:pending.resourceKey,providerRevision:pending.providerRevision,deleted:false,projection:pending.projection});
    const sourceVersion=mapping.materializeSquarePendingSource(pending,1,null),task=id(),scan=contractSha256({task}),page=contractSha256({page:task});
    await insert("private.square_ingestion_tasks",{...scopeCols,connection_generation:4,task_id:task,runtime_login:"postgres",lease_owner_fingerprint:fp,grant:{scope,stream},binding:{},expires_at:later,retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now});
    await insert("private.square_ingestion_scans",{...scopeCols,connection_generation:4,scan_key:scan,initial_task_id:task,binding:{},stream,status:"finished",not_before:now,retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now,updated_at:now});
    await insert("private.square_ingestion_resources",{...scopeCols,resource_key:pending.resourceKey,stream,provider_record_type:type,provider_record_id:"SYNTHETIC"});
    await c.query("begin");
    await insert("private.square_ingestion_versions",{...scopeCols,version_key:pending.versionKey,resource_key:pending.resourceKey,ordinal:1,version_id:sourceVersion.id,pending,version:sourceVersion,ordering:"newer",retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now});
    await insert("private.square_ingestion_page_receipts",{...scopeCols,scan_key:scan,page_id:page,task_id:task,command_fingerprint:fp,checkpoint_version:1,retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now});
    await c.query("commit");
    await c.query("update private.square_ingestion_resources set current_version_key=$1,observed_version_key=$1,version_count=1 where resource_key=$2",[pending.versionKey,pending.resourceKey]);
    manifest.push({resourceKey:pending.resourceKey,versionKey:pending.versionKey,sourceRecordVersionId:sourceVersion.id,sourceFingerprint:sourceVersion.sourceFingerprint,expectedCurrentVersionKey:pending.versionKey,receiptScanKey:scan,receiptPageId:page});
    inputs.push({pending,sourceVersion});
  }
  const approval={contractVersion:"square_observation_approval_v1",policyVersion:policy.SQUARE_OBSERVATION_ADMISSION_POLICY,policyFingerprint:policy.SQUARE_OBSERVATION_POLICY_FINGERPRINT,workspaceId:workspace,businessEntityId:entity,connectionId:connection,generation:4,actorId:actor,expiresAt:new Date(Date.now()+3600000).toISOString(),manifest};
  const register=a=>c.query("select public.register_square_observation_approval_v1($1::jsonb) as value",[JSON.stringify(a)]).then(r=>r.rows[0].value);
  const admit=f=>c.query("select public.admit_square_provider_observations_v1($1) as value",[f]).then(r=>r.rows[0].value);
  async function denied(fn,label) {let error;try{await fn();}catch(e){error=e;}eq(error?.code,"42501",label);}
  async function changed(sql,params,fn,label){await c.query("begin");try{await c.query(sql,params);await denied(fn,label);}finally{await c.query("rollback");}}
  stage="authority_denials";
  await denied(()=>register(approval),"source authorized location requires existing verified mapping");
  await insert("private.square_location_mappings",{...scopeCols,connection_generation:4,location_id:"LOC_SYNTHETIC",verification_fingerprint:fp,mapped_by:"postgres",mapped_at:now});
  const unrelatedReceipt=contractSha256({synthetic:"later_receipt"});
  await c.query(`insert into private.square_ingestion_page_receipts(scan_key,page_id,workspace_id,business_entity_id,connection_id,task_id,command_fingerprint,checkpoint_version,retention_policy_version,retention_expires_at,created_at)
    select scan_key,$1,workspace_id,business_entity_id,connection_id,task_id,command_fingerprint,2,retention_policy_version,retention_expires_at,clock_timestamp()
    from private.square_ingestion_page_receipts where scan_key=$2 and page_id=$3`,[unrelatedReceipt,manifest[0].receiptScanKey,manifest[0].receiptPageId]);
  await denied(()=>register({...approval,manifest:[{...manifest[0],receiptPageId:unrelatedReceipt}]}),"valid same-scan receipt from another transaction does not corroborate source");
  for(const patch of [{workspaceId:id()},{businessEntityId:id()},{generation:3},{actorId:id()},{expiresAt:"2000-01-01T00:00:00Z"}])await denied(()=>register({...approval,...patch}),"approval tenant/generation/actor/expiry denied");
  await changed("update private.square_account_configuration set blocked=true",[],()=>register(approval),"blocked configuration denied");
  await changed("insert into private.square_account_capacity_blocks values('sandbox','sandbox-observation-synthetic',clock_timestamp())",[],()=>register(approval),"capacity fence denied");
  await changed("update public.workspace_members set status='disabled' where workspace_id=$1",[workspace],()=>register(approval),"disabled membership denied");
  await changed("update private.square_account_connections set revocation_pending=true",[],()=>register(approval),"pending revocation denied");
  await changed("update private.square_connections set state='revoked',revoked_at=clock_timestamp()",[],()=>register(approval),"revocation denied");
  await changed("update private.square_account_configuration set approval_expires_at=clock_timestamp()-interval '1 second'",[],()=>register(approval),"expired approval denied");
  await changed("update private.square_account_configuration set retention_policy_version='different_policy'",[],()=>register(approval),"retention policy drift denied");
  await changed("update private.square_account_configuration set source_retention_seconds=120",[],()=>register(approval),"source retention duration drift denied");
  await changed("update private.square_account_configuration set cursor_retention_seconds=120",[],()=>register(approval),"cursor retention duration drift denied");
  await changed("update public.business_entities set status='inactive' where id=$1",[entity],()=>register(approval),"inactive business entity denied");
  await changed("update private.square_account_connections set merchant_id='OTHER_SELLER'",[],()=>register(approval),"seller mismatch denied");
  await changed("update private.square_ingestion_resources set current_version_key=null",[],()=>register(approval),"stale current CAS denied");
  await changed(`insert into private.square_ingestion_versions(version_key,resource_key,workspace_id,business_entity_id,connection_id,ordinal,version_id,prior_version_id,pending,version,ordering,retention_policy_version,retention_expires_at,created_at)
    select $1,resource_key,workspace_id,business_entity_id,connection_id,2,$2,version_id,pending,version,'conflict',retention_policy_version,retention_expires_at,clock_timestamp()
    from private.square_ingestion_versions where version_key=$3`,[contractSha256({conflict:true}),id(),manifest[0].versionKey],()=>register(approval),"later conflict blocks earlier current pointer");
  for(const patch of [{sourceFingerprint:fp},{receiptPageId:fp},{expectedCurrentVersionKey:fp}])await denied(()=>register({...approval,manifest:[{...manifest[0],...patch}]}),"source/receipt/CAS tamper denied");
  stage="registration";
  const fingerprint=await register(approval);
  eq(fingerprint,contractSha256(approval),"SQL/TS approval fingerprint parity");
  const pendingBefore=(await c.query("select version_key,pending,version from private.square_ingestion_versions order by version_key")).rows;
  stage="atomic_admission";
  const last=[...manifest].sort((a,b)=>a.resourceKey.localeCompare(b.resourceKey)).at(-1);
  await changed("update private.square_ingestion_resources set current_version_key=null where resource_key=$1",[last.resourceKey],()=>admit(fingerprint),"late batch failure denied atomically");
  eq((await c.query("select count(*)::int n from private.square_observation_admissions")).rows[0].n,0,"failed batch leaves no admissions");
  await c.query("update private.square_account_configuration set blocked=true");
  await c.query("begin");
  await c.query("update private.square_account_configuration set blocked=false");
  await c.query("update private.square_ingestion_resources set current_version_key=null where resource_key=$1",[last.resourceKey]);
  await denied(()=>admit(fingerprint),"failed scoped unblock transaction denied");
  await c.query("rollback");
  eq((await c.query("select blocked from private.square_account_configuration")).rows[0].blocked,true,"failed transaction preserves original fence");
  eq((await c.query("select count(*)::int n from private.square_observation_admissions")).rows[0].n,0,"failed scoped transaction admits nothing");
  await c.query("begin");
  await c.query("update private.square_account_configuration set blocked=false");
  eq(await register(approval),fingerprint,"same finite approval replay");
  eq(await admit(fingerprint),{outcome:"admitted",observations:7,economic:"blocked"},"seven supported observation kinds admitted");
  const firstFacts=(await c.query("select version_key,fact from private.square_observation_admissions order by version_key")).rows;
  eq(await admit(fingerprint),{outcome:"admitted",observations:7,economic:"blocked"},"lost acknowledgement replay is idempotent");
  eq((await c.query("select version_key,fact from private.square_observation_admissions order by version_key")).rows,firstFacts,"replay preserves original timestamps and full immutable facts");
  await c.query("update private.square_account_configuration set blocked=true");
  await c.query("commit");
  await denied(()=>admit(fingerprint),"replay cannot bypass restored block");
  const facts=(await c.query("select version_key,fact from private.square_observation_admissions")).rows;
  for(const {version_key,fact} of facts){const input=inputs.find(x=>x.pending.versionKey===version_key);const result=policy.prepareSquareObservationAdmission({...input,currentAuthority:{scopeFingerprint:contractSha256(scope),resourceKey:input.pending.resourceKey,currentVersionKey:version_key,sourceFingerprint:input.sourceVersion.sourceFingerprint,ordering:"newer",admittedAt:fact.createdAt}});eq(fact,result.fact,"SQL/TS entire canonical fact parity");}
  eq((await c.query("select version_key,pending,version from private.square_ingestion_versions order by version_key")).rows,pendingBefore,"pending sources remain byte-semantically unchanged");
  stage="immutable_and_privilege_denials";
  for(const table of ["square_observation_approvals","square_observation_admissions"]) {
    let rejected=false;try{await c.query(`delete from private.${table}`);}catch{rejected=true;}eq(rejected,true,"immutable observation history");
    rejected=false;try{await c.query(`update private.${table} set approval_fingerprint=approval_fingerprint`);}catch{rejected=true;}eq(rejected,true,"immutable history rejects even no-op update");
    const r=(await c.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",['private.'+table])).rows[0];eq(r,{relrowsecurity:true,relforcerowsecurity:true},"forced RLS");
  }
  for(const role of ["anon","authenticated","service_role"]) {
    stage="application_role_switch_"+role;
    await c.query(`set role ${role}`);try{stage="application_denials_"+role;await denied(()=>register(approval),"application role cannot register");await denied(()=>admit(fingerprint),"application role cannot admit");await denied(()=>c.query("select * from private.square_observation_admissions"),"application role cannot read private admissions");}finally{stage="application_role_reset_"+role;await c.query("reset role");}
  }
  // Supabase postgres may administer a custom role without permission to SET ROLE
  // to it. Exercise its actual dedicated LOGIN instead of broadening that operator.
  stage="native_runtime_login_setup";
  const runtimeLogin=await runtime.login(db,"observation_worker",["square_ingestion_runtime_authority"],"square_sandbox");
  stage="native_runtime_denials";
  eq((await runtimeLogin.client.query("select session_user as value")).rows[0].value,runtimeLogin.name,"distinct native runtime identity");
  eq((await runtimeLogin.client.query("select pg_has_role(session_user,'square_ingestion_runtime_authority','USAGE') as value")).rows[0].value,true,"native runtime inherits the intended capability");
  await denied(()=>runtimeLogin.client.query("select public.register_square_observation_approval_v1($1::jsonb)",[JSON.stringify(approval)]),"native runtime cannot register approval");
  await denied(()=>runtimeLogin.client.query("select public.admit_square_provider_observations_v1($1)",[fingerprint]),"native runtime cannot admit observations");
  await denied(()=>runtimeLogin.client.query("select * from private.square_observation_admissions"),"native runtime cannot read private admissions");
  stage="post_admission_revocation";
  await c.query("begin");await c.query("update private.square_account_configuration set blocked=false");await c.query("update private.square_account_connections set revocation_pending=true");await denied(()=>admit(fingerprint),"post-admission revocation fences replay");await c.query("rollback");
  stage="final_preservation";
  eq(await genericCounts(),genericBefore,"no generic canonical source/fact/contribution records minted");
  eq(await runtime.sourceSchemaFingerprint(c),schemaBefore,"canonical/QBO schema unchanged");
  eq((await c.query("select surface_enabled,enrollment_enabled from private.square_account_configuration")).rows[0],{surface_enabled:false,enrollment_enabled:false},"admission never opens runtime gates");
  console.log(`Square observation database qualification passed (${assertions} assertions; 111 migrations; seven SQL/TS parity cases).`);
}
runAdditionalQualification(qualify).catch(error=>{process.stderr.write(`Square observation database qualification failed at ${stage} (${typeof error.code==="string"&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"fixed_failure"}).\n`);if(/^[a-z_]{1,100}$/.test(error.message))process.stderr.write(error.message+"\n");if(error.code==="ERR_ASSERTION")process.stderr.write(String(error.message).split("\n")[0]+"\n");process.exitCode=1;});
