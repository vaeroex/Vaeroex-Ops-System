/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
// Build-process guard only. Never replaces a response or relaxes application checks.
// Full compilation must fail if it unexpectedly needs an external data service.
const http=require('node:http'),https=require('node:https'),net=require('node:net');
const blocked=()=>{const error=new Error('Release build outbound transport is disabled.');error.code='RELEASE_BUILD_NETWORK_DISABLED';throw error;};
globalThis.fetch=blocked;
http.request=blocked;http.get=blocked;https.request=blocked;https.get=blocked;
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 // net.connect/createConnection hand Socket.connect their normalized args array.
 // Unwrap it before looking at host; an array itself has no .host property.
 let values=args;while(Array.isArray(values[0]))values=values[0];
 const options=typeof values[0]==='object'?values[0]:typeof values[0]==='number'?{port:values[0],host:typeof values[1]==='string'?values[1]:'localhost'}:{path:values[0]};
 if(options.path)return connect.apply(this,args);
 const host=options.host??options.hostname??'localhost';
 if(!['localhost','127.0.0.1','::1'].includes(host))return blocked();
 return connect.apply(this,args);
};
