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
  eq(files.length,115,"full canonical chain, including deterministic Square operational intelligence");
  stage="migrations";
  await runtime.applyMigrations(c,files.slice(0,-4));
  const schemaBefore=await runtime.sourceSchemaFingerprint(c);
  await runtime.applyMigrations(c,files.slice(-4));
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
  const fixtures=require("./square-canonical-test-support.js");
  const parsedFixtures=[fixtures.payment(),fixtures.refund(),fixtures.order(),fixtures.catalog(),fixtures.inventory("count"),fixtures.inventory("physical"),fixtures.inventory("adjustment")];
  const replacements=new Map([[fixtures.scope.workspaceId,workspace],[fixtures.scope.connectionId,connection],
    [fixtures.scope.sellerId,scope.sellerId],...fixtures.scope.authorizedLocationIds.map(x=>[x,"LOC_SYNTHETIC"])]);
  const bind=value=>typeof value==="string"?(replacements.get(value)??value):Array.isArray(value)?value.map(bind):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v)])):value;
  stage="synthetic_immutable_sources";
  for(const type of policy.SQUARE_OBSERVATION_RECORD_TYPES) {
    const stream=type.startsWith("square_catalog")?"catalog":type.startsWith("square_inventory")?"inventory":type==="square_payment"?"payments":type==="square_refund"?"refunds":"order_tenders";
    // Real parser/mapper projections rebound to this disposable database's UUIDs.
    const base=parsedFixtures.find(x=>x.pending.providerRecordType===type).pending;
    const data=bind(base.projection.data),providerRecordId=base.providerRecordId;
    const stableScope={...scope};delete stableScope.authorizedLocationIds;delete stableScope.generation;
    const pending={resourceKey:contractSha256({purpose:"square_source_resource_identity_v1",scope:stableScope,stream,providerRecordType:type,providerRecordId}),scope,stream,providerRecordId,providerRecordType:type,providerRevision:base.providerRevision,observedAt:now,deleted:false,projection:{mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,stream,role:"primary",authority:"pending_provider_observation_not_economic_authority",data}};
    pending.versionKey=contractSha256({purpose:"square_source_observed_version_v1",mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,resourceKey:pending.resourceKey,providerRevision:pending.providerRevision,deleted:false,projection:pending.projection});
    const sourceVersion=mapping.materializeSquarePendingSource(pending,1,null),task=id(),scan=contractSha256({task}),page=contractSha256({page:task});
    await insert("private.square_ingestion_tasks",{...scopeCols,connection_generation:4,task_id:task,runtime_login:"postgres",lease_owner_fingerprint:fp,grant:{scope,stream},binding:{},expires_at:later,retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now});
    await insert("private.square_ingestion_scans",{...scopeCols,connection_generation:4,scan_key:scan,initial_task_id:task,binding:{},stream,status:"finished",not_before:now,retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now,updated_at:now});
    await insert("private.square_ingestion_resources",{...scopeCols,resource_key:pending.resourceKey,stream,provider_record_type:type,provider_record_id:providerRecordId});
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
  stage="canonical_interpretation_transaction";
  const {interpretAdmittedSquareSources}=require("../lib/integrations/providers/square/canonical-repository.ts");
  eq((await interpretAdmittedSquareSources(c,fingerprint)).outcome,"rejected","closed authority blocks interpretation");
  await c.query("update private.square_account_configuration set blocked=false");
  const lostAck={query:async(sql,values)=>{const r=await c.query(sql,values);if(sql==="commit")throw new Error("synthetic_ack_lost");return r;}};
  eq((await interpretAdmittedSquareSources(lostAck,fingerprint)).outcome,"commit_uncertain","actual committed transaction with lost acknowledgement remains uncertain");
  eq((await interpretAdmittedSquareSources(c,fingerprint)).outcome,"replayed","fresh checked replay reconciles committed state without duplicate facts");
  eq((await c.query("select count(*)::int n from private.square_interpretation_facts")).rows[0].n,7,"one immutable interpretation per source version");
  eq((await c.query("select count(*)::int n from private.square_interpretation_runs")).rows[0].n,1,"one committed incremental run");
  const interpreted=(await c.query("select output from private.square_interpretation_runs")).rows[0].output;
  eq(interpreted.facts.length,7,"all distinct types persisted");
  eq(interpreted.intelligence.assessment.economic,"blocked","intelligence remains descriptive");
  eq(interpreted.intelligence.assessment.historical,"unknown","scan never claims history completeness");
  stage="workspace_evidence_reader";
  await require("./square-workspace-evidence-database-tests.js")({c,eq,denied,changed,workspace,actor,session,connection,entity,manifest,interpreted});
  let casError;try{await c.query("select public.commit_square_interpretation_v1($1,0,$2,$3::jsonb)",[fingerprint,fp,JSON.stringify(interpreted)]);}catch(e){casError=e.code;}
  eq(casError,"40001","stale incremental writer rejected");
  stage="canonical_manifest_partitions";
  const originalPartition=interpreted.coverage.partitionFingerprint;
  const subsetFingerprints=[];
  for(const subset of [manifest.slice(0,1),manifest.slice(1,3),manifest.slice(0,3)]) {
    const subsetFingerprint=await register({...approval,manifest:subset});
    subsetFingerprints.push(subsetFingerprint);
    const subsetRun=await interpretAdmittedSquareSources(c,subsetFingerprint);
    eq(subsetRun.outcome,"committed","different and overlapping approved subsets commit independently");
    eq(subsetRun.revision,1,"each resource-set partition starts at its own revision");
    const subsetRead=(await c.query("select public.read_square_interpretation_inputs_v1($1) as value",[subsetFingerprint])).rows[0].value;
    eq(subsetRead.prior.output.controls.length,subset.length,"partition controls contain only its approved resources");
    eq(subsetRead.prior.output.coverage.kind,"approval_resource_set","counts explicitly disclose manifest coverage");
    eq(subsetRead.partitionFingerprint!==originalPartition,true,"subset cannot select the full-manifest checkpoint");
  }
  eq((await interpretAdmittedSquareSources(c,fingerprint)).outcome,"replayed","subset runs do not overwrite full-manifest state");
  for(const subsetFingerprint of subsetFingerprints)eq((await interpretAdmittedSquareSources(c,subsetFingerprint)).outcome,"replayed","interleaved subset replay stays independent");
  eq((await c.query("select count(*)::int n from private.square_interpretation_facts")).rows[0].n,7,"overlapping partitions do not duplicate immutable facts");
  stage="canonical_provider_correction";
  const oldPayment=inputs.find(x=>x.pending.providerRecordType==="square_payment");
  const updated=JSON.parse(JSON.stringify(oldPayment.pending));
  updated.providerRevision.updatedAt="2026-09-02T12:01:00Z";
  updated.projection.data.updatedAt="2026-09-02T12:01:00Z";updated.projection.data.status="CANCELED";
  updated.versionKey=contractSha256({purpose:"square_source_observed_version_v1",mappingVersion:mapping.SQUARE_SOURCE_MAPPING_VERSION,resourceKey:updated.resourceKey,providerRevision:updated.providerRevision,deleted:false,projection:updated.projection});
  const corrected=mapping.materializeSquarePendingSource(updated,2,oldPayment.sourceVersion.id);
  const oldManifest=manifest.find(m=>m.resourceKey===updated.resourceKey),page=contractSha256({synthetic:"correction_receipt"});
  await c.query("begin");
  await insert("private.square_ingestion_versions",{...scopeCols,version_key:updated.versionKey,resource_key:updated.resourceKey,ordinal:2,version_id:corrected.id,prior_version_id:oldPayment.sourceVersion.id,pending:updated,version:corrected,ordering:"newer",retention_policy_version:"synthetic_observation_v1",retention_expires_at:later,created_at:now});
  await c.query(`insert into private.square_ingestion_page_receipts select scan_key,$1,workspace_id,business_entity_id,connection_id,task_id,command_fingerprint,3,retention_policy_version,retention_expires_at,clock_timestamp()
    from private.square_ingestion_page_receipts where scan_key=$2 and page_id=$3`,[page,oldManifest.receiptScanKey,oldManifest.receiptPageId]);
  await c.query("update private.square_ingestion_resources set current_version_key=$1,observed_version_key=$1,version_count=2 where resource_key=$2",[updated.versionKey,updated.resourceKey]);
  await c.query("commit");
  const updatedApproval={...approval,manifest:manifest.map(m=>m===oldManifest?{...m,versionKey:updated.versionKey,sourceRecordVersionId:corrected.id,sourceFingerprint:corrected.sourceFingerprint,expectedCurrentVersionKey:updated.versionKey,receiptPageId:page}:m)};
  const updatedFingerprint=await register(updatedApproval);await admit(updatedFingerprint);
  // Simulate elapsed retention only in this owned disposable fixture. The
  // immutable trigger is restored before the checked read and rollback restores
  // the row; no production migration or worker can alter this deadline.
  await c.query("begin");
  await c.query("alter table private.square_interpretation_runs disable trigger square_interpretation_immutable");
  await c.query("update private.square_interpretation_runs set retention_expires_at=clock_timestamp()-interval '1 second'");
  await c.query("alter table private.square_interpretation_runs enable trigger square_interpretation_immutable");
  const expiredPrior=(await c.query("select public.read_square_interpretation_inputs_v1($1) as value",[updatedFingerprint])).rows[0].value;
  eq(expiredPrior.prior.revision,1,"expired prior retains CAS revision");
  eq(expiredPrior.prior.output,null,"expired prior facts are not returned for a valid corrected manifest");
  await c.query("rollback");
  const correction=await interpretAdmittedSquareSources(c,updatedFingerprint);
  eq(correction.outcome,"committed","changed committed source is interpreted");eq(correction.revision,2,"derived checkpoint advances once");
  eq((await c.query("select count(*)::int n from private.square_interpretation_facts")).rows[0].n,8,"correction preserves old fact and adds one version");
  eq((await interpretAdmittedSquareSources(c,updatedFingerprint)).outcome,"replayed","correction replay is idempotent");
  eq((await interpretAdmittedSquareSources(c,fingerprint)).outcome,"rejected","out-of-order old manifest cannot restore previous current fact");
  const latest=(await c.query("select output from private.square_interpretation_runs order by revision desc limit 1")).rows[0].output;
  eq(latest.intelligence.assessment.counts.payment,1,"correction is not a second payment");
  eq(latest.intelligence.assessment.statuses["payment:CANCELED"],1,"provider reversal changes description only");
  eq(latest.intelligence.assessment.economic,"blocked","reversal never creates netting");
  eq(latest.work.nodesRecalculated<=2,true,"only old and new payment status buckets recomputed");
  await c.query("update private.square_account_connections set revocation_pending=true");
  eq((await interpretAdmittedSquareSources(c,updatedFingerprint)).outcome,"rejected","revocation fences even idempotent replay");
  await c.query("update private.square_account_connections set revocation_pending=false");
  await c.query("update private.square_account_configuration set blocked=true");
  stage="immutable_and_privilege_denials";
  for(const table of ["square_observation_approvals","square_observation_admissions","square_interpretation_facts","square_interpretation_runs"]) {
    let rejected=false;try{await c.query(`delete from private.${table}`);}catch{rejected=true;}eq(rejected,true,"immutable observation history");
    rejected=false;try{await c.query(`update private.${table} set workspace_id=workspace_id`);}catch{rejected=true;}eq(rejected,true,"immutable history rejects even no-op update");
    const r=(await c.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",['private.'+table])).rows[0];eq(r,{relrowsecurity:true,relforcerowsecurity:true},"forced RLS");
  }
  for(const role of ["anon","authenticated","service_role"]) {
    stage="application_role_switch_"+role;
    await c.query(`set role ${role}`);try{stage="application_denials_"+role;await denied(()=>register(approval),"application role cannot register");await denied(()=>admit(fingerprint),"application role cannot admit");await denied(()=>c.query("select * from private.square_observation_admissions"),"application role cannot read private admissions");await denied(()=>c.query("select public.read_square_interpretation_inputs_v1($1)",[fingerprint]),"application role cannot read interpretation inputs");await denied(()=>c.query("select * from private.square_interpretation_runs"),"application role cannot read private intelligence");}finally{stage="application_role_reset_"+role;await c.query("reset role");}
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
  console.log(`Square observation database qualification passed (${assertions} assertions; 114 migrations; seven SQL/TS parity cases).`);
}
runAdditionalQualification(qualify).catch(error=>{process.stderr.write(`Square observation database qualification failed at ${stage} (${typeof error.code==="string"&&/^[A-Z0-9_]+$/.test(error.code)?error.code:"fixed_failure"}).\n`);if(/^[a-z_]{1,100}$/.test(error.message))process.stderr.write(error.message+"\n");if(error.code==="ERR_ASSERTION")process.stderr.write(String(error.message).split("\n")[0]+"\n");process.exitCode=1;});
