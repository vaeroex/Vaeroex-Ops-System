// Loaded by the customer suite's existing TS/alias/zero-AI test boundary.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createCustomerPaymentsBroker,createCustomerPaymentsRuntime}=require('../services/external-integrations-production/internal-consent/customer-read.ts');
const {customerFingerprint:fp}=require('../services/external-integrations-production/internal-consent/customer-flow.ts');
const {createSquareOAuthCredentialProvider,createSquareOAuthPolicy,SQUARE_OAUTH_SCOPES}=require('../lib/integrations/providers/square/account-connection-oauth.ts');
const {createInternalConsentTransport}=require('../services/external-integrations-production/internal-consent/transport.ts');
const {ProviderApplicationSecret}=require('../lib/integrations/credentials/secret-manager.ts');
const {canonicalContractJson}=require('../lib/integrations/contracts/canonical.ts');
module.exports=async function(){
 const now=new Date('2026-09-27T12:00:00.000Z'),applicationId='sq0idp-SYNTHETIC_REFRESH';
 const expires='2026-09-28T12:00:00.000Z',kmsKeyResource='projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials';
 function fixture(options={}){
  const command={scanId:randomUUID(),leaseId:randomUUID(),leaseFingerprint:fp(['lease'])},workspaceId=randomUUID(),connectionId=randomUUID(),credentialId=randomUUID();
  const aadContext={providerKey:'square',environment:'production',projectId:'vaeroex-integrations-prod',workspaceId,connectionId,generation:1,credentialId,credentialVersion:1};
  const credential={schemaVersion:'oauth_credential_envelope_v1',providerKey:'square',environment:'production',externalAuthorizedEntityReference:'merchant_A',
   accessToken:'synthetic_expired_access_token',refreshToken:'synthetic_nonexpiring_refresh_token',refreshExpiresAt:null,
   accessExpiresAt:options.current?expires:'2026-09-26T12:00:00.000Z',issuedAt:'2026-09-25T12:00:00.000Z',updatedAt:'2026-09-25T12:00:00.000Z',grantedScopes:[...SQUARE_OAUTH_SCOPES]};
  const calls=[],buffers=[];let receipt,networkCalls=0;
  const broker=createCustomerPaymentsBroker({now:()=>now,rpc:async(op,payload)=>{
   calls.push(op);assert.equal(payload.scanId,command.scanId);assert.equal(payload.leaseId,command.leaseId);assert.equal(payload.leaseFingerprint,command.leaseFingerprint);
   if(op==='credential')return {credentialId,credentialVersion:1,ciphertextBase64:Buffer.from('synthetic ciphertext').toString('base64'),aadContext,
    aadDigest:fp(['square-production-customer-aad-v1',workspaceId,connectionId,1,credentialId,1]),kmsKeyResource,merchantId:'merchant_A',accessExpiresAt:credential.accessExpiresAt,
    refreshRequired:!options.current,providerLocationId:'location_A',locationFingerprint:fp(['square-customer-location-v1',connectionId,1,'location_A']),
    windowStart:'2026-09-26T12:00:00.000Z',windowEnd:now.toISOString(),workspaceId:options.foreign?randomUUID():workspaceId,connectionId,generation:1};
   if(op==='authorize_refresh'){if(options.revoked)throw Error('synthetic revoked');assert.equal(payload.phase,calls.filter(x=>x==='authorize_refresh').length===1?'token':'status');return {authorized:true};}
   if(op==='commit_refresh'){
    assert.equal(payload.credentialVersion,2);assert.equal(payload.credentialId,credentialId);assert.equal(payload.aadContext.workspaceId,workspaceId);
    assert.equal(payload.merchantId,'merchant_A');assert.equal(payload.accessExpiresAt,expires);
    receipt={stored:true,credentialVersion:2,commandFingerprint:payload.commandFingerprint};
    if(options.lostCommit)throw Error('synthetic lost ack');return receipt;
   }
   if(op==='reconcile_refresh')return options.uncommitted?{stored:false}:receipt;
   if(op==='authorize_page'){if(options.revokedPage)throw Error('synthetic revoked');if(!options.current)assert(receipt);return {authorized:true};}
   throw Error('unexpected RPC');
  },kms:{async decrypt(){const b=Buffer.from(JSON.stringify(credential));buffers.push(b);return b;},async encrypt(request){
   const clear=JSON.parse(Buffer.from(request.plaintext).toString());assert.equal(clear.accessToken,'synthetic_renewed_access_token');
   assert.equal(JSON.parse(Buffer.from(request.additionalAuthenticatedData).toString()).credentialVersion,2);
   buffers.push(request.plaintext,request.additionalAuthenticatedData);return Buffer.from('synthetic renewed ciphertext');
  }},refresh:{applicationSecret:async()=>new ProviderApplicationSecret({schemaVersion:'provider_application_secret_v1',providerKey:'square',environment:'production',clientId:applicationId,clientSecret:'synthetic_private_application_secret'}),
   provider:authorize=>createSquareOAuthCredentialProvider({applicationId,policy:createSquareOAuthPolicy({environment:'production',applicationId,
    redirectUri:'https://square.vaeroex.com/api/integrations/square/callback',returnPath:'/app/settings/integrations/square'}),
    transport:createInternalConsentTransport({applicationId,authorize,refreshOnly:true,network:async(url,init)=>{
     networkCalls++;if(url.endsWith('/oauth2/token')){
      const body=JSON.parse(init.body);assert.equal(body.grant_type,'refresh_token');assert.equal(body.refresh_token,credential.refreshToken);
      return Response.json({access_token:'synthetic_renewed_access_token',token_type:'bearer',expires_at:expires,merchant_id:options.merchantMismatch?'merchant_B':'merchant_A',refresh_token:credential.refreshToken,short_lived:true});
     }
     assert(url.endsWith('/oauth2/token/status'));assert.equal(init.headers.Authorization,'Bearer synthetic_renewed_access_token');
     return Response.json({client_id:applicationId,merchant_id:options.merchantMismatch?'merchant_B':'merchant_A',expires_at:expires,scopes:[...SQUARE_OAUTH_SCOPES]});
    }})})},network:async(url,init)=>{
    networkCalls++;assert.equal(new URL(url).pathname,'/v2/payments');assert.equal(init.headers.Authorization,`Bearer ${options.current?credential.accessToken:'synthetic_renewed_access_token'}`);
    return Response.json({payments:[{id:'synthetic_payment',location_id:'location_A',created_at:'2026-09-27T11:00:00Z',status:'COMPLETED',amount_money:{amount:123,currency:'USD'}}]});
   }});
  return {command,broker,calls,buffers,get networkCalls(){return networkCalls;}};
 }
 for(const options of [{},{lostCommit:true},{current:true}]){
  const f=fixture(options),page=await f.broker(f.command);assert.equal(page.observations.length,1);assert.equal(page.hasMore,false);
  assert.equal(f.networkCalls,options.current?1:3);assert.equal(f.calls.filter(x=>x==='commit_refresh').length,options.current?0:1);
  assert.equal(f.calls.filter(x=>x==='reconcile_refresh').length,options.lostCommit?1:0);
  assert(!canonicalContractJson(page).includes('accessToken'));assert(!canonicalContractJson(page).includes('merchant_A'));
  for(const b of f.buffers)assert(b.every(x=>x===0),'plaintext and AAD buffers cleared');
 }
 for(const options of [{foreign:true},{revoked:true},{merchantMismatch:true},{revokedPage:true},{lostCommit:true,uncommitted:true}]){
  const f=fixture(options);await assert.rejects(()=>f.broker(f.command));assert(!f.calls.includes('commit_refresh')||options.revokedPage||options.lostCommit);
  assert.equal(f.networkCalls,options.merchantMismatch||options.revokedPage||options.lostCommit?2:0);
 }
 const f=fixture({merchantMismatch:true});let failed=0;
 const runtime=createCustomerPaymentsRuntime({rpc:async(op,payload)=>{
  if(op==='claim')return {status:'leased',...payload,scanId:f.command.scanId,connectionId:randomUUID(),generation:1,workspaceId:randomUUID(),businessEntityId:randomUUID(),actorId:randomUUID(),sessionId:randomUUID(),windowStart:'2026-09-26T12:00:00.000Z',windowEnd:now.toISOString()};
  if(op==='fail'){failed++;return {status:'uncertain'};}throw Error('unexpected');
 },readPage:async()=>{throw Error('synthetic refresh failed');}});
 await assert.rejects(runtime);assert.equal(failed,1,'failed refresh fenced once without retry');
 console.log('square_customer_expired_refresh_persist_lost_ack_isolation_zero_ai_passed');
};
