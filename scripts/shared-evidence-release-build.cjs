/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
// Uses the current installed Node/Next only; never installs, downloads or deploys.
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of fs.readdirSync(root))assert(!/^\.env(?:\.(?:local|production(?:\.local)?))?$/.test(file),'Build requires a checkout without environment files.');
const args=process.argv.slice(2);assert.deepEqual(args,args[0]==='--check'?['--check']:[]);
const env={PATH:process.env.PATH||'/usr/bin:/bin',NODE_ENV:'production',CI:'1',NEXT_TELEMETRY_DISABLED:'1',
 NODE_OPTIONS:'--require='+path.join(root,'scripts/shared-evidence-release-build-offline.cjs')};
if(args[0]==='--check'){
 const result=spawnSync(process.execPath,['scripts/shared-evidence-release-build-guard-tests.cjs'],{cwd:root,env:{...env,NODE_OPTIONS:''},encoding:'utf8'});
 assert.equal(result.status,0);console.log('Release build uses an empty service environment and rejects outbound transport; no build or service call executed.');
}else{
 const result=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env,stdio:'inherit'});
 if(result.error){console.error('Release build process could not start.');process.exitCode=1;}else process.exitCode=result.status??1;
}
