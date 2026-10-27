/* eslint-disable @typescript-eslint/no-require-imports -- Inactive SQL source assembly; never connects to a database. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'docs/security-drafts/mapping-upgrade');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function extract(file,name){
 const text=fs.readFileSync(path.join(root,file),'utf8'),marker=`create function ${name}(`,start=text.indexOf(marker);
 assert(start>=0&&text.indexOf(marker,start+1)<0,'exactly one source function');
 const body=text.indexOf('as $$',start),end=text.indexOf('$$;',body+5);assert(body>start&&end>body,'complete fixed function body');
 return{text:text.slice(start,end+3),source:file,sourceSha256:sha(text)};
}
function assemble(){
 const names=['private.resolve_legacy_evidence_v1','public.discover_shared_evidence_v2','public.discover_shared_evidence_v1'];
 const definitions=names.map((name,i)=>extract(`docs/security-drafts/${i?'11-generation-discovery.sql':'01-legacy-evidence.sql'}`,name));
 const sql=`-- INACTIVE incremental mapping upgrade. Not executed by this assembler.\n-- Existing protected evidence schema must already be installed. No bootstrap replay.\n-- No table/data/source/credential updates, no change to runtime switches.\n-- Loyverse's newly projected currency changes its content hash; old references fail closed as changed.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\n\n${definitions.map(d=>d.text.replace(/^create function /,'create or replace function ')).join('\n\n')}\n\n-- Same owner-only authority inside the new RPC; no PUBLIC/anon/service access.\nrevoke all on function public.discover_shared_evidence_v2(uuid,date,date,text[]) from public,anon,authenticated,service_role;\ngrant execute on function public.discover_shared_evidence_v2(uuid,date,date,text[]) to authenticated;\ncommit;\n`;
 return{sql,manifest:{status:'inactive_local_review_only',functions:names,sources:definitions.map(({source,sourceSha256})=>({source,sha256:sourceSha256})),forwardSha256:sha(sql),applied:false,dataMutations:false,newPublicRpc:'discover_shared_evidence_v2',callers:'authenticated with existing owner/live-session checks',requiresSeparateHostedApproval:true}};
}
function main(args=process.argv.slice(2)){
 assert(args.length===1&&['--write','--check'].includes(args[0]));const result=assemble();
 if(args[0]==='--write'){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'forward.sql'),result.sql);fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(result.manifest,null,2)+'\n');}
 else {assert.equal(fs.readFileSync(path.join(directory,'forward.sql'),'utf8'),result.sql);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8')),result.manifest);}
 console.log(JSON.stringify(result.manifest));
}
module.exports={assemble};if(require.main===module)main();
