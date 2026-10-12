/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return originalResolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, ...rest); };
let allowed = true, rpcCalls = [], usageCalls = [], failure = false;
const fixture = { usage: [], runs: [], notes: [], counts: { usage: 0, runs: 0, notes: 0, saved_analyses: 123456 }, extra: "PRIVATE ANSWER" };
const admin = { rpc: async (name, args) => { rpcCalls.push({ name, args }); return failure ? { data: null, error: { message: "PRIVATE PROVIDER PAYLOAD AND SECRET" } } : { data: fixture, error: null }; } };
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request === "server-only") return {};
  if (request === "@/lib/admin/vaeroex-admin") return { getVaeroexAdminAccess: async () => ({ allowed, admin: allowed ? admin : null }) };
  if (request === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => admin };
  if (request === "@/lib/admin/usage-data") return { getAdminUsageData: async input => { usageCalls.push(input); return { error: null, workspaceOptions: [] }; } };
  return originalLoad.call(this, request, ...rest);
};
const { getAiTrustDashboardData, trustRowsTruncated } = require("../lib/admin/ai-trust-data.ts");
const { parseAiTrustFilters } = require("../lib/admin/ai-trust-dashboard.ts");
(async () => {
 const filters = parseAiTrustFilters({ range: "7d", workspace: "10000000-0000-4000-8000-000000000001" }).filters;
 assert.equal(trustRowsTruncated(fixture.counts, fixture), false, "a head/count-only saved analysis total is never truncation");
 assert.equal(trustRowsTruncated({ ...fixture.counts, usage: 5001 }, { ...fixture, usage: Array(5000).fill({}) }), true);
 const result = await getAiTrustDashboardData({ admin, filters });
 assert.equal(result.truncated, false);assert.equal(result.findingExplanation.savedAnalyses,123456);
 assert.equal(rpcCalls.length, 1);assert.equal(rpcCalls[0].name,"admin_ai_trust_rows_v1");
 assert.equal(rpcCalls[0].args.p_workspace_id,filters.workspace);
 assert.equal(rpcCalls[0].args.p_start,usageCalls[0].start);assert.equal(rpcCalls[0].args.p_end,usageCalls[0].end);
 assert.equal(result.periodEnd,result.generatedAt);assert.equal(Date.parse(result.periodEnd)-Date.parse(result.periodStart),7*86400000);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);
 failure=true;const failed=await getAiTrustDashboardData({admin,filters});assert.match(failed.sourceErrors[0].message,/unavailable/);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE|SECRET/);
 allowed=false;const before=rpcCalls.length,priorUsage=usageCalls.length;const denied=await getAiTrustDashboardData({admin,filters});assert.equal(rpcCalls.length,before);assert.equal(usageCalls.length,priorUsage);assert.match(denied.sourceErrors[0].message,/admin access/);
 console.log(JSON.stringify({passed:true,suite:"Trust scope, independent authorization, sanitized failure and count-only truncation"}));
})().catch(error=>{console.error(error);process.exitCode=1});
