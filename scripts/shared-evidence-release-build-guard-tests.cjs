/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
// Intercept the original socket implementation BEFORE loading the guard. A bug
// records delegation and fails; it cannot open a socket or resolve an address.
const assert=require('node:assert/strict');
const net=require('node:net'),tls=require('node:tls'),http=require('node:http'),https=require('node:https');
let delegated=0;
net.Socket.prototype.connect=function(){delegated++;return this;};
require('./shared-evidence-release-build-offline.cjs');
const external='example.invalid';
const calls=[
 ()=>fetch('https://'+external),()=>http.get('http://'+external),()=>https.request('https://'+external),
 ()=>net.connect({host:external,port:443}),()=>net.createConnection(443,external),
 ()=>new net.Socket().connect({host:external,port:443}),
 ()=>new net.Socket().connect([{host:external,port:443},()=>{}]),
 ()=>tls.connect({host:external,port:443}),()=>tls.connect(443,external)
];
for(const call of calls)assert.throws(call,e=>e.code==='RELEASE_BUILD_NETWORK_DISABLED');
assert.equal(delegated,0,'No external entry point delegates to the original socket');
const local=net.connect({host:'127.0.0.1',port:1});assert.equal(delegated,1);local.destroy();
console.log('Nine external fetch/HTTP/socket/TLS entry points denied before transport; loopback dispatch retained. All original transport calls were recording stubs.');
