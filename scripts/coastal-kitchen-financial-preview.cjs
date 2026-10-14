/* eslint-disable @typescript-eslint/no-require-imports -- Loopback-only recorded qualification preview. */
const path = require('node:path');
const {build,createServer} = require('./website-demo-preview.cjs');
(async()=>{
 const result=await build({entryFile:path.join(__dirname,'website-demo/financial-entry.tsx')});
 createServer({...result,port:3206}).on('error',error=>{console.error(error.message);process.exitCode=1;}).listen(3206,'127.0.0.1',()=>console.log('Financial review: http://127.0.0.1:3206/app/si'));
})().catch(error=>{console.error(error.message);process.exitCode=1});
