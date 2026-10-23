// Synthetic dependency fixture. Executes real draft12, not deployed schema parity.
import assert from 'node:assert/strict';
import {read,admin} from './shared-evidence-sql-fixture.mjs';
export const fenceSql=read('docs/security-drafts/12-workspace-writer-fence.sql');
export const fenceRelations=[...fenceSql.matchAll(/^  '((?:public|private|square_customer_private)\.[a-z_]+)'[,]?$/gm)].map(m=>m[1]);
// Exact reviewed omissions. A newly missing relation is an error, never auto-stubbed.
export const placeholderRelations=[
 'private.file_import_attempts','private.google_sheets_connection_root_links','private.google_sheets_derivation_roots',
 'private.google_sheets_retention_roots','private.google_sheets_source_root_links','public.business_health_snapshots',
 'public.intelligence_card_lifecycle','public.intelligence_card_lifecycle_events','public.file_processing_jobs','public.kpi_settings',
 'public.document_extraction_cache','public.document_extraction_file_bindings','public.document_extraction_jobs',
 'public.document_extraction_reviews','public.document_extraction_workspace_settings','public.file_imports',
];
export async function installFenceFixture(db){
 await admin(db);assert.equal(fenceRelations.length,64);assert.equal(new Set(fenceRelations).size,64);
 const missing=[];for(const table of fenceRelations)if(!(await db.query('select to_regclass($1) present',[table])).rows[0].present)missing.push(table);
 assert.deepEqual(missing.toSorted(),placeholderRelations.toSorted(),'unexpected missing dependency: cannot fabricate a new fixture');
 for(const table of placeholderRelations)await db.exec(`create table ${table}(workspace_id uuid,id uuid)`);
 await db.exec(fenceSql);await verifyFenceInstallation(db);
 return {relations:fenceRelations,placeholders:placeholderRelations};
}
export async function verifyFenceInstallation(db){
 const {rows}=await db.query(`select n.nspname||'.'||c.relname relation,t.tgname name,t.tgtype::int type,t.tgenabled enabled,t.tgisinternal internal,
 t.tgfoid::regprocedure::text function,encode(t.tgargs,'hex') args from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where t.tgname in ('aaa_shared_evidence_writer_fence','shared_evidence_no_truncate')`);
 assert.equal(rows.length,128);
 for(const relation of fenceRelations){const triggers=rows.filter(r=>r.relation===relation);assert.equal(triggers.length,2);
  for(const t of triggers){assert.equal(t.enabled,'O');assert.equal(t.internal,false);
   if(t.name==='aaa_shared_evidence_writer_fence'){assert.equal(t.type,31);assert.equal(t.function,'private.shared_evidence_writer_fence_v1()');assert.equal(t.args,Buffer.from((relation==='public.workspaces'?'id':'workspace_id')+'\0').toString('hex'));}
   else{assert.equal(t.type,34);assert.equal(t.function,'private.shared_evidence_truncate_denied_v1()');assert.equal(t.args,'');}
  }
 }
}
