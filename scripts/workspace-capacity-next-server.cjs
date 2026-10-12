/* eslint-disable @typescript-eslint/no-require-imports -- Local production-build HTTP listener behind an owned TLS proxy. */
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const next=require('next');
const [runtimeFile,role]=process.argv.slice(2),cfg=JSON.parse(fs.readFileSync(runtimeFile));
assert(cfg.syntheticOnly&&cfg.paidCredentialsPresent===false&&['application','worker'].includes(role));
const publicUrl=new URL(cfg.appOrigin);assert.equal(publicUrl.protocol,'https:');assert.equal(publicUrl.hostname,'127.0.0.1');
// Next uses hostname/port to construct NextRequest.url. They describe the public
// request authority, while listen() binds the private backend. The TLS proxy
// overwrites forwarded host/protocol; the existing application origin checks
// still compare URL, Host, Origin and forwarded headers independently.
const app=next({dev:false,dir:path.resolve(__dirname,'..'),hostname:publicUrl.hostname,port:Number(publicUrl.port)});
(async()=>{await app.prepare();const handle=app.getRequestHandler();const server=http.createServer((req,res)=>handle(req,res));server.listen(role==='worker'?cfg.workerPort:cfg.appPort,'127.0.0.1',()=>console.log(JSON.stringify({productionBackendReady:true,role,publicOrigin:publicUrl.origin,pid:process.pid})));process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});})().catch(()=>{console.error('isolated_backend_start_failed');process.exitCode=1;});
