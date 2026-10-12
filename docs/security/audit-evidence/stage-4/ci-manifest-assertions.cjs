const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const names=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
const files=['run-square-account-connection-qualification.js','run-square-remote-sandbox-qualification.js','run-square-broker-runtime-qualification.js','run-square-gcp-callback-database-qualification.js','run-square-gcp-mapped-database-qualification.js','run-square-durable-page-qualification.js','run-square-observation-database-qualification.js'];
const results=[];
for(const file of files){
 const source=fs.readFileSync(path.join(root,'scripts',file),'utf8');
 const constants=[...source.matchAll(/^const\s+(\w+)\s*=\s*("[^"]*"|\["[^;\n]*\]);/gm)].map(m=>`const ${m[1]}=${m[2]};`).join('\n');
 let body;
 if(file.includes('durable-page'))body=source.slice(source.indexOf('  const files = migrationFiles(), baseline'),source.indexOf('  const clean = await createDatabase'));
 else if(file.includes('observation'))body=source.slice(source.indexOf('  const files=runtime.migrationFiles();'),source.indexOf('  stage="migrations";'));
 else body=source.match(/equal\((?:files|names)\.filter\(name => name >= \w+\), \[[\s\S]*?\],\s*"[^"]*"\);/)[0];
 const run=(migrationNames)=>{
  const equal=(a,b,label)=>assert.equal(JSON.stringify(a),JSON.stringify(b),label);
  const code=constants+'\n'+(body.startsWith('equal')?'const files=runtime.migrationFiles(), names=files;\n':'')+body;
  vm.runInNewContext(code,{runtime:{migrationFiles:()=>migrationNames},migrationFiles:()=>migrationNames,equal,eq:equal});
 };
 let current,error;try{run(names);current='pass';}catch(e){current='fail';error={name:e.name,message:e.message.split('\n')[0]};}
 let unexpectedRejected=false;try{run([...names,'29990101000000_unreviewed.sql']);}catch(e){unexpectedRejected=true;}
 results.push({file,currentManifest:current,error,unexpectedMigrationRejected:unexpectedRejected});
}
{
 const source=fs.readFileSync(path.join(root,'scripts/run-qbo-production-candidate-database-tests.cjs'),'utf8');
 const checks=source.slice(source.indexOf('  assert.equal(canonical.length,'),source.indexOf("  assert.equal(prefix.length,"));
 const evaluate=names=>vm.runInNewContext(checks,{assert:{equal:assert.equal,deepEqual:(a,b,label)=>assert.equal(JSON.stringify(a),JSON.stringify(b),label)},path,canonical:names.map(file=>({file,version:file.slice(0,14)}))});
 let error,current='pass';try{evaluate(names);}catch(e){current='fail';error=e.message;}
 let rejected=false;try{evaluate([...names,'29990101000000_unreviewed.sql']);}catch{rejected=true;}
 results.push({file:'run-qbo-production-candidate-database-tests.cjs',currentManifest:current,error,unexpectedMigrationRejected:rejected});
}
console.log(JSON.stringify({scope:'Actual source manifest assertions evaluated without DB/provider calls; no full Square qualification claim',migrationCount:names.length,results},null,2));
