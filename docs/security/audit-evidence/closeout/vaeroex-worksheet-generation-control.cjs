// Controlled sensitivity check: restore only the former worksheet hash in memory.
const fs=require('node:fs'),path=require('node:path');const root='/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';const read=fs.readFileSync.bind(fs);
fs.readFileSync=function(file,...args){let s=read(file,...args);if(String(file)===path.join(root,'lib/ai/evidence-index.ts'))s=s.replace('hashContent(`${file.id}:${importAttemptId}:${chunk.worksheet.index}:${chunk.text}`)','hashContent(`${file.id}:${chunk.worksheet.index}:${chunk.text}`)');return s;};
require(path.join(root,'scripts/audit-import-evidence-fixes.cjs'));
