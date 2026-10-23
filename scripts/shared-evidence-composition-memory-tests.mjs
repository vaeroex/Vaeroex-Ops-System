// Local-only composition against an explicit authorized metadata directory.
// Captured definitions stay outside Git. No network, providers, imports or live DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
import {read,uuid,w,other,owner,owner2,session,secondSession,admin,login,typedRead,settle,newBrief} from './shared-evidence-sql-fixture.mjs';
const directory=process.argv[2];assert.ok(directory,'Supply the authorized private capture directory.');
const captures=['functions.json','direct-bound-guards.json','bounded-helper-bodies.json'].flatMap(f=>JSON.parse(readFileSync(resolve(directory,f),'utf8')));
const publicCaptures=['deployed-contracts.json','typed-source-contracts.json'].flatMap(f=>JSON.parse(read('docs/security-drafts/audit/'+f)).functions);
const actual=name=>{
 const candidates=[...captures.filter(r=>(r.name===name||r.name?.endsWith('.'+name))&&r.definition&&!r.definition_withheld).map(r=>r.definition),...publicCaptures.filter(r=>r.proname===name).map(r=>r.definition)];
 assert.ok(candidates.length,`Missing captured definition: ${name}`);return candidates[0];
};
const relations=JSON.parse(readFileSync(resolve(directory,'relations.json'),'utf8'));
const selected=['public.document_extraction_jobs','public.document_extraction_reviews','public.document_extraction_file_bindings','public.document_extraction_cache','public.document_extraction_workspace_settings','private.file_import_attempts','public.business_notes','public.business_memory_chunks'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
let assertions=0;const ok=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const deny=async p=>{await assert.rejects(p,e=>['42501','40001','22023','23514','23503'].includes(e.code));assertions++;};
const {db}=await prepareWriterCases();
try {
 await installFenceFixture(db);await admin(db);
 // Use exact captured field types. Full storage/OCR schema is deliberately not claimed.
 for(const name of selected){
  const relation=relations.find(r=>r.name===name);assert.ok(relation?.exists,name);
  const existing=new Set((await db.query('select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped',[name])).rows.map(r=>r.attname));
  for(const c of relation.columns){if(existing.has(c.name)||c.type.startsWith('vector'))continue;
   assert.match(c.type,/^[a-z0-9_ ()\[\],]+$/i);await db.exec(`alter table ${name} add column ${quote(c.name)} ${c.type}${c.default&&!c.default_withheld?' default '+c.default:''}`);
  }
 }
 await db.exec(actual('current_auth_session_live_v1'));await db.exec(actual('is_workspace_member'));
 await db.exec('alter function public.resolve_document_extraction_file_authority_v1(uuid,uuid) rename to fixture_document_authority_stub;alter function public.get_worksheet_publication_heads_v1(uuid,uuid[]) rename to fixture_publication_head_stub;');
 for(const name of ['document_extraction_google_job_identity_is_exact_v1','document_extraction_authority_is_approved_v1','resolve_document_extraction_file_authority_v1','get_worksheet_publication_heads_v1','enforce_document_extraction_authority_v1','enforce_document_extraction_job_review_provenance_v2','enforce_document_extraction_review_provenance_binding_v2','protect_business_note_evidence_boundaries','protect_business_note_lifecycle_provenance_v1','reject_direct_business_note_approval_insert_v1'])await db.exec(actual(name));
 // Repository validator: actual capture guards dispatch through this stored v1 contract.
 const sql=read('supabase/migrations/20260805011604_document_extraction_profile_bound_review_identity.sql');
 const validator=sql.match(/create or replace function public\.validate_document_extraction_critical_field_manifest_v1\([\s\S]*?\n\$\$;/i)?.[0];assert.ok(validator);
 await db.exec("create schema if not exists extensions;create function extensions.digest(v bytea,algorithm text) returns bytea language plpgsql immutable as $$begin if algorithm<>'sha256' then raise exception 'unsupported digest';end if;return sha256(v);end$$;");
 await db.exec(validator);
 await db.exec(`create trigger enforce_document_extraction_authority_v1 before insert or update on business_memory_chunks for each row execute function public.enforce_document_extraction_authority_v1();
 create trigger enforce_document_extraction_job_review_provenance_v2 before insert or update on document_extraction_jobs for each row execute function public.enforce_document_extraction_job_review_provenance_v2();
 create trigger enforce_document_extraction_review_provenance_binding_v2 before insert or update on document_extraction_reviews for each row execute function public.enforce_document_extraction_review_provenance_binding_v2();
 create trigger protect_business_note_evidence_boundaries before update on business_notes for each row execute function public.protect_business_note_evidence_boundaries();
 create trigger protect_business_note_lifecycle_provenance_v1 before insert or update on business_notes for each row execute function public.protect_business_note_lifecycle_provenance_v1();
 create trigger reject_direct_business_note_approval_insert_v1 before insert on business_notes for each row execute function private.reject_direct_business_note_approval_insert_v1();
 grant select,insert,update on business_notes,business_memory_chunks to authenticated,service_role;`);
 const file=uuid(810),job=uuid(811),review=uuid(812),chunk=uuid(813),note=uuid(814),noteChunk=uuid(815),binding=uuid(816),attempt=uuid(817);
 const fingerprint='a'.repeat(64),classification='b'.repeat(64);
 const manifest={manifest_version:'document_extraction_critical_fields_v1',artifact_fingerprint:fingerprint,extraction_contract_version:'fixture_document_v1',fields:[{id:'inventory',kind:'current_value',value_type:'number'}]};
 const manifestHash=(await db.query('select public.validate_document_extraction_critical_field_manifest_v1($1,$2,$3) hash',[JSON.stringify(manifest),fingerprint,'fixture_document_v1'])).rows[0].hash;
 await db.query('insert into file_uploads(id,workspace_id) values($1,$2)',[file,w]);
 await db.query("insert into document_extraction_jobs(id,workspace_id,file_id,cache_key,status,approval_status,review_required,artifact_fingerprint,classification_fingerprint,required_review_version,extraction_contract_version,critical_field_manifest_fingerprint,critical_field_manifest_json,document_class) values($1,$2,$3,'fixture-cache','completed','approved',true,$4,$5,1,'fixture_document_v1',$6,$7,'digital_pdf')",[job,w,file,fingerprint,classification,manifestHash,JSON.stringify(manifest)]);
 await db.query('insert into document_extraction_file_bindings(id,workspace_id,job_id,file_id,is_current,created_at) values($1,$2,$3,$4,true,now())',[binding,w,job,file]);
 await db.query("insert into document_extraction_reviews(id,workspace_id,job_id,file_id,status,review_version,extraction_contract_version,critical_field_manifest_fingerprint,artifact_fingerprint,classification_fingerprint,unresolved_field_count,rejected_field_count,critical_field_count,confirmed_field_count) values($1,$2,$3,$4,'approved',1,'fixture_document_v1',$5,$6,$7,0,0,1,1)",[review,w,job,file,manifestHash,fingerprint,classification]);
 await db.query("insert into document_extraction_cache(workspace_id,source_job_id,cache_key,artifact_fingerprint) values($1,$2,'fixture-cache',$3)",[w,job,fingerprint]);
 await db.query("insert into document_extraction_workspace_settings(workspace_id,allowed_document_classes) values($1,array['digital_pdf'])",[w]);
 await login(db);const authority=(await db.query('select public.resolve_document_extraction_file_authority_v1($1,$2) v',[w,file])).rows[0].v;ok(authority.eligible,true);ok(authority.mode,'reviewed_document_extraction');
 await deny(db.query('select public.resolve_document_extraction_file_authority_v1($1,$2)',[other,file]));
 const envelope={...authority};delete envelope.eligible;delete envelope.mode;delete envelope.reason;
 await admin(db);await db.query("insert into business_memory_chunks(id,workspace_id,source_id,source_type,source_file_id,trusted_index,source_metadata,content_hash,source_excerpt,summary,chunk_index) values($1,$2,$3,'file_analysis',$3,true,$4,$5,'Reviewed inventory observation','Inventory context',0)",[chunk,w,file,JSON.stringify({document_extraction_authority:envelope,evidence_classification:'business_evidence'}),'c'.repeat(64)]);
 await login(db);const fileEvidence=await typedRead(db,{kind:'approved_file_fact',chunk_id:chunk});ok(fileEvidence.data.authority,authority);
 await admin(db);await deny(db.query("update business_memory_chunks set source_metadata=source_metadata-'document_extraction_authority' where id=$1",[chunk]));
 await deny(db.query("update document_extraction_jobs set critical_field_manifest_fingerprint=$1 where id=$2",['d'.repeat(64),job]));
 // Approval withdrawal is an actual stored review lifecycle update, not fixture boolean.
 await db.query("update document_extraction_reviews set status='invalidated' where id=$1",[review]);await login(db);await deny(typedRead(db,{kind:'approved_file_fact',chunk_id:chunk}));
 await admin(db);await db.query("update document_extraction_reviews set status='approved' where id=$1",[review]);
 await db.query('update document_extraction_cache set invalidated_at=now() where source_job_id=$1',[job]);await login(db);await deny(typedRead(db,{kind:'approved_file_fact',chunk_id:chunk}));
 await admin(db);await db.query('update document_extraction_cache set invalidated_at=null where source_job_id=$1',[job]);
 // Native-file publication uses actual completed-at/accepted-at ordering, with tenant filter.
 await db.query("insert into private.file_import_attempts(id,workspace_id,file_id,status,accepted_at,completed_at) values($1,$2,$3,'completed',now(),now())",[attempt,w,file]);
 await db.query("update business_memory_chunks set source_metadata=source_metadata||jsonb_build_object('indexing_method','worksheet_import','import_attempt_id',$1::text) where id=$2",[attempt,chunk]);
 await login(db);await typedRead(db,{kind:'approved_file_fact',chunk_id:chunk});assertions++;
 await admin(db);await db.query("insert into private.file_import_attempts(id,workspace_id,file_id,status,accepted_at,completed_at) values($1,$2,$3,'completed',now()+interval '1 second',now()+interval '1 second')",[uuid(818),w,file]);await login(db);await deny(typedRead(db,{kind:'approved_file_fact',chunk_id:chunk}));
 await admin(db);await db.query("update business_memory_chunks set source_metadata=source_metadata-'indexing_method'-'import_attempt_id' where id=$1",[chunk]);
 // Server-only approved note fixture; direct owner approval and source edits stay denied.
 await login(db,owner,session,'service_role');
 await db.query("insert into business_notes(id,workspace_id,author_user_id,status,evidence_lifecycle_status,trusted_approval,lifecycle_provenance_id,release_channel,approved_at,approved_by,source_version,source_text_hash,original_note_text,reviewed_extraction_json,source_spans_json,user_corrections_json,extraction_json) values($1,$2,$3,'approved','active',true,$4,'production',now(),$3,1,$5,'Supplier changed','{}','[]','{}','{}')",[note,w,owner,uuid(819),'d'.repeat(64)]);
 await db.query("insert into business_memory_chunks(id,workspace_id,source_id,source_type,trusted_index,source_metadata,content_hash,source_excerpt,chunk_index) values($1,$2,$3,'business_note',true,$4,encode(sha256(convert_to(($3::uuid)::text||':1:0:Supplier changed','UTF8')),'hex'),'Supplier changed',0)",[noteChunk,w,note,JSON.stringify({source_version:1,release_channel:'production',review_status:'approved'})]);
 await login(db);await typedRead(db,{kind:'approved_note',chunk_id:noteChunk});assertions++;
 await deny(db.query("update business_notes set status='archived' where id=$1",[note]));
 await deny(db.query("insert into business_notes(id,workspace_id,status,evidence_lifecycle_status) values($1,$2,'approved','active')",[uuid(820),w]));
 await login(db,owner,session,'service_role');await deny(db.query("update business_notes set source_version=2 where id=$1",[note]));
 // Seal and settle actual file + note identities, then reopen the saved artifact.
 await login(db);const fileNow=await typedRead(db,{kind:'approved_file_fact',chunk_id:chunk}),noteNow=await typedRead(db,{kind:'approved_note',chunk_id:noteChunk});
 await login(db,owner,session,'service_role');for(const source of [fileNow,noteNow])await db.query('select public.certify_shared_memory_semantics_v1($1,$2,$3,$4)',[w,owner,session,JSON.stringify(source.identity)]);
 await admin(db);await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2',[JSON.stringify([...fileNow.data.read_sources,...noteNow.data.read_sources]),uuid(101)]);
 await login(db);const sealed=(await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[w,'vsi_request',uuid(103),uuid(101),JSON.stringify([fileNow.identity,noteNow.identity]),[]])).rows[0].v;
 await login(db,owner,session,'service_role');await settle(db,sealed.manifest_id);
 await admin(db);const saved=(await db.query("select artifact_revision from private.shared_evidence_artifact_manifests where artifact_kind='vsi_exchange' and artifact_id=$1",[uuid(103)])).rows[0];assert.ok(saved);assertions++;
 const reopen=()=>db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4) v',[w,'vsi_exchange',uuid(103),saved.artifact_revision]);
 await login(db);ok((await reopen()).rows[0].v.projections.length,2);
 await login(db,owner2,secondSession);await deny(reopen());
 await login(db,owner,session,'service_role');await db.query("update business_notes set status='archived',evidence_lifecycle_status='archived',archived_at=now() where id=$1",[note]);await login(db);await deny(reopen());
 // A newly sealed brief is rejected if its file review is invalidated before save.
 await login(db,owner,session,'service_role');await db.query("update business_notes set status='approved',evidence_lifecycle_status='active',archived_at=null where id=$1",[note]);
 await login(db);const current=await typedRead(db,{kind:'approved_file_fact',chunk_id:chunk});await login(db,owner,session,'service_role');await db.query('select public.certify_shared_memory_semantics_v1($1,$2,$3,$4)',[w,owner,session,JSON.stringify(current.identity)]);
 const run=await newBrief(db,830);const briefManifest=(await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[w,'briefing_run',run,uuid(101),JSON.stringify([current.identity]),[]])).rows[0].v;
 await admin(db);await db.query("update document_extraction_reviews set status='invalidated' where id=$1",[review]);await login(db,owner,session,'service_role');
 await deny(db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[w,run,owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:w,generationKey:'fixture-key',briefingType:'weekly'}),briefManifest.manifest_id]));
 await admin(db);ok((await db.query('select status from ai_agent_runs where id=$1',[run])).rows[0].status,'processing');
 await db.query("update document_extraction_reviews set status='approved' where id=$1",[review]);
 await login(db,owner,session,'service_role');
 ok((await db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8) v',[w,run,owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:w,generationKey:'fixture-key',briefingType:'weekly'}),briefManifest.manifest_id])).rows[0].v,run);
 await admin(db);const briefRevision=(await db.query("select artifact_revision from private.shared_evidence_artifact_manifests where artifact_kind='briefing_run' and artifact_id=$1",[run])).rows[0].artifact_revision;
 await login(db);ok((await db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4) v',[w,'briefing_run',run,briefRevision])).rows[0].v.projections.length,1);
 await deny(db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[other,'briefing_run',run,briefRevision]));
 await admin(db);await db.query('update document_extraction_file_bindings set is_current=false where id=$1',[binding]);await login(db);
 await deny(db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[w,'briefing_run',run,briefRevision]));

 console.log(JSON.stringify({passed:true,assertions,providerCalls:0,nativeConcurrency:false,releaseQualified:false,privateBodiesPublished:0,
 qualified:['captured document approval resolver and provenance guards','captured publication head selection','captured note identity and approval guards','typed file/note authority through VSI and brief save/reopen; actor-private VSI reopening','review/cache/head/note revocation'],
 limitations:['synthetic stored v1 document manifest; v2/v3 provider extraction not executed','fixture does not reproduce unrelated storage/OCR service lifecycle or all deployed RLS/DDL','PGlite single backend; no new concurrency claim','semantic receipt is a synthetic trusted-server attestation; application validator covered separately']}));
} catch(error) { console.error(JSON.stringify({passed:false,assertions,code:/^[0-9A-Z]{5}$/.test(error.code??'')?error.code:'test_failure'}));process.exitCode=1; } finally {await db.close();}
