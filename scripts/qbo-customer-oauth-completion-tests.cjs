/* eslint-disable @typescript-eslint/no-require-imports -- Execute actual TypeScript with synthetic capabilities only. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
global.fetch = () => { throw Error('live_network_forbidden'); };
const { beginCustomerAuthorization, persistBeforeDiscovery, completeCustomerAuthorization } =
  require('../services/external-integrations-qbo/src/oauth-completion.ts');
const { completePendingCustomerDisconnects } = require('../services/external-integrations-qbo/src/customer-disconnect.ts');
const { createQboInternalOperationAuthorizer } = require('../services/external-integrations-qbo/src/service-identity.ts');
const { createQboStartupReadiness } = require('../services/external-integrations-qbo/src/startup-readiness.ts');
const { googleIdentityToken } = require('../services/external-integrations-qbo/src/google.ts');
const { parseQboProductionDeniedHandoff, completeQboProductionDeniedHandoff, QBO_PRODUCTION_DENIED_HANDOFF_VERSION } =
  require('../services/external-integrations-qbo/src/oauth-denied-handoff.ts');
const { parseQboOAuthCallbackHandoff, sanitizedQboOAuthConfirmationUrl } = require('../lib/integrations/provider-runtime/qbo/callback-handoff.ts');
const { normalizeProviderOAuthReturnPath } = require('../lib/integrations/credentials/oauth-policy.ts');
const { QBO_PRODUCTION_OAUTH_POLICY } = require('../lib/integrations/provider-runtime/qbo/oauth-policy.ts');
const { BoundedIdentifierSchema } = require('../lib/integrations/contracts/primitives.ts');
const { z } = require('zod');
const { requireEmptyQboCallbackBody } = require('../services/external-integrations-qbo/src/callback-body.ts');
const { credentialAadDigest } = require('../lib/integrations/credentials/kms.ts');
const { contractSha256 } = require('../lib/integrations/contracts/canonical.ts');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`ok ${passed} - ${name}`); }
const stateId=randomUUID(), credentialId=randomUUID();
const stored = { credentialId, stored:true, credentialVersion:1, credentialStatus:'active',
  connectionStatus:'authorized_unmapped',connectionRowVersion:2,outcome:'stored' };
function client(data) { return { rpc: async () => ({ data,error:null }) }; }

async function main() {
  await test('startup readiness shares one pending check and caches its successful result',async()=>{
    let checks=0,finish;
    const ready=createQboStartupReadiness(()=>{checks++;return new Promise(resolve=>{finish=resolve;});});
    const pending=[ready(),ready(),ready()];
    await Promise.resolve();assert.equal(checks,1);
    finish();assert.deepEqual(await Promise.all(pending),[true,true,true]);
    assert.equal(await ready(),true);assert.equal(await ready(),true);assert.equal(checks,1);
  });
  await test('startup readiness returns false to concurrent callers and retries after failure',async()=>{
    let checks=0,fail;
    const ready=createQboStartupReadiness(()=>{
      checks++;
      return checks===1?new Promise((_resolve,reject)=>{fail=reject;}):Promise.resolve();
    });
    const pending=[ready(),ready(),ready()];
    await Promise.resolve();assert.equal(checks,1);
    fail(new Error('synthetic-private-database-error'));
    assert.deepEqual(await Promise.all(pending),[false,false,false]);
    assert.equal(checks,1);assert.equal(await ready(),true);assert.equal(checks,2);
    assert.equal(await ready(),true);assert.equal(checks,2);
  });
  await test('startup readiness contains synchronous check failures and can recover',async()=>{
    let checks=0;
    const ready=createQboStartupReadiness(()=>{
      if(++checks===1)throw Error('synthetic-private-configuration-error');
      return Promise.resolve();
    });
    assert.equal(await ready(),false);assert.equal(await ready(),true);assert.equal(checks,2);
  });
  for (const rawHeaders of [[], ['Content-Length','0']]) {
    await test('callback waits for actual body completion before broker authority', async () => {
      const request=Object.assign(new PassThrough(),{rawHeaders,complete:false,aborted:false});
      let brokerCalls=0;
      const checked=requireEmptyQboCallbackBody(request).then(()=>brokerCalls++);
      await Promise.resolve();assert.equal(brokerCalls,0);
      request.complete=true;request.end();await checked;assert.equal(brokerCalls,1);
    });
  }
  for (const rawHeaders of [['Content-Length','1'],['Content-Length','-1'],['Content-Length','00'],
    ['Content-Length','0','content-length','0'],['Transfer-Encoding','chunked'],['Expect','100-continue']]) {
    await test('callback invalid body framing denies all broker work',async()=>{
      const request=Object.assign(new PassThrough(),{rawHeaders,complete:false,aborted:false});
      let brokerCalls=0;
      await assert.rejects(requireEmptyQboCallbackBody(request).then(()=>brokerCalls++),{message:'qbo_oauth_callback_body_invalid'});
      assert.equal(brokerCalls,0);request.destroy();
    });
  }
  for (const rawHeaders of [[],['content-length','0']]) {
    await test('actual body bytes fail closed even with absent or zero declared length',async()=>{
      const request=Object.assign(new PassThrough(),{rawHeaders,complete:false,aborted:false});
      let brokerCalls=0;const bytes=Buffer.from('synthetic-private-body');
      const checked=requireEmptyQboCallbackBody(request).then(()=>brokerCalls++);
      request.end(bytes);await assert.rejects(checked,{message:'qbo_oauth_callback_body_invalid'});
      assert.equal(brokerCalls,0);assert.ok(bytes.every(byte=>byte===0));
    });
  }
  for (const event of ['error','aborted','close','incomplete-end']) {
    await test(`callback ${event} cannot authorize broker work`,async()=>{
      const request=Object.assign(new PassThrough(),{rawHeaders:[],complete:false,aborted:false});
      let brokerCalls=0;const checked=requireEmptyQboCallbackBody(request).then(()=>brokerCalls++);
      if(event==='incomplete-end')request.end();else request.emit(event,new Error('synthetic-private-error'));
      await assert.rejects(checked,{message:'qbo_oauth_callback_body_invalid'});assert.equal(brokerCalls,0);
    });
  }
  await test('real Node HTTP bodyless GET completes without consuming callback authority early',async()=>{
    let brokerCalls=0;
    const listener=http.createServer(async(request,response)=>{
      try { await requireEmptyQboCallbackBody(request);brokerCalls++;response.writeHead(204).end(); }
      catch { response.writeHead(400).end(); }
    });
    await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
    try {
      for(const headers of [{},{'Content-Length':'0'}]) {
        const status=await new Promise((resolve,reject)=>{
          const request=http.request({host:'127.0.0.1',port:listener.address().port,path:'/oauth/callback',method:'GET',headers},response=>{
            response.resume();response.on('end',()=>resolve(response.statusCode));
          });request.on('error',reject);request.end();
        });assert.equal(status,204);
      }
      assert.equal(brokerCalls,2);
    } finally {await new Promise(resolve=>listener.close(resolve));}
  });
  await test('unfinished callback stream times out closed without broker access',async()=>{
    const request=Object.assign(new PassThrough(),{rawHeaders:[],complete:false,aborted:false});
    let brokerCalls=0;
    await assert.rejects(requireEmptyQboCallbackBody(request).then(()=>brokerCalls++),{message:'qbo_oauth_callback_body_invalid'});
    assert.equal(brokerCalls,0);assert.equal(request.destroyed,true);
  });
  await test('empty callback body enforcement precedes both denial and success handoff consumers',async()=>{
    const server=fs.readFileSync(path.join(root,'services/external-integrations-qbo/src/server.ts'),'utf8');
    const gate=server.indexOf('await requireEmptyQboCallbackBody(request)');
    assert.ok(gate>0 && gate<server.indexOf('const denied = parseQboProductionDeniedHandoff'));
    assert.ok(gate<server.indexOf('const callback = CallbackSchema.parse(parseQboOAuthCallbackHandoff'));
  });
  await test('stored acknowledgement precedes discovery', async () => {
    const events=[];
    const value=await persistBeforeDiscovery({ client:client(stored),stateId,credentialId,
      store:async()=>events.push('store'),discover:async()=>{events.push('discover');return 'verified';} });
    assert.deepEqual(events,['store','discover']);assert.equal(value,'verified');
  });
  await test('lost store acknowledgement reads exact durable identity without replaying store',async()=>{
    let stores=0,reads=0,discoveries=0;
    await persistBeforeDiscovery({ client:{rpc:async(name,args)=>{
      assert.equal(name,'read_qbo_customer_authorization_completion_v1');assert.deepEqual(args,{p_state_id:stateId});
      reads++;return {data:stored,error:null};}},stateId,credentialId,
      store:async()=>{stores++;throw Error('lost_ack');},discover:async()=>{discoveries++;} });
    assert.deepEqual([stores,reads,discoveries],[1,1,1]);
  });
  for (const change of [{stored:false},{credentialId:randomUUID()},{credentialStatus:'revoked'},{outcome:'recovery_required'}]) {
    await test(`uncertain store fails closed for ${Object.keys(change)[0]}`,async()=>{
      let discoveries=0;
      await assert.rejects(persistBeforeDiscovery({client:client({...stored,...change}),stateId,credentialId,
        store:async()=>{throw Error('lost_ack');},discover:async()=>discoveries++}));assert.equal(discoveries,0);
    });
  }
  await test('one-time database realm claim precedes exchange authority',async()=>{
    let calls=0;
    const value=await beginCustomerAuthorization({rpc:async(name,args)=>{
      assert.equal(name,'begin_qbo_customer_authorization_v1');assert.equal(args.p_state_id,stateId);
      calls++;return {data:{credentialId,priorMappingVerificationFingerprint:null},error:null};
    }},stateId,`sha256:${'1'.repeat(64)}`);assert.equal(calls,1);assert.equal(value.credentialId,credentialId);
  });
  await test('uncertain exchange never retries and records bounded recovery status',async()=>{
    const calls=[];let exchanges=0;
    await assert.rejects(completeCustomerAuthorization({client:{rpc:async(name,args)=>{
      calls.push([name,args]);return {data:{outcome:'recovery_required',idempotent:false},error:null};}},stateId,
      complete:async()=>{exchanges++;throw Error('synthetic-secret-that-must-not-escape');}}),
    {message:'qbo_customer_authorization_recovery_required'});
    assert.equal(exchanges,1);assert.deepEqual(calls,[['finish_qbo_customer_authorization_v1',{
      p_state_id:stateId,p_outcome:'recovery_required'}]]);
  });
  await test('completion persists success only after verified discovery',async()=>{
    const order=[];
    const result=await completeCustomerAuthorization({client:{rpc:async(name,args)=>{
      assert.equal(args.p_outcome,'completed');order.push('finish');return {data:{outcome:'completed',idempotent:false},error:null};}},
      stateId,complete:async()=>{order.push('discovery');return 'initialized';}});
    assert.equal(result,'initialized');assert.deepEqual(order,['discovery','finish']);
  });

  const aadContext={schemaVersion:'oauth_credential_aad_v1',purpose:'provider_oauth_credential',
    environment:'production',workspaceId:randomUUID(),connectionId:randomUUID(),connectionGeneration:1,
    providerKey:'quickbooks_online',credentialId:randomUUID()};
  const envelope={schemaVersion:'oauth_credential_envelope_v1',providerKey:'quickbooks_online',environment:'production',
    externalAuthorizedEntityReference:'SYNTHETIC_REALM',accessToken:'synthetic-access-token',refreshToken:'synthetic-refresh-token',
    accessExpiresAt:'2030-01-01T01:00:00.000Z',refreshExpiresAt:'2030-04-01T00:00:00.000Z',
    issuedAt:'2030-01-01T00:00:00.000Z',updatedAt:'2030-01-01T00:00:00.000Z',grantedScopes:['com.intuit.quickbooks.accounting']};
  const claim={acquired:true,claimId:randomUUID(),connectionId:aadContext.connectionId,credentialId:aadContext.credentialId,
    credentialVersion:1,ciphertextBase64:Buffer.alloc(32,1).toString('base64'),aadContext,aadDigest:credentialAadDigest(aadContext),
    kmsKeyResource:'projects/synthetic-prod/locations/us-central1/keyRings/credentials/cryptoKeys/qbo',
    realmFingerprint:contractSha256({fingerprintPurpose:'provider_authorized_entity_reference',
      fingerprintVersion:'provider_authorized_entity_reference_fingerprint_v1',value:envelope.externalAuthorizedEntityReference})};
  async function disconnect(options={}) {
    let claims=0,revokes=0,decrypts=0;const calls=[];
    const result=await completePendingCustomerDisconnects({maximumConnections:2,kmsKeyResource:claim.kmsKeyResource,
      client:{rpc:async(name,args)=>{calls.push([name,args]);
        if(name==='claim_qbo_customer_disconnect_v1')return {data:claims++===0?{...claim,...options.claim}:{acquired:false},error:null};
        if(name==='authorize_qbo_customer_revocation_v1')return {data:options.stale?false:true,error:null};
        assert.equal(name,'complete_qbo_customer_disconnect_v1');
        assert.equal(args.p_claim_id,claim.claimId);assert.equal(args.p_connection_id,claim.connectionId);
        return {data:{disconnected:args.p_outcome==='succeeded',providerOutcome:args.p_outcome,idempotent:false},error:null};}},
      kms:{decrypt:async()=>{decrypts++;return Buffer.from(JSON.stringify(envelope));},encrypt:async()=>{throw Error('encrypt forbidden');}},
      secrets:{access:async()=>({use:fn=>fn({clientId:'synthetic-client',clientSecret:'synthetic-secret'})})},provider:{exchangeAuthorizationCode:async()=>{throw Error('exchange forbidden');},
        refreshCredential:async()=>{throw Error('refresh forbidden');},revokeCredential:async input=>{
          revokes++;if(options.revoke)return options.revoke(input);if(options.fail)throw Error('secret');}}});
    return {result,revokes,decrypts,calls};
  }
  await test('one private revocation and canonical local completion, counts only',async()=>{
    const value=await disconnect();assert.equal(value.revokes,1);assert.equal(value.decrypts,1);
    assert.deepEqual(value.result,{disconnectedCount:1,providerRevokedCount:1,providerUnconfirmedCount:0});
    assert(!JSON.stringify(value.result).includes('synthetic'));assert(!JSON.stringify(value.calls).includes('Token'));
  });
  await test('OIDC broker caller cannot select another credential through body',async()=>{
    const {calls}=await disconnect();assert.deepEqual(Object.keys(calls[0][1]),['p_request_id']);
  });
  await test('KMS resource mismatch never decrypts or revokes',async()=>{
    const value=await disconnect({claim:{kmsKeyResource:claim.kmsKeyResource+'-foreign'}});
    assert.equal(value.decrypts,0);assert.equal(value.revokes,0);assert.equal(value.result.providerUnconfirmedCount,1);
  });
  await test('AAD mismatch never decrypts or revokes',async()=>{
    const value=await disconnect({claim:{aadDigest:`sha256:${'0'.repeat(64)}`}});
    assert.equal(value.decrypts,0);assert.equal(value.revokes,0);
  });
  await test('realm substitution never revokes',async()=>{
    const value=await disconnect({claim:{realmFingerprint:`sha256:${'0'.repeat(64)}`}});assert.equal(value.revokes,0);
  });
  await test('stale revocation claim never calls provider',async()=>{
    const value=await disconnect({stale:true});assert.equal(value.revokes,0);
  });
  await test('failed provider revoke is not reported as successful remote revocation',async()=>{
    const value=await disconnect({fail:true});assert.equal(value.revokes,1);
    assert.deepEqual(value.result,{disconnectedCount:0,providerRevokedCount:0,providerUnconfirmedCount:1});
  });
  const {QboOAuthCredentialProvider}=require('../lib/integrations/provider-runtime/qbo/oauth.ts');
  for(const status of [503,400])await test(`provider revocation HTTP ${status} remains unconfirmed without false destruction authority`,async()=>{
    let attempts=0;
    const provider=new QboOAuthCredentialProvider({environment:'production',redirectUri:'https://integrations.vaeroex.com/oauth/callback',
      transport:{postForm:async()=>{attempts++;return {status,body:Buffer.from('{}')};}}});
    const value=await disconnect({revoke:input=>provider.revokeCredential(input)});
    assert.equal(attempts,1);assert.equal(value.revokes,1);
    assert.deepEqual(value.result,{disconnectedCount:0,providerRevokedCount:0,providerUnconfirmedCount:1});
    assert.equal(value.calls.at(-2)[0],'complete_qbo_customer_disconnect_v1');
    assert.equal(value.calls.at(-2)[1].p_outcome,'failed');
  });

  const {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK}=require('jose');
  const signing=await generateKeyPair('RS256');
  const publicKey={...await exportJWK(signing.publicKey),kid:'synthetic-google-key',alg:'RS256',use:'sig'};
  const audience='https://qbo-synthetic-service.run.app';
  const callerEnvs=['QBO_OAUTH_INGRESS_SERVICE_ACCOUNT','QBO_PROVIDER_RUNTIME_SERVICE_ACCOUNT',
    'QBO_TASK_SCHEDULER_SERVICE_ACCOUNT','QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT',
    'QBO_INITIALIZATION_SCHEDULER_SERVICE_ACCOUNT','QBO_DISPATCH_SCHEDULER_SERVICE_ACCOUNT'];
  const identityEnvironment={QBO_SERVICE_AUDIENCE:audience,...Object.fromEntries(callerEnvs.map((key,index)=>
    [key,`qbo-caller-${index}@synthetic-project.iam.gserviceaccount.com`]))};
  const authorize=createQboInternalOperationAuthorizer(identityEnvironment,createLocalJWKSet({keys:[publicKey]}));
  const operations=[['credential_broker','/oauth/complete',0],['credential_broker','/oauth/denied',0],
    ['credential_broker','/webhooks/verify',0],['credential_broker','/credentials/read',1],
    ['credential_broker','/credentials/refresh',1],['credential_broker','/credentials/revoke-pending',2],
    ['provider_runtime','/tasks/execute',3],['provider_runtime','/tasks/validate-pending',2],
    ['task_scheduler','/tasks/schedule',4],['task_dispatcher','/tasks/dispatch',5]];
  const now=Math.floor(Date.now()/1000);
  async function signed(index,changes={}) {
    return new SignJWT({iss:'https://accounts.google.com',aud:audience,sub:String(123456789+index),
      email:identityEnvironment[callerEnvs[index]],email_verified:true,iat:now,exp:now+3600,...changes})
      .setProtectedHeader({alg:'RS256',kid:'synthetic-google-key'}).sign(signing.privateKey);
  }
  function identityRequest(mode,path,token) {
    return {mode,method:'POST',url:new URL(path,audience),headers:{authorization:`Bearer ${token}`},
      rawHeaders:['Authorization',`Bearer ${token}`]};
  }
  for(const [mode,operation,index] of operations.filter(([,operation])=>
    ['/tasks/execute','/tasks/schedule','/tasks/dispatch'].includes(operation))) {
    for(const variant of ['signed','redacted','empty-signature','serverless-only']) {
      await test(`${operation} platform delivery ${variant} preserves signed Authorization requirement`,async()=>{
        const token=await signed(index),parts=token.split('.');
        const delivered=variant==='redacted'?`${parts[0]}.${parts[1]}.SIGNATURE_REMOVED_BY_GOOGLE`:
          variant==='empty-signature'?`${parts[0]}.${parts[1]}.`:token;
        const request=identityRequest(mode,operation,delivered);
        if(variant==='serverless-only') {
          request.headers={'x-serverless-authorization':`Bearer ${token}`};
          request.rawHeaders=['X-Serverless-Authorization',`Bearer ${token}`];
        }
        assert.equal(await authorize(request),variant==='signed');
      });
    }
  }
  await test('metadata identity helper preserves exact canonical audience accepted by per-operation verifier',async()=>{
    const originalFetch=global.fetch;let requests=0,index=0;
    global.fetch=async(url,init)=>{
      requests++;
      assert.equal(url,`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`);
      assert.equal(init.headers['metadata-flavor'],'Google');
      const requestedAudience=new URL(url).searchParams.get('audience');
      return new Response(await signed(index,{aud:requestedAudience}));
    };
    try {
      for(const [mode,operation,caller] of operations) {
        index=caller;
        const token=await googleIdentityToken(audience);
        assert.equal(await authorize(identityRequest(mode,operation,token)),true);
      }
      assert.equal(requests,operations.length);
      assert.equal(await authorize(identityRequest('provider_runtime','/tasks/execute',await signed(3,{aud:audience+'/'}))),false);
    } finally { global.fetch=originalFetch; }
  });
  await test('metadata identity helper rejects noncanonical audiences before token acquisition',async()=>{
    const originalFetch=global.fetch;let requests=0;
    global.fetch=async()=>{requests++;throw Error('metadata_must_not_be_reached');};
    try {
      for(const invalid of [audience+'/',audience+'/tasks/execute',audience+'?x=1',audience+'#fragment',
        audience+'?',audience+'#',audience+':443',audience.replace('https:','http:'),
        audience.replace('https://','https://user:password@'),audience.toUpperCase(),` ${audience}`,audience+'\n']) {
        await assert.rejects(googleIdentityToken(invalid),{message:'qbo_production_google_identity_audience_invalid'});
      }
      await assert.rejects(googleIdentityToken('not-a-url'));
      assert.equal(requests,0);
    } finally { global.fetch=originalFetch; }
  });
  await test('each internal operation accepts only its exact signed service-account allowlist',async()=>{
    const tokens=await Promise.all(callerEnvs.map((_,index)=>signed(index)));
    for(const [mode,path,expected] of operations)for(let index=0;index<tokens.length;index++) {
      assert.equal(await authorize(identityRequest(mode,path,tokens[index])),index===expected,`${mode} ${path} caller ${index}`);
    }
  });
  await test('OIDC rejects wrong issuer audience email subject expiry and unverified email',async()=>{
    for(const change of [{iss:'https://attacker.invalid'},{aud:'https://other.run.app'},{aud:[audience]},
      {email:'other@synthetic-project.iam.gserviceaccount.com'},{email_verified:false},{email_verified:'true'},
      {sub:''},{sub:'not-service-account-id'},{exp:now-1},{exp:undefined},{iat:now+120},{exp:now+7200}]) {
      assert.equal(await authorize(identityRequest('provider_runtime','/tasks/execute',await signed(3,change))),false);
    }
  });
  await test('OIDC rejects unsigned stripped duplicate malformed and unconfigured identities',async()=>{
    const token=await signed(3), base=identityRequest('provider_runtime','/tasks/execute',token);
    const parts=token.split('.');
    for(const request of [
      {...base,headers:{authorization:`Bearer ${parts[0]}.${parts[1]}.`}},
      {...base,headers:{authorization:`Bearer ${parts[0]}.${parts[1]}.AAAA`}},
      {...base,headers:{'x-serverless-authorization':`Bearer ${token}`}},
      {...base,headers:{authorization:[`Bearer ${token}`]}},
      {...base,rawHeaders:[...base.rawHeaders,...base.rawHeaders]},
      {...base,method:'GET'},{...base,url:new URL('/tasks/execute?authority=other',audience)},
      {...base,url:new URL('/unknown',audience)}
    ])assert.equal(await authorize(request),false);
    assert.equal(await createQboInternalOperationAuthorizer({},createLocalJWKSet({keys:[publicKey]}))(base),false);
  });

  // Run the actual ingress function without booting the service or substituting
  // its callback logic. Only private transport, logging and HTTP response are mocked.
  const serverFile=path.join(root,'services/external-integrations-qbo/src/server.ts');
  const source=ts.createSourceFile(serverFile,fs.readFileSync(serverFile,'utf8'),ts.ScriptTarget.Latest,true);
  const ingress=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='handleIngress');
  const callbackSchema=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='CallbackSchema'));
  assert(ingress&&callbackSchema);
  const vm=require('node:vm'); const events=[],requests=[];let brokerResult={outcome:'denied',returnIntent:'/app/settings'};
  await test('actual database connectivity checks only connect and release and propagate connection failures',async()=>{
    const databaseFile=path.join(root,'services/external-integrations-qbo/src/database.ts');
    const {qboDatabaseConfiguration}=require('../services/external-integrations-qbo/src/database-config.ts');
    const ca=fs.readFileSync(path.join(root,'tools/jit-access-feasibility/supabase-root-2021.crt'),'utf8');
    const operations=[],forbidden=[];let connectionFailure=null,poolOptions;
    const deny=capability=>()=>{forbidden.push(capability);throw Error(`forbidden_${capability}`);};
    class MockPool {
      constructor(options) {poolOptions=options;}
      async connect() {
        operations.push('connect');
        if(connectionFailure)throw connectionFailure;
        return {query:deny('sql'),release:()=>operations.push('release')};
      }
      async end() {operations.push('end');}
    }
    const context={exports:{},fetch:deny('network'),require:request=>{
      if(request==='server-only')return {};
      if(request==='pg')return {Pool:MockPool};
      if(request==='./database-config')return {qboDatabaseConfiguration};
      return deny(`import_${request}`)();
    }};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(databaseFile,'utf8'),{
      fileName:databaseFile,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
    }).outputText,context,{filename:databaseFile});
    const db=new context.exports.QboProductionDatabase(
      'postgresql://synthetic:synthetic@aws-0-us-central1.pooler.supabase.com:5432/postgres?sslmode=require',
      ['integration_credential_broker_authority'],ca);
    db.role=deny('role');
    try {
      assert.equal(poolOptions.ssl.rejectUnauthorized,true);assert.equal(poolOptions.ssl.ca,ca);
      assert.equal(poolOptions.connectionTimeoutMillis,10000);
      assert.equal(new URL(poolOptions.connectionString).searchParams.has('sslmode'),false);
      assert.equal(await db.checkConnectivity(),undefined);
      assert.deepEqual(operations,['connect','release']);operations.length=0;
      connectionFailure=Object.assign(new Error('synthetic-private-connect-failure'),{code:'ETIMEDOUT'});
      await assert.rejects(()=>db.checkConnectivity(),error=>error===connectionFailure);
      assert.deepEqual(operations,['connect']);assert.deepEqual(forbidden,[]);
    } finally {await db.close();}
    assert.deepEqual(operations,['connect','end']);assert.deepEqual(forbidden,[]);
  });
  function readinessRoute(check,mode='credential_broker') {
    const route=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='route');
    const readiness=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>
      d.name.getText(source)==='startupReady'&&d.initializer&&ts.isCallExpression(d.initializer)&&
      d.initializer.expression.getText(source)==='createQboStartupReadiness'));
    assert(route&&readiness,'actual router must compose startup readiness');
    const state={checks:0,databases:0,closes:0,authorizations:0,forbidden:[],logs:[]};
    const deny=capability=>()=>{state.forbidden.push(capability);throw Error(`forbidden_${capability}`);};
    const context={exports:{},URL,config:{mode,sourceCommit:'synthetic'},createQboStartupReadiness,
      database:()=>{state.databases++;return {
        checkConnectivity:async()=>{state.checks++;await check();},close:async()=>{state.closes++;},
        role:deny('database_role'),rpc:deny('database_rpc')
      };},
      authorizeInternalOperation:async()=>{state.authorizations++;return false;},
      json:(_response,status,body)=>({status,body}),safeEvent:(...args)=>state.logs.push(args),
      console:Object.fromEntries(['log','info','warn','error','debug','trace'].map(name=>[name,(...args)=>state.logs.push(args)])),
      process:{stdout:{write:value=>state.logs.push(value)},stderr:{write:value=>state.logs.push(value)}},
      brokerDependencies:deny('broker_dependencies'),callBroker:deny('broker_call'),
      googleIdentityToken:deny('identity_token'),fetch:deny('network'),
      googleCloudKmsTransport:{encrypt:deny('kms_encrypt'),decrypt:deny('kms_decrypt')},
      googleSecretManagerTransport:{accessSecretVersion:deny('secret_access')},
      handleIngress:deny('ingress'),handleBroker:deny('broker'),handleScheduler:deny('scheduler'),
      handleDispatcher:deny('dispatcher'),handleValidationRecovery:deny('validation'),executeTask:deny('provider')};
    vm.runInNewContext(ts.transpileModule(readiness.getText(source)+'\n'+route.getText(source)+'\nexports.route=route;',{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
    return {state,request:(url='/health/ready',method='GET')=>
      context.exports.route({url,method,headers:{},rawHeaders:[]},{})};
  }
  await test('actual readiness route returns 503 on connectivity failure then retries and caches success',async()=>{
    for(const mode of ['credential_broker','provider_runtime']) {
      let checks=0;
      const harness=readinessRoute(async()=>{if(++checks===1)throw Error('synthetic-private-db-url-and-password');},mode);
      const failed=await harness.request();assert.equal(failed.status,503);assert.equal(failed.body.ready,false);
      assert.equal(harness.state.checks,1);assert.equal(harness.state.closes,1);
      assert.doesNotMatch(JSON.stringify([failed.body,harness.state.logs]),/synthetic-private|password/);
      const recovered=await harness.request();assert.equal(recovered.status,200);assert.equal(recovered.body.ready,true);
      const cached=await harness.request();assert.equal(cached.status,200);assert.equal(cached.body.ready,true);
      assert.equal(harness.state.checks,2);assert.equal(harness.state.databases,2);assert.equal(harness.state.closes,2);
      assert.equal(harness.state.authorizations,0);assert.deepEqual(harness.state.forbidden,[]);
    }
  });
  await test('actual readiness route shares concurrent probes without operational capabilities',async()=>{
    let finish;
    const harness=readinessRoute(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=[harness.request(),harness.request(),harness.request()];
    await Promise.resolve();assert.equal(harness.state.checks,1);assert.equal(harness.state.databases,1);
    finish();assert.deepEqual((await Promise.all(pending)).map(result=>result.status),[200,200,200]);
    assert.equal(harness.state.closes,1);assert.equal(harness.state.authorizations,0);
    assert.deepEqual(harness.state.forbidden,[]);
  });
  await test('actual readiness route rejects non-GET methods and query or hash suffixes without checking connectivity',async()=>{
    for(const mode of ['credential_broker','provider_runtime']) {
      const harness=readinessRoute(async()=>{throw Error('must_not_check');},mode);
      for(const method of ['POST','HEAD','PUT','PATCH','DELETE','OPTIONS']) {
        assert.ok((await harness.request('/health/ready',method)).status>=400);
      }
      assert.ok((await harness.request('/health/ready?check=1')).status>=400);
      assert.ok((await harness.request('/health/ready#check')).status>=400);
      assert.ok((await harness.request('/health/ready?')).status>=400);
      assert.ok((await harness.request('/health/ready#')).status>=400);
      assert.equal(harness.state.checks,0);assert.equal(harness.state.databases,0);
      assert.deepEqual(harness.state.forbidden,[]);
    }
  });
  await test('actual readiness route denies other service modes without connectivity or operational work',async()=>{
    for(const mode of ['oauth_ingress','task_scheduler','task_dispatcher']) {
      const harness=readinessRoute(async()=>{throw Error('must_not_check');},mode);
      assert.ok((await harness.request()).status>=400);
      assert.equal(harness.state.checks,0);assert.equal(harness.state.databases,0);
      assert.deepEqual(harness.state.forbidden,[]);
    }
  });
  await test('actual central router denies scheduler task execution before any handler or body access',async()=>{
    const route=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='route');assert(route);
    const reached=[];
    const routeContext={exports:{},URL,config:{mode:'provider_runtime',sourceCommit:'synthetic'},
      authorizeInternalOperation:authorize,json:(_res,status,body)=>({status,body}),
      handleIngress:()=>{throw Error('unexpected ingress');},handleBroker:()=>reached.push('broker'),
      handleScheduler:()=>reached.push('scheduler'),handleDispatcher:()=>reached.push('dispatcher'),
      handleValidationRecovery:()=>reached.push('validation'),executeTask:()=>reached.push('execute')};
    vm.runInNewContext(ts.transpileModule(route.getText(source)+'\nexports.route=route;',{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,routeContext);
    const schedulerToken=await signed(2);
    let request={...identityRequest('provider_runtime','/tasks/execute',schedulerToken),url:'/tasks/execute'};
    assert.equal((await routeContext.exports.route(request,{})).status,403);assert.deepEqual(reached,[]);
    await routeContext.exports.route({...request,url:'/tasks/validate-pending'},{});assert.deepEqual(reached,['validation']);
    reached.length=0;
    request={...identityRequest('provider_runtime','/tasks/execute',await signed(3)),url:'/tasks/execute'};
    await routeContext.exports.route(request,{});assert.deepEqual(reached,['execute']);
    reached.length=0;routeContext.config.mode='credential_broker';
    const schedulerRequest={...identityRequest('credential_broker','/credentials/read',schedulerToken),url:'/credentials/read'};
    assert.equal((await routeContext.exports.route(schedulerRequest,{})).status,403);assert.deepEqual(reached,[]);
    await routeContext.exports.route({...schedulerRequest,url:'/credentials/revoke-pending'},{});assert.deepEqual(reached,['broker']);
  });
  await test('internal calls preserve full signed Authorization separately from Cloud Run IAM header',async()=>{
    const headers=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='internalAuthorizationHeaders');assert(headers);
    const token=await signed(2);const headersContext={exports:{},googleIdentityToken:async aud=>{assert.equal(aud,audience);return token;}};
    vm.runInNewContext(ts.transpileModule(headers.getText(source)+'\nexports.headers=internalAuthorizationHeaders;',{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,headersContext);
    const result=await headersContext.exports.headers(audience);
    assert.equal(result.authorization,`Bearer ${token}`);assert.equal(result['x-serverless-authorization'],`Bearer ${token}`);
    for(const name of ['callBroker','callBrokerWebhook','callValidationRecovery']) {
      const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(fn);
      assert.match(fn.getText(source),/\.\.\.await internalAuthorizationHeaders\(/);
    }
  });
  const context={exports:{},URL,z,BoundedIdentifierSchema,QBO_PRODUCTION_OAUTH_POLICY,normalizeProviderOAuthReturnPath,
    parseQboProductionDeniedHandoff,completeQboProductionDeniedHandoff,parseQboOAuthCallbackHandoff,sanitizedQboOAuthConfirmationUrl,requireEmptyQboCallbackBody,
    env:name=>{assert.equal(name,'QBO_APPLICATION_ORIGIN');return 'https://www.vaeroex.com';},
    safeEvent:(...args)=>events.push(args),callBroker:async(...args)=>{requests.push(args);return brokerResult;},
    redirect:(_response,target)=>({status:303,target}),json:(_response,status,body)=>({status,body})};
  vm.runInNewContext(ts.transpileModule(callbackSchema.getText(source)+'\n'+ingress.getText(source)+'\nexports.ingress=handleIngress;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  function denialRequest(changes={}) {
    const headers={'x-vaeroex-oauth-handoff-version':QBO_PRODUCTION_DENIED_HANDOFF_VERSION,
      'x-vaeroex-oauth-state':`i1_${'a'.repeat(43)}`,...changes.headers};
    return {method:changes.method??'GET',url:changes.url??'/oauth/callback',headers,
      rawHeaders:changes.rawHeaders??Object.entries(headers).flatMap(([key,value])=>[key,value])};
  }
  async function runIngress(request) {
    requests.length=0;events.length=0;
    const stream=Object.assign(new PassThrough(),request,{complete:true,aborted:false});
    stream.end(request.body);
    return context.exports.ingress(stream,{},new URL(request.url,'https://ingress.invalid'));
  }
  await test('actual ingress denies body bytes before either callback broker path',async()=>{
    for(const version of [QBO_PRODUCTION_DENIED_HANDOFF_VERSION,'qbo_oauth_callback_handoff_v1']) {
      await assert.rejects(runIngress({...denialRequest({headers:{'x-vaeroex-oauth-handoff-version':version}}),
        body:Buffer.from('synthetic-private-body')}),{message:'qbo_oauth_callback_body_invalid'});
      assert.equal(requests.length,0);assert.equal(events.length,0);
    }
  });
  await test('actual ingress consumes only bounded denial at private broker and returns clean customer URL',async()=>{
    for(const prefix of ['i1_','r1_']) {
      const state=prefix+'a'.repeat(43);
      const result=await runIngress(denialRequest({headers:{'x-vaeroex-oauth-state':state}}));
      assert.equal(result.status,303);assert.equal(result.target,'https://www.vaeroex.com/app/settings');
      assert.equal(requests.length,1);assert.equal(requests[0][0],'/oauth/denied');
      assert.deepEqual(requests[0][1],{state,error:'access_denied'});
      assert(!JSON.stringify(events).includes(state));assert(!result.target.includes(state));
    }
  });
  await test('denied callback cannot introduce code realm arbitrary error or duplicate headers',async()=>{
    const base=denialRequest();
    for(const changes of [
      {headers:{'x-vaeroex-oauth-code':'synthetic-code'}},
      {headers:{'x-vaeroex-oauth-realm-id':'synthetic-realm'}},
      {headers:{'x-vaeroex-oauth-state':['i1_'+'a'.repeat(43),'i1_'+'b'.repeat(43)]}},
      {headers:{'x-vaeroex-oauth-state':'r1_'+'b'.repeat(42)}},
      {headers:{'transfer-encoding':'chunked'}},{headers:{'content-length':'1'}},{headers:{expect:'100-continue'}},
      {rawHeaders:[...base.rawHeaders,'X-Vaeroex-Oauth-State',base.headers['x-vaeroex-oauth-state']]},
      {rawHeaders:[...base.rawHeaders,'content-length','0','content-length','0']},
      {headers:{'x-vaeroex-oauth-handoff-version':'arbitrary-error'}},
      {url:'/oauth/callback?error=access_denied'},{url:'/oauth/callback#raw-state'}
    ]) {
      await assert.rejects(runIngress(denialRequest(changes)));assert.equal(requests.length,0);
      assert.equal(events.length,0);
    }
    await assert.rejects(completeQboProductionDeniedHandoff({callback:{state:base.headers['x-vaeroex-oauth-state'],error:'arbitrary'},
      applicationOrigin:'https://www.vaeroex.com',callBroker:async()=>{throw Error('must not call');}}),
      {message:'qbo_production_denied_callback_rejected'});
  });
  await test('denied callback rejects foreign query-bearing and malformed customer return values',async()=>{
    for(const returnIntent of ['https://foreign.invalid/','//foreign.invalid/','/app/settings?state=private','/app/settings#private']) {
      brokerResult={outcome:'denied',returnIntent};
      await assert.rejects(runIngress(denialRequest()),{message:'qbo_production_denied_callback_rejected'});
      assert.equal(requests.length,1);
    }
    brokerResult={outcome:'denied',returnIntent:'/app/settings',code:'must-not-escape'};
    await assert.rejects(runIngress(denialRequest()),{message:'qbo_production_denied_callback_rejected'});
  });
  await test('successful ingress still uses exact original callback handoff and completion path',async()=>{
    const request=denialRequest({headers:{'x-vaeroex-oauth-handoff-version':'qbo_oauth_callback_handoff_v1',
      'x-vaeroex-oauth-code':'synthetic-code','x-vaeroex-oauth-realm-id':'synthetic-realm'}});
    brokerResult={returnIntent:'/app/settings'};
    const result=await runIngress(request);assert.equal(result.target,'https://www.vaeroex.com/app/settings');
    assert.equal(requests[0][0],'/oauth/complete');
    assert.deepEqual(requests[0][1],{code:'synthetic-code',state:request.headers['x-vaeroex-oauth-state'],realmId:'synthetic-realm'});
    assert.throws(()=>parseQboOAuthCallbackHandoff({...denialRequest(),requestUrl:'/oauth/callback'}));
    assert.equal(parseQboProductionDeniedHandoff({...request,requestUrl:request.url}),null);
    await assert.rejects(runIngress({...request,url:'/oauth/callback?code=synthetic-code'}));
    assert.equal(requests.length,0);
  });
  await test('private denial failure never redirects or emits provider error details',async()=>{
    context.callBroker=async()=>{throw Error('private-provider-error-with-state');};
    await assert.rejects(runIngress(denialRequest()),{message:'qbo_production_denied_callback_rejected'});
    assert(!JSON.stringify(events).includes('private-provider-error'));
  });

  // Render the actual Settings panel and disconnect page. Identity and read-only
  // persistence are synthetic; no route, provider or mutation capability is present.
  const { installLoader, ids, timestamp }=require('./qbo-customer-test-support.cjs');
  let role='owner',connectionStatus='reauthorization_required',workspaceReads=0;
  const tables=[];
  const connection={id:ids.connection,provider_key:'quickbooks_online',safe_display_name:'Synthetic company',
    status_changed_at:timestamp};
  const supabase={from:table=>{
    tables.push(table);
    assert(['integration_connection_summaries','integration_freshness_summaries','business_entities'].includes(table));
    const query={then:resolve=>resolve({data:table==='integration_connection_summaries'
      ? [{...connection,status:connectionStatus}]
      : table==='business_entities' ? [{id:ids.entity,display_name:'Synthetic entity'}] : []})};
    for(const method of ['select','eq','not','neq','order','in']) query[method]=(...args)=>{
      if(method==='eq'&&args[0]==='workspace_id')assert.equal(args[1],ids.workspace);
      return query;
    };
    return query;
  }};
  installLoader({
    '@/lib/workspaces/page-context':{requireWorkspacePage:async()=>{
      workspaceReads++;
      return {context:{membership:role===null?null:{role},profile:{email:'synthetic@example.invalid'},
        activeWorkspace:{name:'Synthetic workspace'}},supabase,workspaceId:ids.workspace};
    }},
    '@/components/app/ThemeControls':{ThemeControls:()=>null},
    '@/lib/auth/actions':{changePasswordAction:async()=>{throw Error('mutation_forbidden');}},
    '@/lib/integrations/control-plane/square-workspace-evidence':{readSquareWorkspaceEvidence:async()=>null},
    '@/lib/integrations/square-direct/server':{squareDirectEnabled:()=>false},
    'next/headers':{headers:async()=>new Headers()},
    'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}}
  });
  const SettingsPage=require('../app/app/settings/page.tsx').default;
  const DisconnectPage=require('../app/app/settings/integrations/quickbooks/disconnect/page.tsx').default;
  const {renderToStaticMarkup}=require('react-dom/server');
  const previousGate=process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED;
  try {
    process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED='true';
    await test('owner sees actual QBO connect reconnect and confirmed disconnect controls',async()=>{
      const settings=renderToStaticMarkup(await SettingsPage({}));
      assert.match(settings,/action="\/api\/integrations\/qbo\/connect"/);
      assert.match(settings,/action="\/api\/integrations\/qbo\/reauthorize"/);
      assert.match(settings,/aria-label="Reconnect QuickBooks"/);
      assert.match(settings,/href="\/app\/settings\/integrations\/quickbooks\/disconnect"/);
      const disconnect=renderToStaticMarkup(await DisconnectPage({}));
      assert.match(disconnect,/action="\/api\/integrations\/qbo\/disconnect" method="post"/);
      assert.match(disconnect,/<input[^>]*required=""[^>]*type="checkbox"[^>]*name="confirmation"[^>]*value="disconnect"/);
    });
    await test('admin manager member viewer and missing roles see status but no QBO mutation controls',async()=>{
      for(role of ['admin','manager','member','viewer',null]) {
        const settings=renderToStaticMarkup(await SettingsPage({}));
        assert.match(settings,/Synthetic company/);
        assert.doesNotMatch(settings,/action="\/api\/integrations\/qbo\//);
        assert.doesNotMatch(settings,/href="\/app\/settings\/integrations\/quickbooks\/disconnect"/);
        const disconnect=renderToStaticMarkup(await DisconnectPage({}));
        assert.match(disconnect,/Synthetic company/);
        assert.doesNotMatch(disconnect,/action="\/api\/integrations\/qbo\/disconnect"|name="confirmation"/);
      }
      role='owner';
    });
    await test('owner disconnect controls preserve canonical status eligibility',async()=>{
      for(connectionStatus of ['authorized_unmapped','initializing','active','degraded','reauthorization_required']) {
        assert.match(renderToStaticMarkup(await DisconnectPage({})),/action="\/api\/integrations\/qbo\/disconnect"/);
      }
      for(connectionStatus of ['disconnecting','disconnected','deleted']) {
        assert.doesNotMatch(renderToStaticMarkup(await DisconnectPage({})),/action="\/api\/integrations\/qbo\/disconnect"/);
      }
    });
    await test('dormant gate hides QBO controls without integration reads and rejects disconnect before identity',async()=>{
      for(const gate of [undefined,'false']) {
        if(gate===undefined)delete process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED;
        else process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED=gate;
        tables.length=0;
        assert.doesNotMatch(renderToStaticMarkup(await SettingsPage({})),/QuickBooks|Accounting connection|\/api\/integrations\/qbo\//);
        assert.deepEqual(tables,[]);
        const before=workspaceReads;
        await assert.rejects(DisconnectPage({}),{message:'NOT_FOUND'});
        assert.equal(workspaceReads,before);assert.deepEqual(tables,[]);
      }
    });
  } finally {
    if(previousGate===undefined)delete process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED;
    else process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED=previousGate;
  }
  console.log(`1..${passed}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
