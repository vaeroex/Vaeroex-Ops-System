/* Local synthetic requests/browser only. No hosted identity, provider access,
 * real credentials, browser profile reuse, HAR, trace, screenshot or log sink. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const {execFileSync}=require("node:child_process");
const {generateKeyPairSync,X509Certificate}=require("node:crypto");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { createSquareSandboxPortal, PORTAL_PATH, CALLBACK_PATH, PORTAL_SCRIPT } = require("../services/square-sandbox-callback/src/portal.ts");
const { checkedPortalConfig } = require("../services/square-sandbox-callback/src/config.ts");
const { createSquarePortalAuth, SESSION_COOKIE } = require("../services/square-sandbox-callback/src/auth.ts");
const {nativePortalHandler,checkedPortalTls,runSquareSandboxPortalCommand}=require("../services/square-sandbox-callback/src/server.ts");
const { SQUARE_REMOTE_SANDBOX: constants } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
const root = path.resolve(__dirname, "..");
const origin = constants.applicationOrigin;
const canary = "SYNTHETIC_CALLBACK_ONLY_DO_NOT_RECORD";
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const actor = { actorId: uuid(1), workspaceId: uuid(2), sessionId: uuid(4), role: "owner" };
const binding = { businessEntityId: uuid(3), operatorId: uuid(1), workspaceId: uuid(2), operatorRole: "owner", providerCallsEnabled: true };
const csrf = "c".repeat(43), state = "s".repeat(43);
const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: uuid(1), session_id: uuid(4), iss: `https://${constants.projectRef}.supabase.co/auth/v1`, aud: "authenticated", exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url")}.synthetic_signature_only`;
let assertions = 0;
const equal = (a,b,label) => { assertions++; assert.deepEqual(a,b,label); };
const ok = (a,label) => { assertions++; assert.ok(a,label); };
const rejects = async f => { assertions++; await assert.rejects(f); };
const jar = `${SESSION_COOKIE}=${jwt}; __Host-vaeroex-square-csrf=${csrf}`;
function request(route, { method="GET", body, headers={}, cookie=jar }={}) {
  return new Request(origin+route, { method, headers: { host:new URL(origin).host, origin,
    "sec-fetch-site":"same-origin", cookie, ...headers }, ...(body===undefined?{}:{body}) });
}
function post(action, data={}, options={}) {
  return request("/actions/"+action, { method:"POST", body:new URLSearchParams({csrf,...data}), ...options });
}
function fixture() {
  let opens=0, closes=0, consent=0, disconnects=0, initiated=0, signedIn=true;
  let stateUsed=false, viewState="authorization_required";
  const service = {
    async snapshot(value) { equal(value,actor); return { canManage:true, businessEntities:[], connections:[{ connectionId:uuid(5), businessEntityId:uuid(3), state:viewState }] }; },
    async initiate(value,input) { equal(value,actor); equal(input.businessEntityId,uuid(3)); initiated++;
      return { authorizationUrl:`${constants.providerOrigin}/oauth2/authorize?client_id=${constants.applicationId}&state=${state}` }; },
    async complete(value,input,signal) { equal(value,actor); ok(!signal.aborted); if(stateUsed) throw new Error(canary);
      equal(input.state,state); if(input.code) equal(input.code,canary); else equal(input.error,"access_denied");
      stateUsed=true; consent++; viewState=input.code?"mapping_required":"authorization_required"; },
    async disconnect(value,input) { equal(value,actor); equal(input,{connectionId:uuid(5),confirmation:"disconnect"}); disconnects++; viewState="disconnected"; }
  };
  const handler = createSquareSandboxPortal({ async open(signal) { ok(!signal.aborted); opens++;
    return { binding, service, auth:{ async authenticate(value){ return signedIn&&value===jwt?actor:null; },
      async login(email,password){ equal(email,"synthetic@example.invalid"); equal(password,canary); signedIn=true;return jwt; },
      async logout(value){equal(value,jwt);signedIn=false;} }, async close(){closes++;} }; } });
  return { handler, counts:()=>({opens,closes,consent,disconnects,initiated}), setState:v=>{viewState=v;} };
}
function privacy(response) {
  equal(response.headers.get("cache-control"),"no-store"); equal(response.headers.get("referrer-policy"),"no-referrer");
  const csp=response.headers.get("content-security-policy");ok(csp.includes("default-src 'none'"));ok(csp.includes("form-action 'none'"));
  for(const value of response.headers.values())ok(!value.includes(canary));
}
async function local() {
  await startupTrustTests();
  assertions += await require("./square-gcp-callback-ca-test-support.js").qualifyCallbackDatabaseCa();
  const config=JSON.parse(fs.readFileSync(path.join(root,"services/square-sandbox-callback/config.example.json"),"utf8"));
  equal(checkedPortalConfig(config).binding,null); assertions++;assert.throws(()=>checkedPortalConfig(config,true));
  for(const edit of [{enabled:true},{binding:{}},{supabasePublishableKey:"synthetic"},{unknown:true},{hostPolicyPath:"/tmp/any"}]) {
    assertions++;assert.throws(()=>checkedPortalConfig({...config,...edit}));
  }
  const f=fixture();let response=await f.handler(request(PORTAL_PATH,{cookie:""}));privacy(response);
  let html=await response.text();ok(html.includes("Vaeroex Square Sandbox"));ok(html.includes("type=\"password\""));
  const cookies=response.headers.getSetCookie();equal(cookies.length,1);ok(cookies[0].includes("Secure; HttpOnly; SameSite=Lax"));ok(!/Max-Age|Expires|Domain=/.test(cookies[0]));
  equal(f.counts().opens,0,"public login page performs no external IO");
  for(const [route,options] of [[PORTAL_PATH+"?code="+canary,{}],["/actions/map",{method:"POST"}],
    ["/api/integrations/square/webhook",{method:"POST"}], ["/actions/login",{method:"POST",headers:{origin:"null"}}],
    [PORTAL_PATH,{headers:{"x-forwarded-host":"www.vaeroex.com"}}], [PORTAL_PATH,{headers:{host:"www.vaeroex.com"}}]]) {
    response=await f.handler(request(route,options));privacy(response);ok(response.status>=400);ok(!(await response.text()).includes(canary));
  }
  equal(f.counts().opens,0);
  for(const options of [{headers:{origin:"null"}},{headers:{origin:"https://evil.invalid"}},{headers:{"sec-fetch-site":"cross-site"}},
    {cookie:jar+`; __Host-vaeroex-square-csrf=${csrf}`},{body:new URLSearchParams({csrf:"z".repeat(43)})},
    {body:new URLSearchParams([['csrf',csrf],['csrf',csrf]])},{body:new URLSearchParams({csrf,workspaceId:uuid(99)})}]) {
    response=await f.handler(post("connect",{},options));ok(response.status>=400);privacy(response);
  }
  equal(f.counts().opens,0,"origin/csrf/ambiguous input rejects before authority or secret IO");
  response=await f.handler(post("connect"));privacy(response);equal(response.status,200);ok((await response.json()).navigate.startsWith(constants.providerOrigin));
  response=await f.handler(request(CALLBACK_PATH+`?state=${state}&code=${canary}`));privacy(response);equal(response.status,303);equal(response.headers.get("location"),PORTAL_PATH);equal(await response.text(),"");
  response=await f.handler(request(CALLBACK_PATH+`?state=${state}&code=${canary}`));privacy(response);equal(response.status,303);equal(f.counts().consent,1);
  response=await f.handler(request(PORTAL_PATH));html=await response.text();ok(html.includes("authorized_unmapped"));ok(!html.includes(canary));ok(!html.includes("sellerLabel"));
  response=await f.handler(post("disconnect",{connectionId:uuid(5),confirmation:"disconnect"}));equal(response.status,200);equal(f.counts().disconnects,1);
  response=await f.handler(request(PORTAL_PATH));ok((await response.text()).includes("no provider-wide revocation was requested"));
  for(const query of [`code=${canary}`,`state=${state}&code=${canary}&code=duplicate`,`state=${state}&code=${canary}&error=bad`,
    `state=${state}&code=${canary}&extra=${canary}`,`state=${state}&code=${canary}&error_description=${canary}`]) {
    const before=f.counts().opens;response=await f.handler(request(CALLBACK_PATH+"?"+query));privacy(response);equal(response.status,303);equal(f.counts().opens,before);
  }
  const denied=fixture();response=await denied.handler(request(CALLBACK_PATH+`?state=${state}&error=${canary}&error_description=${canary}`));privacy(response);equal(denied.counts().consent,1);equal(response.status,303);
  const missing=fixture();await missing.handler(request(CALLBACK_PATH+`?state=${state}&code=${canary}`,{cookie:""}));equal(missing.counts().opens,0);
  for(const [route,headers] of [[CALLBACK_PATH+"?code="+"x".repeat(8192),{}],[CALLBACK_PATH+`?state=${state}&code=${canary}`,{"x-forwarded-host":"foreign.invalid"}]]) {
    const before=f.counts().opens;response=await f.handler(request(route,{headers}));privacy(response);equal(response.status,303);equal(response.headers.get("location"),PORTAL_PATH);equal(f.counts().opens,before);
  }
  equal(f.counts().opens,f.counts().closes,"success and failures release every opened scope");
  // Failure cleanup covers a read cancelled before any body bytes arrive, and
  // malformed/oversized/flooded bodies reject before opening authority.
  let cancelled=0;const controller=new AbortController();
  const stream=new ReadableStream({cancel(){cancelled++;}});
  const pending=f.handler(new Request(origin+"/actions/login",{method:"POST",headers:{host:new URL(origin).host,origin,"sec-fetch-site":"same-origin",cookie:jar,"content-type":"application/x-www-form-urlencoded"},body:stream,duplex:"half",signal:controller.signal}));
  controller.abort();response=await pending;ok(response.status>=400);equal(cancelled,1);
  const before=f.counts().opens;
  for(const body of ["csrf="+csrf+"&email="+"x".repeat(8192),new Uint8Array([255,254])]) {
    response=await f.handler(post("login",{}, {body,headers:{"content-type":"application/x-www-form-urlencoded"}}));ok(response.status>=400);
  }
  equal(f.counts().opens,before);
  response=await f.handler(post("logout"));privacy(response);equal(response.headers.getSetCookie().length,2);ok(response.headers.getSetCookie().every(v=>v.includes("Max-Age=0")));
  equal(JSON.parse(fs.readFileSync(path.join(root,"vercel.json"),"utf8")).git.deploymentEnabled["codex/square-gcp-sandbox-callback"],false);
  const main=fs.readFileSync(path.join(root,"services/square-sandbox-callback/src/server.ts"),"utf8");
  ok(main.includes("maxHeaderSize: 16_384"));ok(main.includes("active >= 2"));ok(!main.includes("console."));
  ok(!/localStorage|sessionStorage|sendBeacon|serviceWorker|analytics|history\.pushState/.test(PORTAL_SCRIPT));
  const logged=[];const log=console.error;console.error=()=>logged.push("sdk_error_log");
  try {await authTests();} finally {console.error=log;}
  equal(logged,[],"all SDK failure paths remain silent; no global production logger patch");
  const detecting=value=>String(value).includes(canary);
  equal(detecting("deliberately unsafe synthetic log: "+canary),true,"positive control proves privacy detector works");
  equal(detecting(await response.text()),false);
}
async function startupTrustTests() {
  // Exercise the actual command before its first filesystem read. No real
  // configuration/certificate is opened, and no environment value is reported.
  const original={env:process.env,argv:process.argv,execArgv:process.execArgv,lstat:fs.lstatSync};
  let reads=0;
  try {
    process.argv=[process.execPath,"synthetic-entry","--preflight","--config","/etc/vaeroex-square-callback/config.json"];
    process.execArgv=["--conditions=react-server"];
    fs.lstatSync=()=>{reads++;throw new Error("synthetic_config_read");};
    for(const name of ["NODE_EXTRA_CA_CERTS","NODE_TLS_REJECT_UNAUTHORIZED","NODE_USE_SYSTEM_CA","SSL_CERT_FILE","SSL_CERT_DIR",
      "NODE_USE_ENV_PROXY","HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy","OPENSSL_CONF","SQUARE_SANDBOX_DATABASE_CA_PEM"]) {
      process.env={[name]:name==="NODE_TLS_REJECT_UNAUTHORIZED"?"0":"synthetic_only"};
      assertions++;await assert.rejects(runSquareSandboxPortalCommand(),/^Error: square_portal_startup_denied$/);
      equal(reads,0,"ambient TLS trust override rejects before config or network");
    }
    process.env={};
    for(const option of ["--use-system-ca","--use-openssl-ca","--use-env-proxy","--openssl-config=synthetic","--inspect","--import=synthetic"]) {
      process.execArgv=[option];
      assertions++;await assert.rejects(runSquareSandboxPortalCommand(),/^Error: square_portal_startup_denied$/);
      equal(reads,0,"CLI trust override rejects before config or network");
    }
    process.execArgv=["--conditions=react-server"];
    assertions++;await assert.rejects(runSquareSandboxPortalCommand(),/^Error: synthetic_config_read$/);
    equal(reads,1,"clean positive control reaches the intercepted configuration read");
  } finally {
    process.env=original.env;process.argv=original.argv;process.execArgv=original.execArgv;fs.lstatSync=original.lstat;
  }
}
async function authTests() {
  const calls=[];const signal=new AbortController().signal;
  const user={id:uuid(1),aud:"authenticated",role:"authenticated",email:"synthetic@example.invalid",created_at:"2026-01-01T00:00:00Z",app_metadata:{},user_metadata:{}};
  const network=async(url,init)=>{const value=new URL(url);equal(value.origin,`https://${constants.projectRef}.supabase.co`);calls.push(value.pathname+value.search);
    equal(init.redirect,"manual");equal(init.cache,"no-store");equal(init.credentials,"omit");
    if(value.pathname.endsWith("/token"))return new Response(JSON.stringify({access_token:jwt,refresh_token:canary,token_type:"bearer",expires_in:3600,user}));
    if(value.pathname.endsWith("/user"))return new Response(JSON.stringify(user));
    if(value.pathname.endsWith("/logout"))return new Response(null,{status:204});
    assert.fail("unexpected synthetic Auth endpoint");};
  const auth=createSquarePortalAuth({binding,publishableKey:"sb_publishable_synthetic_only",network,signal});
  equal(await auth.login("synthetic@example.invalid",canary),jwt);equal(await auth.authenticate(jwt),actor);await auth.logout(jwt);
  ok(calls.includes("/auth/v1/logout?scope=local"));ok(!calls.some(v=>v.includes("refresh_token")));
  for(const response of [()=>new Response(canary,{status:401}),()=>new Response(null,{status:302,headers:{location:"https://evil.invalid"}}),
    ()=>new Response("x".repeat(131073))]) {
    const bad=createSquarePortalAuth({binding,publishableKey:"sb_publishable_synthetic_only",network:async()=>response(),signal});
    await rejects(()=>bad.login("synthetic@example.invalid",canary));equal(await bad.authenticate(jwt),null);
  }
}
async function browser() {
  const {chromium}=require("playwright");
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),"square-portal-synthetic-tls-"));
  fs.writeFileSync(path.join(owned,"openssl.cnf"),"[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=synthetic-square-portal.invalid\n[ext]\nsubjectAltName=DNS:square-sandbox.vaeroex.com\n",{mode:0o600});
  execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-config",path.join(owned,"openssl.cnf"),"-days","1","-keyout",path.join(owned,"key.pem"),"-out",path.join(owned,"cert.pem")],{stdio:"ignore"});
  const cert=fs.readFileSync(path.join(owned,"cert.pem")),key=fs.readFileSync(path.join(owned,"key.pem"));
  const now=Date.now(),x509=new X509Certificate(cert);
  equal(checkedPortalTls(cert,key,now+3600000).cert,cert);
  for(const [until,at] of [[now-1,now],[Date.parse(x509.validTo)+1,now],[Date.parse(x509.validTo)+2000,Date.parse(x509.validTo)+1000],
    [Date.parse(x509.validFrom)+1000,Date.parse(x509.validFrom)-1000]]) { assertions++;assert.throws(()=>checkedPortalTls(cert,key,until,at)); }
  const other=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({format:"pem",type:"pkcs8"});
  assertions++;assert.throws(()=>checkedPortalTls(cert,Buffer.from(other),now+3600000));
  execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-subj","/CN=square-sandbox.vaeroex.com","-days","1","-keyout",path.join(owned,"wrong-key.pem"),"-out",path.join(owned,"wrong-cert.pem")],{stdio:"ignore"});
  assertions++;assert.throws(()=>checkedPortalTls(fs.readFileSync(path.join(owned,"wrong-cert.pem")),fs.readFileSync(path.join(owned,"wrong-key.pem")),now+3600000),"CN fallback without exact SAN is rejected");
  const f=fixture(),events=[];
  const server=https.createServer({key:fs.readFileSync(path.join(owned,"key.pem")),cert:fs.readFileSync(path.join(owned,"cert.pem")),maxHeaderSize:16384},nativePortalHandler(async req=>{
    const url=new URL(req.url);const response=await f.handler(req);privacy(response);
    events.push({action:url.pathname.startsWith("/actions/"),origin:req.headers.get("origin")===origin,referrer:req.headers.has("referer"),site:req.headers.get("sec-fetch-site"),status:response.status});return response;
  }));
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const port=server.address().port;
  const browser=await chromium.launch({headless:true,args:[`--host-resolver-rules=MAP square-sandbox.vaeroex.com 127.0.0.1:${port}`,"--no-proxy-server"],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:"block",acceptDownloads:false});
  try {
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin) { equal(url.origin,constants.providerOrigin);equal(url.pathname,"/oauth2/authorize");
        // Synthetic provider navigation is intercepted locally; no Square traffic.
        await route.fulfill({status:302,headers:{location:origin+CALLBACK_PATH+`?state=${state}&code=${canary}`,"cache-control":"no-store","referrer-policy":"no-referrer"}});return; }
      // Continue to the loopback TLS server using Chromium's explicit resolver
      // rule. This observes actual wire Origin/Sec-Fetch-Site; interception alone
      // occurs before Chromium adds Fetch Metadata and cannot prove that gate.
      await route.continue();
    });
    const page=await context.newPage();const errors=[];page.on("pageerror",()=>errors.push("page_error"));page.on("console",msg=>{if(msg.type()==="error")errors.push("console_error");});
    await page.goto(origin+PORTAL_PATH);await page.getByLabel("Sandbox operator email").fill("synthetic@example.invalid");await page.getByLabel("Password").fill(canary);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();try { await page.getByRole("heading",{name:"Consent only"}).waitFor({timeout:5000}); }
    catch { throw new Error(JSON.stringify({events,errors,counts:f.counts()})); }
    const sessionCookies=await context.cookies();ok(sessionCookies.every(c=>c.secure&&c.httpOnly&&c.expires===-1&&c.domain==="square-sandbox.vaeroex.com"));
    await page.getByRole("button",{name:"Connect a Sandbox seller",exact:true}).click();await page.getByText("authorized_unmapped — consent verified; no mapping or ingestion",{exact:true}).waitFor();
    equal(page.url(),origin+PORTAL_PATH);equal(f.counts().consent,1);ok(!(await page.content()).includes(canary));
    equal(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,referrer:document.referrer})),{local:0,session:0,referrer:""});
    ok(events.filter(e=>e.action).every(e=>e.origin&&!e.referrer));ok(events.every(e=>!e.referrer));equal(errors,[]);
    await page.getByRole("button",{name:"Disconnect this connection locally",exact:true}).click();await page.getByText(/Locally disconnected/).waitFor();
    await page.getByRole("button",{name:"Sign out of this Sandbox session",exact:true}).click();await page.getByRole("button",{name:"Sign in",exact:true}).waitFor();
    equal((await context.cookies()).some(c=>c.name===SESSION_COOKIE),false);equal(f.counts().opens,f.counts().closes);
  } finally {await context.clearCookies();await context.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    // Remove only the two generated disposable TLS fixtures and owned empty dir.
    for(const name of ["key.pem","cert.pem","wrong-key.pem","wrong-cert.pem","openssl.cnf"])fs.unlinkSync(path.join(owned,name));fs.rmdirSync(owned);}
}
async function admission() {
  let calls=0,release;const barrier=new Promise(resolve=>{release=resolve;});
  const run=async(handle,test)=>{
    const server=http.createServer(nativePortalHandler(handle));
    await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const send=(route="/synthetic-only")=>new Promise((resolve,reject)=>{
      const req=http.request({hostname:"127.0.0.1",port:server.address().port,path:route,method:"GET",agent:false,headers:{host:"square-sandbox.vaeroex.com"}},res=>{
        const parts=[];res.on("data",part=>parts.push(part));res.once("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString()}));
      });req.once("error",reject);req.end();
    });
    try {await test(send);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
  await run(async()=>{calls++;await barrier;return new Response("synthetic-clean");},async send=>{
    const first=send(),second=send();const until=Date.now()+5000;
    while(calls<2){if(Date.now()>until)throw new Error("synthetic_concurrency_timeout");await new Promise(resolve=>setTimeout(resolve,1));}
    const third=await send(CALLBACK_PATH+`?state=${state}&code=${canary}`);
    equal(third.status,303);equal(third.headers.location,PORTAL_PATH);equal(third.headers["cache-control"],"no-store");equal(third.body,"");equal(calls,2,"third outstanding request never reaches runtime");
    release();equal((await first).status,200);equal((await second).status,200);
  });
  calls=0;
  await run(async()=>{calls++;return new Response("synthetic-clean");},async send=>{
    for(let i=0;i<12;i++)equal((await send()).status,200);
    equal((await send()).status,503);equal(calls,12,"burst exhaustion rejects before handler/secret/DB");
    const callback=await send(CALLBACK_PATH+`?state=${state}&code=${canary}`);equal(callback.status,303);equal(callback.headers.location,PORTAL_PATH);equal(callback.body,"");
  });
}
(async()=>{await local();if(process.argv.includes("--browser")){await browser();await admission();}process.stdout.write(JSON.stringify({suite:"square_gcp_portal_local_synthetic",assertions,browser:process.argv.includes("--browser"),hostedQualification:false})+"\n");})().catch(error=>{process.stderr.write("square_gcp_portal_synthetic_failed: "+String(error.message).replaceAll(canary,"[synthetic redacted]")+"\n");process.exitCode=1;});
