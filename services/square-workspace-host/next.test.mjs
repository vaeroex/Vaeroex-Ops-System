import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import next from 'next';
import {fileURLToPath} from 'node:url';
import {permitted,deny,HOST} from './boundary.mjs';
// Actual compiled Next application; no remote targets or real sessions.
Object.assign(process.env,{NODE_ENV:'production',SQUARE_EVIDENCE_HOST:'gcp-square-sandbox-workspace-v1',NEXT_PUBLIC_APP_URL:`https://${HOST}`,NEXT_PUBLIC_SUPABASE_URL:'https://oysjpoondtcrqpghhrbd.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_SYNTHETIC_NEVER_ISSUED_123456789'});
for(const key of ['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID','VERCEL_URL','VAEROEX_ADMIN_EMAILS'])delete process.env[key];
let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('synthetic_network_denied');};
const app=next({dev:false,dir:fileURLToPath(new URL('.',import.meta.url)),quiet:true});
const dir=await mkdtemp(`${tmpdir()}/square-next-test-`);
let server;
try {
 await app.prepare();const handler=app.getRequestHandler();let accepted=0;
 server=http.createServer((req,res)=>{if(!permitted(req,true))return deny(res);accepted++;handler(req,res);});
 await new Promise(resolve=>server.listen(`${dir}/upstream`,resolve));
 const get=(path)=>new Promise((resolve,reject)=>{const req=http.get({socketPath:`${dir}/upstream`,path,headers:{host:HOST,'x-forwarded-host':HOST,'x-forwarded-proto':'https'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);});
 const signin=await get('/signin');assert.equal(signin.status,200);assert.match(signin.body,/Private portal sign-in/);assert(!/<script|src=|_next/.test(signin.body));
 for(const p of ['/admin','/_next/static/test.js','/api/test','/evidence?x=1'])assert.equal((await get(p)).status,404);
 assert.equal(accepted,1);assert.equal(outbound,0);
 console.log('square_workspace_host_compiled_next_passed');
} finally {server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await app.close();await rm(dir,{recursive:true,force:true});}
