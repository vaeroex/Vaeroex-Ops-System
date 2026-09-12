import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import tls from 'node:tls';
import { createFront, HOST, permitted } from './boundary.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(),'square-host-test-'));
let front, upstream;
try {
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${dir}/key`,'-out',`${dir}/cert`,'-days','1','-subj',`/CN=${HOST}`,'-addext',`subjectAltName=DNS:${HOST}`],{stdio:'ignore'});
  const cert=await readFile(`${dir}/cert`), key=await readFile(`${dir}/key`);
  let calls=0;
  upstream=http.createServer((req,res)=>{assert(permitted(req,true));calls++;res.end('approved');});
  await new Promise(resolve=>upstream.listen(`${dir}/upstream`,resolve)); await chmod(`${dir}/upstream`,0o600);
  front=createFront({key,cert,socketPath:`${dir}/upstream`,deadline:Date.now()+60000});
  await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));
  const port=front.address().port;
  const send=(raw,sni=HOST)=>new Promise(resolve=>{
    let result='';
    const socket=tls.connect({host:'127.0.0.1',port,servername:sni,ca:cert,rejectUnauthorized:true},()=>socket.write(raw));
    socket.setTimeout(3000,()=>socket.destroy());
    socket.on('data',chunk=>{result+=chunk;}); socket.on('error',()=>{});socket.on('close',()=>resolve(result));
  });
  const raw=(target='/evidence',extra='',host=HOST,method='GET')=>`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${extra}\r\n`;
  assert.match(await send(raw()),/200 OK/); assert.equal(calls,1);
  for(const target of ['/%65vidence','/a/../evidence','/evidence?x=1','//evidence','/_next/static/a.js','/admin','/.env','/api/integrations/square/callback']) assert.doesNotMatch(await send(raw(target)),/200 OK/);
  for(const header of ['Host: other.example\r\n','X-Forwarded-Host: '+HOST+'\r\n','X-Forwarded-Proto: https\r\n','Forwarded: proto=https\r\n','Next-Action: arbitrary\r\n','RSC: 1\r\n','Transfer-Encoding: chunked\r\n']) assert.doesNotMatch(await send(raw('/evidence',header)),/200 OK/);
  for(const host of ['127.0.0.1','localhost','preview.vercel.app','vaeroex.com',HOST+':443']) assert.doesNotMatch(await send(raw('/evidence','',host)),/200 OK/);
  for(const method of ['HEAD','OPTIONS','POST','TRACE','DELETE']) assert.doesNotMatch(await send(raw('/evidence','',HOST,method)),/200 OK/);
  assert.doesNotMatch(await send(raw(),'other.example'),/200 OK/);
  assert.doesNotMatch(await send(raw(),''),/200 OK/);
  assert.equal(calls,1,'all rejected wire requests stop before upstream/database');
  // Browser-generated signout form has no successful controls: an empty body.
  assert.match(await send(raw('/signout',`Origin: https://${HOST}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 0\r\n`,HOST,'POST')),/200 OK/);
  assert.equal(calls,2,'empty signout reaches the handler');
  for (const route of ['/session','/workspace']) assert.doesNotMatch(await send(raw(route,`Origin: https://${HOST}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 0\r\n`,HOST,'POST')),/200 OK/);
  assert.equal(calls,2);
  // Actual Fetch-standard no-referrer navigation shape, with only public data.
  const form=(route,site='same-origin',mode='navigate',dest='document')=>raw(route,`Origin: null\r\nSec-Fetch-Site: ${site}\r\nSec-Fetch-Mode: ${mode}\r\nSec-Fetch-Dest: ${dest}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ${route==='/signout'?0:3}\r\n`,HOST,'POST')+(route==='/signout'?'':'x=1');
  for(const route of ['/session','/workspace','/signout']) assert.match(await send(form(route)),/200 OK/);
  assert.equal(calls,5,'same-origin opaque forms are normalized for checked private upstream');
  for(const route of ['/session','/workspace','/signout']) {
    for(const site of ['same-site','cross-site','none','']) assert.doesNotMatch(await send(form(route,site)),/200 OK/);
    assert.doesNotMatch(await send(form(route,'same-origin','cors')),/200 OK/);
    assert.doesNotMatch(await send(form(route,'same-origin','navigate','iframe')),/200 OK/);
  }
  assert.equal(calls,5,'unproven opaque forms stop before upstream/database');
  assert.equal(typeof upstream.address(),'string','upstream has no TCP listener');
  console.log('square_workspace_host_tls_wire_passed');
} finally {
  front?.closeAllConnections(); upstream?.closeAllConnections();
  await Promise.all([front,upstream].filter(Boolean).map(s=>new Promise(r=>s.close(r))));
  await rm(dir,{recursive:true,force:true});
}
