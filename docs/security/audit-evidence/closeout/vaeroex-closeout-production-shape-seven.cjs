/* Explicit production migration-shape rehearsal; own database inside owned second local stack. */
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {runAdditionalQualification}=require('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/scripts/run-square-durable-page-qualification.js');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const reviewed=require('./vaeroex-closeout-rollout-rehearsal-seven.cjs');
const existing=require(root+'/scripts/run-qbo-production-candidate-database-tests.cjs');
const report=reviewed.report;report.scope='Explicit 104 canonical-prefix +4 Square +7 QBO +2 Sheets +3 dashboard +7 audit/closeout shape. Native PostgreSQL in a new owned Unix-only cluster; reduced platform prerequisite fixture in a fresh database. No Auth HTTP, provider calls or production-volume/17.6 equivalence.';
process.env.SQUARE_QUALIFICATION_PG_BIN='/private/tmp/vaeroex-closeout-supabase-home/cache/stack/slim-services/postgres/17.11.0.002-r0/darwin-arm64/bin';
const prefix=fs.readdirSync(root+'/supabase/migrations').filter(n=>n.split('_')[0]<='20260902191325').sort();assert.equal(prefix.length,104);
const square=['20260925032300_square_production_customer_connection.sql','20260929004917_square_customer_service_backend.sql','20260929041048_square_customer_payment_history.sql','20260929052211_square_customer_payment_browse.sql'];
const sheets=['20261002040024_google_sheets_complete.sql','20261002040031_google_sheets_lifecycle.sql'];
const capture=(dir,n)=>{const sql=fs.readFileSync(path.join(dir,n),'utf8');return{name:n,sql,sha256:reviewed.sha(sql)}};
const before=prefix.map(n=>capture(root+'/supabase/migrations',n));
const prod=n=>capture(root+'/supabase/production-migrations',n);
const squareInputs=square.map(prod),qbo=existing.candidates.map(prod),sheetInputs=sheets.map(prod),dashboard=Object.values(existing.dashboardMigrations).map(prod);
report.migrationManifest=[...before,...squareInputs,...qbo,...sheetInputs,...dashboard].map(({name,sha256})=>({name,sha256}));
let stage='owned_database';
(async()=>{try{
 await runAdditionalQualification(async runtime=>{
 const db=await runtime.createDatabase('closeout_prod'),c=db.client;
 const directory=path.dirname(db.connection.host);report.nativeDirectory=directory;
 const fixture=fs.readFileSync(root+'/supabase/tests/fixtures/square-durable-platform.sql','utf8');report.platformFixtureSha256=reviewed.sha(fixture);
 await c.query('create extension if not exists pg_stat_statements with schema extensions;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key)');
 const ledger=[];
 async function apply(i){stage=i.name;await c.query(i.sql);const version=i.name.split('_')[0];await c.query('insert into supabase_migrations.schema_migrations values($1)',[version]);ledger.push(version);assert.deepEqual((await c.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version),[...ledger].sort());}
 for(const i of [...before,...squareInputs])await apply(i);
 const squareBefore=await existing.squareCatalog(c);for(const i of qbo)await apply(i);assert.equal(await existing.squareCatalog(c),squareBefore);report.qboOnlySquareCatalogPreserved=true;report.squareCatalogSha256=squareBefore;
 for(const i of [...sheetInputs,...dashboard])await apply(i);assert.equal(ledger.length,120);report.baselineMigrationCount=ledger.length;
 existing.assertProductionBaselineLedger(ledger);stage='targeted_rollout_checks';await reviewed.qualifies(c,'explicit-production-migration-shape',directory);
 // The targeted rehearsal applies the seven tail SQL files unchanged. Record exact ledger too.
 for(const n of reviewed.tail){await c.query('insert into supabase_migrations.schema_migrations values($1)',[n.split('_')[0]]);ledger.push(n.split('_')[0]);}
 report.finalLedger=(await c.query('select version from supabase_migrations.schema_migrations order by version')).rows.map(x=>x.version);assert.deepEqual(report.finalLedger,[...ledger].sort());assert.equal(report.finalLedger.length,127);report.passed=true;
 console.log(JSON.stringify({passed:true,baselineMigrations:120,tailMigrations:7,checks:report.runs[0].checks.length,qboOnlySquareCatalogPreserved:true}));
 });report.ownedClusterStopped=!fs.existsSync(path.join(report.nativeDirectory,'data/postmaster.pid'));
}catch(e){report.passed=false;report.failure={stage,code:e.code||'assertion',message:e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[local-dsn]')};console.error(JSON.stringify(report.failure));process.exitCode=1;
}finally{fs.writeFileSync('/tmp/vaeroex-closeout-production-shape-seven-results.json',JSON.stringify(report,null,2)+'\n')}})();
