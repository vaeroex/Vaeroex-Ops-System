// LOCAL ONLY. Compares explicitly supplied screened metadata to repository SQL.
// Never fetches metadata, embeds captured definitions, or claims writer execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const directory=process.argv[2];
assert.ok(directory,'Explicit local capture directory required; no network fallback.');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const local=file=>JSON.parse(readFileSync(resolve(directory,file),'utf8'));
const square='supabase/production-migrations/20260925032300_square_production_customer_connection.sql';
const convergence='supabase/migrations/20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql';
const foundation='supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql';
const reconciliation='supabase/migrations/20260821064333_external_integrations_phase_2_reconciliation.sql';
export const helperSources=[
 ['private.square_production_customer_require_eligible_v1(uuid)',square,'private.square_production_customer_require_eligible_v1',true,'void'],
 ['private.square_production_customer_require_keys_v1(jsonb,text[])',square,'private.square_production_customer_require_keys_v1',false,'void'],
 ['private.assert_integration_provider_source_authority_v1()',convergence,'private.assert_integration_provider_source_authority_v1',false,'void'],
 ['private.commit_provider_external_source_before_validation_v1(jsonb,text)',convergence,'public.commit_provider_external_source_record_version_v1',true,'jsonb'],
 ['private.qbo_production_source_has_effects_v1(uuid)','supabase/production-migrations/20260930193412_qbo_production_accounting_intake.sql','private.qbo_production_source_has_effects_v1',true,'boolean'],
 ['private.platform_admin_subscription_exempt_v1(uuid)','supabase/migrations/20261005022017_workspace_security_boundaries.sql','private.platform_admin_subscription_exempt_v1',true,'boolean'],
];
const relations=[
 ['square_customer_private.configuration','supabase/production-migrations/20260929004917_square_customer_service_backend.sql','singleton enabled application_id'],
 ['private.integration_sync_tasks','supabase/migrations/20260822012253_external_integrations_phase_6_durable_runtime.sql','id workspace_id business_entity_id connection_id connection_generation provider_key provider_environment state lease_id lease_owner_fingerprint lease_expires_at sync_run_id stream_key dispatch_generation dispatcher_task_name last_delivery_attempt_fingerprint'],
 ['private.business_fact_sources',foundation,'workspace_id business_entity_id source_record_version_id fact_version_id'],
 ['private.canonical_business_facts',foundation,'id current_version_id'],
 ['private.canonical_business_fact_versions',foundation,'id fact_id reconciliation_state'],
 ['private.reconciliation_case_members',reconciliation,'source_record_version_id fact_version_id reconciliation_case_id workspace_id business_entity_id member_role additive_candidate'],
 ['private.fact_contribution_events',reconciliation,'id target_contribution_event_id event_kind fact_version_id reconciliation_case_id workspace_id business_entity_id'],
 ['private.reconciliation_cases',reconciliation,'id contract_version classification'],
 ['private.integration_audit_events',foundation,'workspace_id business_entity_id connection_id actor_type actor_id action outcome target_type target_id request_id metadata retention_class id occurred_at created_at'],
 ['public.subscription_plans','supabase/migrations/202606170003_phase_6_squarespace_subscriptions.sql','slug max_ai_runs_per_month'],
 ['private.workspace_usage_locks','supabase/migrations/20261005022445_workspace_persisted_usage_limits.sql','workspace_id revision'],
];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const norm=s=>s?.replace(/\s/g,'').toLowerCase()??null;
const defaultNorm=s=>norm(s)?.replace(/::(?:text|bigint|integer|boolean|jsonb|uuid)/g,'')??null;
const typeNorm=s=>s.trim().toLowerCase().replace(/\s+/g,' ').replace(/^timestamptz$/,'timestamp with time zone').replace(/^int$/,'integer');
function functionBody(sql,name){
 const start=sql.search(new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+'+escape(name)+'\\s*\\(','i'));assert.ok(start>=0);
 const match=/\bas\s+(\$[a-z0-9_]*\$)/i.exec(sql.slice(start));assert.ok(match);
 const begin=start+match.index+match[0].length,end=sql.indexOf(match[1],begin);assert.ok(end>begin);
 const body=sql.slice(begin,end);assert.match(body,/^[\x00-\x7f]*$/);return body;
}
// Split only top-level DDL items. Retain quoted strings and nested check/default
// expressions; this is a closed parser for the repository CREATE TABLE sources.
function declarations(sql,name){
 const match=new RegExp('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?'+escape(name)+'\\s*\\(','i').exec(sql);assert.ok(match);
 const items=[];let depth=1,start=match.index+match[0].length,quote=false;
 for(let i=start;i<sql.length;i++){
  const c=sql[i];if(c==="'"){if(quote&&sql[i+1]==="'"){i++;continue;}quote=!quote;continue;}if(quote)continue;
  if(c==='(')depth++;if(c===')'){depth--;if(depth===0){items.push(sql.slice(start,i));return items;}}
  if(c===','&&depth===1){items.push(sql.slice(start,i));start=i+1;}
 }throw Error('table_delimiter_missing');
}
let stage='helpers';
// Only entries assembled from the closed repository manifest may be emitted.
// Never serialize assertion.actual, which can contain captured configuration.
const safeDifferences=[];
try{
 const helpers=local('failure-accounting-six-helpers.json');
 const checkedHelpers=[];
 for(const [signature,file,name,definer,result]of helperSources){
  const matches=helpers.filter(r=>r.signature===signature);assert.equal(matches.length,1);const metadata=matches[0];
  assert.equal(metadata.present,true);const body=functionBody(read(file),name);
  const hash=createHash('md5').update(body.replace(/\s/g,'')).digest('hex');assert.equal(hash,metadata.body_md5);
  assert.equal(metadata.owner,'postgres');assert.equal(metadata.security_definer,definer);assert.equal(metadata.result,result);
  assert.deepEqual(metadata.proconfig,['search_path=""']);assert.equal(metadata.proacl,'{postgres=X/postgres}');
  for(const key of ['service_execute','authenticated_execute','anon_execute'])assert.equal(metadata[key],false);
  checkedHelpers.push({signature,matched:true});
 }
 stage='relations';
 const captures=local('failure-accounting-bounded-relations.json');
 const auditCorrection=local('failure-accounting-audit-fields.json');
 // The initial audit-field request used incorrect aliases. Merge the corrected
 // exact columns; absent guessed names are not a production schema defect.
 const corrected=Array.isArray(auditCorrection)?auditCorrection:[auditCorrection];
 const checkedRelations=[],differences=safeDifferences;
 for(const [name,file,fieldList]of relations){
  const row=captures.find(r=>r.name===name);assert.ok(row?.present,name);
  let columns=row.columns;
  if(name==='private.integration_audit_events'){
   const correction=corrected.find(r=>r.name===name||r.columns);
   columns=[...columns,...(correction?.columns??corrected.filter(r=>r.name&&r.type)).map(c=>({...c,default:c.default_expression??c.default??null}))];
  }
  const ddl=declarations(read(file),name);
  let count=0;
  for(const field of fieldList.split(' ')){
   const candidates=columns.filter(c=>c.name===field&&c.present!==false);const c=candidates.at(-1);
   if(!c){differences.push({relation:name,column:field,kind:'capture_missing'});continue;}
   const declaration=ddl.find(d=>new RegExp('^\\s*'+escape(field)+'\\s','i').test(d));assert.ok(declaration,`${name}.${field}`);
   const rest=declaration.trim().slice(field.length).trim();
   const split=rest.search(/\b(?:primary\s+key|not\s+null|default|references|check|unique|constraint)\b/i);
   const expectedType=typeNorm(split<0?rest:rest.slice(0,split));
   const expectedNotNull=/\b(?:not\s+null|primary\s+key)\b/i.test(rest);
   const d=/\bdefault\s+([\s\S]*?)(?=\b(?:primary\s+key|not\s+null|references|check|unique|constraint)\b|$)/i.exec(rest)?.[1]?.trim()??null;
   if(typeNorm(c.type)!==expectedType)differences.push({relation:name,column:field,kind:'type'});
   if(c.not_null!==expectedNotNull)differences.push({relation:name,column:field,kind:'not_null'});
   if(defaultNorm(c.default)!==defaultNorm(d))differences.push({relation:name,column:field,kind:'default'});
   count++;
  }
  checkedRelations.push({relation:name,columnsCompared:count});
 }
 assert.deepEqual(differences,[],'bounded_column_contract_mismatch');
 console.log(JSON.stringify({passed:true,helpers:checkedHelpers,relations:checkedRelations,providerCalls:0,productionReads:0,
  releaseQualified:false,limits:['Column attributes and helper metadata only; not general constraint/trigger semantic equivalence','No native or installed writer execution','No captured body embedded in source']},null,2));
}catch(error){
 console.error(JSON.stringify({passed:false,stage,code:typeof error.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(error.code)?error.code:'LOCAL_COMPARISON_FAILED',
  line:Number(/installed-contract-comparison\.mjs:(\d+):/.exec(error.stack??'')?.[1])||undefined,
  differences:safeDifferences}));process.exitCode=1;
}
