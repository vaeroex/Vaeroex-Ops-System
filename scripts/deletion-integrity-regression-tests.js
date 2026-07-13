const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { filterBusinessEvidence } = require("../lib/intelligence/evidence-eligibility.ts");
const { filterEligibleMemoryRows } = require("../lib/ai/evidence-index.ts");

const activeSignal = { id: "signal-1", status: "Business Signal", archived_at: null, deleted_at: null };
const archivedSignal = { ...activeSignal, archived_at: "2026-07-11T00:00:00.000Z" };
const deletedSignal = { ...archivedSignal, deleted_at: "2026-07-11T00:00:01.000Z" };

assert.equal(filterBusinessEvidence([activeSignal]).length, 1, "active Business Signals must remain eligible");
assert.equal(filterBusinessEvidence([archivedSignal]).length, 0, "archived Business Signals must leave active intelligence");
assert.equal(filterBusinessEvidence([deletedSignal]).length, 0, "deleted Business Signals must leave active intelligence");
assert.equal(filterBusinessEvidence([activeSignal, archivedSignal, deletedSignal]).length, 1, "only active signals may contribute to active counts");

const signalChunk = {
  id: "chunk-1",
  source_type: "business_signal",
  source_id: "signal-1",
  source_file_id: null,
  source_metadata: { evidence_classification: "business_evidence" },
  archived_at: null,
  deleted_at: null
};

assert.equal(
  filterEligibleMemoryRows({ rows: [signalChunk], files: [], runs: [], businessSignals: [activeSignal] }).length,
  1,
  "active signal memory may be retrieved"
);
assert.equal(
  filterEligibleMemoryRows({ rows: [signalChunk], files: [], runs: [], businessSignals: [archivedSignal] }).length,
  0,
  "archived signals must invalidate dependent memory retrieval"
);
assert.equal(
  filterEligibleMemoryRows({ rows: [signalChunk], files: [], runs: [], businessSignals: [deletedSignal] }).length,
  0,
  "deleted signals must invalidate dependent memory retrieval"
);
assert.equal(
  filterEligibleMemoryRows({ rows: [signalChunk], files: [], runs: [], businessSignals: [] }).length,
  0,
  "orphaned signal memory must not retrieve"
);

const operationsActions = fs.readFileSync(path.join(root, "app/app/operations/actions.ts"), "utf8");
const recordActions = fs.readFileSync(path.join(root, "app/app/operations/record-management-actions.ts"), "utf8");
const fileActions = fs.readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
const boundedContext = fs.readFileSync(path.join(root, "lib/ai/bounded-context.ts"), "utf8");
const searchRoute = fs.readFileSync(path.join(root, "app/api/search/route.ts"), "utf8");
const workspaceSnapshot = fs.readFileSync(path.join(root, "lib/ai/workspace-snapshot.ts"), "utf8");
const sourcesPage = fs.readFileSync(path.join(root, "app/app/sources/page.tsx"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607110002_business_signal_lifecycle_integrity.sql"), "utf8");
const packageJson = require("../package.json");

assert.match(operationsActions, /update_business_signal_lifecycle/, "Business Signal delete must use the transactional lifecycle function");
assert.doesNotMatch(operationsActions, /\.from\("tasks"\)[\s\S]{0,220}\.delete\(\)[\s\S]{0,220}\.single\(\)/, "Business Signal delete must not hard-delete through a single-row coercion");
assert.match(recordActions, /\.maybeSingle\(\)/, "single-record mutations must allow a zero-row result without a single JSON coercion error");
assert.doesNotMatch(recordActions, /select\("id"\)\.single\(\)/, "managed lifecycle mutations must not coerce a mutation result to one JSON object");
assert.match(recordActions, /revalidatePath\("\/app\/intelligence"\)/, "evidence mutations must invalidate Intelligence");
assert.match(recordActions, /revalidatePath\("\/app\/reports"\)/, "evidence mutations must invalidate reports");
assert.match(fileActions, /update_source_file_lifecycle/, "file lifecycle changes must atomically include learned evidence");
assert.match(boundedContext, /\.from\("tasks"\)[\s\S]{0,420}\.is\("deleted_at", null\)[\s\S]{0,120}\.is\("archived_at", null\)/, "Ask Vaeroex bounded context must exclude inactive signals before limiting");
assert.match(searchRoute, /\.from\("tasks"\)[\s\S]{0,420}\.is\("deleted_at", null\)[\s\S]{0,120}\.is\("archived_at", null\)/, "search must exclude inactive signals before limiting");
assert.match(workspaceSnapshot, /from\("tasks"\)[\s\S]{0,200}\.is\("deleted_at", null\)[\s\S]{0,120}\.is\("archived_at", null\)/, "workspace snapshots must count only active signals");
assert.match(sourcesPage, /chunk\.archived_at && !chunk\.deleted_at/, "archived knowledge view must exclude deleted knowledge");
assert.doesNotMatch(sourcesPage, /archivedOnly \? Boolean\(chunk\.archived_at \|\| chunk\.deleted_at\)/, "deleted knowledge must not remain in the archive view");
assert.match(migration, /update public\.tasks[\s\S]+update public\.business_memory_chunks/, "signal lifecycle must update the source and dependent memory in one transaction");
assert.match(migration, /update public\.file_uploads[\s\S]+update public\.business_memory_chunks/, "file lifecycle must update the source and dependent memory in one transaction");
assert.match(migration, /revoke all[\s\S]+grant execute[\s\S]+authenticated/, "lifecycle functions must not be public");
assert.equal(typeof packageJson.scripts["test:deletion-integrity"], "string", "deletion integrity tests must be runnable by name");

process.stdout.write("Deletion integrity regressions passed.\n");
