// No network: actual native adapter with a fixed in-process pg protocol double.
const assert = require('node:assert/strict');
require('./square-account-browser-test-support.js').loadSquareBrowserModules();
const { X509Certificate } = require('node:crypto');
const pg = require('pg');
const { checkedSquareGcpMappedBinding, squareGcpMappedHost } = require('../lib/integrations/control-plane/square-gcp-mapped-contracts.ts');
const { SQUARE_REMOTE_SANDBOX: c } = require('../lib/integrations/control-plane/square-remote-sandbox-contracts.ts');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const expires = new Date(Date.now()+3600000).toISOString();
const binding = { contractVersion:'square_gcp_mapped_runtime_binding_v1', projectRef:c.projectRef,applicationOrigin:c.applicationOrigin,
  environment:'sandbox',applicationId:c.applicationId,apiVersion:c.apiVersion,gcpProjectId:'vaeroex-square-sandbox',gcpProjectNumber:'123456789012',
  gcpZone:'us-west1-b',gcpInstanceId:'123456789',gcpInstanceName:'square-sandbox-callback',serviceAccountEmail:'synthetic-broker@vaeroex-square-sandbox.iam.gserviceaccount.com',
  serviceAccountSubject:'123456789012345678901',identityAudience:c.applicationOrigin+'/_identity/square-callback',operatorId:id(1),workspaceId:id(2),
  businessEntityId:id(3),operatorRole:'owner',brokerLogin:'square_sandbox_broker',approvalExpiresAt:expires,enabled:true,providerCallsEnabled:false,
  policyVersion:'synthetic_v1',policyFingerprint:'sha256:'+'1'.repeat(64),kmsKeyResource:'projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/synthetic',
  appSecretVersionResource:'projects/vaeroex-square-sandbox/secrets/synthetic-app/versions/1',databaseSecretVersionResource:'projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1',
  capability:'broker',enrollerLogin:'square_sandbox_enroller',runtimeLogin:'square_sandbox_runtime',connectionId:id(4),connectionGeneration:4,
  operatorSessionId:id(5),defaultLocationId:'SYNTHETIC_LOCATION',discoveryFingerprint:'sha256:'+'2'.repeat(64),mappedProviderCallsEnabled:false,mappedApprovalExpiresAt:expires,
  enrollerDatabaseSecretVersionResource:'projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db/versions/1',runtimeDatabaseSecretVersionResource:'projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db/versions/1' };
let settings={}, instances=[], assertions=0;
const eq=(a,b)=>{assertions++;assert.deepEqual(a,b);};
class FakeClient {
  constructor(config){this.config=config;this.queries=[];instances.push(this);}
  on(){} async connect(){} async end(){this.closed=true;}
  async query(query){const sql=typeof query==='string'?query:query.text;this.queries.push(sql);
    if(sql.includes('get_square_gcp_mapped_runtime_binding_v1')) {
      const value={...binding,...settings.binding}; if(settings.drift && this.queries.length>2)value.connectionGeneration++;
      return {rows:[{value:JSON.stringify(value)}]};
    }
    if(sql==='commit' && settings.lostAck)throw new Error('PRIVATE_SQL_CANARY');
    return {rows:[{value:JSON.stringify({confirmed:true,generation:4})}]};
  }
}
pg.Client=FakeClient;
const {openSquareGcpMappedDatabase:open}=require('../lib/integrations/control-plane/square-gcp-mapped-database.ts');
const ca=require('node:tls').rootCertificates.find(pem=>{const x=new X509Certificate(pem);return x.ca&&Date.parse(x.validTo)>Date.now()&&Date.parse(x.validFrom)<Date.now();});
const dsn=`postgresql://square_sandbox_broker:SYNTHETIC_PASSWORD@aws-0-us-west-2.pooler.supabase.com:5432/postgres`;
const pooled=dsn.replace('square_sandbox_broker:',`square_sandbox_broker.${c.projectRef}:`);
async function denied(work){assertions++;await assert.rejects(work,e=>e.message==='square_gcp_mapped_database_denied');}
const command={p_context:{},p_operation:'confirm_mapping',p_command:{}};
(async()=>{
  eq(checkedSquareGcpMappedBinding(binding).connectionGeneration,4);
  eq(squareGcpMappedHost(binding).contractVersion,'square_gcp_callback_binding_v1');
  for(const edit of [{providerCallsEnabled:true},{enrollerLogin:binding.brokerLogin},{capability:'admin'},{connectionGeneration:0},
    {mappedApprovalExpiresAt:'2000-01-01T00:00:00Z'},{runtimeDatabaseSecretVersionResource:binding.appSecretVersionResource},{unknown:true}]) {
    assertions++;assert.throws(()=>checkedSquareGcpMappedBinding({...binding,...edit}));
  }
  let db=await open('broker',pooled,ca,new AbortController().signal);
  eq(instances.at(-1).config.ssl.rejectUnauthorized,true);eq(instances.at(-1).config.ssl.ca,ca);
  await db.client.rpc('square_account_connection_v1',command);
  eq(instances.at(-1).queries.includes('commit'),true);
  await denied(()=>db.client.rpc('square_account_connection_v1',{...command,p_operation:'rotate_credential'}));
  await denied(()=>db.client.rpc('enroll_square_verified_connection_v1',{p_context:{},p_command:{}}));
  await denied(()=>db.client.rpc('arbitrary_sql',{})); await db.close();eq(instances.at(-1).closed,true);
  settings={binding:{capability:'runtime'}};await denied(()=>open('broker',pooled,ca,new AbortController().signal));eq(instances.at(-1).closed,true);
  settings={drift:true};db=await open('broker',pooled,ca,new AbortController().signal);
  await denied(()=>db.client.rpc('square_account_connection_v1',command));eq(instances.at(-1).queries.includes('commit'),false);eq(instances.at(-1).closed,true);
  settings={lostAck:true};db=await open('broker',pooled,ca,new AbortController().signal);
  await denied(()=>db.client.rpc('square_account_connection_v1',command));eq(instances.at(-1).queries.filter(q=>q==='commit').length,1);eq(instances.at(-1).closed,true);
  settings={};const abort=new AbortController();db=await open('broker',pooled,ca,abort.signal);abort.abort();
  await denied(()=>db.client.rpc('square_account_connection_v1',command));eq(instances.at(-1).closed,true);
  eq(instances.some(x=>x.queries.some(q=>/set role|alter role|create role/i.test(q))),false);
  console.log(`Square mapped native adapter: ${assertions} assertions passed; network=false`);
})().catch(()=>{console.error('square_mapped_native_synthetic_failed');process.exitCode=1;});
