// Regression sensitivity control only: restore the former pre-claim mutation
// ordering in memory; never edit application source or contact a database.
const fs=require('node:fs'),path=require('node:path');
const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const read=fs.readFileSync.bind(fs);
fs.readFileSync=function(file,...args){let source=read(file,...args);if(String(file)===path.join(root,'app/app/files/actions.ts')){
 let begin=source.indexOf('async function saveWorkbookImport');let a=source.indexOf('    await updateImportRowDiagnostics({ supabase, workspaceId, importId: importRecord.id, results: diagnostics });',begin);let b=source.indexOf('    await updateFileProcessingStatus',a);let former=source.slice(a,b);source=source.slice(0,a)+source.slice(b);let target=source.indexOf('  const validRows =',begin);source=source.slice(0,target)+former+source.slice(target);
 begin=source.indexOf('export async function saveExtractedImportAction');a=source.indexOf('    await updateImportRowDiagnostics({ supabase, workspaceId, importId, results: diagnostics });',begin);b=source.indexOf('\n',a)+1;former=source.slice(a,b);source=source.slice(0,a)+source.slice(b);target=source.indexOf('  if (!validRows.length)',begin);source=source.slice(0,target)+former+source.slice(target);
 }return source;};
require(path.join(root,process.argv[2]));
