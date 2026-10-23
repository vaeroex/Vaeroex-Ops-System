/* Offline, explicit snapshot preparation. Never called by CI or the runner. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const folder = 'docs/security-drafts/ci';
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const sources = [
 ['20261019001207_ready_account_reporting_connectors.sql', ['reporting_connections']],
 ['20261019070945_reporting_import_history.sql', ['reporting_history_facts', 'reporting_history_days']],
 ['20261017013603_loyverse_read_only_connection.sql', ['loyverse_connections', 'loyverse_receipt_facts']],
 ['20261019070953_loyverse_import_history.sql', ['loyverse_import_days']],
 ['20261017023221_zoho_books_read_only_connection.sql', ['zoho_books_connections']],
 ['20261019070949_zoho_books_import_history.sql', ['zoho_books_history_facts', 'zoho_books_history_coverage']],
 ['20261017051502_wix_orders_read_only_connection.sql', ['wix_order_connections', 'wix_order_facts']],
 ['20261019071008_wix_orders_import_history.sql', ['wix_order_import_days']]
];
function freeze() {
 fs.mkdirSync(path.join(root, folder), {recursive:true});
 const auditPaths=['deployed-contracts.json','typed-source-contracts.json'].map(f=>'docs/security-drafts/audit/'+f);
 const audits=auditPaths.map(p=>JSON.parse(read(p)));
 const definitions=[];
 for(let i=0;i<audits.length;i++) for(const f of audits[i].functions) definitions.push({...f,source:auditPaths[i],sha256:digest(f.definition)});
 const snapshot={status:'partial_audited_definitions_not_installable_overlay',definitions,triggers:audits[0].triggers,grants:audits[0].grants};
 const missingTriggerFunctions=[...new Set(snapshot.triggers.map(t=>/EXECUTE FUNCTION\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\(/i.exec(t.definition)?.[1]).filter(n=>n&&!definitions.some(f=>`${f.nspname}.${f.proname}`===n)))].sort();
 const tables=[];
 for(const [file,names] of sources) for(const name of names){
  const ddl=read('supabase/migrations/'+file).match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
  if(!ddl)throw new Error('source_table_definition_missing:'+name);
  tables.push(`-- Exact CREATE TABLE excerpt: supabase/migrations/${file}\n${ddl}`);
 }
 const owner=definitions.find(f=>f.proname==='square_production_customer_require_owner_v1').definition;
 const fixture=`-- SYNTHETIC FOUNDATION ONLY. No full application schema or deployed trigger parity.\n-- Auth/roles are supplied by the existing owned-container platform fixture.\ncreate schema private;\ncreate table public.workspaces(id uuid primary key);\ncreate table public.profiles(id uuid primary key);\ncreate table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);\ncreate table public.business_entities(workspace_id uuid,id uuid,status text,primary key(workspace_id,id));\n${tables.join('\n')}\n${owner};\nrevoke all on function private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;\n`;
 fs.writeFileSync(path.join(root,folder,'audited-definitions.json'),JSON.stringify(snapshot,null,2)+'\n');
 fs.writeFileSync(path.join(root,folder,'foundation.sql'),fixture);
 const files=[...auditPaths,...sources.map(([f])=>'supabase/migrations/'+f),folder+'/audited-definitions.json',folder+'/foundation.sql','docs/security-drafts/01-legacy-evidence.sql','scripts/qbo-candidate-local-container.cjs','scripts/run-square-durable-page-qualification.js','supabase/tests/fixtures/square-durable-platform.sql'];
 const manifest={version:1,scope:'synthetic_legacy_foundation_only',fullCompositionReady:false,
  missingAuditedTriggerDefinitions:missingTriggerFunctions,
  remainingContractGaps:[
   'Complete deployed table, constraint, RLS, grant and trigger inventory for all source and artifact relations (the audit is selective).',
   'Recursive dependencies of the audited routines, including exact installed source-writer definitions and lock order.',
   'Approved dependency-ordered complete installation overlay; repository migration history alone is not live parity.',
   'Final-validation/output-commit source-writer interlocks and deterministic two-session release scenarios for every admitted source.'
  ],files:files.map(p=>({path:p,sha256:digest(read(p))}))};
 fs.writeFileSync(path.join(root,folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('Frozen partial audit and synthetic foundation; full composition remains blocked.');
}
if(require.main===module)freeze();
module.exports={freeze};
