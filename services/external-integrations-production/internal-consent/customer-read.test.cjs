/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS fixture using the existing test loader. */
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const original=Module._resolveFilename;
Module._resolveFilename=function(name,parent,main,options){
  if(/^(?:openai|ai|@ai-sdk)(?:\/|$)|\/lib\/ai\//.test(name))throw Error('unexpected_ai_runtime');
  return original.call(this,name==='server-only'?path.join(root,'scripts/test-stubs/server-only.js'):name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,main,options);
};
const {createCustomerPaymentsBroker,createCustomerPaymentsRuntime}=require('./customer-read.ts');
const {customerFingerprint:fp}=require('./customer-flow.ts');
const {createWorkspaceReadRpc}=require('./database.ts');
const {createCustomerPaymentsHandler}=require('./customer-server.ts');
const id=()=>crypto.randomUUID(),now=new Date('2026-09-26T12:00:00.000Z');
function fixture(options={}){
  const connectionId=id(),workspaceId=id(),credentialId=id(),scanId=id(),calls=[],pages=[];
  const credential={schemaVersion:'oauth_credential_envelope_v1',providerKey:'square',environment:'production',externalAuthorizedEntityReference:'seller_a',
    accessToken:'synthetic_private_access_token',refreshToken:'synthetic_private_refresh_token',grantedScopes:['PAYMENTS_READ'],
    issuedAt:'2026-09-26T09:00:00.000Z',updatedAt:'2026-09-26T09:00:00.000Z',accessExpiresAt:'2026-09-26T13:00:00.000Z',refreshExpiresAt:null};
  const aad={providerKey:'square',environment:'production',projectId:'vaeroex-integrations-prod',workspaceId,connectionId,generation:1,credentialId,credentialVersion:1};
  let command,claimed=false,committed=false,count=0,decrypted;
  const broker=createCustomerPaymentsBroker({now:()=>now,rpc:async(op,payload)=>{
    calls.push(op);assert.deepEqual(payload,command);if(options.revoked)throw Error('revoked');
    if(op==='authorize_page')return {authorized:true};
    assert.equal(op,'credential');return {credentialId,credentialVersion:1,ciphertextBase64:Buffer.from('synthetic_encrypted_credential').toString('base64'),aadContext:aad,
      aadDigest:fp(['square-production-customer-aad-v1',workspaceId,connectionId,1,credentialId,1]),
      kmsKeyResource:'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',merchantId:'seller_a',
      accessExpiresAt:credential.accessExpiresAt,providerLocationId:'location_a',locationFingerprint:fp(['square-customer-location-v1',connectionId,1,'location_a']),
      windowStart:'2026-09-26T10:00:00.000Z',windowEnd:'2026-09-26T11:00:00.000Z',workspaceId,connectionId,generation:1,...options.storedChange};
  },kms:{async encrypt(){throw Error('unused');},async decrypt(){decrypted=Buffer.from(JSON.stringify({...credential,...options.credentialChange}));return decrypted;}},
  network:async(url,init)=>{count++;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    const target=new URL(url);assert.equal(target.origin,'https://connect.squareup.com');assert.equal(target.pathname,'/v2/payments');
    assert.deepEqual(Object.fromEntries(target.searchParams),{begin_time:'2026-09-26T10:00:00.000Z',end_time:'2026-09-26T11:00:00.000Z',location_id:'location_a',limit:'100',sort_order:'ASC'});
    return Response.json({payments:options.empty?[]:[{id:'private_payment_a',location_id:'location_a',created_at:'2026-09-26T10:30:00.000Z',
      updated_at:'2026-09-26T11:30:00.000Z',status:'COMPLETED',amount_money:{amount:123,currency:'USD'},customer_id:'private_customer',...options.paymentChange}],cursor:'private_next_cursor'});
  }});
  const runtime=createCustomerPaymentsRuntime({rpc:async(op,payload)=>{
    calls.push(op);
    if(op==='claim'){if(claimed)return {status:'idle'};claimed=true;command={scanId,...payload};
      return {status:'leased',...command,connectionId,workspaceId,generation:1,actorId:id(),sessionId:id(),businessEntityId:id(),
        windowStart:'2026-09-26T10:00:00.000Z',windowEnd:'2026-09-26T11:00:00.000Z',...options.leaseChange};}
    if(op==='fail')return {status:'uncertain'};
    if(op==='reconcile')return {status:committed?'committed':'leased',nonEconomic:true,historicalCompleteness:'unknown'};
    assert.equal(op,'commit');assert.equal(payload.commandFingerprint,fp(['square-customer-page-v1',scanId,command.leaseId,payload.responseFingerprint,
      payload.observations.map(row=>row.sourceFingerprint).join(','),String(payload.hasMore)]));
    assert.doesNotMatch(JSON.stringify(payload),/private_payment|private_customer|private_next_cursor|synthetic_private|amountMoney|permitId/);
    if(options.lostBeforeCommit)throw Error('lost');committed=true;
    if(options.lostAck)throw Error('lost');
    return {status:'committed',observationCount:payload.observations.length,nonEconomic:true,historicalCompleteness:'unknown'};
  },readPage:async(value)=>{command=value;const page=await broker(value);pages.push(page);return {...page,...options.pageChange};}});
  return {runtime,calls,pages,count:()=>count,cleared:()=>!decrypted||decrypted.every(x=>x===0)};
}
async function main(){
  for(const options of [{},{empty:true},{lostAck:true}]){
    const f=fixture(options);assert.equal((await f.runtime()).status,'committed');assert.equal((await f.runtime()).status,'idle');
    assert.equal(f.count(),1);assert.equal(f.cleared(),true);assert.equal(f.pages[0].hasMore,true);assert.equal(f.calls.filter(x=>x==='commit').length,1);
    assert.doesNotMatch(JSON.stringify(f.pages),/private_payment|private_customer|private_next_cursor|synthetic_private|amountMoney|permitId/);
  }
  for(const options of [{revoked:true},{storedChange:{workspaceId:id()}},{storedChange:{generation:2}},
    {credentialChange:{externalAuthorizedEntityReference:'seller_b'}},{paymentChange:{location_id:'location_b'}},
    {paymentChange:{created_at:'2026-09-26T09:00:00.000Z'}},{storedChange:{credentialVersion:2}}]){
    const f=fixture(options);await assert.rejects(()=>f.runtime());assert.equal(f.calls.includes('commit'),false);assert.equal(f.count(),options.paymentChange?1:0);assert.equal(f.cleared(),true);
  }
  const lost=fixture({lostBeforeCommit:true});await assert.rejects(()=>lost.runtime());assert.equal(lost.count(),1);assert.equal(lost.calls.filter(x=>x==='commit').length,1);
  const foreign=fixture({pageChange:{scanId:id()}});await assert.rejects(()=>foreign.runtime());assert.equal(foreign.calls.includes('commit'),false);
  for(const profile of ['broker','runtime']){
    const queries=[],rpc=createWorkspaceReadRpc(profile,async()=>({async query(sql){queries.push(sql);return sql.includes('session_user')?
      {rows:[{login:'square_production_'+profile,current_login:'square_production_'+profile}]}:{rows:[{value:{ok:true}}]};},async end(){}}));
    await rpc(profile==='broker'?'credential':'claim',{});assert.equal(queries[1],'select public.square_production_workspace_read_v1($1::text,$2::jsonb) as value');
    await assert.rejects(()=>rpc(profile==='broker'?'commit':'credential',{}));assert.equal(queries.some(x=>/set role|select .* from private\./i.test(x)),false);
  }
  let calls=0;const handler=createCustomerPaymentsHandler({readPage:async()=>{calls++;throw Error('not-used');},authenticateRuntimeService:async()=>false});
  assert.equal((await handler(new Request('https://square-production-broker-u5c6zahmpq-uw.a.run.app/internal/square/broker/customer-payments',{
    method:'POST',headers:{'content-type':'application/json'}}),{})).status,404);assert.equal(calls,0);
  console.log('square_customer_one_page_isolation_replay_lost_ack_privacy_zero_ai_passed');
}
module.exports=main;
