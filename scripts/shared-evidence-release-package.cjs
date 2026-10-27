/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
// Offline package assembly. Never connects, applies SQL, changes a gate or runs CI.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const sourceTree='e62e49fae283e682c929223738eb29faf79c3a2c';
const sourceCommit='2cf0ca71e43b723adc382a19591e19169b53e164';
const sources=[
 '01-legacy-evidence.sql','02-owner-artifact-boundary.sql','03-generation-manifest-schema.sql',
 '05-manifest-admission.sql','06-typed-source-admission.sql','07-reopen-shared-artifact.sql',
 '08-sheets-projection.sql','09-katana-installation-boundary.sql','10-memory-semantic-receipts.sql',
 '11-generation-discovery.sql','12-workspace-writer-fence.sql','13-vsi-failure-accounting.sql'
];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function assemble(){
 const parts=[],files=[];
 for(const name of sources){
  const file='docs/security-drafts/'+name;const text=fs.readFileSync(path.join(root,file),'utf8');
  const begins=[...text.matchAll(/^begin;\s*$/gmi)],commits=[...text.matchAll(/^commit;\s*$/gmi)];
  assert.equal(begins.length,1,'exact outer BEGIN required: '+name);assert.equal(commits.length,1,'exact outer COMMIT required: '+name);
  assert(begins[0].index<commits[0].index);
  // Retain all function bodies and trailing rollout comments exactly.
  const body=text.slice(0,begins[0].index)+text.slice(begins[0].index+begins[0][0].length,commits[0].index)+text.slice(commits[0].index+commits[0][0].length);
  parts.push(`-- SOURCE: ${file}\n${body.trim()}\n`);files.push({path:file,sha256:sha(text)});
 }
 for(const file of ['lib/ai/shared-evidence/runtime-gate.ts','lib/vsi/failure-accounting-gate.ts']){
  assert.match(fs.readFileSync(path.join(root,file),'utf8'),/return false;/,'runtime gate must remain false');
 }
 const writerLocks=['public.ai_agent_runs','public.reporting_connections','public.reporting_credentials','public.reports','public.vsi_exchanges'];
 const sql=`-- INACTIVE REVIEW PACKAGE. Do not apply without exact release approval.\n-- Qualified application base ${sourceCommit}; tree ${sourceTree}. SQL below includes local reviewed mapping changes.\n-- Bootstrap fixture/install package only; an existing deployment needs the separate mapping-upgrade delta.\n-- Atomic forward install; pause procedure 04 is intentionally EXCLUDED.\n-- Locks precede audience/installation backfills and remain held through trigger installation.\n-- Quiesce reporting/Katana and artifact writers before this bounded table-lock window.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\nlock table ${writerLocks.join(',')} in share row exclusive mode;\n\n${parts.join('\n')}\ncommit;\n`;
 const pauseSource=fs.readFileSync(path.join(root,'docs/security-drafts/04-pause-new-readers.sql'),'utf8');
 const pauseSql=pauseSource.replace(/^commit;\s*$/mi,`-- Later discovery/preview entry points also stop admitting new contexts.\nrevoke execute on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),\n public.discover_shared_evidence_v1(uuid,date,date),\n public.discover_shared_evidence_v2(uuid,date,date,text[]),\n public.shared_evidence_dependencies_v1(uuid,uuid) from authenticated;\ncommit;\n`);
 return {sql,pauseSql,manifest:{version:1,status:'inactive_local_release_package',qualifiedBase:sourceCommit,qualifiedBaseTree:sourceTree,bootstrapOnly:true,existingDeploymentUpgrade:'docs/security-drafts/mapping-upgrade/forward.sql',excluded:['04-pause-new-readers.sql'],atomic:true,preBackfillWriterLocks:writerLocks,files,forwardSha256:sha(sql),pauseSourceSha256:sha(pauseSource),pauseSha256:sha(pauseSql),runtimeEnabled:false}};
}
function main(args=process.argv.slice(2)){
 assert.deepEqual(args,args[0]==='--write'?['--write']:['--check'],'use --write or --check');
 const value=assemble(),folder=path.join(root,'docs/security-drafts/release');
 if(args[0]==='--write'){fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'forward.sql'),value.sql);fs.writeFileSync(path.join(folder,'pause.sql'),value.pauseSql);fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(value.manifest,null,2)+'\n');}
 else {assert.equal(fs.readFileSync(path.join(folder,'forward.sql'),'utf8'),value.sql);assert.equal(fs.readFileSync(path.join(folder,'pause.sql'),'utf8'),value.pauseSql);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),value.manifest);}
 console.log(JSON.stringify({status:'package_verified',forwardSha256:value.manifest.forwardSha256,drafts:sources.length,pauseExcluded:true,atomic:true,runtimeEnabled:false,applied:false}));
}
if(require.main===module)main();module.exports={assemble,sources,main};
